/**
 * Payout checkpoints.
 *
 * At each scheduled checkpoint, inside ONE database transaction:
 *   1. Lock the competition row; insert the (competition, scheduledAt)
 *      checkpoint row. The unique key makes the checkpoint idempotent: a
 *      second worker, a retry or a crash-restart cannot create it twice.
 *   2. Collect creator fees that are CONFIRMED, unassigned and confirmed at
 *      or before the checkpoint time. Pending fees are never counted.
 *   3. Rank current verified videos by Viral Score and pick the top
 *      eligible entry (verified, ≥ min views, no open flags, published after
 *      launch, submitted before the checkpoint, not excluded).
 *   4. Compute the reference market cap (TWAP × supply) and the reward share
 *      from the competition's curve (flat for pump.fun coins: 100% of the
 *      vault's share, so the market cap is recorded but not required).
 *   5. Allocate: reward (floored) + retained = fees in window. Assign the fee
 *      events to the checkpoint and create one pending payout whose
 *      idempotency key is the checkpoint identity.
 *   6. Advance next_checkpoint_at.
 *
 * Fees roll over untouched when there are no fees, no reliable price (only
 * if the curve depends on it), no eligible winner, or the reward is below the
 * dust threshold.
 * The transfer itself happens later in lib/services/payouts.ts.
 */
import { and, asc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { getAllConfig } from "@/lib/config/store";
import { db, schema, type Tx } from "@/lib/db";
import { payoutExecutor } from "@/lib/providers/payouts";
import {
  allocateFees,
  eligibilityOf,
  nextCheckpointAfter,
  rankEntries,
  selectWinner,
  type EligibilityRules,
  type LeaderboardEntry,
} from "@/lib/rewards/allocation";
import { curveIsFlat, rewardBpsForMarketCap } from "@/lib/rewards/curve";

/** Lamports kept back from each real payout to cover its network fee (priority fee included). */
const PAYOUT_NETWORK_FEE_RESERVE = 10_000;
import { computeReferenceMarketCap } from "@/lib/rewards/reference-market-cap";
import { audit } from "./audit";

export type CheckpointOutcome = {
  competitionId: string;
  scheduledAt: Date;
  status: string;
  rewardLamports?: number;
  winnerWallet?: string | null;
  skipped?: "already_processed" | "not_due";
};

export async function processDueCheckpoints(now = new Date()): Promise<CheckpointOutcome[]> {
  const due = await db
    .select({ id: schema.competitions.id, nextCheckpointAt: schema.competitions.nextCheckpointAt })
    .from(schema.competitions)
    .where(and(inArray(schema.competitions.status, ["active", "paused"]), lte(schema.competitions.nextCheckpointAt, now)))
    .orderBy(asc(schema.competitions.nextCheckpointAt))
    .limit(100);
  const out: CheckpointOutcome[] = [];
  for (const c of due) {
    try {
      out.push(await processCheckpoint(c.id, c.nextCheckpointAt, now));
    } catch (e) {
      console.error(`[checkpoint] ${c.id} @ ${c.nextCheckpointAt.toISOString()} failed`, e);
    }
  }
  return out;
}

async function leaderboardForCheckpoint(tx: Tx, competitionId: string): Promise<Array<LeaderboardEntry & { platform: string; likes: number; comments: number }>> {
  const rows = await tx
    .select({
      id: schema.videos.id,
      creatorWallet: schema.videos.creatorWallet,
      viralScore: schema.videos.viralScore,
      views: schema.videos.views,
      likes: schema.videos.likes,
      comments: schema.videos.comments,
      platform: schema.videos.platform,
      submittedAt: schema.videos.submittedAt,
      publishedAt: schema.videos.publishedAt,
      status: schema.videos.status,
      creatorBanned: schema.users.isBanned,
      openFlagCount: sql<number>`(SELECT count(*)::int FROM fraud_flags f WHERE f.video_id = ${schema.videos.id} AND f.status = 'open' AND f.severity <> 'low')`,
    })
    .from(schema.videos)
    .innerJoin(schema.users, eq(schema.users.wallet, schema.videos.creatorWallet))
    .where(eq(schema.videos.competitionId, competitionId));
  return rows.map((r) => ({ ...r, openFlagCount: Number(r.openFlagCount) }));
}

export async function processCheckpoint(competitionId: string, scheduledAt: Date, now = new Date()): Promise<CheckpointOutcome> {
  const executor = payoutExecutor();
  const configs = await getAllConfig();
  const payoutsCfg = configs.payouts.value;

  return db.transaction(async (tx) => {
    const locked = await tx.execute<{ id: string; next_checkpoint_at: string }>(
      sql`SELECT id, next_checkpoint_at FROM competitions WHERE id = ${competitionId} FOR UPDATE`,
    );
    const lockedRow = locked.rows[0];
    if (!lockedRow) throw new Error("Competition not found");
    if (new Date(lockedRow.next_checkpoint_at).getTime() !== scheduledAt.getTime()) {
      return { competitionId, scheduledAt, status: "skipped", skipped: "already_processed" as const };
    }
    if (scheduledAt > now) return { competitionId, scheduledAt, status: "skipped", skipped: "not_due" as const };

    const [{ competition, token }] = await tx
      .select({ competition: schema.competitions, token: schema.tokens })
      .from(schema.competitions)
      .innerJoin(schema.tokens, eq(schema.tokens.id, schema.competitions.tokenId))
      .where(eq(schema.competitions.id, competitionId));

    const next = nextCheckpointAfter(competition.startsAt, competition.payoutIntervalHours, now);
    const advance = () =>
      tx.update(schema.competitions).set({ nextCheckpointAt: next, updatedAt: now }).where(eq(schema.competitions.id, competitionId));

    // Idempotency anchor.
    const inserted = await tx
      .insert(schema.checkpoints)
      .values({ competitionId, scheduledAt, status: "processing" })
      .onConflictDoNothing()
      .returning({ id: schema.checkpoints.id });
    if (inserted.length === 0) {
      await advance();
      return { competitionId, scheduledAt, status: "skipped", skipped: "already_processed" as const };
    }
    const checkpointId = inserted[0].id;

    const configSnapshot = {
      scoring: { version: configs.scoring.version, value: configs.scoring.value },
      payouts: { version: configs.payouts.version, value: payoutsCfg },
      rewardCurve: competition.rewardCurve,
      minEligibleViews: competition.minEligibleViews,
      payoutIntervalHours: competition.payoutIntervalHours,
    };

    const finish = async (status: (typeof schema.checkpointStatusEnum.enumValues)[number], fields: Partial<typeof schema.checkpoints.$inferInsert> = {}) => {
      await tx
        .update(schema.checkpoints)
        .set({ status, completedAt: new Date(), configSnapshot, ...fields })
        .where(eq(schema.checkpoints.id, checkpointId));
      await advance();
    };

    if (competition.status === "paused") {
      await finish("skipped_paused", { note: competition.pausedReason ?? "Competition paused" });
      return { competitionId, scheduledAt, status: "skipped_paused" };
    }

    // 2. Confirmed, unassigned fees up to the checkpoint time.
    const feeRows = await tx
      .select({ id: schema.feeEvents.id, amount: schema.feeEvents.amountLamports })
      .from(schema.feeEvents)
      .where(
        and(
          eq(schema.feeEvents.tokenId, token.id),
          eq(schema.feeEvents.status, "confirmed"),
          isNull(schema.feeEvents.checkpointId),
          // Real payouts only ever spend real, on-chain fees: simulated fees can never be paid out in SOL.
          executor.isSimulated ? undefined : eq(schema.feeEvents.isSimulated, false),
          lte(schema.feeEvents.confirmedAt, scheduledAt),
        ),
      )
      .for("update");
    const fees = feeRows.reduce((s, f) => s + f.amount, 0);

    // 3. Leaderboard and winner.
    const entries = await leaderboardForCheckpoint(tx, competitionId);
    const rules: EligibilityRules = {
      minVerifiedViews: competition.minEligibleViews,
      launchedAt: token.launchedAt,
      checkpointAt: scheduledAt,
      excludedWallets: payoutsCfg.excludeDeployerFromRewards ? [token.deployerWallet] : [],
    };
    const ranked = rankEntries(entries);
    const leaderboardSnapshot = ranked.slice(0, 10).map((e, i) => ({
      rank: i + 1,
      videoId: e.id,
      wallet: e.creatorWallet,
      platform: e.platform,
      score: e.viralScore,
      views: e.views,
      likes: e.likes,
      comments: e.comments,
      ineligible: eligibilityOf(e, rules),
    }));
    const winner = selectWinner(entries, rules);

    // 4. Reference market cap.
    const windowStart = new Date(scheduledAt.getTime() - payoutsCfg.twapWindowMinutes * 60_000);
    const samples = await tx
      .select({ priceUsd: schema.priceSamples.priceUsd, supply: schema.priceSamples.supply, sampledAt: schema.priceSamples.sampledAt })
      .from(schema.priceSamples)
      .where(
        and(
          eq(schema.priceSamples.tokenId, token.id),
          gt(schema.priceSamples.sampledAt, windowStart),
          lte(schema.priceSamples.sampledAt, scheduledAt),
        ),
      );
    const ref = computeReferenceMarketCap(samples, scheduledAt, {
      windowMinutes: payoutsCfg.twapWindowMinutes,
      minSamples: payoutsCfg.minPriceSamples,
      maxStalenessMinutes: payoutsCfg.maxPriceStalenessMinutes,
    });

    const common: Partial<typeof schema.checkpoints.$inferInsert> = {
      feesInWindowLamports: fees,
      leaderboardSnapshot,
      priceSampleCount: ref.sampleCount,
      ...(ref.ok
        ? {
            referenceMarketCapUsd: ref.marketCapUsd,
            twapPriceUsd: ref.twapPriceUsd,
            referenceSupply: ref.supply,
            priceWindowStart: ref.windowStart,
            priceWindowEnd: ref.windowEnd,
          }
        : {}),
      winnerVideoId: winner?.id ?? null,
      winnerWallet: winner?.creatorWallet ?? null,
      winnerScore: winner?.viralScore ?? null,
      winnerViews: winner?.views ?? null,
    };

    if (fees === 0) {
      await finish("no_fees", common);
      return { competitionId, scheduledAt, status: "no_fees" };
    }
    // With a flat curve (every pump.fun coin: the vault's whole share is paid
    // out) the market cap changes nothing, so missing price data must not hold
    // a payout back; it is still recorded when available.
    if (!ref.ok && !curveIsFlat(competition.rewardCurve)) {
      await finish("skipped_price_data", { ...common, note: `Reference market cap unavailable: ${ref.reason}` });
      return { competitionId, scheduledAt, status: "skipped_price_data" };
    }

    const rewardBps = rewardBpsForMarketCap(competition.rewardCurve, ref.ok ? ref.marketCapUsd : 0);
    const allocated = allocateFees(fees, rewardBps);
    // Real payouts leave a small reserve in the vault for the transfer's own network fee, so the vault never pays
    // fees out of other competitions' money.
    const feeReserve = executor.isSimulated ? 0 : Math.min(PAYOUT_NETWORK_FEE_RESERVE, allocated.rewardLamports);
    const allocation = { rewardLamports: allocated.rewardLamports - feeReserve, retainedLamports: allocated.retainedLamports + feeReserve };

    if (!winner) {
      await finish("no_eligible_winner", { ...common, rewardBps, note: "No eligible video; fees roll over" });
      return { competitionId, scheduledAt, status: "no_eligible_winner" };
    }
    if (allocation.rewardLamports < payoutsCfg.minPayoutLamports || allocation.rewardLamports <= 0) {
      await finish("below_minimum", { ...common, rewardBps, note: "Reward below minimum payout; fees roll over" });
      return { competitionId, scheduledAt, status: "below_minimum" };
    }

    // 5. Allocate and create the payout.
    await tx
      .update(schema.feeEvents)
      .set({ checkpointId })
      .where(inArray(schema.feeEvents.id, feeRows.map((f) => f.id)));
    const idempotencyKey = `checkpoint:${competitionId}:${scheduledAt.toISOString()}`;
    const [payout] = await tx
      .insert(schema.payouts)
      .values({
        checkpointId,
        competitionId,
        videoId: winner.id,
        recipientWallet: winner.creatorWallet,
        amountLamports: allocation.rewardLamports,
        idempotencyKey,
        status: "pending",
        autoAttemptBudget: payoutsCfg.autoAttemptBudget,
        isSimulated: executor.isSimulated,
      })
      .returning({ id: schema.payouts.id });

    await finish("awarded", {
      ...common,
      rewardBps,
      rewardLamports: allocation.rewardLamports,
      retainedLamports: allocation.retainedLamports,
    });
    await audit(tx, {
      actor: "system:checkpoint",
      action: "payout.allocate",
      targetType: "payout",
      targetId: payout.id,
      after: {
        competitionId,
        scheduledAt: scheduledAt.toISOString(),
        recipient: winner.creatorWallet,
        videoId: winner.id,
        amountLamports: allocation.rewardLamports,
        rewardBps,
        referenceMarketCapUsd: ref.ok ? ref.marketCapUsd : null,
        feesInWindowLamports: fees,
      },
    });
    return { competitionId, scheduledAt, status: "awarded", rewardLamports: allocation.rewardLamports, winnerWallet: winner.creatorWallet };
  });
}

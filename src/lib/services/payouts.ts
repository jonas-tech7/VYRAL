/**
 * Payout execution state machine.
 *
 *   pending ──build+persist attempt──▶ submitted ──finalized──▶ confirmed
 *      ▲                                   │
 *      │      attempt expired / failed     │  (blockhash expired and signature
 *      └──── (budget left) ◀───────────────┘   unknown, or landed with error)
 *                                          │
 *                       budget exhausted ──▶ requires_attention
 *                                               │  retry (admin) / claim (creator)
 *                                               │  manual signature (admin, verified on-chain)
 *                                               └▶ void (admin): funds return to the pool
 *
 * Guarantees against double payment:
 *  - one payout per checkpoint (unique checkpoint_id + idempotency key);
 *  - at most one in-flight attempt per payout (partial unique index);
 *  - a new attempt is only built after the previous one is provably terminal;
 *  - the signature of every attempt is persisted before broadcast;
 *  - "confirmed" is only set from a finalized on-chain status.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { ApiError } from "@/lib/api/errors";
import { db, schema } from "@/lib/db";
import { payoutExecutor, type ChainStatus } from "@/lib/providers/payouts";
import { audit } from "./audit";

/** Kept in the vault on every payout: the network fee plus the rent-exempt minimum of a system account (890,880 lamports). */
const FEE_BUFFER_LAMPORTS = 50_000 + 890_880;

type Attempt = typeof schema.payoutAttempts.$inferSelect;
type Payout = typeof schema.payouts.$inferSelect;

async function settleAttempt(attempt: Attempt, payout: Payout, st: ChainStatus | undefined, height: number, now: Date) {
  const executor = payoutExecutor();

  if (st && st.state === "finalized" && !st.err) {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.payoutAttempts)
        .set({ status: "confirmed", resolvedAt: now })
        .where(eq(schema.payoutAttempts.id, attempt.id));
      await tx
        .update(schema.payouts)
        .set({
          status: "confirmed",
          signature: attempt.signature,
          confirmedSlot: st.slot,
          confirmedAt: now,
          lastError: null,
          resolution: payout.resolution ?? "automatic",
          updatedAt: now,
        })
        .where(eq(schema.payouts.id, payout.id));
      await audit(tx, {
        actor: "system:payouts",
        action: "payout.confirmed",
        targetType: "payout",
        targetId: payout.id,
        after: { signature: attempt.signature, slot: st.slot, amountLamports: payout.amountLamports, recipient: payout.recipientWallet },
      });
    });
    return "confirmed";
  }

  const landedWithError = Boolean(st && st.state !== "not_found" && st.err);
  const expired = (!st || st.state === "not_found") && height > attempt.lastValidBlockHeight;

  if (landedWithError || expired) {
    const exhausted = payout.attemptCount >= payout.autoAttemptBudget;
    await db.transaction(async (tx) => {
      await tx
        .update(schema.payoutAttempts)
        .set({ status: landedWithError ? "failed" : "expired", error: st?.err ?? "Blockhash expired before landing", resolvedAt: now })
        .where(eq(schema.payoutAttempts.id, attempt.id));
      await tx
        .update(schema.payouts)
        .set({
          status: exhausted ? "requires_attention" : "pending",
          lastError: landedWithError ? `Transaction failed: ${st?.err}` : "Transaction expired before confirmation",
          updatedAt: now,
        })
        .where(eq(schema.payouts.id, payout.id));
      if (exhausted) {
        await audit(tx, {
          actor: "system:payouts",
          action: "payout.requires_attention",
          targetType: "payout",
          targetId: payout.id,
          after: { attempts: payout.attemptCount, lastSignature: attempt.signature },
        });
      }
    });
    return exhausted ? "requires_attention" : "retry";
  }

  // Still in flight: re-broadcast the identical signed bytes (idempotent).
  if (!st || st.state === "not_found") {
    try {
      await executor.broadcast(attempt.rawTransaction);
      if (attempt.status === "built") {
        await db.update(schema.payoutAttempts).set({ status: "sent", sentAt: now }).where(eq(schema.payoutAttempts.id, attempt.id));
      }
    } catch (e) {
      await db
        .update(schema.payouts)
        .set({ lastError: `Broadcast error: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`, updatedAt: now })
        .where(eq(schema.payouts.id, payout.id));
    }
  }
  return "inflight";
}

async function startAttempt(payout: Payout, now: Date, triggeredBy: string) {
  const executor = payoutExecutor();
  if (executor.maxAutoLamports !== null && payout.amountLamports > executor.maxAutoLamports) {
    await db
      .update(schema.payouts)
      .set({
        status: "requires_attention",
        lastError: `Above the automatic payout limit of ${executor.maxAutoLamports / 1e9} SOL. Send it from the reward vault and settle it manually.`,
        updatedAt: now,
      })
      .where(eq(schema.payouts.id, payout.id));
    return "above_limit";
  }
  if (!executor.isSimulated) {
    const balance = await executor.getVaultBalance();
    if (balance < payout.amountLamports + FEE_BUFFER_LAMPORTS) {
      await db
        .update(schema.payouts)
        .set({ status: "requires_attention", lastError: "Insufficient fee-vault balance", updatedAt: now })
        .where(eq(schema.payouts.id, payout.id));
      return "insufficient_balance";
    }
  }

  let built: Awaited<ReturnType<typeof executor.build>>;
  try {
    built = await executor.build({ payoutId: payout.id, recipient: payout.recipientWallet, lamports: payout.amountLamports });
  } catch (e) {
    // Nothing was signed or sent; the payout stays pending and is tried again next run.
    await db
      .update(schema.payouts)
      .set({ lastError: `Build error: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`, updatedAt: now })
      .where(eq(schema.payouts.id, payout.id));
    return "build_failed";
  }

  // Persist the signed attempt BEFORE broadcasting.
  const created = await db.transaction(async (tx) => {
    const locked = await tx.execute<{ status: string; attempt_count: number }>(
      sql`SELECT status, attempt_count FROM payouts WHERE id = ${payout.id} FOR UPDATE`,
    );
    const cur = locked.rows[0];
    if (!cur || cur.status !== "pending") return false;
    await tx.insert(schema.payoutAttempts).values({
      payoutId: payout.id,
      attemptNo: Number(cur.attempt_count) + 1,
      signature: built.signature,
      blockhash: built.blockhash,
      lastValidBlockHeight: built.lastValidBlockHeight,
      rawTransaction: built.rawTransaction,
      status: "built",
      triggeredBy,
    });
    await tx
      .update(schema.payouts)
      .set({ status: "submitted", attemptCount: Number(cur.attempt_count) + 1, updatedAt: now })
      .where(eq(schema.payouts.id, payout.id));
    return true;
  });
  if (!created) return "skipped";

  try {
    await executor.broadcast(built.rawTransaction);
    await db
      .update(schema.payoutAttempts)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(schema.payoutAttempts.signature, built.signature));
  } catch (e) {
    // The attempt stays "built"; it will be re-broadcast or expire safely.
    await db
      .update(schema.payouts)
      .set({ lastError: `Broadcast error: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`, updatedAt: new Date() })
      .where(eq(schema.payouts.id, payout.id));
  }
  return "submitted";
}

export async function executePayouts(now = new Date()) {
  const executor = payoutExecutor();
  const summary = { confirmed: 0, retried: 0, attention: 0, started: 0, inflight: 0 };

  // 1. Resolve in-flight attempts.
  const inflight = await db
    .select({ attempt: schema.payoutAttempts, payout: schema.payouts })
    .from(schema.payoutAttempts)
    .innerJoin(schema.payouts, eq(schema.payouts.id, schema.payoutAttempts.payoutId))
    .where(inArray(schema.payoutAttempts.status, ["built", "sent"]))
    .limit(200);
  if (inflight.length > 0) {
    const [statuses, height] = await Promise.all([executor.getStatuses(inflight.map((r) => r.attempt.signature)), executor.getBlockHeight()]);
    for (const { attempt, payout } of inflight) {
      const r = await settleAttempt(attempt, payout, statuses.get(attempt.signature), height, now);
      if (r === "confirmed") summary.confirmed++;
      else if (r === "retry") summary.retried++;
      else if (r === "requires_attention") summary.attention++;
      else summary.inflight++;
    }
  }

  // 2. Start attempts for pending payouts.
  const pending = await db
    .select()
    .from(schema.payouts)
    .where(eq(schema.payouts.status, "pending"))
    .orderBy(asc(schema.payouts.createdAt))
    .limit(25);
  for (const p of pending) {
    if (p.attemptCount >= p.autoAttemptBudget) {
      await db.update(schema.payouts).set({ status: "requires_attention", updatedAt: now }).where(eq(schema.payouts.id, p.id));
      summary.attention++;
      continue;
    }
    const r = await startAttempt(p, now, "worker");
    if (r === "submitted") summary.started++;
    else if (r === "above_limit") summary.attention++;
  }
  return summary;
}

/* --------------------------- Manual fallbacks --------------------------- */

async function assertNoInflight(payoutId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.payoutAttempts)
    .where(and(eq(schema.payoutAttempts.payoutId, payoutId), inArray(schema.payoutAttempts.status, ["built", "sent"])));
  if (Number(row?.n ?? 0) > 0) {
    throw new ApiError(409, "attempt_in_flight", "A transaction for this payout is still in flight. Wait until it confirms or expires.");
  }
}

type Actor = { wallet: string; role: string | null; ipHash?: string | null };

/** Grants additional automatic attempts (admin retry or creator claim). */
export async function requeuePayout(payoutId: string, actor: Actor, kind: "retry" | "claim", note?: string | null) {
  await assertNoInflight(payoutId);
  return db.transaction(async (tx) => {
    const locked = await tx.execute<{ status: string; recipient_wallet: string; attempt_count: number }>(
      sql`SELECT status, recipient_wallet, attempt_count FROM payouts WHERE id = ${payoutId} FOR UPDATE`,
    );
    const p = locked.rows[0];
    if (!p) throw new ApiError(404, "not_found", "Payout not found.");
    if (p.status !== "requires_attention") throw new ApiError(409, "invalid_state", "Only payouts that need attention can be retried.");
    if (kind === "claim" && p.recipient_wallet !== actor.wallet) throw new ApiError(403, "forbidden", "Only the winning wallet can claim this reward.");
    await tx
      .update(schema.payouts)
      .set({
        status: "pending",
        autoAttemptBudget: Number(p.attempt_count) + 2,
        resolution: kind === "claim" ? "claim" : null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.payouts.id, payoutId));
    await audit(tx, {
      actor: actor.wallet,
      actorRole: actor.role,
      action: kind === "claim" ? "payout.claim" : "payout.retry",
      targetType: "payout",
      targetId: payoutId,
      before: { status: p.status },
      after: { status: "pending" },
      note,
      ipHash: actor.ipHash,
    });
    return { ok: true };
  });
}

/** Cancels a payout and returns its fees to the competition pool. */
export async function voidPayout(payoutId: string, actor: Actor, note: string) {
  await assertNoInflight(payoutId);
  return db.transaction(async (tx) => {
    const locked = await tx.execute<{ status: string; checkpoint_id: string; amount_lamports: number }>(
      sql`SELECT status, checkpoint_id, amount_lamports FROM payouts WHERE id = ${payoutId} FOR UPDATE`,
    );
    const p = locked.rows[0];
    if (!p) throw new ApiError(404, "not_found", "Payout not found.");
    if (!["pending", "requires_attention"].includes(p.status)) throw new ApiError(409, "invalid_state", "This payout can no longer be voided.");
    await tx.update(schema.payouts).set({ status: "voided", updatedAt: new Date(), lastError: null }).where(eq(schema.payouts.id, payoutId));
    await tx.update(schema.checkpoints).set({ status: "voided", note }).where(eq(schema.checkpoints.id, p.checkpoint_id));
    const released = await tx
      .update(schema.feeEvents)
      .set({ checkpointId: null })
      .where(eq(schema.feeEvents.checkpointId, p.checkpoint_id))
      .returning({ id: schema.feeEvents.id });
    await audit(tx, {
      actor: actor.wallet,
      actorRole: actor.role,
      action: "payout.void",
      targetType: "payout",
      targetId: payoutId,
      before: { status: p.status, amountLamports: Number(p.amount_lamports) },
      after: { status: "voided", feeEventsReturned: released.length },
      note,
      ipHash: actor.ipHash,
    });
    return { ok: true, feeEventsReturned: released.length };
  });
}

/** Settles a payout with a transfer made outside the automatic flow, after on-chain verification. */
export async function settleManually(payoutId: string, signature: string, actor: Actor, note: string) {
  await assertNoInflight(payoutId);
  const [p] = await db.select().from(schema.payouts).where(eq(schema.payouts.id, payoutId));
  if (!p) throw new ApiError(404, "not_found", "Payout not found.");
  if (!["pending", "requires_attention"].includes(p.status)) throw new ApiError(409, "invalid_state", "This payout can no longer be settled manually.");

  const v = await payoutExecutor().verifyTransfer(signature, { recipient: p.recipientWallet, lamports: p.amountLamports, payoutId });
  if (!v.ok) throw new ApiError(422, "verification_failed", v.reason);

  try {
    return await db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.payouts)
        .set({
          status: "confirmed",
          signature,
          confirmedSlot: v.slot,
          confirmedAt: new Date(),
          resolution: "manual_signature",
          lastError: null,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.payouts.id, payoutId), inArray(schema.payouts.status, ["pending", "requires_attention"])))
        .returning({ id: schema.payouts.id });
      if (!updated.length) throw new ApiError(409, "invalid_state", "Payout changed state; reload and try again.");
      await audit(tx, {
        actor: actor.wallet,
        actorRole: actor.role,
        action: "payout.settle_manual",
        targetType: "payout",
        targetId: payoutId,
        before: { status: p.status },
        after: { status: "confirmed", signature, slot: v.slot },
        note,
        ipHash: actor.ipHash,
      });
      return { ok: true };
    });
  } catch (e) {
    if ((e as { code?: string })?.code === "23505") throw new ApiError(409, "signature_used", "That signature already settles another payout.");
    throw e;
  }
}

/**
 * Administrative actions. Every mutation writes an audit record in the same
 * transaction as the change.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { ApiError } from "@/lib/api/errors";
import { getConfig, updateConfig } from "@/lib/config/store";
import { rewardCurveSchema, type RewardCurveConfig, type ScoringConfig } from "@/lib/config/schemas";
import { db, schema } from "@/lib/db";
import { PLATFORMS } from "@/lib/domain/platforms";
import { nextCheckpointAfter } from "@/lib/rewards/allocation";
import { calibrateMultipliers, DEFAULT_CALIBRATION_OPTIONS } from "@/lib/scoring/calibration";
import { audit } from "./audit";
import { rescoreAllActive } from "./scoring";

export type Actor = { wallet: string; role: string | null; ipHash?: string | null };

/* ------------------------------ Videos -------------------------------- */

export async function reviewVideo(videoId: string, decision: "verify" | "reject", note: string, actor: Actor) {
  return db.transaction(async (tx) => {
    const [v] = await tx.select().from(schema.videos).where(eq(schema.videos.id, videoId)).for("update");
    if (!v) throw new ApiError(404, "not_found", "Video not found.");
    const now = new Date();
    const status = decision === "verify" ? "verified" : "rejected";
    await tx
      .update(schema.videos)
      .set({
        status,
        statusReason: decision === "verify" ? null : "rejected_by_review",
        reviewedBy: actor.wallet,
        reviewedAt: now,
        reviewNote: note,
        riskScore: decision === "verify" ? 0 : v.riskScore,
      })
      .where(eq(schema.videos.id, videoId));
    const flags = await tx
      .update(schema.fraudFlags)
      .set({ status: decision === "verify" ? "dismissed" : "confirmed", resolvedAt: now, resolvedBy: actor.wallet, resolutionNote: note })
      .where(and(eq(schema.fraudFlags.videoId, videoId), eq(schema.fraudFlags.status, "open")))
      .returning({ id: schema.fraudFlags.id });
    await audit(tx, {
      actor: actor.wallet,
      actorRole: actor.role,
      action: `video.review.${decision}`,
      targetType: "video",
      targetId: videoId,
      before: { status: v.status, statusReason: v.statusReason, riskScore: v.riskScore },
      after: { status, flagsResolved: flags.length },
      note,
      ipHash: actor.ipHash,
    });
    return { status, flagsResolved: flags.length };
  });
}

export async function resolveFlag(flagId: string, decision: "dismiss" | "confirm", note: string, actor: Actor) {
  return db.transaction(async (tx) => {
    const [f] = await tx.select().from(schema.fraudFlags).where(eq(schema.fraudFlags.id, flagId)).for("update");
    if (!f) throw new ApiError(404, "not_found", "Flag not found.");
    if (f.status !== "open") throw new ApiError(409, "invalid_state", "This flag was already resolved.");
    await tx
      .update(schema.fraudFlags)
      .set({ status: decision === "dismiss" ? "dismissed" : "confirmed", resolvedAt: new Date(), resolvedBy: actor.wallet, resolutionNote: note })
      .where(eq(schema.fraudFlags.id, flagId));
    await audit(tx, {
      actor: actor.wallet,
      actorRole: actor.role,
      action: `flag.${decision}`,
      targetType: "fraud_flag",
      targetId: flagId,
      before: { status: f.status, signal: f.signal, severity: f.severity },
      after: { status: decision === "dismiss" ? "dismissed" : "confirmed" },
      note,
      ipHash: actor.ipHash,
    });
    return { ok: true };
  });
}

/* ---------------------------- Competitions ----------------------------- */

export async function setCompetitionStatus(competitionId: string, status: "active" | "paused" | "ended", reason: string, actor: Actor) {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(schema.competitions).where(eq(schema.competitions.id, competitionId)).for("update");
    if (!c) throw new ApiError(404, "not_found", "Competition not found.");
    if (c.status === "ended") throw new ApiError(409, "invalid_state", "Ended competitions cannot be changed.");
    const now = new Date();
    await tx
      .update(schema.competitions)
      .set({
        status,
        pausedAt: status === "paused" ? now : null,
        pausedReason: status === "paused" ? reason : null,
        pausedBy: status === "paused" ? actor.wallet : null,
        endedAt: status === "ended" ? now : null,
        updatedAt: now,
      })
      .where(eq(schema.competitions.id, competitionId));
    await audit(tx, {
      actor: actor.wallet,
      actorRole: actor.role,
      action: `competition.${status === "active" ? "resume" : status === "paused" ? "pause" : "end"}`,
      targetType: "competition",
      targetId: competitionId,
      before: { status: c.status },
      after: { status },
      note: reason,
      ipHash: actor.ipHash,
    });
    return { ok: true };
  });
}

export async function updateCompetitionRules(
  competitionId: string,
  patch: { payoutIntervalHours?: number; minEligibleViews?: number; rewardCurve?: RewardCurveConfig },
  note: string,
  actor: Actor,
) {
  const payoutsCfg = (await getConfig("payouts")).value;
  if (patch.payoutIntervalHours !== undefined && !payoutsCfg.allowedIntervalsHours.includes(patch.payoutIntervalHours)) {
    throw new ApiError(400, "invalid_request", "Interval must be one of the allowed payout intervals.");
  }
  if (patch.rewardCurve) rewardCurveSchema.parse(patch.rewardCurve);
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(schema.competitions).where(eq(schema.competitions.id, competitionId)).for("update");
    if (!c) throw new ApiError(404, "not_found", "Competition not found.");
    const now = new Date();
    const set: Partial<typeof schema.competitions.$inferInsert> = { updatedAt: now };
    if (patch.payoutIntervalHours !== undefined && patch.payoutIntervalHours !== c.payoutIntervalHours) {
      set.payoutIntervalHours = patch.payoutIntervalHours;
      // Re-anchor the cadence from now so no checkpoint is skipped or doubled.
      set.startsAt = now;
      set.nextCheckpointAt = nextCheckpointAfter(now, patch.payoutIntervalHours, now);
    }
    if (patch.minEligibleViews !== undefined) set.minEligibleViews = patch.minEligibleViews;
    if (patch.rewardCurve) set.rewardCurve = patch.rewardCurve;
    await tx.update(schema.competitions).set(set).where(eq(schema.competitions.id, competitionId));
    await audit(tx, {
      actor: actor.wallet,
      actorRole: actor.role,
      action: "competition.rules.update",
      targetType: "competition",
      targetId: competitionId,
      before: { payoutIntervalHours: c.payoutIntervalHours, minEligibleViews: c.minEligibleViews, rewardCurve: c.rewardCurve },
      after: patch,
      note,
      ipHash: actor.ipHash,
    });
    return { ok: true };
  });
}

/** Applies the current global reward curve to every active/paused competition. */
export async function applyGlobalCurveToAll(note: string, actor: Actor) {
  const curve = await getConfig("reward_curve");
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.competitions)
      .set({ rewardCurve: curve.value, rulesConfigVersion: curve.version, updatedAt: new Date() })
      .where(inArray(schema.competitions.status, ["active", "paused"]))
      .returning({ id: schema.competitions.id });
    await audit(tx, {
      actor: actor.wallet,
      actorRole: actor.role,
      action: "competition.rules.apply_global_curve",
      targetType: "competition",
      targetId: "*",
      after: { curveVersion: curve.version, competitions: updated.length },
      note,
      ipHash: actor.ipHash,
    });
    return { updated: updated.length };
  });
}

/* ------------------------------ Creators ------------------------------- */

export async function setCreatorBan(wallet: string, banned: boolean, reason: string, actor: Actor) {
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(schema.users).where(eq(schema.users.wallet, wallet)).for("update");
    if (!u) throw new ApiError(404, "not_found", "Creator not found.");
    await tx.update(schema.users).set({ isBanned: banned, banReason: banned ? reason : null }).where(eq(schema.users.wallet, wallet));
    if (banned) await tx.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.wallet, wallet));
    await audit(tx, {
      actor: actor.wallet,
      actorRole: actor.role,
      action: banned ? "creator.suspend" : "creator.reinstate",
      targetType: "user",
      targetId: wallet,
      before: { isBanned: u.isBanned },
      after: { isBanned: banned },
      note: reason,
      ipHash: actor.ipHash,
    });
    return { ok: true };
  });
}

/* ----------------------------- Calibration ----------------------------- */

export async function computeCalibration(windowDays = DEFAULT_CALIBRATION_OPTIONS.windowDays) {
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const rows = await db
    .select({ platform: schema.videos.platform, views: schema.videos.views, likes: schema.videos.likes, comments: schema.videos.comments })
    .from(schema.videos)
    .where(
      and(
        eq(schema.videos.status, "verified"),
        sql`${schema.videos.submittedAt} > ${since.toISOString()}::timestamptz`,
        sql`NOT EXISTS (SELECT 1 FROM fraud_flags f WHERE f.video_id = ${schema.videos.id} AND f.status IN ('open','confirmed'))`,
      ),
    );
  return calibrateMultipliers(rows, { ...DEFAULT_CALIBRATION_OPTIONS, windowDays });
}

/** Applies calibrated like/comment multipliers (view multipliers unchanged) and rescores. */
export async function applyCalibration(actor: Actor, note: string) {
  const result = await computeCalibration();
  if (!result.usable) throw new ApiError(422, "insufficient_data", "Not enough verified data across platforms to calibrate.");
  const current = (await getConfig("scoring")).value;
  const next: ScoringConfig = structuredClone(current);
  for (const p of PLATFORMS) {
    const c = result.platforms[p];
    if (!c.sufficient || c.like.suggested === null) continue;
    next.multipliers[p] = {
      view: current.multipliers[p].view,
      like: c.like.suggested,
      comment: c.comment.suggested ?? current.multipliers[p].comment,
      source: {
        kind: "calibrated",
        note: `${result.method}; reference like rate ${(result.reference.likeRate! * 100).toFixed(2)}%`,
        sampleSize: c.sampleSize,
        windowDays: result.options.windowDays,
        calibratedAt: result.computedAt,
      },
    };
  }
  const saved = await updateConfig("scoring", next, actor, note || "Applied calibrated multipliers");
  const rescored = await rescoreAllActive();
  return { version: saved.version, rescored };
}

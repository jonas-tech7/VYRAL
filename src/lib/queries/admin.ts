/** Read models for the admin dashboard. Callers must authorise first (see lib/auth/admin.ts). */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import type { Platform } from "@/lib/domain/platforms";

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const d = (v: unknown) => (v ? new Date(v as string) : null);
type Row = Record<string, unknown>;

export async function getAdminOverview() {
  const r = (
    await db.execute(sql`
    SELECT
      (SELECT count(*) FROM videos WHERE status = 'under_review') AS review_queue,
      (SELECT count(*) FROM fraud_flags WHERE status = 'open' AND severity <> 'low') AS open_flags,
      (SELECT count(*) FROM disputes WHERE status = 'open') AS open_disputes,
      (SELECT count(*) FROM payouts WHERE status = 'requires_attention') AS payouts_attention,
      (SELECT count(*) FROM payouts WHERE status IN ('pending', 'submitted')) AS payouts_inflight,
      (SELECT coalesce(sum(amount_lamports), 0) FROM payouts WHERE status IN ('pending', 'submitted', 'requires_attention')) AS payouts_outstanding,
      (SELECT coalesce(sum(amount_lamports), 0) FROM fee_events WHERE status = 'confirmed' AND checkpoint_id IS NULL) AS unallocated,
      (SELECT coalesce(sum(amount_lamports), 0) FROM fee_events WHERE status = 'pending') AS pending_fees,
      (SELECT coalesce(sum(amount_lamports), 0) FROM fee_events WHERE status = 'confirmed' AND confirmed_at > now() - interval '24 hours') AS fees_24h,
      (SELECT coalesce(sum(amount_lamports), 0) FROM payouts WHERE status = 'confirmed' AND confirmed_at > now() - interval '24 hours') AS paid_24h,
      (SELECT count(*) FROM competitions WHERE status = 'active') AS active_competitions,
      (SELECT count(*) FROM competitions WHERE status = 'paused') AS paused_competitions,
      (SELECT count(*) FROM checkpoints WHERE completed_at > now() - interval '24 hours') AS checkpoints_24h
  `)
  ).rows[0] as Row;

  const jobs = await db.execute(sql`
    SELECT DISTINCT ON (job) job, status, started_at, finished_at, detail
    FROM job_runs ORDER BY job, started_at DESC
  `);

  return {
    reviewQueue: n(r.review_queue),
    openFlags: n(r.open_flags),
    openDisputes: n(r.open_disputes),
    payoutsAttention: n(r.payouts_attention),
    payoutsInflight: n(r.payouts_inflight),
    payoutsOutstandingLamports: n(r.payouts_outstanding),
    unallocatedLamports: n(r.unallocated),
    pendingFeesLamports: n(r.pending_fees),
    fees24hLamports: n(r.fees_24h),
    paid24hLamports: n(r.paid_24h),
    activeCompetitions: n(r.active_competitions),
    pausedCompetitions: n(r.paused_competitions),
    checkpoints24h: n(r.checkpoints_24h),
    jobs: jobs.rows.map((j) => {
      const x = j as Row;
      return {
        job: x.job as string,
        status: x.status as string,
        startedAt: new Date(x.started_at as string),
        finishedAt: d(x.finished_at),
        detail: (x.detail as Record<string, unknown>) ?? {},
      };
    }),
  };
}

export type ReviewItem = {
  id: string;
  platform: Platform;
  canonicalUrl: string;
  authorHandle: string | null;
  creatorWallet: string;
  views: number;
  likes: number;
  comments: number;
  viralScore: number;
  riskScore: number;
  status: string;
  statusReason: string | null;
  publishedAt: Date;
  submittedAt: Date;
  symbol: string;
  mint: string;
  flags: Array<{ id: string; signal: string; severity: string; summary: string; status: string; createdAt: Date; evidence: Record<string, unknown> }>;
};

export async function listReviewQueue(scope: "queue" | "recent" = "queue"): Promise<ReviewItem[]> {
  const where =
    scope === "queue" ? sql`v.status = 'under_review'` : sql`v.reviewed_at IS NOT NULL AND v.reviewed_by NOT LIKE 'system:%'`;
  const order = scope === "queue" ? sql`v.risk_score DESC, v.viral_score DESC` : sql`v.reviewed_at DESC`;
  const res = await db.execute(sql`
    SELECT v.id, v.platform, v.canonical_url, v.author_handle, v.creator_wallet, v.views, v.likes, v.comments, v.viral_score,
           v.risk_score, v.status, v.status_reason, v.published_at, v.submitted_at, t.symbol, t.mint,
           coalesce((SELECT json_agg(json_build_object('id', f.id, 'signal', f.signal, 'severity', f.severity, 'summary', f.summary,
                     'status', f.status, 'createdAt', f.created_at, 'evidence', f.evidence) ORDER BY f.created_at DESC)
                     FROM fraud_flags f WHERE f.video_id = v.id), '[]') AS flags
    FROM videos v JOIN competitions c ON c.id = v.competition_id JOIN tokens t ON t.id = c.token_id
    WHERE ${where} ORDER BY ${order} LIMIT 60
  `);
  return res.rows.map((row) => {
    const x = row as Row;
    return {
      id: x.id as string,
      platform: x.platform as Platform,
      canonicalUrl: x.canonical_url as string,
      authorHandle: (x.author_handle as string) ?? null,
      creatorWallet: x.creator_wallet as string,
      views: n(x.views),
      likes: n(x.likes),
      comments: n(x.comments),
      viralScore: n(x.viral_score),
      riskScore: n(x.risk_score),
      status: x.status as string,
      statusReason: (x.status_reason as string) ?? null,
      publishedAt: new Date(x.published_at as string),
      submittedAt: new Date(x.submitted_at as string),
      symbol: x.symbol as string,
      mint: x.mint as string,
      flags: ((x.flags as ReviewItem["flags"]) ?? []).map((f) => ({ ...f, createdAt: new Date(f.createdAt as unknown as string) })),
    };
  });
}

export const PAYOUT_FILTERS = ["attention", "inflight", "confirmed", "voided", "all"] as const;
export type PayoutFilter = (typeof PAYOUT_FILTERS)[number];

export async function listAdminPayouts(filter: PayoutFilter) {
  const where: SQL =
    filter === "attention"
      ? sql`p.status = 'requires_attention'`
      : filter === "inflight"
        ? sql`p.status IN ('pending', 'submitted')`
        : filter === "confirmed"
          ? sql`p.status = 'confirmed'`
          : filter === "voided"
            ? sql`p.status = 'voided'`
            : sql`TRUE`;
  const res = await db.execute(sql`
    SELECT p.id, p.status, p.amount_lamports, p.recipient_wallet, p.signature, p.attempt_count, p.auto_attempt_budget, p.last_error,
           p.resolution, p.is_simulated, p.created_at, p.updated_at, p.confirmed_at, cp.scheduled_at, cp.reward_bps,
           cp.reference_market_cap_usd, t.symbol, t.mint,
           (SELECT json_agg(json_build_object('no', a.attempt_no, 'signature', a.signature, 'status', a.status, 'error', a.error, 'by', a.triggered_by)
              ORDER BY a.attempt_no) FROM payout_attempts a WHERE a.payout_id = p.id) AS attempts
    FROM payouts p JOIN checkpoints cp ON cp.id = p.checkpoint_id JOIN competitions c ON c.id = p.competition_id JOIN tokens t ON t.id = c.token_id
    WHERE ${where} ORDER BY p.updated_at DESC LIMIT 100
  `);
  return res.rows.map((row) => {
    const x = row as Row;
    return {
      id: x.id as string,
      status: x.status as string,
      amountLamports: n(x.amount_lamports),
      recipientWallet: x.recipient_wallet as string,
      signature: (x.signature as string) ?? null,
      attemptCount: n(x.attempt_count),
      autoAttemptBudget: n(x.auto_attempt_budget),
      lastError: (x.last_error as string) ?? null,
      resolution: (x.resolution as string) ?? null,
      isSimulated: Boolean(x.is_simulated),
      createdAt: new Date(x.created_at as string),
      updatedAt: new Date(x.updated_at as string),
      confirmedAt: d(x.confirmed_at),
      scheduledAt: new Date(x.scheduled_at as string),
      rewardBps: x.reward_bps === null ? null : n(x.reward_bps),
      referenceMarketCapUsd: x.reference_market_cap_usd === null ? null : n(x.reference_market_cap_usd),
      symbol: x.symbol as string,
      mint: x.mint as string,
      attempts: ((x.attempts as Array<{ no: number; signature: string; status: string; error: string | null; by: string }>) ?? []).filter(Boolean),
    };
  });
}

export async function listAdminCompetitions() {
  const res = await db.execute(sql`
    SELECT c.id, c.status, c.payout_interval_hours, c.min_eligible_views, c.rules_config_version, c.next_checkpoint_at, c.paused_reason,
           c.reward_curve, t.symbol, t.name, t.mint, t.market_cap_usd,
           (SELECT coalesce(sum(amount_lamports), 0) FROM fee_events f WHERE f.token_id = t.id AND f.status = 'confirmed' AND f.checkpoint_id IS NULL) AS unallocated,
           (SELECT count(*) FROM videos v WHERE v.competition_id = c.id AND v.status = 'under_review') AS in_review,
           (SELECT count(*) FROM videos v WHERE v.competition_id = c.id AND v.status <> 'rejected') AS videos
    FROM competitions c JOIN tokens t ON t.id = c.token_id
    ORDER BY (c.status = 'paused') DESC, t.market_cap_usd DESC
  `);
  return res.rows.map((row) => {
    const x = row as Row;
    return {
      id: x.id as string,
      status: x.status as "active" | "paused" | "ended",
      payoutIntervalHours: n(x.payout_interval_hours),
      minEligibleViews: n(x.min_eligible_views),
      rulesConfigVersion: n(x.rules_config_version),
      nextCheckpointAt: new Date(x.next_checkpoint_at as string),
      pausedReason: (x.paused_reason as string) ?? null,
      symbol: x.symbol as string,
      name: x.name as string,
      mint: x.mint as string,
      marketCapUsd: n(x.market_cap_usd),
      unallocatedLamports: n(x.unallocated),
      inReview: n(x.in_review),
      videos: n(x.videos),
    };
  });
}

export async function listFeesByToken() {
  const res = await db.execute(sql`
    SELECT t.symbol, t.mint,
           coalesce(sum(f.amount_lamports) FILTER (WHERE f.status = 'confirmed'), 0) AS confirmed,
           coalesce(sum(f.amount_lamports) FILTER (WHERE f.status = 'pending'), 0) AS pending,
           coalesce(sum(f.amount_lamports) FILTER (WHERE f.status = 'confirmed' AND f.checkpoint_id IS NULL), 0) AS unallocated,
           (SELECT coalesce(sum(reward_lamports), 0) FROM checkpoints cp JOIN competitions c2 ON c2.id = cp.competition_id WHERE c2.token_id = t.id AND cp.status = 'awarded') AS rewarded,
           (SELECT coalesce(sum(retained_lamports), 0) FROM checkpoints cp JOIN competitions c2 ON c2.id = cp.competition_id WHERE c2.token_id = t.id AND cp.status = 'awarded') AS retained,
           max(f.confirmed_at) AS last_fee
    FROM tokens t LEFT JOIN fee_events f ON f.token_id = t.id
    GROUP BY t.id ORDER BY confirmed DESC
  `);
  return res.rows.map((row) => {
    const x = row as Row;
    return {
      symbol: x.symbol as string,
      mint: x.mint as string,
      confirmedLamports: n(x.confirmed),
      pendingLamports: n(x.pending),
      unallocatedLamports: n(x.unallocated),
      rewardedLamports: n(x.rewarded),
      retainedLamports: n(x.retained),
      lastFeeAt: d(x.last_fee),
    };
  });
}

export async function listAdminDisputes(status: "open" | "closed") {
  const res = await db.execute(sql`
    SELECT d.id, d.wallet, d.category, d.message, d.status, d.resolution, d.resolved_by, d.created_at, d.resolved_at,
           d.video_id, d.payout_id, v.platform, v.canonical_url, v.author_handle, v.status AS video_status, v.status_reason, t.symbol, t.mint
    FROM disputes d
    LEFT JOIN videos v ON v.id = d.video_id
    LEFT JOIN competitions c ON c.id = d.competition_id
    LEFT JOIN tokens t ON t.id = c.token_id
    WHERE ${status === "open" ? sql`d.status = 'open'` : sql`d.status <> 'open'`}
    ORDER BY d.created_at DESC LIMIT 100
  `);
  return res.rows.map((row) => {
    const x = row as Row;
    return {
      id: x.id as string,
      wallet: x.wallet as string,
      category: x.category as string,
      message: x.message as string,
      status: x.status as string,
      resolution: (x.resolution as string) ?? null,
      resolvedBy: (x.resolved_by as string) ?? null,
      createdAt: new Date(x.created_at as string),
      resolvedAt: d(x.resolved_at),
      videoId: (x.video_id as string) ?? null,
      platform: (x.platform as Platform) ?? null,
      canonicalUrl: (x.canonical_url as string) ?? null,
      authorHandle: (x.author_handle as string) ?? null,
      videoStatus: (x.video_status as string) ?? null,
      symbol: (x.symbol as string) ?? null,
      mint: (x.mint as string) ?? null,
    };
  });
}

export async function listAuditLog(opts: { q?: string; page?: number }) {
  const page = Math.max(1, opts.page ?? 1);
  const filter = opts.q ? sql`(action ILIKE ${`%${opts.q}%`} OR actor ILIKE ${`%${opts.q}%`} OR target_id ILIKE ${`%${opts.q}%`})` : sql`TRUE`;
  const res = await db.execute(sql`
    SELECT id, actor, actor_role, action, target_type, target_id, before, after, note, created_at
    FROM audit_logs WHERE ${filter} ORDER BY id DESC LIMIT 50 OFFSET ${(page - 1) * 50}
  `);
  const total = n(((await db.execute(sql`SELECT count(*) AS n FROM audit_logs WHERE ${filter}`)).rows[0] as Row).n);
  return {
    total,
    page,
    rows: res.rows.map((row) => {
      const x = row as Row;
      return {
        id: n(x.id),
        actor: x.actor as string,
        actorRole: (x.actor_role as string) ?? null,
        action: x.action as string,
        targetType: x.target_type as string,
        targetId: (x.target_id as string) ?? null,
        before: x.before ?? null,
        after: x.after ?? null,
        note: (x.note as string) ?? null,
        createdAt: new Date(x.created_at as string),
      };
    }),
  };
}

export async function listConfigHistory(key: string) {
  const res = await db.execute(sql`SELECT version, updated_by, note, created_at FROM config_history WHERE key = ${key} ORDER BY version DESC LIMIT 10`);
  return res.rows.map((row) => {
    const x = row as Row;
    return { version: n(x.version), updatedBy: x.updated_by as string, note: (x.note as string) ?? null, createdAt: new Date(x.created_at as string) };
  });
}

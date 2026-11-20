/**
 * VYRAL database schema (PostgreSQL, Drizzle ORM).
 *
 * Column names are inferred from the TypeScript keys and converted to
 * snake_case (see `casing: "snake_case"` in the db client and drizzle config).
 *
 * Monetary conventions:
 *  - SOL amounts are stored as integer lamports (`bigint`, mode "number";
 *    safe up to ~9M SOL, far above any single pool).
 *  - Percentages that drive payouts are stored as integer basis points.
 *  - Market data (USD prices, market caps) is informational and stored as
 *    double precision; it never feeds a transfer amount directly.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  customType,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const tz = () => timestamp({ withTimezone: true, mode: "date" });
const lamports = () => bigint({ mode: "number" });
const count = () => bigint({ mode: "number" });

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const platformEnum = pgEnum("platform", ["tiktok", "youtube", "instagram", "x"]);

export const videoStatusEnum = pgEnum("video_status", ["verified", "under_review", "rejected"]);

export const competitionStatusEnum = pgEnum("competition_status", ["active", "paused", "ended"]);

export const flagSeverityEnum = pgEnum("flag_severity", ["low", "medium", "high"]);

export const flagStatusEnum = pgEnum("flag_status", ["open", "dismissed", "confirmed"]);

export const fraudSignalEnum = pgEnum("fraud_signal", [
  "view_spike",
  "abnormal_like_ratio",
  "abnormal_comment_ratio",
  "low_engagement_high_views",
  "purchased_likes_pattern",
  "purchased_views_pattern",
  "uniform_growth_pattern",
  "round_number_increments",
  "metrics_regression",
  "reused_content",
  "duplicate_submission",
  "submission_velocity",
  "shared_social_account",
  "shared_network",
  "self_dealing",
  "contract_address_removed",
]);

export const checkpointStatusEnum = pgEnum("checkpoint_status", [
  "processing",
  "awarded",
  "no_eligible_winner",
  "no_fees",
  "below_minimum",
  "skipped_paused",
  "skipped_price_data",
  "voided",
]);

export const payoutStatusEnum = pgEnum("payout_status", [
  "pending", // allocated at a checkpoint, no transaction built yet
  "submitted", // a transaction attempt has been signed and broadcast
  "confirmed", // finalized on-chain (only state shown as "paid")
  "requires_attention", // automatic attempts exhausted; claimable / manual review
  "voided", // cancelled by an administrator; funds returned to the pool
]);

export const attemptStatusEnum = pgEnum("attempt_status", [
  "built", // signed and persisted, broadcast not yet acknowledged
  "sent", // broadcast acknowledged by RPC
  "confirmed", // finalized
  "expired", // blockhash expired without landing: provably can never land
  "failed", // landed with an error (no funds moved)
]);

export const feeStatusEnum = pgEnum("fee_status", ["pending", "confirmed", "failed"]);

export const disputeStatusEnum = pgEnum("dispute_status", ["open", "resolved", "rejected"]);

export const adminRoleEnum = pgEnum("admin_role", ["admin", "reviewer"]);

export const launchStatusEnum = pgEnum("launch_status", ["prepared", "confirmed", "failed", "expired"]);

/* ------------------------------------------------------------------ */
/* Identity & auth                                                     */
/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
  wallet: text().primaryKey(),
  createdAt: tz().notNull().defaultNow(),
  lastSeenAt: tz(),
  isBanned: boolean().notNull().default(false),
  banReason: text(),
});

export const authNonces = pgTable(
  "auth_nonces",
  {
    nonce: text().primaryKey(),
    wallet: text().notNull(),
    purpose: text().notNull().default("sign_in"), // sign_in | claim | launch
    message: text().notNull(),
    createdAt: tz().notNull().defaultNow(),
    expiresAt: tz().notNull(),
    usedAt: tz(),
  },
  (t) => [index("auth_nonces_expires_idx").on(t.expiresAt)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid().primaryKey().defaultRandom(),
    tokenHash: text().notNull().unique(),
    wallet: text()
      .notNull()
      .references(() => users.wallet),
    createdAt: tz().notNull().defaultNow(),
    expiresAt: tz().notNull(),
    revokedAt: tz(),
    ipHash: text(),
    userAgent: text(),
  },
  (t) => [index("sessions_wallet_idx").on(t.wallet)],
);

export const admins = pgTable("admins", {
  wallet: text().primaryKey(),
  role: adminRoleEnum().notNull().default("reviewer"),
  addedBy: text().notNull(),
  createdAt: tz().notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Tokens & market data                                                */
/* ------------------------------------------------------------------ */

export type TokenLinks = {
  website?: string;
  x?: string;
  telegram?: string;
  discord?: string;
};

export const tokens = pgTable(
  "tokens",
  {
    id: uuid().primaryKey().defaultRandom(),
    mint: text().notNull().unique(),
    name: text().notNull(),
    symbol: text().notNull(),
    description: text().notNull().default(""),
    imageUrl: text(),
    metadataUri: text(),
    links: jsonb().$type<TokenLinks>().notNull().default({}),
    deployerWallet: text()
      .notNull()
      .references(() => users.wallet),
    launchProvider: text().notNull(),
    isSimulated: boolean().notNull().default(false),
    poolAddress: text(),
    launchSignature: text(),
    decimals: smallint().notNull().default(6),
    totalSupply: doublePrecision().notNull(),
    launchedAt: tz().notNull(),
    // Latest market snapshot, maintained by the price worker.
    priceUsd: doublePrecision().notNull().default(0),
    marketCapUsd: doublePrecision().notNull().default(0),
    volume24hUsd: doublePrecision("volume_24h_usd").notNull().default(0),
    priceChange24hPct: doublePrecision("price_change_24h_pct").notNull().default(0),
    marketDataSource: text(),
    marketDataUpdatedAt: tz(),
    createdAt: tz().notNull().defaultNow(),
  },
  (t) => [
    index("tokens_symbol_idx").on(t.symbol),
    index("tokens_launched_idx").on(t.launchedAt),
    index("tokens_deployer_idx").on(t.deployerWallet),
  ],
);

/** Raw price observations used for TWAP reference market caps. */
export const priceSamples = pgTable(
  "price_samples",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    tokenId: uuid()
      .notNull()
      .references(() => tokens.id, { onDelete: "cascade" }),
    priceUsd: doublePrecision().notNull(),
    supply: doublePrecision().notNull(),
    source: text().notNull(),
    sampledAt: tz().notNull(),
  },
  (t) => [index("price_samples_token_time_idx").on(t.tokenId, t.sampledAt)],
);

/** 5-minute OHLCV buckets used for charts. */
export const marketCandles = pgTable(
  "market_candles",
  {
    tokenId: uuid()
      .notNull()
      .references(() => tokens.id, { onDelete: "cascade" }),
    bucketStart: tz().notNull(),
    open: doublePrecision().notNull(),
    high: doublePrecision().notNull(),
    low: doublePrecision().notNull(),
    close: doublePrecision().notNull(),
    volumeUsd: doublePrecision().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tokenId, t.bucketStart] })],
);

/* ------------------------------------------------------------------ */
/* Competitions & submissions                                          */
/* ------------------------------------------------------------------ */

export type RewardCurvePoint = { marketCapUsd: number; rewardBps: number };
export type RewardCurve = {
  interpolation: "linear" | "log" | "step";
  points: RewardCurvePoint[];
};

export const competitions = pgTable(
  "competitions",
  {
    id: uuid().primaryKey().defaultRandom(),
    tokenId: uuid()
      .notNull()
      .unique()
      .references(() => tokens.id),
    status: competitionStatusEnum().notNull().default("active"),
    payoutIntervalHours: smallint().notNull(),
    minEligibleViews: integer().notNull(),
    rewardCurve: jsonb().$type<RewardCurve>().notNull(),
    rulesConfigVersion: integer().notNull(),
    startsAt: tz().notNull(),
    nextCheckpointAt: tz().notNull(),
    pausedAt: tz(),
    pausedReason: text(),
    pausedBy: text(),
    endedAt: tz(),
    createdAt: tz().notNull().defaultNow(),
    updatedAt: tz().notNull().defaultNow(),
  },
  (t) => [index("competitions_next_checkpoint_idx").on(t.status, t.nextCheckpointAt)],
);

export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: uuid().primaryKey().defaultRandom(),
    wallet: text()
      .notNull()
      .references(() => users.wallet),
    platform: platformEnum().notNull(),
    platformAccountId: text().notNull(),
    handle: text().notNull(),
    accessTokenEnc: text(),
    refreshTokenEnc: text(),
    tokenExpiresAt: tz(),
    scopes: text(),
    verificationMethod: text().notNull(), // oauth | simulated
    verifiedAt: tz().notNull(),
    revokedAt: tz(),
    createdAt: tz().notNull().defaultNow(),
  },
  (t) => [
    // One live link per platform account: the same TikTok/YouTube/... account
    // can never be attached to two wallets at the same time.
    uniqueIndex("social_accounts_live_uq")
      .on(t.platform, t.platformAccountId)
      .where(sql`revoked_at is null`),
    index("social_accounts_wallet_idx").on(t.wallet),
  ],
);

export const oauthStates = pgTable("oauth_states", {
  state: text().primaryKey(),
  wallet: text().notNull(),
  platform: platformEnum().notNull(),
  codeVerifier: text().notNull(),
  returnTo: text(),
  createdAt: tz().notNull().defaultNow(),
  expiresAt: tz().notNull(),
});

export type ScoreBreakdownJson = {
  model: string;
  configVersion: number;
  platform: string;
  inputs: { views: number; likes: number; comments: number };
  multipliers: { view: number; like: number; comment: number };
  adjusted: { views: number; likes: number; comments: number };
  capped: { likes: boolean; comments: boolean };
  components: { views: number; likes: number; comments: number };
  weights: { views: number; likes: number; comments: number };
  score: number;
};

export const videos = pgTable(
  "videos",
  {
    id: uuid().primaryKey().defaultRandom(),
    competitionId: uuid()
      .notNull()
      .references(() => competitions.id),
    creatorWallet: text()
      .notNull()
      .references(() => users.wallet),
    platform: platformEnum().notNull(),
    submittedUrl: text().notNull(),
    canonicalUrl: text().notNull(),
    platformVideoId: text().notNull(),
    authorAccountId: text(),
    authorHandle: text(),
    socialAccountId: uuid().references(() => socialAccounts.id),
    title: text(),
    /** Caption / title / description as last returned by the platform (checked for the contract address). */
    postText: text(),
    thumbnailUrl: text(),
    contentFingerprint: text(),
    publishedAt: tz().notNull(),
    publishedAtSource: text().notNull(),
    submittedAt: tz().notNull().defaultNow(),
    views: count().notNull().default(0),
    likes: count().notNull().default(0),
    comments: count().notNull().default(0),
    shares: count().notNull().default(0),
    metricsUpdatedAt: tz(),
    metricsSource: text(),
    viralScore: doublePrecision().notNull().default(0),
    scoreBreakdown: jsonb().$type<ScoreBreakdownJson>(),
    scoreConfigVersion: integer(),
    status: videoStatusEnum().notNull().default("under_review"),
    statusReason: text(),
    riskScore: smallint().notNull().default(0),
    reviewedBy: text(),
    reviewedAt: tz(),
    reviewNote: text(),
    submitIpHash: text(),
    isSimulated: boolean().notNull().default(false),
  },
  (t) => [
    // A video can only ever be entered once, across all competitions,
    // regardless of its later status. Rejected rows are kept so a
    // previously rejected video cannot be resubmitted.
    uniqueIndex("videos_platform_video_uq").on(t.platform, t.platformVideoId),
    index("videos_competition_score_idx").on(t.competitionId, t.viralScore),
    index("videos_creator_idx").on(t.creatorWallet),
    index("videos_fingerprint_idx").on(t.contentFingerprint),
    index("videos_status_idx").on(t.status),
  ],
);

export const metricSnapshots = pgTable(
  "metric_snapshots",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    videoId: uuid()
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    capturedAt: tz().notNull().defaultNow(),
    views: count().notNull(),
    likes: count().notNull(),
    comments: count().notNull(),
    shares: count().notNull().default(0),
    source: text().notNull(),
  },
  (t) => [index("metric_snapshots_video_time_idx").on(t.videoId, t.capturedAt)],
);

export const fraudFlags = pgTable(
  "fraud_flags",
  {
    id: uuid().primaryKey().defaultRandom(),
    videoId: uuid()
      .notNull()
      .references(() => videos.id),
    creatorWallet: text().notNull(),
    signal: fraudSignalEnum().notNull(),
    severity: flagSeverityEnum().notNull(),
    summary: text().notNull(),
    evidence: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    status: flagStatusEnum().notNull().default("open"),
    createdAt: tz().notNull().defaultNow(),
    resolvedAt: tz(),
    resolvedBy: text(),
    resolutionNote: text(),
  },
  (t) => [
    uniqueIndex("fraud_flags_open_uq")
      .on(t.videoId, t.signal)
      .where(sql`status = 'open'`),
    index("fraud_flags_status_idx").on(t.status, t.createdAt),
    index("fraud_flags_video_idx").on(t.videoId),
  ],
);

/* ------------------------------------------------------------------ */
/* Fees, checkpoints & payouts                                         */
/* ------------------------------------------------------------------ */

export const checkpoints = pgTable(
  "checkpoints",
  {
    id: uuid().primaryKey().defaultRandom(),
    competitionId: uuid()
      .notNull()
      .references(() => competitions.id),
    scheduledAt: tz().notNull(),
    status: checkpointStatusEnum().notNull().default("processing"),
    startedAt: tz().notNull().defaultNow(),
    completedAt: tz(),
    feesInWindowLamports: lamports().notNull().default(0),
    rewardBps: integer(),
    rewardLamports: lamports().notNull().default(0),
    retainedLamports: lamports().notNull().default(0),
    referenceMarketCapUsd: doublePrecision(),
    twapPriceUsd: doublePrecision(),
    referenceSupply: doublePrecision(),
    priceSampleCount: integer(),
    priceWindowStart: tz(),
    priceWindowEnd: tz(),
    winnerVideoId: uuid().references(() => videos.id),
    winnerWallet: text(),
    winnerScore: doublePrecision(),
    winnerViews: count(),
    leaderboardSnapshot: jsonb().$type<unknown[]>(),
    configSnapshot: jsonb().$type<Record<string, unknown>>(),
    note: text(),
  },
  (t) => [
    // Idempotency anchor: one checkpoint per competition per scheduled time.
    uniqueIndex("checkpoints_competition_scheduled_uq").on(t.competitionId, t.scheduledAt),
  ],
);

export const feeEvents = pgTable(
  "fee_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    tokenId: uuid()
      .notNull()
      .references(() => tokens.id),
    amountLamports: lamports().notNull(),
    source: text().notNull(),
    txSignature: text().unique(),
    status: feeStatusEnum().notNull().default("pending"),
    observedAt: tz().notNull().defaultNow(),
    confirmedAt: tz(),
    checkpointId: uuid().references(() => checkpoints.id),
    isSimulated: boolean().notNull().default(false),
  },
  (t) => [
    index("fee_events_token_idx").on(t.tokenId, t.status, t.checkpointId),
    index("fee_events_checkpoint_idx").on(t.checkpointId),
  ],
);

export const payouts = pgTable(
  "payouts",
  {
    id: uuid().primaryKey().defaultRandom(),
    checkpointId: uuid()
      .notNull()
      .unique()
      .references(() => checkpoints.id),
    competitionId: uuid()
      .notNull()
      .references(() => competitions.id),
    videoId: uuid()
      .notNull()
      .references(() => videos.id),
    recipientWallet: text().notNull(),
    amountLamports: lamports().notNull(),
    idempotencyKey: text().notNull().unique(),
    status: payoutStatusEnum().notNull().default("pending"),
    signature: text(),
    confirmedSlot: bigint({ mode: "number" }),
    confirmedAt: tz(),
    attemptCount: integer().notNull().default(0),
    autoAttemptBudget: integer().notNull().default(3),
    lastError: text(),
    resolution: text(), // automatic | manual_signature | claim
    isSimulated: boolean().notNull().default(false),
    createdAt: tz().notNull().defaultNow(),
    updatedAt: tz().notNull().defaultNow(),
  },
  (t) => [
    index("payouts_status_idx").on(t.status),
    index("payouts_recipient_idx").on(t.recipientWallet),
    index("payouts_competition_idx").on(t.competitionId, t.createdAt),
  ],
);

export const payoutAttempts = pgTable(
  "payout_attempts",
  {
    id: uuid().primaryKey().defaultRandom(),
    payoutId: uuid()
      .notNull()
      .references(() => payouts.id),
    attemptNo: integer().notNull(),
    signature: text().notNull().unique(),
    blockhash: text().notNull(),
    lastValidBlockHeight: bigint({ mode: "number" }).notNull(),
    /** Signed transaction (base64). Re-broadcasting the same bytes is idempotent. */
    rawTransaction: text().notNull(),
    status: attemptStatusEnum().notNull().default("built"),
    error: text(),
    triggeredBy: text().notNull().default("worker"),
    createdAt: tz().notNull().defaultNow(),
    sentAt: tz(),
    resolvedAt: tz(),
  },
  (t) => [uniqueIndex("payout_attempts_no_uq").on(t.payoutId, t.attemptNo)],
);

/* ------------------------------------------------------------------ */
/* Launch flow                                                         */
/* ------------------------------------------------------------------ */

export const launchRequests = pgTable("launch_requests", {
  id: uuid().primaryKey().defaultRandom(),
  deployerWallet: text().notNull(),
  payload: jsonb().$type<Record<string, unknown>>().notNull(),
  mint: text().notNull().unique(),
  provider: text().notNull(),
  intentMessage: text(),
  transaction: text(),
  status: launchStatusEnum().notNull().default("prepared"),
  tokenId: uuid(),
  error: text(),
  createdAt: tz().notNull().defaultNow(),
  expiresAt: tz().notNull(),
  confirmedAt: tz(),
});

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** File contents for STORAGE_PROVIDER=database (serverless hosts without a persistent disk). */
export const storedFiles = pgTable("stored_files", {
  key: text().primaryKey(),
  contentType: text().notNull(),
  data: bytea().notNull(),
  createdAt: tz().notNull().defaultNow(),
});

export const uploads = pgTable("uploads", {
  id: uuid().primaryKey().defaultRandom(),
  wallet: text().notNull(),
  storageKey: text().notNull(),
  url: text().notNull(),
  contentType: text().notNull(),
  bytes: integer().notNull(),
  createdAt: tz().notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Disputes                                                            */
/* ------------------------------------------------------------------ */

export const disputes = pgTable(
  "disputes",
  {
    id: uuid().primaryKey().defaultRandom(),
    wallet: text()
      .notNull()
      .references(() => users.wallet),
    category: text().notNull(),
    videoId: uuid().references(() => videos.id),
    payoutId: uuid().references(() => payouts.id),
    competitionId: uuid().references(() => competitions.id),
    message: text().notNull(),
    status: disputeStatusEnum().notNull().default("open"),
    resolution: text(),
    resolvedBy: text(),
    resolvedAt: tz(),
    createdAt: tz().notNull().defaultNow(),
  },
  (t) => [index("disputes_status_idx").on(t.status, t.createdAt), index("disputes_wallet_idx").on(t.wallet)],
);

/* ------------------------------------------------------------------ */
/* Configuration, audit & operations                                   */
/* ------------------------------------------------------------------ */

export const configEntries = pgTable("config_entries", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  version: integer().notNull(),
  updatedBy: text().notNull(),
  updatedAt: tz().notNull().defaultNow(),
});

export const configHistory = pgTable(
  "config_history",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    key: text().notNull(),
    version: integer().notNull(),
    value: jsonb().notNull(),
    updatedBy: text().notNull(),
    note: text(),
    createdAt: tz().notNull().defaultNow(),
  },
  (t) => [uniqueIndex("config_history_key_version_uq").on(t.key, t.version)],
);

/** Append-only. UPDATE and DELETE are blocked by a trigger (see migrations). */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    actor: text().notNull(),
    actorRole: text(),
    action: text().notNull(),
    targetType: text().notNull(),
    targetId: text(),
    before: jsonb(),
    after: jsonb(),
    note: text(),
    ipHash: text(),
    createdAt: tz().notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_created_idx").on(t.createdAt),
    index("audit_logs_target_idx").on(t.targetType, t.targetId),
  ],
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text().notNull(),
    windowStart: tz().notNull(),
    count: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

/** Small key/value store for worker cursors (e.g. last processed signature). */
/**
 * The platform wallet's activity: forwarding the treasury's part of each
 * deposit, and buying + burning the official coin with the rest.
 */
export const buybackKindEnum = pgEnum("buyback_kind", ["buyback", "treasury"]);
export const buybackEvents = pgTable(
  "buyback_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: buybackKindEnum().notNull(),
    /** SOL spent on the buy, or forwarded to the treasury. */
    lamports: lamports().notNull(),
    mint: text(),
    /** Tokens burned, in base units (u64 as text). */
    tokensBurned: text(),
    decimals: integer(),
    swapSignature: text().unique(),
    burnSignature: text(),
    transferSignature: text().unique(),
    createdAt: tz().notNull().defaultNow(),
  },
  (t) => [index("buyback_events_created_idx").on(t.kind, t.createdAt)],
);

export const workerState = pgTable("worker_state", {
  key: text().primaryKey(),
  value: jsonb().$type<Record<string, unknown>>().notNull(),
  updatedAt: tz().notNull().defaultNow(),
});

export const jobRuns = pgTable(
  "job_runs",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    job: text().notNull(),
    startedAt: tz().notNull().defaultNow(),
    finishedAt: tz(),
    status: text().notNull().default("running"),
    detail: jsonb().$type<Record<string, unknown>>(),
  },
  (t) => [index("job_runs_job_idx").on(t.job, t.startedAt)],
);

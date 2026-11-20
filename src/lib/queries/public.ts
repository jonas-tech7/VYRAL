/**
 * Read models for public pages and APIs. Aggregates are computed live from
 * source tables (no denormalised counters to drift).
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import type { RewardCurve } from "@/lib/db/schema";
import { showDemo } from "@/lib/env";
import type { Platform } from "@/lib/domain/platforms";
import { marketProvider } from "@/lib/providers/market";
import { eligibilityOf, type IneligibilityReason } from "@/lib/rewards/allocation";
import { rewardBpsForMarketCap } from "@/lib/rewards/curve";

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const d = (v: unknown) => (v ? new Date(v as string) : null);

/* ------------------------------ SOL price ------------------------------ */

let solCache: { at: number; value: number } | null = null;
export async function solUsd(): Promise<number> {
  if (solCache && Date.now() - solCache.at < 60_000) return solCache.value;
  try {
    const value = await marketProvider().solUsd();
    solCache = { at: Date.now(), value };
    return value;
  } catch {
    return solCache?.value ?? 0;
  }
}

/* ------------------------------ Platform stats ------------------------- */

export type PlatformStats = {
  tokensLaunched: number;
  tokensLaunched24h: number;
  feesGeneratedLamports: number;
  feesGenerated24hLamports: number;
  rewardsDistributedLamports: number;
  payoutsConfirmed: number;
  totalViews: number;
  videosSubmitted: number;
  solUsd: number;
  demo: boolean;
};

export async function getPlatformStats(): Promise<PlatformStats> {
  const res = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM tokens) AS tokens,
      (SELECT count(*) FROM tokens WHERE launched_at > now() - interval '24 hours') AS tokens_24h,
      (SELECT coalesce(sum(amount_lamports), 0) FROM fee_events WHERE status = 'confirmed') AS fees,
      (SELECT coalesce(sum(amount_lamports), 0) FROM fee_events WHERE status = 'confirmed' AND confirmed_at > now() - interval '24 hours') AS fees_24h,
      (SELECT coalesce(sum(amount_lamports), 0) FROM payouts WHERE status = 'confirmed') AS rewards,
      (SELECT count(*) FROM payouts WHERE status = 'confirmed') AS payouts,
      (SELECT coalesce(sum(views), 0) FROM videos WHERE status <> 'rejected') AS views,
      (SELECT count(*) FROM videos WHERE status <> 'rejected') AS videos
  `);
  const r = res.rows[0] as Record<string, unknown>;
  return {
    tokensLaunched: n(r.tokens),
    tokensLaunched24h: n(r.tokens_24h),
    feesGeneratedLamports: n(r.fees),
    feesGenerated24hLamports: n(r.fees_24h),
    rewardsDistributedLamports: n(r.rewards),
    payoutsConfirmed: n(r.payouts),
    totalViews: n(r.views),
    videosSubmitted: n(r.videos),
    solUsd: await solUsd(),
    demo: showDemo,
  };
}

/* ------------------------------ Competitions --------------------------- */

export const COMPETITION_SORTS = ["trending", "market_cap", "reward_pool", "views", "participants", "recent"] as const;
export type CompetitionSort = (typeof COMPETITION_SORTS)[number];

export type CompetitionListItem = {
  competitionId: string;
  status: "active" | "paused" | "ended";
  payoutIntervalHours: number;
  nextCheckpointAt: Date;
  minEligibleViews: number;
  tokenId: string;
  mint: string;
  name: string;
  symbol: string;
  imageUrl: string | null;
  priceUsd: number;
  marketCapUsd: number;
  volume24hUsd: number;
  priceChange24hPct: number;
  launchedAt: Date;
  isSimulated: boolean;
  totalViews: number;
  videoCount: number;
  creatorCount: number;
  topScore: number | null;
  submissions24h: number;
  unallocatedLamports: number;
  pendingFeesLamports: number;
  feesTotalLamports: number;
  rewardsPaidLamports: number;
  currentRewardBps: number;
  estimatedRewardLamports: number;
};

type AnySort = CompetitionSort | "volume" | "gainers";

const ORDER: Record<AnySort, SQL> = {
  trending: sql`(ln(1 + t.volume_24h_usd) + 2 * ln(1 + coalesce(v.subs_24h, 0)) + 0.5 * ln(1 + coalesce(v.total_views, 0))) DESC`,
  market_cap: sql`t.market_cap_usd DESC`,
  reward_pool: sql`coalesce(p.unallocated, 0) DESC`,
  views: sql`coalesce(v.total_views, 0) DESC`,
  participants: sql`coalesce(v.creator_count, 0) DESC`,
  recent: sql`t.launched_at DESC`,
  volume: sql`t.volume_24h_usd DESC`,
  gainers: sql`t.price_change_24h_pct DESC`,
};

function competitionBaseQuery(where: SQL, order: SQL, limit: number, offset: number) {
  return sql`
    WITH v AS (
      SELECT competition_id,
             coalesce(sum(views) FILTER (WHERE status <> 'rejected'), 0) AS total_views,
             count(*) FILTER (WHERE status <> 'rejected') AS video_count,
             count(DISTINCT creator_wallet) FILTER (WHERE status <> 'rejected') AS creator_count,
             max(viral_score) FILTER (WHERE status = 'verified') AS top_score,
             count(*) FILTER (WHERE submitted_at > now() - interval '24 hours' AND status <> 'rejected') AS subs_24h
      FROM videos GROUP BY competition_id
    ), p AS (
      SELECT token_id,
             coalesce(sum(amount_lamports) FILTER (WHERE status = 'confirmed' AND checkpoint_id IS NULL), 0) AS unallocated,
             coalesce(sum(amount_lamports) FILTER (WHERE status = 'pending'), 0) AS pending,
             coalesce(sum(amount_lamports) FILTER (WHERE status = 'confirmed'), 0) AS fees_total
      FROM fee_events GROUP BY token_id
    ), paid AS (
      SELECT competition_id, coalesce(sum(amount_lamports) FILTER (WHERE status = 'confirmed'), 0) AS paid
      FROM payouts GROUP BY competition_id
    )
    SELECT c.id AS competition_id, c.status, c.payout_interval_hours, c.next_checkpoint_at, c.min_eligible_views, c.reward_curve,
           t.id AS token_id, t.mint, t.name, t.symbol, t.image_url, t.price_usd, t.market_cap_usd, t.volume_24h_usd,
           t.price_change_24h_pct, t.launched_at, t.is_simulated,
           v.total_views, v.video_count, v.creator_count, v.top_score, v.subs_24h,
           p.unallocated, p.pending, p.fees_total, paid.paid
    FROM competitions c
    JOIN tokens t ON t.id = c.token_id
    LEFT JOIN v ON v.competition_id = c.id
    LEFT JOIN p ON p.token_id = t.id
    LEFT JOIN paid ON paid.competition_id = c.id
    WHERE ${where}
    ORDER BY ${order}, t.launched_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

function mapCompetition(r: Record<string, unknown>): CompetitionListItem {
  const curve = r.reward_curve as RewardCurve;
  const mc = n(r.market_cap_usd);
  const bps = rewardBpsForMarketCap(curve, mc);
  const unallocated = n(r.unallocated);
  return {
    competitionId: r.competition_id as string,
    status: r.status as CompetitionListItem["status"],
    payoutIntervalHours: n(r.payout_interval_hours),
    nextCheckpointAt: new Date(r.next_checkpoint_at as string),
    minEligibleViews: n(r.min_eligible_views),
    tokenId: r.token_id as string,
    mint: r.mint as string,
    name: r.name as string,
    symbol: r.symbol as string,
    imageUrl: (r.image_url as string) ?? null,
    priceUsd: n(r.price_usd),
    marketCapUsd: mc,
    volume24hUsd: n(r.volume_24h_usd),
    priceChange24hPct: n(r.price_change_24h_pct),
    launchedAt: new Date(r.launched_at as string),
    isSimulated: Boolean(r.is_simulated),
    totalViews: n(r.total_views),
    videoCount: n(r.video_count),
    creatorCount: n(r.creator_count),
    topScore: nn(r.top_score),
    submissions24h: n(r.subs_24h),
    unallocatedLamports: unallocated,
    pendingFeesLamports: n(r.pending),
    feesTotalLamports: n(r.fees_total),
    rewardsPaidLamports: n(r.paid),
    currentRewardBps: bps,
    estimatedRewardLamports: Math.floor((unallocated * bps) / 10_000),
  };
}

export async function listCompetitions(opts: { sort?: AnySort; q?: string; limit?: number; offset?: number; includeEnded?: boolean } = {}) {
  const sort = opts.sort ?? "trending";
  const conds: SQL[] = [opts.includeEnded ? sql`TRUE` : sql`c.status <> 'ended'`];
  if (opts.q) {
    const like = `%${opts.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    conds.push(sql`(t.name ILIKE ${like} OR t.symbol ILIKE ${like} OR t.mint = ${opts.q})`);
  }
  const where = sql.join(conds, sql` AND `);
  const res = await db.execute(competitionBaseQuery(where, ORDER[sort], opts.limit ?? 25, opts.offset ?? 0));
  const countRes = await db.execute(sql`SELECT count(*) AS n FROM competitions c JOIN tokens t ON t.id = c.token_id WHERE ${where}`);
  return { items: res.rows.map((r) => mapCompetition(r as Record<string, unknown>)), total: n((countRes.rows[0] as Record<string, unknown>).n) };
}

export async function getCompetitionSummaryByMint(mint: string): Promise<CompetitionListItem | null> {
  const res = await db.execute(competitionBaseQuery(sql`t.mint = ${mint}`, sql`c.id`, 1, 0));
  return res.rows[0] ? mapCompetition(res.rows[0] as Record<string, unknown>) : null;
}

/* ------------------------------ Competition detail --------------------- */

export type LeaderboardRow = {
  rank: number;
  id: string;
  platform: Platform;
  canonicalUrl: string;
  authorHandle: string | null;
  creatorWallet: string;
  views: number;
  likes: number;
  comments: number;
  viralScore: number;
  status: "verified" | "under_review" | "rejected";
  statusReason: string | null;
  publishedAt: Date;
  submittedAt: Date;
  openFlags: number;
  ineligibleReason: IneligibilityReason | null;
  wins: number;
  isSimulated: boolean;
};

export type PayoutRow = {
  id: string;
  status: string;
  amountLamports: number;
  recipientWallet: string;
  signature: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
  isSimulated: boolean;
  attemptCount: number;
  videoId: string;
  platform: Platform;
  canonicalUrl: string;
  authorHandle: string | null;
  scheduledAt: Date;
  winnerScore: number | null;
  referenceMarketCapUsd: number | null;
  rewardBps: number | null;
  feesInWindowLamports: number;
  mint?: string;
  symbol?: string;
  name?: string;
  imageUrl?: string | null;
};

export type CheckpointRow = {
  id: string;
  scheduledAt: Date;
  status: string;
  feesInWindowLamports: number;
  rewardBps: number | null;
  rewardLamports: number;
  referenceMarketCapUsd: number | null;
  note: string | null;
};

export async function getCompetitionDetail(mint: string) {
  const summary = await getCompetitionSummaryByMint(mint);
  if (!summary) return null;

  const tokenRes = await db.execute(sql`
    SELECT t.description, t.links, t.deployer_wallet, t.total_supply, t.decimals, t.launch_provider, t.pool_address,
           t.market_data_updated_at, t.market_data_source, c.paused_reason, c.starts_at, c.rules_config_version
    FROM tokens t JOIN competitions c ON c.token_id = t.id WHERE t.mint = ${mint}
  `);
  const tr = tokenRes.rows[0] as Record<string, unknown>;

  const lb = await db.execute(sql`
    SELECT v.id, v.platform, v.canonical_url, v.author_handle, v.creator_wallet, v.views, v.likes, v.comments, v.viral_score,
           v.status, v.status_reason, v.published_at, v.submitted_at, v.is_simulated, u.is_banned,
           (SELECT count(*) FROM fraud_flags f WHERE f.video_id = v.id AND f.status = 'open' AND f.severity <> 'low') AS open_flags,
           (SELECT count(*) FROM payouts p WHERE p.video_id = v.id AND p.status = 'confirmed') AS wins
    FROM videos v JOIN users u ON u.wallet = v.creator_wallet
    WHERE v.competition_id = ${summary.competitionId} AND v.status <> 'rejected'
    ORDER BY v.viral_score DESC, v.views DESC, v.submitted_at ASC, v.id ASC
    LIMIT 200
  `);
  const now = new Date();
  const rules = {
    minVerifiedViews: summary.minEligibleViews,
    launchedAt: summary.launchedAt,
    checkpointAt: now,
    excludedWallets: [] as string[],
  };
  const deployer = tr.deployer_wallet as string;
  const leaderboard: LeaderboardRow[] = lb.rows.map((row, i) => {
    const r = row as Record<string, unknown>;
    const entry = {
      id: r.id as string,
      creatorWallet: r.creator_wallet as string,
      viralScore: n(r.viral_score),
      views: n(r.views),
      submittedAt: new Date(r.submitted_at as string),
      publishedAt: new Date(r.published_at as string),
      status: r.status as LeaderboardRow["status"],
      openFlagCount: n(r.open_flags),
      creatorBanned: Boolean(r.is_banned),
    };
    let reason = eligibilityOf(entry, rules);
    if (!reason && entry.creatorWallet === deployer) reason = "excluded_wallet";
    return {
      rank: i + 1,
      id: entry.id,
      platform: r.platform as Platform,
      canonicalUrl: r.canonical_url as string,
      authorHandle: (r.author_handle as string) ?? null,
      creatorWallet: entry.creatorWallet,
      views: entry.views,
      likes: n(r.likes),
      comments: n(r.comments),
      viralScore: entry.viralScore,
      status: entry.status,
      statusReason: (r.status_reason as string) ?? null,
      publishedAt: entry.publishedAt,
      submittedAt: entry.submittedAt,
      openFlags: entry.openFlagCount,
      ineligibleReason: reason,
      wins: n(r.wins),
      isSimulated: Boolean(r.is_simulated),
    };
  });

  const payouts = await listPayouts(sql`p.competition_id = ${summary.competitionId}`, 50);

  const cps = await db.execute(sql`
    SELECT id, scheduled_at, status, fees_in_window_lamports, reward_bps, reward_lamports, reference_market_cap_usd, note
    FROM checkpoints WHERE competition_id = ${summary.competitionId}
    ORDER BY scheduled_at DESC LIMIT 12
  `);
  const checkpoints: CheckpointRow[] = cps.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      scheduledAt: new Date(r.scheduled_at as string),
      status: r.status as string,
      feesInWindowLamports: n(r.fees_in_window_lamports),
      rewardBps: nn(r.reward_bps),
      rewardLamports: n(r.reward_lamports),
      referenceMarketCapUsd: nn(r.reference_market_cap_usd),
      note: (r.note as string) ?? null,
    };
  });

  const retained = await db.execute(sql`
    SELECT coalesce(sum(retained_lamports), 0) AS retained FROM checkpoints
    WHERE competition_id = ${summary.competitionId} AND status = 'awarded'
  `);

  return {
    ...summary,
    description: (tr.description as string) ?? "",
    links: (tr.links as Record<string, string>) ?? {},
    deployerWallet: deployer,
    totalSupply: n(tr.total_supply),
    launchProvider: tr.launch_provider as string,
    poolAddress: (tr.pool_address as string) ?? null,
    pausedReason: (tr.paused_reason as string) ?? null,
    marketDataUpdatedAt: d(tr.market_data_updated_at),
    marketDataSource: (tr.market_data_source as string) ?? null,
    rulesConfigVersion: n(tr.rules_config_version),
    rewardCurve: (await db.execute(sql`SELECT reward_curve FROM competitions WHERE id = ${summary.competitionId}`)).rows[0]
      ?.reward_curve as RewardCurve,
    retainedLamports: n((retained.rows[0] as Record<string, unknown>).retained),
    leaderboard,
    payouts,
    checkpoints,
    solUsd: await solUsd(),
  };
}

export async function listPayouts(where: SQL, limit = 50): Promise<PayoutRow[]> {
  const res = await db.execute(sql`
    SELECT p.id, p.status, p.amount_lamports, p.recipient_wallet, p.signature, p.confirmed_at, p.created_at, p.is_simulated,
           p.attempt_count, p.video_id, v.platform, v.canonical_url, v.author_handle,
           cp.scheduled_at, cp.winner_score, cp.reference_market_cap_usd, cp.reward_bps, cp.fees_in_window_lamports,
           t.mint, t.symbol, t.name, t.image_url
    FROM payouts p
    JOIN checkpoints cp ON cp.id = p.checkpoint_id
    JOIN videos v ON v.id = p.video_id
    JOIN competitions c ON c.id = p.competition_id
    JOIN tokens t ON t.id = c.token_id
    WHERE ${where}
    ORDER BY cp.scheduled_at DESC
    LIMIT ${limit}
  `);
  return res.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      status: r.status as string,
      amountLamports: n(r.amount_lamports),
      recipientWallet: r.recipient_wallet as string,
      signature: (r.signature as string) ?? null,
      confirmedAt: d(r.confirmed_at),
      createdAt: new Date(r.created_at as string),
      isSimulated: Boolean(r.is_simulated),
      attemptCount: n(r.attempt_count),
      videoId: r.video_id as string,
      platform: r.platform as Platform,
      canonicalUrl: r.canonical_url as string,
      authorHandle: (r.author_handle as string) ?? null,
      scheduledAt: new Date(r.scheduled_at as string),
      winnerScore: nn(r.winner_score),
      referenceMarketCapUsd: nn(r.reference_market_cap_usd),
      rewardBps: nn(r.reward_bps),
      feesInWindowLamports: n(r.fees_in_window_lamports),
      mint: r.mint as string,
      symbol: r.symbol as string,
      name: r.name as string,
      imageUrl: (r.image_url as string) ?? null,
    };
  });
}

/* ------------------------------ Token / chart -------------------------- */

export const CHART_RANGES = { "1D": { hours: 24, bucketMin: 5 }, "1W": { hours: 168, bucketMin: 30 }, "1M": { hours: 720, bucketMin: 120 }, ALL: { hours: 24 * 365, bucketMin: 240 } } as const;
export type ChartRange = keyof typeof CHART_RANGES;

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

export async function getCandles(mint: string, range: ChartRange): Promise<Candle[]> {
  const cfg = CHART_RANGES[range];
  const bucketSec = cfg.bucketMin * 60;
  const res = await db.execute(sql`
    SELECT floor(extract(epoch FROM mc.bucket_start) / ${bucketSec}) * ${bucketSec} AS bucket,
           (array_agg(mc.open ORDER BY mc.bucket_start ASC))[1] AS open,
           max(mc.high) AS high, min(mc.low) AS low,
           (array_agg(mc.close ORDER BY mc.bucket_start DESC))[1] AS close,
           sum(mc.volume_usd) AS volume
    FROM market_candles mc JOIN tokens t ON t.id = mc.token_id
    WHERE t.mint = ${mint} AND mc.bucket_start > now() - make_interval(hours => ${cfg.hours})
    GROUP BY bucket ORDER BY bucket ASC
  `);
  return res.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return { time: n(r.bucket), open: n(r.open), high: n(r.high), low: n(r.low), close: n(r.close), volume: n(r.volume) };
  });
}

/* ------------------------------ Creators ------------------------------- */

export const CREATOR_SORTS = ["rewards", "views", "wins", "score"] as const;
export type CreatorSort = (typeof CREATOR_SORTS)[number];
export const CREATOR_RANGES = ["all", "30d", "7d"] as const;
export type CreatorRange = (typeof CREATOR_RANGES)[number];

export type CreatorRow = {
  wallet: string;
  rewardsLamports: number;
  verifiedViews: number;
  videos: number;
  wins: number;
  competitions: number;
  bestScore: number | null;
  handles: Array<{ platform: Platform; handle: string }>;
};

const CREATOR_ORDER: Record<CreatorSort, SQL> = {
  rewards: sql`rewards DESC, verified_views DESC`,
  views: sql`verified_views DESC`,
  wins: sql`wins DESC, rewards DESC`,
  score: sql`best_score DESC NULLS LAST`,
};

export async function listCreators(opts: { sort?: CreatorSort; range?: CreatorRange; limit?: number; offset?: number; wallet?: string } = {}) {
  const since = opts.range === "7d" ? sql`now() - interval '7 days'` : opts.range === "30d" ? sql`now() - interval '30 days'` : sql`'-infinity'::timestamptz`;
  const walletFilter = opts.wallet ? sql`AND u.wallet = ${opts.wallet}` : sql``;
  const res = await db.execute(sql`
    WITH vids AS (
      SELECT creator_wallet,
             coalesce(sum(views) FILTER (WHERE status = 'verified'), 0) AS verified_views,
             count(*) FILTER (WHERE status <> 'rejected') AS videos,
             count(DISTINCT competition_id) FILTER (WHERE status <> 'rejected') AS competitions,
             max(viral_score) FILTER (WHERE status = 'verified') AS best_score
      FROM videos WHERE submitted_at > ${since} GROUP BY creator_wallet
    ), pays AS (
      SELECT recipient_wallet,
             coalesce(sum(amount_lamports), 0) AS rewards,
             count(DISTINCT video_id) AS wins
      FROM payouts WHERE status = 'confirmed' AND confirmed_at > ${since} GROUP BY recipient_wallet
    )
    SELECT u.wallet, coalesce(p.rewards, 0) AS rewards, coalesce(v.verified_views, 0) AS verified_views,
           coalesce(v.videos, 0) AS videos, coalesce(p.wins, 0) AS wins, coalesce(v.competitions, 0) AS competitions, v.best_score,
           (SELECT json_agg(json_build_object('platform', s.platform, 'handle', s.handle))
              FROM social_accounts s WHERE s.wallet = u.wallet AND s.revoked_at IS NULL) AS handles
    FROM users u
    LEFT JOIN vids v ON v.creator_wallet = u.wallet
    LEFT JOIN pays p ON p.recipient_wallet = u.wallet
    WHERE (v.videos > 0 OR p.rewards > 0) AND NOT u.is_banned ${walletFilter}
    ORDER BY ${CREATOR_ORDER[opts.sort ?? "rewards"]}, u.wallet
    LIMIT ${opts.limit ?? 50} OFFSET ${opts.offset ?? 0}
  `);
  return res.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      wallet: r.wallet as string,
      rewardsLamports: n(r.rewards),
      verifiedViews: n(r.verified_views),
      videos: n(r.videos),
      wins: n(r.wins),
      competitions: n(r.competitions),
      bestScore: nn(r.best_score),
      handles: ((r.handles as Array<{ platform: Platform; handle: string }>) ?? []).filter(Boolean),
    } satisfies CreatorRow;
  });
}

export async function getCreatorProfile(wallet: string) {
  const [summary] = await listCreators({ wallet, range: "all" });
  const userRes = await db.execute(sql`SELECT created_at, is_banned FROM users WHERE wallet = ${wallet}`);
  const user = userRes.rows[0] as Record<string, unknown> | undefined;
  if (!user) return null;

  const rankRes = await db.execute(sql`
    SELECT rank FROM (
      SELECT recipient_wallet, rank() OVER (ORDER BY sum(amount_lamports) DESC) AS rank
      FROM payouts WHERE status = 'confirmed' GROUP BY recipient_wallet
    ) r WHERE recipient_wallet = ${wallet}
  `);

  const subs = await db.execute(sql`
    SELECT v.id, v.platform, v.canonical_url, v.author_handle, v.views, v.likes, v.comments, v.viral_score, v.status, v.status_reason,
           v.submitted_at, v.published_at, t.mint, t.symbol, t.name, t.image_url,
           (SELECT count(*) + 1 FROM videos o WHERE o.competition_id = v.competition_id AND o.status <> 'rejected' AND o.viral_score > v.viral_score) AS rank,
           (SELECT count(*) FROM payouts p WHERE p.video_id = v.id AND p.status = 'confirmed') AS wins
    FROM videos v JOIN competitions c ON c.id = v.competition_id JOIN tokens t ON t.id = c.token_id
    WHERE v.creator_wallet = ${wallet}
    ORDER BY v.submitted_at DESC LIMIT 100
  `);

  const history = await db.execute(sql`
    WITH days AS (
      SELECT generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') AS day
    )
    SELECT d.day,
           (SELECT coalesce(sum(amount_lamports), 0) FROM payouts p
             WHERE p.recipient_wallet = ${wallet} AND p.status = 'confirmed' AND p.confirmed_at < d.day + interval '1 day') AS cum_rewards,
           (SELECT coalesce(sum(m.max_views), 0) FROM (
              SELECT max(s.views) AS max_views FROM metric_snapshots s JOIN videos v ON v.id = s.video_id
              WHERE v.creator_wallet = ${wallet} AND v.status = 'verified' AND s.captured_at < d.day + interval '1 day'
              GROUP BY s.video_id) m) AS cum_views
    FROM days d ORDER BY d.day
  `);

  return {
    wallet,
    memberSince: new Date(user.created_at as string),
    isBanned: Boolean(user.is_banned),
    rank: rankRes.rows[0] ? n((rankRes.rows[0] as Record<string, unknown>).rank) : null,
    summary: summary ?? { wallet, rewardsLamports: 0, verifiedViews: 0, videos: 0, wins: 0, competitions: 0, bestScore: null, handles: [] },
    submissions: subs.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: r.id as string,
        platform: r.platform as Platform,
        canonicalUrl: r.canonical_url as string,
        authorHandle: (r.author_handle as string) ?? null,
        views: n(r.views),
        likes: n(r.likes),
        comments: n(r.comments),
        viralScore: n(r.viral_score),
        status: r.status as string,
        statusReason: (r.status_reason as string) ?? null,
        submittedAt: new Date(r.submitted_at as string),
        mint: r.mint as string,
        symbol: r.symbol as string,
        name: r.name as string,
        imageUrl: (r.image_url as string) ?? null,
        rank: n(r.rank),
        wins: n(r.wins),
      };
    }),
    payouts: await listPayouts(sql`p.recipient_wallet = ${wallet} AND p.status IN ('confirmed', 'requires_attention', 'submitted', 'pending')`, 100),
    history: history.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return { day: new Date(r.day as string), cumRewardsLamports: n(r.cum_rewards), cumViews: n(r.cum_views) };
    }),
    solUsd: await solUsd(),
  };
}

/* ------------------------------ Explore (tokens) ----------------------- */

export const TOKEN_SORTS = ["trending", "new", "market_cap", "volume", "gainers"] as const;
export type TokenSort = (typeof TOKEN_SORTS)[number];

export async function listTokens(opts: { sort?: TokenSort; q?: string; limit?: number; offset?: number } = {}) {
  const sortMap: Record<TokenSort, AnySort> = {
    trending: "trending",
    new: "recent",
    market_cap: "market_cap",
    volume: "volume",
    gainers: "gainers",
  };
  return listCompetitions({ sort: sortMap[opts.sort ?? "trending"], q: opts.q, limit: opts.limit ?? 50, offset: opts.offset, includeEnded: true });
}

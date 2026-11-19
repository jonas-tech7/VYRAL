/**
 * Fraud detection — pure detectors.
 *
 * Each detector looks at one kind of evidence and returns findings with a
 * severity. Findings never reject a video: they raise a risk score, and a
 * video is routed to human review when any finding is "high" or the summed
 * risk reaches the configured threshold. Rejection is always an
 * administrator decision (see lib/services/review.ts).
 */
import type { FraudConfig } from "@/lib/config/schemas";
import type { Platform } from "@/lib/domain/platforms";

export type FraudSignal =
  | "view_spike"
  | "abnormal_like_ratio"
  | "abnormal_comment_ratio"
  | "low_engagement_high_views"
  | "purchased_likes_pattern"
  | "purchased_views_pattern"
  | "uniform_growth_pattern"
  | "round_number_increments"
  | "metrics_regression"
  | "reused_content"
  | "duplicate_submission"
  | "submission_velocity"
  | "shared_social_account"
  | "shared_network"
  | "self_dealing";

export type Severity = "low" | "medium" | "high";

export type FraudFinding = {
  signal: FraudSignal;
  severity: Severity;
  summary: string;
  evidence: Record<string, unknown>;
};

export type Snapshot = { capturedAt: Date; views: number; likes: number; comments: number };

export type ContentMatch = {
  videoId: string;
  competitionId: string;
  creatorWallet: string;
  publishedAt: Date;
  distance: number;
};

export type FraudInput = {
  platform: Platform;
  creatorWallet: string;
  publishedAt: Date;
  current: { views: number; likes: number; comments: number };
  /** Ascending by capturedAt. */
  snapshots: Snapshot[];
  related: {
    launchedAt: Date;
    contentMatches: ContentMatch[];
    creatorSubmissions24h: number;
    socialAccountWalletCount: number;
    networkWalletCount: number;
    isTokenDeployer: boolean;
  };
};

export const SIGNAL_LABEL: Record<FraudSignal, string> = {
  view_spike: "Suspicious view spike",
  abnormal_like_ratio: "Unnatural like ratio",
  abnormal_comment_ratio: "Unnatural comment ratio",
  low_engagement_high_views: "High views, near-zero engagement",
  purchased_likes_pattern: "Possible purchased likes",
  purchased_views_pattern: "Possible purchased views",
  uniform_growth_pattern: "Repetitive, machine-like growth",
  round_number_increments: "Round-number metric increments",
  metrics_regression: "Metrics decreased (platform purge)",
  reused_content: "Reused content",
  duplicate_submission: "Duplicate submission",
  submission_velocity: "Unusual submission velocity",
  shared_social_account: "Social account shared across wallets",
  shared_network: "Multiple wallets from one network",
  self_dealing: "Creator is the token deployer",
};

const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

export function severityRank(s: Severity): number {
  return SEVERITY_RANK[s];
}

type Interval = {
  start: Date;
  end: Date;
  hours: number;
  dViews: number;
  dLikes: number;
  dComments: number;
  baseViews: number;
  baseLikes: number;
};

function toIntervals(snaps: Snapshot[]): Interval[] {
  const out: Interval[] = [];
  for (let i = 1; i < snaps.length; i++) {
    const a = snaps[i - 1];
    const b = snaps[i];
    const hours = (b.capturedAt.getTime() - a.capturedAt.getTime()) / 3_600_000;
    if (hours <= 0) continue;
    out.push({
      start: a.capturedAt,
      end: b.capturedAt,
      hours,
      dViews: b.views - a.views,
      dLikes: b.likes - a.likes,
      dComments: b.comments - a.comments,
      baseViews: a.views,
      baseLikes: a.likes,
    });
  }
  return out;
}

/** Keeps the last snapshot in each hour bucket, for longer-horizon detectors. */
function resampleHourly(snaps: Snapshot[]): Snapshot[] {
  const byHour = new Map<number, Snapshot>();
  for (const s of snaps) byHour.set(Math.floor(s.capturedAt.getTime() / 3_600_000), s);
  return [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
}

function medianOf(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const pct = (n: number) => `${(n * 100).toFixed(n < 0.01 ? 2 : 1)}%`;
const iso = (d: Date) => d.toISOString();

/* -------------------------- Ratio detectors --------------------------- */

function ratioDetectors(input: FraudInput, cfg: FraudConfig): FraudFinding[] {
  const out: FraudFinding[] = [];
  const { views, likes, comments } = input.current;
  if (views < cfg.minViewsForRatioChecks) return out;
  const bounds = cfg.ratioBounds[input.platform];
  const likeRate = likes / views;
  const commentRate = comments / views;

  if (likeRate > bounds.maxLikesPerView) {
    out.push({
      signal: "abnormal_like_ratio",
      severity: likeRate > 2 * bounds.maxLikesPerView ? "high" : "medium",
      summary: `Like rate ${pct(likeRate)} exceeds the ${pct(bounds.maxLikesPerView)} bound for this platform.`,
      evidence: { likeRate, bound: bounds.maxLikesPerView, views, likes },
    });
  }

  const commentPerLike = likes >= 50 ? comments / likes : 0;
  if (commentRate > bounds.maxCommentsPerView || commentPerLike > cfg.maxCommentsPerLike) {
    const severe = commentRate > 2 * bounds.maxCommentsPerView || commentPerLike > 2 * cfg.maxCommentsPerLike;
    out.push({
      signal: "abnormal_comment_ratio",
      severity: severe ? "high" : "medium",
      summary:
        commentRate > bounds.maxCommentsPerView
          ? `Comment rate ${pct(commentRate)} exceeds the ${pct(bounds.maxCommentsPerView)} bound.`
          : `Comments-per-like ratio ${commentPerLike.toFixed(2)} exceeds ${cfg.maxCommentsPerLike}.`,
      evidence: { commentRate, commentPerLike, views, likes, comments },
    });
  }

  if (views >= cfg.lowEngagementMinViews && likeRate < bounds.minLikesPerView) {
    out.push({
      signal: "low_engagement_high_views",
      severity: likeRate < bounds.minLikesPerView / 4 ? "high" : "medium",
      summary: `${views.toLocaleString("en-US")} views with a like rate of only ${pct(likeRate)}.`,
      evidence: { likeRate, bound: bounds.minLikesPerView, views, likes },
    });
  }
  return out;
}

/* ------------------------ Time-series detectors ----------------------- */

function seriesDetectors(input: FraudInput, cfg: FraudConfig): FraudFinding[] {
  const out: FraudFinding[] = [];
  const intervals = toIntervals(input.snapshots);
  if (intervals.length === 0) return out;

  // View spike: interval rate far above the video's own prior median rate.
  let spike: { interval: Interval; rate: number; baseline: number } | null = null;
  for (let i = cfg.spike.minPriorIntervals; i < intervals.length; i++) {
    const iv = intervals[i];
    if (iv.dViews < cfg.spike.minDeltaViews) continue;
    const prior = intervals.slice(Math.max(0, i - 24), i).map((p) => Math.max(p.dViews, 0) / p.hours);
    const baseline = medianOf(prior);
    const rate = iv.dViews / iv.hours;
    if (baseline > 0 && rate > cfg.spike.rateMultiple * baseline) {
      if (!spike || rate / baseline > spike.rate / spike.baseline) spike = { interval: iv, rate, baseline };
    }
  }

  // Engagement decoupling within single intervals.
  let viewsWithoutEngagement: { interval: Interval; intervalRate: number; baselineRate: number } | null = null;
  let likesWithoutViews: { interval: Interval; intervalRate: number; baselineRate: number } | null = null;
  for (const iv of intervals) {
    const baselineRate = iv.baseViews > 0 ? iv.baseLikes / iv.baseViews : 0;
    if (baselineRate <= 0) continue;
    if (iv.dViews >= cfg.decoupling.minDeltaViews) {
      const r = Math.max(iv.dLikes, 0) / iv.dViews;
      if (r < cfg.decoupling.likeRateCollapse * baselineRate) {
        if (!viewsWithoutEngagement || r < viewsWithoutEngagement.intervalRate)
          viewsWithoutEngagement = { interval: iv, intervalRate: r, baselineRate };
      }
    }
    if (iv.dLikes >= cfg.decoupling.minDeltaLikes) {
      const r = iv.dLikes / Math.max(iv.dViews, 1);
      if (r > cfg.decoupling.likeRateSurge * baselineRate) {
        if (!likesWithoutViews || r > likesWithoutViews.intervalRate)
          likesWithoutViews = { interval: iv, intervalRate: r, baselineRate };
      }
    }
  }

  if (spike) {
    out.push({
      signal: "view_spike",
      // A spike alone is common for organic virality: informational unless
      // engagement failed to follow (see purchased_views_pattern).
      severity: viewsWithoutEngagement ? "medium" : "low",
      summary: `View rate jumped to ${Math.round(spike.rate).toLocaleString("en-US")}/h, ${(spike.rate / spike.baseline).toFixed(1)}× the video's prior median.`,
      evidence: {
        intervalStart: iso(spike.interval.start),
        intervalEnd: iso(spike.interval.end),
        deltaViews: spike.interval.dViews,
        ratePerHour: spike.rate,
        baselinePerHour: spike.baseline,
      },
    });
  }

  if (viewsWithoutEngagement) {
    const iv = viewsWithoutEngagement.interval;
    out.push({
      signal: "purchased_views_pattern",
      severity: spike ? "high" : "medium",
      summary: `+${iv.dViews.toLocaleString("en-US")} views with a like rate of ${pct(viewsWithoutEngagement.intervalRate)} versus a baseline of ${pct(viewsWithoutEngagement.baselineRate)}.`,
      evidence: {
        intervalStart: iso(iv.start),
        intervalEnd: iso(iv.end),
        deltaViews: iv.dViews,
        deltaLikes: iv.dLikes,
        intervalLikeRate: viewsWithoutEngagement.intervalRate,
        baselineLikeRate: viewsWithoutEngagement.baselineRate,
      },
    });
  }

  if (likesWithoutViews) {
    const iv = likesWithoutViews.interval;
    out.push({
      signal: "purchased_likes_pattern",
      severity: iv.dLikes > Math.max(iv.dViews, 0) ? "high" : "medium",
      summary: `+${iv.dLikes.toLocaleString("en-US")} likes against +${Math.max(iv.dViews, 0).toLocaleString("en-US")} views in one interval.`,
      evidence: {
        intervalStart: iso(iv.start),
        intervalEnd: iso(iv.end),
        deltaViews: iv.dViews,
        deltaLikes: iv.dLikes,
        intervalLikeRate: likesWithoutViews.intervalRate,
        baselineLikeRate: likesWithoutViews.baselineRate,
      },
    });
  }

  // Round-number increments (bot panels deliver in fixed batches).
  const unit = cfg.roundIncrements.unit;
  const roundHits = intervals.filter(
    (iv) => (iv.dViews >= unit && iv.dViews % unit === 0) || (iv.dLikes >= unit && iv.dLikes % unit === 0),
  );
  if (roundHits.length >= cfg.roundIncrements.minOccurrences) {
    out.push({
      signal: "round_number_increments",
      severity: "medium",
      summary: `${roundHits.length} sync intervals grew by exact multiples of ${unit.toLocaleString("en-US")}.`,
      evidence: {
        occurrences: roundHits.slice(0, 10).map((iv) => ({ at: iso(iv.end), dViews: iv.dViews, dLikes: iv.dLikes })),
      },
    });
  }

  // Metrics regression: platforms remove inauthentic views/likes after the fact.
  let regression: { interval: Interval; metric: "views" | "likes"; dropPct: number } | null = null;
  for (const iv of intervals) {
    const prevViews = iv.baseViews;
    if (iv.dViews < 0 && prevViews > 0) {
      const drop = (-iv.dViews / prevViews) * 100;
      if (drop >= cfg.regression.minDropPct && -iv.dViews >= 50 && (!regression || drop > regression.dropPct))
        regression = { interval: iv, metric: "views", dropPct: drop };
    }
    if (iv.dLikes < 0 && iv.baseLikes > 0) {
      const drop = (-iv.dLikes / iv.baseLikes) * 100;
      if (drop >= cfg.regression.minDropPct && -iv.dLikes >= 50 && (!regression || drop > regression.dropPct))
        regression = { interval: iv, metric: "likes", dropPct: drop };
    }
  }
  if (regression) {
    out.push({
      signal: "metrics_regression",
      severity: regression.dropPct >= 15 ? "high" : "medium",
      summary: `${regression.metric === "views" ? "Views" : "Likes"} dropped ${regression.dropPct.toFixed(1)}% between syncs, consistent with the platform removing inauthentic activity.`,
      evidence: {
        metric: regression.metric,
        dropPct: regression.dropPct,
        intervalStart: iso(regression.interval.start),
        intervalEnd: iso(regression.interval.end),
      },
    });
  }

  // Uniform growth: organic attention decays and follows daily cycles;
  // a near-constant hourly rate over many hours suggests scripted delivery.
  const hourly = toIntervals(resampleHourly(input.snapshots)).filter(
    (iv) => iv.hours >= 0.5 && iv.dViews >= cfg.uniformGrowth.minDeltaViews,
  );
  const n = cfg.uniformGrowth.minIntervals;
  if (hourly.length >= n) {
    const recent = hourly.slice(-n).map((iv) => iv.dViews / iv.hours);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const sd = Math.sqrt(recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length);
    const cv = mean > 0 ? sd / mean : 1;
    if (cv < cfg.uniformGrowth.maxCoefficientOfVariation) {
      out.push({
        signal: "uniform_growth_pattern",
        severity: "medium",
        summary: `Views grew at a near-constant ${Math.round(mean).toLocaleString("en-US")}/h for ${n} consecutive hours (variation ${(cv * 100).toFixed(1)}%).`,
        evidence: { hours: n, meanPerHour: mean, coefficientOfVariation: cv },
      });
    }
  }

  return out;
}

/* --------------------- Content & identity detectors ------------------- */

function identityDetectors(input: FraudInput, cfg: FraudConfig): FraudFinding[] {
  const out: FraudFinding[] = [];
  const r = input.related;

  const preLaunch = r.contentMatches.filter((m) => m.publishedAt <= r.launchedAt);
  const otherCreators = r.contentMatches.filter((m) => m.creatorWallet !== input.creatorWallet);
  const sameCreator = r.contentMatches.filter((m) => m.creatorWallet === input.creatorWallet);

  if (preLaunch.length > 0 || otherCreators.length > 0) {
    const earlierOther = otherCreators.some((m) => m.publishedAt < input.publishedAt);
    out.push({
      signal: "reused_content",
      severity: preLaunch.length > 0 || earlierOther ? "high" : "medium",
      summary:
        preLaunch.length > 0
          ? "Visually matches content published before this token launched."
          : "Visually matches a video submitted by a different wallet.",
      evidence: {
        matches: [...preLaunch, ...otherCreators].slice(0, 5).map((m) => ({
          videoId: m.videoId,
          competitionId: m.competitionId,
          creatorWallet: m.creatorWallet,
          publishedAt: iso(m.publishedAt),
          distance: m.distance,
        })),
        maxDistance: cfg.fingerprint.maxHammingDistance,
      },
    });
  }

  if (sameCreator.length > 0) {
    out.push({
      signal: "duplicate_submission",
      severity: "medium",
      summary: `The same content was submitted ${sameCreator.length + 1} times by this wallet.`,
      evidence: { matches: sameCreator.slice(0, 5).map((m) => ({ videoId: m.videoId, distance: m.distance })) },
    });
  }

  if (r.creatorSubmissions24h > cfg.velocity.maxSubmissions24h) {
    out.push({
      signal: "submission_velocity",
      severity: r.creatorSubmissions24h > 2 * cfg.velocity.maxSubmissions24h ? "medium" : "low",
      summary: `${r.creatorSubmissions24h} submissions from this wallet in the last 24 hours.`,
      evidence: { submissions24h: r.creatorSubmissions24h, limit: cfg.velocity.maxSubmissions24h },
    });
  }

  if (r.socialAccountWalletCount > 1) {
    out.push({
      signal: "shared_social_account",
      severity: "medium",
      summary: `The author account has been linked to ${r.socialAccountWalletCount} different wallets.`,
      evidence: { wallets: r.socialAccountWalletCount },
    });
  }

  if (r.networkWalletCount >= cfg.sharedNetwork.minWallets) {
    out.push({
      signal: "shared_network",
      severity: r.networkWalletCount >= 2 * cfg.sharedNetwork.minWallets ? "medium" : "low",
      summary: `${r.networkWalletCount} wallets submitted to this competition from the same network.`,
      evidence: { wallets: r.networkWalletCount },
    });
  }

  if (r.isTokenDeployer) {
    out.push({
      signal: "self_dealing",
      severity: "medium",
      summary: "The submitting wallet deployed this token.",
      evidence: {},
    });
  }

  return out;
}

/* ------------------------------ Engine -------------------------------- */

export type FraudAssessment = {
  findings: FraudFinding[];
  riskScore: number;
  needsReview: boolean;
};

export function assessFraud(input: FraudInput, cfg: FraudConfig): FraudAssessment {
  const raw = [...ratioDetectors(input, cfg), ...seriesDetectors(input, cfg), ...identityDetectors(input, cfg)];

  // One finding per signal, keeping the most severe.
  const bySignal = new Map<FraudSignal, FraudFinding>();
  for (const f of raw) {
    const prev = bySignal.get(f.signal);
    if (!prev || severityRank(f.severity) > severityRank(prev.severity)) bySignal.set(f.signal, f);
  }
  const findings = [...bySignal.values()];
  return { findings, ...scoreFindings(findings, cfg) };
}

export function scoreFindings(
  findings: Array<Pick<FraudFinding, "severity">>,
  cfg: FraudConfig,
): { riskScore: number; needsReview: boolean } {
  const riskScore = Math.min(
    100,
    findings.reduce((sum, f) => sum + cfg.severityWeights[f.severity], 0),
  );
  // Medium/high findings always go to a human. Low-severity signals are
  // informational and only route a video to review once they accumulate.
  const needsReview = findings.some((f) => f.severity !== "low") || riskScore >= cfg.reviewRiskThreshold;
  return { riskScore, needsReview };
}

/* --------------------------- Fingerprints ----------------------------- */

/** Hamming distance between two equal-length hex perceptual hashes. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

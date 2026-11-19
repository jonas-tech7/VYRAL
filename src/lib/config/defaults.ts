/**
 * Initial configuration written as version 1 of each config key.
 *
 * These are STARTING POINTS, not final parameters:
 *  - Scoring weights (50/25/25), the 3h/6h intervals and the $20K→50% /
 *    $100K→25% curve come from the product specification; the payout minimum
 *    of 500 verified views is the product owner's decision.
 *  - Platform multipliers follow method "benchmark-sqrt-v1" (below): derived
 *    from published short-form studies, square-root dampened, neutral where
 *    sources disagree or no comparable data exists. Each value carries its
 *    citation, and calibration from VYRAL's own verified data replaces them
 *    once enough data exists (see lib/scoring/calibration.ts).
 *  - Fraud thresholds are conservative review triggers; they only route a
 *    video to human review and never reject on their own.
 */
import type { Platform } from "@/lib/domain/platforms";
import type { ConfigShapes, PlatformMultiplier } from "./schemas";

export const MULTIPLIER_METHOD = "benchmark-sqrt-v1";

/**
 * Platform multipliers — method "benchmark-sqrt-v1".
 *
 * TikTok is the baseline (1.00). For each metric:
 *   multiplier = √(TikTok average per video ÷ platform average per video)
 * using published cross-platform short-form studies. The square root
 * deliberately dampens the ratios: platform averages mix account sizes and
 * content types, so full ratios would over-correct. A like multiplier
 * therefore includes both how hard views are to get on a platform and how
 * often viewers like.
 */
export const BENCHMARK_MULTIPLIERS: Record<Platform, PlatformMultiplier> = {
  tiktok: {
    view: 1,
    like: 1,
    comment: 1,
    source: { kind: "default", note: `${MULTIPLIER_METHOD} baseline platform (1.00 by definition).` },
  },
  youtube: {
    view: 2.49,
    like: 3.53,
    comment: 2.24,
    source: {
      kind: "manual",
      note:
        `${MULTIPLIER_METHOD}. Views: Metricool, State of Short-Form Social Media 2026 (6.18M videos), avg 32,895 TikTok vs 5,321 Shorts. ` +
        "Likes: same study (secondary summary), avg 1,097 vs 88. Comments: Socialinsider, TikTok vs Reels vs Shorts 2026 (secondary summary), avg 50 vs 10.",
    },
  },
  instagram: {
    view: 1.19,
    like: 1.2,
    comment: 1,
    source: {
      kind: "manual",
      note:
        `${MULTIPLIER_METHOD}. Views: Metricool, State of Short-Form Social Media 2026 (6.18M videos), avg 32,895 TikTok vs 23,074 Reels. ` +
        "Likes: same study (secondary summary), avg 1,097 vs 765. Comments neutral: Metricool 2026 and Socialinsider 2026 disagree.",
    },
  },
  x: {
    view: 1,
    like: 1,
    comment: 1,
    source: {
      kind: "default",
      note: `${MULTIPLIER_METHOD}: neutral. No comparable published short-form benchmark (X counts post impressions as views).`,
    },
  },
};

const defaultRatioBounds = { maxLikesPerView: 0.35, maxCommentsPerView: 0.05, minLikesPerView: 0.002 };

export const DEFAULT_CONFIG: ConfigShapes = {
  scoring: {
    weights: { views: 50, likes: 25, comments: 25 },
    referenceCeilings: { views: 10_000_000, likes: 1_000_000, comments: 50_000 },
    engagementCaps: { likesPerView: 0.35, commentsPerView: 0.05 },
    multipliers: BENCHMARK_MULTIPLIERS,
  },
  eligibility: {
    minVerifiedViews: 500,
    requireLinkedAccount: true,
    maxSubmissionsPerCreatorPerCompetition: 5,
  },
  payouts: {
    allowedIntervalsHours: [3, 6],
    defaultIntervalHours: 6,
    minPayoutLamports: 5_000_000,
    twapWindowMinutes: 30,
    minPriceSamples: 10,
    maxPriceStalenessMinutes: 10,
    autoAttemptBudget: 3,
    excludeDeployerFromRewards: true,
  },
  reward_curve: {
    interpolation: "linear",
    points: [
      { marketCapUsd: 20_000, rewardBps: 5_000 },
      { marketCapUsd: 100_000, rewardBps: 2_500 },
    ],
  },
  fraud: {
    reviewRiskThreshold: 50,
    severityWeights: { low: 10, medium: 25, high: 60 },
    minViewsForRatioChecks: 1_000,
    lowEngagementMinViews: 50_000,
    maxCommentsPerLike: 0.6,
    ratioBounds: {
      tiktok: defaultRatioBounds,
      youtube: defaultRatioBounds,
      instagram: defaultRatioBounds,
      x: defaultRatioBounds,
    },
    spike: { rateMultiple: 8, minDeltaViews: 20_000, minPriorIntervals: 3 },
    decoupling: { minDeltaViews: 20_000, minDeltaLikes: 500, likeRateCollapse: 0.2, likeRateSurge: 4 },
    uniformGrowth: { minIntervals: 12, maxCoefficientOfVariation: 0.03, minDeltaViews: 200 },
    roundIncrements: { unit: 1_000, minOccurrences: 3 },
    regression: { minDropPct: 3 },
    fingerprint: { maxHammingDistance: 6 },
    velocity: { maxSubmissions24h: 10 },
    sharedNetwork: { minWallets: 3 },
  },
};

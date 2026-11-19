/**
 * Initial configuration written as version 1 of each config key.
 *
 * These are STARTING POINTS, not researched or final parameters:
 *  - Scoring weights (50/25/25), the 5,000-view eligibility threshold, the
 *    3h/6h intervals and the $20K→50% / $100K→25% curve come from the
 *    product specification.
 *  - Platform multipliers start neutral (1.0). They are meant to be set from
 *    calibration on verified historical data (see lib/scoring/calibration.ts)
 *    or from cited benchmarks entered by an administrator.
 *  - Fraud thresholds are conservative review triggers; they only route a
 *    video to human review and never reject on their own.
 */
import type { ConfigShapes } from "./schemas";

const neutral = {
  view: 1,
  like: 1,
  comment: 1,
  source: {
    kind: "default" as const,
    note: "Neutral starting value. Calibrate from verified data before relying on cross-platform comparisons.",
  },
};

const defaultRatioBounds = { maxLikesPerView: 0.35, maxCommentsPerView: 0.05, minLikesPerView: 0.002 };

export const DEFAULT_CONFIG: ConfigShapes = {
  scoring: {
    weights: { views: 50, likes: 25, comments: 25 },
    referenceCeilings: { views: 10_000_000, likes: 1_000_000, comments: 50_000 },
    engagementCaps: { likesPerView: 0.35, commentsPerView: 0.05 },
    multipliers: {
      tiktok: neutral,
      youtube: neutral,
      instagram: neutral,
      x: neutral,
    },
  },
  eligibility: {
    minVerifiedViews: 5_000,
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

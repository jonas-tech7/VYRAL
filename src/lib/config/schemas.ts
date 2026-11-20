/**
 * Protocol configuration shapes. Every value here is editable by
 * administrators, versioned in `config_history`, and recorded in the audit
 * log. Engines receive these objects as plain inputs.
 */
import { z } from "zod";
import { PLATFORMS } from "@/lib/domain/platforms";
import { isValidAddress } from "@/lib/solana/keys";

export const CONFIG_KEYS = ["scoring", "eligibility", "payouts", "reward_curve", "fraud", "platform_token"] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

/* --------------------------- Scoring ---------------------------------- */

export const multiplierSourceSchema = z.object({
  kind: z.enum(["default", "calibrated", "manual"]),
  /** Free-text provenance, e.g. a cited benchmark report. Required for manual values. */
  note: z.string().max(500).optional(),
  sampleSize: z.number().int().nonnegative().optional(),
  windowDays: z.number().int().positive().optional(),
  calibratedAt: z.string().optional(),
});
export type MultiplierSource = z.infer<typeof multiplierSourceSchema>;

export const platformMultiplierSchema = z.object({
  view: z.number().min(0.05).max(20),
  like: z.number().min(0.05).max(20),
  comment: z.number().min(0.05).max(20),
  source: multiplierSourceSchema,
});
export type PlatformMultiplier = z.infer<typeof platformMultiplierSchema>;

const multipliersShape = Object.fromEntries(PLATFORMS.map((p) => [p, platformMultiplierSchema])) as Record<
  (typeof PLATFORMS)[number],
  typeof platformMultiplierSchema
>;

export const scoringConfigSchema = z
  .object({
    weights: z.object({
      views: z.number().min(0).max(100),
      likes: z.number().min(0).max(100),
      comments: z.number().min(0).max(100),
    }),
    /** Metric values that map to a component score of 100 (log scale). */
    referenceCeilings: z.object({
      views: z.number().min(10),
      likes: z.number().min(10),
      comments: z.number().min(10),
    }),
    /** Engagement counted at most up to this ratio of (adjusted) views. */
    engagementCaps: z.object({
      likesPerView: z.number().min(0.001).max(1),
      commentsPerView: z.number().min(0.0001).max(1),
    }),
    multipliers: z.object(multipliersShape),
  })
  .superRefine((cfg, ctx) => {
    const sum = cfg.weights.views + cfg.weights.likes + cfg.weights.comments;
    if (Math.abs(sum - 100) > 1e-6) {
      ctx.addIssue({ code: "custom", path: ["weights"], message: `Weights must sum to 100 (got ${sum})` });
    }
    if (cfg.weights.views < Math.max(cfg.weights.likes, cfg.weights.comments)) {
      ctx.addIssue({
        code: "custom",
        path: ["weights", "views"],
        message: "Views must carry the largest weight",
      });
    }
    for (const p of PLATFORMS) {
      const m = cfg.multipliers[p];
      if (m.source.kind === "manual" && !m.source.note) {
        ctx.addIssue({
          code: "custom",
          path: ["multipliers", p, "source", "note"],
          message: "Manual multipliers require a source note (benchmark or rationale)",
        });
      }
    }
  });
export type ScoringConfig = z.infer<typeof scoringConfigSchema>;

/* --------------------------- Eligibility ------------------------------- */

export const eligibilityConfigSchema = z.object({
  minVerifiedViews: z.number().int().min(0).max(100_000_000),
  /** Require the video's author account to be linked (OAuth) to the submitting wallet. */
  requireLinkedAccount: z.boolean(),
  maxSubmissionsPerCreatorPerCompetition: z.number().int().min(1).max(100),
});
export type EligibilityConfig = z.infer<typeof eligibilityConfigSchema>;

/* --------------------------- Payouts ----------------------------------- */

export const payoutConfigSchema = z
  .object({
    allowedIntervalsHours: z.array(z.number().int().min(1).max(168)).min(1).max(6),
    defaultIntervalHours: z.number().int().min(1).max(168),
    /** Rewards below this amount roll over to the next checkpoint (dust protection). */
    minPayoutLamports: z.number().int().min(0),
    twapWindowMinutes: z.number().int().min(5).max(1440),
    minPriceSamples: z.number().int().min(1).max(1440),
    maxPriceStalenessMinutes: z.number().int().min(1).max(240),
    autoAttemptBudget: z.number().int().min(1).max(10),
    /** Exclude the token deployer's wallet from winning its own competition. */
    excludeDeployerFromRewards: z.boolean(),
  })
  .superRefine((cfg, ctx) => {
    if (!cfg.allowedIntervalsHours.includes(cfg.defaultIntervalHours)) {
      ctx.addIssue({
        code: "custom",
        path: ["defaultIntervalHours"],
        message: "Default interval must be one of the allowed intervals",
      });
    }
  });
export type PayoutConfig = z.infer<typeof payoutConfigSchema>;

/* --------------------------- Reward curve ------------------------------ */

export const rewardCurveSchema = z
  .object({
    interpolation: z.enum(["linear", "log", "step"]),
    points: z
      .array(
        z.object({
          marketCapUsd: z.number().min(0).max(1e13),
          rewardBps: z.number().int().min(0).max(10_000),
        }),
      )
      .min(1)
      .max(20),
  })
  .superRefine((curve, ctx) => {
    for (let i = 1; i < curve.points.length; i++) {
      if (curve.points[i].marketCapUsd <= curve.points[i - 1].marketCapUsd) {
        ctx.addIssue({
          code: "custom",
          path: ["points", i, "marketCapUsd"],
          message: "Market caps must be strictly increasing",
        });
      }
    }
    if (curve.interpolation === "log" && curve.points.some((p) => p.marketCapUsd <= 0)) {
      ctx.addIssue({ code: "custom", path: ["points"], message: "Log interpolation requires market caps > 0" });
    }
  });
export type RewardCurveConfig = z.infer<typeof rewardCurveSchema>;

/* --------------------------- Fraud ------------------------------------- */

const ratioBoundsSchema = z.object({
  maxLikesPerView: z.number().min(0.001).max(1),
  maxCommentsPerView: z.number().min(0.0001).max(1),
  minLikesPerView: z.number().min(0).max(0.5),
});

export const fraudConfigSchema = z.object({
  reviewRiskThreshold: z.number().int().min(1).max(100),
  severityWeights: z.object({
    low: z.number().int().min(0).max(100),
    medium: z.number().int().min(0).max(100),
    high: z.number().int().min(0).max(100),
  }),
  minViewsForRatioChecks: z.number().int().min(0),
  lowEngagementMinViews: z.number().int().min(0),
  maxCommentsPerLike: z.number().min(0.01).max(10),
  ratioBounds: z.object(
    Object.fromEntries(PLATFORMS.map((p) => [p, ratioBoundsSchema])) as Record<
      (typeof PLATFORMS)[number],
      typeof ratioBoundsSchema
    >,
  ),
  spike: z.object({
    rateMultiple: z.number().min(1.5).max(1000),
    minDeltaViews: z.number().int().min(0),
    minPriorIntervals: z.number().int().min(1).max(50),
  }),
  decoupling: z.object({
    minDeltaViews: z.number().int().min(0),
    minDeltaLikes: z.number().int().min(0),
    /** Interval like-rate below this fraction of the video's baseline => views without engagement. */
    likeRateCollapse: z.number().min(0).max(1),
    /** Interval like-rate above this multiple of the baseline => likes without views. */
    likeRateSurge: z.number().min(1).max(100),
  }),
  uniformGrowth: z.object({
    minIntervals: z.number().int().min(3).max(100),
    maxCoefficientOfVariation: z.number().min(0).max(1),
    minDeltaViews: z.number().int().min(0),
  }),
  roundIncrements: z.object({
    unit: z.number().int().min(10),
    minOccurrences: z.number().int().min(2),
  }),
  regression: z.object({ minDropPct: z.number().min(0.1).max(100) }),
  fingerprint: z.object({ maxHammingDistance: z.number().int().min(0).max(32) }),
  velocity: z.object({ maxSubmissions24h: z.number().int().min(1) }),
  sharedNetwork: z.object({ minWallets: z.number().int().min(2) }),
});
export type FraudConfig = z.infer<typeof fraudConfigSchema>;

/* --------------------------- Platform token ---------------------------- */

/** The official $VYRAL coin, shown in the site header once set. */
export const platformTokenSchema = z.object({
  mint: z
    .string()
    .trim()
    .nullable()
    .refine((v) => v === null || isValidAddress(v), "Enter a valid Solana address"),
  symbol: z.string().trim().min(1).max(10).default("VYRAL"),
});
export type PlatformTokenConfig = z.infer<typeof platformTokenSchema>;

export type ConfigShapes = {
  scoring: ScoringConfig;
  eligibility: EligibilityConfig;
  payouts: PayoutConfig;
  reward_curve: RewardCurveConfig;
  fraud: FraudConfig;
  platform_token: PlatformTokenConfig;
};

export const CONFIG_SCHEMAS: { [K in ConfigKey]: z.ZodType<ConfigShapes[K]> } = {
  scoring: scoringConfigSchema,
  eligibility: eligibilityConfigSchema,
  payouts: payoutConfigSchema,
  reward_curve: rewardCurveSchema,
  fraud: fraudConfigSchema,
  platform_token: platformTokenSchema,
};

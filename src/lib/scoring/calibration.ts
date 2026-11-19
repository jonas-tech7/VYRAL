/**
 * Platform multiplier calibration — method "median-rate-ratio-v1".
 *
 * Derives like/comment multipliers from VYRAL's own verified history instead
 * of assumed benchmarks:
 *
 *   rate_p      = median(likes / views) over verified videos on platform p
 *   reference   = median of rate_p across platforms with enough data
 *   raw_p       = reference / rate_p
 *   multiplier  = raw_p ^ (n / (n + K))      (geometric shrinkage toward 1)
 *
 * If likes are twice as common per view on TikTok as on the reference, the
 * TikTok like multiplier tends toward 0.5. Small samples are pulled toward
 * the neutral value 1.0, and results are clamped to [0.1, 10].
 *
 * View multipliers are NOT calibrated: there is no ground truth for "view
 * quality" in like/comment data. They remain an administrator decision and
 * should cite a source (platform view-counting definitions differ).
 *
 * Likes and comments are scored on their absolute counts, so the multiplier
 * that is applied combines both difficulties (see composeWithView):
 *   like multiplier = view multiplier × calibrated like-rate multiplier
 *
 * The output is a suggestion. Nothing changes until an administrator applies
 * it, which is versioned and audit-logged.
 */
import { PLATFORMS, type Platform } from "@/lib/domain/platforms";

export const CALIBRATION_METHOD = "median-rate-ratio-v1";

export type CalibrationSample = { platform: Platform; views: number; likes: number; comments: number };

export type CalibrationOptions = {
  minViews: number;
  minSamples: number;
  shrinkageK: number;
  windowDays: number;
  now?: Date;
};

export const DEFAULT_CALIBRATION_OPTIONS: CalibrationOptions = {
  minViews: 1_000,
  minSamples: 30,
  shrinkageK: 50,
  windowDays: 90,
};

export type MetricCalibration = {
  medianRate: number | null;
  raw: number | null;
  suggested: number | null;
};

export type PlatformCalibration = {
  platform: Platform;
  sampleSize: number;
  sufficient: boolean;
  like: MetricCalibration;
  comment: MetricCalibration;
};

export type CalibrationResult = {
  method: string;
  computedAt: string;
  options: CalibrationOptions;
  reference: { likeRate: number | null; commentRate: number | null; platforms: Platform[] };
  platforms: Record<Platform, PlatformCalibration>;
  usable: boolean;
};

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The multiplier actually applied to a like or comment count: how hard views
 * are to get on the platform × how often its viewers like or comment.
 */
export function composeWithView(viewMultiplier: number, rateMultiplier: number): number {
  return clamp(round3(viewMultiplier * rateMultiplier), 0.05, 20);
}

function shrink(raw: number, n: number, k: number): number {
  const weight = n / (n + k);
  return clamp(round3(Math.pow(raw, weight)), 0.1, 10);
}

export function calibrateMultipliers(
  samples: CalibrationSample[],
  options: CalibrationOptions = DEFAULT_CALIBRATION_OPTIONS,
): CalibrationResult {
  const byPlatform = new Map<Platform, CalibrationSample[]>();
  for (const p of PLATFORMS) byPlatform.set(p, []);
  for (const s of samples) {
    if (s.views >= options.minViews && s.views > 0) byPlatform.get(s.platform)?.push(s);
  }

  const likeMedians = new Map<Platform, number>();
  const commentMedians = new Map<Platform, number>();
  for (const p of PLATFORMS) {
    const list = byPlatform.get(p)!;
    if (list.length < options.minSamples) continue;
    const lr = median(list.map((s) => s.likes / s.views));
    const cr = median(list.map((s) => s.comments / s.views));
    if (lr !== null && lr > 0) likeMedians.set(p, lr);
    if (cr !== null && cr > 0) commentMedians.set(p, cr);
  }

  // A cross-platform reference needs at least two platforms with data.
  const likeRef = likeMedians.size >= 2 ? median([...likeMedians.values()]) : null;
  const commentRef = commentMedians.size >= 2 ? median([...commentMedians.values()]) : null;

  const platforms = {} as Record<Platform, PlatformCalibration>;
  for (const p of PLATFORMS) {
    const n = byPlatform.get(p)!.length;
    const lr = likeMedians.get(p) ?? null;
    const cr = commentMedians.get(p) ?? null;
    const likeRaw = likeRef !== null && lr !== null ? likeRef / lr : null;
    const commentRaw = commentRef !== null && cr !== null ? commentRef / cr : null;
    platforms[p] = {
      platform: p,
      sampleSize: n,
      sufficient: n >= options.minSamples && likeRaw !== null,
      like: {
        medianRate: lr,
        raw: likeRaw === null ? null : round3(likeRaw),
        suggested: likeRaw === null ? null : shrink(likeRaw, n, options.shrinkageK),
      },
      comment: {
        medianRate: cr,
        raw: commentRaw === null ? null : round3(commentRaw),
        suggested: commentRaw === null ? null : shrink(commentRaw, n, options.shrinkageK),
      },
    };
  }

  return {
    method: CALIBRATION_METHOD,
    computedAt: (options.now ?? new Date()).toISOString(),
    options,
    reference: {
      likeRate: likeRef,
      commentRate: commentRef,
      platforms: [...likeMedians.keys()],
    },
    platforms,
    usable: likeRef !== null,
  };
}

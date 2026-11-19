/**
 * VIRAL SCORE — model "viral-score-v1".
 *
 * Ranks submitted videos by attention, comparably across platforms.
 *
 *   1. Platform normalisation. Each raw metric is multiplied by the
 *      platform's multiplier, expressing it in "baseline units":
 *        adjusted = raw × multiplier[platform][metric]
 *      A like multiplier of 0.5 means one like on that platform is worth half
 *      a baseline like (e.g. because likes are twice as easy to obtain there).
 *
 *   2. Plausibility caps. Engagement is only counted up to a fixed ratio of
 *      adjusted views, so bought likes or comments cannot outrank reach:
 *        likes'    = min(likes_adj,    views_adj × capLikesPerView)
 *        comments' = min(comments_adj, views_adj × capCommentsPerView)
 *
 *   3. Logarithmic normalisation. Attention is heavy-tailed, so each
 *      component is mapped to a 0–100 scale against a reference ceiling:
 *        C(x) = 100 × log10(1 + x) / log10(1 + ceiling)
 *      Values above the ceiling score above 100 (no hard clamp, so ranking
 *      stays strictly monotonic).
 *
 *   4. Weighted sum (weights in percent, summing to 100):
 *        score = Σ weight_m × C_m / 100
 *
 * The function is pure and deterministic; every input that affected a score
 * is returned in the breakdown so payouts can be audited later.
 */
import type { ScoringConfig } from "@/lib/config/schemas";
import type { Platform } from "@/lib/domain/platforms";

export const SCORE_MODEL = "viral-score-v1";

export type VideoMetrics = { views: number; likes: number; comments: number };

export type ScoreBreakdown = {
  model: string;
  configVersion: number;
  platform: Platform;
  inputs: VideoMetrics;
  multipliers: { view: number; like: number; comment: number };
  adjusted: VideoMetrics;
  capped: { likes: boolean; comments: boolean };
  components: VideoMetrics;
  weights: VideoMetrics;
  score: number;
};

function sanitize(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function logComponent(value: number, ceiling: number): number {
  const v = sanitize(value);
  const c = Math.max(ceiling, 1);
  return (100 * Math.log10(1 + v)) / Math.log10(1 + c);
}

const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

export function computeViralScore(
  metrics: VideoMetrics,
  platform: Platform,
  config: ScoringConfig,
  configVersion: number,
): ScoreBreakdown {
  const m = config.multipliers[platform];
  const inputs = {
    views: sanitize(metrics.views),
    likes: sanitize(metrics.likes),
    comments: sanitize(metrics.comments),
  };

  const viewsAdj = inputs.views * m.view;
  const likesRaw = inputs.likes * m.like;
  const commentsRaw = inputs.comments * m.comment;

  const likeCap = viewsAdj * config.engagementCaps.likesPerView;
  const commentCap = viewsAdj * config.engagementCaps.commentsPerView;

  const likesAdj = Math.min(likesRaw, likeCap);
  const commentsAdj = Math.min(commentsRaw, commentCap);

  const components = {
    views: logComponent(viewsAdj, config.referenceCeilings.views),
    likes: logComponent(likesAdj, config.referenceCeilings.likes),
    comments: logComponent(commentsAdj, config.referenceCeilings.comments),
  };

  const w = config.weights;
  const score = (w.views * components.views + w.likes * components.likes + w.comments * components.comments) / 100;

  return {
    model: SCORE_MODEL,
    configVersion,
    platform,
    inputs,
    multipliers: { view: m.view, like: m.like, comment: m.comment },
    adjusted: { views: round(viewsAdj, 2), likes: round(likesAdj, 2), comments: round(commentsAdj, 2) },
    capped: { likes: likesRaw > likeCap, comments: commentsRaw > commentCap },
    components: {
      views: round(components.views, 4),
      likes: round(components.likes, 4),
      comments: round(components.comments, 4),
    },
    weights: { views: w.views, likes: w.likes, comments: w.comments },
    score: round(score, 4),
  };
}

export type RankableEntry = {
  id: string;
  viralScore: number;
  views: number;
  submittedAt: Date;
};

/**
 * Deterministic ranking: score desc, then views desc, then earlier
 * submission, then id (total order, so a checkpoint is reproducible).
 */
export function compareEntries(a: RankableEntry, b: RankableEntry): number {
  if (b.viralScore !== a.viralScore) return b.viralScore - a.viralScore;
  if (b.views !== a.views) return b.views - a.views;
  const t = a.submittedAt.getTime() - b.submittedAt.getTime();
  if (t !== 0) return t;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

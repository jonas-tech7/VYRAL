/**
 * DEVELOPMENT SIMULATION — synthetic video metrics for the mock social
 * provider and the demo seed. Deterministic in (platform, videoId,
 * publishedAt, t).
 *
 * The per-platform engagement ranges below are arbitrary simulation knobs
 * chosen to make cross-platform differences visible in development. They are
 * NOT benchmarks and must not be used to configure production multipliers.
 */
import type { Platform } from "@/lib/domain/platforms";
import { logUniform, unit } from "./random";

const HOUR = 3_600_000;

const SIM_ENGAGEMENT: Record<Platform, { like: [number, number]; comment: [number, number]; share: [number, number] }> = {
  tiktok: { like: [0.05, 0.12], comment: [0.001, 0.004], share: [0.002, 0.01] },
  youtube: { like: [0.02, 0.05], comment: [0.0006, 0.002], share: [0.0005, 0.002] },
  instagram: { like: [0.03, 0.08], comment: [0.0008, 0.003], share: [0.001, 0.006] },
  x: { like: [0.008, 0.025], comment: [0.0005, 0.0015], share: [0.001, 0.004] },
};

export type SimPattern = "organic" | "bought_views" | "bought_likes" | "drip" | "purge";

type Params = {
  pattern: SimPattern;
  finalViews: number;
  tauH: number;
  likeRate: number;
  commentRate: number;
  shareRate: number;
  diurnalAmp: number;
  phase: number;
  eventAtH: number;
  boostViews: number;
  boostLikes: number;
  purgeAtH: number;
  dripPerHour: number;
};

const lerp = (r: [number, number], u: number) => r[0] + (r[1] - r[0]) * u;

export function simParams(platform: Platform, videoId: string): Params {
  const key = `${platform}:${videoId}`;
  const u = (s: string) => unit(`${key}:${s}`);
  const pr = u("pattern");
  const pattern: SimPattern =
    pr < 0.04 ? "bought_views" : pr < 0.07 ? "bought_likes" : pr < 0.09 ? "drip" : pr < 0.11 ? "purge" : "organic";
  const e = SIM_ENGAGEMENT[platform];
  return {
    pattern,
    finalViews: logUniform(Math.pow(u("views"), 1.55), 900, 3_200_000),
    tauH: 6 + u("tau") * 58,
    likeRate: lerp(e.like, u("like")),
    commentRate: lerp(e.comment, u("comment")),
    shareRate: lerp(e.share, u("share")),
    diurnalAmp: 0.25 + u("diurnal") * 0.35,
    phase: u("phase") * Math.PI * 2,
    eventAtH: 4 + u("event") * 30,
    boostViews: (3 + Math.floor(u("boostV") * 13)) * 10_000,
    boostLikes: (4 + Math.floor(u("boostL") * 17)) * 1_000,
    purgeAtH: 8 + u("purge") * 14,
    dripPerHour: 700 + Math.floor(u("drip") * 2_600),
  };
}

/** Closed-form ∫0..T e^(-a/τ)(1 + A·sin(ωa + φ)) da / τ  → fraction of final views. */
function organicFraction(ageH: number, tauH: number, amp: number, phase: number): number {
  if (ageH <= 0) return 0;
  const k = 1 / tauH;
  const w = (2 * Math.PI) / 24;
  const base = 1 - Math.exp(-ageH * k);
  const prim = (a: number) => (Math.exp(-k * a) * (-k * Math.sin(w * a + phase) - w * Math.cos(w * a + phase))) / (k * k + w * w);
  const osc = (amp / tauH) * (prim(ageH) - prim(0));
  return Math.max(base + osc, 0);
}

export type SimMetrics = { views: number; likes: number; comments: number; shares: number };

export function simMetrics(platform: Platform, videoId: string, publishedAt: Date, t: Date): SimMetrics {
  const p = simParams(platform, videoId);
  const ageH = (t.getTime() - publishedAt.getTime()) / HOUR;
  if (ageH <= 0) return { views: 0, likes: 0, comments: 0, shares: 0 };

  if (p.pattern === "drip") {
    const views = Math.floor(p.dripPerHour * ageH);
    return {
      views,
      likes: Math.floor(views * p.likeRate * 0.6),
      comments: Math.floor(views * p.commentRate * 0.3),
      shares: Math.floor(views * p.shareRate * 0.3),
    };
  }

  const organicViews = Math.floor(p.finalViews * organicFraction(ageH, p.tauH, p.diurnalAmp, p.phase));
  let views = organicViews;
  let likes = Math.floor(organicViews * p.likeRate);
  const comments = Math.floor(organicViews * p.commentRate);
  const shares = Math.floor(organicViews * p.shareRate);

  if ((p.pattern === "bought_views" || p.pattern === "purge") && ageH >= p.eventAtH) {
    views += p.boostViews;
    if (p.pattern === "purge" && ageH >= p.eventAtH + p.purgeAtH) views -= Math.floor(p.boostViews * 0.7);
  }
  if (p.pattern === "bought_likes" && ageH >= p.eventAtH) likes += p.boostLikes;

  return { views, likes, comments, shares };
}

/** Deterministic 64-bit content fingerprint (hex) for simulated videos. */
export function simFingerprint(platform: Platform, videoId: string): string {
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += Math.floor(unit(`${platform}:${videoId}:fp${i}`) * 0x10000)
      .toString(16)
      .padStart(4, "0");
  }
  return out;
}

export function simHandle(platform: Platform, videoId: string): string {
  const a = ["nova", "mint", "orbit", "pixel", "drift", "lumen", "echo", "atlas", "vector", "signal", "kite", "ember"];
  const b = ["clips", "daily", "studio", "media", "labs", "reacts", "edits", "tv", "cuts", "frames"];
  const u1 = unit(`${platform}:${videoId}:h1`);
  const u2 = unit(`${platform}:${videoId}:h2`);
  const n = Math.floor(unit(`${platform}:${videoId}:h3`) * 90) + 10;
  return `${a[Math.floor(u1 * a.length)]}${b[Math.floor(u2 * b.length)]}${n}`;
}

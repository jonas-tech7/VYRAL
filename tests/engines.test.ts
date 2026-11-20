import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/lib/config/defaults";
import { rewardCurveSchema, scoringConfigSchema, type RewardCurveConfig, type ScoringConfig } from "@/lib/config/schemas";
import { assessFraud, hammingDistance, type FraudInput, type Snapshot } from "@/lib/fraud/detectors";
import { allocateFees, eligibilityOf, nextCheckpointAfter, selectWinner, type LeaderboardEntry } from "@/lib/rewards/allocation";
import { rewardBpsForMarketCap } from "@/lib/rewards/curve";
import { computeReferenceMarketCap } from "@/lib/rewards/reference-market-cap";
import { calibrateMultipliers, type CalibrationSample } from "@/lib/scoring/calibration";
import { computeViralScore } from "@/lib/scoring/viral-score";

const scoring = DEFAULT_CONFIG.scoring;

describe("Viral Score", () => {
  it("matches the documented worked example", () => {
    const s = computeViralScore({ views: 1_000_000, likes: 80_000, comments: 1_500 }, "tiktok", scoring, 1);
    // C_views = 100·log10(1e6+1)/log10(1e7+1) ≈ 85.71 ; C_likes ≈ 81.72 ; C_comments ≈ 67.59
    expect(s.components.views).toBeCloseTo(85.714, 2);
    expect(s.components.likes).toBeCloseTo(81.718, 2);
    expect(s.components.comments).toBeCloseTo(67.597, 2);
    expect(s.score).toBeCloseTo(80.18, 1);
  });

  it("is monotonic in every metric", () => {
    const base = computeViralScore({ views: 50_000, likes: 3_000, comments: 100 }, "youtube", scoring, 1).score;
    expect(computeViralScore({ views: 60_000, likes: 3_000, comments: 100 }, "youtube", scoring, 1).score).toBeGreaterThan(base);
    expect(computeViralScore({ views: 50_000, likes: 3_500, comments: 100 }, "youtube", scoring, 1).score).toBeGreaterThan(base);
    expect(computeViralScore({ views: 50_000, likes: 3_000, comments: 150 }, "youtube", scoring, 1).score).toBeGreaterThan(base);
  });

  it("applies platform-specific engagement multipliers", () => {
    const cfg: ScoringConfig = structuredClone(scoring);
    for (const p of ["tiktok", "youtube", "instagram", "x"] as const) cfg.multipliers[p] = { view: 1, like: 1, comment: 1, source: { kind: "default" } };
    cfg.multipliers.tiktok = { ...cfg.multipliers.tiktok, like: 0.5 };
    const metrics = { views: 100_000, likes: 10_000, comments: 300 };
    const tiktok = computeViralScore(metrics, "tiktok", cfg, 2);
    const youtube = computeViralScore(metrics, "youtube", cfg, 2);
    expect(tiktok.adjusted.likes).toBe(5_000);
    expect(youtube.adjusted.likes).toBe(10_000);
    expect(tiktok.score).toBeLessThan(youtube.score);
    expect(tiktok.components.views).toBe(youtube.components.views);
  });

  it("derives the default multipliers from the cited benchmarks (benchmark-sqrt-v1)", () => {
    const m = scoring.multipliers;
    expect(m.tiktok).toMatchObject({ view: 1, like: 1, comment: 1 });
    // X: labelled estimate (Instagram values), no comparable published benchmark.
    expect(m.x).toMatchObject({ view: m.instagram.view, like: m.instagram.like, comment: m.instagram.comment });
    expect(m.x.source.note).toMatch(/^Estimate/);
    // Metricool 2026 averages per video, square-root dampened.
    expect(m.youtube.view).toBeCloseTo(Math.sqrt(32_895 / 5_321), 2);
    expect(m.youtube.like).toBeCloseTo(Math.sqrt(1_097 / 88), 2);
    expect(m.instagram.view).toBeCloseTo(Math.sqrt(32_895 / 23_074), 2);
    expect(m.instagram.like).toBeCloseTo(Math.sqrt(1_097 / 765), 2);
    // Socialinsider 2026 comments per video.
    expect(m.youtube.comment).toBeCloseTo(Math.sqrt(50 / 10), 2);
    expect(scoringConfigSchema.safeParse(scoring).success).toBe(true);
  });

  it("narrows the gap between typical videos on different platforms", () => {
    const neutral: ScoringConfig = structuredClone(scoring);
    for (const p of ["tiktok", "youtube", "instagram", "x"] as const) neutral.multipliers[p] = { view: 1, like: 1, comment: 1, source: { kind: "default" } };
    const typicalTikTok = { views: 32_895, likes: 1_097, comments: 50 };
    const typicalShort = { views: 5_321, likes: 88, comments: 10 };
    const tt = computeViralScore(typicalTikTok, "tiktok", scoring, 1).score;
    const before = computeViralScore(typicalShort, "youtube", neutral, 1).score;
    const after = computeViralScore(typicalShort, "youtube", scoring, 1).score;
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThan(tt); // dampened: a typical Short still ranks below a typical TikTok
  });

  it("caps engagement relative to views so bought likes cannot outrank reach", () => {
    // TikTok is the baseline platform (all multipliers 1.00), so the cap is 35% of the raw views.
    const bought = computeViralScore({ views: 6_000, likes: 50_000, comments: 9_000 }, "tiktok", scoring, 1);
    expect(bought.capped.likes).toBe(true);
    expect(bought.capped.comments).toBe(true);
    expect(bought.adjusted.likes).toBeCloseTo(6_000 * 0.35, 5);
    const organic = computeViralScore({ views: 400_000, likes: 20_000, comments: 400 }, "tiktok", scoring, 1);
    expect(organic.score).toBeGreaterThan(bought.score);
  });

  it("handles zero and invalid metrics", () => {
    const s = computeViralScore({ views: 0, likes: Number.NaN, comments: -5 }, "instagram", scoring, 1);
    expect(s.score).toBe(0);
  });

  it("rejects weights that do not sum to 100 or let engagement outweigh views", () => {
    const bad = structuredClone(scoring);
    bad.weights = { views: 40, likes: 40, comments: 30 };
    expect(scoringConfigSchema.safeParse(bad).success).toBe(false);
    const engagementHeavy = structuredClone(scoring);
    engagementHeavy.weights = { views: 30, likes: 40, comments: 30 };
    expect(scoringConfigSchema.safeParse(engagementHeavy).success).toBe(false);
    expect(scoringConfigSchema.safeParse(scoring).success).toBe(true);
  });

  it("requires a source note for manual multipliers", () => {
    const cfg = structuredClone(scoring);
    cfg.multipliers.x = { view: 1, like: 2, comment: 1, source: { kind: "manual" } };
    expect(scoringConfigSchema.safeParse(cfg).success).toBe(false);
    cfg.multipliers.x.source.note = "Internal 90-day study, n=412";
    expect(scoringConfigSchema.safeParse(cfg).success).toBe(true);
  });
});

describe("Calibration", () => {
  function samples(platform: CalibrationSample["platform"], n: number, likeRate: number, commentRate: number) {
    return Array.from({ length: n }, (_, i) => {
      const views = 10_000 + i * 997;
      return { platform, views, likes: Math.round(views * likeRate), comments: Math.round(views * commentRate) };
    });
  }

  it("derives multipliers from median rate ratios", () => {
    const data = [
      ...samples("tiktok", 400, 0.1, 0.004),
      ...samples("youtube", 400, 0.04, 0.002),
      ...samples("instagram", 400, 0.06, 0.002),
      ...samples("x", 400, 0.02, 0.001),
    ];
    const r = calibrateMultipliers(data, { minViews: 1000, minSamples: 30, shrinkageK: 50, windowDays: 90 });
    expect(r.usable).toBe(true);
    expect(r.reference.likeRate).toBeCloseTo(0.05, 3); // median of 0.1, 0.04, 0.06, 0.02
    expect(r.platforms.tiktok.like.raw).toBeCloseTo(0.5, 2);
    expect(r.platforms.x.like.raw).toBeCloseTo(2.5, 2);
    // Shrinkage pulls toward 1 but large samples stay close to raw.
    expect(r.platforms.tiktok.like.suggested!).toBeGreaterThan(0.5);
    expect(r.platforms.tiktok.like.suggested!).toBeLessThan(0.56);
  });

  it("refuses to calibrate with insufficient data", () => {
    const r = calibrateMultipliers(samples("tiktok", 500, 0.1, 0.004));
    expect(r.usable).toBe(false);
    expect(r.platforms.tiktok.like.suggested).toBeNull();
  });
});

describe("Reward curve", () => {
  const curve: RewardCurveConfig = {
    interpolation: "linear",
    points: [
      { marketCapUsd: 20_000, rewardBps: 5_000 },
      { marketCapUsd: 100_000, rewardBps: 2_500 },
    ],
  };

  it("default pays out everything that reaches the vault (the 50% split is locked on-chain)", () => {
    expect(rewardBpsForMarketCap(DEFAULT_CONFIG.reward_curve, 0)).toBe(10_000);
    expect(rewardBpsForMarketCap(DEFAULT_CONFIG.reward_curve, 5_000_000)).toBe(10_000);
  });

  it("clamps at both ends", () => {
    expect(rewardBpsForMarketCap(curve, 5_000)).toBe(5_000);
    expect(rewardBpsForMarketCap(curve, 20_000)).toBe(5_000);
    expect(rewardBpsForMarketCap(curve, 100_000)).toBe(2_500);
    expect(rewardBpsForMarketCap(curve, 5_000_000)).toBe(2_500);
  });

  it("interpolates linearly, logarithmically, and in steps", () => {
    expect(rewardBpsForMarketCap(curve, 60_000)).toBe(3_750);
    expect(rewardBpsForMarketCap({ ...curve, interpolation: "log" }, 60_000)).toBe(3_293);
    expect(rewardBpsForMarketCap({ ...curve, interpolation: "step" }, 60_000)).toBe(5_000);
  });

  it("validates monotonic market caps", () => {
    expect(
      rewardCurveSchema.safeParse({
        interpolation: "linear",
        points: [
          { marketCapUsd: 100, rewardBps: 1 },
          { marketCapUsd: 100, rewardBps: 2 },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("Reference market cap (TWAP)", () => {
  const at = new Date("2026-01-01T12:00:00Z");
  const obs = (minAgo: number, price: number) => ({
    priceUsd: price,
    supply: 1_000_000_000,
    sampledAt: new Date(at.getTime() - minAgo * 60_000),
  });

  it("time-weights samples across the window", () => {
    // 20 min at $0.0001 (from 29.5 min ago), then 9.5 min at $0.0004 → (20·1 + 9.5·4)/29.5 × 1e-4
    const samples = [...Array.from({ length: 20 }, (_, i) => obs(30 - i - 0.5, 0.0001)), ...Array.from({ length: 10 }, (_, i) => obs(10 - i - 0.5, 0.0004))];
    const r = computeReferenceMarketCap(samples, at, { windowMinutes: 30, minSamples: 10, maxStalenessMinutes: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.marketCapUsd).toBeCloseTo(((20 * 0.0001 + 9.5 * 0.0004) / 29.5) * 1e9, 3);
  });

  it("is not moved by a single last-second spike", () => {
    const samples = [...Array.from({ length: 29 }, (_, i) => obs(30 - i - 0.5, 0.0001)), obs(0.05, 0.01)];
    const r = computeReferenceMarketCap(samples, at, { windowMinutes: 30, minSamples: 10, maxStalenessMinutes: 5 });
    expect(r.ok && r.marketCapUsd < 120_000).toBe(true);
  });

  it("skips on insufficient or stale data", () => {
    expect(computeReferenceMarketCap([obs(1, 1)], at, { windowMinutes: 30, minSamples: 10, maxStalenessMinutes: 5 }).ok).toBe(false);
    const stale = Array.from({ length: 12 }, (_, i) => obs(29 - i, 0.0001));
    const r = computeReferenceMarketCap(stale, at, { windowMinutes: 30, minSamples: 10, maxStalenessMinutes: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("stale_price");
  });
});

describe("Allocation & winner selection", () => {
  it("never allocates more than collected", () => {
    for (const [fees, bps] of [
      [1, 5000],
      [999_999_999, 3333],
      [123_456_789, 10_000],
      [0, 2500],
    ]) {
      const a = allocateFees(fees, bps);
      expect(a.rewardLamports + a.retainedLamports).toBe(fees);
      expect(a.rewardLamports).toBeLessThanOrEqual(fees);
    }
    expect(allocateFees(1_000_000_001, 5000).rewardLamports).toBe(500_000_000);
  });

  const rules = {
    minVerifiedViews: 5000,
    launchedAt: new Date("2026-01-01T00:00:00Z"),
    checkpointAt: new Date("2026-01-03T00:00:00Z"),
    excludedWallets: ["DEPLOYER"],
  };
  const entry = (over: Partial<LeaderboardEntry>): LeaderboardEntry => ({
    id: Math.random().toString(36),
    creatorWallet: "W",
    viralScore: 50,
    views: 10_000,
    submittedAt: new Date("2026-01-02T00:00:00Z"),
    publishedAt: new Date("2026-01-01T06:00:00Z"),
    status: "verified",
    openFlagCount: 0,
    creatorBanned: false,
    ...over,
  });

  it("selects the top eligible entry, skipping ineligible ones", () => {
    const winner = selectWinner(
      [
        entry({ id: "a", viralScore: 90, status: "under_review" }),
        entry({ id: "b", viralScore: 85, views: 4_999 }),
        entry({ id: "c", viralScore: 80, openFlagCount: 1 }),
        entry({ id: "d", viralScore: 79, creatorWallet: "DEPLOYER" }),
        entry({ id: "e", viralScore: 70 }),
        entry({ id: "f", viralScore: 60 }),
      ],
      rules,
    );
    expect(winner?.id).toBe("e");
  });

  it("rejects pre-launch publications and post-checkpoint submissions", () => {
    expect(eligibilityOf(entry({ publishedAt: new Date("2025-12-31T23:00:00Z") }), rules)).toBe("published_before_launch");
    expect(eligibilityOf(entry({ submittedAt: new Date("2026-01-03T00:00:01Z") }), rules)).toBe("submitted_after_checkpoint");
  });

  it("breaks score ties deterministically", () => {
    const w = selectWinner(
      [entry({ id: "x", viralScore: 70, views: 9_000 }), entry({ id: "y", viralScore: 70, views: 12_000 })],
      rules,
    );
    expect(w?.id).toBe("y");
  });

  it("schedules the next checkpoint on the competition's cadence", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    expect(nextCheckpointAfter(start, 6, new Date("2026-01-01T05:59:00Z")).toISOString()).toBe("2026-01-01T06:00:00.000Z");
    expect(nextCheckpointAfter(start, 6, new Date("2026-01-01T06:00:00Z")).toISOString()).toBe("2026-01-01T12:00:00.000Z");
    // Missed boundaries collapse into the next future one.
    expect(nextCheckpointAfter(start, 3, new Date("2026-01-02T07:30:00Z")).toISOString()).toBe("2026-01-02T09:00:00.000Z");
  });
});

describe("Fraud detection", () => {
  const cfg = DEFAULT_CONFIG.fraud;
  const t0 = new Date("2026-01-01T00:00:00Z").getTime();

  function series(fn: (h: number) => { views: number; likes: number; comments: number }, hours: number, stepMin = 30): Snapshot[] {
    const out: Snapshot[] = [];
    for (let m = 0; m <= hours * 60; m += stepMin) {
      const v = fn(m / 60);
      out.push({ capturedAt: new Date(t0 + m * 60_000), ...v });
    }
    return out;
  }

  const organic = (h: number) => {
    const views = Math.round(300_000 * (1 - Math.exp(-h / 20)) * (1 + 0.15 * Math.sin(h / 3.8)) ** 0.2);
    return { views, likes: Math.round(views * 0.07), comments: Math.round(views * 0.002) };
  };

  function input(snaps: Snapshot[], related: Partial<FraudInput["related"]> = {}): FraudInput {
    const last = snaps[snaps.length - 1];
    return {
      platform: "tiktok",
      creatorWallet: "CREATOR",
      publishedAt: new Date(t0),
      current: { views: last.views, likes: last.likes, comments: last.comments },
      snapshots: snaps,
      related: {
        launchedAt: new Date(t0 - 86_400_000),
        contentMatches: [],
        creatorSubmissions24h: 1,
        socialAccountWalletCount: 1,
        networkWalletCount: 1,
        isTokenDeployer: false,
        ...related,
      },
    };
  }

  it("does not flag organic growth", () => {
    const a = assessFraud(input(series(organic, 36)), cfg);
    expect(a.findings).toEqual([]);
    expect(a.needsReview).toBe(false);
  });

  it("flags bought views (spike without engagement) for review", () => {
    const bought = (h: number) => {
      const o = organic(h);
      return h >= 24 ? { ...o, views: o.views + 150_000 } : o;
    };
    const a = assessFraud(input(series(bought, 30)), cfg);
    const signals = a.findings.map((f) => f.signal);
    expect(signals).toContain("purchased_views_pattern");
    expect(signals).toContain("view_spike");
    expect(a.needsReview).toBe(true);
  });

  it("flags bought likes", () => {
    const bought = (h: number) => {
      const o = organic(h);
      return h >= 20 ? { ...o, likes: o.likes + 20_000 } : o;
    };
    const signals = assessFraud(input(series(bought, 30)), cfg).findings.map((f) => f.signal);
    expect(signals).toContain("purchased_likes_pattern");
  });

  it("flags machine-like constant delivery", () => {
    const drip = (h: number) => {
      const views = Math.round(2_000 * h);
      return { views, likes: Math.round(views * 0.05), comments: Math.round(views * 0.001) };
    };
    const signals = assessFraud(input(series(drip, 20)), cfg).findings.map((f) => f.signal);
    expect(signals).toContain("uniform_growth_pattern");
  });

  it("flags platform purges (metric regression)", () => {
    const purged = (h: number) => {
      const o = organic(h);
      return h >= 25 ? { ...o, views: Math.round(o.views * 0.8) } : o;
    };
    const f = assessFraud(input(series(purged, 30)), cfg).findings.find((x) => x.signal === "metrics_regression");
    expect(f?.severity).toBe("high");
  });

  it("routes any medium-severity signal to human review", () => {
    const a = assessFraud(input(series(organic, 36), { isTokenDeployer: true }), cfg);
    expect(a.findings.map((f) => f.signal)).toEqual(["self_dealing"]);
    expect(a.findings[0].severity).toBe("medium");
    expect(a.needsReview).toBe(true);
  });

  it("treats a single low-severity signal as informational", () => {
    const a = assessFraud(input(series(organic, 36), { creatorSubmissions24h: 12 }), cfg);
    expect(a.findings.map((f) => f.signal)).toEqual(["submission_velocity"]);
    expect(a.needsReview).toBe(false);
  });

  it("escalates re-uploads of pre-launch content", () => {
    const a = assessFraud(
      input(series(organic, 10), {
        contentMatches: [
          {
            videoId: "v0",
            competitionId: "c0",
            creatorWallet: "OTHER",
            publishedAt: new Date(t0 - 3 * 86_400_000),
            distance: 2,
          },
        ],
      }),
      cfg,
    );
    const f = a.findings.find((x) => x.signal === "reused_content");
    expect(f?.severity).toBe("high");
    expect(a.needsReview).toBe(true);
  });

  it("sends an entry back to review when the contract address is removed from the post", () => {
    const flat = series(organic, 36);
    const removed = assessFraud(input(flat, { mentionsContractAddress: false }), cfg);
    const f = removed.findings.find((x) => x.signal === "contract_address_removed");
    expect(f?.severity).toBe("medium");
    expect(removed.needsReview).toBe(true);
    for (const known of [true, null, undefined]) {
      const signals = assessFraud(input(flat, { mentionsContractAddress: known }), cfg).findings.map((x) => x.signal);
      expect(signals).not.toContain("contract_address_removed");
    }
  });

  it("computes hamming distance on hex hashes", () => {
    expect(hammingDistance("ff00", "ff00")).toBe(0);
    expect(hammingDistance("ff00", "ff01")).toBe(1);
    expect(hammingDistance("0000", "ffff")).toBe(16);
  });
});

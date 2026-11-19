/**
 * DEMO SEED — clearly-labelled demonstration data for development.
 *
 * Generates tokens, competitions, creators, videos with metric histories,
 * market candles, creator-fee events and a full checkpoint/payout history,
 * using the same deterministic simulation as the mock providers so the
 * background worker continues the series seamlessly. Every record that
 * carries an `is_simulated` flag is marked as simulated.
 *
 * The historical checkpoints are computed with the real engines (Viral
 * Score, eligibility rules, reward curve, allocation) — only the inputs are
 * simulated.
 *
 *   npm run db:seed                 (requires an empty database: run db:reset first)
 *   npm run db:seed -- --if-empty   (no-op when data exists; used by deploy builds)
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

type Platform = "tiktok" | "youtube" | "instagram" | "x";

async function main() {
  const { Keypair } = await import("@solana/web3.js");
  const bs58 = (await import("bs58")).default;
  const { sql } = await import("drizzle-orm");
  const { db, pool, schema } = await import("@/lib/db");
  const { ensureConfigDefaults, getAllConfig } = await import("@/lib/config/store");
  const { adminWalletsFromEnv } = await import("@/lib/env");
  const { computeViralScore } = await import("@/lib/scoring/viral-score");
  const { assessFraud } = await import("@/lib/fraud/detectors");
  const { allocateFees, selectWinner, eligibilityOf, rankEntries } = await import("@/lib/rewards/allocation");
  const { rewardBpsForMarketCap } = await import("@/lib/rewards/curve");
  const { prng } = await import("@/lib/sim/random");
  const { simCandle, simMarketCap, simPrice, simSolUsd, simVolume24h, simVolumeRate, SIM_CREATOR_FEE_RATE, SIM_TOTAL_SUPPLY } =
    await import("@/lib/sim/market-sim");
  const { simFingerprint, simHandle, simMetrics, simParams } = await import("@/lib/sim/social-sim");
  const { makeEmbeddedId } = await import("@/lib/providers/social/url");
  const { simulatedAccountId } = await import("@/lib/providers/social/mock");

  const [{ n: existing }] = (await db.execute(sql`SELECT count(*)::int AS n FROM tokens`)).rows as Array<{ n: number }>;
  if (Number(existing) > 0) {
    if (process.argv.includes("--if-empty")) {
      console.log("Database already contains data; skipping demo seed.");
      await pool.end();
      return;
    }
    console.error("Database already contains tokens. Run `npm run db:reset` to start from a clean database.");
    process.exit(1);
  }

  const rng = prng(20261119);
  const rand = () => rng();
  const randInt = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  const chance = (p: number) => rand() < p;
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
  const bytes = (n: number) => Uint8Array.from({ length: n }, () => Math.floor(rand() * 256));
  const wallet = () => Keypair.fromSeed(bytes(32)).publicKey.toBase58();
  const signature = () => bs58.encode(bytes(64));
  const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  const shortId = (len: number) => Array.from({ length: len }, () => ID_ALPHABET[Math.floor(rand() * 64)]).join("");

  const HOUR = 3_600_000;
  const now = new Date();
  const nowMs = now.getTime();

  console.log("· configuration");
  await ensureConfigDefaults();
  const cfg = await getAllConfig();
  const scoring = cfg.scoring.value;

  for (const w of adminWalletsFromEnv()) {
    await db.insert(schema.users).values({ wallet: w }).onConflictDoNothing();
    await db.insert(schema.admins).values({ wallet: w, role: "admin", addedBy: "seed:ADMIN_WALLETS" }).onConflictDoNothing();
  }

  /* --------------------------- Wallets & creators ------------------------ */

  const creators = Array.from({ length: 150 }, () => wallet());
  const deployers = Array.from({ length: 24 }, () => wallet());
  // Power-law activity: a few prolific creators, a long tail.
  const creatorWeight = creators.map((_, i) => 1 / Math.pow(i + 1, 0.85));
  const weightSum = creatorWeight.reduce((a, b) => a + b, 0);
  const pickCreator = () => {
    let r = rand() * weightSum;
    for (let i = 0; i < creators.length; i++) {
      r -= creatorWeight[i];
      if (r <= 0) return creators[i];
    }
    return creators[creators.length - 1];
  };

  const userRows = [...creators, ...deployers].map((w) => ({
    wallet: w,
    createdAt: new Date(nowMs - randInt(2, 30) * 24 * HOUR),
  }));
  await db.insert(schema.users).values(userRows).onConflictDoNothing();

  /* --------------------------------- Tokens ------------------------------ */

  const TOKENS: Array<[string, string, string]> = [
    ["Glacier Cat", "GLCAT", "A very cold cat with very warm holders."],
    ["Orbit Frog", "ORBF", "One small hop for a frog."],
    ["Velvet Goose", "VGOOSE", "Soft feathers, loud honks."],
    ["Turbo Snail", "TSNAIL", "Slow is smooth, smooth is turbo."],
    ["Saturn Sloth", "SLOTH", "Hanging from the rings since launch day."],
    ["Byte Badger", "BBADGR", "Digs through blocks so you don't have to."],
    ["Cosmic Crab", "CCRAB", "Sideways to the moon."],
    ["Quiet Lobster", "QLOB", "Says nothing. Pumps anyway."],
    ["Retro Raccoon", "RACC", "Trash panda with a CRT monitor."],
    ["Static Shark", "STSHRK", "Swims in signal noise."],
    ["Tidal Tortoise", "TIDE", "Patience, compounding."],
    ["Ember Owl", "EMBR", "Watches the chart all night."],
    ["Mango Mammoth", "MMAM", "Extinct? Not this one."],
    ["Hollow Heron", "HERON", "Stands on one leg, holds with both hands."],
    ["Gravity Goat", "GGOAT", "Climbs every wall it sees."],
    ["Polar Pigeon", "PIGEON", "Delivers messages from the north."],
    ["Copper Coyote", "COYO", "Runs off cliffs, never falls."],
    ["Drift Dolphin", "DDOLPH", "Rides every wave."],
    ["Signal Sparrow", "SPRW", "Tiny bird, loud feed."],
    ["Kelp Kingdom", "KKING", "An underwater monarchy."],
    ["Lunar Llama", "LUNLL", "Spits at gravity."],
    ["Paper Crane", "CRANE", "A thousand folds for luck."],
    ["Moss Moose", "MOOSE", "Slow forest energy."],
    ["Atlas Ant", "ATLAS", "Carries fifty times its market cap."],
    ["Fizz Fox", "FIZZ", "Clever, carbonated."],
    ["Nimbus Newt", "NEWT", "Small, damp, ascending."],
    ["Pebble Penguin", "PBBL", "Gives its best pebble to holders."],
    ["Marble Mink", "MINK", "Polished every block."],
    ["Thunder Toad", "TTOAD", "Croaks before the pump."],
    ["Cobalt Koi", "KOI", "Swims upstream by default."],
    ["Wired Walrus", "WLRS", "Tusks out, bids in."],
    ["Dune Dingo", "DINGO", "Desert runner."],
  ];

  type SeedToken = {
    id?: string;
    mint: string;
    name: string;
    symbol: string;
    description: string;
    deployer: string;
    launchedAt: Date;
    popularity: number;
    interval: number;
    competitionId?: string;
  };

  const tokens: SeedToken[] = TOKENS.map(([name, symbol, description], i) => {
    // Launch ages from ~2h to ~21 days; popularity decays with index (trending first).
    const ageH = i < 3 ? randInt(30, 140) : i < 6 ? randInt(3, 20) : randInt(20, 500);
    return {
      mint: wallet(),
      name,
      symbol,
      description,
      deployer: deployers[i % deployers.length],
      launchedAt: new Date(nowMs - ageH * HOUR - randInt(0, 59) * 60_000),
      popularity: Math.max(0.12, 1 / Math.pow(i + 1, 0.55)) * (0.7 + rand() * 0.6),
      interval: chance(0.3) ? 3 : 6,
    };
  });

  console.log(`· ${tokens.length} tokens`);
  for (const t of tokens) {
    const vol24 = simVolume24h(t.mint, t.launchedAt, now);
    const p = simPrice(t.mint, t.launchedAt, now);
    const dayAgo = new Date(Math.max(nowMs - 24 * HOUR, t.launchedAt.getTime()));
    const p24 = simPrice(t.mint, t.launchedAt, dayAgo);
    const [row] = await db
      .insert(schema.tokens)
      .values({
        mint: t.mint,
        name: t.name,
        symbol: t.symbol,
        description: t.description,
        links: chance(0.7) ? { x: `https://x.com/${t.symbol.toLowerCase()}onsol`, website: chance(0.5) ? `https://${t.symbol.toLowerCase()}.example` : undefined } : {},
        deployerWallet: t.deployer,
        launchProvider: "simulated",
        isSimulated: true,
        decimals: 6,
        totalSupply: SIM_TOTAL_SUPPLY,
        launchedAt: t.launchedAt,
        priceUsd: p,
        marketCapUsd: p * SIM_TOTAL_SUPPLY,
        volume24hUsd: vol24,
        priceChange24hPct: p24 > 0 ? ((p - p24) / p24) * 100 : 0,
        marketDataSource: "simulated",
        marketDataUpdatedAt: now,
        createdAt: t.launchedAt,
      })
      .returning({ id: schema.tokens.id });
    t.id = row.id;

    const intervalMs = t.interval * HOUR;
    const k = Math.floor((nowMs - t.launchedAt.getTime()) / intervalMs) + 1;
    const [comp] = await db
      .insert(schema.competitions)
      .values({
        tokenId: t.id,
        status: "active",
        payoutIntervalHours: t.interval,
        minEligibleViews: cfg.eligibility.value.minVerifiedViews,
        rewardCurve: cfg.reward_curve.value,
        rulesConfigVersion: cfg.reward_curve.version,
        startsAt: t.launchedAt,
        nextCheckpointAt: new Date(t.launchedAt.getTime() + k * intervalMs),
        createdAt: t.launchedAt,
      })
      .returning({ id: schema.competitions.id });
    t.competitionId = comp.id;
  }

  /* ------------------------------ Market data ---------------------------- */

  console.log("· market candles & price samples");
  for (const t of tokens) {
    const rows: Array<typeof schema.marketCandles.$inferInsert> = [];
    const start = Math.floor(t.launchedAt.getTime() / 300_000) * 300_000;
    for (let b = start; b <= nowMs; b += 300_000) {
      rows.push({ tokenId: t.id!, ...simCandle(t.mint, t.launchedAt, new Date(b)) });
    }
    for (let i = 0; i < rows.length; i += 2000) await db.insert(schema.marketCandles).values(rows.slice(i, i + 2000));

    const samples: Array<typeof schema.priceSamples.$inferInsert> = [];
    for (let m = 180; m >= 1; m--) {
      const at = new Date(nowMs - m * 60_000);
      if (at < t.launchedAt) continue;
      samples.push({ tokenId: t.id!, priceUsd: simPrice(t.mint, t.launchedAt, at), supply: SIM_TOTAL_SUPPLY, source: "simulated", sampledAt: at });
    }
    if (samples.length) await db.insert(schema.priceSamples).values(samples);
  }

  /* --------------------------------- Fees -------------------------------- */

  console.log("· creator fee events");
  type Fee = { id: string; amount: number; confirmedAt: Date; assigned: boolean };
  const feesByToken = new Map<string, Fee[]>();
  for (const t of tokens) {
    const rows: Array<typeof schema.feeEvents.$inferInsert> = [];
    for (let h = t.launchedAt.getTime(); h + HOUR <= nowMs - 5 * 60_000; h += HOUR) {
      let usd = 0;
      for (let m = 0; m < 60; m += 5) usd += (simVolumeRate(t.mint, t.launchedAt, new Date(h + m * 60_000 + 150_000)) * 5) / 60;
      const lamports = Math.floor(((usd * SIM_CREATOR_FEE_RATE) / simSolUsd(new Date(h))) * 1e9);
      if (lamports < 10_000) continue;
      const observed = new Date(h + HOUR);
      rows.push({
        tokenId: t.id!,
        amountLamports: lamports,
        source: "simulated",
        txSignature: signature(),
        status: "confirmed",
        observedAt: observed,
        confirmedAt: new Date(observed.getTime() + 40_000),
        isSimulated: true,
      });
    }
    const inserted: Fee[] = [];
    for (let i = 0; i < rows.length; i += 1000) {
      const r = await db
        .insert(schema.feeEvents)
        .values(rows.slice(i, i + 1000))
        .returning({ id: schema.feeEvents.id, amount: schema.feeEvents.amountLamports, confirmedAt: schema.feeEvents.confirmedAt });
      inserted.push(...r.map((x) => ({ id: x.id, amount: x.amount, confirmedAt: x.confirmedAt!, assigned: false })));
    }
    feesByToken.set(t.id!, inserted);
  }

  /* ------------------------------ Social & videos ------------------------ */

  console.log("· creators, linked accounts & videos");
  const handles = new Map<string, string>(); // `${wallet}:${platform}` -> handle
  const handleFor = (w: string, p: Platform) => {
    const key = `${w}:${p}`;
    if (!handles.has(key)) handles.set(key, simHandle(p, `${w.slice(0, 10)}`));
    return handles.get(key)!;
  };

  type SeedVideo = {
    id?: string;
    token: SeedToken;
    creator: string;
    platform: Platform;
    videoId: string;
    publishedAt: Date;
    submittedAt: Date;
    fingerprint: string;
    status: "verified" | "under_review" | "rejected";
    statusReason: string | null;
  };
  const videos: SeedVideo[] = [];
  const platformPick = (): Platform => {
    const r = rand();
    return r < 0.45 ? "tiktok" : r < 0.7 ? "youtube" : r < 0.9 ? "instagram" : "x";
  };

  for (const t of tokens) {
    const ageH = (nowMs - t.launchedAt.getTime()) / HOUR;
    const count = Math.max(2, Math.round(t.popularity * 34 * Math.min(1, 0.35 + ageH / 72) * (0.75 + rand() * 0.5)));
    const usedCreators = new Map<string, number>();
    for (let i = 0; i < count; i++) {
      let creator = pickCreator();
      if ((usedCreators.get(creator) ?? 0) >= 3) creator = pick(creators);
      usedCreators.set(creator, (usedCreators.get(creator) ?? 0) + 1);
      const platform = platformPick();
      const pubOffsetH = 0.3 + rand() * Math.max(0.5, ageH * 0.85);
      const publishedAt = new Date(Math.min(t.launchedAt.getTime() + pubOffsetH * HOUR, nowMs - 20 * 60_000));
      const submittedAt = new Date(Math.min(publishedAt.getTime() + (0.1 + rand() * 5) * HOUR, nowMs - 5 * 60_000));
      const videoId =
        platform === "tiktok" || platform === "x"
          ? makeEmbeddedId(platform, publishedAt, Math.floor(rand() * 2 ** 31))
          : shortId(11);
      videos.push({
        token: t,
        creator,
        platform,
        videoId,
        publishedAt,
        submittedAt,
        fingerprint: simFingerprint(platform, videoId),
        status: "verified",
        statusReason: null,
      });
    }
  }

  // Reused content: two videos re-upload footage first posted by someone else.
  for (let i = 0; i < 2; i++) {
    const original = videos[randInt(0, Math.floor(videos.length / 2))];
    const copy = videos.find((v) => v.creator !== original.creator && v.publishedAt > original.publishedAt && v.token !== original.token && v.fingerprint !== original.fingerprint);
    if (copy) copy.fingerprint = original.fingerprint.slice(0, 15) + ((parseInt(original.fingerprint[15], 16) ^ 1).toString(16));
  }
  // Self-dealing: a deployer enters its own competition.
  {
    const t = tokens[4];
    const publishedAt = new Date(t.launchedAt.getTime() + 2 * HOUR);
    const videoId = makeEmbeddedId("tiktok", publishedAt, 4242);
    videos.push({
      token: t,
      creator: t.deployer,
      platform: "tiktok",
      videoId,
      publishedAt,
      submittedAt: new Date(publishedAt.getTime() + HOUR),
      fingerprint: simFingerprint("tiktok", videoId),
      status: "verified",
      statusReason: null,
    });
  }

  // Linked (simulated) social accounts for every creator/platform pair used.
  const socialRows = new Map<string, typeof schema.socialAccounts.$inferInsert>();
  for (const v of videos) {
    const h = handleFor(v.creator, v.platform);
    const key = `${v.platform}:${h}`;
    if (!socialRows.has(key)) {
      socialRows.set(key, {
        wallet: v.creator,
        platform: v.platform,
        platformAccountId: simulatedAccountId(v.platform, h),
        handle: h,
        verificationMethod: "simulated",
        verifiedAt: new Date(v.submittedAt.getTime() - 10 * 60_000),
      });
    }
  }
  const socialIds = new Map<string, string>();
  for (const row of socialRows.values()) {
    const [r] = await db.insert(schema.socialAccounts).values(row).onConflictDoNothing().returning({ id: schema.socialAccounts.id });
    if (r) socialIds.set(`${row.platform}:${row.handle}`, r.id);
  }

  // Insert videos with current metrics, scores and snapshot histories.
  const snapshotsByVideo = new Map<SeedVideo, Array<{ capturedAt: Date; views: number; likes: number; comments: number }>>();
  for (const v of videos) {
    const handle = handleFor(v.creator, v.platform);
    const m = simMetrics(v.platform, v.videoId, v.publishedAt, now);
    const b = computeViralScore(m, v.platform, scoring, cfg.scoring.version);
    const canonical =
      v.platform === "tiktok"
        ? `https://www.tiktok.com/@${handle}/video/${v.videoId}`
        : v.platform === "youtube"
          ? `https://www.youtube.com/shorts/${v.videoId}`
          : v.platform === "instagram"
            ? `https://www.instagram.com/reel/${v.videoId}/`
            : `https://x.com/${handle}/status/${v.videoId}`;
    const [row] = await db
      .insert(schema.videos)
      .values({
        competitionId: v.token.competitionId!,
        creatorWallet: v.creator,
        platform: v.platform,
        submittedUrl: canonical,
        canonicalUrl: canonical,
        platformVideoId: v.videoId,
        authorAccountId: simulatedAccountId(v.platform, handle),
        authorHandle: handle,
        socialAccountId: socialIds.get(`${v.platform}:${handle}`) ?? null,
        contentFingerprint: v.fingerprint,
        publishedAt: v.publishedAt,
        publishedAtSource: "simulated",
        submittedAt: v.submittedAt,
        views: m.views,
        likes: m.likes,
        comments: m.comments,
        shares: m.shares,
        metricsUpdatedAt: new Date(nowMs - randInt(1, 9) * 60_000),
        metricsSource: "simulated",
        viralScore: b.score,
        scoreBreakdown: b,
        scoreConfigVersion: cfg.scoring.version,
        status: "verified",
        isSimulated: true,
      })
      .returning({ id: schema.videos.id });
    v.id = row.id;

    const snaps: Array<typeof schema.metricSnapshots.$inferInsert> = [];
    const series: Array<{ capturedAt: Date; views: number; likes: number; comments: number }> = [];
    const first = Math.max(v.submittedAt.getTime(), nowMs - 7 * 24 * HOUR);
    for (let t = first; t <= nowMs; t += 30 * 60_000) {
      const at = new Date(t);
      const sm = simMetrics(v.platform, v.videoId, v.publishedAt, at);
      snaps.push({ videoId: row.id, capturedAt: at, views: sm.views, likes: sm.likes, comments: sm.comments, shares: sm.shares, source: "simulated" });
      series.push({ capturedAt: at, views: sm.views, likes: sm.likes, comments: sm.comments });
    }
    snapshotsByVideo.set(v, series);
    for (let i = 0; i < snaps.length; i += 2000) await db.insert(schema.metricSnapshots).values(snaps.slice(i, i + 2000));
  }

  /* -------------------------------- Fraud -------------------------------- */

  console.log("· fraud assessment");
  const fraudCfg = cfg.fraud.value;
  const byFingerprint = new Map<string, SeedVideo[]>();
  for (const v of videos) byFingerprint.set(v.fingerprint.slice(0, 15), [...(byFingerprint.get(v.fingerprint.slice(0, 15)) ?? []), v]);
  let flagged = 0;
  for (const v of videos) {
    const series = snapshotsByVideo.get(v)!;
    const last = series[series.length - 1] ?? { views: 0, likes: 0, comments: 0 };
    const matches = (byFingerprint.get(v.fingerprint.slice(0, 15)) ?? [])
      .filter((o) => o !== v)
      .map((o) => ({ videoId: o.id!, competitionId: o.token.competitionId!, creatorWallet: o.creator, publishedAt: o.publishedAt, distance: 1 }));
    const subs24h = videos.filter((o) => o.creator === v.creator && Math.abs(o.submittedAt.getTime() - v.submittedAt.getTime()) < 24 * HOUR).length;
    const a = assessFraud(
      {
        platform: v.platform,
        creatorWallet: v.creator,
        publishedAt: v.publishedAt,
        current: last,
        snapshots: series,
        related: {
          launchedAt: v.token.launchedAt,
          contentMatches: matches.filter((mm) => mm.publishedAt < v.publishedAt || mm.creatorWallet === v.creator),
          creatorSubmissions24h: subs24h,
          socialAccountWalletCount: 1,
          networkWalletCount: 1,
          isTokenDeployer: v.creator === v.token.deployer,
        },
      },
      fraudCfg,
    );
    if (a.findings.length === 0) continue;
    await db.insert(schema.fraudFlags).values(
      a.findings.map((f) => ({
        videoId: v.id!,
        creatorWallet: v.creator,
        signal: f.signal,
        severity: f.severity,
        summary: f.summary,
        evidence: f.evidence,
        createdAt: new Date(Math.min(nowMs - 5 * 60_000, v.submittedAt.getTime() + randInt(1, 30) * HOUR)),
      })),
    );
    if (a.needsReview) {
      v.status = "under_review";
      v.statusReason = "flagged_for_review";
      flagged++;
    }
    await db
      .update(schema.videos)
      .set({ riskScore: a.riskScore, status: v.status, statusReason: v.statusReason })
      .where(sql`id = ${v.id!}`);
  }

  // A reviewer already rejected a few of the flagged videos.
  const reviewer = adminWalletsFromEnv()[0] ?? "system:seed-reviewer";
  const toReject = videos.filter((v) => v.status === "under_review" && simParams(v.platform, v.videoId).pattern !== "organic").slice(0, 3);
  for (const v of toReject) {
    const reviewedAt = new Date(nowMs - randInt(2, 30) * HOUR);
    v.status = "rejected";
    await db
      .update(schema.videos)
      .set({ status: "rejected", statusReason: "rejected_by_review", reviewedBy: reviewer, reviewedAt, reviewNote: "Engagement inconsistent with reach; confirmed after manual review." })
      .where(sql`id = ${v.id!}`);
    await db
      .update(schema.fraudFlags)
      .set({ status: "confirmed", resolvedAt: reviewedAt, resolvedBy: reviewer, resolutionNote: "Confirmed during review" })
      .where(sql`video_id = ${v.id!}`);
    await db.insert(schema.auditLogs).values({
      actor: reviewer,
      actorRole: "admin",
      action: "video.review.reject",
      targetType: "video",
      targetId: v.id!,
      before: { status: "under_review" },
      after: { status: "rejected" },
      note: "Engagement inconsistent with reach; confirmed after manual review.",
      createdAt: reviewedAt,
    });
  }
  console.log(`  ${flagged} routed to review, ${toReject.length} rejected after review`);

  // Pre-launch content: recorded as rejected attempts so it can never be resubmitted.
  for (let i = 0; i < 4; i++) {
    const t = tokens[randInt(0, 10)];
    const creator = pickCreator();
    const publishedAt = new Date(t.launchedAt.getTime() - randInt(2, 60) * 24 * HOUR);
    const videoId = makeEmbeddedId("tiktok", publishedAt, Math.floor(rand() * 2 ** 31));
    const handle = handleFor(creator, "tiktok");
    await db.insert(schema.videos).values({
      competitionId: t.competitionId!,
      creatorWallet: creator,
      platform: "tiktok",
      submittedUrl: `https://www.tiktok.com/@${handle}/video/${videoId}`,
      canonicalUrl: `https://www.tiktok.com/@${handle}/video/${videoId}`,
      platformVideoId: videoId,
      authorAccountId: simulatedAccountId("tiktok", handle),
      authorHandle: handle,
      contentFingerprint: simFingerprint("tiktok", videoId),
      publishedAt,
      publishedAtSource: "simulated",
      submittedAt: new Date(nowMs - randInt(1, 72) * HOUR),
      status: "rejected",
      statusReason: "published_before_launch",
      reviewedBy: "system:eligibility",
      reviewedAt: new Date(nowMs - randInt(1, 72) * HOUR),
      isSimulated: true,
    });
  }

  /* ---------------------------- Checkpoint history ----------------------- */

  console.log("· checkpoint & payout history");
  const payoutsCfg = cfg.payouts.value;
  let awarded = 0;
  let attention = 0;
  for (const t of tokens) {
    const intervalMs = t.interval * HOUR;
    const fees = feesByToken.get(t.id!)!;
    const tokenVideos = videos.filter((v) => v.token === t);
    for (let at = t.launchedAt.getTime() + intervalMs; at <= nowMs; at += intervalMs) {
      const T = new Date(at);
      const window = fees.filter((f) => !f.assigned && f.confirmedAt <= T);
      const feesLamports = window.reduce((s, f) => s + f.amount, 0);

      // Leaderboard as of T (videos flagged by a non-organic pattern are treated as under review).
      const entries = tokenVideos
        .filter((v) => v.submittedAt <= T)
        .map((v) => {
          const m = simMetrics(v.platform, v.videoId, v.publishedAt, T);
          const s = computeViralScore(m, v.platform, scoring, cfg.scoring.version).score;
          const pattern = simParams(v.platform, v.videoId).pattern;
          return {
            id: v.id!,
            creatorWallet: v.creator,
            viralScore: s,
            views: m.views,
            likes: m.likes,
            comments: m.comments,
            platform: v.platform,
            submittedAt: v.submittedAt,
            publishedAt: v.publishedAt,
            status: (pattern === "organic" && v.status !== "rejected" ? "verified" : "under_review") as "verified" | "under_review",
            openFlagCount: 0,
            creatorBanned: false,
          };
        });
      const rules = {
        minVerifiedViews: cfg.eligibility.value.minVerifiedViews,
        launchedAt: t.launchedAt,
        checkpointAt: T,
        excludedWallets: payoutsCfg.excludeDeployerFromRewards ? [t.deployer] : [],
      };
      const winner = selectWinner(entries, rules);
      const ranked = rankEntries(entries).slice(0, 10);

      let twapSum = 0;
      for (let m = 0; m < 30; m++) twapSum += simPrice(t.mint, t.launchedAt, new Date(at - m * 60_000));
      const twap = twapSum / 30;
      const refMc = twap * SIM_TOTAL_SUPPLY;
      const bps = rewardBpsForMarketCap(cfg.reward_curve.value, refMc);
      const alloc = allocateFees(feesLamports, bps);

      let status: "awarded" | "no_fees" | "no_eligible_winner" | "below_minimum" = "awarded";
      if (feesLamports === 0) status = "no_fees";
      else if (!winner) status = "no_eligible_winner";
      else if (alloc.rewardLamports < payoutsCfg.minPayoutLamports) status = "below_minimum";

      const [cp] = await db
        .insert(schema.checkpoints)
        .values({
          competitionId: t.competitionId!,
          scheduledAt: T,
          status,
          startedAt: new Date(at + 4_000),
          completedAt: new Date(at + 9_000),
          feesInWindowLamports: feesLamports,
          rewardBps: feesLamports > 0 ? bps : null,
          rewardLamports: status === "awarded" ? alloc.rewardLamports : 0,
          retainedLamports: status === "awarded" ? alloc.retainedLamports : 0,
          referenceMarketCapUsd: refMc,
          twapPriceUsd: twap,
          referenceSupply: SIM_TOTAL_SUPPLY,
          priceSampleCount: 30,
          priceWindowStart: new Date(at - 30 * 60_000),
          priceWindowEnd: T,
          winnerVideoId: winner?.id ?? null,
          winnerWallet: winner?.creatorWallet ?? null,
          winnerScore: winner?.viralScore ?? null,
          winnerViews: winner?.views ?? null,
          leaderboardSnapshot: ranked.map((e, i) => ({
            rank: i + 1,
            videoId: e.id,
            wallet: e.creatorWallet,
            platform: e.platform,
            score: e.viralScore,
            views: e.views,
            likes: e.likes,
            comments: e.comments,
            ineligible: eligibilityOf(e, rules),
          })),
          configSnapshot: {
            scoring: { version: cfg.scoring.version },
            payouts: { version: cfg.payouts.version },
            rewardCurve: cfg.reward_curve.value,
            minEligibleViews: cfg.eligibility.value.minVerifiedViews,
            payoutIntervalHours: t.interval,
            simulated: true,
          },
          note: status === "no_eligible_winner" ? "No eligible video; fees roll over" : status === "below_minimum" ? "Reward below minimum payout; fees roll over" : null,
        })
        .returning({ id: schema.checkpoints.id });

      if (status !== "awarded" || !winner) continue;
      for (const f of window) f.assigned = true;
      const ids = window.map((f) => f.id);
      for (let i = 0; i < ids.length; i += 500) {
        await db.execute(sql`UPDATE fee_events SET checkpoint_id = ${cp.id} WHERE id IN (${sql.join(ids.slice(i, i + 500).map((id) => sql`${id}::uuid`), sql`, `)})`);
      }

      // The most recent payouts of two competitions are left needing attention to demonstrate the fallback path.
      const needsAttention = at > nowMs - 2 * intervalMs && attention < 2 && (t === tokens[1] || t === tokens[7]);
      const attempts = needsAttention ? 3 : chance(0.04) ? 2 : 1;
      const confirmedAt = new Date(at + randInt(40, 180) * 1000);
      const sigs = Array.from({ length: attempts }, () => signature());
      const [p] = await db
        .insert(schema.payouts)
        .values({
          checkpointId: cp.id,
          competitionId: t.competitionId!,
          videoId: winner.id,
          recipientWallet: winner.creatorWallet,
          amountLamports: alloc.rewardLamports,
          idempotencyKey: `checkpoint:${t.competitionId}:${T.toISOString()}`,
          status: needsAttention ? "requires_attention" : "confirmed",
          signature: needsAttention ? null : sigs[sigs.length - 1],
          confirmedSlot: needsAttention ? null : Math.floor(confirmedAt.getTime() / 400),
          confirmedAt: needsAttention ? null : confirmedAt,
          attemptCount: attempts,
          autoAttemptBudget: payoutsCfg.autoAttemptBudget,
          lastError: needsAttention ? "Transaction expired before confirmation" : null,
          resolution: needsAttention ? null : "automatic",
          isSimulated: true,
          createdAt: new Date(at + 9_000),
          updatedAt: needsAttention ? new Date(at + 6 * 60_000) : confirmedAt,
        })
        .returning({ id: schema.payouts.id });
      await db.insert(schema.payoutAttempts).values(
        sigs.map((s, i) => ({
          payoutId: p.id,
          attemptNo: i + 1,
          signature: s,
          blockhash: bs58.encode(bytes(32)),
          lastValidBlockHeight: Math.floor((at + (i + 1) * 70_000) / 400) + 150,
          rawTransaction: "simulated",
          status: (needsAttention || i < sigs.length - 1 ? "expired" : "confirmed") as "expired" | "confirmed",
          error: needsAttention || i < sigs.length - 1 ? "Blockhash expired before landing" : null,
          createdAt: new Date(at + 10_000 + i * 70_000),
          sentAt: new Date(at + 11_000 + i * 70_000),
          resolvedAt: new Date(at + 75_000 + i * 70_000),
        })),
      );
      if (needsAttention) {
        attention++;
        await db.insert(schema.auditLogs).values({
          actor: "system:payouts",
          action: "payout.requires_attention",
          targetType: "payout",
          targetId: p.id,
          after: { attempts },
          createdAt: new Date(at + 6 * 60_000),
        });
      } else awarded++;
    }
  }
  console.log(`  ${awarded} confirmed payouts, ${attention} requiring attention`);

  /* ------------------------------ Admin state ---------------------------- */

  // One competition paused by administrators.
  await db
    .update(schema.competitions)
    .set({ status: "paused", pausedAt: new Date(nowMs - 5 * HOUR), pausedReason: "Investigating coordinated engagement across entries", pausedBy: reviewer })
    .where(sql`id = ${tokens[19].competitionId!}`);
  await db.insert(schema.auditLogs).values({
    actor: reviewer,
    actorRole: "admin",
    action: "competition.pause",
    targetType: "competition",
    targetId: tokens[19].competitionId!,
    before: { status: "active" },
    after: { status: "paused" },
    note: "Investigating coordinated engagement across entries",
    createdAt: new Date(nowMs - 5 * HOUR),
  });

  // Disputes.
  const rejected = await db.execute<{ id: string; creator_wallet: string; competition_id: string }>(
    sql`SELECT id, creator_wallet, competition_id FROM videos WHERE status = 'rejected' AND status_reason = 'rejected_by_review' LIMIT 2`,
  );
  const disputeMessages = [
    "My views came from a duet with a large creator, not from bought traffic. I can share analytics screenshots from TikTok Studio.",
    "The spike happened after the video was featured on the For You page. Please re-check engagement over the full day.",
  ];
  for (const [i, r] of rejected.rows.entries()) {
    await db.insert(schema.disputes).values({
      wallet: r.creator_wallet,
      category: "video_rejected",
      videoId: r.id,
      competitionId: r.competition_id,
      message: disputeMessages[i],
      createdAt: new Date(nowMs - randInt(1, 20) * HOUR),
    });
  }
  const someVideo = videos.find((v) => v.status === "verified")!;
  await db.insert(schema.disputes).values({
    wallet: someVideo.creator,
    category: "score_incorrect",
    videoId: someVideo.id!,
    competitionId: someVideo.token.competitionId!,
    message: "My comment count on the leaderboard looks lower than what the platform shows. Could the metrics sync be delayed?",
    status: "resolved",
    resolution: "Metrics refresh on a tiered schedule; the count caught up at the next sync. No change to eligibility.",
    resolvedBy: reviewer,
    resolvedAt: new Date(nowMs - 30 * HOUR),
    createdAt: new Date(nowMs - 34 * HOUR),
  });

  const summary = (await db.execute(sql`
    SELECT (SELECT count(*) FROM tokens) tokens, (SELECT count(*) FROM videos) videos, (SELECT count(*) FROM metric_snapshots) snapshots,
           (SELECT count(*) FROM market_candles) candles, (SELECT count(*) FROM fee_events) fees, (SELECT count(*) FROM checkpoints) checkpoints,
           (SELECT count(*) FROM payouts) payouts, (SELECT count(*) FROM fraud_flags) flags
  `)).rows[0];
  console.log("✓ demo data seeded", summary);
  void simMarketCap;
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Persists fraud assessments.
 *
 *  - New findings become "open" flags (one open flag per signal per video).
 *  - A signal a reviewer already dismissed is not re-raised unless its
 *    severity increases, so reviewers aren't asked the same question twice.
 *  - Risk is computed from all open flags; a verified video moves to
 *    "under_review" when risk requires it. Nothing is ever rejected here.
 */
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { getConfig } from "@/lib/config/store";
import { schema, type Executor } from "@/lib/db";
import { mentionsContractAddress } from "@/lib/domain/mentions";
import type { Platform } from "@/lib/domain/platforms";
import {
  assessFraud,
  scoreFindings,
  severityRank,
  type ContentMatch,
  type FraudAssessment,
  type Severity,
} from "@/lib/fraud/detectors";

const SNAPSHOT_LOOKBACK = 600;

export async function findContentMatches(
  ex: Executor,
  fingerprint: string | null,
  excludeVideoId: string | null,
  maxDistance: number,
): Promise<ContentMatch[]> {
  if (!fingerprint || !/^[0-9a-f]{16}$/.test(fingerprint)) return [];
  const res = await ex.execute<{
    id: string;
    competition_id: string;
    creator_wallet: string;
    published_at: string;
    distance: number;
  }>(sql`
    SELECT id, competition_id, creator_wallet, published_at,
           bit_count(('x' || content_fingerprint)::bit(64) # ('x' || ${fingerprint})::bit(64))::int AS distance
    FROM videos
    WHERE content_fingerprint ~ '^[0-9a-f]{16}$'
      AND (${excludeVideoId}::uuid IS NULL OR id <> ${excludeVideoId}::uuid)
    ORDER BY distance ASC
    LIMIT 10
  `);
  return res.rows
    .filter((r) => Number(r.distance) <= maxDistance)
    .map((r) => ({
      videoId: r.id,
      competitionId: r.competition_id,
      creatorWallet: r.creator_wallet,
      publishedAt: new Date(r.published_at),
      distance: Number(r.distance),
    }));
}

export async function evaluateVideoFraud(ex: Executor, videoId: string, now = new Date()): Promise<FraudAssessment & { status: string }> {
  const cfg = (await getConfig("fraud")).value;

  const [row] = await ex
    .select({
      video: schema.videos,
      launchedAt: schema.tokens.launchedAt,
      deployerWallet: schema.tokens.deployerWallet,
      mint: schema.tokens.mint,
    })
    .from(schema.videos)
    .innerJoin(schema.competitions, eq(schema.competitions.id, schema.videos.competitionId))
    .innerJoin(schema.tokens, eq(schema.tokens.id, schema.competitions.tokenId))
    .where(eq(schema.videos.id, videoId));
  if (!row) throw new Error(`Video ${videoId} not found`);
  const v = row.video;

  const snapshots = (
    await ex
      .select({
        capturedAt: schema.metricSnapshots.capturedAt,
        views: schema.metricSnapshots.views,
        likes: schema.metricSnapshots.likes,
        comments: schema.metricSnapshots.comments,
      })
      .from(schema.metricSnapshots)
      .where(eq(schema.metricSnapshots.videoId, videoId))
      .orderBy(desc(schema.metricSnapshots.capturedAt))
      .limit(SNAPSHOT_LOOKBACK)
  ).reverse();

  const [subs] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.videos)
    .where(and(eq(schema.videos.creatorWallet, v.creatorWallet), gt(schema.videos.submittedAt, new Date(now.getTime() - 86_400_000))));

  let socialWallets = 1;
  if (v.authorAccountId) {
    const [r] = await ex
      .select({ n: sql<number>`count(distinct ${schema.socialAccounts.wallet})::int` })
      .from(schema.socialAccounts)
      .where(and(eq(schema.socialAccounts.platform, v.platform), eq(schema.socialAccounts.platformAccountId, v.authorAccountId)));
    socialWallets = Math.max(Number(r?.n ?? 1), 1);
  }

  let networkWallets = 1;
  if (v.submitIpHash) {
    const [r] = await ex
      .select({ n: sql<number>`count(distinct ${schema.videos.creatorWallet})::int` })
      .from(schema.videos)
      .where(and(eq(schema.videos.competitionId, v.competitionId), eq(schema.videos.submitIpHash, v.submitIpHash)));
    networkWallets = Math.max(Number(r?.n ?? 1), 1);
  }

  const matches = await findContentMatches(ex, v.contentFingerprint, v.id, cfg.fingerprint.maxHammingDistance);

  const assessment = assessFraud(
    {
      platform: v.platform as Platform,
      creatorWallet: v.creatorWallet,
      publishedAt: v.publishedAt,
      current: { views: v.views, likes: v.likes, comments: v.comments },
      snapshots,
      related: {
        launchedAt: row.launchedAt,
        contentMatches: matches,
        creatorSubmissions24h: Number(subs?.n ?? 0),
        socialAccountWalletCount: socialWallets,
        networkWalletCount: networkWallets,
        isTokenDeployer: v.creatorWallet === row.deployerWallet,
        mentionsContractAddress: v.postText === null ? null : mentionsContractAddress(v.postText, row.mint),
      },
    },
    cfg,
  );

  // Persist findings.
  const existing = await ex
    .select()
    .from(schema.fraudFlags)
    .where(and(eq(schema.fraudFlags.videoId, videoId), inArray(schema.fraudFlags.status, ["open", "dismissed"])));

  for (const f of assessment.findings) {
    const open = existing.find((e) => e.signal === f.signal && e.status === "open");
    if (open) {
      if (severityRank(f.severity) > severityRank(open.severity as Severity)) {
        await ex
          .update(schema.fraudFlags)
          .set({ severity: f.severity, summary: f.summary, evidence: f.evidence })
          .where(eq(schema.fraudFlags.id, open.id));
      }
      continue;
    }
    const dismissed = existing
      .filter((e) => e.signal === f.signal && e.status === "dismissed")
      .some((e) => severityRank(e.severity as Severity) >= severityRank(f.severity));
    if (dismissed) continue;
    await ex
      .insert(schema.fraudFlags)
      .values({
        videoId,
        creatorWallet: v.creatorWallet,
        signal: f.signal,
        severity: f.severity,
        summary: f.summary,
        evidence: f.evidence,
      })
      .onConflictDoNothing();
  }

  // Risk is driven by all open flags (they persist until reviewed).
  const openFlags = await ex
    .select({ severity: schema.fraudFlags.severity })
    .from(schema.fraudFlags)
    .where(and(eq(schema.fraudFlags.videoId, videoId), eq(schema.fraudFlags.status, "open")));
  const { riskScore, needsReview } = scoreFindings(openFlags as Array<{ severity: Severity }>, cfg);

  let status: string = v.status;
  if (v.status === "verified" && needsReview) {
    status = "under_review";
    await ex
      .update(schema.videos)
      .set({ status: "under_review", statusReason: "flagged_for_review", riskScore })
      .where(eq(schema.videos.id, videoId));
  } else {
    await ex.update(schema.videos).set({ riskScore }).where(eq(schema.videos.id, videoId));
  }

  return { ...assessment, riskScore, needsReview, status };
}

/** Open flag counts per video (leaderboards, review queue). */
export async function openFlagCounts(ex: Executor, videoIds: string[]): Promise<Map<string, number>> {
  if (videoIds.length === 0) return new Map();
  const rows = await ex
    .select({ videoId: schema.fraudFlags.videoId, n: sql<number>`count(*)::int` })
    .from(schema.fraudFlags)
    .where(and(inArray(schema.fraudFlags.videoId, videoIds), eq(schema.fraudFlags.status, "open")))
    .groupBy(schema.fraudFlags.videoId);
  return new Map(rows.map((r) => [r.videoId, Number(r.n)]));
}


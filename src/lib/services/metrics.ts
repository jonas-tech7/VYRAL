/**
 * Metric synchronisation: authorised platform data → snapshots → fraud
 * checks → Viral Score. Runs in the background worker.
 *
 * Sync cadence is tiered: videos near the top of a leaderboard and recent
 * videos refresh more often, which keeps API quota for what decides payouts.
 */
import { eq, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Platform } from "@/lib/domain/platforms";
import { socialProvider, type MetricsRequest } from "@/lib/providers/social";
import { ProviderError } from "@/lib/providers/social/types";
import { evaluateVideoFraud } from "./fraud";
import { rescoreVideo } from "./scoring";
import { credentialsFor } from "./social-accounts";

const MIN_INTERVAL_MS = 4 * 60_000;
const BATCH = 150;

export async function syncMetrics(now = new Date()) {
  const provider = socialProvider();

  // Due videos, prioritising never-synced, top-ranked and young videos.
  const due = await db.execute<{ id: string }>(sql`
    WITH ranked AS (
      SELECT v.id, v.metrics_updated_at, v.published_at,
             row_number() OVER (PARTITION BY v.competition_id ORDER BY v.viral_score DESC) AS rnk
      FROM videos v
      JOIN competitions c ON c.id = v.competition_id
      WHERE c.status IN ('active', 'paused') AND v.status <> 'rejected'
    )
    SELECT id FROM ranked
    WHERE metrics_updated_at IS NULL
       OR metrics_updated_at < ${new Date(now.getTime() - MIN_INTERVAL_MS).toISOString()}::timestamptz
          AND (
            rnk <= 10
            OR published_at > ${new Date(now.getTime() - 3 * 86_400_000).toISOString()}::timestamptz
            OR metrics_updated_at < ${new Date(now.getTime() - 20 * 60_000).toISOString()}::timestamptz
          )
    ORDER BY metrics_updated_at NULLS FIRST, rnk
    LIMIT ${BATCH}
  `);
  const ids = due.rows.map((r) => r.id);
  if (ids.length === 0) return { synced: 0, failed: 0 };

  const videos = await db.select().from(schema.videos).where(inArray(schema.videos.id, ids));
  const requests: MetricsRequest[] = [];
  for (const v of videos) {
    requests.push({
      key: v.id,
      platform: v.platform as Platform,
      videoId: v.platformVideoId,
      publishedAt: v.publishedAt,
      credentials: v.socialAccountId ? await credentialsFor(v.socialAccountId) : null,
    });
  }

  const results = await provider.fetchMetrics(requests);
  let synced = 0;
  let failed = 0;
  for (const v of videos) {
    const r = results.get(v.id);
    if (!r || r instanceof ProviderError) {
      failed++;
      if (r && (r.code === "not_found" || r.code === "unauthorized")) {
        // Deleted, made private, or access revoked: its last numbers can no longer be checked, so it must not keep
        // competing on frozen metrics. A verified video goes to review (a reviewer can reinstate it).
        await db
          .update(schema.videos)
          .set(
            v.status === "verified"
              ? { metricsUpdatedAt: now, status: "under_review", statusReason: `video_unavailable:${r.code}` }
              : { metricsUpdatedAt: now, statusReason: `metrics_unavailable:${r.code}` },
          )
          .where(eq(schema.videos.id, v.id));
      }
      continue;
    }
    await db.transaction(async (tx) => {
      await tx.insert(schema.metricSnapshots).values({
        videoId: v.id,
        capturedAt: r.capturedAt,
        views: r.views,
        likes: r.likes,
        comments: r.comments,
        shares: r.shares,
        source: r.source,
      });
      await tx
        .update(schema.videos)
        .set({
          views: r.views,
          likes: r.likes,
          comments: r.comments,
          shares: r.shares,
          metricsUpdatedAt: r.capturedAt,
          metricsSource: r.source,
          // Keep the latest post text, so removing the contract address after submission is caught.
          ...(typeof r.postText === "string" ? { postText: r.postText } : {}),
        })
        .where(eq(schema.videos.id, v.id));
      await rescoreVideo(tx, { id: v.id, platform: v.platform as Platform, views: r.views, likes: r.likes, comments: r.comments });
      await evaluateVideoFraud(tx, v.id, now);
    });
    synced++;
  }
  return { synced, failed };
}

export async function pruneSnapshots(retentionDays = 60) {
  await db.delete(schema.metricSnapshots).where(lt(schema.metricSnapshots.capturedAt, new Date(Date.now() - retentionDays * 86_400_000)));
}


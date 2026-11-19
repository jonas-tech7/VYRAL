import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { getConfig } from "@/lib/config/store";
import { db, schema, type Executor } from "@/lib/db";
import type { Platform } from "@/lib/domain/platforms";
import { computeViralScore } from "@/lib/scoring/viral-score";

type ScorableVideo = { id: string; platform: Platform; views: number; likes: number; comments: number };

export async function rescoreVideo(ex: Executor, v: ScorableVideo) {
  const cfg = await getConfig("scoring");
  const breakdown = computeViralScore(v, v.platform, cfg.value, cfg.version);
  await ex
    .update(schema.videos)
    .set({ viralScore: breakdown.score, scoreBreakdown: breakdown, scoreConfigVersion: cfg.version })
    .where(eq(schema.videos.id, v.id));
  return breakdown;
}

/**
 * Recomputes scores for every video in active or paused competitions,
 * e.g. after an administrator changes weights or multipliers. Past
 * checkpoints are unaffected: they store their own scoring snapshot.
 */
export async function rescoreAllActive(): Promise<number> {
  const cfg = await getConfig("scoring");
  const rows = await db
    .select({
      id: schema.videos.id,
      platform: schema.videos.platform,
      views: schema.videos.views,
      likes: schema.videos.likes,
      comments: schema.videos.comments,
    })
    .from(schema.videos)
    .innerJoin(schema.competitions, eq(schema.competitions.id, schema.videos.competitionId))
    .where(and(inArray(schema.competitions.status, ["active", "paused"]), ne(schema.videos.status, "rejected")));

  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((v) => ({ id: v.id, b: computeViralScore(v, v.platform, cfg.value, cfg.version) }));
    await db.transaction(async (tx) => {
      for (const { id, b } of chunk) {
        await tx
          .update(schema.videos)
          .set({ viralScore: b.score, scoreBreakdown: b, scoreConfigVersion: cfg.version })
          .where(eq(schema.videos.id, id));
      }
    });
  }
  return rows.length;
}

export async function countStaleScores(): Promise<number> {
  const cfg = await getConfig("scoring");
  const res = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM videos WHERE status <> 'rejected' AND (score_config_version IS NULL OR score_config_version <> ${cfg.version})`,
  );
  return Number(res.rows[0]?.n ?? 0);
}

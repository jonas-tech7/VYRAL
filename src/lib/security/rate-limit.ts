/**
 * Fixed-window rate limiter backed by PostgreSQL, so limits hold across
 * multiple app instances without extra infrastructure. One atomic upsert per
 * check.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: Date };

export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const res = await db.execute<{ count: number }>(sql`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${key}, ${windowStart.toISOString()}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
    RETURNING count
  `);
  const count = Number(res.rows[0]?.count ?? 1);
  return {
    allowed: count <= limit,
    remaining: Math.max(limit - count, 0),
    resetAt: new Date(windowStart.getTime() + windowMs),
  };
}

export async function pruneRateLimits(olderThan: Date): Promise<number> {
  const res = await db.execute(sql`DELETE FROM rate_limits WHERE window_start < ${olderThan.toISOString()}`);
  return res.rowCount ?? 0;
}

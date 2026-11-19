/**
 * Background jobs, shared by the long-running worker (src/worker) and the
 * cron endpoint (/api/cron/tick) used on serverless hosts such as Vercel.
 *
 * Each run takes a PostgreSQL advisory lock, so a job never runs
 * concurrently with itself no matter how many workers or cron calls overlap.
 * Data-level idempotency (unique checkpoints, single in-flight payout
 * attempts) is enforced independently in the services and the schema.
 */
import { eq, sql } from "drizzle-orm";
import { pruneSessions } from "@/lib/auth/session";
import { pruneNonces } from "@/lib/auth/siws";
import { db, pool, schema } from "@/lib/db";
import { pruneRateLimits } from "@/lib/security/rate-limit";
import { processDueCheckpoints } from "@/lib/services/checkpoints";
import { syncFees } from "@/lib/services/fees";
import { prunePriceSamples, samplePrices } from "@/lib/services/market";
import { pruneSnapshots, syncMetrics } from "@/lib/services/metrics";
import { executePayouts } from "@/lib/services/payouts";
import { pruneOAuthStates } from "@/lib/services/social-accounts";

export type Job = { name: string; everyMs: number; run: () => Promise<unknown> };

export const JOBS: Job[] = [
  { name: "sample-prices", everyMs: 60_000, run: () => samplePrices() },
  { name: "sync-fees", everyMs: 60_000, run: () => syncFees() },
  { name: "sync-metrics", everyMs: 120_000, run: () => syncMetrics() },
  { name: "checkpoints", everyMs: 30_000, run: async () => ({ processed: (await processDueCheckpoints()).length }) },
  { name: "payouts", everyMs: 15_000, run: () => executePayouts() },
  {
    name: "maintenance",
    everyMs: 3_600_000,
    run: async () => {
      await Promise.all([
        pruneNonces(),
        pruneSessions(),
        pruneOAuthStates(),
        pruneRateLimits(new Date(Date.now() - 2 * 86_400_000)),
        prunePriceSamples(14),
        pruneSnapshots(90),
      ]);
      return { ok: true };
    },
  },
];

export type JobResult = { job: string; status: "ok" | "error" | "skipped_locked"; detail?: Record<string, unknown> };

export async function runJob(job: Job): Promise<JobResult> {
  // The lock is transaction-scoped and held on a dedicated connection for the
  // whole run, so it works both on direct connections and behind a
  // transaction-mode pooler (e.g. Neon/PgBouncer), where session locks leak.
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    const res = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS ok", [
      `vyral:job:${job.name}`,
    ]);
    if (!res.rows[0]?.ok) return { job: job.name, status: "skipped_locked" };
    const [run] = await db.insert(schema.jobRuns).values({ job: job.name }).returning({ id: schema.jobRuns.id });
    const started = Date.now();
    try {
      const detail = { ...((await job.run()) as Record<string, unknown> | undefined), ms: Date.now() - started };
      await db.update(schema.jobRuns).set({ finishedAt: new Date(), status: "ok", detail }).where(eq(schema.jobRuns.id, run.id));
      return { job: job.name, status: "ok", detail };
    } catch (e) {
      const detail = { error: e instanceof Error ? e.message : String(e) };
      console.error(`[jobs] ${job.name} failed`, e);
      await db.update(schema.jobRuns).set({ finishedAt: new Date(), status: "error", detail }).where(eq(schema.jobRuns.id, run.id));
      return { job: job.name, status: "error", detail };
    }
  } finally {
    if (open) await client.query("COMMIT").catch(() => {});
    client.release();
  }
}

/** Runs every job that is due according to its interval (based on the last successful run). */
export async function runDueJobs(now = new Date()): Promise<JobResult[]> {
  const results: JobResult[] = [];
  for (const job of JOBS) {
    // Latest run of this job (any status) to respect its interval.
    const lastRun = await db.execute<{ started_at: string | null }>(
      sql`SELECT max(started_at) AS started_at FROM job_runs WHERE job = ${job.name}`,
    );
    const prev = lastRun.rows[0]?.started_at ? new Date(lastRun.rows[0].started_at).getTime() : 0;
    // 5 s tolerance so a once-a-minute cron still runs the 60 s jobs every call.
    if (now.getTime() - prev + 5_000 >= job.everyMs) results.push(await runJob(job));
  }
  return results;
}

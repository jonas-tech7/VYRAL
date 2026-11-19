/**
 * VYRAL background worker.
 *
 *   npm run worker            run continuously
 *   npm run worker -- --once  run every job once and exit (cron-style deployments)
 *
 * Each job runs on its own interval. Before running, the worker takes a
 * PostgreSQL session advisory lock for that job, so any number of worker
 * replicas can run safely: a job never executes concurrently with itself.
 * Data-level idempotency (unique checkpoints, single in-flight attempts)
 * is enforced independently in the services and the schema.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

type Job = { name: string; everyMs: number; run: () => Promise<unknown> };

async function main() {
  const { pool, db, schema } = await import("@/lib/db");
  const { eq } = await import("drizzle-orm");
  const { assertLiveConfig, env, isDemoMode } = await import("@/lib/env");
  const { samplePrices, prunePriceSamples } = await import("@/lib/services/market");
  const { syncFees } = await import("@/lib/services/fees");
  const { syncMetrics, pruneSnapshots } = await import("@/lib/services/metrics");
  const { processDueCheckpoints } = await import("@/lib/services/checkpoints");
  const { executePayouts } = await import("@/lib/services/payouts");
  const { pruneNonces } = await import("@/lib/auth/siws");
  const { pruneSessions } = await import("@/lib/auth/session");
  const { pruneRateLimits } = await import("@/lib/security/rate-limit");
  const { pruneOAuthStates } = await import("@/lib/services/social-accounts");
  const { ensureConfigDefaults } = await import("@/lib/config/store");

  const problems = assertLiveConfig();
  if (problems.length) {
    console.error(`[worker] configuration errors:\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }
  await ensureConfigDefaults();

  const jobs: Job[] = [
    { name: "sample-prices", everyMs: 60_000, run: () => samplePrices() },
    { name: "sync-fees", everyMs: 60_000, run: () => syncFees() },
    { name: "sync-metrics", everyMs: 120_000, run: () => syncMetrics() },
    { name: "checkpoints", everyMs: 30_000, run: () => processDueCheckpoints() },
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

  let stopping = false;
  const running = new Set<Promise<void>>();

  async function runJob(job: Job) {
    const client = await pool.connect();
    let locked = false;
    try {
      const res = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [`vyral:job:${job.name}`]);
      locked = Boolean(res.rows[0]?.ok);
      if (!locked) return;
      const [run] = await db.insert(schema.jobRuns).values({ job: job.name }).returning({ id: schema.jobRuns.id });
      const started = Date.now();
      try {
        const detail = (await job.run()) as Record<string, unknown> | undefined;
        await db
          .update(schema.jobRuns)
          .set({ finishedAt: new Date(), status: "ok", detail: { ...(detail ?? {}), ms: Date.now() - started } })
          .where(eq(schema.jobRuns.id, run.id));
        if (detail && Object.values(detail).some((v) => typeof v === "number" && v > 0) && job.name !== "sample-prices") {
          console.log(`[worker] ${job.name}`, JSON.stringify(detail));
        }
      } catch (e) {
        console.error(`[worker] ${job.name} failed`, e);
        await db
          .update(schema.jobRuns)
          .set({ finishedAt: new Date(), status: "error", detail: { error: e instanceof Error ? e.message : String(e) } })
          .where(eq(schema.jobRuns.id, run.id));
      }
    } finally {
      if (locked) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [`vyral:job:${job.name}`]).catch(() => {});
      client.release();
    }
  }

  const once = process.argv.includes("--once");
  console.log(
    `[worker] starting (${once ? "single pass" : "continuous"}) · cluster=${env.SOLANA_CLUSTER} · ${isDemoMode ? "DEMO providers active" : "live providers"}`,
  );

  if (once) {
    for (const job of jobs) await runJob(job);
    await pool.end();
    return;
  }

  const timers: NodeJS.Timeout[] = [];
  for (const job of jobs) {
    let busy = false;
    const tick = () => {
      if (stopping || busy) return;
      busy = true;
      const p = runJob(job).finally(() => {
        busy = false;
        running.delete(p);
      });
      running.add(p);
    };
    // Small stagger so jobs don't all start in the same instant.
    setTimeout(tick, Math.floor(Math.random() * 3_000));
    timers.push(setInterval(tick, job.everyMs));
  }

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal} received, finishing running jobs…`);
    timers.forEach(clearInterval);
    await Promise.allSettled([...running]);
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

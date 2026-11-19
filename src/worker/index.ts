/**
 * VYRAL background worker (long-running hosts).
 *
 *   npm run worker            run continuously
 *   npm run worker -- --once  run every job once and exit
 *
 * On serverless hosts (e.g. Vercel) use the cron endpoint instead:
 * GET /api/cron/tick with "Authorization: Bearer $CRON_SECRET", once a minute.
 * Both share lib/jobs.ts, which serialises each job with an advisory lock.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { pool } = await import("@/lib/db");
  const { assertLiveConfig, env, isDemoMode } = await import("@/lib/env");
  const { ensureConfigDefaults } = await import("@/lib/config/store");
  const { JOBS, runJob } = await import("@/lib/jobs");

  const problems = assertLiveConfig();
  if (problems.length) {
    console.error(`[worker] configuration errors:\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }
  await ensureConfigDefaults();

  const once = process.argv.includes("--once");
  console.log(`[worker] starting (${once ? "single pass" : "continuous"}) · cluster=${env.SOLANA_CLUSTER} · ${isDemoMode ? "DEMO providers active" : "live providers"}`);

  const log = (r: Awaited<ReturnType<typeof runJob>>) => {
    if (r.status === "error") console.error(`[worker] ${r.job} failed`, r.detail);
    else if (r.status === "ok" && r.job !== "sample-prices" && Object.entries(r.detail ?? {}).some(([k, v]) => k !== "ms" && typeof v === "number" && v > 0)) {
      console.log(`[worker] ${r.job}`, JSON.stringify(r.detail));
    }
  };

  if (once) {
    for (const job of JOBS) log(await runJob(job));
    await pool.end();
    return;
  }

  let stopping = false;
  const running = new Set<Promise<void>>();
  const timers: NodeJS.Timeout[] = [];
  for (const job of JOBS) {
    let busy = false;
    const tick = () => {
      if (stopping || busy) return;
      busy = true;
      const p = runJob(job)
        .then(log)
        .finally(() => {
          busy = false;
          running.delete(p);
        });
      running.add(p);
    };
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

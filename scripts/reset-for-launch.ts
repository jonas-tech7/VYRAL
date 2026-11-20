/**
 * Removes the demonstration data before going live (also available as a
 * button in the admin dashboard → Go-live).
 *
 *   npm run reset:launch              # dry run: shows what would be removed
 *   npm run reset:launch -- --confirm # removes it
 *   ... --confirm --if-demo           # deploy builds: removes it only when demo
 *                                     # coins exist and no real coin does; never fails
 *
 * Empties every data table (coins, competitions, videos, fees, payouts,
 * sessions, uploads, ...) and removes users that are not administrators.
 * Keeps the protocol configuration, its history, the administrators, the
 * audit log and the launch lookup table. Refuses once a real coin exists.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { resetForLaunch } = await import("@/lib/services/go-live");
  const { db, pool } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const confirm = process.argv.includes("--confirm");

  if (process.argv.includes("--if-demo")) {
    const [row] = (
      await db.execute(sql`SELECT count(*) FILTER (WHERE is_simulated)::int AS demo, count(*) FILTER (WHERE NOT is_simulated)::int AS live FROM tokens`)
    ).rows as Array<{ demo: number; live: number }>;
    if (Number(row.live) > 0 || Number(row.demo) === 0) {
      console.log(Number(row.live) > 0 ? "Real coins exist; demo cleanup skipped." : "No demonstration data present.");
      await pool.end();
      return;
    }
  }

  const { removed, counts } = await resetForLaunch("system:reset-for-launch", confirm);
  console.log(removed ? "Removed demonstration data:" : "Dry run. These would be removed:");
  for (const [t, n] of Object.entries(counts)) console.log(`  ${t.padEnd(28)} ${n} rows`);
  if (!removed) console.log("\nNothing was changed. Run again with --confirm to remove the data.");
  await pool.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.cause instanceof Error ? `${e.message}: ${e.cause.message}` : e.message) : e);
  process.exit(process.argv.includes("--if-demo") ? 0 : 1);
});

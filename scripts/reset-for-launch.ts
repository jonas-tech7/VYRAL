/**
 * Removes the demonstration data before going live (also available as a
 * button in the admin dashboard → Go-live).
 *
 *   npm run reset:launch              # dry run: shows what would be removed
 *   npm run reset:launch -- --confirm # removes it
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
  const { pool } = await import("@/lib/db");
  const confirm = process.argv.includes("--confirm");
  const { removed, counts } = await resetForLaunch("system:reset-for-launch", confirm);
  console.log(removed ? "Removed demonstration data:" : "Dry run. These would be removed:");
  for (const [t, n] of Object.entries(counts)) console.log(`  ${t.padEnd(28)} ${n} rows`);
  if (!removed) console.log("\nNothing was changed. Run again with --confirm to remove the data.");
  await pool.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

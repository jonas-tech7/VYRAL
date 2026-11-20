/**
 * Build command for hosted deployments (Vercel):
 *   1. apply database migrations
 *   2. production (VERCEL_ENV=production): remove any demonstration data
 *      (only while no real coin exists). Elsewhere: seed the clearly-labelled
 *      demo data, only if the database is empty,
 *      SEED_DEMO_DATA is not "false" and every provider is still a demo one
 *   3. apply revisions of the default configuration (never overrides admin changes)
 *   4. grant the admin role to the wallets in ADMIN_WALLETS
 *   5. next build
 */
import { spawnSync } from "node:child_process";

function run(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it in your hosting provider's environment variables.");
  process.exit(1);
}

run("npx", ["tsx", "scripts/migrate.ts"]);
if (process.env.VERCEL_ENV === "production") {
  // The public site never carries demonstration data: remove any left from
  // before (only while no real coin exists).
  run("npx", ["tsx", "scripts/reset-for-launch.ts", "--confirm", "--if-demo"]);
} else if (process.env.SEED_DEMO_DATA !== "false") {
  run("npx", ["tsx", "scripts/seed.ts", "--if-empty"]);
}
run("npx", ["tsx", "scripts/config-upgrade.ts"]);
run("npx", ["tsx", "scripts/admin-sync.ts"]);
run("npx", ["next", "build"]);

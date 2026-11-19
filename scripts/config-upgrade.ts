/**
 * Applies pending revisions of the shipped default configuration to an
 * existing database (only where the stored value is still the old default).
 * Safe to run repeatedly; part of `npm run vercel-build`.
 *   npx tsx scripts/config-upgrade.ts
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { pool } = await import("@/lib/db");
  const { ensureConfigDefaults } = await import("@/lib/config/store");
  const { applyDefaultRevisions } = await import("@/lib/services/config-revisions");
  await ensureConfigDefaults();
  const applied = await applyDefaultRevisions();
  console.log(applied.length ? `Config revisions applied: ${applied.join(", ")}` : "Config is up to date.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

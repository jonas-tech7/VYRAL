/**
 * Applies SQL migrations from ./drizzle. Safe to run repeatedly.
 *   npm run db:migrate
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const { db, pool } = await import("@/lib/db");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

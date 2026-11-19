/**
 * DEVELOPMENT ONLY: drops all data, re-applies migrations and seeds demo data.
 * Refuses to run when NODE_ENV=production.
 *   npm run db:reset
 */
import { loadEnvConfig } from "@next/env";
import { execSync } from "node:child_process";

loadEnvConfig(process.cwd());

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to reset a production database.");
    process.exit(1);
  }
  const { sql } = await import("drizzle-orm");
  const { db, pool } = await import("@/lib/db");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await pool.end();
  console.log("Schema recreated. Seeding…");
  if (!process.argv.includes("--no-seed")) execSync("npx tsx scripts/seed.ts", { stdio: "inherit" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

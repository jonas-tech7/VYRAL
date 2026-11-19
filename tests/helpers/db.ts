import { sql } from "drizzle-orm";

/** Recreates the test database schema from migrations. */
export async function resetTestDatabase() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
  const { db } = await import("@/lib/db");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await migrate(db, { migrationsFolder: "./drizzle" });
  const { ensureConfigDefaults, invalidateConfigCache } = await import("@/lib/config/store");
  await ensureConfigDefaults();
  invalidateConfigCache();
}

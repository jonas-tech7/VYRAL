import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __vyralPool?: Pool };

export const pool =
  globalForDb.__vyralPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
  });

// Reuse the pool across hot reloads in development.
if (env.NODE_ENV !== "production") globalForDb.__vyralPool = pool;

export const db = drizzle(pool, { schema, casing: "snake_case" });

export type Database = typeof db;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Either the root database handle or an open transaction. */
export type Executor = Database | Tx;

export { schema };

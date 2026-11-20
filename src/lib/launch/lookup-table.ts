import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";

export const LOOKUP_TABLE_STATE_KEY = "pumpfun:lookup_table";

/** The pump.fun launch lookup table: PUMPFUN_LOOKUP_TABLE wins, otherwise the one created from the admin dashboard. */
export async function lookupTableAddress(): Promise<string | null> {
  if (env.PUMPFUN_LOOKUP_TABLE) return env.PUMPFUN_LOOKUP_TABLE;
  const [row] = await db.select().from(schema.workerState).where(eq(schema.workerState.key, LOOKUP_TABLE_STATE_KEY));
  return (row?.value as { address?: string } | undefined)?.address ?? null;
}

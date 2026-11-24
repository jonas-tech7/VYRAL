import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { feeProvider } from "@/lib/providers/fees";

const CURSOR_KEY = "fees:cursor";
/** A launch that was sent but not recorded yet is normally recorded within minutes (see reconcileLaunches). */
const RECORDING_WINDOW_MS = 30 * 60_000;

/** Records newly observed creator fees (pending) and promotes finalized ones to confirmed. */
export async function syncFees(now = new Date()) {
  const provider = feeProvider();
  // Coins launched moments ago whose launch is still being recorded: their fees wait instead of going unattributed.
  // Read BEFORE the coins, so a launch recorded in between is in one of the two lists.
  const recording = await db
    .select({ mint: schema.launchRequests.mint })
    .from(schema.launchRequests)
    .where(
      and(
        eq(schema.launchRequests.status, "prepared"),
        isNotNull(schema.launchRequests.transaction),
        gt(schema.launchRequests.createdAt, new Date(now.getTime() - RECORDING_WINDOW_MS)),
      ),
    );
  // Every coin is credited what it paid the vault; only running competitions get their fees distributed.
  const tokens = await db
    .select({
      id: schema.tokens.id,
      mint: schema.tokens.mint,
      launchedAt: schema.tokens.launchedAt,
      poolAddress: schema.tokens.poolAddress,
      active: sql<boolean>`${schema.competitions.status} IN ('active', 'paused')`,
    })
    .from(schema.tokens)
    .innerJoin(schema.competitions, eq(schema.competitions.tokenId, schema.tokens.id));

  const [state] = await db.select().from(schema.workerState).where(eq(schema.workerState.key, CURSOR_KEY));
  const { fees, cursor } = await provider.poll(tokens, state?.value ?? {}, { recordingMints: recording.map((r) => r.mint) });

  let observed = 0;
  if (fees.length) {
    const inserted = await db
      .insert(schema.feeEvents)
      .values(
        fees.map((f) => ({
          tokenId: f.tokenId,
          amountLamports: f.amountLamports,
          source: f.source,
          txSignature: f.txSignature,
          status: "pending" as const,
          observedAt: f.observedAt,
          isSimulated: provider.isSimulated,
        })),
      )
      .onConflictDoNothing({ target: schema.feeEvents.txSignature })
      .returning({ id: schema.feeEvents.id });
    observed = inserted.length;
  }
  await db
    .insert(schema.workerState)
    .values({ key: CURSOR_KEY, value: cursor, updatedAt: now })
    .onConflictDoUpdate({ target: schema.workerState.key, set: { value: cursor, updatedAt: now } });

  // Confirmations for pending observations (excluding ones just inserted this tick).
  const pending = await db
    .select({ id: schema.feeEvents.id, sig: schema.feeEvents.txSignature })
    .from(schema.feeEvents)
    .where(eq(schema.feeEvents.status, "pending"))
    .limit(500);
  const sigs = pending.map((p) => p.sig).filter((s): s is string => Boolean(s));
  let confirmed = 0;
  if (sigs.length) {
    const statuses = await provider.confirmations(sigs);
    for (const p of pending) {
      const st = p.sig ? statuses.get(p.sig) : undefined;
      if (st === "confirmed") {
        await db
          .update(schema.feeEvents)
          .set({ status: "confirmed", confirmedAt: now })
          .where(and(eq(schema.feeEvents.id, p.id), eq(schema.feeEvents.status, "pending")));
        confirmed++;
      } else if (st === "failed") {
        await db.update(schema.feeEvents).set({ status: "failed" }).where(eq(schema.feeEvents.id, p.id));
      }
    }
  }
  return { observed, confirmed };
}

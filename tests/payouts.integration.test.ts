/**
 * Integration tests for checkpoints and payouts against a real PostgreSQL
 * database (TEST_DATABASE_URL). Covers idempotency, concurrency, fee
 * accounting, the payout state machine and audit-log immutability.
 */
process.env.SIMULATED_PAYOUT_FAILURE_RATE = "0";

import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetTestDatabase } from "./helpers/db";

const hasDb = Boolean(process.env.TEST_DATABASE_URL);
const d = hasDb ? describe : describe.skip;

type Mods = {
  db: typeof import("@/lib/db");
  checkpoints: typeof import("@/lib/services/checkpoints");
  payouts: typeof import("@/lib/services/payouts");
};
let m: Mods;

const DEPLOYER = "Dep1oyer111111111111111111111111111111111111";
const A = "CreatorA11111111111111111111111111111111111";
const B = "CreatorB11111111111111111111111111111111111";
const C = "CreatorC11111111111111111111111111111111111";

async function scenario(opts: { nextCheckpointAt: Date; price?: number; fees?: Array<{ lamports: number; status: "pending" | "confirmed"; confirmedAt?: Date }> }) {
  const { db, schema } = m.db;
  const now = new Date();
  await db.insert(schema.users).values([{ wallet: DEPLOYER }, { wallet: A }, { wallet: B }, { wallet: C }]).onConflictDoNothing();
  const mint = `Mint${Math.random().toString(36).slice(2)}`.padEnd(44, "1").slice(0, 44);
  const [token] = await db
    .insert(schema.tokens)
    .values({
      mint,
      name: "Test",
      symbol: "TEST",
      deployerWallet: DEPLOYER,
      launchProvider: "simulated",
      isSimulated: true,
      totalSupply: 1_000_000_000,
      launchedAt: new Date(now.getTime() - 48 * 3600_000),
    })
    .returning();
  const [comp] = await db
    .insert(schema.competitions)
    .values({
      tokenId: token.id,
      payoutIntervalHours: 6,
      minEligibleViews: 5000,
      rewardCurve: { interpolation: "linear", points: [{ marketCapUsd: 20_000, rewardBps: 5000 }, { marketCapUsd: 100_000, rewardBps: 2500 }] },
      rulesConfigVersion: 1,
      startsAt: new Date(opts.nextCheckpointAt.getTime() - 6 * 3600_000),
      nextCheckpointAt: opts.nextCheckpointAt,
    })
    .returning();

  const video = (wallet: string, id: string, score: number, views: number, status: "verified" | "under_review") => ({
    competitionId: comp.id,
    creatorWallet: wallet,
    platform: "tiktok" as const,
    submittedUrl: `https://www.tiktok.com/@x/video/${id}`,
    canonicalUrl: `https://www.tiktok.com/@x/video/${id}`,
    platformVideoId: id,
    publishedAt: new Date(now.getTime() - 40 * 3600_000),
    publishedAtSource: "simulated",
    submittedAt: new Date(now.getTime() - 30 * 3600_000),
    views,
    viralScore: score,
    status,
  });
  const uid = () => String(7_000_000_000_000_000_000n + BigInt(Math.floor(Math.random() * 1e15)));
  await db.insert(schema.videos).values([
    video(C, uid(), 95, 900_000, "under_review"), // top score but under review → ineligible
    video(B, uid(), 80, 3_000, "verified"), // below 5,000 views → ineligible
    video(A, uid(), 70, 20_000, "verified"), // winner
    video(DEPLOYER, uid(), 75, 50_000, "verified"), // deployer excluded by default config
  ]);

  // 30 minutes of price samples at a constant price → market cap $60,000 → 37.50% (linear curve).
  const price = opts.price ?? 0.00006;
  const samples = Array.from({ length: 30 }, (_, i) => ({
    tokenId: token.id,
    priceUsd: price,
    supply: 1_000_000_000,
    source: "test",
    sampledAt: new Date(opts.nextCheckpointAt.getTime() - (29 - i) * 60_000 - 1000),
  }));
  await db.insert(schema.priceSamples).values(samples);

  for (const f of opts.fees ?? []) {
    await db.insert(schema.feeEvents).values({
      tokenId: token.id,
      amountLamports: f.lamports,
      source: "test",
      txSignature: `sig${Math.random()}`,
      status: f.status,
      confirmedAt: f.status === "confirmed" ? (f.confirmedAt ?? new Date(opts.nextCheckpointAt.getTime() - 3600_000)) : null,
    });
  }
  return { token, comp };
}

d("checkpoints & payouts (PostgreSQL)", () => {
  beforeAll(async () => {
    await resetTestDatabase();
    m = {
      db: await import("@/lib/db"),
      checkpoints: await import("@/lib/services/checkpoints"),
      payouts: await import("@/lib/services/payouts"),
    };
  });

  beforeEach(async () => {
    const { db } = m.db;
    await db.execute(sql`DELETE FROM payout_attempts; DELETE FROM payouts; UPDATE fee_events SET checkpoint_id = NULL; DELETE FROM checkpoints;`);
  });

  afterAll(async () => {
    await m?.db.pool.end();
  });

  it("awards the top eligible video with confirmed fees only, exactly once", async () => {
    const { db, schema } = m.db;
    const at = new Date(Date.now() - 60_000);
    const { comp, token } = await scenario({
      nextCheckpointAt: at,
      fees: [
        { lamports: 1_000_000_000, status: "confirmed" },
        { lamports: 500_000_000, status: "pending" },
        { lamports: 700_000_000, status: "confirmed", confirmedAt: new Date(at.getTime() + 1000) }, // after checkpoint
      ],
    });

    const first = await m.checkpoints.processCheckpoint(comp.id, at);
    expect(first.status).toBe("awarded");
    expect(first.winnerWallet).toBe(A);
    expect(first.rewardLamports).toBe(375_000_000);

    const [cp] = await db.select().from(schema.checkpoints).where(eq(schema.checkpoints.competitionId, comp.id));
    expect(cp.rewardBps).toBe(3750);
    expect(cp.feesInWindowLamports).toBe(1_000_000_000);
    expect(cp.retainedLamports).toBe(625_000_000);
    expect(cp.referenceMarketCapUsd).toBeCloseTo(60_000, 0);

    const unassigned = await db
      .select()
      .from(schema.feeEvents)
      .where(and(eq(schema.feeEvents.tokenId, token.id), isNull(schema.feeEvents.checkpointId)));
    expect(unassigned.map((f) => f.amountLamports).sort()).toEqual([500_000_000, 700_000_000]);

    // Replaying the same checkpoint is a no-op.
    const again = await m.checkpoints.processCheckpoint(comp.id, at);
    expect(again.skipped).toBe("already_processed");
    const payouts = await db.select().from(schema.payouts).where(eq(schema.payouts.competitionId, comp.id));
    expect(payouts).toHaveLength(1);
    expect(payouts[0].recipientWallet).toBe(A);
    expect(payouts[0].status).toBe("pending");

    // The competition advanced to the next boundary.
    const [c2] = await db.select().from(schema.competitions).where(eq(schema.competitions.id, comp.id));
    expect(c2.nextCheckpointAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("creates a single payout under concurrent checkpoint processing", async () => {
    const { db, schema } = m.db;
    const at = new Date(Date.now() - 120_000);
    const { comp } = await scenario({ nextCheckpointAt: at, fees: [{ lamports: 2_000_000_000, status: "confirmed" }] });
    const results = await Promise.all(Array.from({ length: 6 }, () => m.checkpoints.processCheckpoint(comp.id, at)));
    expect(results.filter((r) => r.status === "awarded")).toHaveLength(1);
    const payouts = await db.select().from(schema.payouts).where(eq(schema.payouts.competitionId, comp.id));
    expect(payouts).toHaveLength(1);
  });

  it("rolls fees over when no reliable reference price exists", async () => {
    const { db, schema } = m.db;
    const at = new Date(Date.now() - 30_000);
    const { comp } = await scenario({ nextCheckpointAt: at, fees: [{ lamports: 1_000_000_000, status: "confirmed" }] });
    await db.execute(sql`DELETE FROM price_samples WHERE token_id = (SELECT token_id FROM competitions WHERE id = ${comp.id})`);
    const r = await m.checkpoints.processCheckpoint(comp.id, at);
    expect(r.status).toBe("skipped_price_data");
    const assigned = await db.select().from(schema.feeEvents).where(sql`checkpoint_id IS NOT NULL`);
    expect(assigned).toHaveLength(0);
  });

  it("executes, confirms only on finality, and never double-sends under concurrency", async () => {
    const { db, schema } = m.db;
    const at = new Date(Date.now() - 45_000);
    const { comp } = await scenario({ nextCheckpointAt: at, fees: [{ lamports: 3_000_000_000, status: "confirmed" }] });
    await m.checkpoints.processCheckpoint(comp.id, at);

    await Promise.all([m.payouts.executePayouts(), m.payouts.executePayouts(), m.payouts.executePayouts()]);
    const [p1] = await db.select().from(schema.payouts).where(eq(schema.payouts.competitionId, comp.id));
    const attempts = await db.select().from(schema.payoutAttempts).where(eq(schema.payoutAttempts.payoutId, p1.id));
    expect(attempts).toHaveLength(1);
    expect(["submitted", "confirmed"]).toContain(p1.status);

    await m.payouts.executePayouts();
    const [p2] = await db.select().from(schema.payouts).where(eq(schema.payouts.id, p1.id));
    expect(p2.status).toBe("confirmed");
    expect(p2.signature).toBe(attempts[0].signature);
    expect(p2.isSimulated).toBe(true);
  });

  it("voiding returns fees to the pool; audit log is append-only", async () => {
    const { db, schema } = m.db;
    const at = new Date(Date.now() - 50_000);
    const { comp, token } = await scenario({ nextCheckpointAt: at, fees: [{ lamports: 1_500_000_000, status: "confirmed" }] });
    await m.checkpoints.processCheckpoint(comp.id, at);
    const [p] = await db.select().from(schema.payouts).where(eq(schema.payouts.competitionId, comp.id));
    await db.update(schema.payouts).set({ status: "requires_attention" }).where(eq(schema.payouts.id, p.id));

    await m.payouts.voidPayout(p.id, { wallet: "ADMIN", role: "admin" }, "test void");
    const fees = await db.select().from(schema.feeEvents).where(eq(schema.feeEvents.tokenId, token.id));
    expect(fees.every((f) => f.checkpointId === null)).toBe(true);
    const [cp] = await db.select().from(schema.checkpoints).where(eq(schema.checkpoints.id, p.checkpointId));
    expect(cp.status).toBe("voided");

    await expect(db.execute(sql`UPDATE audit_logs SET action = 'tampered'`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM audit_logs`)).rejects.toThrow();
  });

  it("rejects a second in-flight attempt at the database level", async () => {
    const { db, schema } = m.db;
    const at = new Date(Date.now() - 55_000);
    const { comp } = await scenario({ nextCheckpointAt: at, fees: [{ lamports: 1_000_000_000, status: "confirmed" }] });
    await m.checkpoints.processCheckpoint(comp.id, at);
    const [p] = await db.select().from(schema.payouts).where(eq(schema.payouts.competitionId, comp.id));
    const attempt = (n: number) => ({
      payoutId: p.id,
      attemptNo: n,
      signature: `s${n}${Math.random()}`,
      blockhash: "b",
      lastValidBlockHeight: 1,
      rawTransaction: "x",
      status: "sent" as const,
    });
    await db.insert(schema.payoutAttempts).values(attempt(1));
    await expect(db.insert(schema.payoutAttempts).values(attempt(2))).rejects.toThrow();
  });
});

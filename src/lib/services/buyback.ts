/**
 * The VYRAL platform wallet.
 *
 * Every coin locks the treasury and buyback parts of its creator fees to this
 * one wallet (CREATOR_FEE_SPLIT). Each run:
 *   1. reads the wallet's new deposits and splits each one: the treasury's
 *      part is owed to FEE_TREASURY_ADDRESS, the rest is the buyback budget;
 *   2. forwards what the treasury is owed;
 *   3. buys the official coin (platform_token) with the budget through
 *      Jupiter, in pieces that stay under BUYBACK_MAX_PRICE_IMPACT_PCT;
 *   4. burns every token of the official coin the wallet holds.
 *
 * Accounting lives in worker_state "buyback:ledger". A transaction is recorded
 * there with its signature BEFORE it is sent, and settled from the chain on a
 * later run if this one stops half-way, so nothing is paid or counted twice.
 * Until the official coin exists the budget simply accumulates.
 */
import bs58 from "bs58";
import { eq, isNull, and, desc, sql } from "drizzle-orm";
import { createBurnCheckedInstruction, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import { getConfig } from "@/lib/config/store";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { CREATOR_FEE_SPLIT } from "@/lib/launch/fee-split";

const LEDGER_KEY = "buyback:ledger";
const RESERVE_LAMPORTS = 10_000_000; // kept for network fees and token-account rent
const MIN_FORWARD_LAMPORTS = 10_000_000;
const MIN_BUY_LAMPORTS = 10_000_000;
const MAX_TX_SCANNED = 150;

type Pending = {
  kind: "transfer" | "swap" | "burn";
  signature: string;
  lamports: number;
  lastValidBlockHeight: number;
  mint?: string;
  /** Burns: amount in base units and decimals. */
  tokens?: string;
  decimals?: number;
};
export type Ledger = {
  cursor?: string;
  /** Lamports received in deposits (all time). */
  received: number;
  /** Treasury's part not forwarded yet. */
  treasuryOwed: number;
  /** Lamports set aside for buybacks and not spent yet. */
  budget: number;
  pending?: Pending | null;
};

const emptyLedger = (): Ledger => ({ received: 0, treasuryOwed: 0, budget: 0, pending: null });

export async function readLedger(): Promise<Ledger> {
  const [row] = await db.select().from(schema.workerState).where(eq(schema.workerState.key, LEDGER_KEY));
  return { ...emptyLedger(), ...((row?.value as Partial<Ledger> | undefined) ?? {}) };
}
async function saveLedger(l: Ledger) {
  await db
    .insert(schema.workerState)
    .values({ key: LEDGER_KEY, value: l as unknown as Record<string, unknown>, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.workerState.key, set: { value: l as unknown as Record<string, unknown>, updatedAt: new Date() } });
}

/** Splits a deposit into the treasury's part and the buyback budget (10 : 20 of the platform's 30). */
export function splitDeposit(lamports: number) {
  const platform = CREATOR_FEE_SPLIT.treasuryBps + CREATOR_FEE_SPLIT.buybackBps;
  const treasury = Math.floor((lamports * CREATOR_FEE_SPLIT.treasuryBps) / platform);
  return { treasury, buyback: lamports - treasury };
}

/** Largest amount (halving from `amount`) whose quote stays within the price impact cap, or null. */
export async function sizeWithinImpact(
  amount: number,
  quote: (lamports: number) => Promise<{ priceImpactPct: string }>,
  maxImpactPct: number,
  minLamports = MIN_BUY_LAMPORTS,
) {
  for (let a = Math.floor(amount); a >= minLamports; a = Math.floor(a / 2)) {
    const q = await quote(a);
    if (Number(q.priceImpactPct) * 100 <= maxImpactPct) return { lamports: a, quote: q };
  }
  return null;
}

function signer(): Keypair {
  const v = (env.PLATFORM_SIGNER_SECRET_KEY ?? "").trim().replace(/^["']|["']$/g, "");
  let kp: Keypair;
  try {
    kp = Keypair.fromSecretKey(v.startsWith("[") ? Uint8Array.from(JSON.parse(v) as number[]) : bs58.decode(v));
  } catch {
    throw new Error("PLATFORM_SIGNER_SECRET_KEY is not a valid Solana private key.");
  }
  if (env.PLATFORM_FEE_ADDRESS && !kp.publicKey.equals(new PublicKey(env.PLATFORM_FEE_ADDRESS))) {
    throw new Error("PLATFORM_SIGNER_SECRET_KEY does not match PLATFORM_FEE_ADDRESS.");
  }
  return kp;
}

async function jupiter<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${env.JUPITER_SWAP_API_URL}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok || body.error) throw new Error(`Jupiter ${path.split("?")[0]}: ${body.error ?? res.status}`);
  return body;
}

export async function runBuyback() {
  if (!env.PLATFORM_FEE_ADDRESS || !env.PLATFORM_SIGNER_SECRET_KEY || !env.SOLANA_RPC_URL) return { skipped: "not_configured" };
  if (env.SOLANA_CLUSTER === "mainnet-beta" && !env.PAYOUT_ALLOW_HOT_WALLET) return { skipped: "hot_wallet_not_allowed" };
  const kp = signer();
  const wallet = kp.publicKey;
  const c = new Connection(env.SOLANA_RPC_URL, "confirmed");
  const ledger = await readLedger();
  const result: Record<string, unknown> = {};

  // 0. Settle a transaction a previous run sent but did not finish recording.
  if (ledger.pending) {
    const settled = await settle(c, ledger, ledger.pending);
    if (!settled) return { waiting: ledger.pending.kind };
  }

  // 1. New deposits (oldest first). The wallet's own transactions (forwarding, swaps, burns) are not deposits.
  const deposits = await scanDeposits(c, wallet, ledger);
  if (deposits) result.deposits = deposits;
  await saveLedger(ledger);

  let balance = await c.getBalance(wallet, "confirmed");

  // 2. Forward the treasury's part.
  if (env.FEE_TREASURY_ADDRESS && ledger.treasuryOwed >= MIN_FORWARD_LAMPORTS && balance >= ledger.treasuryOwed + RESERVE_LAMPORTS) {
    const lamports = ledger.treasuryOwed;
    const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: wallet, blockhash, lastValidBlockHeight }).add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
      SystemProgram.transfer({ fromPubkey: wallet, toPubkey: new PublicKey(env.FEE_TREASURY_ADDRESS), lamports }),
    );
    tx.sign(kp);
    await sendRecorded(c, ledger, { kind: "transfer", signature: bs58.encode(tx.signature!), lamports, lastValidBlockHeight }, tx.serialize());
    result.forwarded = lamports;
    balance = await c.getBalance(wallet, "confirmed");
  }

  // 3. Buy the official coin with the budget.
  const { value: token } = await getConfig("platform_token");
  if (token.mint) {
    const mint = token.mint;
    const spendable = Math.min(ledger.budget, env.BUYBACK_MAX_LAMPORTS_PER_RUN, balance - RESERVE_LAMPORTS - ledger.treasuryOwed);
    if (spendable >= MIN_BUY_LAMPORTS) {
      type Quote = { priceImpactPct: string; outAmount: string };
      const quote = (lamports: number) =>
        jupiter<Quote>(`/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${mint}&amount=${lamports}&slippageBps=300`);
      const sized = await sizeWithinImpact(spendable, quote, env.BUYBACK_MAX_PRICE_IMPACT_PCT);
      if (!sized) {
        result.buy = "skipped_price_impact";
      } else {
        const swap = await jupiter<{ swapTransaction: string; lastValidBlockHeight: number }>("/swap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quoteResponse: sized.quote,
            userPublicKey: wallet.toBase58(),
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 1_000_000, priorityLevel: "high" } },
          }),
        });
        const tx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, "base64"));
        if (!tx.message.staticAccountKeys[0].equals(wallet)) throw new Error("Jupiter returned a transaction for another fee payer.");
        tx.sign([kp]);
        await sendRecorded(
          c,
          ledger,
          { kind: "swap", signature: bs58.encode(tx.signatures[0]), lamports: sized.lamports, lastValidBlockHeight: swap.lastValidBlockHeight, mint },
          tx.serialize(),
        );
        result.bought = sized.lamports;
      }
    }

    // 4. Burn everything of the official coin the wallet holds (also any leftovers from earlier runs).
    const burned = await burnHoldings(c, kp, ledger, mint);
    if (burned) result.burned = burned;
  } else {
    result.buy = "waiting_for_official_coin";
  }
  result.budget = ledger.budget;
  result.treasuryOwed = ledger.treasuryOwed;
  return result;
}

async function scanDeposits(c: Connection, wallet: PublicKey, ledger: Ledger) {
  const sigs = [];
  let before: string | undefined;
  for (let page = 0; page < 5; page++) {
    const batch = await c.getSignaturesForAddress(wallet, { until: ledger.cursor, before, limit: 1000 }, "confirmed");
    sigs.push(...batch);
    if (batch.length < 1000) break;
    before = batch[batch.length - 1].signature;
  }
  sigs.reverse();
  let count = 0;
  let total = 0;
  let read = 0;
  for (const s of sigs) {
    if (!s.err) {
      if (read++ >= MAX_TX_SCANNED) break;
      const tx = await c.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 1, commitment: "confirmed" });
      if (!tx?.meta) break; // not available yet: continue from here next run
      const received = depositAmount(tx, wallet.toBase58());
      if (received > 0) {
        const part = splitDeposit(received);
        ledger.received += received;
        ledger.treasuryOwed += part.treasury;
        ledger.budget += part.buyback;
        count++;
        total += received;
      }
    }
    ledger.cursor = s.signature;
  }
  return count ? { count, lamports: total } : null;
}

/** Lamports a transaction paid into the wallet; 0 for the wallet's own transactions (it signs those). */
export function depositAmount(tx: ParsedTransactionWithMeta, wallet: string): number {
  if (!tx.meta || tx.meta.err) return 0;
  const keys = tx.transaction.message.accountKeys;
  const i = keys.findIndex((k) => k.pubkey.toBase58() === wallet);
  if (i < 0 || keys[i].signer) return 0;
  return Math.max(0, tx.meta.postBalances[i] - tx.meta.preBalances[i]);
}

/** Records the transaction as pending, sends it, waits for it and settles it. */
async function sendRecorded(c: Connection, ledger: Ledger, pending: Pending, raw: Uint8Array) {
  ledger.pending = pending;
  await saveLedger(ledger);
  await c.sendRawTransaction(raw, { maxRetries: 3 });
  // Wait briefly (serverless time limit); a later run settles it from the chain otherwise.
  for (let i = 0; i < 8; i++) {
    if (await settle(c, ledger, pending)) return;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  // Still unknown: the next run settles it from the chain.
}

/** Settles a pending transaction from its on-chain status. Returns false while it may still land. */
async function settle(c: Connection, ledger: Ledger, p: Pending): Promise<boolean> {
  const { value } = await c.getSignatureStatuses([p.signature], { searchTransactionHistory: true });
  const st = value[0];
  if (st && !st.err && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
    await db.transaction(async (tx) => {
      if (p.kind === "transfer") {
        await tx.insert(schema.buybackEvents).values({ kind: "treasury", lamports: p.lamports, transferSignature: p.signature }).onConflictDoNothing();
        ledger.treasuryOwed = Math.max(0, ledger.treasuryOwed - p.lamports);
      } else if (p.kind === "swap") {
        await tx.insert(schema.buybackEvents).values({ kind: "buyback", lamports: p.lamports, mint: p.mint, swapSignature: p.signature }).onConflictDoNothing();
        ledger.budget = Math.max(0, ledger.budget - p.lamports);
      } else if (p.kind === "burn" && p.tokens && p.decimals !== undefined && p.mint) {
        await recordBurn(tx, p.signature, p.mint, p.tokens, p.decimals);
      }
      ledger.pending = null;
      await tx
        .insert(schema.workerState)
        .values({ key: LEDGER_KEY, value: ledger as unknown as Record<string, unknown>, updatedAt: new Date() })
        .onConflictDoUpdate({ target: schema.workerState.key, set: { value: ledger as unknown as Record<string, unknown>, updatedAt: new Date() } });
    });
    return true;
  }
  const height = await c.getBlockHeight("confirmed");
  if (st?.err || (!st && height > p.lastValidBlockHeight)) {
    // Failed, or expired without landing: nothing moved.
    ledger.pending = null;
    await saveLedger(ledger);
    return true;
  }
  return false;
}

async function burnHoldings(c: Connection, kp: Keypair, ledger: Ledger, mintAddress: string) {
  const mint = new PublicKey(mintAddress);
  const info = await c.getAccountInfo(mint, "confirmed");
  if (!info) return null;
  const tokenProgram = info.owner;
  const ata = getAssociatedTokenAddressSync(mint, kp.publicKey, false, tokenProgram);
  const bal = await c.getTokenAccountBalance(ata, "confirmed").catch(() => null);
  const amount = bal ? BigInt(bal.value.amount) : 0n;
  if (amount === 0n) return null;
  const { decimals } = await getMint(c, mint, "confirmed", tokenProgram);
  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight }).add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
    createBurnCheckedInstruction(ata, mint, kp.publicKey, amount, decimals, [], tokenProgram),
  );
  tx.sign(kp);
  const signature = bs58.encode(tx.signature!);
  await sendRecorded(c, ledger, { kind: "burn", signature, lamports: 0, lastValidBlockHeight, mint: mintAddress, tokens: amount.toString(), decimals }, tx.serialize());
  return { tokens: amount.toString(), signature };
}

/** Attaches a burn to the latest buy without one, or records it on its own (leftovers). Idempotent per signature. */
async function recordBurn(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], signature: string, mint: string, tokens: string, decimals: number) {
  const [done] = await tx.select({ id: schema.buybackEvents.id }).from(schema.buybackEvents).where(eq(schema.buybackEvents.burnSignature, signature)).limit(1);
  if (done) return;
  const [open] = await tx
    .select({ id: schema.buybackEvents.id })
    .from(schema.buybackEvents)
    .where(and(eq(schema.buybackEvents.kind, "buyback"), isNull(schema.buybackEvents.burnSignature)))
    .orderBy(desc(schema.buybackEvents.createdAt))
    .limit(1);
  if (open) {
    await tx.update(schema.buybackEvents).set({ burnSignature: signature, tokensBurned: tokens, decimals }).where(eq(schema.buybackEvents.id, open.id));
  } else {
    await tx.insert(schema.buybackEvents).values({ kind: "buyback", lamports: 0, mint, burnSignature: signature, tokensBurned: tokens, decimals });
  }
}

/** Public numbers for the Burns page. */
export async function buybackStats() {
  const [totals] = (
    await db.execute(sql`
      SELECT
        coalesce(sum(lamports) FILTER (WHERE kind = 'buyback'), 0)::bigint AS spent,
        coalesce(sum(lamports) FILTER (WHERE kind = 'treasury'), 0)::bigint AS forwarded,
        coalesce(sum(tokens_burned::numeric) FILTER (WHERE kind = 'buyback'), 0)::text AS burned,
        max(decimals) AS decimals,
        count(*) FILTER (WHERE kind = 'buyback' AND burn_signature IS NOT NULL)::int AS burns
      FROM buyback_events`)
  ).rows as Array<{ spent: string; forwarded: string; burned: string; decimals: number | null; burns: number }>;
  const recent = await db.select().from(schema.buybackEvents).orderBy(desc(schema.buybackEvents.createdAt)).limit(50);
  const ledger = await readLedger();
  return {
    spentLamports: Number(totals.spent),
    forwardedLamports: Number(totals.forwarded),
    burnedRaw: totals.burned.split(".")[0],
    decimals: totals.decimals,
    burns: totals.burns,
    budgetLamports: ledger.budget,
    receivedLamports: ledger.received,
    recent,
  };
}

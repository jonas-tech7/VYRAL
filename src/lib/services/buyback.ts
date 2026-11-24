/**
 * The VYRAL platform wallet.
 *
 * Every coin locks the treasury and buyback parts of its creator fees to this
 * one wallet (CREATOR_FEE_SPLIT). Each run:
 *   1. reads the wallet's new creator-fee deposits (gap-free, see
 *      lib/solana/scan.ts) and splits each one: the treasury's part is owed
 *      to FEE_TREASURY_ADDRESS, the rest is the buyback budget;
 *   2. forwards what the treasury is owed;
 *   3. buys the official coin (platform_token) with the budget through
 *      Jupiter, in pieces that stay under BUYBACK_MAX_PRICE_IMPACT_PCT. The
 *      swap transaction Jupiter returns is checked (programs, signers) and
 *      simulated before it is signed: it must spend at most the amount and
 *      fees and deliver at least the quoted minimum to the wallet's own
 *      token account;
 *   4. burns every token of the official coin the wallet holds.
 *
 * Accounting lives in worker_state "buyback:ledger". A transaction is recorded
 * there with its signature BEFORE it is sent and settled from the chain (on
 * this or a later run) before anything else is sent, so nothing is paid or
 * counted twice. Network fees and account rent are paid from the buyback
 * budget. Plain transfers into the wallet (topping it up for network fees)
 * are not fee income and are left alone. Until the official coin exists the
 * budget simply accumulates.
 */
import bs58 from "bs58";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createBurnCheckedInstruction, getAssociatedTokenAddressSync, unpackAccount } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  type ConfirmedSignatureInfo,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import { getConfig } from "@/lib/config/store";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { CREATOR_FEE_SPLIT } from "@/lib/launch/fee-split";
import { scanSignatures, type ScanState } from "@/lib/solana/scan";

export const BUYBACK_LEDGER_KEY = "buyback:ledger";
const LEDGER_KEY = BUYBACK_LEDGER_KEY;
const SOL_MINT = "So11111111111111111111111111111111111111112";
const RESERVE_LAMPORTS = 10_000_000; // kept for network fees and token-account rent
const MIN_FORWARD_LAMPORTS = 10_000_000;
const MIN_BUY_LAMPORTS = 20_000_000;
/** Transactions read per run (each is one RPC call); the rest follow on the next run. */
const MAX_TX_SCANNED = 60;
const SLIPPAGE_BPS = 300;
const MAX_PRIORITY_FEE_LAMPORTS = 300_000;
/**
 * What a swap may cost on top of the amount: network and priority fees plus new accounts' rent (measured on mainnet:
 * a first pump.fun buy costs ~0.0029 SOL extra for the token account and pump.fun's volume account).
 */
const SWAP_COST_ALLOWANCE = 10_000_000;
/** Jupiter answers for a coin it cannot route (yet), e.g. right after launch: the buy waits, nothing fails. */
const NO_ROUTE_CODES = new Set(["TOKEN_NOT_TRADABLE", "COULD_NOT_FIND_ANY_ROUTE", "NO_ROUTES_FOUND"]);
/** pump.fun programs: every creator-fee distribution runs through them. */
const PUMP_PROGRAMS = new Set([
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", // bonding curve
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", // AMM (graduated coins)
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ", // fee sharing
]);
/** Programs a Jupiter swap transaction may call; anything else is refused before signing. */
const SWAP_PROGRAMS = new Set([
  ComputeBudgetProgram.programId.toBase58(),
  SystemProgram.programId.toBase58(),
  ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", // Jupiter aggregator v6
]);

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
  /** Replaced by `scan` (the newest signature read by the first version). */
  cursor?: string;
  scan?: ScanState;
  /** Lamports received in creator-fee deposits (all time). */
  received: number;
  /** Treasury's part not forwarded yet. */
  treasuryOwed: number;
  /** Lamports set aside for buybacks and not spent yet. */
  budget: number;
  /** Network fees and account rent the wallet's own transactions paid (from the budget). */
  costs?: number;
  pending?: Pending | null;
};
type Outcome = "landed" | "failed" | "expired" | "waiting";

const emptyLedger = (): Ledger => ({ received: 0, treasuryOwed: 0, budget: 0, pending: null });

export async function readLedger(): Promise<Ledger> {
  const [row] = await db.select().from(schema.workerState).where(eq(schema.workerState.key, LEDGER_KEY));
  return { ...emptyLedger(), ...((row?.value as Partial<Ledger> | undefined) ?? {}) };
}
async function saveLedger(l: Ledger, tx: Pick<typeof db, "insert"> = db) {
  await tx
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

/** Size of the reference buy the price impact is measured against (0.001 SOL). */
const REFERENCE_LAMPORTS = 1_000_000;

/**
 * Largest amount (halving from `amount`) whose price impact stays within the cap, or null. Jupiter reports no
 * impact for some bonding-curve routes (measured on mainnet: "0" for a buy that cost 6.4 % more on average), so the
 * impact is also measured, as the buy's average price against that of a tiny reference buy, and the larger counts.
 */
export async function sizeWithinImpact<Q extends { priceImpactPct: string; outAmount: string }>(
  amount: number,
  quote: (lamports: number) => Promise<Q>,
  maxImpactPct: number,
  minLamports = MIN_BUY_LAMPORTS,
) {
  if (Math.floor(amount) < minLamports) return null;
  const refOut = Number((await quote(REFERENCE_LAMPORTS)).outAmount);
  for (let a = Math.floor(amount); a >= minLamports; a = Math.floor(a / 2)) {
    const q = await quote(a);
    const out = Number(q.outAmount);
    const measured = out > 0 && refOut > 0 ? ((refOut / REFERENCE_LAMPORTS) / (out / a) - 1) * 100 : Infinity;
    const reported = Number(q.priceImpactPct) * 100;
    const impact = Math.max(Number.isFinite(reported) ? reported : 0, measured);
    if (impact <= maxImpactPct) return { lamports: a, quote: q, impactPct: Math.max(0, impact) };
  }
  return null;
}

export type Quote = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  priceImpactPct: string;
};

/** Checks that a quote is exactly the buy that was asked for; returns the problem or null. */
export function checkQuote(q: Quote, mint: string, lamports: number, maxSlippageBps = SLIPPAGE_BPS): string | null {
  if (q.inputMint !== SOL_MINT || q.outputMint !== mint) return "wrong tokens";
  if (q.swapMode !== "ExactIn" || q.inAmount !== String(lamports)) return "wrong amount";
  let out: bigint, min: bigint;
  try {
    out = BigInt(q.outAmount);
    min = BigInt(q.otherAmountThreshold);
  } catch {
    return "unreadable amounts";
  }
  if (out <= 0n || min <= 0n || min > out) return "invalid output";
  if (min * 10_000n < out * BigInt(10_000 - maxSlippageBps)) return "minimum output below the slippage limit";
  return null;
}

/** Refuses a swap transaction that is not just a swap paid and signed by the wallet; returns the problem or null. */
export function checkSwapTransaction(tx: VersionedTransaction, wallet: PublicKey): string | null {
  const m = tx.message;
  if (!m.staticAccountKeys[0]?.equals(wallet)) return "another fee payer";
  if (m.header.numRequiredSignatures !== 1) return "other signers";
  for (const ix of m.compiledInstructions) {
    // Programs are always static keys (the runtime refuses programs loaded from lookup tables).
    const program = m.staticAccountKeys[ix.programIdIndex];
    if (!program || !SWAP_PROGRAMS.has(program.toBase58())) return `unexpected program ${program?.toBase58() ?? `#${ix.programIdIndex}`}`;
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

class JupiterError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function jupiter<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${env.JUPITER_SWAP_API_URL}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; errorCode?: string };
  if (!res.ok || body.error) throw new JupiterError(`Jupiter ${path.split("?")[0]}: ${body.error ?? res.status}`, body.errorCode);
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

  // 0. A transaction an earlier run sent must be settled before anything else is sent.
  if (ledger.pending) {
    const kind = ledger.pending.kind;
    if ((await settle(c, ledger, ledger.pending)) === "waiting") return { waiting: kind };
  }

  // 1. New deposits. The wallet's own transactions (forwarding, swaps, burns) are not deposits.
  const deposits = await scanDeposits(c, wallet, ledger);
  if (deposits) result.deposits = deposits;
  await saveLedger(ledger);

  let balance = await c.getBalance(wallet, "confirmed");

  // 2. Forward the treasury's part.
  const treasury = env.FEE_TREASURY_ADDRESS && env.FEE_TREASURY_ADDRESS !== env.PLATFORM_FEE_ADDRESS ? new PublicKey(env.FEE_TREASURY_ADDRESS) : null;
  if (treasury && ledger.treasuryOwed >= MIN_FORWARD_LAMPORTS && balance >= ledger.treasuryOwed + RESERVE_LAMPORTS) {
    const lamports = ledger.treasuryOwed;
    const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: wallet, blockhash, lastValidBlockHeight }).add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
      SystemProgram.transfer({ fromPubkey: wallet, toPubkey: treasury, lamports }),
    );
    tx.sign(kp);
    const outcome = await sendRecorded(c, ledger, { kind: "transfer", signature: bs58.encode(tx.signature!), lamports, lastValidBlockHeight }, tx.serialize());
    if (outcome === "waiting") return { ...result, waiting: "transfer" };
    result.forwarded = outcome === "landed" ? lamports : outcome;
    balance = await c.getBalance(wallet, "confirmed");
  }

  // 3. Buy the official coin with the budget.
  const { value: token } = await getConfig("platform_token");
  if (!token.mint) {
    result.buy = "waiting_for_official_coin";
    return { ...result, budget: ledger.budget, treasuryOwed: ledger.treasuryOwed };
  }
  const mint = new PublicKey(token.mint);
  const mintInfo = await c.getAccountInfo(mint, "confirmed");
  const tokenProgram = mintInfo?.owner;
  if (!tokenProgram || !(tokenProgram.equals(TOKEN_PROGRAM_ID) || tokenProgram.equals(TOKEN_2022_PROGRAM_ID))) {
    result.buy = "official_coin_not_found";
    return { ...result, budget: ledger.budget, treasuryOwed: ledger.treasuryOwed };
  }
  const ata = getAssociatedTokenAddressSync(mint, wallet, false, tokenProgram);

  const spendable = Math.min(ledger.budget, env.BUYBACK_MAX_LAMPORTS_PER_RUN, balance - RESERVE_LAMPORTS - ledger.treasuryOwed);
  if (spendable >= MIN_BUY_LAMPORTS) {
    const quote = (lamports: number) =>
      jupiter<Quote>(
        `/quote?inputMint=${SOL_MINT}&outputMint=${mint.toBase58()}&amount=${lamports}&slippageBps=${SLIPPAGE_BPS}&swapMode=ExactIn&restrictIntermediateTokens=true`,
      );
    const sized = await sizeWithinImpact(spendable, quote, env.BUYBACK_MAX_PRICE_IMPACT_PCT).catch((e: unknown) => {
      if (e instanceof JupiterError && e.code && NO_ROUTE_CODES.has(e.code)) return "no_route" as const;
      throw e;
    });
    if (sized === "no_route") {
      result.buy = "no_route_yet";
    } else if (!sized) {
      result.buy = "skipped_price_impact";
    } else {
      const badQuote = checkQuote(sized.quote, mint.toBase58(), sized.lamports);
      if (badQuote) throw new Error(`Refused Jupiter's quote: ${badQuote}`);
      const swap = await jupiter<{ swapTransaction: string }>("/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: sized.quote,
          userPublicKey: wallet.toBase58(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: MAX_PRIORITY_FEE_LAMPORTS, priorityLevel: "high" } },
        }),
      });
      const tx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, "base64"));
      const refused = checkSwapTransaction(tx, wallet);
      if (refused) throw new Error(`Refused Jupiter's swap transaction: ${refused}`);
      // Our own blockhash, so the expiry used to settle the swap does not come from the API.
      const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
      tx.message.recentBlockhash = blockhash;
      const unsafe = await simulateSwap(c, tx, {
        wallet,
        ata,
        mint,
        tokenProgram,
        minOut: BigInt(sized.quote.otherAmountThreshold),
        maxSpend: sized.lamports + SWAP_COST_ALLOWANCE,
      });
      if (unsafe) {
        console.warn(`[buyback] swap not sent: ${unsafe}`);
        result.buy = `skipped: ${unsafe}`;
      } else {
        tx.sign([kp]);
        const outcome = await sendRecorded(
          c,
          ledger,
          { kind: "swap", signature: bs58.encode(tx.signatures[0]), lamports: sized.lamports, lastValidBlockHeight, mint: mint.toBase58() },
          tx.serialize(),
        );
        if (outcome === "waiting") return { ...result, waiting: "swap" };
        result.bought = outcome === "landed" ? sized.lamports : outcome;
        result.priceImpactPct = Number(sized.impactPct.toFixed(3));
      }
    }
  }

  // 4. Burn everything of the official coin the wallet holds (also any leftovers from earlier runs).
  const burned = await burnHoldings(c, kp, ledger, mint, ata, tokenProgram);
  if (burned) result.burned = burned;
  return { ...result, budget: ledger.budget, treasuryOwed: ledger.treasuryOwed };
}

async function scanDeposits(c: Connection, wallet: PublicKey, ledger: Ledger) {
  const address = wallet.toBase58();
  let count = 0;
  let total = 0;
  const start: ScanState = ledger.scan ?? (ledger.cursor ? { head: ledger.cursor } : {});
  const handle = async (s: ConfirmedSignatureInfo) => {
    const tx = await c.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    if (!tx?.meta) {
      // Normally served within seconds. One that stays unavailable for an hour is passed over so the scan cannot stall.
      if (!s.blockTime || Date.now() / 1000 - s.blockTime < 3_600) return "retry" as const;
      console.error(`[buyback] transaction ${s.signature} unavailable for over an hour; not counted`);
      return "done" as const;
    }
    const received = depositAmount(tx, address);
    if (received > 0) {
      const part = splitDeposit(received);
      ledger.received += received;
      ledger.treasuryOwed += part.treasury;
      ledger.budget += part.buyback;
      count++;
      total += received;
    }
    return "done" as const;
  };
  const res = await scanSignatures(c, wallet, start, handle, { maxReads: MAX_TX_SCANNED });
  ledger.scan = res.state;
  delete ledger.cursor;
  return count ? { count, lamports: total } : null;
}

/**
 * Creator fees a transaction paid into the wallet. 0 for the wallet's own transactions (it signs those), failed
 * ones, and transfers that are not a pump.fun fee distribution (e.g. topping the wallet up for network fees).
 */
export function depositAmount(tx: ParsedTransactionWithMeta, wallet: string): number {
  if (!tx.meta || tx.meta.err) return 0;
  const keys = tx.transaction.message.accountKeys;
  const i = keys.findIndex((k) => k.pubkey.toBase58() === wallet);
  if (i < 0 || keys[i].signer) return 0;
  if (!keys.some((k) => PUMP_PROGRAMS.has(k.pubkey.toBase58()))) return 0;
  return Math.max(0, tx.meta.postBalances[i] - tx.meta.preBalances[i]);
}

/**
 * Simulates the swap and checks its result before it is signed: the wallet stays a plain wallet and spends at most
 * `maxSpend`, and its own token account (no delegate, no close authority) receives at least `minOut`.
 */
export async function simulateSwap(
  c: Connection,
  tx: VersionedTransaction,
  p: { wallet: PublicKey; ata: PublicKey; mint: PublicKey; tokenProgram: PublicKey; minOut: bigint; maxSpend: number },
): Promise<string | null> {
  const [lamportsBefore, tokensBefore] = await Promise.all([
    c.getBalance(p.wallet, "confirmed"),
    c
      .getTokenAccountBalance(p.ata, "confirmed")
      .then((b) => BigInt(b.value.amount))
      .catch(() => 0n),
  ]);
  const sim = await c.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: false,
    commitment: "confirmed",
    accounts: { encoding: "base64", addresses: [p.wallet.toBase58(), p.ata.toBase58()] },
  });
  if (sim.value.err) return `simulation failed (${JSON.stringify(sim.value.err)})`;
  const [w, a] = sim.value.accounts ?? [];
  if (!w || w.owner !== SystemProgram.programId.toBase58()) return "the wallet would change owner";
  if (lamportsBefore - w.lamports > p.maxSpend) return `it would spend ${lamportsBefore - w.lamports} lamports`;
  if (!a) return "no token account after the swap";
  const account = unpackAccount(
    p.ata,
    { data: Buffer.from(a.data[0], "base64"), owner: new PublicKey(a.owner), lamports: a.lamports, executable: a.executable },
    p.tokenProgram,
  );
  if (!account.mint.equals(p.mint) || !account.owner.equals(p.wallet) || account.delegate || account.closeAuthority) {
    return "the token account would change hands";
  }
  if (account.amount - tokensBefore < p.minOut) return "it would receive less than the quoted minimum";
  return null;
}

/** Records the transaction as pending, sends it and waits briefly for it; a later run settles it otherwise. */
async function sendRecorded(c: Connection, ledger: Ledger, pending: Pending, raw: Uint8Array): Promise<Outcome> {
  ledger.pending = pending;
  await saveLedger(ledger);
  await c.sendRawTransaction(raw, { maxRetries: 3 });
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 2_000));
    const outcome = await settle(c, ledger, pending);
    if (outcome !== "waiting") return outcome;
  }
  return "waiting";
}

/** Settles a pending transaction from the chain: books what it moved (and its cost) once, or drops it if it can no longer land. */
async function settle(c: Connection, ledger: Ledger, p: Pending): Promise<Outcome> {
  // Block height first: once it is past the transaction's last valid height no later block can include it,
  // so a status lookup made after it is final.
  const height = await c.getBlockHeight("confirmed");
  const { value } = await c.getSignatureStatuses([p.signature], { searchTransactionHistory: true });
  const st = value[0];
  if (!st) {
    if (height <= p.lastValidBlockHeight) return "waiting";
    ledger.pending = null; // expired without landing: nothing moved
    await saveLedger(ledger);
    return "expired";
  }
  if (st.confirmationStatus !== "confirmed" && st.confirmationStatus !== "finalized") return "waiting";
  const tx = await c.getTransaction(p.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  if (!tx?.meta) return "waiting"; // landed; details not served yet
  // What left the wallet (the fee payer, first account): the amount, the network fee and any new account's rent.
  const spent = Math.max(0, tx.meta.preBalances[0] - tx.meta.postBalances[0]);
  const failed = st.err !== null || tx.meta.err !== null;
  await db.transaction(async (dbtx) => {
    let cost = spent; // a failed transaction moved nothing but its fee
    if (!failed && p.kind === "transfer") {
      await dbtx.insert(schema.buybackEvents).values({ kind: "treasury", lamports: p.lamports, transferSignature: p.signature }).onConflictDoNothing();
      ledger.treasuryOwed = Math.max(0, ledger.treasuryOwed - p.lamports);
      cost = Math.max(0, spent - p.lamports);
    } else if (!failed && p.kind === "swap") {
      await dbtx.insert(schema.buybackEvents).values({ kind: "buyback", lamports: p.lamports, mint: p.mint, swapSignature: p.signature }).onConflictDoNothing();
      ledger.budget = Math.max(0, ledger.budget - p.lamports);
      cost = Math.max(0, spent - p.lamports);
    } else if (!failed && p.kind === "burn" && p.tokens && p.decimals !== undefined && p.mint) {
      await recordBurn(dbtx, p.signature, p.mint, p.tokens, p.decimals);
    }
    ledger.budget = Math.max(0, ledger.budget - cost);
    ledger.costs = (ledger.costs ?? 0) + cost;
    ledger.pending = null;
    await saveLedger(ledger, dbtx);
  });
  return failed ? "failed" : "landed";
}

async function burnHoldings(c: Connection, kp: Keypair, ledger: Ledger, mint: PublicKey, ata: PublicKey, tokenProgram: PublicKey) {
  const bal = await c.getTokenAccountBalance(ata, "confirmed").catch(() => null);
  const amount = bal ? BigInt(bal.value.amount) : 0n;
  if (!bal || amount === 0n) return null;
  const decimals = bal.value.decimals;
  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight }).add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
    createBurnCheckedInstruction(ata, mint, kp.publicKey, amount, decimals, [], tokenProgram),
  );
  tx.sign(kp);
  const signature = bs58.encode(tx.signature!);
  const outcome = await sendRecorded(
    c,
    ledger,
    { kind: "burn", signature, lamports: 0, lastValidBlockHeight, mint: mint.toBase58(), tokens: amount.toString(), decimals },
    tx.serialize(),
  );
  return { tokens: amount.toString(), signature, outcome };
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

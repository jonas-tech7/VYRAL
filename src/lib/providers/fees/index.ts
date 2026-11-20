/**
 * Creator-fee observation.
 *
 * Only fees that are actually collected AND confirmed on-chain may fund
 * rewards. Providers report observations as "pending" first; a later
 * confirmation check promotes them to "confirmed" (or "failed").
 *
 *  - mock:    DEVELOPMENT SIMULATION. Accrues simulated creator fees from
 *             simulated volume (the vault share, SIM_VAULT_FEE_RATE).
 *  - pumpfun: VYRAL's keeper distributes each pump.fun coin's creator fees
 *             (permissionless sweep + distribute_creator_fees). The locked
 *             split sends the competition's share straight to the reward
 *             vault. Because anyone may distribute, the provider reads the
 *             vault's transaction history and credits every distribution that
 *             paid the vault to its coin (see lib/launch/pumpfun-fees.ts).
 *  - onchain: watches the fee vault. Creator fees claimed from each token's
 *             launch pool are forwarded to the vault by the fee keeper with an
 *             SPL Memo "VYRAL:fee:<mint>" for attribution; deposits without a
 *             recognised memo are ignored and logged for reconciliation.
 */
import bs58 from "bs58";
import { randomBytes } from "node:crypto";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
  type ConfirmedSignatureInfo,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import { OnlinePumpSdk, feeSharingConfigPda } from "@pump-fun/pump-sdk";
import { env } from "@/lib/env";
import { attributeVaultDeposit, signatureOfKey, type CoinRef, type VaultTransaction } from "@/lib/launch/pumpfun-fees";
import type { TransactionSigner } from "@/lib/providers/payouts";
import { SIM_VAULT_FEE_RATE, simSolUsd, simVolumeRate } from "@/lib/sim/market-sim";

export type FeeToken = { id: string; mint: string; launchedAt: Date; poolAddress: string | null };

export type ObservedFee = {
  tokenId: string;
  amountLamports: number;
  txSignature: string;
  observedAt: Date;
  source: string;
};

export type FeeCursor = Record<string, unknown>;

export interface FeeProvider {
  readonly id: "mock" | "pumpfun" | "onchain";
  readonly isSimulated: boolean;
  /** Returns new observations since the cursor, plus the advanced cursor. */
  poll(tokens: FeeToken[], cursor: FeeCursor): Promise<{ fees: ObservedFee[]; cursor: FeeCursor }>;
  /** Finality check for pending observations. */
  confirmations(signatures: string[]): Promise<Map<string, "confirmed" | "failed" | "pending">>;
}

const MIN_SIM_INTERVAL_MS = 10 * 60_000;

class MockFeeProvider implements FeeProvider {
  readonly id = "mock" as const;
  readonly isSimulated = true;

  async poll(tokens: FeeToken[], cursor: FeeCursor) {
    const now = Date.now();
    const next: FeeCursor = { ...cursor };
    const fees: ObservedFee[] = [];
    for (const t of tokens) {
      const last = typeof cursor[t.id] === "number" ? (cursor[t.id] as number) : now - MIN_SIM_INTERVAL_MS;
      if (now - last < MIN_SIM_INTERVAL_MS) continue;
      let usd = 0;
      const step = 60_000;
      for (let x = last; x < now; x += step) {
        const dt = Math.min(step, now - x);
        usd += (simVolumeRate(t.mint, t.launchedAt, new Date(x + dt / 2)) * dt) / 3_600_000;
      }
      const lamports = Math.floor(((usd * SIM_VAULT_FEE_RATE) / simSolUsd(new Date(now))) * 1e9);
      next[t.id] = now;
      if (lamports >= 10_000) {
        fees.push({
          tokenId: t.id,
          amountLamports: lamports,
          txSignature: bs58.encode(randomBytes(64)),
          observedAt: new Date(now),
          source: "simulated",
        });
      }
    }
    return { fees, cursor: next };
  }

  async confirmations(signatures: string[]) {
    // Simulated finality: confirmed on the next check.
    return new Map(signatures.map((s) => [s, "confirmed" as const]));
  }
}

const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

class OnchainFeeProvider implements FeeProvider {
  readonly id = "onchain" as const;
  readonly isSimulated = false;
  private connection = new Connection(env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  private vault = new PublicKey(env.FEE_VAULT_ADDRESS ?? PublicKey.default);

  private memoOf(tx: ParsedTransactionWithMeta): string | null {
    for (const ix of tx.transaction.message.instructions) {
      if (ix.programId.toBase58() === MEMO_PROGRAM_ID && "parsed" in ix && typeof ix.parsed === "string") return ix.parsed;
    }
    return null;
  }

  async poll(tokens: FeeToken[], cursor: FeeCursor) {
    const byMint = new Map(tokens.map((t) => [t.mint, t]));
    const until = typeof cursor.lastSignature === "string" ? cursor.lastSignature : undefined;
    const sigs = await this.connection.getSignaturesForAddress(this.vault, { until, limit: 200 }, "confirmed");
    const fees: ObservedFee[] = [];
    for (const s of [...sigs].reverse()) {
      if (s.err) continue;
      const tx = await this.connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
      if (!tx?.meta) continue;
      const idx = tx.transaction.message.accountKeys.findIndex((k) => k.pubkey.equals(this.vault));
      if (idx < 0) continue;
      const delta = tx.meta.postBalances[idx] - tx.meta.preBalances[idx];
      const memo = this.memoOf(tx);
      const match = memo ? /VYRAL:fee:([1-9A-HJ-NP-Za-km-z]{32,44})/.exec(memo) : null;
      const token = match ? byMint.get(match[1]) : undefined;
      if (delta <= 0 || !token) continue;
      fees.push({
        tokenId: token.id,
        amountLamports: delta,
        txSignature: s.signature,
        observedAt: new Date((s.blockTime ?? Math.floor(Date.now() / 1000)) * 1000),
        source: "fee_vault_deposit",
      });
    }
    return { fees, cursor: { lastSignature: sigs[0]?.signature ?? until } };
  }

  async confirmations(signatures: string[]) {
    const out = new Map<string, "confirmed" | "failed" | "pending">();
    for (let i = 0; i < signatures.length; i += 200) {
      const chunk = signatures.slice(i, i + 200);
      const res = await this.connection.getSignatureStatuses(chunk, { searchTransactionHistory: true });
      chunk.forEach((sig, j) => {
        const st = res.value[j];
        out.set(sig, !st ? "pending" : st.err ? "failed" : st.confirmationStatus === "finalized" ? "confirmed" : "pending");
      });
    }
    return out;
  }
}

/** How often each coin's creator fees are distributed (pump.fun requires a minimum amount anyway). */
const DISTRIBUTE_EVERY_MS = 15 * 60_000;
/** Coins handled per tick, so a serverless cron stays well inside its time limit. */
const MAX_PER_TICK = 6;
/** Vault transactions read per tick; the rest follow on the next tick. */
const MAX_VAULT_TX_PER_TICK = 120;
/** Cursor entry: the newest vault transaction already read. */
const VAULT_CURSOR = "vault:lastSignature";
/** pump.fun bonding-curve program (mainnet and devnet). */
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

class PumpFunFeeProvider implements FeeProvider {
  readonly id = "pumpfun" as const;
  readonly isSimulated = false;
  private connection = new Connection(env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed");

  /**
   * 1. Distributes the creator fees of coins that are due (the keeper's part;
   *    anyone else may distribute too).
   * 2. Reads the reward vault's new transactions and credits every
   *    distribution that paid it to its coin, whoever sent it.
   */
  async poll(tokens: FeeToken[], cursor: FeeCursor) {
    if (!env.FEE_VAULT_ADDRESS) {
      console.error("[fees] FEE_VAULT_ADDRESS is not set");
      return { fees: [], cursor };
    }
    const vault = new PublicKey(env.FEE_VAULT_ADDRESS);
    const next: FeeCursor = { ...cursor };
    await this.distributeDue(tokens, cursor, next);
    const fees = await this.readVault(vault, tokens, cursor, next);
    return { fees, cursor: next };
  }

  private async distributeDue(tokens: FeeToken[], cursor: FeeCursor, next: FeeCursor) {
    const now = Date.now();
    const due = tokens
      .filter((t) => now - (typeof cursor[t.id] === "number" ? (cursor[t.id] as number) : 0) >= DISTRIBUTE_EVERY_MS)
      .sort((a, b) => ((cursor[a.id] as number) ?? 0) - ((cursor[b.id] as number) ?? 0))
      .slice(0, MAX_PER_TICK);
    if (!due.length) return;
    let signer: TransactionSigner;
    try {
      // Imported lazily: the payout module loads the vault signer.
      signer = (await import("@/lib/providers/payouts")).vaultSigner();
    } catch (err) {
      console.error("[fees] no vault signer, skipping distribution:", err instanceof Error ? err.message : err);
      return;
    }
    const payer = signer.publicKey;
    const sdk = new OnlinePumpSdk(this.connection);
    for (const t of due) {
      next[t.id] = now;
      try {
        const mint = new PublicKey(t.mint);
        const min = await sdk.getMinimumDistributableFee(mint, payer, { payer });
        if (!min.canDistribute) continue;
        const { instructions } = await sdk.buildDistributeCreatorFeesInstructions(mint, { payer });
        const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
        const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight }).add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
          ...instructions,
        );
        await signer.sign(tx);
        const signature = await this.connection.sendRawTransaction(tx.serialize());
        await this.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      } catch (err) {
        console.error(`[fees] distribution for ${t.mint} failed:`, err instanceof Error ? err.message : err);
      }
    }
  }

  /** Credits the vault's new distribution transactions (oldest first) and advances the vault cursor. */
  private async readVault(vault: PublicKey, tokens: FeeToken[], cursor: FeeCursor, next: FeeCursor): Promise<ObservedFee[]> {
    const until = typeof cursor[VAULT_CURSOR] === "string" ? (cursor[VAULT_CURSOR] as string) : undefined;
    const sigs: ConfirmedSignatureInfo[] = [];
    let before: string | undefined;
    for (let page = 0; page < 10; page++) {
      const batch = await this.connection.getSignaturesForAddress(vault, { until, before, limit: 1000 }, "confirmed");
      sigs.push(...batch);
      if (batch.length < 1000) break;
      before = batch[batch.length - 1].signature;
      if (page === 9) console.warn("[fees] more than 10,000 new vault transactions; older ones are skipped");
    }
    sigs.reverse();

    const coins = new Map<string, CoinRef>(tokens.map((t) => [feeSharingConfigPda(new PublicKey(t.mint)).toBase58(), { tokenId: t.id, mint: t.mint }]));
    const vaultAddress = vault.toBase58();
    const fees: ObservedFee[] = [];
    let read = 0;
    for (const s of sigs) {
      if (!s.err) {
        if (read++ >= MAX_VAULT_TX_PER_TICK) break;
        const tx = await this.connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 1, commitment: "confirmed" });
        if (!tx?.meta) break; // not available yet: retry from here next tick
        const deposit = attributeVaultDeposit(toVaultTransaction(s.signature, tx), vaultAddress, coins);
        if (deposit.unattributed) console.warn(`[fees] vault transaction ${s.signature}: ${deposit.unattributed}`);
        const observedAt = new Date((tx.blockTime ?? Math.floor(Date.now() / 1000)) * 1000);
        for (const c of deposit.credits) {
          fees.push({ tokenId: c.tokenId, amountLamports: c.amountLamports, txSignature: c.key, observedAt, source: "pumpfun:distribute" });
        }
      }
      next[VAULT_CURSOR] = s.signature;
    }
    return fees;
  }

  async confirmations(keys: string[]) {
    const out = new Map<string, "confirmed" | "failed" | "pending">();
    const sigs = [...new Set(keys.map(signatureOfKey))];
    const status = new Map<string, "confirmed" | "failed" | "pending">();
    for (let i = 0; i < sigs.length; i += 200) {
      const batch = sigs.slice(i, i + 200);
      const { value } = await this.connection.getSignatureStatuses(batch, { searchTransactionHistory: true });
      batch.forEach((sig, j) => {
        const st = value[j];
        status.set(sig, !st ? "pending" : st.err ? "failed" : st.confirmationStatus === "finalized" ? "confirmed" : "pending");
      });
    }
    for (const k of keys) out.set(k, status.get(signatureOfKey(k)) ?? "pending");
    return out;
  }
}

/** Converts an RPC transaction into what the attribution reads. */
function toVaultTransaction(signature: string, tx: ParsedTransactionWithMeta): VaultTransaction {
  const meta = tx.meta!;
  const logs = meta.logMessages ?? [];
  const eventData: Uint8Array[] = [];
  for (const l of logs) {
    if (l.startsWith("Program data: ")) eventData.push(Buffer.from(l.slice(14), "base64"));
  }
  for (const inner of meta.innerInstructions ?? []) {
    for (const ix of inner.instructions) {
      if ("data" in ix && ix.programId.equals(PUMP_PROGRAM)) {
        try {
          eventData.push(bs58.decode(ix.data));
        } catch {
          /* not base58: not an event */
        }
      }
    }
  }
  return {
    signature,
    failed: meta.err !== null,
    accountKeys: tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58()),
    preBalances: meta.preBalances,
    postBalances: meta.postBalances,
    fee: meta.fee,
    logs,
    eventData,
  };
}

let instance: FeeProvider | null = null;
export function feeProvider(): FeeProvider {
  if (!instance) {
    instance =
      env.FEE_PROVIDER === "pumpfun" ? new PumpFunFeeProvider() : env.FEE_PROVIDER === "onchain" ? new OnchainFeeProvider() : new MockFeeProvider();
  }
  return instance;
}

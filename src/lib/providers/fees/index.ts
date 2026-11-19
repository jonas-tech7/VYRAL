/**
 * Creator-fee observation.
 *
 * Only fees that are actually collected AND confirmed on-chain may fund
 * rewards. Providers report observations as "pending" first; a later
 * confirmation check promotes them to "confirmed" (or "failed").
 *
 *  - mock:    DEVELOPMENT SIMULATION. Accrues simulated creator fees from
 *             simulated volume (SIM_CREATOR_FEE_RATE).
 *  - onchain: watches the fee vault. Creator fees claimed from each token's
 *             launch pool are forwarded to the vault by the fee keeper with an
 *             SPL Memo "VYRAL:fee:<mint>" for attribution; deposits without a
 *             recognised memo are ignored and logged for reconciliation.
 */
import bs58 from "bs58";
import { randomBytes } from "node:crypto";
import { Connection, PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { env } from "@/lib/env";
import { SIM_CREATOR_FEE_RATE, simSolUsd, simVolumeRate } from "@/lib/sim/market-sim";

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
  readonly id: "mock" | "onchain";
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
      const lamports = Math.floor(((usd * SIM_CREATOR_FEE_RATE) / simSolUsd(new Date(now))) * 1e9);
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

let instance: FeeProvider | null = null;
export function feeProvider(): FeeProvider {
  if (!instance) instance = env.FEE_PROVIDER === "onchain" ? new OnchainFeeProvider() : new MockFeeProvider();
  return instance;
}

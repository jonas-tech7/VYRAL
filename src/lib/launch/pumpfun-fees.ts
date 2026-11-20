/**
 * Attributing pump.fun creator-fee distributions to coins.
 *
 * Distributing a coin's creator fees is permissionless: VYRAL's keeper does
 * it, but so can pump.fun's own interface, the deployer or anyone else. Every
 * distribution pays the reward vault its locked share directly, so VYRAL reads
 * the vault's transaction history instead of only its own transactions: each
 * distribution that paid the vault is credited to the coin it belongs to, no
 * matter who sent it.
 *
 * Pure functions, so they are unit-tested without a network.
 */
import { PublicKey } from "@solana/web3.js";

/** Anchor discriminator of pump's DistributeCreatorFeesEvent. */
const DISTRIBUTE_EVENT = Buffer.from([165, 55, 129, 112, 4, 179, 202, 40]);
/** Prefix of events emitted through Anchor's self-CPI (`emit_cpi!`). */
const EVENT_CPI_TAG = Buffer.from([228, 69, 165, 46, 81, 203, 154, 29]);
/** The program logs this for both distribute_creator_fees and _v2. */
const DISTRIBUTE_LOG = /Instruction: DistributeCreatorFees/;

export type DistributeEvent = { mint: string; sharingConfig: string; distributed: bigint; shareBps: Map<string, number> };

/** Decodes a DistributeCreatorFeesEvent (log "Program data:" payload or self-CPI data); null for anything else. */
export function decodeDistributeEvent(raw: Uint8Array): DistributeEvent | null {
  let b = Buffer.from(raw);
  if (b.length >= 8 && b.subarray(0, 8).equals(EVENT_CPI_TAG)) b = b.subarray(8);
  if (b.length < 8 || !b.subarray(0, 8).equals(DISTRIBUTE_EVENT)) return null;
  try {
    let o = 16; // discriminator, timestamp (i64)
    const key = () => {
      const k = new PublicKey(b.subarray(o, o + 32)).toBase58();
      o += 32;
      return k;
    };
    const mint = key();
    key(); // bonding_curve
    const sharingConfig = key();
    key(); // admin
    const n = b.readUInt32LE(o);
    o += 4;
    if (n > 64) return null;
    const shareBps = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const address = key();
      shareBps.set(address, (shareBps.get(address) ?? 0) + b.readUInt16LE(o));
      o += 2;
    }
    const distributed = b.readBigUInt64LE(o);
    return { mint, sharingConfig, distributed, shareBps };
  } catch {
    return null;
  }
}

/** The parts of a confirmed transaction the attribution needs (account keys include lookup-table ones). */
export type VaultTransaction = {
  signature: string;
  failed: boolean;
  accountKeys: string[];
  preBalances: number[];
  postBalances: number[];
  fee: number;
  logs: string[];
  /** Candidate event payloads: "Program data:" log lines and pump inner-instruction data. */
  eventData: Uint8Array[];
};

export type CoinRef = { tokenId: string; mint: string };

export type VaultDeposit = {
  /** Lamports the vault received in the transaction (its net balance change). */
  received: number;
  credits: Array<CoinRef & { amountLamports: number; key: string }>;
  /** Set when the vault received a distribution it could not credit to a VYRAL coin. */
  unattributed: string | null;
};

/**
 * What a transaction paid the reward vault, credited per coin.
 * `coins` maps each VYRAL coin's fee-sharing-config address to the coin.
 * One coin (the normal case): it gets everything the vault received.
 * Several coins in one transaction: split by their distribution events (the
 * vault's share of each `distributed` amount), evenly if no event decodes.
 * Credit keys are the signature, or "signature:mint" when split.
 */
export function attributeVaultDeposit(tx: VaultTransaction, vault: string, coins: Map<string, CoinRef>): VaultDeposit {
  const none = (unattributed: string | null, received = 0): VaultDeposit => ({ received, credits: [], unattributed });
  if (tx.failed) return none(null);
  const i = tx.accountKeys.indexOf(vault);
  if (i < 0) return none(null);
  // Net change: when the vault itself paid the network fee (VYRAL's keeper), that fee is not credited, so the
  // amounts credited to coins never exceed what the vault really holds.
  const received = tx.postBalances[i] - tx.preBalances[i];
  if (received <= 0) return none(null);

  const events = tx.eventData.map(decodeDistributeEvent).filter((e): e is DistributeEvent => e !== null);
  // A coin's fee-sharing config only appears in transactions about its fees, so
  // a vault deposit next to one is that coin's distribution.
  const matched = [...new Set(tx.accountKeys)].filter((k) => coins.has(k));
  if (!matched.length) {
    const distribution = events.length > 0 || tx.logs.some((l) => DISTRIBUTE_LOG.test(l));
    return none(distribution ? `distribution of ${received} lamports for a coin that is not an active VYRAL competition` : null, received);
  }
  if (matched.length === 1) {
    const coin = coins.get(matched[0])!;
    return { received, credits: [{ ...coin, amountLamports: received, key: tx.signature }], unattributed: null };
  }

  // Several VYRAL coins distributed in one transaction.
  const weights = matched.map((sc) => {
    const e = events.find((ev) => ev.sharingConfig === sc);
    return e ? (e.distributed * BigInt(e.shareBps.get(vault) ?? 0)) / 10_000n : 0n;
  });
  const total = weights.reduce((a, b) => a + b, 0n);
  const amounts = matched.map((_, j) => (total > 0n ? Number((BigInt(received) * weights[j]) / total) : Math.floor(received / matched.length)));
  let largest = 0;
  amounts.forEach((a, j) => {
    if (a > amounts[largest]) largest = j;
  });
  amounts[largest] += received - amounts.reduce((a, b) => a + b, 0); // rounding remainder
  return {
    received,
    credits: matched
      .map((sc, j) => {
        const coin = coins.get(sc)!;
        return { ...coin, amountLamports: amounts[j], key: `${tx.signature}:${coin.mint}` };
      })
      .filter((c) => c.amountLamports > 0),
    unattributed: total > 0n ? null : `split ${received} lamports evenly across ${matched.length} coins (no distribution events decoded)`,
  };
}

/** The transaction signature behind a credit key. */
export function signatureOfKey(key: string): string {
  return key.split(":")[0];
}

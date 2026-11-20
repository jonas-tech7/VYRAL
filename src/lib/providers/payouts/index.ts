/**
 * Payout execution on Solana.
 *
 * Safety model (see lib/services/payouts.ts for the state machine):
 *  - Each attempt is a fully signed transaction whose signature is persisted
 *    BEFORE broadcast. Re-broadcasting the same bytes is idempotent.
 *  - A new attempt is only built once the previous one is provably terminal:
 *    finalized, landed with an error, or its blockhash expired
 *    (block height > lastValidBlockHeight) and the signature is unknown even
 *    with full history search. An expired transaction can never land.
 *  - Every transfer carries an SPL Memo "VYRAL payout <payoutId>" so payouts
 *    are independently verifiable and reconcilable from chain data alone.
 *
 *  - simulated: DEVELOPMENT ONLY. Produces random signatures that are not on
 *               any chain. Payouts made this way are flagged isSimulated.
 *  - solana:    real transfers from the fee vault, signed by an env keypair
 *               (devnet testing only) or a remote signer (KMS / custody).
 */
import bs58 from "bs58";
import { randomBytes } from "node:crypto";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { env } from "@/lib/env";
import { unit } from "@/lib/sim/random";
import { isValidTxSignature } from "@/lib/solana/keys";

export type BuiltAttempt = {
  signature: string;
  rawTransaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
};

export type ChainStatus = {
  state: "not_found" | "processed" | "confirmed" | "finalized";
  err: string | null;
  slot: number | null;
};

export type ManualVerification = { ok: true; slot: number } | { ok: false; reason: string };

export interface PayoutExecutor {
  readonly id: "simulated" | "solana";
  readonly isSimulated: boolean;
  /** Largest payout sent automatically (null: no limit). Larger ones wait for an administrator. */
  readonly maxAutoLamports: number | null;
  vaultAddress(): string;
  getVaultBalance(): Promise<number>;
  build(p: { payoutId: string; recipient: string; lamports: number }): Promise<BuiltAttempt>;
  broadcast(rawTransaction: string): Promise<void>;
  getStatuses(signatures: string[]): Promise<Map<string, ChainStatus>>;
  getBlockHeight(): Promise<number>;
  verifyTransfer(signature: string, expected: { recipient: string; lamports: number; payoutId: string }): Promise<ManualVerification>;
}

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export function payoutMemo(payoutId: string): string {
  return `VYRAL payout ${payoutId}`;
}

/* ------------------------------ Signers ------------------------------- */

export interface TransactionSigner {
  publicKey: PublicKey;
  sign(tx: Transaction): Promise<void>;
}

class EnvKeypairSigner implements TransactionSigner {
  private keypair: Keypair;
  constructor(secretBase58: string) {
    // Read from the environment at runtime only; never persisted or logged.
    const v = secretBase58.trim().replace(/^["']|["']$/g, "");
    try {
      this.keypair = Keypair.fromSecretKey(v.startsWith("[") ? Uint8Array.from(JSON.parse(v) as number[]) : bs58.decode(v));
    } catch {
      // Never include the value in the message.
      throw new Error(
        "PAYOUT_SIGNER_SECRET_KEY is not a valid Solana private key. Paste the private key exported from Phantom (Show Private Key), not the recovery phrase or the address.",
      );
    }
  }
  get publicKey() {
    return this.keypair.publicKey;
  }
  async sign(tx: Transaction) {
    tx.partialSign(this.keypair);
  }
}

/**
 * Delegates signing to an external signer (cloud KMS with Ed25519, MPC or
 * custody API). The service receives the serialized message only, and the
 * returned signature is verified locally before use.
 */
class RemoteSigner implements TransactionSigner {
  constructor(
    readonly publicKey: PublicKey,
    private url: string,
    private token: string,
  ) {}
  async sign(tx: Transaction) {
    const message = tx.serializeMessage();
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ publicKey: this.publicKey.toBase58(), message: message.toString("base64") }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Remote signer error (${res.status})`);
    const body = (await res.json()) as { signature?: string };
    if (!body.signature) throw new Error("Remote signer returned no signature");
    tx.addSignature(this.publicKey, Buffer.from(body.signature, "base64"));
    if (!tx.verifySignatures(true)) throw new Error("Remote signer returned an invalid signature");
  }
}

let signerInstance: TransactionSigner | null = null;
/** The reward vault's signer (pays payouts and signs fee distributions). */
export function vaultSigner(): TransactionSigner {
  if (signerInstance) return signerInstance;
  if (!env.FEE_VAULT_ADDRESS) throw new Error("FEE_VAULT_ADDRESS is required");
  const vault = new PublicKey(env.FEE_VAULT_ADDRESS);
  if (env.PAYOUT_SIGNER === "remote") {
    signerInstance = new RemoteSigner(vault, env.REMOTE_SIGNER_URL ?? "", env.REMOTE_SIGNER_TOKEN ?? "");
  } else if (env.PAYOUT_SIGNER === "env-keypair" && env.PAYOUT_SIGNER_SECRET_KEY) {
    if (env.SOLANA_CLUSTER === "mainnet-beta" && !env.PAYOUT_ALLOW_HOT_WALLET) {
      throw new Error("env-keypair signing on mainnet-beta requires PAYOUT_ALLOW_HOT_WALLET=true");
    }
    const kp = new EnvKeypairSigner(env.PAYOUT_SIGNER_SECRET_KEY);
    if (!kp.publicKey.equals(vault)) throw new Error("PAYOUT_SIGNER_SECRET_KEY does not match FEE_VAULT_ADDRESS");
    signerInstance = kp;
  } else {
    throw new Error("No payout signer configured");
  }
  return signerInstance;
}

/* ----------------------------- Executors ------------------------------ */

class SolanaPayoutExecutor implements PayoutExecutor {
  readonly id = "solana" as const;
  readonly isSimulated = false;
  readonly maxAutoLamports = env.PAYOUT_SIGNER === "env-keypair" ? env.PAYOUT_MAX_LAMPORTS : null;
  private connection: Connection;
  private signer: TransactionSigner;

  constructor() {
    if (!env.SOLANA_RPC_URL || !env.FEE_VAULT_ADDRESS) throw new Error("Solana payouts require SOLANA_RPC_URL and FEE_VAULT_ADDRESS");
    this.connection = new Connection(env.SOLANA_RPC_URL, "confirmed");
    this.signer = vaultSigner();
  }

  vaultAddress() {
    return this.signer.publicKey.toBase58();
  }

  async getVaultBalance() {
    return this.connection.getBalance(this.signer.publicKey, "confirmed");
  }

  async build({ payoutId, recipient, lamports }: { payoutId: string; recipient: string; lamports: number }) {
    if (this.maxAutoLamports !== null && lamports > this.maxAutoLamports) {
      throw new Error(`Payout of ${lamports} lamports exceeds PAYOUT_MAX_LAMPORTS; send it from the vault and settle it manually.`);
    }
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: this.signer.publicKey, blockhash, lastValidBlockHeight }).add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 30_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
      SystemProgram.transfer({ fromPubkey: this.signer.publicKey, toPubkey: new PublicKey(recipient), lamports }),
      new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(payoutMemo(payoutId), "utf8") }),
    );
    await this.signer.sign(tx);
    if (!tx.signature) throw new Error("Transaction was not signed");
    return {
      signature: bs58.encode(tx.signature),
      rawTransaction: tx.serialize().toString("base64"),
      blockhash,
      lastValidBlockHeight,
    };
  }

  async broadcast(rawTransaction: string) {
    await this.connection.sendRawTransaction(Buffer.from(rawTransaction, "base64"), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 0,
    });
  }

  async getStatuses(signatures: string[]) {
    const out = new Map<string, ChainStatus>();
    for (let i = 0; i < signatures.length; i += 200) {
      const chunk = signatures.slice(i, i + 200);
      const res = await this.connection.getSignatureStatuses(chunk, { searchTransactionHistory: true });
      chunk.forEach((sig, j) => {
        const s = res.value[j];
        out.set(
          sig,
          s
            ? { state: s.confirmationStatus ?? "processed", err: s.err ? JSON.stringify(s.err) : null, slot: s.slot }
            : { state: "not_found", err: null, slot: null },
        );
      });
    }
    return out;
  }

  async getBlockHeight() {
    return this.connection.getBlockHeight("confirmed");
  }

  async verifyTransfer(signature: string, expected: { recipient: string; lamports: number; payoutId: string }): Promise<ManualVerification> {
    if (!isValidTxSignature(signature)) return { ok: false, reason: "Invalid signature format" };
    const tx = await this.connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 1, commitment: "finalized" });
    if (!tx) return { ok: false, reason: "Transaction not found at finalized commitment" };
    if (tx.meta?.err) return { ok: false, reason: "Transaction failed on-chain" };
    const transfers = tx.transaction.message.instructions.filter(
      (ix) => "parsed" in ix && ix.program === "system" && (ix.parsed as { type?: string })?.type === "transfer",
    );
    const match = transfers.some((ix) => {
      const info = (ix as { parsed: { info: { destination: string; lamports: number } } }).parsed.info;
      return info.destination === expected.recipient && info.lamports >= expected.lamports;
    });
    if (!match) return { ok: false, reason: "No transfer of the expected amount to the recipient was found" };
    return { ok: true, slot: tx.slot };
  }
}

/** Simulated chain height: ~2.5 blocks per second. */
function simBlockHeight(): number {
  return Math.floor(Date.now() / 400);
}

export const SIM_PAYOUT_FAILURE_RATE = Number(process.env.SIMULATED_PAYOUT_FAILURE_RATE ?? 0.06);

class SimulatedPayoutExecutor implements PayoutExecutor {
  readonly id = "simulated" as const;
  readonly isSimulated = true;
  readonly maxAutoLamports = null;

  vaultAddress() {
    return "simulated-vault";
  }

  async getVaultBalance() {
    return Number.MAX_SAFE_INTEGER;
  }

  async build() {
    return {
      signature: bs58.encode(randomBytes(64)),
      rawTransaction: "simulated",
      blockhash: bs58.encode(randomBytes(32)),
      lastValidBlockHeight: simBlockHeight() + 150,
    };
  }

  async broadcast() {}

  async getStatuses(signatures: string[]) {
    // A deterministic fraction of simulated attempts never lands, so the
    // expiry → retry → manual-review path is exercised in development.
    return new Map(
      signatures.map((s) => [
        s,
        unit(s) < SIM_PAYOUT_FAILURE_RATE
          ? ({ state: "not_found", err: null, slot: null } as ChainStatus)
          : ({ state: "finalized", err: null, slot: simBlockHeight() } as ChainStatus),
      ]),
    );
  }

  async getBlockHeight() {
    return simBlockHeight();
  }

  async verifyTransfer(signature: string): Promise<ManualVerification> {
    if (!isValidTxSignature(signature)) return { ok: false, reason: "Invalid signature format" };
    return { ok: true, slot: simBlockHeight() };
  }
}

let instance: PayoutExecutor | null = null;
export function payoutExecutor(): PayoutExecutor {
  if (!instance) instance = env.PAYOUT_EXECUTOR === "solana" ? new SolanaPayoutExecutor() : new SimulatedPayoutExecutor();
  return instance;
}

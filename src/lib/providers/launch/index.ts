/**
 * Token launch infrastructure.
 *
 * VYRAL never holds the deployer's keys. A launch is a two-step flow:
 *   1. prepare: the provider returns either a transaction for the deployer's
 *      wallet to sign ("transaction" mode, live) or a launch-intent message
 *      ("message" mode, simulated).
 *   2. confirm: the server verifies the signed result before the token and
 *      its competition are created.
 *
 *  - simulated: DEVELOPMENT ONLY. Generates an address-format mint that does
 *               not exist on-chain and requires a signed launch intent.
 *  - external:  adapter for launchpad infrastructure (e.g. a bonding-curve
 *               launch service). Builds the creation transaction remotely and
 *               verifies the confirmed transaction via RPC.
 */
import { randomBytes } from "node:crypto";
import { Connection, Keypair } from "@solana/web3.js";
import { env } from "@/lib/env";
import { verifyWalletSignature } from "@/lib/solana/keys";

export const LAUNCH_SUPPLY = 1_000_000_000;
export const LAUNCH_DECIMALS = 6;

export type LaunchInput = {
  deployer: string;
  name: string;
  symbol: string;
  metadataUri: string;
  initialBuyLamports: number;
};

export type PreparedLaunch = {
  mint: string;
  mode: "message" | "transaction";
  intentMessage: string | null;
  transaction: string | null;
  expiresAt: Date;
};

export type LaunchConfirmation =
  | { ok: true; launchSignature: string | null; poolAddress: string | null }
  | { ok: false; error: string };

export interface LaunchProvider {
  readonly id: "simulated" | "external";
  readonly isSimulated: boolean;
  prepare(input: LaunchInput): Promise<PreparedLaunch>;
  confirm(args: { prepared: PreparedLaunch; deployer: string; signature: string }): Promise<LaunchConfirmation>;
}

const EXPIRY_MS = 10 * 60_000;

class SimulatedLaunchProvider implements LaunchProvider {
  readonly id = "simulated" as const;
  readonly isSimulated = true;

  async prepare(input: LaunchInput): Promise<PreparedLaunch> {
    const mint = Keypair.generate().publicKey.toBase58();
    const expiresAt = new Date(Date.now() + EXPIRY_MS);
    const intentMessage = [
      "VYRAL launch request",
      "",
      `Token: ${input.name} ($${input.symbol})`,
      `Mint: ${mint}`,
      `Deployer: ${input.deployer}`,
      `Nonce: ${randomBytes(12).toString("hex")}`,
      `Expires: ${expiresAt.toISOString()}`,
      "",
      "Simulated launch: no transaction is created and no funds move.",
    ].join("\n");
    return { mint, mode: "message", intentMessage, transaction: null, expiresAt };
  }

  async confirm({ prepared, deployer, signature }: { prepared: PreparedLaunch; deployer: string; signature: string }) {
    if (!prepared.intentMessage) return { ok: false as const, error: "Missing launch intent" };
    if (!verifyWalletSignature(prepared.intentMessage, signature, deployer)) {
      return { ok: false as const, error: "Launch signature could not be verified" };
    }
    return { ok: true as const, launchSignature: null, poolAddress: null };
  }
}

class ExternalLaunchProvider implements LaunchProvider {
  readonly id = "external" as const;
  readonly isSimulated = false;
  private connection = new Connection(env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");

  private async call<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(new URL(path, env.EXTERNAL_LAUNCH_API_URL), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.EXTERNAL_LAUNCH_API_KEY ?? ""}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Launch service error (${res.status})`);
    return (await res.json()) as T;
  }

  async prepare(input: LaunchInput): Promise<PreparedLaunch> {
    const r = await this.call<{ mint: string; transaction: string }>("/prepare", {
      deployer: input.deployer,
      name: input.name,
      symbol: input.symbol,
      uri: input.metadataUri,
      initialBuyLamports: input.initialBuyLamports,
      supply: LAUNCH_SUPPLY,
      decimals: LAUNCH_DECIMALS,
    });
    return { mint: r.mint, mode: "transaction", intentMessage: null, transaction: r.transaction, expiresAt: new Date(Date.now() + 90_000) };
  }

  async confirm({ prepared, deployer, signature }: { prepared: PreparedLaunch; deployer: string; signature: string }) {
    const tx = await this.connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    if (!tx) return { ok: false as const, error: "Launch transaction not found (yet). Try again shortly." };
    if (tx.meta?.err) return { ok: false as const, error: "Launch transaction failed on-chain" };
    const keys = tx.transaction.message.accountKeys;
    const deployerSigned = keys.some((k) => k.signer && k.pubkey.toBase58() === deployer);
    const mintPresent = keys.some((k) => k.pubkey.toBase58() === prepared.mint);
    if (!deployerSigned || !mintPresent) return { ok: false as const, error: "Transaction does not match the prepared launch" };
    const r = await this.call<{ poolAddress?: string }>("/confirm", { mint: prepared.mint, signature });
    return { ok: true as const, launchSignature: signature, poolAddress: r.poolAddress ?? null };
  }
}

let instance: LaunchProvider | null = null;
export function launchProvider(): LaunchProvider {
  if (!instance) instance = env.LAUNCH_PROVIDER === "external" ? new ExternalLaunchProvider() : new SimulatedLaunchProvider();
  return instance;
}

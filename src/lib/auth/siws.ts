/**
 * Wallet authentication with signed messages (Sign-In With Solana format).
 *
 * The server issues a single-use nonce bound to a wallet and purpose; the
 * wallet signs a human-readable message containing it; the server verifies
 * the ed25519 signature against the exact stored message and consumes the
 * nonce atomically. No transaction is involved and no keys ever leave the
 * wallet.
 */
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { randomToken } from "@/lib/security/crypto";
import { verifyWalletSignature } from "@/lib/solana/keys";
import { TERMS_VERSION } from "@/lib/legal";

export type NoncePurpose = "sign_in" | "claim";

const NONCE_TTL_MS = 10 * 60_000;

export function buildSignInMessage(p: { wallet: string; nonce: string; issuedAt: Date; expiresAt: Date }): string {
  const url = new URL(env.APP_URL);
  return [
    `${url.host} wants you to sign in with your Solana account:`,
    p.wallet,
    "",
    `Sign in to VYRAL. This signature proves you own this wallet. It does not create a transaction and costs nothing. By signing in you accept the Terms of Use (${TERMS_VERSION}): ${new URL("/legal/terms", url).toString()}`,
    "",
    `URI: ${url.origin}`,
    "Version: 1",
    `Chain ID: ${env.SOLANA_CLUSTER === "mainnet-beta" ? "mainnet" : env.SOLANA_CLUSTER}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${p.issuedAt.toISOString()}`,
    `Expiration Time: ${p.expiresAt.toISOString()}`,
  ].join("\n");
}

export function buildClaimMessage(p: { wallet: string; nonce: string; payoutId: string; amountSol: string; issuedAt: Date }): string {
  return [
    "VYRAL reward claim",
    "",
    `Wallet: ${p.wallet}`,
    `Payout: ${p.payoutId}`,
    `Amount: ${p.amountSol} SOL`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${p.issuedAt.toISOString()}`,
    "",
    "Signing requests a new transfer attempt to this wallet. It does not create a transaction from your wallet.",
  ].join("\n");
}

export async function issueNonce(
  wallet: string,
  purpose: NoncePurpose,
  build: (nonce: string, issuedAt: Date, expiresAt: Date) => string,
): Promise<{ nonce: string; message: string; expiresAt: Date }> {
  const nonce = randomToken(18);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + NONCE_TTL_MS);
  const message = build(nonce, issuedAt, expiresAt);
  await db.insert(schema.authNonces).values({ nonce, wallet, purpose, message, expiresAt });
  return { nonce, message, expiresAt };
}

export type VerifyResult = { ok: true; message: string } | { ok: false; reason: "unknown_nonce" | "expired" | "bad_signature" | "replayed" };

/** Verifies the signature over the stored message, then consumes the nonce atomically. */
export async function verifyAndConsumeNonce(
  nonce: string,
  wallet: string,
  purpose: NoncePurpose,
  signature: string,
): Promise<VerifyResult> {
  const [row] = await db
    .select()
    .from(schema.authNonces)
    .where(and(eq(schema.authNonces.nonce, nonce), eq(schema.authNonces.wallet, wallet), eq(schema.authNonces.purpose, purpose)));
  if (!row) return { ok: false, reason: "unknown_nonce" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (!verifyWalletSignature(row.message, signature, wallet)) return { ok: false, reason: "bad_signature" };
  const consumed = await db
    .update(schema.authNonces)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.authNonces.nonce, nonce), isNull(schema.authNonces.usedAt), gt(schema.authNonces.expiresAt, new Date())))
    .returning({ nonce: schema.authNonces.nonce });
  if (consumed.length === 0) return { ok: false, reason: "replayed" };
  return { ok: true, message: row.message };
}

export async function pruneNonces(): Promise<void> {
  await db.delete(schema.authNonces).where(lt(schema.authNonces.expiresAt, new Date(Date.now() - 86_400_000)));
}

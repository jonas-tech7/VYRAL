import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519.js";

/** A base58 string that decodes to exactly 32 bytes. */
export function isValidAddress(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) return false;
  try {
    return bs58.decode(value).length === 32;
  } catch {
    return false;
  }
}

/** Accepts base58 or base64 encoded 64-byte ed25519 signatures. */
export function decodeSignature(sig: string): Uint8Array | null {
  try {
    const b = bs58.decode(sig);
    if (b.length === 64) return b;
  } catch {
    /* not base58 */
  }
  try {
    const b = Buffer.from(sig, "base64");
    if (b.length === 64) return new Uint8Array(b);
  } catch {
    /* not base64 */
  }
  return null;
}

/** Verifies an ed25519 signature over a UTF-8 message by a Solana wallet. */
export function verifyWalletSignature(message: string, signature: string, wallet: string): boolean {
  if (!isValidAddress(wallet)) return false;
  const sig = decodeSignature(signature);
  if (!sig) return false;
  try {
    return ed25519.verify(sig, new TextEncoder().encode(message), bs58.decode(wallet));
  } catch {
    return false;
  }
}

export function isValidTxSignature(sig: string): boolean {
  try {
    return bs58.decode(sig).length === 64;
  } catch {
    return false;
  }
}

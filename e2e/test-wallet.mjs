// Deterministic test keypair used only by the E2E suite.
import { Keypair } from "@solana/web3.js";
const seed = new Uint8Array(32).map((_, i) => (i * 7 + 13) % 256);
export const testKeypair = Keypair.fromSeed(seed);
if (process.argv[1]?.endsWith("test-wallet.mjs")) console.log(testKeypair.publicKey.toBase58());

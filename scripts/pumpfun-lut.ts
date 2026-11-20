/**
 * Creates VYRAL's address lookup table for pump.fun launches (run once per
 * cluster). It holds the accounts every launch shares, so a launch with its
 * locked fee split and initial buy fits in one transaction.
 *
 *   PUMPFUN_LUT_PAYER=<base58 secret or JSON array> FEE_VAULT_ADDRESS=<vault> \
 *   npx tsx scripts/pumpfun-lut.ts [rpcUrl]
 *
 * Costs ~0.01 SOL of rent (paid by the payer). Prints PUMPFUN_LOOKUP_TABLE.
 */
import { AddressLookupTableProgram, Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { CREATOR_FEE_SPLIT } from "../src/lib/launch/fee-split";
import { staticLaunchAccounts } from "../src/lib/launch/pumpfun";

export function parseSecret(value: string): Keypair {
  const v = value.trim();
  return Keypair.fromSecretKey(v.startsWith("[") ? Uint8Array.from(JSON.parse(v)) : bs58.decode(v));
}

export async function createLaunchLookupTable(connection: Connection, payer: Keypair, vault: PublicKey) {
  const accounts = await staticLaunchAccounts(connection, vault, CREATOR_FEE_SPLIT.vaultBps);
  // A real block ~100 slots behind the tip: still in the recent slot hashes, even on a node that lags.
  const tip = await connection.getSlot("confirmed");
  const slot = (await connection.getBlocks(tip - 150, tip - 100, "confirmed")).at(-1) ?? tip - 100;
  const [create, table] = AddressLookupTableProgram.createLookupTable({ authority: payer.publicKey, payer: payer.publicKey, recentSlot: slot });
  await sendAndConfirmTransaction(connection, new Transaction().add(create), [payer], { commitment: "confirmed" });
  for (let i = 0; i < accounts.length; i += 20) {
    const extend = AddressLookupTableProgram.extendLookupTable({ lookupTable: table, authority: payer.publicKey, payer: payer.publicKey, addresses: accounts.slice(i, i + 20) });
    await sendAndConfirmTransaction(connection, new Transaction().add(extend), [payer], { commitment: "confirmed" });
  }
  return { table, count: accounts.length };
}

if (process.argv[1]?.endsWith("pumpfun-lut.ts")) {
  (async () => {
    const rpc = process.argv[2] ?? process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
    const secret = process.env.PUMPFUN_LUT_PAYER;
    const vault = process.env.FEE_VAULT_ADDRESS;
    if (!secret || !vault) throw new Error("Set PUMPFUN_LUT_PAYER and FEE_VAULT_ADDRESS.");
    const { table, count } = await createLaunchLookupTable(new Connection(rpc, "confirmed"), parseSecret(secret), new PublicKey(vault));
    console.log(`Lookup table with ${count} accounts created.\nPUMPFUN_LOOKUP_TABLE=${table.toBase58()}`);
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

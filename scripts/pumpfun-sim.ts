/**
 * Builds a complete VYRAL pump.fun launch (coin + locked fee split + optional
 * initial buy) and simulates it against a live cluster. Nothing is signed or
 * sent and no funds move.
 *
 *   PUMPFUN_LOOKUP_TABLE=<table> FEE_VAULT_ADDRESS=<vault> \
 *   npx tsx scripts/pumpfun-sim.ts [rpcUrl] [initialBuySol]
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { CREATOR_FEE_SPLIT } from "../src/lib/launch/fee-split";
import { buildPumpFunLaunch } from "../src/lib/launch/pumpfun";

const rpc = process.argv[2] ?? process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const initialBuySol = Number(process.argv[3] ?? 0.05);
// Any system account holding SOL works as the simulated deployer.
const deployer = new PublicKey(process.env.SIM_DEPLOYER ?? "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");

async function main() {
  const table = process.env.PUMPFUN_LOOKUP_TABLE;
  const vault = process.env.FEE_VAULT_ADDRESS;
  if (!table || !vault) throw new Error("Set PUMPFUN_LOOKUP_TABLE and FEE_VAULT_ADDRESS.");
  const connection = new Connection(rpc, "confirmed");
  const lookupTable = (await connection.getAddressLookupTable(new PublicKey(table))).value;
  if (!lookupTable) throw new Error("Lookup table not found on this cluster.");
  const built = await buildPumpFunLaunch(connection, {
    mint: Keypair.generate().publicKey,
    deployer,
    vault: new PublicKey(vault),
    vaultShareBps: CREATOR_FEE_SPLIT.vaultBps,
    name: "Simulated Coin",
    symbol: "SIMC",
    uri: "https://makevyral.com/api/files/metadata/example.json",
    initialBuyLamports: Math.round(initialBuySol * 1e9),
    lookupTable,
  });
  const tx = built.transactions[0];
  const sim = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  console.log(`${tx.serialize().length} bytes, err=${JSON.stringify(sim.value.err)}, compute units=${sim.value.unitsConsumed}`);
  if (sim.value.err) {
    console.log((sim.value.logs ?? []).slice(-30).join("\n"));
    process.exit(1);
  }
  console.log("OK: coin creation, locked 50/50 fee split and initial buy all succeed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

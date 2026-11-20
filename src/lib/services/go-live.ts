/**
 * One-time go-live steps, run by administrators from the dashboard:
 *  - create the address lookup table pump.fun launches use (paid by the vault)
 *  - simulate a complete launch against the live cluster (nothing is sent)
 *  - remove the demonstration data
 * Plus a readiness checklist of the production configuration.
 */
import { AddressLookupTableProgram, Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { eq, sql } from "drizzle-orm";
import { ApiError } from "@/lib/api/errors";
import { db, schema } from "@/lib/db";
import { env, isDemoMode, platformConfigured } from "@/lib/env";
import { CREATOR_FEE_SPLIT } from "@/lib/launch/fee-split";
import { LOOKUP_TABLE_STATE_KEY, lookupTableAddress } from "@/lib/launch/lookup-table";
import { buildPumpFunLaunch, staticLaunchAccounts } from "@/lib/launch/pumpfun";
import { vaultSigner } from "@/lib/providers/payouts";
import { audit } from "./audit";

/** Any system account holding SOL can stand in as the deployer of a simulated launch. */
const SIM_DEPLOYER = new PublicKey("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
const LUT_KEY = LOOKUP_TABLE_STATE_KEY;
/** A lookup table whose creation started but did not finish; the next attempt continues with it. */
const LUT_PENDING_KEY = `${LOOKUP_TABLE_STATE_KEY}:pending`;

function connection() {
  if (!env.SOLANA_RPC_URL) throw new ApiError(400, "not_configured", "Set SOLANA_RPC_URL first.");
  return new Connection(env.SOLANA_RPC_URL, "confirmed");
}

const isHttpUrl = (v: string | undefined) => /^https?:\/\//.test((v ?? "").trim());

export async function readiness() {
  const lut = await lookupTableAddress().catch(() => null);
  const checks = [
    { label: "Solana mainnet", ok: env.SOLANA_CLUSTER === "mainnet-beta", detail: `SOLANA_CLUSTER=${env.SOLANA_CLUSTER}` },
    { label: "Solana RPC (server)", ok: isHttpUrl(env.SOLANA_RPC_URL), detail: "SOLANA_RPC_URL, must start with https://" },
    { label: "Solana RPC (browser)", ok: isHttpUrl(process.env.NEXT_PUBLIC_SOLANA_RPC_URL), detail: "NEXT_PUBLIC_SOLANA_RPC_URL, must start with https://" },
    { label: "Reward vault", ok: Boolean(env.FEE_VAULT_ADDRESS && env.PAYOUT_SIGNER), detail: "FEE_VAULT_ADDRESS + PAYOUT_SIGNER" },
    { label: "pump.fun launches", ok: env.LAUNCH_PROVIDER === "pumpfun", detail: `LAUNCH_PROVIDER=${env.LAUNCH_PROVIDER}` },
    { label: "Launch lookup table", ok: Boolean(lut), detail: lut ?? "Create it below" },
    { label: "Fee distribution", ok: env.FEE_PROVIDER === "pumpfun", detail: `FEE_PROVIDER=${env.FEE_PROVIDER}` },
    { label: "Real payouts", ok: env.PAYOUT_EXECUTOR === "solana", detail: `PAYOUT_EXECUTOR=${env.PAYOUT_EXECUTOR}` },
    { label: "Market prices", ok: env.PRICE_PROVIDER === "jupiter", detail: `PRICE_PROVIDER=${env.PRICE_PROVIDER}` },
    { label: "Video stats", ok: env.SOCIAL_PROVIDER === "live", detail: `SOCIAL_PROVIDER=${env.SOCIAL_PROVIDER}` },
    { label: "Public site URL", ok: env.APP_URL.startsWith("https://"), detail: env.APP_URL },
  ];
  const platforms = (["youtube", "tiktok", "instagram", "x"] as const).map((p) => ({ platform: p, ok: platformConfigured(p) }));
  const [{ n: demoTokens }] = (await db.execute(sql`SELECT count(*)::int AS n FROM tokens WHERE is_simulated = true`)).rows as Array<{ n: number }>;
  let vaultLamports: number | null = null;
  if (env.SOLANA_RPC_URL && env.FEE_VAULT_ADDRESS) {
    vaultLamports = await connection()
      .getBalance(new PublicKey(env.FEE_VAULT_ADDRESS))
      .catch(() => null);
  }
  return { checks, platforms, demoTokens: Number(demoTokens), vaultLamports, demoMode: isDemoMode };
}

export async function createLookupTable(actor: string) {
  const existing = await lookupTableAddress();
  if (existing) throw new ApiError(409, "exists", `A lookup table already exists: ${existing}`);
  if (!env.FEE_VAULT_ADDRESS) throw new ApiError(400, "not_configured", "Set FEE_VAULT_ADDRESS first.");
  const c = connection();
  const signer = vaultSigner();
  const accounts = await staticLaunchAccounts(c, new PublicKey(env.FEE_VAULT_ADDRESS), CREATOR_FEE_SPLIT.vaultBps);
  const send = async (tx: Transaction) => {
    const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = blockhash;
    await signer.sign(tx);
    const signature = await c.sendRawTransaction(tx.serialize());
    const res = await c.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    if (res.value.err) throw new ApiError(502, "transaction_failed", `Transaction failed: ${JSON.stringify(res.value.err)}`);
    return signature;
  };
  // A table created by an earlier attempt that stopped half-way is reused, so a retry never pays twice.
  const [pendingRow] = await db.select().from(schema.workerState).where(eq(schema.workerState.key, LUT_PENDING_KEY));
  const pendingAddress = (pendingRow?.value as { address?: string } | undefined)?.address;
  let table = pendingAddress ? new PublicKey(pendingAddress) : null;
  if (table && !(await c.getAddressLookupTable(table)).value) table = null;

  if (!table) {
    // The program only accepts a slot the validator still has in its recent slot hashes. RPC providers spread
    // requests over nodes that can lag each other, so use a real (non-skipped) block ~100 slots behind the tip
    // and retry with a fresh one if a node still disagrees.
    for (let attempt = 1; ; attempt++) {
      const tip = await c.getSlot("confirmed");
      const blocks = await c.getBlocks(tip - 150, tip - 100, "confirmed");
      const recentSlot = blocks.at(-1) ?? tip - 100;
      const [create, address] = AddressLookupTableProgram.createLookupTable({ authority: signer.publicKey, payer: signer.publicKey, recentSlot });
      try {
        await send(new Transaction().add(create));
        table = address;
        break;
      } catch (e) {
        if (attempt >= 3 || !/not a recent slot/i.test(e instanceof Error ? e.message : String(e))) throw e;
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }
    await db
      .insert(schema.workerState)
      .values({ key: LUT_PENDING_KEY, value: { address: table.toBase58() }, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.workerState.key, set: { value: { address: table.toBase58() }, updatedAt: new Date() } });
  }

  // Add only the accounts the table does not hold yet (a new table becomes readable within a slot or two).
  let present: PublicKey[] = [];
  for (let i = 0; i < 10; i++) {
    const state = (await c.getAddressLookupTable(table)).value;
    if (state) {
      present = state.state.addresses;
      break;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  const missing = accounts.filter((a) => !present.some((p) => p.equals(a)));
  for (let i = 0; i < missing.length; i += 20) {
    await send(
      new Transaction().add(
        AddressLookupTableProgram.extendLookupTable({ lookupTable: table, authority: signer.publicKey, payer: signer.publicKey, addresses: missing.slice(i, i + 20) }),
      ),
    );
  }
  const address = table.toBase58();
  await db.transaction(async (tx) => {
    await tx.delete(schema.workerState).where(eq(schema.workerState.key, LUT_PENDING_KEY));
    await tx
      .insert(schema.workerState)
      .values({ key: LUT_KEY, value: { address, accounts: accounts.length }, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.workerState.key, set: { value: { address, accounts: accounts.length }, updatedAt: new Date() } });
    await audit(tx, { actor, actorRole: "admin", action: "golive.lookup_table", targetType: "solana", targetId: address, after: { accounts: accounts.length } });
  });
  return { address, accounts: accounts.length };
}

/** Builds a full launch (coin, locked split, 0.05 SOL initial buy) and simulates it. Nothing is signed or sent. */
export async function simulateLaunch() {
  const table = await lookupTableAddress();
  if (!table) throw new ApiError(400, "not_configured", "Create the lookup table first.");
  if (!env.FEE_VAULT_ADDRESS) throw new ApiError(400, "not_configured", "Set FEE_VAULT_ADDRESS first.");
  const c = connection();
  const lookupTable = (await c.getAddressLookupTable(new PublicKey(table))).value;
  if (!lookupTable) throw new ApiError(400, "not_found", "The lookup table was not found on this cluster.");
  const built = await buildPumpFunLaunch(c, {
    mint: Keypair.generate().publicKey,
    deployer: SIM_DEPLOYER,
    vault: new PublicKey(env.FEE_VAULT_ADDRESS),
    vaultShareBps: CREATOR_FEE_SPLIT.vaultBps,
    name: "Simulated Coin",
    symbol: "SIMC",
    uri: new URL("/api/files/metadata/simulation.json", env.APP_URL).toString(),
    initialBuyLamports: 50_000_000,
    lookupTable,
  });
  // The initial buy only works once the coin exists, so only the launch transaction can be simulated on its own.
  const tx = built.transactions[0];
  const sim = await c.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  return {
    ok: !sim.value.err,
    error: sim.value.err ? JSON.stringify(sim.value.err) : null,
    bytes: tx.serialize().length,
    transactions: built.transactions.length,
    computeUnits: sim.value.unitsConsumed ?? null,
    logs: sim.value.err ? (sim.value.logs ?? []).slice(-15) : [],
  };
}

const KEEP = new Set(["config_entries", "config_history", "admins", "users", "audit_logs", "worker_state"]);

/** Removes the demonstration data (dry run unless confirm). Refuses once a real coin exists. */
export async function resetForLaunch(actor: string, confirm: boolean) {
  const [{ n: real }] = (await db.execute(sql`SELECT count(*)::int AS n FROM tokens WHERE is_simulated = false`)).rows as Array<{ n: number }>;
  if (Number(real) > 0) throw new ApiError(409, "has_real_data", `${real} real coin(s) exist; the demo reset is only for before launch.`);
  const tables = ((await db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`)).rows as Array<{ tablename: string }>)
    .map((r) => r.tablename)
    .filter((t) => !KEEP.has(t));
  const refs = (
    await db.execute(sql`
      SELECT src.relname AS src, dst.relname AS dst
      FROM pg_constraint c
      JOIN pg_class src ON src.oid = c.conrelid
      JOIN pg_class dst ON dst.oid = c.confrelid
      JOIN pg_namespace n ON n.oid = src.relnamespace
      WHERE c.contype = 'f' AND n.nspname = 'public'`)
  ).rows as Array<{ src: string; dst: string }>;
  const unsafe = refs.filter((r) => KEEP.has(r.src) && !KEEP.has(r.dst));
  if (unsafe.length) throw new ApiError(409, "unsafe", `Kept tables reference emptied ones: ${unsafe.map((r) => `${r.src} → ${r.dst}`).join(", ")}`);

  const counts: Record<string, number> = {};
  for (const t of tables) {
    const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM ${sql.identifier(t)}`)).rows as Array<{ n: number }>;
    counts[t] = Number(n);
  }
  const [{ n: users }] = (await db.execute(sql`SELECT count(*)::int AS n FROM users WHERE wallet NOT IN (SELECT wallet FROM admins)`)).rows as Array<{ n: number }>;
  counts["users (non-admin)"] = Number(users);
  if (!confirm) return { removed: false, counts };

  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`TRUNCATE ${tables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`));
    await tx.execute(sql`DELETE FROM users WHERE wallet NOT IN (SELECT wallet FROM admins)`);
    await tx.execute(sql`DELETE FROM worker_state WHERE key NOT IN (${LUT_KEY}, ${LUT_PENDING_KEY})`);
    await audit(tx, { actor, actorRole: "admin", action: "golive.reset_demo_data", targetType: "platform", targetId: "all", after: counts });
  });
  return { removed: true, counts };
}

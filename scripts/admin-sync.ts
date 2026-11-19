/**
 * Grants the admin role to every wallet listed in ADMIN_WALLETS (idempotent).
 * Runs on every hosted build (`npm run vercel-build`), so adding a wallet to
 * ADMIN_WALLETS and redeploying is enough. Existing roles are never changed
 * or revoked here; manage those with `npm run admin:add`.
 *   npx tsx scripts/admin-sync.ts
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { adminWalletsFromEnv } = await import("@/lib/env");
  const wallets = adminWalletsFromEnv();
  if (wallets.length === 0) {
    console.log("ADMIN_WALLETS is not set; no admin roles granted.");
    return;
  }
  const { isValidAddress } = await import("@/lib/solana/keys");
  const { db, pool, schema } = await import("@/lib/db");
  const { audit } = await import("@/lib/services/audit");
  for (const wallet of wallets) {
    if (!isValidAddress(wallet)) {
      console.warn(`ADMIN_WALLETS: skipping "${wallet}" — not a valid Solana address (copy the Solana address from your wallet, not an Ethereum 0x… address).`);
      continue;
    }
    await db.insert(schema.users).values({ wallet }).onConflictDoNothing();
    const granted = await db
      .insert(schema.admins)
      .values({ wallet, role: "admin", addedBy: "env:ADMIN_WALLETS" })
      .onConflictDoNothing()
      .returning({ wallet: schema.admins.wallet });
    if (granted.length > 0) {
      await audit(db, { actor: "env:ADMIN_WALLETS", action: "admin.grant", targetType: "user", targetId: wallet, after: { role: "admin" } });
      console.log(`ADMIN_WALLETS: granted admin to ${wallet}`);
    } else {
      console.log(`ADMIN_WALLETS: ${wallet} already has an administrative role`);
    }
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Grants a wallet an administrative role.
 *   npm run admin:add -- <wallet> [admin|reviewer]
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const [wallet, role = "admin"] = process.argv.slice(2);
  const { isValidAddress } = await import("@/lib/solana/keys");
  if (!wallet || !isValidAddress(wallet) || !["admin", "reviewer"].includes(role)) {
    console.error("Usage: npm run admin:add -- <wallet> [admin|reviewer]");
    process.exit(1);
  }
  const { db, pool, schema } = await import("@/lib/db");
  const { audit } = await import("@/lib/services/audit");
  await db.insert(schema.users).values({ wallet }).onConflictDoNothing();
  await db
    .insert(schema.admins)
    .values({ wallet, role: role as "admin" | "reviewer", addedBy: "cli:admin-add" })
    .onConflictDoUpdate({ target: schema.admins.wallet, set: { role: role as "admin" | "reviewer" } });
  await audit(db, { actor: "cli:admin-add", action: "admin.grant", targetType: "user", targetId: wallet, after: { role } });
  console.log(`Granted ${role} to ${wallet}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

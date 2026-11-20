import { PublicKey } from "@solana/web3.js";
import { env } from "@/lib/env";
import type { PlatformRecipients } from "./pumpfun";

/** VYRAL's on-chain fee recipients from the environment (server only). */
export function platformRecipients(): PlatformRecipients {
  const missing = (["FEE_VAULT_ADDRESS", "PLATFORM_FEE_ADDRESS"] as const).filter((k) => !env[k]);
  if (missing.length) throw new Error(`Set ${missing.join(" and ")} to launch coins.`);
  const vault = new PublicKey(env.FEE_VAULT_ADDRESS!);
  const platform = new PublicKey(env.PLATFORM_FEE_ADDRESS!);
  if (platform.equals(vault)) throw new Error("PLATFORM_FEE_ADDRESS must differ from FEE_VAULT_ADDRESS (the vault's balance belongs to the competitions).");
  return { vault, platform };
}

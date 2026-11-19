/**
 * Server-side environment, validated once at module load.
 *
 * Provider switches default to the clearly-labelled development
 * implementations ("mock" / "simulated"). Production deployments must set
 * them explicitly together with the matching credentials; `assertLiveConfig`
 * fails fast if a live provider is selected without its credentials.
 *
 * This module is imported by both the Next.js server and the background
 * worker, so it must not depend on Next-only APIs.
 */
import { z } from "zod";

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** Secret used for HMAC-hashing IPs and other non-reversible identifiers. */
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  /** 32-byte key (base64) used to encrypt OAuth tokens at rest. */
  TOKEN_ENCRYPTION_KEY: optionalString,
  /** Comma-separated wallets granted the admin role by `npm run db:seed` / `admin:add`. */
  ADMIN_WALLETS: optionalString,

  SOLANA_CLUSTER: z.enum(["mainnet-beta", "devnet"]).default("devnet"),
  SOLANA_RPC_URL: optionalString,

  SOCIAL_PROVIDER: z.enum(["mock", "live"]).default("mock"),
  LAUNCH_PROVIDER: z.enum(["simulated", "external"]).default("simulated"),
  PRICE_PROVIDER: z.enum(["mock", "jupiter"]).default("mock"),
  FEE_PROVIDER: z.enum(["mock", "onchain"]).default("mock"),
  PAYOUT_EXECUTOR: z.enum(["simulated", "solana"]).default("simulated"),
  /** local: files on disk · database: stored in PostgreSQL (serverless hosts) · pinata: IPFS */
  STORAGE_PROVIDER: z.enum(["local", "database", "pinata"]).default("local"),
  /** Shared secret for /api/cron/tick (serverless hosts without a long-running worker). */
  CRON_SECRET: optionalString,

  /** Public key of the fee vault that receives creator fees for competitions. */
  FEE_VAULT_ADDRESS: optionalString,
  /** Payout signer: "env-keypair" (devnet/testing) or "remote" (KMS / custody signer). */
  PAYOUT_SIGNER: z.enum(["env-keypair", "remote"]).optional(),
  PAYOUT_SIGNER_SECRET_KEY: optionalString,
  REMOTE_SIGNER_URL: optionalString,
  REMOTE_SIGNER_TOKEN: optionalString,

  EXTERNAL_LAUNCH_API_URL: optionalString,
  EXTERNAL_LAUNCH_API_KEY: optionalString,
  JUPITER_PRICE_API_URL: z.string().url().default("https://lite-api.jup.ag/price/v3"),

  YOUTUBE_API_KEY: optionalString,
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  TIKTOK_CLIENT_KEY: optionalString,
  TIKTOK_CLIENT_SECRET: optionalString,
  INSTAGRAM_CLIENT_ID: optionalString,
  INSTAGRAM_CLIENT_SECRET: optionalString,
  X_BEARER_TOKEN: optionalString,
  X_CLIENT_ID: optionalString,
  X_CLIENT_SECRET: optionalString,

  PINATA_JWT: optionalString,
  PINATA_GATEWAY: optionalString,
  UPLOAD_DIR: z.string().default(".data/uploads"),

  /** Trust X-Forwarded-For from a reverse proxy (only enable behind one). */
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\nSee .env.example.`);
  }
  return parsed.data;
}

export const env: Env = load();

/** True when any part of the platform runs on simulated/mock infrastructure. */
export const isDemoMode =
  env.SOCIAL_PROVIDER === "mock" ||
  env.LAUNCH_PROVIDER === "simulated" ||
  env.PRICE_PROVIDER === "mock" ||
  env.FEE_PROVIDER === "mock" ||
  env.PAYOUT_EXECUTOR === "simulated";

export function adminWalletsFromEnv(): string[] {
  return (env.ADMIN_WALLETS ?? "")
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);
}

/**
 * Fails fast when a live provider is enabled without its credentials.
 * Called by the worker on boot and by the provider registries.
 */
export function assertLiveConfig(): string[] {
  const problems: string[] = [];
  if (env.PAYOUT_EXECUTOR === "solana") {
    if (!env.SOLANA_RPC_URL) problems.push("PAYOUT_EXECUTOR=solana requires SOLANA_RPC_URL");
    if (!env.FEE_VAULT_ADDRESS) problems.push("PAYOUT_EXECUTOR=solana requires FEE_VAULT_ADDRESS");
    if (env.PAYOUT_SIGNER === "env-keypair" && !env.PAYOUT_SIGNER_SECRET_KEY)
      problems.push("PAYOUT_SIGNER=env-keypair requires PAYOUT_SIGNER_SECRET_KEY");
    if (env.PAYOUT_SIGNER === "remote" && (!env.REMOTE_SIGNER_URL || !env.REMOTE_SIGNER_TOKEN))
      problems.push("PAYOUT_SIGNER=remote requires REMOTE_SIGNER_URL and REMOTE_SIGNER_TOKEN");
    if (!env.PAYOUT_SIGNER) problems.push("PAYOUT_EXECUTOR=solana requires PAYOUT_SIGNER");
    if (env.SOLANA_CLUSTER === "mainnet-beta" && env.PAYOUT_SIGNER === "env-keypair")
      problems.push("env-keypair signing is not permitted on mainnet-beta; use a remote signer (KMS/custody)");
  }
  if (env.SOCIAL_PROVIDER === "live") {
    if (!env.TOKEN_ENCRYPTION_KEY) problems.push("SOCIAL_PROVIDER=live requires TOKEN_ENCRYPTION_KEY");
  }
  if (env.FEE_PROVIDER === "onchain" && (!env.SOLANA_RPC_URL || !env.FEE_VAULT_ADDRESS))
    problems.push("FEE_PROVIDER=onchain requires SOLANA_RPC_URL and FEE_VAULT_ADDRESS");
  if (env.LAUNCH_PROVIDER === "external" && !env.EXTERNAL_LAUNCH_API_URL)
    problems.push("LAUNCH_PROVIDER=external requires EXTERNAL_LAUNCH_API_URL");
  if (env.STORAGE_PROVIDER === "pinata" && !env.PINATA_JWT) problems.push("STORAGE_PROVIDER=pinata requires PINATA_JWT");
  return problems;
}

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

/**
 * Public base URL. Falls back to the production domain Vercel provides
 * (VERCEL_PROJECT_PRODUCTION_URL), so links written into token metadata and
 * sign-in messages never point at localhost on a deployment without APP_URL.
 */
const defaultAppUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_URL: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined), z.string().url().default(defaultAppUrl)),
  /** Secret used for HMAC-hashing IPs and other non-reversible identifiers. */
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  /** 32-byte key (base64) used to encrypt OAuth tokens at rest. */
  TOKEN_ENCRYPTION_KEY: optionalString,
  /** Comma-separated wallets granted the admin role by `npm run db:seed` / `admin:add`. */
  ADMIN_WALLETS: optionalString,

  SOLANA_CLUSTER: z.enum(["mainnet-beta", "devnet"]).default("devnet"),
  SOLANA_RPC_URL: optionalString,

  SOCIAL_PROVIDER: z.enum(["mock", "live"]).default("mock"),
  LAUNCH_PROVIDER: z.enum(["simulated", "pumpfun", "external"]).default("simulated"),
  PRICE_PROVIDER: z.enum(["mock", "jupiter"]).default("mock"),
  FEE_PROVIDER: z.enum(["mock", "pumpfun", "onchain"]).default("mock"),
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

  /** Address lookup table created by scripts/pumpfun-lut.ts (keeps a launch in one transaction). */
  PUMPFUN_LOOKUP_TABLE: optionalString,
  /**
   * Allows the payout signer to be a key stored in the environment on
   * mainnet-beta (a "hot wallet"). Off by default; when on, every single
   * payout is capped at PAYOUT_MAX_LAMPORTS.
   */
  PAYOUT_ALLOW_HOT_WALLET: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  PAYOUT_MAX_LAMPORTS: z.coerce.number().int().positive().default(5_000_000_000),
  /**
   * VYRAL platform wallet: receives the treasury + buyback parts of every coin's creator fees (locked at
   * launch). The buyback job forwards the treasury's part to FEE_TREASURY_ADDRESS and burns the rest.
   */
  PLATFORM_FEE_ADDRESS: optionalString,
  /** Secret key of the platform wallet (base58 or JSON array), so forwarding and buybacks run automatically. */
  PLATFORM_SIGNER_SECRET_KEY: optionalString,
  /** Where the treasury's part goes (any wallet; no key needed). */
  FEE_TREASURY_ADDRESS: optionalString,
  /** Most SOL one buyback run spends (default 0.5 SOL); larger balances are bought over several runs. */
  BUYBACK_MAX_LAMPORTS_PER_RUN: z.coerce.number().int().positive().default(500_000_000),
  /** A buy is skipped (or made smaller) when it would move the price more than this, in percent. */
  BUYBACK_MAX_PRICE_IMPACT_PCT: z.coerce.number().positive().max(10).default(1.5),
  JUPITER_SWAP_API_URL: z.string().url().default("https://lite-api.jup.ag/swap/v1"),
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

  /** Operator details shown in the Imprint, Terms and Privacy Policy (non-secret). Address lines separated by "|". */
  LEGAL_OPERATOR_NAME: optionalString,
  LEGAL_OPERATOR_ADDRESS: optionalString,
  LEGAL_CONTACT_EMAIL: optionalString,
  LEGAL_CONTACT_PHONE: optionalString,
  LEGAL_REPRESENTATIVE: optionalString,
  LEGAL_REGISTER: optionalString,
  LEGAL_VAT_ID: optionalString,
  LEGAL_GOVERNING_LAW: optionalString,
  /** Set to "true" once a lawyer has reviewed the legal texts; hides the draft notice. */
  LEGAL_TEXTS_REVIEWED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

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

/**
 * The public production site (Vercel sets VERCEL_ENV=production). It never
 * shows demonstration data, banners or simulated launches, even while the
 * live providers are still being configured: until then it simply has no
 * coins and launching shows "opens soon".
 */
export const isProductionDeployment = process.env.VERCEL_ENV === "production";

/** Demonstration content is shown: demo providers, and not on the production site. */
export const showDemo = isDemoMode && !isProductionDeployment;

/** Launching is possible: always outside production, on production only with a real launch provider. */
export const launchesOpen = !(isProductionDeployment && env.LAUNCH_PROVIDER === "simulated");

/**
 * Platforms whose API credentials are configured. With SOCIAL_PROVIDER=mock
 * every platform works (simulated); live submissions for a platform without
 * credentials are refused with a clear message.
 */
export function platformConfigured(platform: "youtube" | "tiktok" | "instagram" | "x"): boolean {
  // Simulated video stats: fine for the demo, never on the production site (real payouts would follow fake views).
  if (env.SOCIAL_PROVIDER === "mock") return !isProductionDeployment;
  switch (platform) {
    case "youtube":
      return Boolean(env.YOUTUBE_API_KEY && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
    case "tiktok":
      return Boolean(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET);
    case "instagram":
      return Boolean(env.INSTAGRAM_CLIENT_ID && env.INSTAGRAM_CLIENT_SECRET);
    case "x":
      return Boolean(env.X_BEARER_TOKEN && env.X_CLIENT_ID && env.X_CLIENT_SECRET);
  }
}

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
    if (env.SOLANA_CLUSTER === "mainnet-beta" && env.PAYOUT_SIGNER === "env-keypair" && !env.PAYOUT_ALLOW_HOT_WALLET)
      problems.push("env-keypair signing on mainnet-beta requires PAYOUT_ALLOW_HOT_WALLET=true (or use a remote signer)");
  }
  if (env.SOCIAL_PROVIDER === "live") {
    if (!env.TOKEN_ENCRYPTION_KEY) problems.push("SOCIAL_PROVIDER=live requires TOKEN_ENCRYPTION_KEY");
  }
  if (env.FEE_PROVIDER === "onchain" && (!env.SOLANA_RPC_URL || !env.FEE_VAULT_ADDRESS))
    problems.push("FEE_PROVIDER=onchain requires SOLANA_RPC_URL and FEE_VAULT_ADDRESS");
  if (env.LAUNCH_PROVIDER === "pumpfun" && (!env.SOLANA_RPC_URL || !env.FEE_VAULT_ADDRESS || !env.PLATFORM_FEE_ADDRESS))
    problems.push("LAUNCH_PROVIDER=pumpfun requires SOLANA_RPC_URL, FEE_VAULT_ADDRESS and PLATFORM_FEE_ADDRESS");
  if (env.FEE_PROVIDER === "pumpfun" && (!env.SOLANA_RPC_URL || !env.FEE_VAULT_ADDRESS || env.PAYOUT_EXECUTOR !== "solana"))
    problems.push("FEE_PROVIDER=pumpfun requires SOLANA_RPC_URL, FEE_VAULT_ADDRESS and PAYOUT_EXECUTOR=solana (the vault signs distributions)");
  if (env.LAUNCH_PROVIDER === "external" && !env.EXTERNAL_LAUNCH_API_URL)
    problems.push("LAUNCH_PROVIDER=external requires EXTERNAL_LAUNCH_API_URL");
  if (env.STORAGE_PROVIDER === "pinata" && !env.PINATA_JWT) problems.push("STORAGE_PROVIDER=pinata requires PINATA_JWT");
  return problems;
}

import { env } from "@/lib/env";

export function explorerTxUrl(signature: string): string {
  const cluster = env.SOLANA_CLUSTER === "mainnet-beta" ? "" : `?cluster=${env.SOLANA_CLUSTER}`;
  return `https://solscan.io/tx/${signature}${cluster}`;
}

export function explorerAccountUrl(address: string): string {
  const cluster = env.SOLANA_CLUSTER === "mainnet-beta" ? "" : `?cluster=${env.SOLANA_CLUSTER}`;
  return `https://solscan.io/account/${address}${cluster}`;
}

export function explorerTokenUrl(mint: string): string {
  const cluster = env.SOLANA_CLUSTER === "mainnet-beta" ? "" : `?cluster=${env.SOLANA_CLUSTER}`;
  return `https://solscan.io/token/${mint}${cluster}`;
}

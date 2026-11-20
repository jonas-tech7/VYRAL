/**
 * How every coin launched on VYRAL splits its pump.fun creator fees. Locked
 * on-chain at launch (the fee sharing admin is revoked in the same
 * transaction), so neither the deployer nor VYRAL can change it afterwards.
 *
 *   vault     the coin's video competition (paid out to the top video)
 *   deployer  the wallet that launched the coin
 *   treasury  VYRAL (operations, hosting, development)
 *   buyback   buys $VYRAL on the open market and burns it
 *
 * On-chain the treasury and buyback parts go to one VYRAL platform wallet
 * (one shareholder less keeps the launch, its split and the deployer's first
 * buy inside one transaction). The buyback job forwards the treasury's part
 * of every deposit and spends the rest on buy-and-burn (lib/services/buyback.ts).
 *
 * Safe to import in the browser (no secrets, no addresses).
 */
export const CREATOR_FEE_SPLIT = { vaultBps: 4_500, deployerBps: 2_500, treasuryBps: 1_000, buybackBps: 2_000 } as const;

export type FeeSplit = { vaultBps: number; deployerBps: number; treasuryBps: number; buybackBps: number };

/** The parts in display order, with labels used across the site. */
export const FEE_SPLIT_PARTS = [
  { key: "vaultBps", label: "Competition rewards", short: "Competition", tone: "accent" },
  { key: "deployerBps", label: "Deployer", short: "Deployer", tone: "ink" },
  { key: "buybackBps", label: "$VYRAL buyback & burn", short: "Buyback & burn", tone: "silver" },
  { key: "treasuryBps", label: "VYRAL treasury", short: "Treasury", tone: "muted" },
] as const;

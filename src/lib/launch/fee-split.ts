/**
 * How every coin launched on VYRAL splits its pump.fun creator fees. Locked
 * on-chain at launch (the fee sharing admin is revoked in the same
 * transaction), so neither the deployer nor VYRAL can change it afterwards.
 */
export const CREATOR_FEE_SPLIT = { vaultBps: 5_000, deployerBps: 5_000 } as const;

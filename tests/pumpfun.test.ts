import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { CREATOR_FEE_SPLIT } from "@/lib/launch/fee-split";
import { PUMP_LIMITS, shareholders, staticLaunchAccounts } from "@/lib/launch/pumpfun";

describe("pump.fun launch", () => {
  const vault = Keypair.generate().publicKey;
  const deployer = Keypair.generate().publicKey;

  it("splits creator fees 50/50 between the reward vault and the deployer", () => {
    expect(CREATOR_FEE_SPLIT.vaultBps + CREATOR_FEE_SPLIT.deployerBps).toBe(10_000);
    const s = shareholders({ vault, deployer, vaultShareBps: CREATOR_FEE_SPLIT.vaultBps });
    expect(s).toHaveLength(2);
    expect(s[0].address.equals(vault)).toBe(true);
    expect(s[0].shareBps).toBe(5_000);
    expect(s[1].address.equals(deployer)).toBe(true);
    expect(s[1].shareBps).toBe(5_000);
    expect(s.reduce((a, x) => a + x.shareBps, 0)).toBe(10_000);
  });

  it("puts only accounts shared by every launch into the lookup table", async () => {
    const accounts = (await staticLaunchAccounts(null, vault, CREATOR_FEE_SPLIT.vaultBps)).map((k) => k.toBase58());
    // Program ids verified against mainnet (simulation of create_v2 + create_fee_sharing_config).
    expect(accounts).toContain("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
    expect(accounts).toContain("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
    expect(new Set(accounts).size).toBe(accounts.length);
    expect(accounts.length).toBeLessThanOrEqual(256);
  });

  it("uses pump.fun's byte limits for name, ticker and metadata link", () => {
    expect(PUMP_LIMITS).toEqual({ name: 32, symbol: 13, uri: 200 });
  });
});

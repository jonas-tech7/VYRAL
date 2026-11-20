import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { CREATOR_FEE_SPLIT } from "@/lib/launch/fee-split";
import { PUMP_LIMITS, shareholders, staticLaunchAccounts } from "@/lib/launch/pumpfun";

describe("pump.fun launch", () => {
  const key = () => Keypair.generate().publicKey;
  const platform = { vault: key(), platform: key() };
  const deployer = key();

  it("splits creator fees 45 / 25 / 30: competition, deployer, platform (10 treasury + 20 buyback)", () => {
    const { vaultBps, deployerBps, treasuryBps, buybackBps } = CREATOR_FEE_SPLIT;
    expect([vaultBps, deployerBps, treasuryBps, buybackBps]).toEqual([4_500, 2_500, 1_000, 2_000]);
    const s = shareholders({ deployer, platform });
    expect(s.map((x) => [x.address.toBase58(), x.shareBps])).toEqual([
      [platform.vault.toBase58(), 4_500],
      [deployer.toBase58(), 2_500],
      [platform.platform.toBase58(), 3_000],
    ]);
  });

  it("merges parts that go to the same wallet (pump.fun rejects duplicate shareholders)", () => {
    const s = shareholders({ deployer: platform.platform, platform });
    expect(s).toHaveLength(2);
    expect(s.find((x) => x.address.equals(platform.platform))?.shareBps).toBe(5_500);
    expect(s.reduce((a, x) => a + x.shareBps, 0)).toBe(10_000);
  });

  it("puts only accounts shared by every launch into the lookup table", async () => {
    const accounts = (await staticLaunchAccounts(null, platform)).map((k) => k.toBase58());
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

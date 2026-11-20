import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { attributeVaultDeposit, decodeDistributeEvent, signatureOfKey, type VaultTransaction } from "@/lib/launch/pumpfun-fees";

const key = () => Keypair.generate().publicKey;
const vault = key();
const deployer = key();
const VAULT = vault.toBase58();

/** Borsh-encodes a DistributeCreatorFeesEvent the way pump emits it through self-CPI. */
function distributeEvent(mint: string, sharingConfig: string, distributed: bigint, cpi = true): Buffer {
  const pk = (s: string) => new PublicKey(s).toBuffer();
  const parts = [
    ...(cpi ? [Buffer.from([228, 69, 165, 46, 81, 203, 154, 29])] : []),
    Buffer.from([165, 55, 129, 112, 4, 179, 202, 40]),
    Buffer.alloc(8), // timestamp
    pk(mint),
    key().toBuffer(), // bonding_curve
    pk(sharingConfig),
    key().toBuffer(), // admin
  ];
  const n = Buffer.alloc(4);
  n.writeUInt32LE(2);
  parts.push(n);
  for (const [addr, bps] of [
    [VAULT, 5_000],
    [deployer.toBase58(), 5_000],
  ] as const) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(bps);
    parts.push(pk(addr), b);
  }
  const d = Buffer.alloc(8);
  d.writeBigUInt64LE(distributed);
  parts.push(d, key().toBuffer()); // distributed, quote_mint
  return Buffer.concat(parts);
}

function tx(over: Partial<VaultTransaction> & { vaultDelta: number; keys?: string[] }): VaultTransaction {
  const keys = over.keys ?? [key().toBase58(), VAULT];
  const i = keys.indexOf(VAULT);
  const pre = keys.map(() => 10_000_000);
  const post = pre.map((p, j) => (j === i ? p + over.vaultDelta : p));
  return {
    signature: "sig1",
    failed: false,
    accountKeys: keys,
    preBalances: pre,
    postBalances: post,
    fee: 5_000,
    logs: ["Program log: Instruction: DistributeCreatorFees"],
    eventData: [],
    ...over,
  };
}

describe("pump.fun fee attribution", () => {
  const mintA = key().toBase58();
  const mintB = key().toBase58();
  const scA = key().toBase58();
  const scB = key().toBase58();
  const coins = new Map([
    [scA, { tokenId: "token-a", mint: mintA }],
    [scB, { tokenId: "token-b", mint: mintB }],
  ]);

  it("decodes the distribution event, with and without the self-CPI prefix", () => {
    for (const cpi of [true, false]) {
      const e = decodeDistributeEvent(distributeEvent(mintA, scA, 123_456n, cpi));
      expect(e).not.toBeNull();
      expect(e!.mint).toBe(mintA);
      expect(e!.sharingConfig).toBe(scA);
      expect(e!.distributed).toBe(123_456n);
      expect(e!.shareBps.get(VAULT)).toBe(5_000);
    }
    expect(decodeDistributeEvent(Buffer.from([1, 2, 3]))).toBeNull();
  });

  it("credits a distribution sent by anyone to its coin", () => {
    const r = attributeVaultDeposit(tx({ vaultDelta: 400_000, keys: [key().toBase58(), VAULT, scA, mintA] }), VAULT, coins);
    expect(r.credits).toEqual([{ tokenId: "token-a", mint: mintA, amountLamports: 400_000, key: "sig1" }]);
    expect(r.unattributed).toBeNull();
  });

  it("adds back the network fee when the vault itself paid it", () => {
    const r = attributeVaultDeposit(tx({ vaultDelta: 400_000 - 5_000, keys: [VAULT, scA, mintA] }), VAULT, coins);
    expect(r.credits[0].amountLamports).toBe(400_000);
  });

  it("ignores payouts, plain deposits and failed transactions", () => {
    expect(attributeVaultDeposit(tx({ vaultDelta: -1_000_000, keys: [VAULT, scA] }), VAULT, coins).credits).toEqual([]);
    const plain = attributeVaultDeposit(tx({ vaultDelta: 50_000, keys: [key().toBase58(), VAULT], logs: [] }), VAULT, coins);
    expect(plain.credits).toEqual([]);
    expect(plain.unattributed).toBeNull();
    expect(attributeVaultDeposit(tx({ vaultDelta: 50_000, keys: [key().toBase58(), VAULT, scA], failed: true }), VAULT, coins).credits).toEqual([]);
  });

  it("reports distributions for coins it does not know", () => {
    const r = attributeVaultDeposit(tx({ vaultDelta: 50_000, keys: [key().toBase58(), VAULT, key().toBase58()] }), VAULT, coins);
    expect(r.credits).toEqual([]);
    expect(r.unattributed).toMatch(/not an active VYRAL competition/);
  });

  it("splits a batched distribution of several coins by their events", () => {
    const r = attributeVaultDeposit(
      tx({
        vaultDelta: 1_000_001,
        keys: [key().toBase58(), VAULT, scA, mintA, scB, mintB],
        eventData: [distributeEvent(mintA, scA, 1_500_000n), distributeEvent(mintB, scB, 500_000n)],
      }),
      VAULT,
      coins,
    );
    const byToken = Object.fromEntries(r.credits.map((c) => [c.tokenId, c]));
    expect(byToken["token-a"].amountLamports).toBe(750_001);
    expect(byToken["token-b"].amountLamports).toBe(250_000);
    expect(byToken["token-a"].key).toBe(`sig1:${mintA}`);
    expect(signatureOfKey(byToken["token-a"].key)).toBe("sig1");
    expect(r.credits.reduce((s, c) => s + c.amountLamports, 0)).toBe(1_000_001);
  });
});

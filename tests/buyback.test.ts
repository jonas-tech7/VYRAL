import { describe, expect, it } from "vitest";
import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { depositAmount, sizeWithinImpact, splitDeposit } from "@/lib/services/buyback";

describe("platform wallet buyback", () => {
  it("splits each deposit 10 : 20 between treasury and buyback (no lamport lost)", () => {
    expect(splitDeposit(3_000_000)).toEqual({ treasury: 1_000_000, buyback: 2_000_000 });
    const odd = splitDeposit(1_000_001);
    expect(odd.treasury + odd.buyback).toBe(1_000_001);
    expect(odd.treasury).toBe(333_333);
  });

  it("halves the buy until it stays under the price impact cap", async () => {
    // Impact grows linearly with size: 1 SOL moves the price 4 %.
    const quote = async (lamports: number) => ({ priceImpactPct: String((lamports / 1e9) * 0.04) });
    const sized = await sizeWithinImpact(1_000_000_000, quote, 1);
    expect(sized?.lamports).toBe(250_000_000);
    expect(await sizeWithinImpact(1_000_000_000, async () => ({ priceImpactPct: "0.5" }), 1)).toBeNull();
  });

  const tx = (signer: boolean, pre: number, post: number, err: unknown = null) =>
    ({
      meta: { err, preBalances: [5_000_000, pre], postBalances: [4_000_000, post], fee: 5_000 },
      transaction: { message: { accountKeys: [{ pubkey: { toBase58: () => "OTHER" }, signer: true }, { pubkey: { toBase58: () => "PLATFORM" }, signer }] } },
    }) as unknown as ParsedTransactionWithMeta;

  it("counts what others pay in, ignores the wallet's own and failed transactions", () => {
    expect(depositAmount(tx(false, 1_000, 301_000), "PLATFORM")).toBe(300_000);
    expect(depositAmount(tx(true, 1_000, 301_000), "PLATFORM")).toBe(0); // its own (e.g. unwrapping after a swap)
    expect(depositAmount(tx(false, 1_000, 301_000, { InstructionError: [0, "x"] }), "PLATFORM")).toBe(0);
    expect(depositAmount(tx(false, 301_000, 1_000), "PLATFORM")).toBe(0);
  });
});

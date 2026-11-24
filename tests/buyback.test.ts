import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { createTransferInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { checkQuote, checkSwapTransaction, depositAmount, sizeWithinImpact, splitDeposit, type Quote } from "@/lib/services/buyback";

const PUMP_FEES = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";
const SOL = "So11111111111111111111111111111111111111112";
const MINT = "6SwqXNoeXMXUBAYeuQetpY64PEDEF1vh9rGqRVGB9mqy";

describe("platform wallet buyback", () => {
  it("splits each deposit 10 : 20 between treasury and buyback (no lamport lost)", () => {
    expect(splitDeposit(3_000_000)).toEqual({ treasury: 1_000_000, buyback: 2_000_000 });
    const odd = splitDeposit(1_000_001);
    expect(odd.treasury + odd.buyback).toBe(1_000_001);
    expect(odd.treasury).toBe(333_333);
  });

  // A constant-product curve with 30 SOL of virtual reserves (like a young pump.fun coin).
  const curve = (lamports: number) => String(Math.floor((1e15 * lamports) / (30e9 + lamports)));

  it("halves the buy until the reported price impact is under the cap", async () => {
    // Reported impact grows linearly with size: 1 SOL moves the price 4 %; the curve itself is deep.
    const quote = async (lamports: number) => ({ priceImpactPct: String((lamports / 1e9) * 0.04), outAmount: String(lamports * 1000) });
    const sized = await sizeWithinImpact(1_000_000_000, quote, 1);
    expect(sized?.lamports).toBe(250_000_000);
    expect(await sizeWithinImpact(1_000_000_000, async () => ({ priceImpactPct: "0.5", outAmount: "1000" }), 1)).toBeNull();
  });

  it("measures the price impact itself when Jupiter reports none", async () => {
    // Jupiter says "0", but on the curve 1 SOL costs ~3.3 % more on average than a tiny buy.
    const quote = async (lamports: number) => ({ priceImpactPct: "0", outAmount: curve(lamports) });
    const sized = await sizeWithinImpact(1_000_000_000, quote, 1);
    expect(sized?.lamports).toBe(250_000_000); // 0.25 SOL: ~0.83 %
    expect(sized!.impactPct).toBeGreaterThan(0.8);
    expect(sized!.impactPct).toBeLessThan(0.85);
    // Unreadable amounts are never taken as "no impact".
    expect(await sizeWithinImpact(1_000_000_000, async () => ({ priceImpactPct: "0", outAmount: "n/a" }), 1)).toBeNull();
    // Below the minimum buy nothing is quoted at all.
    expect(await sizeWithinImpact(1_000, quote, 1)).toBeNull();
  });

  const tx = (signer: boolean, pre: number, post: number, err: unknown = null, viaPump = true) =>
    ({
      meta: { err, preBalances: [5_000_000, pre, 1], postBalances: [4_000_000, post, 1], fee: 5_000 },
      transaction: {
        message: {
          accountKeys: [
            { pubkey: { toBase58: () => "OTHER" }, signer: true },
            { pubkey: { toBase58: () => "PLATFORM" }, signer },
            { pubkey: { toBase58: () => (viaPump ? PUMP_FEES : "11111111111111111111111111111111") }, signer: false },
          ],
        },
      },
    }) as unknown as ParsedTransactionWithMeta;

  it("counts creator-fee distributions paid in, nothing else", () => {
    expect(depositAmount(tx(false, 1_000, 301_000), "PLATFORM")).toBe(300_000);
    expect(depositAmount(tx(true, 1_000, 301_000), "PLATFORM")).toBe(0); // its own (e.g. unwrapping after a swap)
    expect(depositAmount(tx(false, 1_000, 301_000, { InstructionError: [0, "x"] }), "PLATFORM")).toBe(0);
    expect(depositAmount(tx(false, 301_000, 1_000), "PLATFORM")).toBe(0);
    // A plain transfer (topping the wallet up for network fees) is not fee income.
    expect(depositAmount(tx(false, 1_000, 301_000, null, false), "PLATFORM")).toBe(0);
  });

  const quote = (over: Partial<Quote> = {}): Quote => ({
    inputMint: SOL,
    outputMint: MINT,
    inAmount: "100000000",
    outAmount: "1000000",
    otherAmountThreshold: "970000",
    swapMode: "ExactIn",
    priceImpactPct: "0.001",
    ...over,
  });

  it("accepts only the exact buy that was asked for", () => {
    expect(checkQuote(quote(), MINT, 100_000_000)).toBeNull();
    expect(checkQuote(quote({ outputMint: SOL }), MINT, 100_000_000)).toBe("wrong tokens");
    expect(checkQuote(quote({ inputMint: MINT }), MINT, 100_000_000)).toBe("wrong tokens");
    expect(checkQuote(quote({ inAmount: "200000000" }), MINT, 100_000_000)).toBe("wrong amount");
    expect(checkQuote(quote({ swapMode: "ExactOut" }), MINT, 100_000_000)).toBe("wrong amount");
    expect(checkQuote(quote({ otherAmountThreshold: "1" }), MINT, 100_000_000)).toBe("minimum output below the slippage limit");
    expect(checkQuote(quote({ otherAmountThreshold: "2000000" }), MINT, 100_000_000)).toBe("invalid output");
    expect(checkQuote(quote({ outAmount: "abc" }), MINT, 100_000_000)).toBe("unreadable amounts");
  });

  it("refuses swap transactions that do more than swap for the wallet", () => {
    const wallet = Keypair.generate().publicKey;
    const v0 =(payer: PublicKey, ixs: ConstructorParameters<typeof TransactionMessage>[0]["instructions"]) =>
      new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: "11111111111111111111111111111111", instructions: ixs }).compileToV0Message());

    const ok = v0(wallet, [SystemProgram.transfer({ fromPubkey: wallet, toPubkey: Keypair.generate().publicKey, lamports: 1 })]);
    expect(checkSwapTransaction(ok, wallet)).toBeNull();
    expect(checkSwapTransaction(ok, Keypair.generate().publicKey)).toBe("another fee payer");

    const other = Keypair.generate().publicKey;
    const extraSigner = v0(wallet, [SystemProgram.transfer({ fromPubkey: other, toPubkey: wallet, lamports: 1 })]);
    expect(checkSwapTransaction(extraSigner, wallet)).toBe("other signers");

    const stranger = new PublicKey("Stake11111111111111111111111111111111111111");
    const foreign = v0(wallet, [{ programId: stranger, keys: [{ pubkey: wallet, isSigner: true, isWritable: true }], data: Buffer.alloc(0) }]);
    expect(checkSwapTransaction(foreign, wallet)).toBe(`unexpected program ${stranger.toBase58()}`);

    const tokenMove = v0(wallet, [createTransferInstruction(Keypair.generate().publicKey, Keypair.generate().publicKey, wallet, 1, [], TOKEN_PROGRAM_ID)]);
    expect(checkSwapTransaction(tokenMove, wallet)).toBeNull(); // allowed program; the simulation checks what it does
  });
});

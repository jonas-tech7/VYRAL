/**
 * pump.fun launches with a creator-fee split locked at launch.
 *
 * One transaction, signed by the deployer's wallet and by the new mint
 * (VYRAL's server signs for the mint before handing it to the wallet):
 *
 *   1. create_v2                 the coin (Token-2022), creator = deployer
 *   2. create_fee_sharing_config makes the pump fees sharing config the coin's creator
 *   3. update_fee_shares_v2      reward vault X% / deployer (100 - X)%, admin revoked for good
 *   4. buy_exact_quote_in_v3     optional initial buy by the deployer
 *
 * Because the mint signature covers the whole message, the wallet cannot drop
 * or change the split without invalidating the transaction, and once step 3
 * revokes the admin nobody (not the deployer, not VYRAL) can change the split.
 * confirm() still verifies the result on-chain before a competition is created.
 */
import {
  type AddressLookupTableAccount,
  ComputeBudgetProgram,
  type Connection,
  Keypair,
  PublicKey,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import {
  OnlinePumpSdk,
  PUMP_SDK,
  bondingCurvePda,
  feeSharingConfigPda,
  getBuyV3TokenAmountFromQuoteAmount,
  newBondingCurve,
} from "@pump-fun/pump-sdk";
import { ApiError } from "@/lib/api/errors";
import { CREATOR_FEE_SPLIT, type FeeSplit } from "./fee-split";

export type PumpFunLaunchParams = {
  mint: PublicKey;
  deployer: PublicKey;
  /** VYRAL's fee recipients: the competition vault and the platform wallet (treasury + buyback). */
  platform: PlatformRecipients;
  /** Defaults to CREATOR_FEE_SPLIT. */
  split?: FeeSplit;
  name: string;
  symbol: string;
  uri: string;
  initialBuyLamports: number;
  /** Max slippage for the initial buy, in percent. */
  slippagePct?: number;
  /** VYRAL's lookup table holding the fixed pump.fun accounts (keeps the launch in one transaction). */
  lookupTable?: AddressLookupTableAccount | null;
};

/** Limits enforced by the pump program (errors 6043–6045), in bytes. */
export const PUMP_LIMITS = { name: 32, symbol: 13, uri: 200 };
const COMPUTE_UNITS = 600_000;
const PRIORITY_MICRO_LAMPORTS = 50_000;

export type PlatformRecipients = { vault: PublicKey; platform: PublicKey };

/**
 * The locked shareholders: competition vault, deployer, and VYRAL's platform
 * wallet for the treasury and buyback parts. pump.fun rejects duplicate
 * addresses, so parts that go to the same wallet are merged into one entry.
 */
export function shareholders(p: Pick<PumpFunLaunchParams, "deployer" | "platform" | "split">) {
  const split = p.split ?? CREATOR_FEE_SPLIT;
  const parts: Array<[PublicKey, number]> = [
    [p.platform.vault, split.vaultBps],
    [p.deployer, split.deployerBps],
    [p.platform.platform, split.treasuryBps + split.buybackBps],
  ];
  const merged: Array<{ address: PublicKey; shareBps: number }> = [];
  for (const [address, shareBps] of parts) {
    if (shareBps <= 0) continue;
    const existing = merged.find((m) => m.address.equals(address));
    if (existing) existing.shareBps += shareBps;
    else merged.push({ address, shareBps });
  }
  return merged;
}

async function launchInstructions(connection: Connection | null, p: PumpFunLaunchParams) {
  const bytes = (s: string) => Buffer.byteLength(s, "utf8");
  if (bytes(p.name) > PUMP_LIMITS.name || bytes(p.symbol) > PUMP_LIMITS.symbol || bytes(p.uri) > PUMP_LIMITS.uri) {
    throw new ApiError(400, "invalid_request", "Name, ticker or metadata link is too long for pump.fun.");
  }
  const split = p.split ?? CREATOR_FEE_SPLIT;
  if (split.vaultBps + split.deployerBps + split.treasuryBps + split.buybackBps !== 10_000 || split.vaultBps <= 0) throw new Error("Invalid fee split.");
  if (p.platform.vault.equals(p.deployer)) throw new Error("The deployer wallet cannot be the reward vault.");

  const ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICRO_LAMPORTS }),
    await PUMP_SDK.createV2Instruction({
      mint: p.mint,
      name: p.name,
      symbol: p.symbol,
      uri: p.uri,
      creator: p.deployer,
      user: p.deployer,
      mayhemMode: false,
    }),
    await PUMP_SDK.createFeeSharingConfig({ creator: p.deployer, mint: p.mint, pool: null }),
    await PUMP_SDK.updateFeeSharesV2({
      authority: p.deployer,
      mint: p.mint,
      currentShareholders: [p.deployer],
      newShareholders: shareholders(p),
      quoteMint: NATIVE_MINT,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
      // The curve was created a moment ago in this transaction, so it is live: pump-fees ignores the canonical pool
      // account then, and leaving it out saves 33 bytes (keeps the deployer's first buy in the launch transaction).
      bondingCurveComplete: false,
    }),
  ];

  const buy: TransactionInstruction[] = [];
  let expectedTokens: BN | null = null;
  if (p.initialBuyLamports > 0) {
    if (!connection) throw new Error("A connection is needed to price the initial buy.");
    const online = new OnlinePumpSdk(connection);
    const [global, feeConfig] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig()]);
    const curve = newBondingCurve(global);
    const quoteAmount = new BN(p.initialBuyLamports);
    expectedTokens = getBuyV3TokenAmountFromQuoteAmount({
      global,
      feeConfig,
      mintSupply: global.tokenTotalSupply,
      bondingCurve: curve,
      amount: quoteAmount,
      curveBaseTokenBalance: global.tokenTotalSupply,
    });
    buy.push(
      ...(await PUMP_SDK.buyExactQuoteInV3Instructions({
        bondingCurve: curve,
        associatedUserAccountInfo: null,
        mint: p.mint,
        user: p.deployer,
        amount: expectedTokens,
        quoteAmount,
        slippage: p.slippagePct ?? 5,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })),
    );
  }

  return { ixs, buy, expectedTokens };
}

/** Max serialized size of a Solana transaction. */
const TX_LIMIT = 1232;

/**
 * Usually one transaction. If a long name plus the initial buy would exceed
 * the size limit, the buy moves to a second transaction (signed in the same
 * wallet prompt); the coin and its locked fee split always stay together.
 */
export async function buildPumpFunLaunch(connection: Connection, p: PumpFunLaunchParams) {
  const { ixs, buy, expectedTokens } = await launchInstructions(connection, p);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tables = p.lookupTable ? [p.lookupTable] : [];
  const compile = (instructions: TransactionInstruction[]) =>
    new VersionedTransaction(new TransactionMessage({ payerKey: p.deployer, recentBlockhash: blockhash, instructions }).compileToV0Message(tables));
  const fits = (tx: VersionedTransaction) => {
    try {
      return tx.serialize().length <= TX_LIMIT;
    } catch {
      return false;
    }
  };
  const single = compile([...ixs, ...buy]);
  if (fits(single)) return { transactions: [single], lastValidBlockHeight, expectedTokens };
  const launch = compile(ixs);
  if (!fits(launch)) throw new ApiError(400, "invalid_request", "The launch transaction is too large. Use a shorter name.");
  const budget = [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICRO_LAMPORTS })];
  return { transactions: buy.length ? [launch, compile([...budget, ...buy])] : [launch], lastValidBlockHeight, expectedTokens };
}

/**
 * Accounts that are the same in every VYRAL launch (programs, pump globals,
 * event authorities, the reward vault). Derived by building two launches with
 * different coins and deployers and keeping what they share, so the list
 * follows the SDK if pump.fun changes its account layout.
 */
export async function staticLaunchAccounts(connection: Connection | null, platform: PlatformRecipients): Promise<PublicKey[]> {
  const sample = async () =>
    launchInstructions(connection, {
      mint: Keypair.generate().publicKey,
      deployer: Keypair.generate().publicKey,
      platform,
      name: "x",
      symbol: "X",
      uri: "https://x",
      initialBuyLamports: connection ? 10_000_000 : 0,
    });
  const keysOf = (ixs: TransactionInstruction[]) => {
    const set = new Set<string>();
    for (const ix of ixs) {
      set.add(ix.programId.toBase58());
      for (const k of ix.keys) set.add(k.pubkey.toBase58());
    }
    return set;
  };
  const [a, b] = await Promise.all([sample(), sample()]);
  const kb = keysOf([...b.ixs, ...b.buy]);
  const shared = [...keysOf([...a.ixs, ...a.buy])].filter((k) => kb.has(k));
  // Fixed accounts a buy may pick (pump.fun rotates fee recipients) and the token programs.
  const extra = [TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, NATIVE_MINT].map((k) => k.toBase58());
  if (connection) {
    const global = await new OnlinePumpSdk(connection).fetchGlobal();
    for (const k of [global.feeRecipient, ...global.feeRecipients, ...global.buybackFeeRecipients]) extra.push(k.toBase58());
  }
  return [...new Set([...shared, ...extra])].map((k) => new PublicKey(k));
}

export type PumpFunVerification = { ok: true; bondingCurve: string } | { ok: false; error: string };

/**
 * Verifies a confirmed launch on-chain: the coin exists, its creator is the
 * fee sharing config, the admin is revoked and the shareholders are exactly
 * VYRAL's split (CREATOR_FEE_SPLIT) for this deployer.
 */
export async function verifyPumpFunLaunch(
  connection: Connection,
  p: Pick<PumpFunLaunchParams, "mint" | "deployer" | "platform" | "split">,
): Promise<PumpFunVerification> {
  const online = new OnlinePumpSdk(connection);
  const sharing = feeSharingConfigPda(p.mint);
  let curve;
  try {
    curve = await online.fetchBondingCurve(p.mint);
  } catch {
    return { ok: false, error: "The coin was not found on pump.fun (yet)." };
  }
  if (!curve.creator.equals(sharing)) return { ok: false, error: "The coin's creator fees are not routed through the fee split." };
  const info = await connection.getAccountInfo(sharing, "confirmed");
  if (!info) return { ok: false, error: "The fee split account was not found." };
  const config = PUMP_SDK.decodeSharingConfig(info);
  if (!config.adminRevoked) return { ok: false, error: "The fee split can still be changed." };
  const expected = shareholders(p);
  const matches =
    config.shareholders.length === expected.length &&
    expected.every((e) => config.shareholders.some((s) => s.address.equals(e.address) && s.shareBps === e.shareBps));
  if (!matches) return { ok: false, error: "The fee split does not match VYRAL's terms." };
  return { ok: true, bondingCurve: bondingCurvePda(p.mint).toBase58() };
}

export const PUMP_PROGRAM_IDS = { feeSharingConfig: (mint: string) => feeSharingConfigPda(new PublicKey(mint)).toBase58() };

/**
 * Market data providers: token price, on-chain supply and 24h volume.
 *
 *  - mock:    DEVELOPMENT SIMULATION (lib/sim/market-sim.ts).
 *  - jupiter: price from Jupiter Price API v3 (aggregated on-chain liquidity),
 *             supply from the token mint via Solana RPC (authoritative),
 *             24h volume from DexScreener (display only, never used for payouts).
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { env } from "@/lib/env";
import { SIM_TOTAL_SUPPLY, simPrice, simSolUsd, simVolume24h } from "@/lib/sim/market-sim";

export type MarketToken = { id: string; mint: string; launchedAt: Date; totalSupply: number };

export type MarketQuote = {
  priceUsd: number;
  supply: number;
  volume24hUsd: number | null;
  priceChange24hPct: number | null;
  source: string;
  at: Date;
};

export interface MarketDataProvider {
  readonly id: "mock" | "jupiter";
  readonly isSimulated: boolean;
  quotes(tokens: MarketToken[]): Promise<Map<string, MarketQuote>>;
  solUsd(): Promise<number>;
}

const SOL_MINT = "So11111111111111111111111111111111111111112";

class MockMarketProvider implements MarketDataProvider {
  readonly id = "mock" as const;
  readonly isSimulated = true;

  async quotes(tokens: MarketToken[]): Promise<Map<string, MarketQuote>> {
    const now = new Date();
    const out = new Map<string, MarketQuote>();
    for (const t of tokens) {
      const price = simPrice(t.mint, t.launchedAt, now);
      const dayAgo = new Date(Math.max(now.getTime() - 86_400_000, t.launchedAt.getTime()));
      const prev = simPrice(t.mint, t.launchedAt, dayAgo);
      out.set(t.id, {
        priceUsd: price,
        supply: SIM_TOTAL_SUPPLY,
        volume24hUsd: simVolume24h(t.mint, t.launchedAt, now),
        priceChange24hPct: prev > 0 ? ((price - prev) / prev) * 100 : 0,
        source: "simulated",
        at: now,
      });
    }
    return out;
  }

  async solUsd(): Promise<number> {
    return simSolUsd(new Date());
  }
}

class JupiterMarketProvider implements MarketDataProvider {
  readonly id = "jupiter" as const;
  readonly isSimulated = false;
  private connection = new Connection(env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", "finalized");

  private async prices(mints: string[]): Promise<Record<string, { usdPrice?: number; priceChange24h?: number }>> {
    const out: Record<string, { usdPrice?: number; priceChange24h?: number }> = {};
    for (let i = 0; i < mints.length; i += 50) {
      const res = await fetch(`${env.JUPITER_PRICE_API_URL}?ids=${mints.slice(i, i + 50).join(",")}`, {
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Jupiter price API ${res.status}`);
      Object.assign(out, (await res.json()) as Record<string, { usdPrice?: number; priceChange24h?: number }>);
    }
    return out;
  }

  private async volumes(mints: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (let i = 0; i < mints.length; i += 30) {
      try {
        const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mints.slice(i, i + 30).join(",")}`, {
          signal: AbortSignal.timeout(8_000),
          cache: "no-store",
        });
        if (!res.ok) continue;
        const pairs = (await res.json()) as Array<{ baseToken?: { address?: string }; volume?: { h24?: number } }>;
        for (const p of pairs) {
          const mint = p.baseToken?.address;
          if (mint) out.set(mint, (out.get(mint) ?? 0) + (p.volume?.h24 ?? 0));
        }
      } catch {
        // Volume is informational; leave unset on failure.
      }
    }
    return out;
  }

  async quotes(tokens: MarketToken[]): Promise<Map<string, MarketQuote>> {
    const now = new Date();
    const [prices, volumes] = await Promise.all([this.prices(tokens.map((t) => t.mint)), this.volumes(tokens.map((t) => t.mint))]);
    const out = new Map<string, MarketQuote>();
    for (const t of tokens) {
      const p = prices[t.mint];
      if (!p?.usdPrice || !(p.usdPrice > 0)) continue;
      const supply = await this.connection.getTokenSupply(new PublicKey(t.mint)).then(
        (s) => s.value.uiAmount ?? Number(s.value.amount) / 10 ** s.value.decimals,
        () => null,
      );
      if (supply === null) continue;
      out.set(t.id, {
        priceUsd: p.usdPrice,
        supply,
        volume24hUsd: volumes.get(t.mint) ?? null,
        priceChange24hPct: p.priceChange24h ?? null,
        source: "jupiter_price_v3+rpc_supply",
        at: now,
      });
    }
    return out;
  }

  async solUsd(): Promise<number> {
    const p = await this.prices([SOL_MINT]);
    const v = p[SOL_MINT]?.usdPrice;
    if (!v) throw new Error("SOL price unavailable");
    return v;
  }
}

let instance: MarketDataProvider | null = null;
export function marketProvider(): MarketDataProvider {
  if (!instance) instance = env.PRICE_PROVIDER === "jupiter" ? new JupiterMarketProvider() : new MockMarketProvider();
  return instance;
}

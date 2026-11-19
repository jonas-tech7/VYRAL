import { eq, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { marketProvider } from "@/lib/providers/market";
import { simCandle } from "@/lib/sim/market-sim";

const BUCKET_MS = 5 * 60_000;

/** Samples price + supply for live competitions; updates candles and token market fields. */
export async function samplePrices(now = new Date()) {
  const provider = marketProvider();
  const tokens = await db
    .select({ id: schema.tokens.id, mint: schema.tokens.mint, launchedAt: schema.tokens.launchedAt, totalSupply: schema.tokens.totalSupply })
    .from(schema.tokens)
    .innerJoin(schema.competitions, eq(schema.competitions.tokenId, schema.tokens.id))
    .where(inArray(schema.competitions.status, ["active", "paused"]));
  if (tokens.length === 0) return { sampled: 0 };

  const quotes = await provider.quotes(tokens);
  const bucket = new Date(Math.floor(now.getTime() / BUCKET_MS) * BUCKET_MS);
  let sampled = 0;

  for (const t of tokens) {
    const q = quotes.get(t.id);
    if (!q) continue;
    sampled++;
    await db.insert(schema.priceSamples).values({ tokenId: t.id, priceUsd: q.priceUsd, supply: q.supply, source: q.source, sampledAt: q.at });

    if (provider.isSimulated) {
      const c = simCandle(t.mint, t.launchedAt, bucket);
      await db
        .insert(schema.marketCandles)
        .values({ tokenId: t.id, ...c })
        .onConflictDoUpdate({
          target: [schema.marketCandles.tokenId, schema.marketCandles.bucketStart],
          set: { open: c.open, high: c.high, low: c.low, close: c.close, volumeUsd: c.volumeUsd },
        });
    } else {
      await db.execute(sql`
        INSERT INTO market_candles (token_id, bucket_start, open, high, low, close, volume_usd)
        VALUES (${t.id}, ${bucket.toISOString()}, ${q.priceUsd}, ${q.priceUsd}, ${q.priceUsd}, ${q.priceUsd}, 0)
        ON CONFLICT (token_id, bucket_start) DO UPDATE SET
          high = GREATEST(market_candles.high, EXCLUDED.high),
          low = LEAST(market_candles.low, EXCLUDED.low),
          close = EXCLUDED.close
      `);
    }

    await db
      .update(schema.tokens)
      .set({
        priceUsd: q.priceUsd,
        marketCapUsd: q.priceUsd * q.supply,
        totalSupply: q.supply,
        ...(q.volume24hUsd !== null ? { volume24hUsd: q.volume24hUsd } : {}),
        ...(q.priceChange24hPct !== null ? { priceChange24hPct: q.priceChange24hPct } : {}),
        marketDataSource: q.source,
        marketDataUpdatedAt: q.at,
      })
      .where(eq(schema.tokens.id, t.id));
  }
  return { sampled };
}

export async function prunePriceSamples(retentionDays = 14) {
  await db.delete(schema.priceSamples).where(lt(schema.priceSamples.sampledAt, new Date(Date.now() - retentionDays * 86_400_000)));
}

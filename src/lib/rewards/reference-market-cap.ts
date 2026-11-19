/**
 * Reference market cap for a payout checkpoint.
 *
 * Rule (documented in /docs/payouts):
 *   reference market cap = TWAP(price, window) × circulating supply
 *
 *  - TWAP is time-weighted over the window ending at the checkpoint time;
 *    each sample is weighted by how long it remained the latest observation.
 *  - Supply is the most recent on-chain supply observed within the window.
 *  - The checkpoint is skipped (fees roll over) when fewer than
 *    `minSamples` observations exist or the latest one is stale, so a
 *    momentary price spike or a data outage cannot set the payout share.
 */

export type PriceObservation = { priceUsd: number; supply: number; sampledAt: Date };

export type ReferenceMarketCap =
  | {
      ok: true;
      twapPriceUsd: number;
      supply: number;
      marketCapUsd: number;
      sampleCount: number;
      windowStart: Date;
      windowEnd: Date;
    }
  | { ok: false; reason: "insufficient_samples" | "stale_price" | "invalid_supply"; sampleCount: number };

export function computeReferenceMarketCap(
  observations: PriceObservation[],
  at: Date,
  opts: { windowMinutes: number; minSamples: number; maxStalenessMinutes: number },
): ReferenceMarketCap {
  const windowEnd = at;
  const windowStart = new Date(at.getTime() - opts.windowMinutes * 60_000);
  const inWindow = observations
    .filter((o) => o.sampledAt > windowStart && o.sampledAt <= windowEnd && o.priceUsd > 0 && Number.isFinite(o.priceUsd))
    .sort((a, b) => a.sampledAt.getTime() - b.sampledAt.getTime());

  if (inWindow.length < opts.minSamples) {
    return { ok: false, reason: "insufficient_samples", sampleCount: inWindow.length };
  }
  const latest = inWindow[inWindow.length - 1];
  if (windowEnd.getTime() - latest.sampledAt.getTime() > opts.maxStalenessMinutes * 60_000) {
    return { ok: false, reason: "stale_price", sampleCount: inWindow.length };
  }
  if (!(latest.supply > 0)) {
    return { ok: false, reason: "invalid_supply", sampleCount: inWindow.length };
  }

  let weighted = 0;
  let totalMs = 0;
  for (let i = 0; i < inWindow.length; i++) {
    const start = inWindow[i].sampledAt.getTime();
    const end = i + 1 < inWindow.length ? inWindow[i + 1].sampledAt.getTime() : windowEnd.getTime();
    const dt = Math.max(end - start, 0);
    weighted += inWindow[i].priceUsd * dt;
    totalMs += dt;
  }
  const twap = totalMs > 0 ? weighted / totalMs : latest.priceUsd;

  return {
    ok: true,
    twapPriceUsd: twap,
    supply: latest.supply,
    marketCapUsd: twap * latest.supply,
    sampleCount: inWindow.length,
    windowStart,
    windowEnd,
  };
}

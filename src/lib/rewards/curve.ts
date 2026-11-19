/**
 * Market-cap → reward-percentage curve.
 *
 * The curve maps a token's reference market cap to the share (basis points)
 * of newly confirmed creator fees that funds the competition reward at a
 * checkpoint. Outside the defined range the nearest endpoint applies.
 *
 *  - "linear": straight lines between points in USD space
 *  - "log":    straight lines in log10(market cap) space
 *  - "step":   value of the highest point at or below the market cap
 */
import type { RewardCurveConfig } from "@/lib/config/schemas";

export function rewardBpsForMarketCap(curve: RewardCurveConfig, marketCapUsd: number): number {
  const pts = curve.points;
  if (pts.length === 0) return 0;
  const mc = Number.isFinite(marketCapUsd) && marketCapUsd > 0 ? marketCapUsd : 0;

  if (mc <= pts[0].marketCapUsd) return pts[0].rewardBps;
  const last = pts[pts.length - 1];
  if (mc >= last.marketCapUsd) return last.rewardBps;

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (mc < b.marketCapUsd) {
      if (curve.interpolation === "step") return a.rewardBps;
      let t: number;
      if (curve.interpolation === "log") {
        t = (Math.log10(mc) - Math.log10(a.marketCapUsd)) / (Math.log10(b.marketCapUsd) - Math.log10(a.marketCapUsd));
      } else {
        t = (mc - a.marketCapUsd) / (b.marketCapUsd - a.marketCapUsd);
      }
      return Math.round(a.rewardBps + (b.rewardBps - a.rewardBps) * t);
    }
  }
  return last.rewardBps;
}

/** Samples the curve for charting (log-spaced market caps). */
export function sampleCurve(
  curve: RewardCurveConfig,
  minMc: number,
  maxMc: number,
  steps = 80,
): Array<{ marketCapUsd: number; rewardBps: number }> {
  const lo = Math.log10(Math.max(minMc, 1));
  const hi = Math.log10(Math.max(maxMc, minMc * 1.01, 2));
  const out: Array<{ marketCapUsd: number; rewardBps: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const mc = 10 ** (lo + ((hi - lo) * i) / steps);
    out.push({ marketCapUsd: mc, rewardBps: rewardBpsForMarketCap(curve, mc) });
  }
  return out;
}

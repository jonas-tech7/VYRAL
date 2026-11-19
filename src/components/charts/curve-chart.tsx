"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RewardCurveConfig } from "@/lib/config/schemas";
import { bpsToPct, usd } from "@/lib/format";
import { rewardBpsForMarketCap } from "@/lib/rewards/curve";

const PAD = { top: 12, right: 12, bottom: 26, left: 40 };

function niceDecades(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let e = Math.ceil(Math.log10(lo)); e <= Math.floor(Math.log10(hi)); e++) out.push(10 ** e);
  return out;
}

/**
 * Market cap (log x) → reward share (y). Single series: no legend; the
 * heading names it. Hover/focus shows the exact share at any market cap.
 */
export function CurveChart({
  curve,
  currentMarketCap,
  height = 200,
  label = "Reward share by market cap",
}: {
  curve: RewardCurveConfig;
  currentMarketCap?: number | null;
  height?: number;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    const pts = curve.points;
    const first = Math.max(pts[0]?.marketCapUsd ?? 1_000, 1);
    const last = Math.max(pts[pts.length - 1]?.marketCapUsd ?? 1_000_000, first * 2);
    let lo = first / 4;
    let hi = last * 8;
    if (currentMarketCap && currentMarketCap > 0) {
      lo = Math.min(lo, currentMarketCap / 2);
      hi = Math.max(hi, currentMarketCap * 2);
    }
    const maxBps = Math.max(...pts.map((p) => p.rewardBps), 1);
    const yMax = Math.min(10_000, Math.ceil(maxBps / 1_000) * 1_000 + 1_000);
    return { lo, hi, yMax };
  }, [curve, currentMarketCap]);

  const w = Math.max(width, 240);
  const h = height;
  const iw = w - PAD.left - PAD.right;
  const ih = h - PAD.top - PAD.bottom;
  const x = (mc: number) => PAD.left + ((Math.log10(mc) - Math.log10(geo.lo)) / (Math.log10(geo.hi) - Math.log10(geo.lo))) * iw;
  const xInv = (px: number) => 10 ** (Math.log10(geo.lo) + ((px - PAD.left) / iw) * (Math.log10(geo.hi) - Math.log10(geo.lo)));
  const y = (bps: number) => PAD.top + ih - (bps / geo.yMax) * ih;

  const samples = useMemo(() => {
    const out: Array<[number, number]> = [];
    const n = 160;
    for (let i = 0; i <= n; i++) {
      const mc = 10 ** (Math.log10(geo.lo) + (i / n) * (Math.log10(geo.hi) - Math.log10(geo.lo)));
      out.push([mc, rewardBpsForMarketCap(curve, mc)]);
    }
    return out;
  }, [curve, geo]);

  const line = samples.map(([mc, b], i) => `${i ? "L" : "M"}${x(mc).toFixed(1)},${y(b).toFixed(1)}`).join("");
  const area = `${line}L${x(geo.hi).toFixed(1)},${y(0)}L${x(geo.lo).toFixed(1)},${y(0)}Z`;
  const yTicks = Array.from({ length: geo.yMax / 2_500 + 1 }, (_, i) => i * 2_500).filter((t) => t <= geo.yMax);
  const xTicks = niceDecades(geo.lo, geo.hi);
  const hoverBps = hover !== null ? rewardBpsForMarketCap(curve, hover) : null;
  const current = currentMarketCap && currentMarketCap > 0 ? { mc: currentMarketCap, bps: rewardBpsForMarketCap(curve, currentMarketCap) } : null;

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height: h }}>
      {width > 0 ? (
        <svg
          width={w}
          height={h}
          role="img"
          aria-label={`${label}. ${curve.points.map((p) => `${usd(p.marketCapUsd, { compact: true })}: ${bpsToPct(p.rewardBps)}`).join(", ")}`}
          tabIndex={0}
          className="outline-none focus-visible:outline-2 focus-visible:outline-accent"
          onPointerMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = Math.min(Math.max(e.clientX - r.left, PAD.left), PAD.left + iw);
            setHover(xInv(px));
          }}
          onPointerLeave={() => setHover(null)}
          onFocus={() => current && setHover(current.mc)}
          onBlur={() => setHover(null)}
        >
          {yTicks.map((t) => (
            <g key={`y${t}`}>
              <line x1={PAD.left} x2={PAD.left + iw} y1={y(t)} y2={y(t)} stroke="#1c1c21" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={PAD.left - 8} y={y(t) + 3.5} textAnchor="end" fontSize={11} fill="#71717a" className="num">
                {bpsToPct(t, 0)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={`x${t}`} x={x(t)} y={h - 8} textAnchor="middle" fontSize={11} fill="#71717a">
              {usd(t, { compact: true })}
            </text>
          ))}
          <path d={area} fill="#2cf59e" fillOpacity={0.08} />
          <path d={line} fill="none" stroke="#2cf59e" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {current ? (
            <g>
              <line x1={x(current.mc)} x2={x(current.mc)} y1={PAD.top} y2={PAD.top + ih} stroke="#2a2a31" strokeWidth={1} shapeRendering="crispEdges" />
              <circle cx={x(current.mc)} cy={y(current.bps)} r={4} fill="#2cf59e" stroke="#0b0b0d" strokeWidth={2} />
              <text
                x={Math.min(x(current.mc) + 8, PAD.left + iw - 4)}
                y={PAD.top + 10}
                textAnchor={x(current.mc) + 90 > PAD.left + iw ? "end" : "start"}
                fontSize={11}
                fill="#a1a1aa"
              >
                Now · {bpsToPct(current.bps)}
              </text>
            </g>
          ) : null}
          {hover !== null && hoverBps !== null ? (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ih} stroke="#71717a" strokeWidth={1} shapeRendering="crispEdges" />
              <circle cx={x(hover)} cy={y(hoverBps)} r={4} fill="#2cf59e" stroke="#0b0b0d" strokeWidth={2} />
            </g>
          ) : null}
        </svg>
      ) : null}
      {hover !== null && hoverBps !== null && width > 0 ? (
        <div
          className="pointer-events-none absolute top-1 rounded-md border border-edge-strong bg-overlay px-2.5 py-1.5 text-[12px] shadow-[0_8px_20px_rgba(0,0,0,0.45)]"
          style={{ left: Math.min(Math.max(x(hover) - 60, 0), w - 128) }}
        >
          <span className="num font-semibold text-ink">{bpsToPct(hoverBps)}</span>
          <span className="ml-1.5 text-ink-3">at {usd(hover, { compact: true })}</span>
        </div>
      ) : null}
    </div>
  );
}

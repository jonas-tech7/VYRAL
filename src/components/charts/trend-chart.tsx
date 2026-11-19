"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn, compactNumber, dateUtc, sol } from "@/lib/format";

type Point = { day: string; rewards: number; views: number };
type Metric = "rewards" | "views";

const PAD = { top: 16, right: 16, bottom: 26, left: 56 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

/**
 * Cumulative creator performance. One metric at a time (toggle) — two
 * measures of different scale never share a plot.
 */
export function TrendChart({ points }: { points: Point[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [metric, setMetric] = useState<Metric>("rewards");
  const [hover, setHover] = useState<number | null>(null);
  const h = 220;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const values = points.map((p) => (metric === "rewards" ? p.rewards : p.views));
  const max = niceMax(Math.max(...values, 0));
  const w = Math.max(width, 280);
  const iw = w - PAD.left - PAD.right;
  const ih = h - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length <= 1 ? 0 : (i / (points.length - 1)) * iw);
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  const fmt = (v: number) => (metric === "rewards" ? sol(v) : compactNumber(v));

  const path = useMemo(() => values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(""), [values, w, max]); // eslint-disable-line react-hooks/exhaustive-deps
  const area = `${path}L${x(values.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const lastIdx = values.length - 1;
  const hi = hover ?? lastIdx;

  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div aria-live="polite">
          <p className="text-[12px] text-ink-3">
            {metric === "rewards" ? "Cumulative rewards" : "Cumulative verified views"} · {points[hi] ? dateUtc(new Date(points[hi].day)) : ""}
          </p>
          <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-ink">{points[hi] ? fmt(values[hi]) : "—"}</p>
        </div>
        <div role="radiogroup" aria-label="Metric" className="inline-flex items-center gap-0.5 rounded-md border border-edge p-0.5">
          {(["rewards", "views"] as Metric[]).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={m === metric}
              onClick={() => setMetric(m)}
              className={cn("inline-flex h-7 items-center rounded-[5px] px-2.5 text-[12px] transition-colors", m === metric ? "bg-overlay-2 text-ink" : "text-ink-3 hover:text-ink")}
            >
              {m === "rewards" ? "Rewards" : "Views"}
            </button>
          ))}
        </div>
      </div>
      <div ref={ref} className="relative w-full" style={{ height: h }}>
        {width > 0 && points.length > 0 ? (
          <svg
            width={w}
            height={h}
            role="img"
            aria-label={`${metric === "rewards" ? "Cumulative rewards" : "Cumulative verified views"} over the last ${points.length} days, ending at ${fmt(values[lastIdx])}`}
            onPointerMove={(e) => {
              const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const px = e.clientX - r.left - PAD.left;
              setHover(Math.max(0, Math.min(lastIdx, Math.round((px / iw) * lastIdx))));
            }}
            onPointerLeave={() => setHover(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={PAD.left + iw} y1={y(t)} y2={y(t)} stroke="#1c1c21" strokeWidth={1} shapeRendering="crispEdges" />
                <text x={PAD.left - 8} y={y(t) + 3.5} textAnchor="end" fontSize={11} fill="#71717a">
                  {metric === "rewards" ? (t / 1e9).toLocaleString("en-US", { maximumFractionDigits: t / 1e9 < 10 ? 2 : 0 }) : compactNumber(t)}
                </text>
              </g>
            ))}
            {[0, Math.floor(lastIdx / 2), lastIdx].map((i) => (
              <text key={i} x={x(i)} y={h - 8} textAnchor={i === 0 ? "start" : i === lastIdx ? "end" : "middle"} fontSize={11} fill="#71717a">
                {points[i] ? dateUtc(new Date(points[i].day)).replace(/, \d{4}$/, "") : ""}
              </text>
            ))}
            <path d={area} fill="#2cf59e" fillOpacity={0.08} />
            <path d={path} fill="none" stroke="#2cf59e" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ih} stroke="#52525b" strokeWidth={1} shapeRendering="crispEdges" /> : null}
            <circle cx={x(hi)} cy={y(values[hi] ?? 0)} r={4} fill="#2cf59e" stroke="#050506" strokeWidth={2} />
          </svg>
        ) : null}
      </div>
    </div>
  );
}

import type { CSSProperties } from "react";
import { LogoMark } from "@/components/brand/logo";
import { cn } from "@/lib/format";

/**
 * The attention loop: a signal travels clockwise around the ring and lights
 * each station as it passes. Stations sit on the diagonals so their labels
 * fit in the corners of the square. Pure SVG + CSS (.flywheel-* in
 * globals.css); reduced-motion users see the static diagram.
 */
const SIZE = 440;
const C = SIZE / 2;
const R = 140;
const START = -135; // first station, top-left

const STATIONS = [
  { label: "A coin launches", sub: "Its competition opens", corner: "left-0 top-0 text-left" },
  { label: "Creators post it", sub: "With the contract address", corner: "right-0 top-0 text-right" },
  { label: "Attention builds", sub: "Views bring trading", corner: "bottom-0 right-0 text-right" },
  { label: "Fees pay creators", sub: "Every 3 or 6 hours", corner: "bottom-0 left-0 text-left" },
] as const;

const at = (deg: number, r = R) => [C + r * Math.cos((deg * Math.PI) / 180), C + r * Math.sin((deg * Math.PI) / 180)] as const;

export function Flywheel({ className }: { className?: string }) {
  const [sx, sy] = at(START);
  return (
    <div className={cn("relative mx-auto aspect-square w-full max-w-[440px]", className)}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-full" aria-hidden>
        <circle cx={C} cy={C} r={R} fill="none" stroke="var(--color-edge-strong)" strokeWidth="1" />
        <circle cx={C} cy={C} r={R - 32} fill="none" stroke="var(--color-edge)" strokeWidth="1" strokeDasharray="2 6" />
        {/* Direction ticks between stations (clockwise) */}
        {[-90, 0, 90, 180].map((a) => {
          const [x, y] = at(a);
          return <path key={a} d="M-4 -5 L3 0 L-4 5" transform={`translate(${x} ${y}) rotate(${a + 90})`} fill="none" stroke="var(--color-ink-4)" strokeWidth="1.5" />;
        })}
        {/* Travelling signal, starting at the first station */}
        <g className="flywheel-orbit">
          <circle cx={sx} cy={sy} r="9" fill="var(--color-accent)" opacity="0.18" />
          <circle cx={sx} cy={sy} r="4.5" fill="var(--color-accent)" />
        </g>
        {STATIONS.map((s, i) => {
          const [x, y] = at(START + i * 90);
          return (
            <g key={s.label}>
              <circle cx={x} cy={y} r="7" fill="var(--color-canvas)" stroke="var(--color-edge-strong)" strokeWidth="1.5" />
              <circle cx={x} cy={y} r="3.5" className="flywheel-station" style={{ "--i": i } as CSSProperties} />
            </g>
          );
        })}
      </svg>
      {STATIONS.map((s, i) => (
        <div key={s.label} className={cn("absolute max-w-[42%]", s.corner)}>
          <p className="font-mono text-[11px] text-ink-4">{String(i + 1).padStart(2, "0")}</p>
          <p className="mt-0.5 text-[13px] font-medium leading-snug text-ink sm:text-[14px]">{s.label}</p>
          <p className="text-[11.5px] leading-snug text-ink-3 sm:text-[12px]">{s.sub}</p>
        </div>
      ))}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex size-[28%] items-center justify-center rounded-full border border-edge bg-raised text-ink">
          <LogoMark size={32} />
        </div>
      </div>
    </div>
  );
}

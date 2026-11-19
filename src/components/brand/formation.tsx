import type { CSSProperties } from "react";
import { cn } from "@/lib/format";
import { SYMBOL_HEIGHT, SYMBOL_UNITS, SYMBOL_WIDTH, unitPath } from "./logo";

/**
 * Large brand visual for the home page: the symbol drawn on its own
 * construction lattice. The lines draw in, the units arrive tip-first, and a
 * signal periodically travels from the tip outwards. Pure SVG + CSS
 * (see .formation-* in globals.css); motion is disabled for reduced-motion users.
 */
const VIEW = 480;
const SCALE = 250 / SYMBOL_HEIGHT;
const OX = (VIEW - SYMBOL_WIDTH * SCALE) / 2;
const OY = (VIEW - SYMBOL_HEIGHT * SCALE) / 2 + VIEW * 0.012;
const r = (n: number) => Math.round(n * 100) / 100;

const UNITS = SYMBOL_UNITS.map((u) => u.map(([x, y]) => [r(OX + x * SCALE), r(OY + y * SCALE)] as const));
/** Formation rank of each unit: tip 0, inner pair 1, outer pair 2. */
const RANK = [0, 1, 1, 2, 2];

/** Every edge lies on one of the lattice lines; collect each line once. */
const LINES = (() => {
  const seen = new Map<string, { x1: number; y1: number; x2: number; y2: number; offset: number }>();
  for (const unit of UNITS) {
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = unit[i];
      const [bx, by] = unit[(i + 1) % 4];
      let dx = bx - ax;
      let dy = by - ay;
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;
      if (dx < 0) {
        dx = -dx;
        dy = -dy;
      }
      const offset = ax * dy - ay * dx;
      const key = `${dy > 0 ? "a" : "b"}:${Math.round(offset)}`;
      if (!seen.has(key)) seen.set(key, { x1: r(ax - dx * 900), y1: r(ay - dy * 900), x2: r(ax + dx * 900), y2: r(ay + dy * 900), offset });
    }
  }
  return [...seen.values()].sort((a, b) => a.offset - b.offset);
})();

export function FormationVisual({ className }: { className?: string }) {
  return (
    <div className={cn("relative aspect-square w-full", className)} aria-hidden>
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="size-full overflow-visible">
        <defs>
          <radialGradient id="vyral-formation-fade" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#fff" />
            <stop offset="0.62" stopColor="#fff" stopOpacity="0.5" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <mask id="vyral-formation-mask">
            <rect width={VIEW} height={VIEW} fill="url(#vyral-formation-fade)" />
          </mask>
        </defs>
        <g mask="url(#vyral-formation-mask)" stroke="var(--color-edge-strong)" strokeWidth="1" fill="none">
          {LINES.map(({ x1, y1, x2, y2 }, i) => (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              pathLength={1}
              vectorEffect="non-scaling-stroke"
              className="formation-line"
              style={{ "--i": i } as CSSProperties}
            />
          ))}
        </g>
        {UNITS.map((unit, i) => (
          <path
            key={i}
            d={unitPath(unit)}
            className="formation-unit"
            style={{ "--i": RANK[i] } as CSSProperties}
          />
        ))}
      </svg>
    </div>
  );
}

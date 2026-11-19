import { cn } from "@/lib/format";

/**
 * VYRAL symbol: five identical rhombi in a V formation. Every edge runs
 * parallel to one of the two arms (32° from vertical), so the mark is a single
 * geometric system. Master files live in /public/brand.
 */
export const SYMBOL_WIDTH = 356.11;
export const SYMBOL_HEIGHT = 369.75;
/** Units in formation order: tip, inner pair, outer pair. Each is [top, right, bottom, left]. */
export const SYMBOL_UNITS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[178.05, 200.14], [231.04, 284.94], [178.05, 369.75], [125.06, 284.94]],
  [[115.52, 100.07], [168.51, 184.87], [115.52, 269.68], [62.53, 184.87]],
  [[240.58, 100.07], [293.58, 184.87], [240.58, 269.68], [187.59, 184.87]],
  [[52.99, 0], [105.98, 84.8], [52.99, 169.61], [0, 84.8]],
  [[303.11, 0], [356.11, 84.8], [303.11, 169.61], [250.12, 84.8]],
];
export const unitPath = (unit: ReadonlyArray<readonly [number, number]>) => `M${unit.map(([x, y]) => `${x} ${y}`).join(" L")}Z`;
const SYMBOL_PATH = SYMBOL_UNITS.map(unitPath).join(" ");

export function LogoMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={(size * SYMBOL_WIDTH) / SYMBOL_HEIGHT}
      height={size}
      viewBox={`0 0 ${SYMBOL_WIDTH} ${SYMBOL_HEIGHT}`}
      fill="currentColor"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <path d={SYMBOL_PATH} />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-ink", className)}>
      <LogoMark size={19} />
      <span className="text-[15px] font-semibold tracking-[0.16em]">VYRAL</span>
    </span>
  );
}

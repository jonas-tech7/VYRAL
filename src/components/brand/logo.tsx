import { cn } from "@/lib/format";

/**
 * VYRAL symbol: five identical rhombi in a V formation. Every edge runs
 * parallel to one of the two arms (32° from vertical), so the mark is a single
 * geometric system. Master files live in /public/brand.
 */
const SYMBOL_WIDTH = 356.11;
const SYMBOL_HEIGHT = 369.75;
const SYMBOL_PATH =
  "M178.05 200.14 L231.04 284.94 L178.05 369.75 L125.06 284.94Z M115.52 100.07 L168.51 184.87 L115.52 269.68 L62.53 184.87Z M240.58 100.07 L293.58 184.87 L240.58 269.68 L187.59 184.87Z M52.99 0 L105.98 84.8 L52.99 169.61 L0 84.8Z M303.11 0 L356.11 84.8 L303.11 169.61 L250.12 84.8Z";

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

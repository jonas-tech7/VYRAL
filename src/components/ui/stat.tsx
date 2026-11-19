import type { ReactNode } from "react";
import { cn } from "@/lib/format";

/**
 * KPI row: one hairline-bordered strip divided into cells (not separate
 * cards). Values use proportional figures at display size.
 */
export function StatGrid({ children, className, cols = 4 }: { children: ReactNode; className?: string; cols?: 2 | 3 | 4 | 5 }) {
  const colClass = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4", 5: "sm:grid-cols-3 lg:grid-cols-5" }[cols];
  return (
    <dl
      className={cn(
        "grid grid-cols-2 overflow-hidden rounded-lg border border-edge [&>div]:border-edge",
        "gap-px bg-edge",
        colClass,
        className,
      )}
    >
      {children}
    </dl>
  );
}

export function Stat({
  label,
  value,
  sub,
  className,
  size = "md",
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
  size?: "md" | "lg";
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 bg-canvas px-4 py-4 sm:px-5", size === "lg" && "sm:py-5", className)}>
      <dt className="truncate text-[12.5px] text-ink-3">{label}</dt>
      <dd
        className={cn(
          "truncate font-semibold tracking-[-0.02em] text-ink",
          size === "lg" ? "text-[22px] sm:text-[26px]" : "text-[18px] sm:text-[20px]",
        )}
      >
        {value}
      </dd>
      {sub ? <dd className="truncate text-[12px] text-ink-3">{sub}</dd> : null}
    </div>
  );
}

export function Delta({ value, className }: { value: number; className?: string }) {
  const tone = value > 0 ? "text-positive" : value < 0 ? "text-negative" : "text-ink-3";
  const s = Math.abs(value).toFixed(1);
  return <span className={cn("num", tone, className)}>{Number(s) === 0 ? "0.0%" : `${value > 0 ? "+" : "−"}${s}%`}</span>;
}

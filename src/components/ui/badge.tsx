import type { ReactNode } from "react";
import { cn } from "@/lib/format";

export type Tone = "neutral" | "positive" | "warning" | "negative" | "accent";

const tones: Record<Tone, { text: string; dot: string }> = {
  neutral: { text: "text-ink-2", dot: "bg-ink-4" },
  positive: { text: "text-ink", dot: "bg-positive" },
  warning: { text: "text-ink", dot: "bg-warning" },
  negative: { text: "text-ink", dot: "bg-negative" },
  accent: { text: "text-ink", dot: "bg-accent" },
};

/** Status label with a leading dot. Colour is never the only signal: the label always names the state. */
export function StatusBadge({ tone = "neutral", children, pulse, className }: { tone?: Tone; children: ReactNode; pulse?: boolean; className?: string }) {
  const t = tones[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px]", t.text, className)}>
      <span className={cn("size-1.5 shrink-0 rounded-full", t.dot, pulse && "animate-pulse-soft")} aria-hidden />
      {children}
    </span>
  );
}

/** Small bordered tag for categorical metadata (platforms, roles). */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center whitespace-nowrap rounded-sm border border-edge px-1.5 text-[11px] font-medium leading-none text-ink-2",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function DemoTag({ className, label = "Demo" }: { className?: string; label?: string }) {
  return (
    <span
      className={cn("inline-flex h-[18px] items-center rounded-sm bg-overlay-2 px-1.5 text-[10.5px] font-medium uppercase tracking-wider text-ink-3", className)}
      title="Demonstration data — not connected to live services"
    >
      {label}
    </span>
  );
}

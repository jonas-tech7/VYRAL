import { bpsToPct, cn } from "@/lib/format";
import { CREATOR_FEE_SPLIT, FEE_SPLIT_PARTS } from "@/lib/launch/fee-split";

const DOT: Record<(typeof FEE_SPLIT_PARTS)[number]["tone"], string> = {
  accent: "bg-accent",
  ink: "bg-ink-2",
  silver: "bg-ink-3",
  muted: "bg-ink-4",
};

const DESCRIPTION: Record<(typeof FEE_SPLIT_PARTS)[number]["key"], string> = {
  vaultBps: "Into the reward vault; the top eligible video is paid at every checkpoint",
  deployerBps: "Paid to the deployer's wallet by pump.fun",
  buybackBps: "Buys $VYRAL on the open market and burns it",
  treasuryBps: "Operations, hosting and development",
};

/** The locked creator-fee split as one bar. */
export function FeeSplitBar({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-2.5 gap-px overflow-hidden rounded-full bg-overlay-2", className)} aria-hidden>
      {FEE_SPLIT_PARTS.map((p) => (
        <div key={p.key} className={cn("h-full", DOT[p.tone])} style={{ width: `${CREATOR_FEE_SPLIT[p.key] / 100}%` }} />
      ))}
    </div>
  );
}

/** Legend rows: dot, label, share; optionally a one-line description. "you" names the deployer row for the deployer. */
export function FeeSplitLegend({ described = false, you = false, className }: { described?: boolean; you?: boolean; className?: string }) {
  return (
    <dl className={cn("divide-y divide-edge text-[12.5px]", className)}>
      {FEE_SPLIT_PARTS.map((p) => (
        <div key={p.key} className="flex items-start justify-between gap-4 py-1.5">
          <dt className="min-w-0">
            <span className="flex items-center gap-2 text-ink-2">
              <span className={cn("size-2 shrink-0 rounded-full", DOT[p.tone])} aria-hidden />
              {p.key === "deployerBps" && you ? "You, the deployer" : p.label}
            </span>
            {described ? <span className="mt-0.5 block pl-4 text-[11.5px] leading-snug text-ink-4">{DESCRIPTION[p.key]}</span> : null}
          </dt>
          <dd className="num shrink-0 text-ink">{bpsToPct(CREATOR_FEE_SPLIT[p.key])}</dd>
        </div>
      ))}
    </dl>
  );
}

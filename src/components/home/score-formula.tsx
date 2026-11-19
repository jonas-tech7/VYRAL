import type { ReactNode } from "react";
import type { ScoringConfig } from "@/lib/config/schemas";
import { compactNumber, cn } from "@/lib/format";
import { SCORE_MODEL } from "@/lib/scoring/viral-score";

/** A variable of the headline formula, with its meaning set underneath. */
function Term({ sym, label, accent }: { sym: string; label: string; accent?: boolean }) {
  return (
    <span className="relative inline-block">
      <span className={accent ? "text-accent" : "text-ink"}>{sym}</span>
      <span className="absolute left-1/2 top-full mt-2.5 -translate-x-1/2 whitespace-nowrap font-sans text-[11px] font-normal tracking-normal text-ink-3 sm:mt-3 sm:text-[12px]">
        {label}
      </span>
    </span>
  );
}
const Op = ({ children }: { children: ReactNode }) => <span className="text-ink-4">{children}</span>;
const Weight = ({ children }: { children: ReactNode }) => <span className="text-ink-2">{children}</span>;

function Fraction({ top, bottom }: { top: ReactNode; bottom: ReactNode }) {
  return (
    <span className="inline-flex flex-col items-center align-middle">
      <span className="px-1.5 pb-1.5">{top}</span>
      <span className="h-px w-full bg-ink-3" aria-hidden />
      <span className="px-1.5 pt-1.5">{bottom}</span>
    </span>
  );
}

/** The Viral Score formula, rendered from a scoring configuration (weights, ceilings, caps). */
export function ScoreFormula({ config: c, version }: { config: ScoringConfig; version: number }) {
  const w = (n: number) => (n / 100).toFixed(2);
  const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
  const parts = [
    {
      sym: "V",
      name: "Views",
      weight: c.weights.views,
      lines: [`${compactNumber(c.referenceCeilings.views)} views = 100 points`, "Reach counts the most"],
    },
    {
      sym: "L",
      name: "Likes",
      weight: c.weights.likes,
      lines: [`${compactNumber(c.referenceCeilings.likes)} likes = 100 points`, `Counts up to ${pct(c.engagementCaps.likesPerView)} of views`],
    },
    {
      sym: "C",
      name: "Comments",
      weight: c.weights.comments,
      lines: [`${compactNumber(c.referenceCeilings.comments)} comments = 100 points`, `Counts up to ${pct(c.engagementCaps.commentsPerView)} of views`],
    },
  ];

  return (
    <div className="relative overflow-hidden rounded-lg border border-edge bg-raised text-center">
      <div className="flex items-center justify-between border-b border-edge px-4 py-2.5 font-mono text-[11px] text-ink-4">
        <span>model {SCORE_MODEL}</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-accent" aria-hidden />
          live config v{version}
        </span>
      </div>
      <p
        className="whitespace-nowrap px-2 pb-14 pt-12 font-mono text-[19px] font-medium leading-none tracking-[-0.04em] sm:pb-16 sm:pt-16 sm:text-[34px] lg:text-[40px]"
        aria-label={`Score equals ${w(c.weights.views)} times views plus ${w(c.weights.likes)} times likes plus ${w(c.weights.comments)} times comments`}
      >
        <Term sym="S" label="score" accent /> <Op>=</Op> <Weight>{w(c.weights.views)}</Weight>
        <Op>·</Op>
        <Term sym="V" label="views" /> <Op>+</Op> <Weight>{w(c.weights.likes)}</Weight>
        <Op>·</Op>
        <Term sym="L" label="likes" /> <Op>+</Op> <Weight>{w(c.weights.comments)}</Weight>
        <Op>·</Op>
        <Term sym="C" label="comments" />
      </p>
      <div className="grid gap-px border-t border-edge bg-edge sm:grid-cols-3">
        {parts.map((p, i) => (
          <div key={p.sym} className="bg-raised px-5 py-5 text-left">
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] text-ink">
                <span className={cn("mr-2 font-mono", i === 0 ? "text-accent" : "text-ink-3")}>{p.sym}</span>
                {p.name}
              </span>
              <span className="num font-mono text-[13px] text-ink-2">{p.weight}%</span>
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-overlay-2" aria-hidden>
              <div className={cn("h-full rounded-full", i === 0 ? "bg-accent" : "bg-ink-3")} style={{ width: `${p.weight}%` }} />
            </div>
            {p.lines.map((l) => (
              <p key={l} className="mt-2.5 text-[12.5px] leading-snug text-ink-3 first-of-type:mt-3">
                {l}
              </p>
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-col items-center gap-3 border-t border-edge px-4 py-7 sm:py-8">
        <p className="font-mono text-[13px] text-ink-2 sm:text-[17px]">
          <span className="text-ink">X</span> <Op>=</Op> 100 <Op>·</Op>{" "}
          <Fraction
            top={
              <>
                log<sub className="text-[0.7em]">10</sub>(1 + x · m<sub className="text-[0.7em]">platform</sub>)
              </>
            }
            bottom={
              <>
                log<sub className="text-[0.7em]">10</sub>(1 + x<sub className="text-[0.7em]">ref</sub>)
              </>
            }
          />
        </p>
        <p className="max-w-[540px] text-[12.5px] leading-relaxed text-ink-3">
          Each metric is first multiplied by its platform multiplier, then scored on a log scale against its reference value. Going from 10K to
          100K views is worth as much as going from 100K to 1M.
        </p>
      </div>
    </div>
  );
}

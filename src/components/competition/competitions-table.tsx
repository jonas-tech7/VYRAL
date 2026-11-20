import { Countdown } from "@/components/ui/client";
import { DemoTag } from "@/components/ui/badge";
import { EmptyRow, RowLink, Table, TD, TH, THead, TR } from "@/components/ui/table";
import type { CompetitionListItem } from "@/lib/queries/public";
import { age, compactNumber, score, sol, usd } from "@/lib/format";
import { CompetitionStatus } from "./status";
import { TokenCell } from "./token-cell";

type Variant = "home" | "full";

/** Competition list shared by the homepage (trending) and /competitions. */
export function CompetitionsTable({ items, variant = "full", now }: { items: CompetitionListItem[]; variant?: Variant; now: Date }) {
  const cols = variant === "home" ? 7 : 8;
  return (
    <Table minWidth={variant === "home" ? 860 : 960}>
      <THead>
        <TH className="w-[28%]">Token</TH>
        <TH align="right">Market cap</TH>
        {variant === "home" ? <TH align="right">24h volume</TH> : null}
        <TH align="right">Video views</TH>
        {variant === "full" ? <TH align="right">Creators</TH> : null}
        <TH align="right" title="Estimated reward at the next checkpoint: the coin's unallocated confirmed vault fees">
          Reward pool
        </TH>
        <TH align="right">Top Viral Score</TH>
        {variant === "full" ? <TH align="right">Next payout</TH> : null}
        <TH align="right">Status</TH>
      </THead>
      <tbody>
        {items.length === 0 ? <EmptyRow colSpan={cols}>No competitions match these filters.</EmptyRow> : null}
        {items.map((c) => (
          <TR key={c.competitionId} interactive>
            <TD>
              <RowLink href={`/competitions/${c.mint}`} label={`${c.name} competition`}>
                <TokenCell
                  name={c.name}
                  symbol={c.symbol}
                  imageUrl={c.imageUrl}
                  sub={
                    <span className="flex items-center gap-1.5">
                      <span>Launched {age(c.launchedAt, now)} ago</span>
                      {c.isSimulated && variant === "full" ? <DemoTag className="hidden lg:inline-flex" /> : null}
                    </span>
                  }
                />
              </RowLink>
            </TD>
            <TD align="right" numeric className="text-ink">
              {usd(c.marketCapUsd, { compact: true })}
            </TD>
            {variant === "home" ? (
              <TD align="right" numeric className="text-ink-2">
                {usd(c.volume24hUsd, { compact: true })}
              </TD>
            ) : null}
            <TD align="right" numeric className="text-ink-2">
              {compactNumber(c.totalViews)}
            </TD>
            {variant === "full" ? (
              <TD align="right" numeric className="text-ink-2">
                {c.creatorCount}
              </TD>
            ) : null}
            <TD align="right" numeric className="text-ink">
              {sol(c.estimatedRewardLamports)}
            </TD>
            <TD align="right" numeric className="text-ink">
              {score(c.topScore)}
            </TD>
            {variant === "full" ? (
              <TD align="right" className="text-ink-2">
                {c.status === "active" ? <Countdown to={c.nextCheckpointAt.toISOString()} /> : <span className="text-ink-4">—</span>}
              </TD>
            ) : null}
            <TD align="right">
              <CompetitionStatus status={c.status} />
            </TD>
          </TR>
        ))}
      </tbody>
    </Table>
  );
}

import { connection } from "next/server";
import type { Metadata } from "next";
import { Suspense } from "react";
import { TableSkeleton } from "@/components/competition/skeletons";
import { Container, PageHeader, Skeleton } from "@/components/ui/misc";
import { SegmentedLinks } from "@/components/ui/segmented";
import { EmptyRow, RowLink, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { WalletAvatar } from "@/components/ui/token-avatar";
import { PLATFORM_SHORT } from "@/lib/domain/platforms";
import { compactNumber, score, shortAddress, sol } from "@/lib/format";
import { CREATOR_RANGES, CREATOR_SORTS, listCreators, type CreatorRange, type CreatorSort } from "@/lib/queries/public";

export const metadata: Metadata = {
  title: "Creators",
  description: "The VYRAL creator leaderboard: rewards earned, verified views and winning submissions across every competition.",
};

const SORT_LABEL: Record<CreatorSort, string> = { rewards: "Rewards earned", views: "Verified views", wins: "Wins", score: "Best Viral Score" };
const RANGE_LABEL: Record<CreatorRange, string> = { all: "All time", "30d": "30 days", "7d": "7 days" };

export default function CreatorsPage(props: PageProps<"/creators">) {
  return (
    <Container>
      <PageHeader
        title="Creators"
        description="Reputation on VYRAL is portable: every wallet builds a public record of verified views, wins and rewards across all competitions."
      />
      <Suspense
        fallback={
          <>
            <Skeleton className="mb-6 h-9 w-full max-w-[640px]" />
            <TableSkeleton rows={12} />
          </>
        }
      >
        <Leaderboard searchParams={props.searchParams} />
      </Suspense>
    </Container>
  );
}

async function Leaderboard({ searchParams }: Pick<PageProps<"/creators">, "searchParams">) {
  await connection();
  const sp = await searchParams;
  const sort = (CREATOR_SORTS as readonly string[]).includes(String(sp.sort)) ? (sp.sort as CreatorSort) : "rewards";
  const range = (CREATOR_RANGES as readonly string[]).includes(String(sp.range)) ? (sp.range as CreatorRange) : "all";
  const rows = await listCreators({ sort, range, limit: 100 });
  const href = (next: { sort?: CreatorSort; range?: CreatorRange }) => {
    const p = new URLSearchParams();
    const s = next.sort ?? sort;
    const r = next.range ?? range;
    if (s !== "rewards") p.set("sort", s);
    if (r !== "all") p.set("range", r);
    const str = p.toString();
    return `/creators${str ? `?${str}` : ""}`;
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <SegmentedLinks ariaLabel="Rank creators by" items={CREATOR_SORTS.map((s) => ({ label: SORT_LABEL[s], href: href({ sort: s }), active: s === sort }))} />
        <SegmentedLinks ariaLabel="Time range" items={CREATOR_RANGES.map((r) => ({ label: RANGE_LABEL[r], href: href({ range: r }), active: r === range }))} />
      </div>
      <Table minWidth={920}>
        <THead>
          <TH className="w-10">#</TH>
          <TH>Creator</TH>
          <TH align="right">Rewards earned</TH>
          <TH align="right">Verified views</TH>
          <TH align="right">Videos</TH>
          <TH align="right">Wins</TH>
          <TH align="right">Competitions</TH>
          <TH align="right">Best Viral Score</TH>
        </THead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={8}>No creator activity in this period yet.</EmptyRow> : null}
          {rows.map((c, i) => (
            <TR key={c.wallet} interactive>
              <TD className="font-mono text-[12px] text-ink-4">{i + 1}</TD>
              <TD>
                <RowLink href={`/creators/${c.wallet}`} label={`Creator ${c.wallet}`}>
                  <span className="flex items-center gap-3">
                    <WalletAvatar wallet={c.wallet} size={28} />
                    <span className="min-w-0">
                      <span className="block font-mono text-[12.5px] text-ink">{shortAddress(c.wallet, 5)}</span>
                      <span className="block truncate text-[12px] text-ink-3">
                        {c.handles.length
                          ? c.handles
                              .slice(0, 3)
                              .map((h) => `@${h.handle} · ${PLATFORM_SHORT[h.platform]}`)
                              .join("   ")
                          : "No linked accounts"}
                      </span>
                    </span>
                  </span>
                </RowLink>
              </TD>
              <TD align="right" numeric className="font-medium text-ink">
                {sol(c.rewardsLamports)}
              </TD>
              <TD align="right" numeric className="text-ink-2">
                {compactNumber(c.verifiedViews)}
              </TD>
              <TD align="right" numeric className="text-ink-2">
                {c.videos}
              </TD>
              <TD align="right" numeric className="text-ink-2">
                {c.wins}
              </TD>
              <TD align="right" numeric className="text-ink-2">
                {c.competitions}
              </TD>
              <TD align="right" numeric className="text-ink">
                {score(c.bestScore)}
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

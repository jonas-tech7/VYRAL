import { connection } from "next/server";
import type { Metadata } from "next";
import { Suspense } from "react";
import { CompetitionsTable } from "@/components/competition/competitions-table";
import { TableSkeleton } from "@/components/competition/skeletons";
import { Container, PageHeader, Skeleton } from "@/components/ui/misc";
import { Pagination, SearchForm } from "@/components/ui/search";
import { SegmentedLinks } from "@/components/ui/segmented";
import { COMPETITION_SORTS, listCompetitions, type CompetitionSort } from "@/lib/queries/public";

export const metadata: Metadata = {
  title: "Competitions",
  description: "Every token on VYRAL runs a continuous video competition. Browse live competitions, reward pools and leaders.",
};

const SORT_LABEL: Record<CompetitionSort, string> = {
  trending: "Trending",
  market_cap: "Highest market cap",
  reward_pool: "Highest reward pool",
  views: "Most video views",
  participants: "Most participants",
  recent: "Recently launched",
};

const PAGE_SIZE = 25;

export default function CompetitionsPage(props: PageProps<"/competitions">) {
  return (
    <Container>
      <PageHeader
        title="Competitions"
        description="Every token launched on VYRAL runs a continuous video competition. At each checkpoint, the top eligible video earns a share of the token's creator fees."
      />
      <Suspense
        fallback={
          <>
            <Skeleton className="mb-6 h-9 w-full max-w-[720px]" />
            <TableSkeleton rows={10} />
          </>
        }
      >
        <Results searchParams={props.searchParams} />
      </Suspense>
    </Container>
  );
}

async function Results({ searchParams }: Pick<PageProps<"/competitions">, "searchParams">) {
  await connection();
  const sp = await searchParams;
  const sort = (COMPETITION_SORTS as readonly string[]).includes(String(sp.sort)) ? (sp.sort as CompetitionSort) : "trending";
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 64) : "";
  const page = Math.max(1, Math.min(1000, Number(sp.page) || 1));
  const { items, total } = await listCompetitions({ sort, q: q || undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });

  const href = (next: { sort?: string; page?: number }) => {
    const params = new URLSearchParams();
    const s = next.sort ?? sort;
    if (s !== "trending") params.set("sort", s);
    if (q) params.set("q", q);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const str = params.toString();
    return `/competitions${str ? `?${str}` : ""}`;
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SegmentedLinks
          ariaLabel="Sort competitions"
          items={COMPETITION_SORTS.map((s) => ({ label: SORT_LABEL[s], href: href({ sort: s, page: 1 }), active: s === sort }))}
        />
        <SearchForm action="/competitions" defaultValue={q} placeholder="Search name, ticker or mint" hidden={{ sort: sort === "trending" ? undefined : sort }} />
      </div>
      <CompetitionsTable items={items} now={new Date()} emptyText={q ? undefined : "No competitions yet. They open as soon as the first coins launch."} />
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} href={(p) => href({ page: p })} />
    </div>
  );
}

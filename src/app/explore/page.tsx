import { connection } from "next/server";
import type { Metadata } from "next";
import { Suspense } from "react";
import { TableSkeleton } from "@/components/competition/skeletons";
import { TokenCell } from "@/components/competition/token-cell";
import { DemoTag } from "@/components/ui/badge";
import { Container, PageHeader, Skeleton } from "@/components/ui/misc";
import { Pagination, SearchForm } from "@/components/ui/search";
import { SegmentedLinks } from "@/components/ui/segmented";
import { Delta } from "@/components/ui/stat";
import { EmptyRow, RowLink, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { age, compactNumber, price, usd } from "@/lib/format";
import { listTokens, TOKEN_SORTS, type TokenSort } from "@/lib/queries/public";

export const metadata: Metadata = {
  title: "Explore tokens",
  description: "Browse every token launched on VYRAL by trend, age, market cap and volume.",
};

const LABEL: Record<TokenSort, string> = {
  trending: "Trending",
  new: "New",
  market_cap: "Market cap",
  volume: "24h volume",
  gainers: "Top gainers",
};
const PAGE_SIZE = 30;

export default function ExplorePage(props: PageProps<"/explore">) {
  return (
    <Container>
      <PageHeader title="Explore" description="Every token launched on VYRAL, with live market data. Open a token for its chart, trading links and competition." />
      <Suspense
        fallback={
          <>
            <Skeleton className="mb-6 h-9 w-full max-w-[520px]" />
            <TableSkeleton rows={12} />
          </>
        }
      >
        <Tokens searchParams={props.searchParams} />
      </Suspense>
    </Container>
  );
}

async function Tokens({ searchParams }: Pick<PageProps<"/explore">, "searchParams">) {
  await connection();
  const sp = await searchParams;
  const sort = (TOKEN_SORTS as readonly string[]).includes(String(sp.sort)) ? (sp.sort as TokenSort) : "trending";
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 64) : "";
  const page = Math.max(1, Math.min(1000, Number(sp.page) || 1));
  const { items, total } = await listTokens({ sort, q: q || undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const now = new Date();
  const href = (next: { sort?: TokenSort; page?: number }) => {
    const p = new URLSearchParams();
    const s = next.sort ?? sort;
    if (s !== "trending") p.set("sort", s);
    if (q) p.set("q", q);
    if (next.page && next.page > 1) p.set("page", String(next.page));
    const str = p.toString();
    return `/explore${str ? `?${str}` : ""}`;
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SegmentedLinks ariaLabel="Sort tokens" items={TOKEN_SORTS.map((s) => ({ label: LABEL[s], href: href({ sort: s, page: 1 }), active: s === sort }))} />
        <SearchForm action="/explore" defaultValue={q} placeholder="Search name, ticker or mint" hidden={{ sort: sort === "trending" ? undefined : sort }} />
      </div>
      <Table minWidth={900}>
        <THead>
          <TH className="w-10">#</TH>
          <TH>Token</TH>
          <TH align="right">Price</TH>
          <TH align="right">24h</TH>
          <TH align="right">Market cap</TH>
          <TH align="right">24h volume</TH>
          <TH align="right">Video views</TH>
          <TH align="right">Age</TH>
        </THead>
        <tbody>
          {items.length === 0 ? <EmptyRow colSpan={8}>No tokens match your search.</EmptyRow> : null}
          {items.map((t, i) => (
            <TR key={t.tokenId} interactive>
              <TD className="font-mono text-[12px] text-ink-4">{(page - 1) * PAGE_SIZE + i + 1}</TD>
              <TD>
                <RowLink href={`/token/${t.mint}`} label={`${t.name} token`}>
                  <span className="flex items-center gap-2">
                    <TokenCell name={t.name} symbol={t.symbol} imageUrl={t.imageUrl} />
                    {t.isSimulated ? <DemoTag className="hidden lg:inline-flex" /> : null}
                  </span>
                </RowLink>
              </TD>
              <TD align="right" numeric className="text-ink">
                {price(t.priceUsd)}
              </TD>
              <TD align="right">
                <Delta value={t.priceChange24hPct} className="text-[13px]" />
              </TD>
              <TD align="right" numeric className="text-ink">
                {usd(t.marketCapUsd, { compact: true })}
              </TD>
              <TD align="right" numeric className="text-ink-2">
                {usd(t.volume24hUsd, { compact: true })}
              </TD>
              <TD align="right" numeric className="text-ink-2">
                {compactNumber(t.totalViews)}
              </TD>
              <TD align="right" className="text-ink-3">
                {age(t.launchedAt, now)}
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} href={(p) => href({ page: p })} />
    </div>
  );
}

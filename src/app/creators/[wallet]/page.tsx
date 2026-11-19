import { connection } from "next/server";
import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { TrendChart } from "@/components/charts/trend-chart";
import { VideoStatus } from "@/components/competition/status";
import { TokenCell } from "@/components/competition/token-cell";
import { PayoutStatus, TxSignature } from "@/components/competition/tx";
import { Tag } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/client";
import { Container, SectionHeader, Skeleton } from "@/components/ui/misc";
import { PlatformTag } from "@/components/ui/platform";
import { Stat, StatGrid } from "@/components/ui/stat";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { WalletAvatar } from "@/components/ui/token-avatar";
import { PLATFORM_SHORT } from "@/lib/domain/platforms";
import { compactNumber, dateTimeUtc, dateUtc, fullNumber, score, shortAddress, sol, solToUsd, timeAgo, usd } from "@/lib/format";
import { getCreatorProfile } from "@/lib/queries/public";
import { explorerAccountUrl } from "@/lib/solana/cluster";
import { isValidAddress } from "@/lib/solana/keys";

export const metadata: Metadata = { title: "Creator profile" };

export default function CreatorPage(props: PageProps<"/creators/[wallet]">) {
  return (
    <Container>
      <Suspense
        fallback={
          <div className="pt-12" aria-hidden>
            <Skeleton className="h-12 w-96" />
            <Skeleton className="mt-10 h-[180px] w-full" />
            <Skeleton className="mt-10 h-[280px] w-full" />
          </div>
        }
      >
        <Profile params={props.params} />
      </Suspense>
    </Container>
  );
}

async function Profile({ params }: Pick<PageProps<"/creators/[wallet]">, "params">) {
  await connection();
  const { wallet } = await params;
  if (!isValidAddress(wallet)) notFound();
  const p = await getCreatorProfile(wallet);
  if (!p) notFound();
  const s = p.summary;
  const now = new Date();
  const confirmedPayouts = p.payouts.filter((x) => x.status === "confirmed");

  return (
    <div className="animate-fade-in">
      <nav aria-label="Breadcrumb" className="pt-8 text-[12.5px] text-ink-3">
        <Link href="/creators" className="hover:text-ink">
          Creators
        </Link>
        <span className="mx-2 text-ink-4">/</span>
        <span className="font-mono text-ink-2">{shortAddress(wallet)}</span>
      </nav>

      <header className="mt-6 flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <WalletAvatar wallet={wallet} size={48} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="truncate font-mono text-[17px] font-medium text-ink sm:text-[19px]">
                <span className="hidden sm:inline">{wallet}</span>
                <span className="sm:hidden">{shortAddress(wallet, 6)}</span>
              </h1>
              <CopyButton value={wallet} label="Copy wallet address" />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-ink-3">
              {p.rank ? <span className="text-ink-2">#{p.rank} by rewards</span> : null}
              <span>Member since {dateUtc(p.memberSince)}</span>
              <a href={explorerAccountUrl(wallet)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-ink">
                Solscan <ArrowUpRight className="size-3" />
              </a>
              {p.isBanned ? <Tag className="border-negative/40 text-negative">Suspended</Tag> : null}
            </div>
          </div>
        </div>
        {s.handles.length ? (
          <ul className="flex flex-wrap gap-2" aria-label="Linked accounts">
            {s.handles.map((h) => (
              <li key={`${h.platform}:${h.handle}`} className="inline-flex h-8 items-center gap-2 rounded-md border border-edge px-2.5 text-[12.5px] text-ink-2">
                <span className="text-ink-3">{PLATFORM_SHORT[h.platform]}</span>@{h.handle}
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <StatGrid className="mt-8" cols={3}>
        <Stat
          label="Total rewards earned"
          value={sol(s.rewardsLamports)}
          sub={p.solUsd ? `≈ ${usd(solToUsd(s.rewardsLamports, p.solUsd), { compact: true })}` : `${confirmedPayouts.length} payouts`}
          size="lg"
        />
        <Stat label="Total verified views" value={compactNumber(s.verifiedViews)} sub="Across all verified videos" size="lg" />
        <Stat label="Best Viral Score" value={score(s.bestScore)} sub="Highest verified entry" size="lg" />
        <Stat label="Videos submitted" value={fullNumber(s.videos)} sub="Excluding rejected entries" />
        <Stat label="Winning submissions" value={fullNumber(s.wins)} sub="Videos paid at least once" />
        <Stat label="Competitions entered" value={fullNumber(s.competitions)} sub="Distinct tokens" />
      </StatGrid>

      <section className="mt-12" aria-labelledby="perf-heading">
        <SectionHeader title={<span id="perf-heading">Historical performance</span>} description="Last 30 days, cumulative. The tables below list every value shown." />
        <div className="rounded-lg border border-edge p-5">
          <TrendChart points={p.history.map((h) => ({ day: h.day.toISOString(), rewards: h.cumRewardsLamports, views: h.cumViews }))} />
        </div>
      </section>

      <section className="mt-12" aria-labelledby="subs-heading">
        <SectionHeader title={<span id="subs-heading">Submissions</span>} />
        <Table minWidth={940}>
          <THead>
            <TH>Token</TH>
            <TH>Video</TH>
            <TH align="right">Views</TH>
            <TH align="right">Likes</TH>
            <TH align="right">Comments</TH>
            <TH align="right">Viral Score</TH>
            <TH align="right">Rank</TH>
            <TH align="right">Status</TH>
          </THead>
          <tbody>
            {p.submissions.length === 0 ? <EmptyRow colSpan={8}>No submissions yet.</EmptyRow> : null}
            {p.submissions.map((v) => (
              <TR key={v.id} interactive>
                <TD>
                  <Link href={`/competitions/${v.mint}`} className="block">
                    <TokenCell name={v.name} symbol={v.symbol} imageUrl={v.imageUrl} size={24} sub={`Submitted ${timeAgo(v.submittedAt, now)}`} />
                  </Link>
                </TD>
                <TD>
                  <span className="flex items-center gap-2.5">
                    <PlatformTag platform={v.platform} />
                    <a href={v.canonicalUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-[13px] text-ink-2 hover:text-ink">
                      {v.authorHandle ? `@${v.authorHandle}` : "Video"}
                    </a>
                  </span>
                </TD>
                <TD align="right" numeric className="text-ink">
                  {compactNumber(v.views)}
                </TD>
                <TD align="right" numeric className="text-ink-2">
                  {compactNumber(v.likes)}
                </TD>
                <TD align="right" numeric className="text-ink-2">
                  {compactNumber(v.comments)}
                </TD>
                <TD align="right" numeric className="text-ink">
                  {score(v.viralScore)}
                </TD>
                <TD align="right" numeric className="text-ink-2">
                  {v.status === "rejected" ? "—" : `#${v.rank}`}
                  {v.wins > 0 ? <span className="ml-1.5 text-[11.5px] text-ink-3">{v.wins}× paid</span> : null}
                </TD>
                <TD align="right">
                  <VideoStatus status={v.status} />
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </section>

      <section className="mt-12" aria-labelledby="payouts-heading">
        <SectionHeader title={<span id="payouts-heading">Payouts received</span>} description="Each payout links to its on-chain transaction." />
        <Table minWidth={860}>
          <THead>
            <TH>Checkpoint</TH>
            <TH>Token</TH>
            <TH align="right">Viral Score</TH>
            <TH align="right">Market cap</TH>
            <TH align="right">Reward</TH>
            <TH>Transaction</TH>
            <TH align="right">Status</TH>
          </THead>
          <tbody>
            {p.payouts.length === 0 ? <EmptyRow colSpan={7}>No payouts yet.</EmptyRow> : null}
            {p.payouts.map((x) => (
              <TR key={x.id}>
                <TD className="text-ink-2">{dateTimeUtc(x.scheduledAt)}</TD>
                <TD>
                  <Link href={`/competitions/${x.mint}`} className="text-[13px] text-ink hover:text-accent">
                    ${x.symbol}
                  </Link>
                </TD>
                <TD align="right" numeric className="text-ink-2">
                  {score(x.winnerScore)}
                </TD>
                <TD align="right" numeric className="text-ink-2">
                  {x.referenceMarketCapUsd ? usd(x.referenceMarketCapUsd, { compact: true }) : "—"}
                </TD>
                <TD align="right" numeric className="font-medium text-ink">
                  {sol(x.amountLamports)}
                </TD>
                <TD>
                  <TxSignature signature={x.signature} simulated={x.isSimulated} />
                </TD>
                <TD align="right">
                  <PayoutStatus status={x.status} />
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </section>
    </div>
  );
}

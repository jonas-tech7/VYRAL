import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { CompetitionsTable } from "@/components/competition/competitions-table";
import { StatsSkeleton, TableSkeleton } from "@/components/competition/skeletons";
import { CompetitionStatus } from "@/components/competition/status";
import { DemoTag } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Countdown } from "@/components/ui/client";
import { Container, SectionHeader, Skeleton, TextLink } from "@/components/ui/misc";
import { PlatformTag } from "@/components/ui/platform";
import { Stat, StatGrid } from "@/components/ui/stat";
import { TokenAvatar } from "@/components/ui/token-avatar";
import { bpsToPct, compactNumber, fullNumber, score, shortAddress, sol, solToUsd, usd } from "@/lib/format";
import { getCompetitionDetail, getPlatformStats, listCompetitions } from "@/lib/queries/public";

export default function HomePage() {
  return (
    <Container>
      <section className="grid gap-12 pb-16 pt-16 sm:pt-24 lg:grid-cols-[1fr_400px] lg:items-center lg:gap-16 lg:pb-24">
        <div className="animate-fade-in">
          <p className="eyebrow inline-flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-accent" aria-hidden />
            The viral launchpad on Solana
          </p>
          <h1 className="mt-5 max-w-[640px] text-[40px] font-semibold leading-[1.04] tracking-[-0.035em] text-ink sm:text-[58px]">
            Every launch deserves to go viral.
          </h1>
          <p className="mt-6 max-w-[520px] text-[16px] leading-relaxed text-ink-2 sm:text-[17px]">
            Launch tokens. Create viral content. Compete for creator fees. VYRAL turns attention into rewards.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <ButtonLink href="/launch" variant="primary" size="lg">
              Launch a Coin
            </ButtonLink>
            <ButtonLink href="/competitions" variant="secondary" size="lg">
              Explore Competitions
            </ButtonLink>
          </div>
        </div>
        <Suspense fallback={<Skeleton className="h-[360px] w-full rounded-lg" />}>
          <LiveCompetition />
        </Suspense>
      </section>

      <section aria-labelledby="stats-heading">
        <h2 id="stats-heading" className="sr-only">
          Platform statistics
        </h2>
        <Suspense fallback={<StatsSkeleton />}>
          <PlatformStats />
        </Suspense>
      </section>

      <section className="mt-20" aria-labelledby="trending-heading">
        <SectionHeader
          title={<span id="trending-heading">Trending competitions</span>}
          description="Live token competitions ranked by trading activity, new entries and views."
          action={<TextLink href="/competitions">View all</TextLink>}
        />
        <Suspense fallback={<TableSkeleton rows={8} />}>
          <Trending />
        </Suspense>
      </section>

      <section className="mt-24" aria-labelledby="how-heading">
        <SectionHeader
          title={<span id="how-heading">How VYRAL works</span>}
          action={<TextLink href="/docs">Read the documentation</TextLink>}
        />
        <ol className="grid gap-px overflow-hidden rounded-lg border border-edge bg-edge md:grid-cols-3">
          {[
            {
              n: "01",
              title: "Launch a token",
              body: "Every token launched on VYRAL opens its own video competition, funded by a transparent share of the token's creator fees.",
            },
            {
              n: "02",
              title: "Create and submit videos",
              body: "Publish on TikTok, YouTube Shorts, Instagram Reels or X after launch, then submit the link with your wallet. Platform data verifies every entry.",
            },
            {
              n: "03",
              title: "Rank at the top, get paid",
              body: "At every payout checkpoint, the highest eligible Viral Score receives the reward on-chain. Every payout is publicly verifiable.",
            },
          ].map((s) => (
            <li key={s.n} className="flex flex-col bg-canvas p-6 sm:p-7">
              <span className="font-mono text-[12px] text-ink-4">{s.n}</span>
              <h3 className="mt-6 text-[16px] font-semibold tracking-[-0.01em] text-ink">{s.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </Container>
  );
}

async function PlatformStats() {
  await connection();
  const s = await getPlatformStats();
  return (
    <div className="animate-fade-in">
      {s.demo ? (
        <div className="mb-2 flex justify-end">
          <DemoTag label="Demonstration data" />
        </div>
      ) : null}
      <StatGrid>
        <Stat label="Tokens launched" value={fullNumber(s.tokensLaunched)} sub={`${s.tokensLaunched24h} in the last 24h`} size="lg" />
        <Stat
          label="Creator fees generated"
          value={sol(s.feesGeneratedLamports)}
          sub={s.solUsd ? `≈ ${usd(solToUsd(s.feesGeneratedLamports, s.solUsd), { compact: true })}` : "Confirmed on-chain"}
          size="lg"
        />
        <Stat
          label="Rewards distributed"
          value={sol(s.rewardsDistributedLamports)}
          sub={`${fullNumber(s.payoutsConfirmed)} confirmed payouts`}
          size="lg"
        />
        <Stat label="Video views generated" value={compactNumber(s.totalViews)} sub={`${fullNumber(s.videosSubmitted)} videos competing`} size="lg" />
      </StatGrid>
    </div>
  );
}

async function Trending() {
  await connection();
  const { items } = await listCompetitions({ sort: "trending", limit: 8 });
  return (
    <div className="animate-fade-in">
      <CompetitionsTable items={items} variant="home" now={new Date()} />
    </div>
  );
}

/** The current #1 trending competition, showing the mechanism at a glance. */
async function LiveCompetition() {
  await connection();
  const { items } = await listCompetitions({ sort: "trending", limit: 1 });
  const top = items[0];
  if (!top) return null;
  const detail = await getCompetitionDetail(top.mint);
  if (!detail) return null;
  const leaders = detail.leaderboard.slice(0, 3);
  return (
    <aside aria-label="Live competition" className="animate-fade-in rounded-lg border border-edge bg-raised">
      <div className="flex items-center justify-between gap-3 border-b border-edge px-5 py-3.5">
        <Link href={`/competitions/${top.mint}`} className="flex min-w-0 items-center gap-2.5">
          <TokenAvatar symbol={top.symbol} imageUrl={top.imageUrl} size={22} />
          <span className="truncate text-[13.5px] font-medium text-ink">{top.name}</span>
          <span className="text-[12px] text-ink-3">${top.symbol}</span>
        </Link>
        <CompetitionStatus status={top.status} />
      </div>
      <div className="grid grid-cols-2 gap-px bg-edge">
        <div className="bg-raised px-5 py-4">
          <p className="text-[12px] text-ink-3">Next payout (est.)</p>
          <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-ink">{sol(top.estimatedRewardLamports)}</p>
          <p className="mt-0.5 text-[12px] text-ink-3">{bpsToPct(top.currentRewardBps)} of fees at {usd(top.marketCapUsd, { compact: true })}</p>
        </div>
        <div className="bg-raised px-5 py-4">
          <p className="text-[12px] text-ink-3">Checkpoint in</p>
          <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-ink">
            <Countdown to={top.nextCheckpointAt.toISOString()} />
          </p>
          <p className="mt-0.5 text-[12px] text-ink-3">Every {top.payoutIntervalHours} hours</p>
        </div>
      </div>
      <div className="border-t border-edge px-5 pb-2 pt-3.5">
        <p className="text-[12px] text-ink-3">Leaderboard</p>
        <ol className="mt-2">
          {leaders.map((l) => (
            <li key={l.id} className="flex items-center gap-3 border-b border-edge py-2.5 last:border-b-0">
              <span className="w-4 font-mono text-[12px] text-ink-4">{l.rank}</span>
              <PlatformTag platform={l.platform} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{l.authorHandle ? `@${l.authorHandle}` : shortAddress(l.creatorWallet)}</span>
              <span className="num text-[13px] text-ink">{score(l.viralScore)}</span>
            </li>
          ))}
        </ol>
      </div>
      <Link
        href={`/competitions/${top.mint}`}
        className="flex items-center justify-between border-t border-edge px-5 py-3 text-[13px] text-ink-2 transition-colors hover:bg-overlay hover:text-ink"
      >
        View competition
        <ArrowRight className="size-3.5" />
      </Link>
    </aside>
  );
}

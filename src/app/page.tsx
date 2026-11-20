import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { FormationVisual } from "@/components/brand/formation";
import { LogoMark } from "@/components/brand/logo";
import { StatsSkeleton } from "@/components/competition/skeletons";
import { Flywheel } from "@/components/home/flywheel";
import { DemoTag } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Countdown } from "@/components/ui/client";
import { Container, SectionHeader, Skeleton, TextLink } from "@/components/ui/misc";
import { PlatformTag } from "@/components/ui/platform";
import { Stat, StatGrid } from "@/components/ui/stat";
import { TokenAvatar } from "@/components/ui/token-avatar";
import { getAllConfig } from "@/lib/config/store";
import { bpsToPct, compactNumber, fullNumber, score, shortAddress, sol, solToUsd, usd } from "@/lib/format";
import { CREATOR_FEE_SPLIT } from "@/lib/launch/fee-split";
import { getCompetitionDetail, getPlatformStats, listCompetitions } from "@/lib/queries/public";

export default function HomePage() {
  return (
    <Container>
      <section className="grid gap-6 pb-10 pt-8 sm:pt-12 lg:grid-cols-[1fr_460px] lg:items-center lg:gap-12 lg:pb-12 lg:pt-14">
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
        <FormationVisual className="order-first mx-auto max-w-[240px] sm:max-w-[300px] lg:order-none lg:max-w-[460px]" />
      </section>

      <Suspense fallback={<Skeleton className="h-[74px] w-full rounded-lg" />}>
        <LiveStrip />
      </Suspense>

      <section className="mt-6" aria-labelledby="stats-heading">
        <h2 id="stats-heading" className="sr-only">
          Platform statistics
        </h2>
        <Suspense fallback={<StatsSkeleton />}>
          <PlatformStats />
        </Suspense>
      </section>

      <section
        className="mt-28 grid items-center gap-16 sm:mt-36 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-20"
        aria-labelledby="loop-heading"
      >
        <div>
          <p className="eyebrow">The attention loop</p>
          <h2 id="loop-heading" className="mt-3 text-[36px] font-semibold leading-[1.05] tracking-[-0.035em] text-ink sm:text-[52px]">
            Memes are attention.
          </h2>
          <p className="mt-5 max-w-[470px] text-[16px] leading-relaxed text-ink-2 sm:text-[17px]">
            VYRAL turns that attention into a loop. Creators get paid for the reach they bring. The coin gets seen, talked about and traded. Its fees
            fund the next round of rewards.
          </p>
          <Link
            href="/how-it-works"
            className="mt-7 inline-flex items-center gap-1.5 text-[14px] text-ink underline decoration-edge-strong underline-offset-4 transition-colors hover:decoration-accent"
          >
            How it works
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
        <Flywheel className="max-w-[330px] sm:max-w-[440px]" />
      </section>

      <section className="mt-28 sm:mt-36" aria-labelledby="rules-heading">
        <SectionHeader
          title={<span id="rules-heading">The rules, in short</span>}
          action={<TextLink href="/how-it-works">Read everything</TextLink>}
        />
        <Suspense fallback={<Skeleton className="h-[132px] w-full rounded-lg" />}>
          <RulesBand />
        </Suspense>
      </section>

      <section
        className="relative mt-28 overflow-hidden rounded-xl border border-edge bg-raised px-6 py-16 text-center sm:mt-36 sm:py-24"
        aria-labelledby="cta-heading"
      >
        <LogoMark
          size={460}
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-ink opacity-[0.035]"
        />
        <div className="relative">
          <h2 id="cta-heading" className="mx-auto max-w-[620px] text-[30px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-[44px]">
            Give your coin a reason to be talked about.
          </h2>
          <p className="mx-auto mt-4 max-w-[480px] text-[15.5px] leading-relaxed text-ink-2">
            Launch on VYRAL and every creator who makes it go viral can get paid from its fees.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/launch" variant="primary" size="lg">
              Launch a Coin
            </ButtonLink>
            <ButtonLink href="/how-it-works" variant="secondary" size="lg">
              How it works
            </ButtonLink>
          </div>
        </div>
      </section>
    </Container>
  );
}

/** The four rules people ask about first, read from the live configuration. */
async function RulesBand() {
  await connection();
  const { scoring, eligibility, payouts } = await getAllConfig();
  const youtubeLike = scoring.value.multipliers.youtube.like;
  const cells = [
    { value: payouts.value.allowedIntervalsHours.map((h) => `${h}h`).join(" · "), label: "Payout rounds, chosen at launch" },
    { value: fullNumber(eligibility.value.minVerifiedViews), label: "Verified views to get paid" },
    { value: "CA", label: "Contract address in every post" },
    { value: `×${youtubeLike.toFixed(2)}`, label: "A YouTube Shorts like, measured against a TikTok like" },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-edge bg-edge lg:grid-cols-4">
      {cells.map((c, i) => (
        <div key={c.label} className="bg-canvas px-5 py-6 sm:px-6 sm:py-7">
          <p className={`num font-mono text-[26px] font-medium tracking-[-0.03em] sm:text-[32px] ${i === 3 ? "text-accent" : "text-ink"}`}>{c.value}</p>
          <p className="mt-2 text-[12.5px] leading-snug text-ink-3 sm:text-[13px]">{c.label}</p>
        </div>
      ))}
    </div>
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
          label="Fees to rewards"
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

/** The current #1 trending competition, showing the mechanism at a glance. */
async function LiveStrip() {
  await connection();
  const { items } = await listCompetitions({ sort: "trending", limit: 1 });
  const top = items[0];
  if (!top) return null;
  const detail = await getCompetitionDetail(top.mint);
  if (!detail) return null;
  const leader = detail.leaderboard[0];
  const href = `/competitions/${top.mint}`;
  return (
    <aside
      aria-label="Live competition"
      className="animate-fade-in grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-edge bg-edge lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.35fr)_auto]"
    >
      <Link href={href} className="col-span-2 flex min-w-0 items-center gap-3 bg-raised px-5 py-4 transition-colors hover:bg-overlay lg:col-span-1">
        <TokenAvatar symbol={top.symbol} imageUrl={top.imageUrl} size={28} />
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-[11.5px] text-ink-3">
            <span className="size-1.5 animate-pulse-soft rounded-full bg-accent" aria-hidden />
            Live now
          </span>
          <span className="mt-0.5 flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[14px] font-medium text-ink">{top.name}</span>
            <span className="text-[12px] text-ink-3">${top.symbol}</span>
          </span>
        </span>
      </Link>
      <div className="bg-raised px-5 py-4">
        <p className="text-[11.5px] text-ink-3">Next payout (est.)</p>
        <p className="num mt-0.5 text-[16px] font-semibold tracking-[-0.01em] text-ink">{sol(top.estimatedRewardLamports)}</p>
        <p className="text-[11.5px] text-ink-4">{bpsToPct(CREATOR_FEE_SPLIT.vaultBps)} of creator fees</p>
      </div>
      <div className="bg-raised px-5 py-4">
        <p className="text-[11.5px] text-ink-3">Checkpoint in</p>
        <p className="num mt-0.5 text-[16px] font-semibold tracking-[-0.01em] text-ink">
          <Countdown to={top.nextCheckpointAt.toISOString()} />
        </p>
        <p className="text-[11.5px] text-ink-4">Every {top.payoutIntervalHours} hours</p>
      </div>
      <div className="col-span-2 min-w-0 bg-raised px-5 py-4 lg:col-span-1">
        <p className="text-[11.5px] text-ink-3">Leading</p>
        {leader ? (
          <p className="mt-1 flex min-w-0 items-center gap-2.5">
            <PlatformTag platform={leader.platform} />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
              {leader.authorHandle ? `@${leader.authorHandle}` : shortAddress(leader.creatorWallet)}
            </span>
            <span className="num font-mono text-[13px] text-ink">{score(leader.viralScore)}</span>
          </p>
        ) : (
          <p className="mt-1 text-[13px] text-ink-3">No entries yet</p>
        )}
      </div>
      <Link
        href={href}
        className="col-span-2 flex items-center justify-between gap-2 bg-raised px-5 py-4 text-[13px] text-ink-2 transition-colors hover:bg-overlay hover:text-ink lg:col-span-1"
      >
        View competition
        <ArrowRight className="size-3.5" />
      </Link>
    </aside>
  );
}

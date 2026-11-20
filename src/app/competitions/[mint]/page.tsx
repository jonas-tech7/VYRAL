import { connection } from "next/server";
import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { CompetitionStatus, Eligibility, VideoStatus } from "@/components/competition/status";
import { CHECKPOINT_OUTCOME, PayoutStatus, TxSignature } from "@/components/competition/tx";
import { DemoTag } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Address, CopyButton, Countdown } from "@/components/ui/client";
import { Container, KV, Notice, Panel, SectionHeader, Skeleton } from "@/components/ui/misc";
import { PlatformTag } from "@/components/ui/platform";
import { Stat, StatGrid } from "@/components/ui/stat";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { TokenAvatar } from "@/components/ui/token-avatar";
import { db, schema } from "@/lib/db";
import { PLATFORM_LABEL, PLATFORM_SHORT, PLATFORMS } from "@/lib/domain/platforms";
import { env } from "@/lib/env";
import { CREATOR_FEE_SPLIT } from "@/lib/launch/fee-split";
import { coinPageUrl } from "@/lib/launch/metadata";
import { age, bpsToPct, compactNumber, dateTimeUtc, fullNumber, price, score, shortAddress, sol, solToUsd, timeAgo, usd } from "@/lib/format";
import { getCompetitionDetail } from "@/lib/queries/public";

const VAULT_PCT = bpsToPct(CREATOR_FEE_SPLIT.vaultBps);
const DEPLOYER_PCT = bpsToPct(CREATOR_FEE_SPLIT.deployerBps);

async function tokenMeta(mint: string) {
  "use cache";
  cacheLife("hours");
  const [t] = await db.select({ name: schema.tokens.name, symbol: schema.tokens.symbol }).from(schema.tokens).where(eq(schema.tokens.mint, mint));
  return t ?? null;
}

export async function generateMetadata({ params }: PageProps<"/competitions/[mint]">): Promise<Metadata> {
  const { mint } = await params;
  const t = await tokenMeta(mint);
  return t
    ? { title: `${t.name} ($${t.symbol}) competition`, description: `Create videos about $${t.symbol}, compete on Viral Score and earn a share of its creator fees.` }
    : { title: "Competition" };
}

export default function CompetitionPage(props: PageProps<"/competitions/[mint]">) {
  return (
    <Container>
      <Suspense fallback={<DetailSkeleton />}>
        <Detail params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </Container>
  );
}

function DetailSkeleton() {
  return (
    <div className="pt-10" aria-hidden>
      <Skeleton className="h-3 w-40" />
      <div className="mt-6 flex items-center gap-4">
        <Skeleton className="size-12 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-3 w-72" />
        </div>
      </div>
      <Skeleton className="mt-10 h-[180px] w-full rounded-lg" />
      <Skeleton className="mt-10 h-[260px] w-full rounded-lg" />
    </div>
  );
}

async function Detail({ params, searchParams }: Pick<PageProps<"/competitions/[mint]">, "params" | "searchParams">) {
  await connection();
  const { mint } = await params;
  const sp = await searchParams;
  const d = await getCompetitionDetail(mint);
  if (!d) notFound();
  const now = new Date();
  const leader = d.leaderboard.find((l) => l.ineligibleReason === null) ?? null;

  return (
    <div className="animate-fade-in pb-4">
      <nav aria-label="Breadcrumb" className="pt-8 text-[12.5px] text-ink-3">
        <Link href="/competitions" className="hover:text-ink">
          Competitions
        </Link>
        <span className="mx-2 text-ink-4">/</span>
        <span className="text-ink-2">${d.symbol}</span>
      </nav>

      <header className="mt-6 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <TokenAvatar symbol={d.symbol} imageUrl={d.imageUrl} size={48} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink sm:text-[28px]">{d.name}</h1>
              <span className="text-[15px] text-ink-3">${d.symbol}</span>
              <CompetitionStatus status={d.status} />
              {d.isSimulated ? <DemoTag /> : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
              <Address value={d.mint} />
              <span className="text-ink-4">·</span>
              <span>Launched {timeAgo(d.launchedAt, now)}</span>
              <span className="text-ink-4">·</span>
              <span>Payout every {d.payoutIntervalHours}h</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ButtonLink href={`/token/${d.mint}`} variant="secondary">
            Token &amp; trading
          </ButtonLink>
          {d.status === "active" ? (
            <ButtonLink href={`/competitions/${d.mint}/submit`} variant="primary">
              Submit Video
            </ButtonLink>
          ) : null}
        </div>
      </header>

      {sp.launched === "1" ? (
        <Notice tone="positive" className="mt-6">
          <span className="font-medium">Your token is live.</span> Its competition is open now — share this page with creators. Videos published from
          this moment on are eligible. The coin&apos;s metadata already links here, so people who find it elsewhere land on this page.
          <span className="mt-2 flex items-start gap-1.5">
            <code className="min-w-0 break-all font-mono text-[12.5px]">{coinPageUrl(d.mint, env.APP_URL)}</code>
            <CopyButton value={coinPageUrl(d.mint, env.APP_URL)} label="Copy link" className="shrink-0" />
          </span>
        </Notice>
      ) : null}
      {d.status === "paused" ? (
        <Notice tone="warning" className="mt-6">
          <span className="font-medium">Competition paused by administrators.</span> {d.pausedReason ?? ""} Checkpoints are skipped while paused and fees
          roll over to the next checkpoint after it resumes.
        </Notice>
      ) : null}

      <StatGrid className="mt-8">
        <Stat label="Market cap" value={usd(d.marketCapUsd, { compact: true })} sub={`Price ${price(d.priceUsd)}`} />
        <Stat label="24h volume" value={usd(d.volume24hUsd, { compact: true })} sub={<Change v={d.priceChange24hPct} />} />
        <Stat
          label="Fees to rewards"
          value={sol(d.feesTotalLamports)}
          sub={d.solUsd ? `≈ ${usd(solToUsd(d.feesTotalLamports, d.solUsd), { compact: true })} · confirmed` : "Confirmed on-chain"}
        />
        <Stat label="Reward pool" value={sol(d.estimatedRewardLamports)} sub="Next payout est." />
        <Stat label="Total video views" value={compactNumber(d.totalViews)} sub="Verified + in review" />
        <Stat label="Videos submitted" value={fullNumber(d.videoCount)} sub={`${d.submissions24h} in the last 24h`} />
        <Stat label="Creators" value={fullNumber(d.creatorCount)} sub="Unique wallets" />
        <Stat label="Rewards paid" value={sol(d.rewardsPaidLamports)} sub={`${d.payouts.filter((p) => p.status === "confirmed").length} confirmed payouts`} />
      </StatGrid>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <Panel title="Next payout" action={<span className="text-[12px] text-ink-3">Every {d.payoutIntervalHours} hours</span>}>
          <div className="px-5 pb-2 pt-4">
            <p className="text-[12px] text-ink-3">Checkpoint in</p>
            <p className="mt-1 text-[26px] font-semibold tracking-[-0.02em] text-ink">
              {d.status === "active" ? <Countdown to={d.nextCheckpointAt.toISOString()} /> : "Paused"}
            </p>
            <p className="mt-0.5 text-[12px] text-ink-3">{dateTimeUtc(d.nextCheckpointAt)}</p>
          </div>
          <div className="divide-y divide-edge border-t border-edge px-5">
            <KV label="Share to rewards">
              <span className="num">{VAULT_PCT}</span> of creator fees
            </KV>
            <KV label="Unallocated confirmed fees">
              <span className="num">{sol(d.unallocatedLamports)}</span>
            </KV>
            <KV label="Pending confirmation">
              <span className="num text-ink-3">{sol(d.pendingFeesLamports)}</span>
            </KV>
            <KV label="Estimated reward">
              <span className="num font-medium">{sol(d.estimatedRewardLamports)}</span>
            </KV>
            <KV label="Current leader">
              {leader ? (
                <Link href={`/creators/${leader.creatorWallet}`} className="hover:text-accent">
                  {leader.authorHandle ? `@${leader.authorHandle}` : shortAddress(leader.creatorWallet)} · <span className="num">{score(leader.viralScore)}</span>
                </Link>
              ) : (
                <span className="text-ink-3">No eligible video yet</span>
              )}
            </KV>
          </div>
          <p className="border-t border-edge px-5 py-3 text-[12px] leading-relaxed text-ink-3">
            Only confirmed fees count, and the top eligible video receives all of them. If no video is eligible, they roll over to the next checkpoint.
          </p>
        </Panel>

        <Panel title="Fee split" action={<span className="text-[12px] text-ink-3">Locked on-chain</span>} className="flex flex-col">
          <div className="px-5 pb-5 pt-4">
            <p className="text-[12px] text-ink-3">Share of this coin&apos;s creator fees</p>
            <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-overlay-2" aria-hidden>
              <div className="h-full bg-accent" style={{ width: `${CREATOR_FEE_SPLIT.vaultBps / 100}%` }} />
              <div className="h-full bg-ink-3" style={{ width: `${CREATOR_FEE_SPLIT.deployerBps / 100}%` }} />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <dt className="flex items-center gap-2 text-[12px] text-ink-3">
                  <span className="size-2 rounded-full bg-accent" aria-hidden />
                  Competition rewards
                </dt>
                <dd className="num mt-1 text-[26px] font-semibold tracking-[-0.02em] text-ink">{VAULT_PCT}</dd>
                <dd className="text-[12px] text-ink-3">Into the reward vault</dd>
              </div>
              <div>
                <dt className="flex items-center gap-2 text-[12px] text-ink-3">
                  <span className="size-2 rounded-full bg-ink-3" aria-hidden />
                  Deployer
                </dt>
                <dd className="num mt-1 text-[26px] font-semibold tracking-[-0.02em] text-ink">{DEPLOYER_PCT}</dd>
                <dd className="text-[12px] text-ink-3">Paid by pump.fun</dd>
              </div>
            </dl>
          </div>
          <p className="mt-auto border-t border-edge px-5 py-3 text-[12px] leading-relaxed text-ink-3">
            The split was locked on pump.fun when the coin launched and can&apos;t be changed, not by the deployer and not by VYRAL.
          </p>
        </Panel>

        <Panel title="Rules">
          <div className="divide-y divide-edge px-5">
            <KV label="Published after">{dateTimeUtc(d.launchedAt)}</KV>
            <KV label="Eligible from">{fullNumber(d.minEligibleViews)} verified views</KV>
            <KV label="Platforms">{PLATFORMS.map((p) => PLATFORM_SHORT[p]).join(", ")}</KV>
            <KV label="Ownership">Linked platform account</KV>
            <KV label="Ranking">Viral Score (views-weighted)</KV>
            <KV label="Deployer">
              <span className="font-mono text-[12px] text-ink-2">{shortAddress(d.deployerWallet)}</span>
            </KV>
          </div>
          <div className="border-t border-edge px-5 py-3">
            <Link href="/docs/eligibility" className="inline-flex items-center gap-1 text-[12.5px] text-ink-2 hover:text-ink">
              Full eligibility rules <ArrowUpRight className="size-3" />
            </Link>
          </div>
        </Panel>
      </div>

      <section className="mt-14" aria-labelledby="leaderboard-heading">
        <SectionHeader
          title={<span id="leaderboard-heading">Leaderboard</span>}
          description={`Ranked by Viral Score. Verified videos with at least ${fullNumber(d.minEligibleViews)} views are eligible for payouts; flagged videos are excluded until reviewed.`}
          action={
            d.status === "active" ? (
              <Link href={`/competitions/${d.mint}/submit`} className="text-[13px] text-ink-2 hover:text-ink">
                Submit a video
              </Link>
            ) : null
          }
        />
        <Table minWidth={980}>
          <THead>
            <TH className="w-10">#</TH>
            <TH>Video</TH>
            <TH>Creator</TH>
            <TH align="right">Views</TH>
            <TH align="right">Likes</TH>
            <TH align="right">Comments</TH>
            <TH align="right">Viral Score</TH>
            <TH align="right">Status</TH>
          </THead>
          <tbody>
            {d.leaderboard.length === 0 ? <EmptyRow colSpan={8}>No videos yet. Be the first to submit one.</EmptyRow> : null}
            {d.leaderboard.map((v) => (
              <TR key={v.id} interactive>
                <TD className="font-mono text-[12px] text-ink-3">{v.rank}</TD>
                <TD>
                  <span className="flex items-center gap-3">
                    <PlatformTag platform={v.platform} />
                    <span className="min-w-0">
                      <a
                        href={v.canonicalUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex items-center gap-1 text-[13.5px] text-ink hover:text-accent"
                        title={`Open on ${PLATFORM_LABEL[v.platform]}`}
                      >
                        {v.authorHandle ? `@${v.authorHandle}` : "View video"}
                        <ArrowUpRight className="size-3 text-ink-3" />
                      </a>
                      <span className="block text-[12px] text-ink-3">Published {timeAgo(v.publishedAt, now)}</span>
                    </span>
                  </span>
                </TD>
                <TD>
                  <Link href={`/creators/${v.creatorWallet}`} className="font-mono text-[12.5px] text-ink-2 hover:text-ink">
                    {shortAddress(v.creatorWallet)}
                  </Link>
                  {v.wins > 0 ? <span className="ml-2 text-[11.5px] text-ink-3">{v.wins} win{v.wins > 1 ? "s" : ""}</span> : null}
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
                <TD align="right" numeric className="text-[14px] font-medium text-ink">
                  {score(v.viralScore)}
                </TD>
                <TD align="right">
                  <span className="flex flex-col items-end gap-0.5">
                    <VideoStatus status={v.status} />
                    {v.status === "verified" ? <Eligibility reason={v.ineligibleReason} views={v.views} minViews={d.minEligibleViews} /> : null}
                  </span>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </section>

      <section className="mt-14" aria-labelledby="payouts-heading">
        <SectionHeader
          title={<span id="payouts-heading">Payout history</span>}
          description="Every payout is recorded with its checkpoint inputs and transaction signature, so it can be verified independently on a Solana explorer."
        />
        <Table minWidth={1040}>
          <THead>
            <TH>Checkpoint</TH>
            <TH>Winning video</TH>
            <TH>Creator wallet</TH>
            <TH align="right">Viral Score</TH>
            <TH align="right">Market cap</TH>
            <TH align="right">Share</TH>
            <TH align="right">Reward</TH>
            <TH>Transaction</TH>
            <TH align="right">Status</TH>
          </THead>
          <tbody>
            {d.payouts.length === 0 ? <EmptyRow colSpan={9}>No payouts yet. The first checkpoint is {dateTimeUtc(d.nextCheckpointAt)}.</EmptyRow> : null}
            {d.payouts.slice(0, 20).map((p) => (
              <TR key={p.id}>
                <TD className="text-ink-2">
                  {dateTimeUtc(p.scheduledAt)}
                  <span className="block text-[12px] text-ink-3">{timeAgo(p.scheduledAt, now)}</span>
                </TD>
                <TD>
                  <span className="flex items-center gap-2.5">
                    <PlatformTag platform={p.platform} />
                    <a href={p.canonicalUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-[13px] text-ink-2 hover:text-ink">
                      {p.authorHandle ? `@${p.authorHandle}` : "Video"}
                    </a>
                  </span>
                </TD>
                <TD>
                  <Link href={`/creators/${p.recipientWallet}`} className="font-mono text-[12.5px] text-ink-2 hover:text-ink">
                    {shortAddress(p.recipientWallet)}
                  </Link>
                </TD>
                <TD align="right" numeric className="text-ink">
                  {score(p.winnerScore)}
                </TD>
                <TD align="right" numeric className="text-ink-2">
                  {p.referenceMarketCapUsd ? usd(p.referenceMarketCapUsd, { compact: true }) : "—"}
                </TD>
                <TD align="right" numeric className="text-ink-2">
                  {p.rewardBps !== null ? bpsToPct(p.rewardBps) : "—"}
                </TD>
                <TD align="right" numeric className="font-medium text-ink">
                  {sol(p.amountLamports)}
                </TD>
                <TD>
                  <TxSignature signature={p.signature} simulated={p.isSimulated} />
                </TD>
                <TD align="right">
                  <PayoutStatus status={p.status} />
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </section>

      <section className="mt-14" aria-labelledby="checkpoints-heading">
        <SectionHeader
          title={<span id="checkpoints-heading">Checkpoint log</span>}
          description="Outcome of each scheduled checkpoint, including the ones where fees rolled over."
        />
        <Table minWidth={720}>
          <THead>
            <TH>Scheduled</TH>
            <TH>Outcome</TH>
            <TH align="right">Fees in window</TH>
            <TH align="right">Reference market cap</TH>
            <TH align="right">Share</TH>
            <TH align="right">Reward</TH>
          </THead>
          <tbody>
            {d.checkpoints.length === 0 ? <EmptyRow colSpan={6}>No checkpoints yet.</EmptyRow> : null}
            {d.checkpoints.map((c) => (
              <TR key={c.id}>
                <TD className="text-ink-2">{dateTimeUtc(c.scheduledAt)}</TD>
                <TD className={c.status === "awarded" ? "text-ink" : "text-ink-3"}>{CHECKPOINT_OUTCOME[c.status] ?? c.status}</TD>
                <TD align="right" numeric className="text-ink-2">
                  {sol(c.feesInWindowLamports)}
                </TD>
                <TD align="right" numeric className="text-ink-2">
                  {c.referenceMarketCapUsd ? usd(c.referenceMarketCapUsd, { compact: true }) : "—"}
                </TD>
                <TD align="right" numeric className="text-ink-2">
                  {c.rewardBps !== null ? bpsToPct(c.rewardBps) : "—"}
                </TD>
                <TD align="right" numeric className="text-ink">
                  {c.rewardLamports > 0 ? sol(c.rewardLamports) : "—"}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </section>
      <p className="mt-6 text-[12px] text-ink-4">Data as of {age(now, now) === "now" ? "now" : dateTimeUtc(now)} · metrics refresh every few minutes.</p>
    </div>
  );
}

function Change({ v }: { v: number }) {
  const s = Math.abs(v).toFixed(1);
  if (Number(s) === 0) return <span>0.0% 24h</span>;
  return <span className={v > 0 ? "text-positive" : "text-negative"}>{`${v > 0 ? "+" : "−"}${s}% price 24h`}</span>;
}

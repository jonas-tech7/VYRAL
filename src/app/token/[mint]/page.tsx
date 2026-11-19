import { connection } from "next/server";
import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PriceChart } from "@/components/charts/price-chart";
import { CompetitionStatus } from "@/components/competition/status";
import { DemoTag } from "@/components/ui/badge";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Address, Countdown } from "@/components/ui/client";
import { Container, KV, Notice, Panel, Skeleton } from "@/components/ui/misc";
import { Delta } from "@/components/ui/stat";
import { TradeButtons } from "@/components/token/trade-buttons";
import { TokenAvatar } from "@/components/ui/token-avatar";
import { bpsToPct, compactNumber, dateTimeUtc, fullNumber, price, score, shortAddress, sol, timeAgo, usd } from "@/lib/format";
import { getCompetitionDetail } from "@/lib/queries/public";
import { explorerAccountUrl, explorerTokenUrl } from "@/lib/solana/cluster";

export const metadata: Metadata = { title: "Token" };

const SOL_MINT = "So11111111111111111111111111111111111111112";

export default function TokenPage(props: PageProps<"/token/[mint]">) {
  return (
    <Container>
      <Suspense
        fallback={
          <div className="pt-10" aria-hidden>
            <Skeleton className="h-10 w-80" />
            <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_320px]">
              <Skeleton className="h-[440px]" />
              <Skeleton className="h-[440px]" />
            </div>
          </div>
        }
      >
        <TokenDetail params={props.params} />
      </Suspense>
    </Container>
  );
}

async function TokenDetail({ params }: Pick<PageProps<"/token/[mint]">, "params">) {
  await connection();
  const { mint } = await params;
  const d = await getCompetitionDetail(mint);
  if (!d) notFound();
  const now = new Date();
  const leader = d.leaderboard.find((l) => l.ineligibleReason === null) ?? null;
  const tradeDisabled = d.isSimulated;
  const buyUrl = `https://jup.ag/swap/${SOL_MINT}-${d.mint}`;
  const sellUrl = `https://jup.ag/swap/${d.mint}-${SOL_MINT}`;

  return (
    <div className="animate-fade-in">
      <nav aria-label="Breadcrumb" className="pt-8 text-[12.5px] text-ink-3">
        <Link href="/explore" className="hover:text-ink">
          Explore
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
              {d.isSimulated ? <DemoTag /> : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-3">
              <span className="text-ink">{price(d.priceUsd)}</span>
              <Delta value={d.priceChange24hPct} />
              <span className="text-ink-4">·</span>
              <span>Launched {timeAgo(d.launchedAt, now)}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {tradeDisabled ? (
            <>
              <span className={buttonClass("primary", "md", "pointer-events-none opacity-40")} aria-disabled title="Trading is disabled for simulated tokens">
                Buy
              </span>
              <span className={buttonClass("secondary", "md", "pointer-events-none opacity-40")} aria-disabled title="Trading is disabled for simulated tokens">
                Sell
              </span>
            </>
          ) : (
            <TradeButtons buyUrl={buyUrl} sellUrl={sellUrl} symbol={d.symbol} />
          )}
          <ButtonLink href={`/competitions/${d.mint}`} variant="secondary">
            Competition
          </ButtonLink>
        </div>
      </header>

      {tradeDisabled ? (
        <Notice className="mt-6">
          Simulated token: it exists only in this demonstration environment, so buy/sell routing and explorer links are disabled. Live tokens route trades
          through Solana DEX aggregation (Jupiter) and link to Solscan.
        </Notice>
      ) : null}

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <section aria-label="Price chart" className="border-b border-edge pb-8">
            <PriceChart mint={d.mint} symbol={d.symbol} />
          </section>
          <section className="pt-8" aria-labelledby="about-heading">
            <h2 id="about-heading" className="text-[16px] font-semibold text-ink">
              About {d.name}
            </h2>
            <p className="mt-2 max-w-[640px] text-[14px] leading-relaxed text-ink-2">{d.description || "No description provided by the deployer."}</p>
            {Object.values(d.links).some(Boolean) ? (
              <ul className="mt-4 flex flex-wrap gap-2">
                {(["website", "x", "telegram", "discord"] as const)
                  .filter((k) => d.links[k])
                  .map((k) => (
                    <li key={k}>
                      <a
                        href={d.links[k]}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-edge px-3 text-[12.5px] text-ink-2 hover:border-edge-strong hover:text-ink"
                      >
                        {k === "x" ? "X" : k[0].toUpperCase() + k.slice(1)} <ArrowUpRight className="size-3" />
                      </a>
                    </li>
                  ))}
              </ul>
            ) : null}
          </section>
        </div>

        <aside className="flex flex-col gap-4">
          <Panel title="Token">
            <div className="divide-y divide-edge px-5">
              <KV label="Market cap">{usd(d.marketCapUsd, { compact: true })}</KV>
              <KV label="Price">{price(d.priceUsd)}</KV>
              <KV label="24h volume">{usd(d.volume24hUsd, { compact: true })}</KV>
              <KV label="24h change">
                <Delta value={d.priceChange24hPct} />
              </KV>
              <KV label="Total supply">{compactNumber(d.totalSupply)}</KV>
              <KV label="Creator fees generated">{sol(d.feesTotalLamports)}</KV>
              <KV label="Launched">{dateTimeUtc(d.launchedAt)}</KV>
              <KV label="Deployer">
                <Link href={`/creators/${d.deployerWallet}`} className="font-mono text-[12px] text-ink-2 hover:text-ink">
                  {shortAddress(d.deployerWallet)}
                </Link>
              </KV>
              <KV label="Contract">
                <Address value={d.mint} />
              </KV>
            </div>
            <div className="border-t border-edge px-5 py-3">
              {d.isSimulated ? (
                <span className="text-[12.5px] text-ink-4">Not on-chain (simulated)</span>
              ) : (
                <a href={explorerTokenUrl(d.mint)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12.5px] text-ink-2 hover:text-ink">
                  View on Solscan <ArrowUpRight className="size-3" />
                </a>
              )}
              {d.marketDataUpdatedAt ? (
                <p className="mt-1 text-[11.5px] text-ink-4">
                  Market data {timeAgo(d.marketDataUpdatedAt, now)} · {d.marketDataSource}
                </p>
              ) : null}
            </div>
          </Panel>

          <Panel title="Competition" action={<CompetitionStatus status={d.status} />}>
            <div className="divide-y divide-edge px-5">
              <KV label="Reward pool (est.)">{sol(d.estimatedRewardLamports)}</KV>
              <KV label="Reward share">{bpsToPct(d.currentRewardBps)}</KV>
              <KV label="Video views">{compactNumber(d.totalViews)}</KV>
              <KV label="Creators">{fullNumber(d.creatorCount)}</KV>
              <KV label="Leading Viral Score">{leader ? score(leader.viralScore) : "—"}</KV>
              <KV label="Next payout">{d.status === "active" ? <Countdown to={d.nextCheckpointAt.toISOString()} /> : "Paused"}</KV>
            </div>
            <div className="border-t border-edge p-4">
              <ButtonLink href={`/competitions/${d.mint}`} variant="secondary" className="w-full">
                View leaderboard
              </ButtonLink>
            </div>
          </Panel>
          {d.poolAddress ? (
            <a href={explorerAccountUrl(d.poolAddress)} target="_blank" rel="noopener noreferrer" className="text-[12px] text-ink-3 hover:text-ink">
              Launch pool {shortAddress(d.poolAddress)} ↗
            </a>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

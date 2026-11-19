import { connection } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SubmitVideoForm } from "@/components/competition/submit-form";
import { CopyButton } from "@/components/ui/client";
import { Container, KV, Panel, Skeleton } from "@/components/ui/misc";
import { TokenAvatar } from "@/components/ui/token-avatar";
import { getConfig } from "@/lib/config/store";
import { bpsToPct, dateTimeUtc, fullNumber, sol } from "@/lib/format";
import { getCompetitionSummaryByMint } from "@/lib/queries/public";

export const metadata: Metadata = { title: "Submit a video" };

export default function SubmitPage(props: PageProps<"/competitions/[mint]/submit">) {
  return (
    <Container size="default">
      <Suspense
        fallback={
          <div className="pt-12" aria-hidden>
            <Skeleton className="h-8 w-72" />
            <Skeleton className="mt-8 h-[420px] w-full" />
          </div>
        }
      >
        <SubmitContent params={props.params} />
      </Suspense>
    </Container>
  );
}

async function SubmitContent({ params }: Pick<PageProps<"/competitions/[mint]/submit">, "params">) {
  await connection();
  const { mint } = await params;
  const c = await getCompetitionSummaryByMint(mint);
  if (!c) notFound();
  const eligibility = (await getConfig("eligibility")).value;

  return (
    <div className="animate-fade-in">
      <nav aria-label="Breadcrumb" className="pt-8 text-[12.5px] text-ink-3">
        <Link href="/competitions" className="hover:text-ink">
          Competitions
        </Link>
        <span className="mx-2 text-ink-4">/</span>
        <Link href={`/competitions/${c.mint}`} className="hover:text-ink">
          ${c.symbol}
        </Link>
        <span className="mx-2 text-ink-4">/</span>
        <span className="text-ink-2">Submit</span>
      </nav>
      <div className="mt-6 flex items-center gap-3">
        <TokenAvatar symbol={c.symbol} imageUrl={c.imageUrl} size={32} />
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink sm:text-[28px]">Submit a video for ${c.symbol}</h1>
      </div>
      <p className="mt-2 max-w-[620px] text-[14.5px] leading-relaxed text-ink-2">
        Post a short video about {c.name} on TikTok, YouTube Shorts, Instagram Reels or X with the contract address in the caption, title or
        description, then submit the public link. VYRAL verifies the post text, publication time and ownership with platform data and tracks views,
        likes and comments automatically.
      </p>
      <div className="mt-5 max-w-[620px] rounded-lg border border-edge bg-raised px-4 py-3.5">
        <p className="text-[12.5px] text-ink-3">Required in your post: the contract address of ${c.symbol}</p>
        <div className="mt-1.5 flex items-start gap-2">
          <code className="min-w-0 break-all font-mono text-[13px] leading-relaxed text-ink">{c.mint}</code>
          <CopyButton value={c.mint} label="Copy contract address" className="mt-px shrink-0" />
        </div>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_320px]">
        <SubmitVideoForm mint={c.mint} symbol={c.symbol} open={c.status === "active"} />
        <aside className="flex flex-col gap-4">
          <Panel title="Eligibility">
            <div className="divide-y divide-edge px-5">
              <KV label="Published after">{dateTimeUtc(c.launchedAt)}</KV>
              <KV label="Payout eligibility">{fullNumber(c.minEligibleViews)} verified views</KV>
              <KV label="Entries per creator">{eligibility.maxSubmissionsPerCreatorPerCompetition}</KV>
              <KV label="Ownership">{eligibility.requireLinkedAccount ? "Linked account required" : "Not required"}</KV>
            </div>
            <ul className="border-t border-edge px-5 py-4 text-[12.5px] leading-relaxed text-ink-3">
              <li>The post must contain the contract address. Removing it later sends the entry back to review.</li>
              <li className="mt-2">Videos published before the launch never qualify, even if edited or re-uploaded.</li>
              <li className="mt-2">Each video can be entered once, in one competition.</li>
              <li className="mt-2">Suspicious engagement pauses rewards until a reviewer clears it.</li>
            </ul>
          </Panel>
          <Panel title="Current round">
            <div className="divide-y divide-edge px-5">
              <KV label="Reward pool (est.)">{sol(c.estimatedRewardLamports)}</KV>
              <KV label="Reward share">{bpsToPct(c.currentRewardBps)}</KV>
              <KV label="Payout interval">Every {c.payoutIntervalHours}h</KV>
              <KV label="Entries">{fullNumber(c.videoCount)}</KV>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

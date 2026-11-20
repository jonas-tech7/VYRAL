import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ClaimButton, DisputeForm, LinkAccountControl, SignInPrompt } from "@/components/account/account-actions";
import { STATUS_REASON_LABEL } from "@/components/competition/status";
import { PayoutStatus } from "@/components/competition/tx";
import { StatusBadge } from "@/components/ui/badge";
import { Container, Notice, PageHeader, SectionHeader, Skeleton } from "@/components/ui/misc";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { getViewer } from "@/lib/auth/viewer";
import { PLATFORM_LABEL, PLATFORMS } from "@/lib/domain/platforms";
import { dateTimeUtc, shortAddress, sol, timeAgo } from "@/lib/format";
import { getAccountData } from "@/lib/queries/account";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage(props: PageProps<"/account">) {
  return (
    <Container size="narrow">
      <PageHeader title="Account" description="Linked accounts, rewards and disputes for your wallet." />
      <Suspense fallback={<Skeleton className="h-[480px] w-full" />}>
        <AccountContent searchParams={props.searchParams} />
      </Suspense>
    </Container>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  video_rejected: "Video rejected or flagged",
  score_incorrect: "Metrics or score",
  payout_issue: "Payout",
  ownership: "Content ownership",
  other: "Other",
};

async function AccountContent({ searchParams }: Pick<PageProps<"/account">, "searchParams">) {
  const viewer = await getViewer();
  if (!viewer) return <SignInPrompt />;
  const sp = await searchParams;
  const data = await getAccountData(viewer.wallet);
  const now = new Date();

  return (
    <div className="flex animate-fade-in flex-col gap-14">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-edge px-5 py-4">
        <div>
          <p className="text-[12px] text-ink-3">Wallet</p>
          <p className="mt-0.5 font-mono text-[13px] text-ink">{viewer.wallet}</p>
        </div>
        <Link href={`/creators/${viewer.wallet}`} className="text-[13px] text-ink-2 hover:text-ink">
          Public profile →
        </Link>
      </div>

      {sp.link === "ok" ? <Notice tone="positive">Account linked.</Notice> : null}
      {sp.link === "error" ? <Notice tone="negative">{typeof sp.message === "string" ? sp.message : "Linking failed."}</Notice> : null}

      <section aria-labelledby="linked-heading">
        <SectionHeader
          title={<span id="linked-heading">Linked accounts</span>}
          description="Linking proves you published a video and grants read-only access to its metrics. VYRAL never posts on your behalf."
        />
        {data.socialMode === "mock" ? (
          <Notice className="mb-4">Demo mode: links are simulated. In production each platform uses its official OAuth flow.</Notice>
        ) : data.socialMode === "closed" ? (
          <Notice className="mb-4">Account linking opens together with video submissions. Each platform connects through its official sign-in.</Notice>
        ) : null}
        <Table minWidth={560}>
          <THead>
            <TH>Platform</TH>
            <TH>Account</TH>
            <TH>Verified</TH>
            <TH align="right">Action</TH>
          </THead>
          <tbody>
            {PLATFORMS.map((p) => {
              const acc = data.linked.find((a) => a.platform === p) ?? null;
              return (
                <TR key={p}>
                  <TD className="text-ink">{PLATFORM_LABEL[p]}</TD>
                  <TD className={acc ? "text-ink-2" : "text-ink-4"}>{acc ? `@${acc.handle}` : "Not linked"}</TD>
                  <TD className="text-ink-3">{acc ? `${acc.verificationMethod === "oauth" ? "OAuth" : "Simulated"} · ${timeAgo(acc.verifiedAt, now)}` : "—"}</TD>
                  <TD align="right">
                    <LinkAccountControl platform={p} mode={data.socialMode} oauthReady={data.oauth[p]} linkedId={acc?.id ?? null} />
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      </section>

      <section aria-labelledby="rewards-heading">
        <SectionHeader
          title={<span id="rewards-heading">Rewards</span>}
          description="Rewards are sent automatically. If a transfer can't be confirmed after several attempts, you can claim it here with a fresh wallet signature."
        />
        <Table minWidth={600}>
          <THead>
            <TH>Checkpoint</TH>
            <TH>Token</TH>
            <TH align="right">Amount</TH>
            <TH>Status</TH>
            <TH align="right">Action</TH>
          </THead>
          <tbody>
            {data.claimable.length + data.inFlight.length === 0 ? (
              <EmptyRow colSpan={5}>No rewards need your attention. Paid rewards are listed on your public profile.</EmptyRow>
            ) : null}
            {[...data.claimable, ...data.inFlight].map((p) => (
              <TR key={p.id}>
                <TD className="text-ink-2">{dateTimeUtc(p.scheduledAt)}</TD>
                <TD>
                  <Link href={`/competitions/${p.mint}`} className="text-ink hover:text-accent">
                    ${p.symbol}
                  </Link>
                </TD>
                <TD align="right" numeric className="font-medium text-ink">
                  {sol(p.amountLamports)}
                </TD>
                <TD>
                  <PayoutStatus status={p.status} />
                </TD>
                <TD align="right">{p.status === "requires_attention" ? <ClaimButton payoutId={p.id} /> : <span className="text-[12px] text-ink-3">In progress</span>}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </section>

      <section aria-labelledby="disputes-heading">
        <SectionHeader title={<span id="disputes-heading">Disputes</span>} description="Disagree with a review, a score or a payout? Open a dispute; every resolution is logged." />
        {data.disputes.length > 0 ? (
          <ul className="mb-8 divide-y divide-edge rounded-lg border border-edge">
            {data.disputes.map((d) => (
              <li key={d.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13.5px] text-ink">
                    {CATEGORY_LABEL[d.category] ?? d.category}
                    {d.symbol ? <span className="text-ink-3"> · ${d.symbol}</span> : null}
                  </span>
                  <StatusBadge tone={d.status === "open" ? "warning" : d.status === "resolved" ? "positive" : "neutral"}>
                    {d.status === "open" ? "Open" : d.status === "resolved" ? "Resolved" : "Declined"}
                  </StatusBadge>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{d.message}</p>
                {d.resolution ? <p className="mt-2 border-l-2 border-edge-strong pl-3 text-[13px] leading-relaxed text-ink-2">{d.resolution}</p> : null}
                <p className="mt-2 text-[12px] text-ink-4">Opened {timeAgo(d.createdAt, now)}</p>
              </li>
            ))}
          </ul>
        ) : null}
        <DisputeForm
          videos={data.videos.map((v) => ({
            id: v.id,
            label: `$${v.symbol} · ${PLATFORM_LABEL[v.platform]} @${v.authorHandle ?? "video"} · ${
              v.status === "rejected" ? STATUS_REASON_LABEL[v.statusReason ?? ""] ?? "Rejected" : v.status === "under_review" ? "Under review" : "Verified"
            }`,
          }))}
        />
      </section>
      <p className="text-[12px] text-ink-4">Signed in as {shortAddress(viewer.wallet, 6)}.</p>
    </div>
  );
}

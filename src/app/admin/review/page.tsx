import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { ActionButton, AccessDenied } from "@/components/admin/admin-ui";
import { AdminHeader } from "@/components/admin/admin-page";
import { STATUS_REASON_LABEL, VideoStatus } from "@/components/competition/status";
import { StatusBadge, type Tone } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/misc";
import { PlatformTag } from "@/components/ui/platform";
import { TabLinks } from "@/components/ui/segmented";
import { requireRole } from "@/lib/auth/admin";
import { SIGNAL_LABEL, type FraudSignal } from "@/lib/fraud/detectors";
import { compactNumber, dateTimeUtc, score, shortAddress, timeAgo } from "@/lib/format";
import { listReviewQueue } from "@/lib/queries/admin";

const SEVERITY_TONE: Record<string, Tone> = { high: "negative", medium: "warning", low: "neutral" };

export default function ReviewPage(props: PageProps<"/admin/review">) {
  return (
    <>
      <AdminHeader
        title="Review queue"
        description="Videos routed to review by automated checks. Verifying dismisses their flags; rejecting confirms them. Both require a note and are audit-logged."
      />
      <Suspense fallback={<Skeleton className="h-[520px] w-full" />}>
        <Queue searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Queue({ searchParams }: Pick<PageProps<"/admin/review">, "searchParams">) {
  const auth = await requireRole("reviewer");
  if (!auth.ok) return <AccessDenied signedIn={Boolean(auth.viewer)} />;
  const sp = await searchParams;
  const scope = sp.scope === "recent" ? "recent" : "queue";
  const items = await listReviewQueue(scope);
  const now = new Date();

  return (
    <div className="animate-fade-in">
      <TabLinks
        ariaLabel="Review scope"
        className="mb-6"
        items={[
          { label: "Awaiting review", href: "/admin/review", active: scope === "queue" },
          { label: "Recently reviewed", href: "/admin/review?scope=recent", active: scope === "recent" },
        ]}
      />
      {items.length === 0 ? (
        <p className="rounded-lg border border-edge px-6 py-12 text-center text-[13.5px] text-ink-3">
          {scope === "queue" ? "The review queue is empty." : "No manual reviews yet."}
        </p>
      ) : null}
      <ul className="flex flex-col gap-4">
        {items.map((v) => (
          <li key={v.id} className="rounded-lg border border-edge">
            <div className="flex flex-col gap-4 border-b border-edge px-5 py-4 md:flex-row md:items-center md:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <PlatformTag platform={v.platform} />
                <div className="min-w-0">
                  <a href={v.canonicalUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-[14px] text-ink hover:text-accent">
                    {v.authorHandle ? `@${v.authorHandle}` : "Video"} <ArrowUpRight className="size-3 text-ink-3" />
                  </a>
                  <p className="text-[12.5px] text-ink-3">
                    <Link href={`/competitions/${v.mint}`} className="hover:text-ink">
                      ${v.symbol}
                    </Link>{" "}
                    ·{" "}
                    <Link href={`/creators/${v.creatorWallet}`} className="font-mono hover:text-ink">
                      {shortAddress(v.creatorWallet)}
                    </Link>{" "}
                    · submitted {timeAgo(v.submittedAt, now)} · published {dateTimeUtc(v.publishedAt)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {v.status === "under_review" ? (
                  <>
                    <ActionButton
                      label="Reject"
                      title="Reject video"
                      description="Rejected videos are removed from the leaderboard and can't win. Their flags are confirmed. The creator can dispute."
                      endpoint={`/api/admin/videos/${v.id}/review`}
                      body={{ decision: "reject" }}
                      variant="danger"
                      danger
                      noteLabel="Reason (shared with the creator on dispute)"
                    />
                    <ActionButton
                      label="Verify"
                      title="Verify video"
                      description="Verifying dismisses all open flags on this video. It becomes eligible for payouts if it meets the view threshold."
                      endpoint={`/api/admin/videos/${v.id}/review`}
                      body={{ decision: "verify" }}
                      variant="primary"
                    />
                  </>
                ) : (
                  <VideoStatus status={v.status} />
                )}
              </div>
            </div>
            <div className="grid gap-px bg-edge sm:grid-cols-5">
              {(
                [
                  ["Views", compactNumber(v.views)],
                  ["Likes", compactNumber(v.likes)],
                  ["Comments", compactNumber(v.comments)],
                  ["Viral Score", score(v.viralScore)],
                  ["Risk", `${v.riskScore} / 100`],
                ] as const
              ).map(([k, val]) => (
                <div key={k} className="bg-canvas px-5 py-3">
                  <p className="text-[12px] text-ink-3">{k}</p>
                  <p className="num mt-0.5 text-[14px] text-ink">{val}</p>
                </div>
              ))}
            </div>
            <ul className="divide-y divide-edge border-t border-edge">
              {v.flags.map((f) => (
                <li key={f.id} className="flex flex-col gap-1.5 px-5 py-3 sm:flex-row sm:items-start sm:gap-4">
                  <div className="w-[220px] shrink-0">
                    <StatusBadge tone={SEVERITY_TONE[f.severity]}>
                      {SIGNAL_LABEL[f.signal as FraudSignal] ?? f.signal} · {f.severity}
                    </StatusBadge>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-ink-2">{f.summary}</p>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[12px] text-ink-4 hover:text-ink-3">Evidence</summary>
                      <pre className="mt-2 overflow-x-auto rounded-md bg-raised p-3 font-mono text-[11.5px] leading-relaxed text-ink-3">
                        {JSON.stringify(f.evidence, null, 2)}
                      </pre>
                    </details>
                  </div>
                  <span className="shrink-0 text-[12px] text-ink-4">
                    {f.status !== "open" ? `${f.status} · ` : ""}
                    {timeAgo(f.createdAt, now)}
                  </span>
                </li>
              ))}
              {v.flags.length === 0 ? (
                <li className="px-5 py-3 text-[13px] text-ink-3">{STATUS_REASON_LABEL[v.statusReason ?? ""] ?? "No flags recorded."}</li>
              ) : null}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

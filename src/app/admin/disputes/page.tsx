import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AccessDenied, ActionButton } from "@/components/admin/admin-ui";
import { AdminHeader } from "@/components/admin/admin-page";
import { VideoStatus } from "@/components/competition/status";
import { StatusBadge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/misc";
import { TabLinks } from "@/components/ui/segmented";
import { requireRole } from "@/lib/auth/admin";
import { PLATFORM_SHORT } from "@/lib/domain/platforms";
import { shortAddress, timeAgo } from "@/lib/format";
import { listAdminDisputes } from "@/lib/queries/admin";

const CATEGORY: Record<string, string> = {
  video_rejected: "Video rejected or flagged",
  score_incorrect: "Metrics or score",
  payout_issue: "Payout",
  ownership: "Content ownership",
  other: "Other",
};

export default function AdminDisputesPage(props: PageProps<"/admin/disputes">) {
  return (
    <>
      <AdminHeader title="Disputes" description="Creator disputes about reviews, scores, payouts and ownership. Resolutions are visible to the creator and audit-logged." />
      <Suspense fallback={<Skeleton className="h-[400px] w-full" />}>
        <Disputes searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Disputes({ searchParams }: Pick<PageProps<"/admin/disputes">, "searchParams">) {
  const auth = await requireRole("reviewer");
  if (!auth.ok) return <AccessDenied signedIn={Boolean(auth.viewer)} />;
  const sp = await searchParams;
  const status = sp.status === "closed" ? "closed" : "open";
  const rows = await listAdminDisputes(status);
  const now = new Date();

  return (
    <div className="animate-fade-in">
      <TabLinks
        ariaLabel="Dispute status"
        className="mb-6"
        items={[
          { label: "Open", href: "/admin/disputes", active: status === "open" },
          { label: "Closed", href: "/admin/disputes?status=closed", active: status === "closed" },
        ]}
      />
      {rows.length === 0 ? <p className="rounded-lg border border-edge px-6 py-12 text-center text-[13.5px] text-ink-3">No {status} disputes.</p> : null}
      <ul className="flex flex-col gap-4">
        {rows.map((d) => (
          <li key={d.id} className="rounded-lg border border-edge px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-[13.5px] text-ink">
                {CATEGORY[d.category] ?? d.category}
                <span className="text-ink-3">
                  {" "}
                  · from{" "}
                  <Link href={`/creators/${d.wallet}`} className="font-mono hover:text-ink">
                    {shortAddress(d.wallet)}
                  </Link>{" "}
                  · {timeAgo(d.createdAt, now)}
                </span>
              </div>
              {d.status === "open" ? (
                <span className="inline-flex gap-1.5">
                  <ActionButton
                    label="Decline"
                    title="Decline dispute"
                    endpoint={`/api/admin/disputes/${d.id}`}
                    body={{ status: "rejected" }}
                    noteField="resolution"
                    noteLabel="Response to the creator"
                    minNote={5}
                    variant="ghost"
                  />
                  <ActionButton
                    label="Resolve"
                    title="Resolve dispute"
                    description="Record what was changed. To reinstate a video, verify it from the review queue first."
                    endpoint={`/api/admin/disputes/${d.id}`}
                    body={{ status: "resolved" }}
                    noteField="resolution"
                    noteLabel="Resolution (shared with the creator)"
                    minNote={5}
                    variant="primary"
                  />
                </span>
              ) : (
                <StatusBadge tone={d.status === "resolved" ? "positive" : "neutral"}>{d.status === "resolved" ? "Resolved" : "Declined"}</StatusBadge>
              )}
            </div>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{d.message}</p>
            {d.videoId && d.canonicalUrl ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-raised px-3 py-2 text-[12.5px]">
                <span className="text-ink-3">{d.platform ? PLATFORM_SHORT[d.platform] : "Video"}</span>
                <a href={d.canonicalUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-ink-2 hover:text-ink">
                  {d.authorHandle ? `@${d.authorHandle}` : "Open video"} <ArrowUpRight className="size-3" />
                </a>
                {d.symbol ? (
                  <Link href={`/competitions/${d.mint}`} className="text-ink-2 hover:text-ink">
                    ${d.symbol}
                  </Link>
                ) : null}
                {d.videoStatus ? <VideoStatus status={d.videoStatus} /> : null}
              </div>
            ) : null}
            {d.resolution ? (
              <p className="mt-3 border-l-2 border-edge-strong pl-3 text-[13px] text-ink-2">
                {d.resolution}
                <span className="block text-[12px] text-ink-4">
                  {d.resolvedBy ? shortAddress(d.resolvedBy) : ""} · {d.resolvedAt ? timeAgo(d.resolvedAt, now) : ""}
                </span>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

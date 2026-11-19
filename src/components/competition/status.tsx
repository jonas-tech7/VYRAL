import { StatusBadge } from "@/components/ui/badge";
import type { IneligibilityReason } from "@/lib/rewards/allocation";
import { compactNumber } from "@/lib/format";

export function CompetitionStatus({ status }: { status: "active" | "paused" | "ended" }) {
  if (status === "active")
    return (
      <StatusBadge tone="positive" pulse>
        Active
      </StatusBadge>
    );
  if (status === "paused") return <StatusBadge tone="warning">Paused</StatusBadge>;
  return <StatusBadge tone="neutral">Ended</StatusBadge>;
}

export function VideoStatus({ status }: { status: "verified" | "under_review" | "rejected" | string }) {
  if (status === "verified") return <StatusBadge tone="positive">Verified</StatusBadge>;
  if (status === "under_review") return <StatusBadge tone="warning">Under review</StatusBadge>;
  return <StatusBadge tone="negative">Rejected</StatusBadge>;
}

const REASON_LABEL: Record<IneligibilityReason, string> = {
  not_verified: "Pending review",
  below_min_views: "Not yet eligible",
  open_flags: "Flagged",
  creator_banned: "Suspended",
  published_before_launch: "Pre-launch",
  submitted_after_checkpoint: "Next checkpoint",
  excluded_wallet: "Deployer",
};

/** Eligibility for payouts at the next checkpoint. */
export function Eligibility({ reason, views, minViews }: { reason: IneligibilityReason | null; views: number; minViews: number }) {
  if (!reason) return <span className="text-[12.5px] text-ink">Eligible</span>;
  if (reason === "below_min_views") {
    const pct = Math.min(100, (views / Math.max(minViews, 1)) * 100);
    return (
      <span className="inline-flex items-center gap-2 text-[12.5px] text-ink-3" title={`${compactNumber(views)} of ${compactNumber(minViews)} verified views`}>
        <span className="relative h-1 w-10 overflow-hidden rounded-full bg-overlay-2" aria-hidden>
          <span className="absolute inset-y-0 left-0 rounded-full bg-ink-3" style={{ width: `${pct}%` }} />
        </span>
        {REASON_LABEL[reason]}
      </span>
    );
  }
  return <span className="text-[12.5px] text-ink-3">{REASON_LABEL[reason]}</span>;
}

export const STATUS_REASON_LABEL: Record<string, string> = {
  flagged_for_review: "Flagged by automated checks",
  rejected_by_review: "Rejected after manual review",
  published_before_launch: "Published before the token launch",
  pending_verification: "Awaiting platform verification",
};

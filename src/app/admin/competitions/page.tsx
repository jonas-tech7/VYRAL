import Link from "next/link";
import { Suspense } from "react";
import { AccessDenied, ActionButton } from "@/components/admin/admin-ui";
import { AdminHeader } from "@/components/admin/admin-page";
import { CompetitionStatus } from "@/components/competition/status";
import { Skeleton } from "@/components/ui/misc";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/admin";
import { getAllConfig } from "@/lib/config/store";
import { dateTimeUtc, fullNumber, sol, usd } from "@/lib/format";
import { listAdminCompetitions } from "@/lib/queries/admin";

export default function AdminCompetitionsPage() {
  return (
    <>
      <AdminHeader title="Competitions" description="Pause or resume competitions, adjust payout intervals and eligibility, and roll out reward-curve changes. Every change is audit-logged." />
      <Suspense fallback={<Skeleton className="h-[520px] w-full" />}>
        <Competitions />
      </Suspense>
    </>
  );
}

async function Competitions() {
  const auth = await requireRole("admin");
  if (!auth.ok) return <AccessDenied signedIn={Boolean(auth.viewer)} />;
  const [rows, cfg] = await Promise.all([listAdminCompetitions(), getAllConfig()]);
  const intervals = cfg.payouts.value.allowedIntervalsHours.map((h) => ({ value: String(h), label: `Every ${h} hours` }));

  return (
    <div className="animate-fade-in">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-edge px-5 py-4">
        <p className="text-[13px] text-ink-2">
          Global reward curve: <span className="text-ink">v{cfg.reward_curve.version}</span>. Competitions keep the curve they launched with until you apply a newer one.
        </p>
        <ActionButton
          label="Apply global curve to all"
          title="Apply the global reward curve"
          description={`Replaces the reward curve of every active and paused competition with global v${cfg.reward_curve.version}. Upcoming checkpoints use it immediately.`}
          endpoint="/api/admin/competitions/apply-curve"
          minNote={10}
        />
      </div>
      <Table minWidth={1100}>
        <THead>
          <TH>Token</TH>
          <TH align="right">Market cap</TH>
          <TH align="right">Unallocated</TH>
          <TH align="right">Videos</TH>
          <TH>Rules</TH>
          <TH>Next checkpoint</TH>
          <TH align="right">Status</TH>
          <TH align="right">Actions</TH>
        </THead>
        <tbody>
          {rows.map((c) => (
            <TR key={c.id}>
              <TD>
                <Link href={`/competitions/${c.mint}`} className="text-ink hover:text-accent">
                  {c.name} <span className="text-ink-3">${c.symbol}</span>
                </Link>
                {c.pausedReason ? <span className="block max-w-[260px] truncate text-[12px] text-warning">{c.pausedReason}</span> : null}
              </TD>
              <TD align="right" numeric className="text-ink-2">
                {usd(c.marketCapUsd, { compact: true })}
              </TD>
              <TD align="right" numeric className="text-ink-2">
                {sol(c.unallocatedLamports)}
              </TD>
              <TD align="right" numeric className="text-ink-2">
                {c.videos}
                {c.inReview ? <span className="block text-[11.5px] text-warning">{c.inReview} in review</span> : null}
              </TD>
              <TD className="text-[12.5px] text-ink-3">
                {c.payoutIntervalHours}h · {fullNumber(c.minEligibleViews)} views · curve v{c.rulesConfigVersion}
              </TD>
              <TD className="text-ink-3">{c.status === "active" ? dateTimeUtc(c.nextCheckpointAt) : "—"}</TD>
              <TD align="right">
                <CompetitionStatus status={c.status} />
              </TD>
              <TD align="right">
                {c.status === "ended" ? (
                  <span className="text-[12px] text-ink-4">—</span>
                ) : (
                  <span className="inline-flex gap-1.5">
                    {c.status === "active" ? (
                      <ActionButton
                        label="Pause"
                        title={`Pause $${c.symbol}`}
                        description="No new entries; checkpoints are skipped and fees roll over until resumed. The reason is shown publicly on the competition page."
                        endpoint={`/api/admin/competitions/${c.id}/status`}
                        body={{ status: "paused" }}
                        noteField="reason"
                        noteLabel="Public reason"
                      />
                    ) : (
                      <ActionButton
                        label="Resume"
                        title={`Resume $${c.symbol}`}
                        endpoint={`/api/admin/competitions/${c.id}/status`}
                        body={{ status: "active" }}
                        noteField="reason"
                        noteLabel="Reason"
                        variant="primary"
                      />
                    )}
                    <ActionButton
                      label="Interval"
                      title={`Payout interval for $${c.symbol}`}
                      description="The cadence re-anchors from now, so no checkpoint is skipped or doubled."
                      endpoint={`/api/admin/competitions/${c.id}/rules`}
                      method="PATCH"
                      fields={[{ kind: "select", name: "payoutIntervalHours", label: "Interval", options: intervals, numeric: true }]}
                      variant="ghost"
                    />
                  </span>
                )}
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

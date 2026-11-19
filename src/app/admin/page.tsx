import Link from "next/link";
import { Suspense } from "react";
import { AccessDenied } from "@/components/admin/admin-ui";
import { AdminHeader } from "@/components/admin/admin-page";
import { StatusBadge } from "@/components/ui/badge";
import { Skeleton, SectionHeader } from "@/components/ui/misc";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/admin";
import { isDemoMode } from "@/lib/env";
import { fullNumber, sol, timeAgo } from "@/lib/format";
import { getAdminOverview } from "@/lib/queries/admin";

export default function AdminOverviewPage() {
  return (
    <>
      <AdminHeader title="Overview" description="Queues that need a human, money in motion, and the health of background jobs." />
      <Suspense fallback={<Skeleton className="h-[520px] w-full" />}>
        <Overview />
      </Suspense>
    </>
  );
}

const JOB_LABEL: Record<string, string> = {
  "sample-prices": "Price sampling",
  "sync-fees": "Fee observation",
  "sync-metrics": "Metric sync",
  checkpoints: "Checkpoints",
  payouts: "Payout execution",
  maintenance: "Maintenance",
};

async function Overview() {
  const auth = await requireRole("reviewer");
  if (!auth.ok) return <AccessDenied signedIn={Boolean(auth.viewer)} />;
  const o = await getAdminOverview();
  const now = new Date();

  return (
    <div className="flex animate-fade-in flex-col gap-12">
      <section>
        <SectionHeader title="Needs attention" />
        <StatGrid cols={4}>
          <Stat label="Review queue" value={<Link href="/admin/review" className="hover:text-accent">{fullNumber(o.reviewQueue)}</Link>} sub={`${o.openFlags} open medium/high flags`} />
          <Stat label="Open disputes" value={<Link href="/admin/disputes" className="hover:text-accent">{fullNumber(o.openDisputes)}</Link>} sub="Awaiting a resolution" />
          <Stat
            label="Payouts needing attention"
            value={<Link href="/admin/payouts" className="hover:text-accent">{fullNumber(o.payoutsAttention)}</Link>}
            sub="Automatic attempts exhausted"
          />
          <Stat label="Paused competitions" value={<Link href="/admin/competitions" className="hover:text-accent">{fullNumber(o.pausedCompetitions)}</Link>} sub={`${o.activeCompetitions} active`} />
        </StatGrid>
      </section>

      <section>
        <SectionHeader title="Money" description="Fee and payout amounts are confirmed on-chain values unless marked pending." />
        <StatGrid cols={3}>
          <Stat label="Unallocated confirmed fees" value={sol(o.unallocatedLamports)} sub="Rolls into the next checkpoints" />
          <Stat label="Pending fees" value={sol(o.pendingFeesLamports)} sub="Not counted until finalized" />
          <Stat label="Outstanding payouts" value={sol(o.payoutsOutstandingLamports)} sub={`${o.payoutsInflight} in flight`} />
          <Stat label="Fees collected (24h)" value={sol(o.fees24hLamports)} />
          <Stat label="Rewards paid (24h)" value={sol(o.paid24hLamports)} />
          <Stat label="Checkpoints (24h)" value={fullNumber(o.checkpoints24h)} />
        </StatGrid>
      </section>

      <section>
        <SectionHeader
          title="Background jobs"
          description={isDemoMode ? "Running against demonstration providers." : "Running against live providers."}
        />
        <Table minWidth={640}>
          <THead>
            <TH>Job</TH>
            <TH>Last run</TH>
            <TH>Result</TH>
            <TH align="right">Status</TH>
          </THead>
          <tbody>
            {o.jobs.length === 0 ? (
              <TR>
                <TD colSpan={4} className="text-ink-3">
                  The worker hasn&apos;t run yet. Start it with <code className="font-mono text-[12px]">npm run worker</code>.
                </TD>
              </TR>
            ) : null}
            {o.jobs.map((j) => {
              const stale = now.getTime() - j.startedAt.getTime() > 10 * 60_000 && j.job !== "maintenance";
              return (
                <TR key={j.job}>
                  <TD className="text-ink">{JOB_LABEL[j.job] ?? j.job}</TD>
                  <TD className="text-ink-2">{timeAgo(j.startedAt, now)}</TD>
                  <TD className="max-w-[360px] truncate font-mono text-[12px] text-ink-3">
                    {Object.entries(j.detail)
                      .filter(([k]) => k !== "ms")
                      .map(([k, v]) => `${k}=${typeof v === "object" ? "…" : String(v)}`)
                      .join(" ") || "—"}
                  </TD>
                  <TD align="right">
                    {j.status === "error" ? (
                      <StatusBadge tone="negative">Error</StatusBadge>
                    ) : stale ? (
                      <StatusBadge tone="warning">Stale</StatusBadge>
                    ) : j.status === "running" ? (
                      <StatusBadge tone="neutral">Running</StatusBadge>
                    ) : (
                      <StatusBadge tone="positive">Healthy</StatusBadge>
                    )}
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      </section>
    </div>
  );
}

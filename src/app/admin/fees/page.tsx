import Link from "next/link";
import { Suspense } from "react";
import { AccessDenied } from "@/components/admin/admin-ui";
import { AdminHeader } from "@/components/admin/admin-page";
import { Skeleton } from "@/components/ui/misc";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/admin";
import { sol, timeAgo } from "@/lib/format";
import { listFeesByToken } from "@/lib/queries/admin";

export default function AdminFeesPage() {
  return (
    <>
      <AdminHeader
        title="Creator fees"
        description="Collected fees per token. Confirmed = collected + allocated (rewarded + retained) + unallocated. Pending fees are never used until finalized."
      />
      <Suspense fallback={<Skeleton className="h-[520px] w-full" />}>
        <Fees />
      </Suspense>
    </>
  );
}

async function Fees() {
  const auth = await requireRole("admin");
  if (!auth.ok) return <AccessDenied signedIn={Boolean(auth.viewer)} />;
  const rows = await listFeesByToken();
  const now = new Date();
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const confirmed = sum("confirmedLamports");
  const rewarded = sum("rewardedLamports");
  const retained = sum("retainedLamports");
  const unallocated = sum("unallocatedLamports");
  const balanced = confirmed === rewarded + retained + unallocated;

  return (
    <div className="flex animate-fade-in flex-col gap-8">
      <StatGrid cols={5}>
        <Stat label="Confirmed fees" value={sol(confirmed)} />
        <Stat label="Allocated to rewards" value={sol(rewarded)} />
        <Stat label="Retained by deployers" value={sol(retained)} />
        <Stat label="Unallocated" value={sol(unallocated)} />
        <Stat label="Reconciliation" value={balanced ? "Balanced" : "Mismatch"} sub={balanced ? "confirmed = allocated + unallocated" : "Investigate before the next checkpoint"} />
      </StatGrid>
      <Table minWidth={900}>
        <THead>
          <TH>Token</TH>
          <TH align="right">Confirmed</TH>
          <TH align="right">Pending</TH>
          <TH align="right">To rewards</TH>
          <TH align="right">Retained</TH>
          <TH align="right">Unallocated</TH>
          <TH align="right">Last fee</TH>
        </THead>
        <tbody>
          {rows.map((r) => (
            <TR key={r.mint}>
              <TD>
                <Link href={`/competitions/${r.mint}`} className="text-ink hover:text-accent">
                  ${r.symbol}
                </Link>
              </TD>
              <TD align="right" numeric className="text-ink">
                {sol(r.confirmedLamports)}
              </TD>
              <TD align="right" numeric className="text-ink-3">
                {sol(r.pendingLamports)}
              </TD>
              <TD align="right" numeric className="text-ink-2">
                {sol(r.rewardedLamports)}
              </TD>
              <TD align="right" numeric className="text-ink-2">
                {sol(r.retainedLamports)}
              </TD>
              <TD align="right" numeric className="text-ink">
                {sol(r.unallocatedLamports)}
              </TD>
              <TD align="right" className="text-ink-3">
                {r.lastFeeAt ? timeAgo(r.lastFeeAt, now) : "—"}
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

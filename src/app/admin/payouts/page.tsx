import Link from "next/link";
import { Suspense } from "react";
import { AccessDenied, ActionButton } from "@/components/admin/admin-ui";
import { AdminHeader } from "@/components/admin/admin-page";
import { PayoutStatus, TxSignature } from "@/components/competition/tx";
import { Skeleton } from "@/components/ui/misc";
import { TabLinks } from "@/components/ui/segmented";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/admin";
import { bpsToPct, dateTimeUtc, shortAddress, sol, timeAgo, usd } from "@/lib/format";
import { listAdminPayouts, PAYOUT_FILTERS, type PayoutFilter } from "@/lib/queries/admin";

const LABEL: Record<PayoutFilter, string> = { attention: "Needs attention", inflight: "In flight", confirmed: "Confirmed", voided: "Voided", all: "All" };

export default function AdminPayoutsPage(props: PageProps<"/admin/payouts">) {
  return (
    <>
      <AdminHeader
        title="Payouts"
        description="Every transfer attempt is persisted before broadcast; a new attempt is only built once the previous one is provably final. Manual actions are verified and logged."
      />
      <Suspense fallback={<Skeleton className="h-[520px] w-full" />}>
        <Payouts searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Payouts({ searchParams }: Pick<PageProps<"/admin/payouts">, "searchParams">) {
  const auth = await requireRole("admin");
  if (!auth.ok) return <AccessDenied signedIn={Boolean(auth.viewer)} />;
  const sp = await searchParams;
  const filter = (PAYOUT_FILTERS as readonly string[]).includes(String(sp.filter)) ? (sp.filter as PayoutFilter) : "attention";
  const rows = await listAdminPayouts(filter);
  const now = new Date();

  return (
    <div className="animate-fade-in">
      <TabLinks
        ariaLabel="Payout status"
        className="mb-6"
        items={PAYOUT_FILTERS.map((f) => ({ label: LABEL[f], href: `/admin/payouts?filter=${f}`, active: f === filter }))}
      />
      <Table minWidth={1100}>
        <THead>
          <TH>Checkpoint</TH>
          <TH>Token</TH>
          <TH>Recipient</TH>
          <TH align="right">Amount</TH>
          <TH align="right">Share · Mcap</TH>
          <TH>Attempts</TH>
          <TH>Transaction</TH>
          <TH align="right">Status</TH>
          <TH align="right">Actions</TH>
        </THead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={9}>Nothing here.</EmptyRow> : null}
          {rows.map((p) => (
            <TR key={p.id}>
              <TD className="text-ink-2">
                {dateTimeUtc(p.scheduledAt)}
                <span className="block text-[12px] text-ink-4">updated {timeAgo(p.updatedAt, now)}</span>
              </TD>
              <TD>
                <Link href={`/competitions/${p.mint}`} className="text-ink hover:text-accent">
                  ${p.symbol}
                </Link>
              </TD>
              <TD>
                <Link href={`/creators/${p.recipientWallet}`} className="font-mono text-[12.5px] text-ink-2 hover:text-ink">
                  {shortAddress(p.recipientWallet)}
                </Link>
              </TD>
              <TD align="right" numeric className="font-medium text-ink">
                {sol(p.amountLamports)}
              </TD>
              <TD align="right" numeric className="text-ink-3">
                {p.rewardBps !== null ? bpsToPct(p.rewardBps) : "—"} · {p.referenceMarketCapUsd ? usd(p.referenceMarketCapUsd, { compact: true }) : "—"}
              </TD>
              <TD className="whitespace-normal text-[12px] text-ink-3">
                {p.attemptCount}/{p.autoAttemptBudget}
                {p.lastError ? <span className="block max-w-[220px] text-warning">{p.lastError}</span> : null}
                {p.resolution && p.resolution !== "automatic" ? <span className="block text-ink-2">via {p.resolution.replace("_", " ")}</span> : null}
              </TD>
              <TD>
                <TxSignature signature={p.signature ?? p.attempts[p.attempts.length - 1]?.signature ?? null} simulated={p.isSimulated} />
              </TD>
              <TD align="right">
                <PayoutStatus status={p.status} />
              </TD>
              <TD align="right">
                {p.status === "requires_attention" || p.status === "pending" ? (
                  <span className="inline-flex gap-1.5">
                    {p.status === "requires_attention" ? (
                      <ActionButton
                        label="Retry"
                        title="Retry payout"
                        description="Queues new automatic attempts to the same recipient. Only allowed when no attempt is in flight."
                        endpoint={`/api/admin/payouts/${p.id}/retry`}
                      />
                    ) : null}
                    <ActionButton
                      label="Settle"
                      title="Settle with an external transfer"
                      description="Paste the signature of a transfer you made outside the automatic flow. It is verified on-chain (finalized, to this recipient, at least this amount) before the payout is marked paid."
                      endpoint={`/api/admin/payouts/${p.id}/settle`}
                      fields={[{ kind: "text", name: "signature", label: "Transaction signature", placeholder: "5Ksx…", required: true, mono: true }]}
                      minNote={10}
                    />
                    <ActionButton
                      label="Void"
                      title="Void payout"
                      description="Cancels this payout and returns its fees to the competition pool for the next checkpoint."
                      endpoint={`/api/admin/payouts/${p.id}/void`}
                      variant="ghost"
                      danger
                      minNote={10}
                    />
                  </span>
                ) : (
                  <span className="text-[12px] text-ink-4">—</span>
                )}
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

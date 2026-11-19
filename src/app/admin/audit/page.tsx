import { Suspense } from "react";
import { AccessDenied } from "@/components/admin/admin-ui";
import { AdminHeader } from "@/components/admin/admin-page";
import { Skeleton } from "@/components/ui/misc";
import { Pagination, SearchForm } from "@/components/ui/search";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/admin";
import { dateTimeUtc, shortAddress } from "@/lib/format";
import { listAuditLog } from "@/lib/queries/admin";

export default function AuditPage(props: PageProps<"/admin/audit">) {
  return (
    <>
      <AdminHeader
        title="Audit log"
        description="Append-only record of every sensitive action. Updates and deletions are rejected by the database itself."
      />
      <Suspense fallback={<Skeleton className="h-[520px] w-full" />}>
        <Audit searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Audit({ searchParams }: Pick<PageProps<"/admin/audit">, "searchParams">) {
  const auth = await requireRole("admin");
  if (!auth.ok) return <AccessDenied signedIn={Boolean(auth.viewer)} />;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total } = await listAuditLog({ q: q || undefined, page });

  return (
    <div className="animate-fade-in">
      <div className="mb-5 flex justify-end">
        <SearchForm action="/admin/audit" defaultValue={q} placeholder="Filter by action, actor or target" />
      </div>
      <Table minWidth={980}>
        <THead>
          <TH>Time</TH>
          <TH>Actor</TH>
          <TH>Action</TH>
          <TH>Target</TH>
          <TH>Note</TH>
          <TH>Change</TH>
        </THead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={6}>No entries.</EmptyRow> : null}
          {rows.map((r) => (
            <TR key={r.id}>
              <TD className="align-top text-ink-2">{dateTimeUtc(r.createdAt)}</TD>
              <TD className="align-top font-mono text-[12px] text-ink-2">
                {r.actor.startsWith("system:") || r.actor.startsWith("cli:") ? r.actor : shortAddress(r.actor)}
                {r.actorRole ? <span className="block font-sans text-[11.5px] text-ink-4">{r.actorRole}</span> : null}
              </TD>
              <TD className="align-top font-mono text-[12px] text-ink">{r.action}</TD>
              <TD className="align-top text-[12px] text-ink-3">
                {r.targetType}
                {r.targetId ? <span className="block max-w-[180px] truncate font-mono">{r.targetId}</span> : null}
              </TD>
              <TD className="max-w-[240px] whitespace-normal align-top text-[12.5px] text-ink-2">{r.note ?? "—"}</TD>
              <TD className="align-top">
                {r.before || r.after ? (
                  <details>
                    <summary className="cursor-pointer text-[12px] text-ink-3 hover:text-ink">View</summary>
                    <div className="mt-2 grid max-w-[420px] gap-2">
                      {r.before ? (
                        <pre className="overflow-x-auto rounded-md bg-raised p-2 font-mono text-[11px] text-ink-3">− {JSON.stringify(r.before, null, 1)}</pre>
                      ) : null}
                      {r.after ? (
                        <pre className="overflow-x-auto rounded-md bg-raised p-2 font-mono text-[11px] text-ink-2">+ {JSON.stringify(r.after, null, 1)}</pre>
                      ) : null}
                    </div>
                  </details>
                ) : (
                  <span className="text-ink-4">—</span>
                )}
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      <Pagination page={page} total={total} pageSize={50} href={(p) => `/admin/audit?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`} />
    </div>
  );
}

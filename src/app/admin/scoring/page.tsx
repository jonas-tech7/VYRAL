import { connection } from "next/server";
import { Suspense } from "react";
import { AccessDenied, ActionButton } from "@/components/admin/admin-ui";
import { AdminHeader } from "@/components/admin/admin-page";
import { ScoringEditor } from "@/components/admin/scoring-editor";
import { Notice, Skeleton } from "@/components/ui/misc";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/admin";
import { getConfig } from "@/lib/config/store";
import { isDemoMode } from "@/lib/env";
import { PLATFORM_LABEL, PLATFORMS } from "@/lib/domain/platforms";
import { dateTimeUtc, shortAddress } from "@/lib/format";
import { listConfigHistory } from "@/lib/queries/admin";
import { composeWithView } from "@/lib/scoring/calibration";
import { computeCalibration } from "@/lib/services/admin";

export default function AdminScoringPage() {
  return (
    <>
      <AdminHeader title="Viral Score" description="Scoring weights, normalisation, engagement caps and platform multipliers — with data-driven calibration." />
      <Suspense fallback={<Skeleton className="h-[720px] w-full" />}>
        <Scoring />
      </Suspense>
    </>
  );
}

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(2)}%`);

async function Scoring() {
  await connection();
  const auth = await requireRole("admin");
  if (!auth.ok) return <AccessDenied signedIn={Boolean(auth.viewer)} />;
  const [cfg, calibration, history] = await Promise.all([getConfig("scoring"), computeCalibration(), listConfigHistory("scoring")]);

  return (
    <div className="flex animate-fade-in flex-col gap-10">
      <ScoringEditor initial={cfg.value} version={cfg.version} />

      <section className="rounded-lg border border-edge">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Calibration from verified history</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-3">
              Method {calibration.method} · {calibration.options.windowDays}-day window · ≥ {calibration.options.minSamples} videos per platform · shrinkage K=
              {calibration.options.shrinkageK}
            </p>
          </div>
          {calibration.usable ? (
            <ActionButton
              label="Apply calibrated multipliers"
              title="Apply calibrated like & comment multipliers"
              description="Updates like and comment multipliers for platforms with sufficient data (view multipliers are unchanged), saves a new scoring version and rescores active videos."
              endpoint="/api/admin/calibration/apply"
              variant="primary"
              minNote={10}
            />
          ) : null}
        </header>
        <div className="px-5 py-4">
          {isDemoMode ? (
            <Notice className="mb-4">
              Computed from demonstration data. The simulated platforms deliberately differ in engagement, so suggestions here illustrate the method — they are not
              benchmarks.
            </Notice>
          ) : null}
          {!calibration.usable ? (
            <p className="mb-4 text-[13px] text-ink-3">Not enough verified data across at least two platforms to calibrate yet.</p>
          ) : (
            <p className="mb-4 text-[13px] text-ink-2">
              Reference (median across platforms): like rate {pct(calibration.reference.likeRate)}, comment rate {pct(calibration.reference.commentRate)}.
            </p>
          )}
          <Table minWidth={760}>
            <THead>
              <TH>Platform</TH>
              <TH align="right">Videos</TH>
              <TH align="right">Median like rate</TH>
              <TH align="right">Like multiplier</TH>
              <TH align="right">Median comment rate</TH>
              <TH align="right">Comment multiplier</TH>
              <TH align="right">Current like / comment</TH>
            </THead>
            <tbody>
              {PLATFORMS.map((p) => {
                const c = calibration.platforms[p];
                const cur = cfg.value.multipliers[p];
                return (
                  <TR key={p}>
                    <TD className="text-ink">{PLATFORM_LABEL[p]}</TD>
                    <TD align="right" numeric className={c.sufficient ? "text-ink-2" : "text-ink-4"}>
                      {c.sampleSize}
                    </TD>
                    <TD align="right" numeric className="text-ink-2">
                      {pct(c.like.medianRate)}
                    </TD>
                    <TD align="right" numeric className="text-ink">
                      {c.like.suggested !== null ? composeWithView(cur.view, c.like.suggested).toFixed(3) : "—"}
                      {c.like.suggested !== null ? (
                        <span className="block text-[11.5px] text-ink-4">
                          rate {c.like.suggested.toFixed(3)} × view {cur.view.toFixed(2)}
                        </span>
                      ) : null}
                    </TD>
                    <TD align="right" numeric className="text-ink-2">
                      {pct(c.comment.medianRate)}
                    </TD>
                    <TD align="right" numeric className="text-ink">
                      {c.comment.suggested !== null ? composeWithView(cur.view, c.comment.suggested).toFixed(3) : "—"}
                      {c.comment.suggested !== null ? (
                        <span className="block text-[11.5px] text-ink-4">
                          rate {c.comment.suggested.toFixed(3)} × view {cur.view.toFixed(2)}
                        </span>
                      ) : null}
                    </TD>
                    <TD align="right" numeric className="text-ink-3">
                      {cur.like.toFixed(3)} / {cur.comment.toFixed(3)}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[15px] font-semibold text-ink">Version history</h2>
        <Table minWidth={560}>
          <THead>
            <TH>Version</TH>
            <TH>Saved</TH>
            <TH>By</TH>
            <TH>Note</TH>
          </THead>
          <tbody>
            {history.map((h) => (
              <TR key={h.version}>
                <TD className="font-mono text-[12.5px] text-ink">v{h.version}</TD>
                <TD className="text-ink-2">{dateTimeUtc(h.createdAt)}</TD>
                <TD className="font-mono text-[12px] text-ink-3">{h.updatedBy.includes(":") ? h.updatedBy : shortAddress(h.updatedBy)}</TD>
                <TD className="whitespace-normal text-ink-2">{h.note ?? "—"}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </section>
    </div>
  );
}

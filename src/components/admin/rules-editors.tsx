"use client";

import { Plus, X } from "lucide-react";
import { CurveChart } from "@/components/charts/curve-chart";
import { Button } from "@/components/ui/button";
import type { EligibilityConfig, FraudConfig, PayoutConfig, RewardCurveConfig } from "@/lib/config/schemas";
import { PLATFORM_LABEL, PLATFORMS } from "@/lib/domain/platforms";
import { ConfigForm, NumberInput } from "./config-form";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-edge py-3 last:border-b-0 sm:grid-cols-[1fr_200px] sm:items-center">
      <div>
        <p className="text-[13px] text-ink">{label}</p>
        {hint ? <p className="text-[12px] text-ink-3">{hint}</p> : null}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function RewardCurveEditor({ initial, version }: { initial: RewardCurveConfig; version: number }) {
  return (
    <ConfigForm<RewardCurveConfig>
      configKey="reward_curve"
      initial={initial}
      version={version}
      title="Reward curve"
      description="Share of newly confirmed creator fees paid to the winner, by reference market cap. New launches use the latest version."
      clientError={(c) => {
        for (let i = 1; i < c.points.length; i++) if (!(c.points[i].marketCapUsd > c.points[i - 1].marketCapUsd)) return "Market caps must increase from row to row.";
        if (c.points.some((p) => !(p.rewardBps >= 0 && p.rewardBps <= 10_000))) return "Shares must be between 0% and 100%.";
        return null;
      }}
    >
      {(c, set) => (
        <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
          <div>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[12px] text-ink-3">
                  <th className="pb-2 font-normal">Market cap (USD)</th>
                  <th className="pb-2 font-normal">Reward share</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {c.points.map((p, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-2">
                      <NumberInput label={`Point ${i + 1} market cap`} value={p.marketCapUsd} step={1000} onChange={(v) => set((x) => ((x.points[i].marketCapUsd = v), x))} />
                    </td>
                    <td className="py-1 pr-2">
                      <NumberInput
                        label={`Point ${i + 1} share`}
                        value={p.rewardBps / 100}
                        step={0.5}
                        suffix="%"
                        onChange={(v) => set((x) => ((x.points[i].rewardBps = Math.round(v * 100)), x))}
                      />
                    </td>
                    <td className="py-1 text-right">
                      <button
                        type="button"
                        aria-label="Remove point"
                        disabled={c.points.length <= 1}
                        onClick={() => set((x) => (x.points.splice(i, 1), x))}
                        className="inline-flex size-8 items-center justify-center rounded-md text-ink-3 hover:bg-overlay hover:text-ink disabled:opacity-30"
                      >
                        <X className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant="secondary"
                disabled={c.points.length >= 20}
                onClick={() =>
                  set((x) => {
                    const last = x.points[x.points.length - 1];
                    x.points.push({ marketCapUsd: (last?.marketCapUsd ?? 10_000) * 5, rewardBps: Math.max((last?.rewardBps ?? 1000) - 500, 0) });
                    return x;
                  })
                }
              >
                <Plus className="size-3.5" /> Add point
              </Button>
              <label className="flex items-center gap-2 text-[12.5px] text-ink-3">
                Interpolation
                <select
                  value={c.interpolation}
                  onChange={(e) => set((x) => ((x.interpolation = e.target.value as RewardCurveConfig["interpolation"]), x))}
                  className="h-8 rounded-md border border-edge-strong bg-raised px-2 text-[12.5px] text-ink"
                >
                  <option value="linear">Linear</option>
                  <option value="log">Log (market cap)</option>
                  <option value="step">Step</option>
                </select>
              </label>
            </div>
          </div>
          <div className="rounded-md border border-edge p-3">
            <CurveChart curve={c} height={210} label="Draft reward curve" />
          </div>
        </div>
      )}
    </ConfigForm>
  );
}

export function PayoutsEditor({ initial, version }: { initial: PayoutConfig; version: number }) {
  return (
    <ConfigForm<PayoutConfig>
      configKey="payouts"
      initial={initial}
      version={version}
      title="Payouts"
      description="Checkpoint cadence, reference-price rules and transaction policy."
      clientError={(p) => (!p.allowedIntervalsHours.includes(p.defaultIntervalHours) ? "The default interval must be one of the allowed intervals." : null)}
    >
      {(p, set) => (
        <div>
          <Row label="Allowed payout intervals" hint="Hours, comma-separated. Deployers choose one at launch.">
            <input
              aria-label="Allowed intervals"
              defaultValue={p.allowedIntervalsHours.join(", ")}
              onChange={(e) =>
                set((x) => {
                  x.allowedIntervalsHours = e.target.value
                    .split(",")
                    .map((s) => Number(s.trim()))
                    .filter((n) => Number.isInteger(n) && n > 0);
                  return x;
                })
              }
              className="h-9 w-full rounded-md border border-edge-strong bg-raised px-2.5 text-[13px] text-ink focus:border-accent/70 focus:outline-none"
            />
          </Row>
          <Row label="Default interval">
            <NumberInput label="Default interval" value={p.defaultIntervalHours} step={1} suffix="h" onChange={(v) => set((x) => ((x.defaultIntervalHours = v), x))} />
          </Row>
          <Row label="Minimum payout" hint="Smaller rewards roll over to the next checkpoint.">
            <NumberInput label="Minimum payout" value={p.minPayoutLamports / 1e9} step={0.001} suffix="SOL" onChange={(v) => set((x) => ((x.minPayoutLamports = Math.round(v * 1e9)), x))} />
          </Row>
          <Row label="TWAP window" hint="Reference market cap = time-weighted price × on-chain supply.">
            <NumberInput label="TWAP window" value={p.twapWindowMinutes} step={1} suffix="min" onChange={(v) => set((x) => ((x.twapWindowMinutes = v), x))} />
          </Row>
          <Row label="Minimum price observations">
            <NumberInput label="Minimum samples" value={p.minPriceSamples} step={1} onChange={(v) => set((x) => ((x.minPriceSamples = v), x))} />
          </Row>
          <Row label="Maximum price staleness">
            <NumberInput label="Max staleness" value={p.maxPriceStalenessMinutes} step={1} suffix="min" onChange={(v) => set((x) => ((x.maxPriceStalenessMinutes = v), x))} />
          </Row>
          <Row label="Automatic transaction attempts" hint="After this, payouts need attention (claim / retry / settle / void).">
            <NumberInput label="Attempt budget" value={p.autoAttemptBudget} step={1} onChange={(v) => set((x) => ((x.autoAttemptBudget = v), x))} />
          </Row>
          <Row label="Exclude token deployers from their own competition">
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              <input type="checkbox" checked={p.excludeDeployerFromRewards} onChange={(e) => set((x) => ((x.excludeDeployerFromRewards = e.target.checked), x))} className="accent-[#2cf59e]" />
              {p.excludeDeployerFromRewards ? "Excluded" : "Allowed"}
            </label>
          </Row>
        </div>
      )}
    </ConfigForm>
  );
}

export function EligibilityEditor({ initial, version }: { initial: EligibilityConfig; version: number }) {
  return (
    <ConfigForm<EligibilityConfig> configKey="eligibility" initial={initial} version={version} title="Eligibility" description="Applies to new launches; existing competitions keep their view threshold unless changed individually.">
      {(e, set) => (
        <div>
          <Row label="Minimum verified views for payouts">
            <NumberInput label="Minimum views" value={e.minVerifiedViews} step={500} onChange={(v) => set((x) => ((x.minVerifiedViews = v), x))} />
          </Row>
          <Row label="Entries per creator per competition">
            <NumberInput label="Max entries" value={e.maxSubmissionsPerCreatorPerCompetition} step={1} onChange={(v) => set((x) => ((x.maxSubmissionsPerCreatorPerCompetition = v), x))} />
          </Row>
          <Row label="Require a linked account (ownership proof)">
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              <input type="checkbox" checked={e.requireLinkedAccount} onChange={(ev) => set((x) => ((x.requireLinkedAccount = ev.target.checked), x))} className="accent-[#2cf59e]" />
              {e.requireLinkedAccount ? "Required" : "Not required"}
            </label>
          </Row>
        </div>
      )}
    </ConfigForm>
  );
}

export function FraudEditor({ initial, version }: { initial: FraudConfig; version: number }) {
  return (
    <ConfigForm<FraudConfig>
      configKey="fraud"
      initial={initial}
      version={version}
      title="Fraud detection"
      description="Thresholds only route videos to human review; they never reject on their own."
    >
      {(f, set) => (
        <div className="flex flex-col gap-6">
          <div>
            <Row label="Review threshold for accumulated low-severity signals" hint="Any medium or high flag always routes to review.">
              <NumberInput label="Review threshold" value={f.reviewRiskThreshold} step={5} onChange={(v) => set((x) => ((x.reviewRiskThreshold = v), x))} />
            </Row>
            <Row label="Severity weights (low / medium / high)">
              <div className="grid grid-cols-3 gap-1.5">
                {(["low", "medium", "high"] as const).map((k) => (
                  <NumberInput key={k} label={`${k} weight`} value={f.severityWeights[k]} step={5} onChange={(v) => set((x) => ((x.severityWeights[k] = v), x))} />
                ))}
              </div>
            </Row>
            <Row label="View spike multiple" hint="Interval rate vs the video's own prior median.">
              <NumberInput label="Spike multiple" value={f.spike.rateMultiple} step={0.5} suffix="×" onChange={(v) => set((x) => ((x.spike.rateMultiple = v), x))} />
            </Row>
            <Row label="Minimum new views for spike / decoupling checks">
              <NumberInput
                label="Minimum delta views"
                value={f.spike.minDeltaViews}
                step={1000}
                onChange={(v) =>
                  set((x) => {
                    x.spike.minDeltaViews = v;
                    x.decoupling.minDeltaViews = v;
                    return x;
                  })
                }
              />
            </Row>
            <Row label="Fingerprint match distance" hint="Hamming distance (of 64 bits) treated as the same footage.">
              <NumberInput label="Fingerprint distance" value={f.fingerprint.maxHammingDistance} step={1} onChange={(v) => set((x) => ((x.fingerprint.maxHammingDistance = v), x))} />
            </Row>
            <Row label="Submissions per wallet per 24h before flagging">
              <NumberInput label="Velocity" value={f.velocity.maxSubmissions24h} step={1} onChange={(v) => set((x) => ((x.velocity.maxSubmissions24h = v), x))} />
            </Row>
          </div>
          <div>
            <p className="text-[13px] font-medium text-ink">Engagement-ratio bounds by platform</p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead>
                  <tr className="text-left text-[12px] text-ink-3">
                    <th className="pb-2 font-normal">Platform</th>
                    <th className="pb-2 font-normal">Max likes/view</th>
                    <th className="pb-2 font-normal">Max comments/view</th>
                    <th className="pb-2 font-normal">Min likes/view</th>
                  </tr>
                </thead>
                <tbody>
                  {PLATFORMS.map((p) => (
                    <tr key={p}>
                      <td className="py-1 pr-2 text-ink">{PLATFORM_LABEL[p]}</td>
                      {(["maxLikesPerView", "maxCommentsPerView", "minLikesPerView"] as const).map((k) => (
                        <td key={k} className="py-1 pr-2">
                          <NumberInput label={`${p} ${k}`} value={f.ratioBounds[p][k]} step={0.001} onChange={(v) => set((x) => ((x.ratioBounds[p][k] = v), x))} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </ConfigForm>
  );
}

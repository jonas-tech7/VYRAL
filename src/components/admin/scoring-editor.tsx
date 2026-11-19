"use client";

import type { ScoringConfig } from "@/lib/config/schemas";
import { PLATFORM_LABEL, PLATFORMS, type Platform } from "@/lib/domain/platforms";
import { computeViralScore } from "@/lib/scoring/viral-score";
import { score } from "@/lib/format";
import { ConfigForm, NumberInput } from "./config-form";

const SAMPLE = { views: 120_000, likes: 9_000, comments: 300 };

export function ScoringEditor({ initial, version }: { initial: ScoringConfig; version: number }) {
  return (
    <ConfigForm<ScoringConfig>
      configKey="scoring"
      initial={initial}
      version={version}
      title="Viral Score parameters"
      description="Weights, normalisation and engagement caps. Saving rescores every video in active competitions."
      clientError={(d) => {
        const sum = d.weights.views + d.weights.likes + d.weights.comments;
        if (Math.abs(sum - 100) > 1e-6) return `Weights must sum to 100 (currently ${sum}).`;
        if (d.weights.views < Math.max(d.weights.likes, d.weights.comments)) return "Views must carry the largest weight.";
        for (const p of PLATFORMS) {
          if (d.multipliers[p].source.kind === "manual" && !d.multipliers[p].source.note?.trim()) return `${PLATFORM_LABEL[p]}: manual multipliers need a source note.`;
        }
        return null;
      }}
    >
      {(d, set) => {
        const setMultiplier = (p: Platform, k: "view" | "like" | "comment", v: number) =>
          set((x) => {
            x.multipliers[p][k] = v;
            if (x.multipliers[p].source.kind !== "manual") x.multipliers[p].source = { kind: "manual", note: "" };
            return x;
          });
        return (
          <div className="flex flex-col gap-8">
            <div className="grid gap-6 md:grid-cols-3">
              {(["views", "likes", "comments"] as const).map((k) => (
                <div key={k}>
                  <p className="text-[12.5px] capitalize text-ink-3">{k}</p>
                  <div className="mt-2 grid grid-cols-[1fr_1fr] gap-2">
                    <label className="text-[11.5px] text-ink-4">
                      Weight
                      <NumberInput label={`${k} weight`} value={d.weights[k]} suffix="%" onChange={(v) => set((x) => ((x.weights[k] = v), x))} />
                    </label>
                    <label className="text-[11.5px] text-ink-4">
                      Ceiling
                      <NumberInput label={`${k} ceiling`} value={d.referenceCeilings[k]} onChange={(v) => set((x) => ((x.referenceCeilings[k] = v), x))} />
                    </label>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-[12.5px] text-ink-3">
                Likes counted up to (share of adjusted views)
                <NumberInput label="Like cap" value={d.engagementCaps.likesPerView} step={0.01} onChange={(v) => set((x) => ((x.engagementCaps.likesPerView = v), x))} />
              </label>
              <label className="text-[12.5px] text-ink-3">
                Comments counted up to (share of adjusted views)
                <NumberInput
                  label="Comment cap"
                  value={d.engagementCaps.commentsPerView}
                  step={0.005}
                  onChange={(v) => set((x) => ((x.engagementCaps.commentsPerView = v), x))}
                />
              </label>
            </div>

            <div>
              <p className="text-[13px] font-medium text-ink">Platform multipliers</p>
              <p className="mt-0.5 text-[12.5px] text-ink-3">
                Editing a value marks it as manual and requires a source. Prefer calibrated values (panel below) for likes and comments.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[720px] text-[13px]">
                  <thead>
                    <tr className="border-b border-edge text-left text-[12px] text-ink-3">
                      <th className="py-2 pr-3 font-normal">Platform</th>
                      <th className="py-2 pr-3 font-normal">View</th>
                      <th className="py-2 pr-3 font-normal">Like</th>
                      <th className="py-2 pr-3 font-normal">Comment</th>
                      <th className="py-2 pr-3 font-normal">Source</th>
                      <th className="py-2 text-right font-normal">Preview score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PLATFORMS.map((p) => {
                      const m = d.multipliers[p];
                      const preview = computeViralScore(SAMPLE, p, d, version).score;
                      return (
                        <tr key={p} className="border-b border-edge align-middle last:border-b-0">
                          <td className="py-2.5 pr-3 text-ink">{PLATFORM_LABEL[p]}</td>
                          {(["view", "like", "comment"] as const).map((k) => (
                            <td key={k} className="w-[96px] py-2 pr-3">
                              <NumberInput label={`${p} ${k} multiplier`} value={m[k]} step={0.01} onChange={(v) => setMultiplier(p, k, v)} />
                            </td>
                          ))}
                          <td className="py-2 pr-3">
                            {m.source.kind === "manual" ? (
                              <input
                                aria-label={`${p} source note`}
                                value={m.source.note ?? ""}
                                onChange={(e) => set((x) => ((x.multipliers[p].source = { kind: "manual", note: e.target.value }), x))}
                                placeholder="Source, e.g. study + sample size"
                                className="h-9 w-full min-w-[220px] rounded-md border border-edge-strong bg-raised px-2.5 text-[12.5px] text-ink placeholder:text-ink-4 focus:border-accent/70 focus:outline-none"
                              />
                            ) : (
                              <span className="inline-block pt-2 text-[12.5px] text-ink-3">
                                {m.source.kind === "calibrated" ? `Calibrated · n=${m.source.sampleSize}` : "Neutral default"}
                              </span>
                            )}
                          </td>
                          <td className="num py-2.5 text-right text-ink">{score(preview)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[12px] text-ink-4">
                Preview: the same {SAMPLE.views.toLocaleString("en-US")} views, {SAMPLE.likes.toLocaleString("en-US")} likes and {SAMPLE.comments} comments scored on each platform under the draft configuration.
              </p>
            </div>
          </div>
        );
      }}
    </ConfigForm>
  );
}

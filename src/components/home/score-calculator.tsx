"use client";

import { useId, useMemo, useState, type ChangeEvent } from "react";
import { Input } from "@/components/ui/form";
import type { ScoringConfig } from "@/lib/config/schemas";
import { PLATFORM_SHORT, PLATFORMS, type Platform } from "@/lib/domain/platforms";
import { cn } from "@/lib/format";
import { computeViralScore } from "@/lib/scoring/viral-score";

const fmt = new Intl.NumberFormat("en-US");
const parse = (s: string) => Math.min(Number(s.replace(/[^0-9]/g, "")) || 0, 1e12);

/** Interactive Viral Score: the same pure function that ranks real entries, fed with the live configuration. */
export function ScoreCalculator({ config, version }: { config: ScoringConfig; version: number }) {
  const id = useId();
  const [views, setViews] = useState("100,000");
  const [likes, setLikes] = useState("8,000");
  const [comments, setComments] = useState("300");
  const [platform, setPlatform] = useState<Platform>("tiktok");

  const b = useMemo(
    () => computeViralScore({ views: parse(views), likes: parse(likes), comments: parse(comments) }, platform, config, version),
    [views, likes, comments, platform, config, version],
  );

  const numeric = (set: (v: string) => void) => (e: ChangeEvent<HTMLInputElement>) =>
    set(e.target.value.trim() === "" ? "" : fmt.format(parse(e.target.value)));

  const rows = [
    { key: "views", label: "Views", letter: "V", value: b.components.views, weight: b.weights.views, note: null },
    {
      key: "likes",
      label: "Likes",
      letter: "L",
      value: b.components.likes,
      weight: b.weights.likes,
      note: b.capped.likes ? `capped at ${Math.round(config.engagementCaps.likesPerView * 100)}% of views` : null,
    },
    {
      key: "comments",
      label: "Comments",
      letter: "C",
      value: b.components.comments,
      weight: b.weights.comments,
      note: b.capped.comments ? `capped at ${Math.round(config.engagementCaps.commentsPerView * 100)}% of views` : null,
    },
  ] as const;
  const m = config.multipliers[platform];

  return (
    <div className="grid gap-px overflow-hidden rounded-lg border border-edge bg-edge text-left lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="flex flex-col gap-4 bg-canvas p-5 sm:p-6">
        <p className="text-[13px] font-medium text-ink">Try it</p>
        {(
          [
            ["views", "Views", views, setViews],
            ["likes", "Likes", likes, setLikes],
            ["comments", "Comments", comments, setComments],
          ] as const
        ).map(([key, label, value, set]) => (
          <div key={key} className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-${key}`} className="text-[12.5px] text-ink-3">
              {label}
            </label>
            <Input id={`${id}-${key}`} inputMode="numeric" autoComplete="off" value={value} onChange={numeric(set)} className="num font-mono" />
          </div>
        ))}
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] text-ink-3">Platform</span>
          <div role="group" aria-label="Platform" className="grid grid-cols-4 gap-0.5 rounded-md border border-edge p-0.5">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={p === platform}
                onClick={() => setPlatform(p)}
                className={cn(
                  "h-7 truncate rounded-[5px] px-1.5 text-[12px] transition-colors duration-150",
                  p === platform ? "bg-overlay-2 text-ink" : "text-ink-3 hover:text-ink",
                )}
              >
                {PLATFORM_SHORT[p]}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-ink-4">
            Multipliers ×{m.view.toFixed(2)} · ×{m.like.toFixed(2)} · ×{m.comment.toFixed(2)}
          </p>
        </div>
      </div>

      <div className="flex flex-col bg-canvas p-5 sm:p-6" aria-live="polite">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[12.5px] text-ink-3">Viral Score</p>
            <p className="num mt-1 font-mono text-[44px] font-medium leading-none tracking-[-0.04em] text-ink sm:text-[52px]">
              {b.score.toFixed(2)}
            </p>
          </div>
          <div className="mb-1 flex h-2 w-[45%] overflow-hidden rounded-full bg-overlay-2" aria-hidden>
            {rows.map((r, i) => (
              <span
                key={r.key}
                className={cn("h-full transition-[width] duration-300", i === 0 ? "bg-accent" : i === 1 ? "bg-ink-2" : "bg-ink-4")}
                style={{ width: `${Math.min((r.value * r.weight) / 100, 100)}%` }}
              />
            ))}
          </div>
        </div>
        <ul className="mt-6 flex flex-col">
          {rows.map((r, i) => (
            <li key={r.key} className="grid grid-cols-[28px_1fr_auto] items-center gap-x-3 border-t border-edge py-3">
              <span className={cn("font-mono text-[15px]", i === 0 ? "text-accent" : "text-ink")}>{r.letter}</span>
              <div className="min-w-0">
                <p className="text-[13px] text-ink-2">
                  {r.label}
                  {r.note ? <span className="ml-2 text-[12px] text-warning">{r.note}</span> : null}
                </p>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-overlay-2" aria-hidden>
                  <div className="h-full rounded-full bg-ink-3 transition-[width] duration-300" style={{ width: `${Math.min(r.value, 100)}%` }} />
                </div>
              </div>
              <p className="num whitespace-nowrap font-mono text-[13px] text-ink-3">
                {r.value.toFixed(1)} <span className="text-ink-4">×</span> {(r.weight / 100).toFixed(2)} <span className="text-ink-4">=</span>{" "}
                <span className="text-ink">{((r.value * r.weight) / 100).toFixed(2)}</span>
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

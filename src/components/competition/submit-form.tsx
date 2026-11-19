"use client";

import { ArrowUpRight, Check, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Notice } from "@/components/ui/misc";
import { PlatformTag } from "@/components/ui/platform";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/components/wallet/auth-provider";
import { api, ApiClientError } from "@/lib/client/api";
import { PLATFORM_LABEL, type Platform } from "@/lib/domain/platforms";
import { cn, compactNumber, dateTimeUtc, score, shortAddress } from "@/lib/format";

type Check = { id: string; ok: boolean; label: string; detail: string | null };
type Preview = {
  video: {
    platform: Platform;
    videoId: string;
    canonicalUrl: string;
    authorHandle: string;
    publishedAt: string;
    publishedAtSource: "platform_api" | "simulated";
    views: number | null;
    likes: number | null;
    comments: number | null;
  };
  checks: Check[];
  canSubmit: boolean;
  ownership: { required: boolean; linked: boolean; linkedHandle: string | null; expectedHandle: string; simulated: boolean };
  simulated: boolean;
};
type Result = { id: string; status: string; viralScore: number; riskScore: number };

const EXAMPLES = ["tiktok.com/@creator/video/…", "youtube.com/shorts/…", "instagram.com/reel/…", "x.com/creator/status/…"];

export function SubmitVideoForm({ mint, symbol, open }: { mint: string; symbol: string; open: boolean }) {
  const { status, wallet, ensureSignedIn } = useAuth();
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [linking, setLinking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const signedIn = status === "signed_in";

  async function check(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setPreview(null);
    if (!url.trim()) return setError("Paste a video link.");
    if (!(await ensureSignedIn())) return;
    setChecking(true);
    try {
      setPreview(await api<Preview>(`/api/competitions/${mint}/preview`, { body: { url } }));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not check this video.");
    } finally {
      setChecking(false);
    }
  }

  async function linkSimulated() {
    if (!preview) return;
    setLinking(true);
    try {
      await api(`/api/social/${preview.video.platform}/simulate`, { body: { handle: preview.ownership.expectedHandle } });
      toast.push({ tone: "positive", title: `Linked @${preview.ownership.expectedHandle}`, description: "Simulated link (demo mode)." });
      await check();
    } catch (err) {
      toast.push({ tone: "negative", title: "Linking failed", description: err instanceof Error ? err.message : undefined });
    } finally {
      setLinking(false);
    }
  }

  async function submit() {
    if (!preview?.canSubmit) return;
    if (!(await ensureSignedIn())) return;
    setSubmitting(true);
    try {
      const r = await api<Result>(`/api/competitions/${mint}/submissions`, { body: { url } });
      setResult(r);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Submission failed.");
      if (err instanceof ApiClientError && (err.details as { checks?: Check[] } | null)?.checks && preview) {
        setPreview({ ...preview, checks: (err.details as { checks: Check[] }).checks, canSubmit: false });
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    const verified = result.status === "verified";
    return (
      <div className="rounded-lg border border-edge bg-raised p-6 animate-fade-in">
        <p className="inline-flex items-center gap-2 text-[13px] text-ink-3">
          <span className={cn("size-1.5 rounded-full", verified ? "bg-accent" : "bg-warning")} />
          {verified ? "Verified" : "Under review"}
        </p>
        <h2 className="mt-3 text-[20px] font-semibold tracking-[-0.01em] text-ink">Video submitted</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
          {verified
            ? "Your video is on the leaderboard. Metrics refresh automatically from the platform; it becomes eligible for payouts once it passes the view threshold."
            : "Automated checks flagged this entry for a quick human review. It stays on the leaderboard, but can't win a payout until a reviewer clears it."}
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-edge bg-edge text-[13px]">
          <div className="bg-raised px-4 py-3">
            <dt className="text-ink-3">Viral Score</dt>
            <dd className="mt-0.5 text-[18px] font-semibold text-ink">{score(result.viralScore)}</dd>
          </div>
          <div className="bg-raised px-4 py-3">
            <dt className="text-ink-3">Status</dt>
            <dd className="mt-0.5 text-[18px] font-semibold text-ink">{verified ? "Verified" : "Under review"}</dd>
          </div>
        </dl>
        <div className="mt-6 flex flex-wrap gap-2">
          <ButtonLink href={`/competitions/${mint}`} variant="primary">
            View leaderboard
          </ButtonLink>
          <Button
            variant="secondary"
            onClick={() => {
              setResult(null);
              setPreview(null);
              setUrl("");
            }}
          >
            Submit another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Step n={1} title="Wallet" done={signedIn}>
        {signedIn && wallet ? (
          <p className="text-[13.5px] text-ink-2">
            Signed in as <span className="font-mono text-ink">{shortAddress(wallet, 6)}</span>. Rewards are paid to this wallet.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => void ensureSignedIn()} loading={status === "signing"}>
              {status === "connected_unverified" ? "Verify wallet" : "Connect wallet"}
            </Button>
            <span className="text-[12.5px] text-ink-3">Sign a message to prove ownership. No transaction, no fee.</span>
          </div>
        )}
      </Step>

      <Step n={2} title="Video link" done={Boolean(preview)}>
        <form onSubmit={check} className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Field label="Public video URL" htmlFor="video-url" error={error} hint={`Supported: ${EXAMPLES.join(" · ")}`} className="flex-1">
            <Input
              id="video-url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setPreview(null);
              }}
              placeholder="https://www.tiktok.com/@you/video/…"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(error)}
              disabled={!open}
            />
          </Field>
          <Button type="submit" variant="secondary" className="sm:mt-[26px]" loading={checking} disabled={!open || !url.trim()}>
            Check video
          </Button>
        </form>
      </Step>

      {preview ? (
        <Step n={3} title="Eligibility" done={preview.canSubmit}>
          <div className="rounded-lg border border-edge">
            <div className="flex flex-wrap items-center gap-3 border-b border-edge px-4 py-3.5">
              <PlatformTag platform={preview.video.platform} />
              <a href={preview.video.canonicalUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-[14px] text-ink hover:text-accent">
                @{preview.video.authorHandle} <ArrowUpRight className="size-3 text-ink-3" />
              </a>
              <span className="text-[12.5px] text-ink-3">Published {dateTimeUtc(new Date(preview.video.publishedAt))}</span>
              {preview.simulated ? <span className="ml-auto rounded-sm bg-overlay-2 px-1.5 py-0.5 text-[10.5px] uppercase tracking-wider text-ink-3">Simulated data</span> : null}
            </div>
            {preview.video.views !== null ? (
              <dl className="grid grid-cols-3 gap-px border-b border-edge bg-edge text-[13px]">
                {(
                  [
                    ["Views", preview.video.views],
                    ["Likes", preview.video.likes],
                    ["Comments", preview.video.comments],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="bg-canvas px-4 py-2.5">
                    <dt className="text-[12px] text-ink-3">{k}</dt>
                    <dd className="num mt-0.5 text-ink">{compactNumber(v ?? 0)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <ul className="divide-y divide-edge">
              {preview.checks.map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                  <span
                    className={cn(
                      "mt-0.5 inline-flex size-[18px] shrink-0 items-center justify-center rounded-full",
                      c.ok ? "bg-accent-soft text-accent" : "bg-negative-soft text-negative",
                    )}
                  >
                    {c.ok ? <Check className="size-3" strokeWidth={2.5} /> : <X className="size-3" strokeWidth={2.5} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] text-ink">
                      {c.label}
                      <span className="sr-only">{c.ok ? " — passed" : " — failed"}</span>
                    </span>
                    {c.detail ? <span className="mt-0.5 block text-[12.5px] text-ink-3">{c.detail}</span> : null}
                  </span>
                  {c.id === "account_ownership" && !c.ok ? (
                    preview.ownership.simulated ? (
                      <Button size="sm" variant="secondary" loading={linking} onClick={() => void linkSimulated()}>
                        Link @{preview.ownership.expectedHandle}
                      </Button>
                    ) : (
                      <ButtonLink
                        size="sm"
                        variant="secondary"
                        href={`/api/social/${preview.video.platform}/connect?returnTo=${encodeURIComponent(`/competitions/${mint}/submit`)}`}
                        prefetch={false}
                      >
                        Link {PLATFORM_LABEL[preview.video.platform]}
                      </ButtonLink>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
          {preview.ownership.simulated && !preview.ownership.linked ? (
            <p className="mt-2 text-[12px] text-ink-3">Demo mode: linking is simulated. In production, creators link accounts through the platform&apos;s official OAuth flow.</p>
          ) : null}
        </Step>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-edge pt-6">
        <Button variant="primary" size="lg" disabled={!preview?.canSubmit || !open} loading={submitting} onClick={() => void submit()}>
          Submit to ${symbol}
        </Button>
        <span className="text-[12.5px] text-ink-3">
          By submitting you agree to the <Link href="/docs/eligibility" className="underline decoration-edge-strong underline-offset-2 hover:text-ink">competition rules</Link>.
        </span>
      </div>
      {!open ? <Notice tone="warning">This competition is not accepting entries right now.</Notice> : null}
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-[28px_1fr] gap-x-4">
      <span
        className={cn(
          "mt-0.5 inline-flex size-6 items-center justify-center rounded-full border text-[11.5px] font-medium",
          done ? "border-accent/50 bg-accent-soft text-accent" : "border-edge-strong text-ink-3",
        )}
        aria-hidden
      >
        {done ? <Check className="size-3" strokeWidth={2.5} /> : n}
      </span>
      <div className="min-w-0">
        <h2 className="text-[14px] font-medium text-ink">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </section>
  );
}

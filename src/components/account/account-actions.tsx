"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/components/wallet/auth-provider";
import { api, ApiClientError } from "@/lib/client/api";
import { PLATFORM_LABEL, type Platform } from "@/lib/domain/platforms";

export function SignInPrompt() {
  const { ensureSignedIn, status } = useAuth();
  const router = useRouter();
  return (
    <div className="rounded-lg border border-edge bg-raised px-6 py-10 text-center">
      <h2 className="text-[16px] font-semibold text-ink">Connect your wallet</h2>
      <p className="mx-auto mt-2 max-w-[420px] text-[13.5px] leading-relaxed text-ink-2">
        Your account is your wallet. Sign a message to manage linked accounts, rewards and disputes. No transaction, no fee.
      </p>
      <Button
        variant="primary"
        className="mt-6"
        loading={status === "signing"}
        onClick={async () => {
          if (await ensureSignedIn()) router.refresh();
        }}
      >
        {status === "connected_unverified" ? "Verify wallet" : "Connect wallet"}
      </Button>
    </div>
  );
}

export function LinkAccountControl({ platform, mode, oauthReady, linkedId }: { platform: Platform; mode: "mock" | "live"; oauthReady: boolean; linkedId: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [handle, setHandle] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function unlink() {
    if (!linkedId) return;
    setBusy(true);
    try {
      await api(`/api/social/accounts/${linkedId}`, { method: "DELETE" });
      toast.push({ title: `${PLATFORM_LABEL[platform]} account unlinked` });
      router.refresh();
    } catch (e) {
      toast.push({ tone: "negative", title: "Could not unlink", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function simulate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/social/${platform}/simulate`, { body: { handle } });
      toast.push({ tone: "positive", title: `Linked @${handle.replace(/^@/, "")}`, description: "Simulated link (demo mode)." });
      setOpen(false);
      setHandle("");
      router.refresh();
    } catch (err) {
      toast.push({ tone: "negative", title: "Linking failed", description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  if (linkedId) {
    return (
      <Button size="sm" variant="ghost" loading={busy} onClick={() => void unlink()}>
        Unlink
      </Button>
    );
  }
  if (mode === "live") {
    return oauthReady ? (
      <ButtonLink size="sm" variant="secondary" href={`/api/social/${platform}/connect?returnTo=/account`} prefetch={false}>
        Connect
      </ButtonLink>
    ) : (
      <span className="text-[12px] text-ink-4">Not configured</span>
    );
  }
  return open ? (
    <form onSubmit={simulate} className="flex items-center gap-2">
      <Input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle" className="h-8 w-36 text-[13px]" aria-label={`${PLATFORM_LABEL[platform]} handle`} autoFocus />
      <Button size="sm" variant="secondary" type="submit" loading={busy} disabled={handle.replace(/^@/, "").length < 2}>
        Link
      </Button>
    </form>
  ) : (
    <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
      Link (simulated)
    </Button>
  );
}

export function ClaimButton({ payoutId }: { payoutId: string }) {
  const { signText, ensureSignedIn } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="primary"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          if (!(await ensureSignedIn())) return;
          const { nonce, message } = await api<{ nonce: string; message: string }>(`/api/rewards/${payoutId}/claim-message`, { method: "POST" });
          const signature = await signText(message);
          await api(`/api/rewards/${payoutId}/claim`, { body: { nonce, signature } });
          toast.push({ tone: "positive", title: "Claim submitted", description: "A new transfer attempt is queued. It shows as paid only after on-chain confirmation." });
          router.refresh();
        } catch (e) {
          const rejected = e instanceof Error && /reject|declin|cancel/i.test(e.message);
          toast.push({ tone: rejected ? "neutral" : "negative", title: rejected ? "Signature cancelled" : "Claim failed", description: rejected ? undefined : e instanceof Error ? e.message : undefined });
        } finally {
          setBusy(false);
        }
      }}
    >
      Claim
    </Button>
  );
}

const CATEGORIES = [
  ["video_rejected", "My video was rejected or flagged"],
  ["score_incorrect", "My metrics or Viral Score look wrong"],
  ["payout_issue", "A payout didn't arrive"],
  ["ownership", "Someone submitted my content"],
  ["other", "Something else"],
] as const;

export function DisputeForm({ videos }: { videos: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const toast = useToast();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number][0]>("video_rejected");
  const [videoId, setVideoId] = useState(videos[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          await api("/api/disputes", { body: { category, message, ...(category !== "other" && videoId ? { videoId } : {}) } });
          toast.push({ tone: "positive", title: "Dispute opened", description: "A reviewer will respond here. Every decision is logged." });
          setMessage("");
          router.refresh();
        } catch (err) {
          setError(err instanceof ApiClientError ? err.message : "Could not open the dispute.");
        } finally {
          setBusy(false);
        }
      }}
      className="flex flex-col gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Issue" htmlFor="dispute-category">
          <Select id="dispute-category" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
            {CATEGORIES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Submission" htmlFor="dispute-video" optional={category === "other"}>
          <Select id="dispute-video" value={videoId} onChange={(e) => setVideoId(e.target.value)} disabled={videos.length === 0}>
            {videos.length === 0 ? <option value="">No submissions yet</option> : null}
            {videos.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="What happened?" htmlFor="dispute-message" error={error} hint="Include links to platform analytics if relevant. Minimum 20 characters.">
        <Textarea id="dispute-message" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
      </Field>
      <div>
        <Button type="submit" variant="secondary" loading={busy} disabled={message.trim().length < 20}>
          Open dispute
        </Button>
      </div>
    </form>
  );
}

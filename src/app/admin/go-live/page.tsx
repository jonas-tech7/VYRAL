import { Check, X } from "lucide-react";
import { Suspense } from "react";
import { AccessDenied } from "@/components/admin/admin-ui";
import { AdminHeader } from "@/components/admin/admin-page";
import { GoLiveActions } from "@/components/admin/go-live-actions";
import { Skeleton, SectionHeader } from "@/components/ui/misc";
import { requireRole } from "@/lib/auth/admin";
import { PLATFORM_LABEL } from "@/lib/domain/platforms";
import { sol } from "@/lib/format";
import { readiness } from "@/lib/services/go-live";

export default function GoLivePage() {
  return (
    <>
      <AdminHeader title="Go live" description="Production checklist and the one-time steps before the first real launch." />
      <Suspense fallback={<Skeleton className="h-[520px] w-full" />}>
        <GoLive />
      </Suspense>
    </>
  );
}

function Row({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3 text-[13px]">
      <span className={ok ? "flex size-5 items-center justify-center rounded-full bg-accent/15 text-accent" : "flex size-5 items-center justify-center rounded-full bg-negative/15 text-negative"}>
        {ok ? <Check className="size-3.5" strokeWidth={2.5} /> : <X className="size-3.5" strokeWidth={2.5} />}
      </span>
      <span className="text-ink">{label}</span>
      <span className="ml-auto truncate font-mono text-[12px] text-ink-3">{detail}</span>
    </li>
  );
}

async function GoLive() {
  const auth = await requireRole("admin");
  if (!auth.ok) return <AccessDenied signedIn={Boolean(auth.viewer)} />;
  const r = await readiness();
  const lutReady = r.checks.find((c) => c.label === "Launch lookup table")?.ok ?? false;

  return (
    <div className="flex animate-fade-in flex-col gap-12">
      <section>
        <SectionHeader title="Production configuration" description="Set in Vercel → Settings → Environment Variables, then redeploy." />
        <ul className="divide-y divide-edge rounded-lg border border-edge bg-raised">
          {r.checks.map((c) => (
            <Row key={c.label} {...c} />
          ))}
          {r.platforms.map((p) => (
            <Row key={p.platform} ok={p.ok} label={`${PLATFORM_LABEL[p.platform]} submissions`} detail={p.ok ? "API keys set" : "Opens when its API keys are set"} />
          ))}
          <Row ok={r.vaultLamports !== null && r.vaultLamports >= 20_000_000} label="Reward vault balance" detail={r.vaultLamports === null ? "Unknown" : `${sol(r.vaultLamports)} (keep ≥ 0.02 SOL for network fees)`} />
          <Row ok={r.demoTokens === 0} label="Demonstration data removed" detail={`${r.demoTokens} demo coins`} />
        </ul>
      </section>

      <section>
        <SectionHeader title="One-time steps" description="In this order. Each step is recorded in the audit log." />
        <GoLiveActions lookupTableReady={lutReady} demoTokens={r.demoTokens} />
      </section>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";

type Simulation = { ok: boolean; error: string | null; bytes: number; transactions: number; computeUnits: number | null; logs: string[] };
type Reset = { removed: boolean; counts: Record<string, number> };

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-edge bg-raised p-5">
      <p className="text-[13px] font-medium text-ink">
        <span className="mr-2 font-mono text-ink-3">{n}</span>
        {title}
      </p>
      <div className="mt-3 text-[12.5px] leading-relaxed text-ink-2">{children}</div>
    </div>
  );
}

export function GoLiveActions({ lookupTableReady, demoTokens }: { lookupTableReady: boolean; demoTokens: number }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [sim, setSim] = useState<Simulation | null>(null);
  const [reset, setReset] = useState<Reset | null>(null);
  const [phrase, setPhrase] = useState("");
  const toast = useToast();
  const router = useRouter();

  async function run<T>(action: string, body: Record<string, unknown>, done: (r: T) => void) {
    setBusy(action);
    try {
      done(await api<T>("/api/admin/go-live", { body: { action, ...body } }));
      router.refresh();
    } catch (err) {
      toast.push({ tone: "negative", title: "Failed", description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4">
      <Step n={1} title="Create the launch lookup table">
        <p>
          A small on-chain table with the fixed pump.fun accounts, so a launch and its locked fee split fit in one transaction. Paid by the reward vault
          (about 0.01 SOL). Needed once.
        </p>
        <Button
          className="mt-3"
          variant="primary"
          disabled={lookupTableReady}
          loading={busy === "create_lookup_table"}
          onClick={() =>
            void run<{ address: string; accounts: number }>("create_lookup_table", {}, (r) =>
              toast.push({ tone: "positive", title: "Lookup table created", description: `${r.address} (${r.accounts} accounts)` }),
            )
          }
        >
          {lookupTableReady ? "Created" : "Create lookup table"}
        </Button>
      </Step>

      <Step n={2} title="Test a launch against pump.fun">
        <p>
          Builds a complete launch (coin, 50/50 fee split locked on-chain, 0.05 SOL initial buy) and simulates it on the live network. Nothing is signed
          or sent, no coin is created and no funds move.
        </p>
        <Button className="mt-3" disabled={!lookupTableReady} loading={busy === "simulate_launch"} onClick={() => void run<Simulation>("simulate_launch", {}, setSim)}>
          Run test
        </Button>
        {sim ? (
          <div className={`mt-3 rounded-md border p-3 font-mono text-[12px] ${sim.ok ? "border-accent/40 text-accent" : "border-negative/40 text-negative"}`}>
            {sim.ok
              ? `OK: launch accepted by pump.fun (${sim.bytes} bytes, ${sim.computeUnits ?? "?"} compute units${sim.transactions > 1 ? ", initial buy sent as a second transaction" : ""}).`
              : `Failed: ${sim.error}`}
            {sim.logs.length ? <pre className="mt-2 whitespace-pre-wrap text-ink-3">{sim.logs.join("\n")}</pre> : null}
          </div>
        ) : null}
      </Step>

      <Step n={3} title="Remove the demonstration data">
        <p>
          Empties coins, competitions, videos, fees and payouts so the site starts clean. Keeps the configuration, administrators and audit log. Refuses
          once a real coin exists. {demoTokens === 0 ? "Already clean." : `${demoTokens} demo coins present.`}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button disabled={demoTokens === 0} loading={busy === "reset_preview"} onClick={() => void run<Reset>("reset_demo_data", { confirm: false }, setReset)}>
            Preview
          </Button>
          <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="Type REMOVE DEMO DATA" className="w-[220px]" />
          <Button
            variant="danger"
            disabled={demoTokens === 0 || phrase !== "REMOVE DEMO DATA"}
            loading={busy === "reset_demo_data"}
            onClick={() =>
              void run<Reset>("reset_demo_data", { confirm: true, phrase }, (r) => {
                setReset(r);
                toast.push({ tone: "positive", title: "Demonstration data removed" });
              })
            }
          >
            Remove
          </Button>
        </div>
        {reset ? (
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[12px] sm:grid-cols-3">
            {Object.entries(reset.counts)
              .filter(([, n]) => n > 0)
              .map(([t, n]) => (
                <div key={t} className="flex justify-between gap-3">
                  <dt className="truncate text-ink-3">{t}</dt>
                  <dd className="text-ink-2">{reset.removed ? `${n} removed` : n}</dd>
                </div>
              ))}
          </dl>
        ) : null}
      </Step>
    </div>
  );
}

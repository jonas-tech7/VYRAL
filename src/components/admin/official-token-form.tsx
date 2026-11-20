"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";

/** Sets or clears the official $VYRAL contract address shown in the site header. */
export function OfficialTokenForm({ mint, symbol }: { mint: string | null; symbol: string }) {
  const [value, setValue] = useState(mint ?? "");
  const [ticker, setTicker] = useState(symbol);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();

  async function save(next: string | null) {
    setBusy(true);
    try {
      await api("/api/admin/config/platform_token", {
        method: "PUT",
        body: {
          value: { mint: next, symbol: ticker.replace(/^\$/, "").toUpperCase() || "VYRAL" },
          note: next ? `Official contract address set to ${next}` : "Official contract address removed",
        },
      });
      toast.push({ tone: "positive", title: next ? "Contract address is live in the header" : "Contract address removed" });
      router.refresh();
    } catch (err) {
      toast.push({ tone: "negative", title: "Not saved", description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-edge bg-raised p-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
        <Field label="Contract address" htmlFor="official-ca" hint="Shown in the header with a copy button as soon as you save.">
          <Input id="official-ca" value={value} onChange={(e) => setValue(e.target.value.trim())} placeholder="Mint address" className="font-mono" />
        </Field>
        <Field label="Ticker" htmlFor="official-ticker">
          <Input id="official-ticker" value={ticker} onChange={(e) => setTicker(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="primary" loading={busy} disabled={!value} onClick={() => void save(value)}>
          Save
        </Button>
        {mint ? (
          <Button variant="ghost" disabled={busy} onClick={() => void save(null)}>
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  );
}

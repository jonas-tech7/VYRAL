"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError } from "@/lib/client/api";
import { cn } from "@/lib/format";

/**
 * Versioned config editor shell: holds a draft, validates on the server,
 * requires a change note, and reports issues inline.
 */
export function ConfigForm<T>({
  configKey,
  initial,
  version,
  title,
  description,
  children,
  clientError,
}: {
  configKey: string;
  initial: T;
  version: number;
  title: string;
  description?: string;
  children: (draft: T, set: (updater: (d: T) => T) => void) => ReactNode;
  clientError?: (draft: T) => string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<T>(initial);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<Array<{ path: string; message: string }>>([]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const localError = clientError?.(draft) ?? null;

  async function save() {
    setBusy(true);
    setIssues([]);
    try {
      const r = await api<{ version: number; rescored: number }>(`/api/admin/config/${configKey}`, { method: "PUT", body: { value: draft, note } });
      toast.push({
        tone: "positive",
        title: `${title} saved as v${r.version}`,
        description: r.rescored ? `${r.rescored} videos rescored. Recorded in the audit log.` : "Recorded in the audit log.",
      });
      setNote("");
      router.refresh();
    } catch (e) {
      if (e instanceof ApiClientError && Array.isArray(e.details)) setIssues(e.details as Array<{ path: string; message: string }>);
      toast.push({ tone: "negative", title: "Not saved", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-edge">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-5 py-4">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-[12.5px] text-ink-3">{description}</p> : null}
        </div>
        <span className="text-[12px] text-ink-3">Current v{version}</span>
      </header>
      <div className="px-5 py-5">{children(draft, (u) => setDraft((d) => u(structuredClone(d))))}</div>
      <footer className="flex flex-col gap-3 border-t border-edge px-5 py-4">
        {issues.length > 0 ? (
          <ul className="text-[12.5px] text-negative" role="alert">
            {issues.map((i) => (
              <li key={`${i.path}:${i.message}`}>
                {i.path ? <span className="font-mono">{i.path}</span> : null} {i.message}
              </li>
            ))}
          </ul>
        ) : null}
        {localError ? <p className="text-[12.5px] text-warning">{localError}</p> : null}
        <div className={cn("grid gap-3", dirty ? "sm:grid-cols-[1fr_auto] sm:items-end" : "")}>
          {dirty ? (
            <Field label="Change note" htmlFor={`note-${configKey}`} hint="Required. Explain the change and cite sources for benchmark-based values.">
              <Textarea id={`note-${configKey}`} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[64px]" />
            </Field>
          ) : (
            <p className="text-[12.5px] text-ink-3">No unsaved changes.</p>
          )}
          {dirty ? (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setDraft(initial)} disabled={busy}>
                Discard
              </Button>
              <Button variant="primary" onClick={() => void save()} loading={busy} disabled={note.trim().length < 3 || Boolean(localError)}>
                Save new version
              </Button>
            </div>
          ) : null}
        </div>
      </footer>
    </section>
  );
}

export function NumberInput({
  value,
  onChange,
  step = "any",
  min,
  max,
  suffix,
  label,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: string | number;
  min?: number;
  max?: number;
  suffix?: string;
  label: string;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex w-full", className)}>
      <input
        type="number"
        aria-label={label}
        value={Number.isFinite(value) ? value : ""}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
        className={cn(
          "num h-9 w-full rounded-md border border-edge-strong bg-raised px-2.5 text-[13px] text-ink focus:border-accent/70 focus:outline-none",
          suffix && "pr-8",
        )}
      />
      {suffix ? <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-ink-4">{suffix}</span> : null}
    </span>
  );
}

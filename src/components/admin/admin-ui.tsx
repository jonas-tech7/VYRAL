"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/components/wallet/auth-provider";
import { api, ApiClientError } from "@/lib/client/api";
import { cn } from "@/lib/format";

export const ADMIN_NAV = [
  { href: "/admin", label: "Overview", group: "Monitor" },
  { href: "/admin/review", label: "Review queue", group: "Monitor" },
  { href: "/admin/disputes", label: "Disputes", group: "Monitor" },
  { href: "/admin/payouts", label: "Payouts", group: "Money" },
  { href: "/admin/fees", label: "Creator fees", group: "Money" },
  { href: "/admin/competitions", label: "Competitions", group: "Configure" },
  { href: "/admin/scoring", label: "Viral Score", group: "Configure" },
  { href: "/admin/rules", label: "Rules & reward curve", group: "Configure" },
  { href: "/admin/audit", label: "Audit log", group: "Configure" },
];

export function AdminNav() {
  const pathname = usePathname();
  const groups = [...new Set(ADMIN_NAV.map((n) => n.group))];
  return (
    <nav aria-label="Admin" className="flex gap-6 overflow-x-auto pb-2 lg:flex-col lg:gap-6 lg:overflow-visible">
      {groups.map((g) => (
        <div key={g} className="shrink-0">
          <p className="text-[12px] text-ink-4">{g}</p>
          <ul className="mt-2 flex gap-1 lg:flex-col lg:gap-0.5">
            {ADMIN_NAV.filter((n) => n.group === g).map((n) => {
              const on = n.href === "/admin" ? pathname === "/admin" : pathname.startsWith(n.href);
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "block whitespace-nowrap rounded-md px-2 py-1.5 text-[13.5px] transition-colors lg:-ml-2",
                      on ? "bg-overlay text-ink" : "text-ink-3 hover:text-ink",
                    )}
                  >
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AccessDenied({ signedIn }: { signedIn: boolean }) {
  const { ensureSignedIn, status } = useAuth();
  const router = useRouter();
  return (
    <div className="rounded-lg border border-edge bg-raised px-6 py-12 text-center">
      <h2 className="text-[16px] font-semibold text-ink">{signedIn ? "Access restricted" : "Administrator sign-in"}</h2>
      <p className="mx-auto mt-2 max-w-[420px] text-[13.5px] leading-relaxed text-ink-2">
        {signedIn
          ? "This wallet doesn't have an administrator or reviewer role. Roles are granted by protocol owners and every grant is audit-logged."
          : "Connect an administrator wallet and sign the verification message to continue."}
      </p>
      {!signedIn ? (
        <Button
          variant="primary"
          className="mt-6"
          loading={status === "signing"}
          onClick={async () => {
            if (await ensureSignedIn()) router.refresh();
          }}
        >
          Connect wallet
        </Button>
      ) : null}
    </div>
  );
}

type ExtraField =
  | { kind: "text"; name: string; label: string; placeholder?: string; required?: boolean; mono?: boolean }
  | { kind: "select"; name: string; label: string; options: Array<{ value: string; label: string }>; numeric?: boolean };

/**
 * Button → confirmation dialog with a required note → API call → refresh.
 * The note is stored with the audit record.
 */
export function ActionButton({
  label,
  title,
  description,
  endpoint,
  method = "POST",
  body = {},
  noteField = "note",
  noteLabel = "Note for the audit log",
  minNote = 3,
  fields = [],
  variant = "secondary",
  confirmLabel,
  danger,
  successTitle,
}: {
  label: string;
  title: string;
  description?: ReactNode;
  endpoint: string;
  method?: "POST" | "PATCH" | "PUT";
  body?: Record<string, unknown>;
  noteField?: string;
  noteLabel?: string;
  minNote?: number;
  fields?: ExtraField[];
  variant?: "primary" | "secondary" | "ghost" | "danger";
  confirmLabel?: string;
  danger?: boolean;
  successTitle?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, f.kind === "select" ? f.options[0]?.value ?? "" : ""])),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const extra = Object.fromEntries(
        Object.entries(values).map(([k, v]) => {
          const f = fields.find((x) => x.name === k);
          return [k, f?.kind === "select" && f.numeric ? Number(v) : v];
        }),
      );
      await api(endpoint, { method, body: { ...body, ...extra, [noteField]: note } });
      toast.push({ tone: "positive", title: successTitle ?? `${label} — done`, description: "Recorded in the audit log." });
      setOpen(false);
      setNote("");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} description={description} className="sm:max-w-[480px]">
        <form onSubmit={submit} className="flex flex-col gap-4">
          {fields.map((f) =>
            f.kind === "select" ? (
              <Field key={f.name} label={f.label} htmlFor={`f-${f.name}`}>
                <Select id={`f-${f.name}`} value={values[f.name]} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field key={f.name} label={f.label} htmlFor={`f-${f.name}`}>
                <Input
                  id={`f-${f.name}`}
                  value={values[f.name]}
                  placeholder={f.placeholder}
                  className={f.mono ? "font-mono text-[12.5px]" : undefined}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value.trim() }))}
                />
              </Field>
            ),
          )}
          <Field label={noteLabel} htmlFor="action-note" error={error} hint={`Required · at least ${minNote} characters`}>
            <Textarea id="action-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[80px]" data-autofocus />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={danger ? "danger" : "primary"}
              loading={busy}
              disabled={note.trim().length < minNote || fields.some((f) => f.kind === "text" && f.required && !values[f.name])}
            >
              {confirmLabel ?? label}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

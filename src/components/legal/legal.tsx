import type { ReactNode } from "react";
import { env } from "@/lib/env";

/** Operator details for the legal pages, read from LEGAL_* environment variables. */
export function legalOperator() {
  return {
    name: env.LEGAL_OPERATOR_NAME,
    addressLines: (env.LEGAL_OPERATOR_ADDRESS ?? "")
      .split("|")
      .map((l) => l.trim())
      .filter(Boolean),
    email: env.LEGAL_CONTACT_EMAIL,
    phone: env.LEGAL_CONTACT_PHONE,
    representative: env.LEGAL_REPRESENTATIVE,
    register: env.LEGAL_REGISTER,
    vatId: env.LEGAL_VAT_ID,
    governingLaw: env.LEGAL_GOVERNING_LAW,
    reviewed: env.LEGAL_TEXTS_REVIEWED,
  };
}

/** A value from the operator's configuration, or a clearly marked placeholder while it is missing. */
export function Field({ value, label }: { value: string | undefined | null; label: string }) {
  if (value) return <>{value}</>;
  return <span className="rounded-sm bg-warning-soft px-1 font-mono text-[0.9em] text-warning">[{label}]</span>;
}

export function LegalDoc({ title, version, children }: { title: string; version?: string; children: ReactNode }) {
  return (
    <article className="prose-vyral pb-8">
      <p className="eyebrow !mb-3">Legal</p>
      <h1>{title}</h1>
      {version ? <p className="!mt-0 text-[13px] text-ink-3">Version {version}</p> : null}
      <hr />
      {children}
    </article>
  );
}

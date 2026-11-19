import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/format";

export function Container({ children, className, size = "default" }: { children: ReactNode; className?: string; size?: "default" | "narrow" | "wide" }) {
  return (
    <div className={cn("mx-auto w-full px-4 sm:px-6", size === "narrow" ? "max-w-[880px]" : size === "wide" ? "max-w-[1360px]" : "max-w-[1200px]", className)}>
      {children}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 pb-8 pt-10 sm:flex-row sm:items-end sm:justify-between sm:pt-14">
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-2">{eyebrow}</div> : null}
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em] text-ink sm:text-[30px]">{title}</h1>
        {description ? <p className="mt-2 max-w-[640px] text-[14.5px] leading-relaxed text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-4 flex items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {description ? <p className="mt-1 text-[13px] text-ink-3">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function TextLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("text-[13px] text-ink-2 transition-colors hover:text-ink", className)}>
      {children}
    </Link>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-shimmer rounded-md bg-overlay", className)} aria-hidden />;
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("border-0 border-t border-edge", className)} />;
}

/** Bordered panel; used for side summaries and forms only, never as a default wrapper. */
export function Panel({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cn("rounded-lg border border-edge bg-raised", className)}>
      {title ? (
        <header className="flex items-center justify-between gap-3 border-b border-edge px-5 py-3.5">
          <h3 className="text-[13.5px] font-medium text-ink">{title}</h3>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** Key/value rows inside panels. */
export function KV({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-2 text-[13px]", className)}>
      <span className="shrink-0 text-ink-3">{label}</span>
      <span className="min-w-0 truncate text-right text-ink">{children}</span>
    </div>
  );
}

export function Notice({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "warning" | "negative" | "positive"; className?: string }) {
  const toneClass = {
    neutral: "border-edge bg-raised text-ink-2",
    warning: "border-warning/25 bg-warning-soft text-ink",
    negative: "border-negative/25 bg-negative-soft text-ink",
    positive: "border-accent/25 bg-accent-soft text-ink",
  }[tone];
  return <div className={cn("rounded-md border px-4 py-3 text-[13px] leading-relaxed", toneClass, className)}>{children}</div>;
}

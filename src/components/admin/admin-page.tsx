import type { ReactNode } from "react";

export function AdminHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-3 border-b border-edge pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="eyebrow mb-1.5">Admin</p>
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        {description ? <p className="mt-1.5 max-w-[640px] text-[13.5px] leading-relaxed text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  );
}

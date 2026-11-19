import Link from "next/link";
import { cn } from "@/lib/format";

export type SegmentItem = { label: string; href: string; active: boolean };

/** Filter control rendered as links, so filters are shareable URLs and work without JS. */
export function SegmentedLinks({ items, className, ariaLabel }: { items: SegmentItem[]; className?: string; ariaLabel: string }) {
  return (
    <nav aria-label={ariaLabel} className={cn("-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0", className)}>
      <ul className="inline-flex items-center gap-0.5 rounded-md border border-edge p-0.5">
        {items.map((it) => (
          <li key={it.href}>
            <Link
              href={it.href}
              scroll={false}
              aria-current={it.active ? "page" : undefined}
              className={cn(
                "inline-flex h-7 items-center whitespace-nowrap rounded-[5px] px-3 text-[12.5px] transition-colors duration-150",
                it.active ? "bg-overlay-2 text-ink" : "text-ink-3 hover:text-ink",
              )}
            >
              {it.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Underlined tab row for page-level sections. */
export function TabLinks({ items, className, ariaLabel }: { items: SegmentItem[]; className?: string; ariaLabel: string }) {
  return (
    <nav aria-label={ariaLabel} className={cn("-mx-4 overflow-x-auto border-b border-edge px-4 sm:mx-0 sm:px-0", className)}>
      <ul className="flex items-center gap-6">
        {items.map((it) => (
          <li key={it.href}>
            <Link
              href={it.href}
              scroll={false}
              aria-current={it.active ? "page" : undefined}
              className={cn(
                "relative inline-flex h-10 items-center whitespace-nowrap text-[13.5px] transition-colors",
                it.active ? "text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-ink" : "text-ink-3 hover:text-ink",
              )}
            >
              {it.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

import { Search } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/format";

/** Plain GET search form: works without JavaScript and keeps the URL shareable. */
export function SearchForm({
  action,
  defaultValue,
  placeholder,
  hidden,
  className,
}: {
  action: string;
  defaultValue?: string;
  placeholder: string;
  hidden?: Record<string, string | undefined>;
  className?: string;
}) {
  return (
    <form action={action} method="get" role="search" className={cn("relative w-full lg:w-[280px]", className)}>
      {Object.entries(hidden ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-4" aria-hidden />
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-full rounded-md border border-edge bg-transparent pl-8 pr-3 text-[13px] text-ink transition-colors placeholder:text-ink-4 hover:border-edge-strong focus:border-accent/60 focus:outline-none"
      />
    </form>
  );
}

export function Pagination({ page, total, pageSize, href }: { page: number; total: number; pageSize: number; href: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const linkClass = "inline-flex h-8 items-center rounded-md border border-edge px-3 text-[12.5px] text-ink-2 transition-colors hover:border-edge-strong hover:text-ink";
  return (
    <nav aria-label="Pagination" className="mt-6 flex items-center justify-between text-[12.5px] text-ink-3">
      <span>
        Page {page} of {pages} · {total} results
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link className={linkClass} href={href(page - 1)} scroll={false}>
            Previous
          </Link>
        ) : null}
        {page < pages ? (
          <Link className={linkClass} href={href(page + 1)} scroll={false}>
            Next
          </Link>
        ) : null}
      </span>
    </nav>
  );
}

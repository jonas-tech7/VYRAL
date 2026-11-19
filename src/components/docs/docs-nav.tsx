"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/format";

type Section = { group: string; items: Array<{ slug: string; title: string }> };

export function DocsNav({ sections, active }: { sections: Section[]; active?: string }) {
  const pathname = usePathname();
  const current = active ?? pathname;
  return (
    <nav aria-label="Documentation" className="flex gap-8 overflow-x-auto pb-2 lg:flex-col lg:gap-7 lg:overflow-visible lg:pb-0">
      {sections.map((s) => (
        <div key={s.group} className="shrink-0">
          <p className="text-[12px] text-ink-4">{s.group}</p>
          <ul className="mt-2 flex flex-col gap-0.5">
            {s.items.map((it) => {
              const href = it.slug ? `/docs/${it.slug}` : "/docs";
              const on = current === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "-ml-2 block whitespace-nowrap rounded-md px-2 py-1.5 text-[13.5px] transition-colors",
                      on ? "bg-overlay text-ink" : "text-ink-3 hover:text-ink",
                    )}
                  >
                    {it.title}
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

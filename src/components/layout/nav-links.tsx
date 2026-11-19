"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useState } from "react";
import { cn } from "@/lib/format";

export const NAV = [
  { href: "/launch", label: "Launch" },
  { href: "/explore", label: "Explore" },
  { href: "/competitions", label: "Competitions" },
  { href: "/creators", label: "Creators" },
  { href: "/faq", label: "FAQ" },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinks() {
  const pathname = usePathname();
  return <NavList pathname={pathname} />;
}

/** Static fallback (no active state) used while the pathname streams in. */
export function NavLinksStatic() {
  return <NavList pathname="" />;
}

function NavList({ pathname }: { pathname: string }) {
  return (
    <ul className="hidden items-center gap-1 md:flex">
      {NAV.map((n) => (
        <li key={n.href}>
          <Link
            href={n.href}
            aria-current={isActive(pathname, n.href) ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center rounded-md px-3 text-[13.5px] transition-colors duration-150",
              isActive(pathname, n.href) ? "text-ink" : "text-ink-3 hover:text-ink",
            )}
          >
            {n.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function MobileNavPlaceholder() {
  return (
    <div className="md:hidden">
      <span className="inline-flex size-9 items-center justify-center text-ink-3" aria-hidden>
        <Menu className="size-[18px]" />
      </span>
    </div>
  );
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useLayoutEffect(() => () => setOpen(false), []);
  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? "Close menu" : "Open menu"}
        className="inline-flex size-9 items-center justify-center rounded-md text-ink-2 hover:bg-overlay hover:text-ink"
      >
        {open ? <X className="size-[18px]" /> : <Menu className="size-[18px]" />}
      </button>
      {open ? (
        <div className="fixed inset-x-0 bottom-0 top-[60px] z-40 animate-fade-in overflow-y-auto border-t border-edge bg-canvas px-4 pb-8 pt-4">
          <ul className="flex flex-col">
            {NAV.map((n) => (
              <li key={n.href} className="border-b border-edge">
                <Link
                  href={n.href}
                  onClick={() => setOpen(false)}
                  className={cn("flex h-12 items-center text-[15px]", isActive(pathname, n.href) ? "text-ink" : "text-ink-2")}
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

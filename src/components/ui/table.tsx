import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/format";

/**
 * Data table primitives. Rows separated by hairlines, numeric columns right-
 * aligned with tabular figures, headers recessive. Clickable rows use a
 * stretched link on the primary cell (keyboard and middle-click friendly).
 */
export function Table({ children, className, minWidth = 720 }: { children: ReactNode; className?: string; minWidth?: number }) {
  return (
    <div className={cn("relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0", className)}>
      <table className="w-full border-collapse text-[13.5px]" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-edge">{children}</tr>
    </thead>
  );
}

export function TH({ children, align = "left", className, ...props }: ComponentProps<"th"> & { align?: "left" | "right" | "center" }) {
  return (
    <th
      scope="col"
      className={cn(
        "h-9 whitespace-nowrap px-3 text-[12px] font-normal text-ink-3 first:pl-0 last:pr-0",
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function TR({ children, className, interactive }: { children: ReactNode; className?: string; interactive?: boolean }) {
  return (
    <tr
      className={cn(
        "relative border-b border-edge last:border-b-0",
        interactive && "transition-colors duration-150 hover:bg-raised [&:has(a:focus-visible)]:bg-raised",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function TD({ children, align = "left", className, numeric, ...props }: ComponentProps<"td"> & { align?: "left" | "right" | "center"; numeric?: boolean }) {
  return (
    <td
      className={cn(
        "h-14 whitespace-nowrap px-3 align-middle first:pl-0 last:pr-0",
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
        numeric && "num",
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}

/** Link that makes the whole row clickable. Place it in the row's primary cell. */
export function RowLink({ href, children, className, label }: { href: string; children: ReactNode; className?: string; label?: string }) {
  return (
    <Link href={href} className={cn("outline-none after:absolute after:inset-0 after:content-['']", className)} aria-label={label}>
      {children}
    </Link>
  );
}

/** Interactive element placed above the stretched row link. */
export function AboveRow({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("relative z-10", className)}>{children}</span>;
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-14 text-center text-[13.5px] text-ink-3">
        {children}
      </td>
    </tr>
  );
}

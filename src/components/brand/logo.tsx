import { cn } from "@/lib/format";

/** VYRAL mark: an asymmetric V whose right arm rises past the left — a verified, upward trajectory. */
export function LogoMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={cn("shrink-0", className)} aria-hidden>
      <rect width="20" height="20" rx="5" fill="#2cf59e" />
      <path d="M5.4 8.2 9.3 13.9 14.9 5.1" fill="none" stroke="#03150d" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-[0.16em] text-ink">VYRAL</span>
    </span>
  );
}

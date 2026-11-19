import { PLATFORM_SHORT, type Platform } from "@/lib/domain/platforms";
import { cn } from "@/lib/format";

/** Text-only platform label (no brand glyphs), consistent width in tables. */
export function PlatformTag({ platform, className }: { platform: Platform; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-[64px] items-center justify-center rounded-sm border border-edge px-1.5 text-[11px] font-medium leading-none text-ink-2",
        className,
      )}
    >
      {PLATFORM_SHORT[platform]}
    </span>
  );
}

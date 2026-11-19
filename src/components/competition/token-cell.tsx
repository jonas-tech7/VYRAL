import { TokenAvatar } from "@/components/ui/token-avatar";
import { cn } from "@/lib/format";

export function TokenCell({
  name,
  symbol,
  imageUrl,
  sub,
  size = 28,
  className,
}: {
  name: string;
  symbol: string;
  imageUrl: string | null;
  sub?: React.ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-3", className)}>
      <TokenAvatar symbol={symbol} imageUrl={imageUrl} size={size} />
      <span className="min-w-0">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[13.5px] font-medium text-ink">{name}</span>
          <span className="text-[12px] text-ink-3">${symbol}</span>
        </span>
        {sub ? <span className="block truncate text-[12px] text-ink-3">{sub}</span> : null}
      </span>
    </span>
  );
}

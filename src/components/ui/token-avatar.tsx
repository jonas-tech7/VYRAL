import { cn } from "@/lib/format";

/** Muted, deterministic monogram colours for tokens without an image. */
const SWATCHES = ["#1d2a24", "#22262f", "#2a2420", "#25222c", "#1f2a2a", "#2b2526", "#242a1f", "#202631"];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function TokenAvatar({
  symbol,
  imageUrl,
  size = 28,
  className,
}: {
  symbol: string;
  imageUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size };
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- user-supplied token art served from our storage
      <img
        src={imageUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className={cn("shrink-0 rounded-full bg-overlay object-cover ring-1 ring-edge", className)}
        style={style}
      />
    );
  }
  const bg = SWATCHES[hash(symbol) % SWATCHES.length];
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-ink-2 ring-1 ring-edge", className)}
      style={{ ...style, background: bg, fontSize: Math.max(9, Math.round(size * 0.36)) }}
    >
      {symbol.slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Deterministic, low-contrast identicon for creator wallets. */
export function WalletAvatar({ wallet, size = 28, className }: { wallet: string; size?: number; className?: string }) {
  const h = hash(wallet);
  const cells: boolean[] = [];
  for (let i = 0; i < 15; i++) cells.push(((h >> i) & 1) === 1);
  const tone = ["#2cf59e", "#9aa3b2", "#c9ccd3"][h % 3];
  return (
    <svg width={size} height={size} viewBox="0 0 5 5" className={cn("shrink-0 rounded-full bg-overlay-2 ring-1 ring-edge", className)} aria-hidden>
      <g transform="translate(0.75 0.75) scale(0.7)">
        {cells.map((on, i) => {
          if (!on) return null;
          const x = i % 3;
          const y = Math.floor(i / 3);
          return (
            <g key={i} fill={tone} fillOpacity={0.5}>
              <rect x={x} y={y} width={1} height={1} />
              {x < 2 ? <rect x={4 - x} y={y} width={1} height={1} /> : null}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

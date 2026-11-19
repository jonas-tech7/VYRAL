/** Display formatting shared by server and client components. */

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const compactFmt2 = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function fullNumber(n: number): string {
  return intFmt.format(n);
}

/** 1,284 · 12.9K · 1.42M — full digits below 10,000. */
export function compactNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) < 10_000) return intFmt.format(n);
  return (Math.abs(n) >= 1_000_000 ? compactFmt2 : compactFmt).format(n);
}

export function usd(n: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(n)) return "—";
  const compact = opts.compact ?? Math.abs(n) >= 100_000;
  if (compact) return `$${(Math.abs(n) >= 1_000_000 ? compactFmt2 : compactFmt).format(n)}`;
  return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 }).format(n)}`;
}

const SUBSCRIPT = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];

/** Token prices: $1.24 · $0.0421 · $0.0₄6243 (subscript = count of leading zeros). */
export function price(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1) return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  if (n >= 0.0001) return `$${n.toPrecision(4).replace(/0+$/, "").replace(/\.$/, "")}`;
  // Zeros between the decimal point and the first significant digit.
  const zeros = Math.ceil(-Math.log10(n)) - 1;
  const sig =
    String(Math.round(n * 10 ** (zeros + 4)))
      .slice(0, 4)
      .replace(/0+$/, "") || "0";
  const sub = String(zeros)
    .split("")
    .map((d) => SUBSCRIPT[Number(d)])
    .join("");
  return `$0.0${sub}${sig}`;
}

export const LAMPORTS_PER_SOL = 1_000_000_000;

/** SOL amounts from lamports: 0.375 · 12.48 · 1,284.2 · 12.4K */
export function sol(lamports: number, opts: { unit?: boolean } = {}): string {
  const v = lamports / LAMPORTS_PER_SOL;
  const unit = opts.unit === false ? "" : " SOL";
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return `0${unit}`;
  const abs = Math.abs(v);
  let s: string;
  if (abs >= 100_000) s = compactFmt2.format(v);
  else if (abs >= 1_000) s = v.toLocaleString("en-US", { maximumFractionDigits: 1 });
  else if (abs >= 10) s = v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  else if (abs >= 0.01) s = v.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  else s = v.toLocaleString("en-US", { maximumSignificantDigits: 2 });
  return `${s}${unit}`;
}

export function solToUsd(lamports: number, solUsd: number): number {
  return (lamports / LAMPORTS_PER_SOL) * solUsd;
}

/** Signed delta with a true minus sign: +12.4% · −3.1% */
export function signedPct(n: number, dp = 1): string {
  if (!Number.isFinite(n)) return "—";
  const s = Math.abs(n).toFixed(dp);
  if (Number(s) === 0) return `0.${"0".repeat(dp)}%`;
  return `${n > 0 ? "+" : "−"}${s}%`;
}

export function bpsToPct(bps: number, dp = 1): string {
  return `${(bps / 100).toFixed(dp).replace(/\.0+$/, "")}%`;
}

export function score(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "—" : n.toFixed(2);
}

export function shortAddress(a: string, chars = 4): string {
  if (!a) return "";
  return a.length <= chars * 2 + 1 ? a : `${a.slice(0, chars)}…${a.slice(-chars)}`;
}

export function timeAgo(date: Date, now: Date = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  return mo < 12 ? `${mo}mo ago` : `${Math.round(mo / 12)}y ago`;
}

/** Compact age without "ago": 4m · 3h · 2d */
export function age(date: Date, now: Date = new Date()): string {
  return timeAgo(date, now).replace(" ago", "").replace("just now", "now");
}

export function duration(ms: number): string {
  if (ms <= 0) return "0m";
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

const dtFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
const dFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function dateTimeUtc(d: Date): string {
  return `${dtFmt.format(d)} UTC`;
}

export function dateUtc(d: Date): string {
  return dFmt.format(d);
}

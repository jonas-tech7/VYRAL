"use client";

import { Check, Copy } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { cn, duration, shortAddress } from "@/lib/format";

export function CopyButton({ value, className, label = "Copy" }: { value: string; className?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className={cn("relative z-10 inline-flex size-6 items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-overlay hover:text-ink", className)}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
    >
      {copied ? <Check className="size-3.5 text-accent" strokeWidth={2} /> : <Copy className="size-3.5" strokeWidth={1.75} />}
    </button>
  );
}

/** Monospace short address with copy action. */
export function Address({ value, chars = 4, className, copy = true }: { value: string; chars?: number; className?: string; copy?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className="font-mono text-[12.5px] text-ink-2" title={value}>
        {shortAddress(value, chars)}
      </span>
      {copy ? <CopyButton value={value} label="Copy address" /> : null}
    </span>
  );
}

/* Shared 15-second clock: one interval for every countdown on the page. */
const clockListeners = new Set<() => void>();
let clockNow = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;

function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  if (!clockTimer) {
    clockNow = Date.now();
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      clockListeners.forEach((l) => l());
    }, 15_000);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

// Snapshots must be stable between store updates (React compares them by identity).
function getClock() {
  if (!clockNow) clockNow = Date.now();
  return clockNow;
}
function getServerClock(): number | null {
  return null;
}

/** Live countdown to a timestamp. Renders a placeholder on the server to avoid hydration drift. */
export function Countdown({ to, className, prefix }: { to: string; className?: string; prefix?: string }) {
  const target = new Date(to).getTime();
  const now = useSyncExternalStore(subscribeClock, getClock, getServerClock);
  if (now === null) return <span className={cn("num text-ink-3", className)}>—</span>;
  const ms = target - now;
  return (
    <span className={cn("num", className)}>
      {prefix}
      {ms <= 0 ? "processing" : duration(ms)}
    </span>
  );
}

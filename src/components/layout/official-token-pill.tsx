"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn, shortAddress } from "@/lib/format";

function LiveDot() {
  return (
    <span className="relative flex size-2 shrink-0" aria-hidden>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:animate-none" />
      <span className="relative inline-flex size-2 rounded-full bg-accent" />
    </span>
  );
}

/** Live dot, ticker and contract address of the official coin; one click copies the CA. */
export function OfficialTokenPill({ mint, symbol, variant }: { mint: string; symbol: string; variant: "pill" | "strip" }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(mint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };
  const icon = copied ? (
    <Check className="size-3.5 shrink-0 text-accent" strokeWidth={2.25} aria-hidden />
  ) : (
    <Copy className="size-3.5 shrink-0 text-ink-3 transition-colors group-hover:text-ink" strokeWidth={1.75} aria-hidden />
  );
  const common = {
    type: "button" as const,
    onClick: () => void copy(),
    title: `Official $${symbol} contract address: ${mint}`,
    "aria-label": copied ? "Contract address copied" : `Copy the official $${symbol} contract address`,
  };

  if (variant === "strip") {
    return (
      <div className="border-t border-edge bg-accent/[0.05] lg:hidden">
        <button
          {...common}
          className="group mx-auto flex h-9 w-full max-w-[1200px] items-center gap-2.5 px-4 text-[12.5px] sm:px-6 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        >
          <LiveDot />
          <span className="font-semibold tracking-wide text-ink">${symbol}</span>
          <span className="h-3.5 w-px shrink-0 bg-accent/30" aria-hidden />
          <span className="min-w-0 truncate font-mono text-[12px] text-ink-2">
            <span className="text-ink-3">CA </span>
            {shortAddress(mint, 8)}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11.5px] text-ink-3 group-hover:text-ink">
            {copied ? "Copied" : "Copy"}
            {icon}
          </span>
        </button>
      </div>
    );
  }

  return (
    <button
      {...common}
      className={cn(
        "group hidden h-8 shrink-0 items-center gap-2 rounded-full border border-accent/35 bg-accent/[0.07] pl-2.5 pr-2 text-[12.5px] transition-colors lg:inline-flex",
        "hover:border-accent/70 hover:bg-accent/[0.12] focus-visible:outline-2 focus-visible:outline-accent",
      )}
    >
      <LiveDot />
      <span className="font-semibold tracking-wide text-ink">${symbol}</span>
      <span className="hidden h-3.5 w-px bg-accent/30 xl:block" aria-hidden />
      <span className="hidden font-mono text-[12px] text-ink-2 xl:inline">
        <span className="text-ink-3">CA </span>
        {shortAddress(mint, 4)}
      </span>
      {icon}
    </button>
  );
}

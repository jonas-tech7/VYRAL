"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TERMS_VERSION } from "@/lib/legal";

const ACK_KEY = `vyral:trade-risk:${TERMS_VERSION}`;

function hasAck(): boolean {
  try {
    return window.localStorage.getItem(ACK_KEY) === "1";
  } catch {
    return false;
  }
}

function saveAck() {
  try {
    window.localStorage.setItem(ACK_KEY, "1");
  } catch {
    /* storage unavailable: the dialog simply shows again next time */
  }
}

type Venue = "Jupiter" | "pump.fun";
type Side = "Buy" | "Sell" | "Trade";

/**
 * Buy / Sell on Jupiter, plus the coin's page on pump.fun for coins launched
 * there. Before the first trade (per Terms version and browser), the user
 * confirms they understand the risks and that the trade happens on a
 * third-party service, not on VYRAL.
 */
export function TradeButtons({ buyUrl, sellUrl, pumpUrl, symbol }: { buyUrl: string; sellUrl: string; pumpUrl?: string | null; symbol: string }) {
  const [pending, setPending] = useState<{ url: string; side: Side; venue: Venue } | null>(null);
  const [accepted, setAccepted] = useState(false);

  const open = (url: string) => window.open(url, "_blank", "noopener,noreferrer");
  const start = (url: string, side: Side, venue: Venue = "Jupiter") => {
    if (hasAck()) return open(url);
    setAccepted(false);
    setPending({ url, side, venue });
  };
  const venue = pending?.venue ?? "Jupiter";

  return (
    <>
      <button type="button" onClick={() => start(buyUrl, "Buy")} className={buttonClass("primary", "md")}>
        Buy <ArrowUpRight className="size-3.5" />
      </button>
      <button type="button" onClick={() => start(sellUrl, "Sell")} className={buttonClass("secondary", "md")}>
        Sell <ArrowUpRight className="size-3.5" />
      </button>
      {pumpUrl ? (
        <button type="button" onClick={() => start(pumpUrl, "Trade", "pump.fun")} className={buttonClass("secondary", "md")}>
          pump.fun <ArrowUpRight className="size-3.5" />
        </button>
      ) : null}
      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={`Before you ${pending?.side === "Sell" ? "sell" : pending?.side === "Trade" ? "trade" : "buy"} $${symbol}`}
        description={`Trades happen on ${venue}, an independent service. VYRAL does not execute trades and never holds your funds.`}
      >
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13px] leading-relaxed text-ink-2 marker:text-ink-4">
          <li>Tokens like this are highly speculative and can lose all of their value, quickly and permanently.</li>
          <li>Prices can be extremely volatile, and you may not be able to sell.</li>
          <li>Blockchain transactions cannot be reversed.</li>
          <li>Nothing on VYRAL is financial advice, and nobody promises you any return.</li>
        </ul>
        <label className="mt-5 flex cursor-pointer items-start gap-2.5 text-[13px] leading-relaxed text-ink-2">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-1 accent-[#2cf59e]" />
          <span>
            I understand these risks and that I trade on a third-party service at my own risk. I accept the{" "}
            <Link href="/legal/terms" target="_blank" className="text-ink underline decoration-edge-strong underline-offset-2 hover:decoration-accent">
              Terms of Use
            </Link>
            .
          </span>
        </label>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setPending(null)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!accepted}
            onClick={() => {
              if (!pending) return;
              saveAck();
              open(pending.url);
              setPending(null);
            }}
          >
            Continue to {venue} <ArrowUpRight className="size-3.5" />
          </Button>
        </div>
      </Dialog>
    </>
  );
}

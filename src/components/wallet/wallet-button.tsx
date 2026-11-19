"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { WalletAvatar } from "@/components/ui/token-avatar";
import { cn, shortAddress } from "@/lib/format";
import { useAuth } from "./auth-provider";

export function WalletButton({ className }: { className?: string }) {
  const { status, wallet, role, openWalletModal, signIn, signOut, markUserConnect } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => () => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (status === "loading") {
    return <div className={cn("h-9 w-[136px] rounded-md border border-edge", className)} aria-hidden />;
  }

  if (!wallet) {
    return (
      <Button
        variant="secondary"
        className={className}
        onClick={() => {
          markUserConnect();
          openWalletModal();
        }}
      >
        Connect Wallet
      </Button>
    );
  }

  if (status === "connected_unverified" || status === "signing") {
    return (
      <Button variant="secondary" className={className} loading={status === "signing"} onClick={() => void signIn()}>
        {status === "signing" ? "Check wallet…" : "Verify wallet"}
      </Button>
    );
  }

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex h-9 items-center gap-2 rounded-md border border-edge-strong px-2.5 text-[13px] text-ink transition-colors hover:bg-overlay"
      >
        <WalletAvatar wallet={wallet} size={18} />
        <span className="font-mono text-[12.5px]">{shortAddress(wallet, 4)}</span>
        <ChevronDown className={cn("size-3.5 text-ink-3 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-[calc(100%+6px)] z-50 w-56 animate-fade-in rounded-lg border border-edge-strong bg-overlay p-1 shadow-[0_16px_40px_rgba(0,0,0,0.55)]">
          <div className="px-3 pb-2 pt-2">
            <p className="text-[11.5px] text-ink-3">Signed in as</p>
            <p className="mt-0.5 font-mono text-[12px] text-ink">{shortAddress(wallet, 6)}</p>
          </div>
          <div className="my-1 h-px bg-edge" />
          <MenuLink href={`/creators/${wallet}`} onSelect={() => setOpen(false)}>
            Creator profile
          </MenuLink>
          <MenuLink href="/account" onSelect={() => setOpen(false)}>
            Account &amp; rewards
          </MenuLink>
          {role ? (
            <MenuLink href="/admin" onSelect={() => setOpen(false)}>
              Admin
            </MenuLink>
          ) : null}
          <div className="my-1 h-px bg-edge" />
          <button
            role="menuitem"
            onClick={() => void signOut()}
            className="flex h-9 w-full items-center rounded-md px-3 text-left text-[13px] text-ink-2 transition-colors hover:bg-overlay-2 hover:text-ink"
          >
            Disconnect
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({ href, children, onSelect }: { href: string; children: React.ReactNode; onSelect: () => void }) {
  return (
    <Link role="menuitem" href={href} onClick={onSelect} className="flex h-9 items-center rounded-md px-3 text-[13px] text-ink-2 transition-colors hover:bg-overlay-2 hover:text-ink">
      {children}
    </Link>
  );
}

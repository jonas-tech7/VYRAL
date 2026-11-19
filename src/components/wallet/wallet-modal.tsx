"use client";

import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Dialog } from "@/components/ui/dialog";
import { useAuth } from "./auth-provider";

const RECOMMENDED = [
  { name: "Phantom", url: "https://phantom.com/download" },
  { name: "Solflare", url: "https://solflare.com/download" },
];

export function WalletModal() {
  const { wallets, select, connecting } = useWallet();
  const { walletModalOpen, closeWalletModal, markUserConnect } = useAuth();

  const detected = wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);
  const missing = RECOMMENDED.filter((r) => !detected.some((w) => w.adapter.name.toLowerCase() === r.name.toLowerCase()));

  return (
    <Dialog
      open={walletModalOpen}
      onClose={closeWalletModal}
      title="Connect a wallet"
      description="Connect a Solana wallet, then sign a message to verify ownership. Signing never creates a transaction or moves funds."
    >
      <ul className="flex flex-col gap-1.5">
        {detected.map((w) => (
          <li key={w.adapter.name}>
            <button
              type="button"
              disabled={connecting}
              onClick={() => {
                markUserConnect();
                select(w.adapter.name as WalletName);
                closeWalletModal();
              }}
              className="flex h-12 w-full items-center gap-3 rounded-md border border-edge px-3.5 text-left text-[14px] text-ink transition-colors hover:border-edge-strong hover:bg-overlay disabled:opacity-50"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- wallet-provided data URI icon */}
              <img src={w.adapter.icon} alt="" width={22} height={22} className="rounded-[5px]" />
              <span className="flex-1">{w.adapter.name}</span>
              <span className="text-[12px] text-ink-3">Detected</span>
            </button>
          </li>
        ))}
        {missing.map((r) => (
          <li key={r.name}>
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-12 w-full items-center gap-3 rounded-md border border-edge px-3.5 text-[14px] text-ink-2 transition-colors hover:border-edge-strong hover:bg-overlay hover:text-ink"
            >
              <span className="inline-flex size-[22px] items-center justify-center rounded-[5px] bg-overlay-2 text-[11px] font-semibold text-ink-3">
                {r.name[0]}
              </span>
              <span className="flex-1">{r.name}</span>
              <span className="inline-flex items-center gap-1 text-[12px] text-ink-3">
                Install <ArrowUpRight className="size-3" />
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[12px] leading-relaxed text-ink-3">
        Any wallet supporting the Solana Wallet Standard is detected automatically. VYRAL never asks for your seed phrase or private key. By connecting,
        you accept the{" "}
        <Link href="/legal/terms" onClick={closeWalletModal} className="text-ink-2 underline decoration-edge-strong underline-offset-2 hover:text-ink">
          Terms of Use
        </Link>{" "}
        and the{" "}
        <Link href="/legal/privacy" onClick={closeWalletModal} className="text-ink-2 underline decoration-edge-strong underline-offset-2 hover:text-ink">
          Privacy Policy
        </Link>
        .
      </p>
    </Dialog>
  );
}

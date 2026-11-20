"use client";

import type { WalletError } from "@solana/wallet-adapter-base";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { clusterApiUrl } from "@solana/web3.js";
import { useCallback, useMemo, type ReactNode } from "react";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { AuthProvider } from "@/components/wallet/auth-provider";
import { WalletModal } from "@/components/wallet/wallet-modal";

function Wallets({ children }: { children: ReactNode }) {
  const toast = useToast();
  const endpoint = useMemo(() => {
    // Tolerates stray spaces or quotes; anything that is not an http(s) URL falls back to the public endpoint.
    const custom = (process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "").trim().replace(/^["']|["']$/g, "");
    const cluster = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "").trim() === "mainnet-beta" ? "mainnet-beta" : "devnet";
    if (/^https?:\/\//.test(custom)) return custom;
    if (custom) console.warn("NEXT_PUBLIC_SOLANA_RPC_URL must start with https://; using the public endpoint.");
    return clusterApiUrl(cluster);
  }, []);
  const onError = useCallback(
    (error: WalletError) => {
      if (/reject|cancel|declin/i.test(error.message ?? "")) return;
      toast.push({
        tone: "negative",
        title: "Wallet error",
        description: error.message || error.name,
      });
    },
    [toast],
  );
  // Wallet Standard wallets (Phantom, Solflare, Backpack, …) register themselves; no adapters needed.
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect onError={onError}>
        <AuthProvider>
          {children}
          <WalletModal />
        </AuthProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <Wallets>{children}</Wallets>
    </ToastProvider>
  );
}

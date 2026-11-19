"use client";

import bs58 from "bs58";
import { useWallet } from "@solana/wallet-adapter-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { useToast } from "@/components/ui/toast";

type Role = "admin" | "reviewer" | null;
type Status = "loading" | "signed_out" | "connected_unverified" | "signing" | "signed_in";

type AuthApi = {
  status: Status;
  wallet: string | null;
  role: Role;
  /** Prompts the wallet for a sign-in signature (no transaction, no fee). */
  signIn: () => Promise<boolean>;
  /** Resolves true once the connected wallet has a verified session. Opens the wallet picker if needed. */
  ensureSignedIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
  openWalletModal: () => void;
  closeWalletModal: () => void;
  walletModalOpen: boolean;
  /** Marks the next connection as user-initiated so sign-in is requested right away. */
  markUserConnect: () => void;
  /** Signs an arbitrary server-issued message with the connected wallet. */
  signText: (message: string) => Promise<string>;
};

const AuthCtx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { publicKey, connected, signMessage, disconnect } = useWallet();
  const router = useRouter();
  const toast = useToast();
  const [session, setSession] = useState<{ wallet: string | null; role: Role } | null>(null);
  const [signing, setSigning] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const userConnect = useRef(false);
  const pending = useRef<Array<(ok: boolean) => void>>([]);

  const connectedWallet = connected && publicKey ? publicKey.toBase58() : null;

  useEffect(() => {
    api<{ wallet: string | null; role: Role }>("/api/auth/session")
      .then(setSession)
      .catch(() => setSession({ wallet: null, role: null }));
  }, []);

  const signText = useCallback(
    async (message: string) => {
      if (!signMessage) throw new Error("This wallet does not support message signing.");
      const sig = await signMessage(new TextEncoder().encode(message));
      return bs58.encode(sig);
    },
    [signMessage],
  );

  const signIn = useCallback(async (): Promise<boolean> => {
    if (!connectedWallet) return false;
    setSigning(true);
    try {
      const { nonce, message } = await api<{ nonce: string; message: string }>(`/api/auth/nonce?wallet=${connectedWallet}`);
      const signature = await signText(message);
      const res = await api<{ wallet: string; role: Role }>("/api/auth/verify", {
        body: { wallet: connectedWallet, nonce, signature },
      });
      setSession(res);
      router.refresh();
      return true;
    } catch (e) {
      const rejected = e instanceof Error && /reject|declin|cancel/i.test(e.message);
      toast.push({
        tone: rejected ? "neutral" : "negative",
        title: rejected ? "Signature request cancelled" : "Sign-in failed",
        description: rejected ? "Sign the message to verify wallet ownership." : e instanceof ApiClientError || e instanceof Error ? e.message : undefined,
      });
      return false;
    } finally {
      setSigning(false);
    }
  }, [connectedWallet, signText, router, toast]);

  // Reconcile the wallet connection with the server session.
  useEffect(() => {
    if (!session) return;
    if (!connectedWallet) {
      for (const r of pending.current.splice(0)) r(false);
      return;
    }
    if (session.wallet === connectedWallet) {
      for (const r of pending.current.splice(0)) r(true);
      return;
    }
    if (session.wallet && session.wallet !== connectedWallet) {
      // Wallet switched: end the old session first, then reconcile again.
      api("/api/auth/logout", { method: "POST" })
        .catch(() => {})
        .finally(() => setSession({ wallet: null, role: null }));
      return;
    }
    if (userConnect.current || pending.current.length > 0) {
      userConnect.current = false;
      void signIn().then((ok) => {
        for (const r of pending.current.splice(0)) r(ok);
      });
    }
  }, [connectedWallet, session, signIn]);

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    setSession({ wallet: null, role: null });
    await disconnect().catch(() => {});
    router.refresh();
  }, [disconnect, router]);

  const ensureSignedIn = useCallback(async (): Promise<boolean> => {
    if (connectedWallet && session?.wallet === connectedWallet) return true;
    if (connectedWallet) return signIn();
    return new Promise<boolean>((resolve) => {
      pending.current.push(resolve);
      userConnect.current = true;
      setWalletModalOpen(true);
    });
  }, [connectedWallet, session, signIn]);

  const status: Status = !session
    ? "loading"
    : signing
      ? "signing"
      : connectedWallet && session.wallet === connectedWallet
        ? "signed_in"
        : connectedWallet
          ? "connected_unverified"
          : "signed_out";

  const value = useMemo<AuthApi>(
    () => ({
      status,
      wallet: connectedWallet,
      role: status === "signed_in" ? (session?.role ?? null) : null,
      signIn,
      ensureSignedIn,
      signOut,
      walletModalOpen,
      openWalletModal: () => setWalletModalOpen(true),
      closeWalletModal: () => {
        setWalletModalOpen(false);
        if (!connectedWallet) for (const r of pending.current.splice(0)) r(false);
      },
      markUserConnect: () => {
        userConnect.current = true;
      },
      signText,
    }),
    [status, connectedWallet, session, signIn, ensureSignedIn, signOut, walletModalOpen, signText],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

"use client";

import { X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/format";

type Toast = { id: number; title: string; description?: string; tone: "neutral" | "positive" | "negative" };
type ToastApi = { push: (t: Omit<Toast, "id" | "tone"> & { tone?: Toast["tone"] }) => void };

const Ctx = createContext<ToastApi>({ push: () => {} });

/** Responses to the user's own actions only (never ambient "activity" notifications). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback<ToastApi["push"]>(
    (t) => {
      const id = Date.now() + Math.random();
      setToasts((ts) => [...ts.slice(-2), { id, tone: t.tone ?? "neutral", title: t.title, description: t.description }]);
      setTimeout(() => dismiss(id), t.tone === "negative" ? 7000 : 4500);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ push }), [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5 sm:w-[360px]">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "negative" ? "alert" : "status"}
            className="pointer-events-auto flex w-full animate-fade-in items-start gap-3 rounded-lg border border-edge-strong bg-overlay px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
          >
            <span
              className={cn(
                "mt-[7px] size-1.5 shrink-0 rounded-full",
                t.tone === "positive" ? "bg-accent" : t.tone === "negative" ? "bg-negative" : "bg-ink-3",
              )}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium text-ink">{t.title}</p>
              {t.description ? <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">{t.description}</p> : null}
            </div>
            <button onClick={() => dismiss(t.id)} className="text-ink-3 hover:text-ink" aria-label="Dismiss">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}

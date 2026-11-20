import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { route } from "@/lib/api/handler";
import { createLookupTable, resetForLaunch, simulateLaunch } from "@/lib/services/go-live";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_lookup_table") }),
  z.object({ action: z.literal("simulate_launch") }),
  z.object({ action: z.literal("reset_demo_data"), confirm: z.boolean().default(false), phrase: z.string().optional() }),
]);

/**
 * These steps fail mostly on configuration (signer key, RPC, balance), so the
 * administrator sees the actual reason instead of a generic error. Long
 * base58/hex runs are masked in case a library echoes key material.
 */
async function explained<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    const raw = e instanceof Error ? e.message : String(e);
    const message = raw.replace(/[1-9A-HJ-NP-Za-km-z]{60,}|[0-9a-f]{60,}/g, "[redacted]").slice(0, 400);
    console.error("[go-live]", e);
    throw new ApiError(502, "step_failed", message || "Unknown error");
  }
}

export const POST = route(
  { auth: "admin", rateLimit: { name: "admin-go-live", limit: 30, windowSec: 3600, by: "wallet" } },
  async ({ json, viewer }) => {
    const input = await json(body);
    if (input.action === "create_lookup_table") return explained(() => createLookupTable(viewer!.wallet));
    if (input.action === "simulate_launch") return explained(() => simulateLaunch());
    const confirm = input.confirm && input.phrase === "REMOVE DEMO DATA";
    return explained(() => resetForLaunch(viewer!.wallet, confirm));
  },
);

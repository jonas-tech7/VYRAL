import { z } from "zod";
import { route } from "@/lib/api/handler";
import { createLookupTable, resetForLaunch, simulateLaunch } from "@/lib/services/go-live";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_lookup_table") }),
  z.object({ action: z.literal("simulate_launch") }),
  z.object({ action: z.literal("reset_demo_data"), confirm: z.boolean().default(false), phrase: z.string().optional() }),
]);

export const POST = route(
  { auth: "admin", rateLimit: { name: "admin-go-live", limit: 30, windowSec: 3600, by: "wallet" } },
  async ({ json, viewer }) => {
    const input = await json(body);
    if (input.action === "create_lookup_table") return createLookupTable(viewer!.wallet);
    if (input.action === "simulate_launch") return simulateLaunch();
    const confirm = input.confirm && input.phrase === "REMOVE DEMO DATA";
    return resetForLaunch(viewer!.wallet, confirm);
  },
);

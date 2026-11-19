import { z } from "zod";
import { route } from "@/lib/api/handler";
import { applyGlobalCurveToAll } from "@/lib/services/admin";

const body = z.object({ note: z.string().trim().min(3, "Describe the reason for this change").max(1000) });

export const POST = route({ auth: "admin", rateLimit: { name: "admin", limit: 60, windowSec: 3600, by: "wallet" } }, async ({ json, viewer, ipHash }) => {
  const { note } = await json(body);
  return applyGlobalCurveToAll(note, { wallet: viewer!.wallet, role: viewer!.role, ipHash });
});

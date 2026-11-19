import { z } from "zod";
import { route } from "@/lib/api/handler";
import { applyCalibration } from "@/lib/services/admin";

const body = z.object({ note: z.string().trim().min(3, "Describe the reason for this change").max(1000) });

export const POST = route({ auth: "admin", rateLimit: { name: "admin-config", limit: 120, windowSec: 3600, by: "wallet" } }, async ({ json, viewer, ipHash }) => {
  const { note } = await json(body);
  return applyCalibration({ wallet: viewer!.wallet, role: viewer!.role, ipHash }, note);
});

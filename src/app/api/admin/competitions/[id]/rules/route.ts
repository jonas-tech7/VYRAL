import { z } from "zod";
import { route } from "@/lib/api/handler";
import { rewardCurveSchema } from "@/lib/config/schemas";
import { updateCompetitionRules } from "@/lib/services/admin";

const body = z.object({
  payoutIntervalHours: z.number().int().optional(),
  minEligibleViews: z.number().int().min(0).max(100_000_000).optional(),
  rewardCurve: rewardCurveSchema.optional(),
  note: z.string().trim().min(3, "Describe the reason for this change").max(1000),
});

export const PATCH = route<{ id: string }>({ auth: "admin", rateLimit: { name: "admin", limit: 600, windowSec: 3600, by: "wallet" } }, async ({ params, json, viewer, ipHash }) => {
  const { note, ...patch } = await json(body);
  return updateCompetitionRules(z.string().uuid().parse(params.id), patch, note, { wallet: viewer!.wallet, role: viewer!.role, ipHash });
});

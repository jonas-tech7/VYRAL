import { z } from "zod";
import { route } from "@/lib/api/handler";
import { setCompetitionStatus } from "@/lib/services/admin";

const body = z.object({ status: z.enum(["active", "paused", "ended"]), reason: z.string().trim().min(3, "Add a reason").max(500) });

export const POST = route<{ id: string }>({ auth: "admin", rateLimit: { name: "admin", limit: 600, windowSec: 3600, by: "wallet" } }, async ({ params, json, viewer, ipHash }) => {
  const { status, reason } = await json(body);
  return setCompetitionStatus(z.string().uuid().parse(params.id), status, reason, { wallet: viewer!.wallet, role: viewer!.role, ipHash });
});

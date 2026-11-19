import { z } from "zod";
import { route } from "@/lib/api/handler";
import { resolveDispute } from "@/lib/services/disputes";

const body = z.object({ status: z.enum(["resolved", "rejected"]), resolution: z.string().trim().min(5, "Write a resolution for the creator").max(2000) });

export const POST = route<{ id: string }>({ auth: "reviewer", rateLimit: { name: "admin", limit: 600, windowSec: 3600, by: "wallet" } }, async ({ params, json, viewer, ipHash }) => {
  const { status, resolution } = await json(body);
  return resolveDispute(z.string().uuid().parse(params.id), status, resolution, { wallet: viewer!.wallet, role: viewer!.role, ipHash });
});

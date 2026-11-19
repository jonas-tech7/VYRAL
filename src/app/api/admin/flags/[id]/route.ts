import { z } from "zod";
import { route } from "@/lib/api/handler";
import { resolveFlag } from "@/lib/services/admin";

const body = z.object({ decision: z.enum(["dismiss", "confirm"]), note: z.string().trim().min(3, "Add a short note").max(1000) });

export const POST = route<{ id: string }>({ auth: "reviewer", rateLimit: { name: "admin", limit: 600, windowSec: 3600, by: "wallet" } }, async ({ params, json, viewer, ipHash }) => {
  const { decision, note } = await json(body);
  return resolveFlag(z.string().uuid().parse(params.id), decision, note, { wallet: viewer!.wallet, role: viewer!.role, ipHash });
});

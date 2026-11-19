import { z } from "zod";
import { route } from "@/lib/api/handler";
import { voidPayout } from "@/lib/services/payouts";

const body = z.object({ note: z.string().trim().min(10, "Explain why this payout is voided").max(1000) });

export const POST = route<{ id: string }>({ auth: "admin", rateLimit: { name: "admin-payout", limit: 120, windowSec: 3600, by: "wallet" } }, async ({ params, json, viewer, ipHash }) => {
  const { note } = await json(body);
  return voidPayout(z.string().uuid().parse(params.id), { wallet: viewer!.wallet, role: viewer!.role, ipHash }, note);
});

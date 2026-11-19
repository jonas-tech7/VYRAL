import { z } from "zod";
import { route } from "@/lib/api/handler";
import { requeuePayout } from "@/lib/services/payouts";

const body = z.object({ note: z.string().trim().min(3, "Add a note").max(1000) });

export const POST = route<{ id: string }>({ auth: "admin", rateLimit: { name: "admin-payout", limit: 120, windowSec: 3600, by: "wallet" } }, async ({ params, json, viewer, ipHash }) => {
  const { note } = await json(body);
  return requeuePayout(z.string().uuid().parse(params.id), { wallet: viewer!.wallet, role: viewer!.role, ipHash }, "retry", note);
});

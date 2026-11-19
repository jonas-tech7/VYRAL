import { z } from "zod";
import { route } from "@/lib/api/handler";
import { settleManually } from "@/lib/services/payouts";

const body = z.object({ signature: z.string().trim().min(64).max(100), note: z.string().trim().min(10, "Explain the manual settlement").max(1000) });

export const POST = route<{ id: string }>({ auth: "admin", rateLimit: { name: "admin-payout", limit: 120, windowSec: 3600, by: "wallet" } }, async ({ params, json, viewer, ipHash }) => {
  const { signature, note } = await json(body);
  return settleManually(z.string().uuid().parse(params.id), signature, { wallet: viewer!.wallet, role: viewer!.role, ipHash }, note);
});

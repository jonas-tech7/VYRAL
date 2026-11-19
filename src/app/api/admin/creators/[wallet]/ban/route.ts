import { z } from "zod";
import { badRequest, route } from "@/lib/api/handler";
import { setCreatorBan } from "@/lib/services/admin";
import { isValidAddress } from "@/lib/solana/keys";

const body = z.object({ banned: z.boolean(), reason: z.string().trim().min(5, "Add a reason").max(500) });

export const POST = route<{ wallet: string }>({ auth: "admin", rateLimit: { name: "admin", limit: 120, windowSec: 3600, by: "wallet" } }, async ({ params, json, viewer, ipHash }) => {
  if (!isValidAddress(params.wallet)) throw badRequest("Invalid wallet");
  const { banned, reason } = await json(body);
  return setCreatorBan(params.wallet, banned, reason, { wallet: viewer!.wallet, role: viewer!.role, ipHash });
});

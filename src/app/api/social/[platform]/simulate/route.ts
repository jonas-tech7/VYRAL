import { z } from "zod";
import { badRequest, route } from "@/lib/api/handler";
import { isPlatform } from "@/lib/domain/platforms";
import { simulateLink } from "@/lib/services/social-accounts";

const body = z.object({ handle: z.string().trim().min(2).max(41) });

/** Demo mode only: links a handle without OAuth (refused when SOCIAL_PROVIDER=live). */
export const POST = route<{ platform: string }>(
  { auth: "user", rateLimit: { name: "social-simulate", limit: 30, windowSec: 3600, by: "wallet" } },
  async ({ params, json, viewer }) => {
    if (!isPlatform(params.platform)) throw badRequest("Unknown platform");
    const { handle } = await json(body);
    return simulateLink(viewer!.wallet, params.platform, handle);
  },
);

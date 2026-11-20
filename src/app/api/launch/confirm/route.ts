import { z } from "zod";
import { route } from "@/lib/api/handler";
import { confirmLaunch } from "@/lib/services/launch";

const body = z.object({ launchId: z.string().uuid(), signature: z.string().min(64).max(200) });

export const POST = route(
  { auth: "user", rateLimit: { name: "launch-confirm", limit: 30, windowSec: 3600, by: "wallet" } },
  async ({ json, viewer }) => {
    const { launchId, signature } = await json(body);
    return confirmLaunch(viewer!.wallet, launchId, signature, viewer);
  },
);

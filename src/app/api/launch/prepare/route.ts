import { route } from "@/lib/api/handler";
import { launchInputSchema, prepareLaunch } from "@/lib/services/launch";

export const POST = route(
  { auth: "user", rateLimit: { name: "launch-prepare", limit: 10, windowSec: 3600, by: "wallet" } },
  async ({ json, viewer }) => {
    const input = await json(launchInputSchema);
    return prepareLaunch(viewer!.wallet, input);
  },
);

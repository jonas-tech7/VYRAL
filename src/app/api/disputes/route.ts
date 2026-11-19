import { route } from "@/lib/api/handler";
import { createDispute, disputeInputSchema } from "@/lib/services/disputes";

export const POST = route(
  { auth: "user", rateLimit: { name: "dispute", limit: 10, windowSec: 86_400, by: "wallet" } },
  async ({ json, viewer }) => createDispute(viewer!.wallet, await json(disputeInputSchema)),
);

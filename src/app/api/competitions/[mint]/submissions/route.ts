import { z } from "zod";
import { route } from "@/lib/api/handler";
import { createSubmission } from "@/lib/services/submissions";

const body = z.object({ url: z.string().trim().min(8).max(2048) });

export const POST = route<{ mint: string }>(
  { auth: "user", rateLimit: { name: "submission", limit: 20, windowSec: 3600, by: "wallet" } },
  async ({ json, params, viewer, ipHash }) => {
    const { url } = await json(body);
    return createSubmission(viewer!.wallet, params.mint, url, ipHash);
  },
);

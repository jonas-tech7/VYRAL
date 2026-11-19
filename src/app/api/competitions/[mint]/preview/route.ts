import { z } from "zod";
import { route } from "@/lib/api/handler";
import { previewSubmission } from "@/lib/services/submissions";

const body = z.object({ url: z.string().trim().min(8).max(2048) });

export const POST = route<{ mint: string }>(
  { auth: "user", rateLimit: { name: "submission-preview", limit: 60, windowSec: 3600, by: "wallet" } },
  async ({ json, params, viewer }) => {
    const { url } = await json(body);
    return previewSubmission(viewer!.wallet, params.mint, url);
  },
);

import { z } from "zod";
import { ApiError, route } from "@/lib/api/handler";
import { verifyAndConsumeNonce } from "@/lib/auth/siws";
import { requeuePayout } from "@/lib/services/payouts";

const body = z.object({ nonce: z.string().min(10).max(100), signature: z.string().min(64).max(200) });

/** Creator-initiated claim for a reward whose automatic transfer needs attention. Requires a fresh wallet signature. */
export const POST = route<{ payoutId: string }>(
  { auth: "user", rateLimit: { name: "claim", limit: 10, windowSec: 3600, by: "wallet" } },
  async ({ params, json, viewer, ipHash }) => {
    const { nonce, signature } = await json(body);
    const v = await verifyAndConsumeNonce(nonce, viewer!.wallet, "claim", signature);
    if (!v.ok) throw new ApiError(401, `claim_${v.reason}`, "Claim signature could not be verified.");
    if (!v.message.includes(`Payout: ${params.payoutId}`)) throw new ApiError(400, "invalid_request", "Signature does not match this reward.");
    return requeuePayout(params.payoutId, { wallet: viewer!.wallet, role: viewer!.role, ipHash }, "claim");
  },
);

import { eq } from "drizzle-orm";
import { ApiError, route } from "@/lib/api/handler";
import { buildClaimMessage, issueNonce } from "@/lib/auth/siws";
import { db, schema } from "@/lib/db";

export const POST = route<{ payoutId: string }>(
  { auth: "user", rateLimit: { name: "claim-message", limit: 20, windowSec: 3600, by: "wallet" } },
  async ({ params, viewer }) => {
    if (!/^[0-9a-f-]{36}$/.test(params.payoutId)) throw new ApiError(400, "invalid_request", "Invalid payout id");
    const [p] = await db.select().from(schema.payouts).where(eq(schema.payouts.id, params.payoutId));
    if (!p || p.recipientWallet !== viewer!.wallet) throw new ApiError(404, "not_found", "Reward not found.");
    if (p.status !== "requires_attention") throw new ApiError(409, "invalid_state", "This reward is not claimable.");
    const amountSol = (p.amountLamports / 1e9).toFixed(4);
    return issueNonce(viewer!.wallet, "claim", (nonce, issuedAt) =>
      buildClaimMessage({ wallet: viewer!.wallet, nonce, payoutId: p.id, amountSol, issuedAt }),
    );
  },
);

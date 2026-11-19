import { z } from "zod";
import { ApiError, route } from "@/lib/api/handler";
import { buildSignInMessage, issueNonce } from "@/lib/auth/siws";
import { rateLimit } from "@/lib/security/rate-limit";
import { isValidAddress } from "@/lib/solana/keys";

const query = z.object({ wallet: z.string().refine(isValidAddress, "Invalid wallet address") });

export const GET = route({ rateLimit: { name: "auth-nonce", limit: 30, windowSec: 60, by: "ip" } }, async ({ query: q }) => {
  const { wallet } = q(query);
  // Per-wallet limit in addition to the per-client one.
  const rl = await rateLimit(`auth-nonce:w:${wallet}`, 20, 60);
  if (!rl.allowed) {
    throw new ApiError(429, "rate_limited", "Too many sign-in attempts for this wallet. Please wait a minute.", {
      retryAfter: Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000),
    });
  }
  const { nonce, message, expiresAt } = await issueNonce(wallet, "sign_in", (nonce, issuedAt, expiresAt) =>
    buildSignInMessage({ wallet, nonce, issuedAt, expiresAt }),
  );
  return { nonce, message, expiresAt };
});

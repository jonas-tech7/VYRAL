import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, route } from "@/lib/api/handler";
import { createSession, sessionCookie, viewerFromToken } from "@/lib/auth/session";
import { verifyAndConsumeNonce } from "@/lib/auth/siws";
import { isValidAddress } from "@/lib/solana/keys";

const body = z.object({
  wallet: z.string().refine(isValidAddress, "Invalid wallet address"),
  nonce: z.string().min(10).max(100),
  signature: z.string().min(64).max(200),
});

export const POST = route({ rateLimit: { name: "auth-verify", limit: 20, windowSec: 60, by: "ip" } }, async ({ json, req, ipHash }) => {
  const { wallet, nonce, signature } = await json(body);
  const result = await verifyAndConsumeNonce(nonce, wallet, "sign_in", signature);
  if (!result.ok) {
    const message =
      result.reason === "expired" ? "Sign-in request expired. Try again." : result.reason === "bad_signature" ? "Signature could not be verified." : "Invalid sign-in request.";
    throw new ApiError(401, `auth_${result.reason}`, message);
  }
  const { token, expiresAt } = await createSession(wallet, { ipHash, userAgent: req.headers.get("user-agent") });
  const viewer = await viewerFromToken(token);
  if (!viewer) throw new ApiError(403, "suspended", "This wallet is suspended.");
  const res = NextResponse.json({ wallet: viewer.wallet, role: viewer.role });
  res.cookies.set(sessionCookie(token, expiresAt));
  res.headers.set("Cache-Control", "no-store");
  return res;
});

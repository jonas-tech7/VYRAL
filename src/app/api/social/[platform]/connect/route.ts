import { NextResponse } from "next/server";
import { badRequest, route } from "@/lib/api/handler";
import { isPlatform } from "@/lib/domain/platforms";
import { startOAuth } from "@/lib/services/social-accounts";

/** Starts OAuth linking (top-level navigation from the account page). */
export const GET = route<{ platform: string }>(
  { auth: "user", rateLimit: { name: "social-connect", limit: 30, windowSec: 3600, by: "wallet" } },
  async ({ params, viewer, req }) => {
    if (!isPlatform(params.platform)) throw badRequest("Unknown platform");
    const url = await startOAuth(viewer!.wallet, params.platform, req.nextUrl.searchParams.get("returnTo"));
    return NextResponse.redirect(url);
  },
);

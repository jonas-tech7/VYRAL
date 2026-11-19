import { NextResponse, type NextRequest } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { SESSION_COOKIE, viewerFromToken } from "@/lib/auth/session";
import { isPlatform } from "@/lib/domain/platforms";
import { env } from "@/lib/env";
import { completeOAuth } from "@/lib/services/social-accounts";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/social/[platform]/callback">) {
  const { platform } = await ctx.params;
  const back = (path: string, status: string, message?: string) => {
    const url = new URL(path, env.APP_URL);
    url.searchParams.set("link", status);
    if (message) url.searchParams.set("message", message.slice(0, 160));
    return NextResponse.redirect(url);
  };
  if (!isPlatform(platform)) return back("/account", "error", "Unknown platform");
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (req.nextUrl.searchParams.get("error") || !code || !state) return back("/account", "cancelled");
  try {
    const viewer = await viewerFromToken(req.cookies.get(SESSION_COOKIE)?.value);
    const returnTo = await completeOAuth(platform, state, code, viewer?.wallet ?? null);
    return back(returnTo, "ok");
  } catch (e) {
    return back("/account", "error", e instanceof ApiError ? e.message : "Linking failed. Please try again.");
  }
}

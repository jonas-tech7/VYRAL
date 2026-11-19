/**
 * Route-handler wrapper applying, in order:
 *   1. CSRF protection for state-changing methods (Origin / Sec-Fetch-Site)
 *   2. Session resolution from the HttpOnly cookie
 *   3. Role-based authorisation
 *   4. Rate limiting (per wallet or per hashed IP)
 *   5. Body size limit and schema validation helpers
 *   6. Uniform error responses (no internal details leak)
 */
import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type z } from "zod";
import { ConfigValidationError } from "@/lib/config/store";
import { env } from "@/lib/env";
import { SESSION_COOKIE, hasRole, viewerFromToken, type Role, type Viewer } from "@/lib/auth/session";
import { hmacHex } from "@/lib/security/crypto";
import { rateLimit } from "@/lib/security/rate-limit";
import { ApiError, badRequest } from "./errors";

export { ApiError, badRequest, conflict, forbidden, notFound, unprocessable } from "./errors";

type AuthRequirement = "user" | Role;

type RouteOptions = {
  auth?: AuthRequirement;
  rateLimit?: { name: string; limit: number; windowSec: number; by?: "ip" | "wallet" };
  maxBodyBytes?: number;
};

export type RouteContext<P> = {
  req: NextRequest;
  params: P;
  viewer: Viewer | null;
  ipHash: string | null;
  json: <S extends z.ZodType>(schema: S) => Promise<z.infer<S>>;
  query: <S extends z.ZodType>(schema: S) => z.infer<S>;
};

export function clientIp(req: NextRequest): string | null {
  if (!env.TRUST_PROXY) return null;
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
}

function assertSameOrigin(req: NextRequest) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new ApiError(403, "forbidden", "Cross-site request blocked");
  const origin = req.headers.get("origin");
  if (!origin) throw new ApiError(403, "forbidden", "Missing Origin header");
  const allowed = new Set([new URL(env.APP_URL).origin]);
  const host = req.headers.get("host");
  if (host) allowed.add(`${req.nextUrl.protocol}//${host}`);
  if (!allowed.has(origin)) throw new ApiError(403, "forbidden", "Cross-origin request blocked");
}

function errorResponse(e: unknown): NextResponse {
  if (e instanceof ApiError) {
    const res = NextResponse.json({ error: { code: e.code, message: e.message, details: e.details ?? null } }, { status: e.status });
    if (e.status === 429 && typeof e.details === "object" && e.details && "retryAfter" in e.details) {
      res.headers.set("Retry-After", String((e.details as { retryAfter: number }).retryAfter));
    }
    return res;
  }
  if (e instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_request",
          message: e.issues[0]?.message ?? "Invalid request",
          details: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      { status: 400 },
    );
  }
  if (e instanceof ConfigValidationError) {
    return NextResponse.json({ error: { code: "invalid_config", message: e.issues[0]?.message ?? "Invalid configuration", details: e.issues } }, { status: 400 });
  }
  console.error("[api] unhandled error", e);
  return NextResponse.json({ error: { code: "internal_error", message: "Something went wrong. Please try again." } }, { status: 500 });
}

export function route<P = Record<string, string>>(
  opts: RouteOptions,
  handler: (ctx: RouteContext<P>) => Promise<unknown>,
) {
  return async (req: NextRequest, routeCtx: { params: Promise<P> }): Promise<Response> => {
    try {
      const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      if (mutating) assertSameOrigin(req);

      const viewer = await viewerFromToken(req.cookies.get(SESSION_COOKIE)?.value);
      if (opts.auth) {
        if (!viewer) throw new ApiError(401, "unauthorized", "Connect and sign in with your wallet first.");
        if (opts.auth !== "user" && !hasRole(viewer, opts.auth)) throw new ApiError(403, "forbidden", "You don't have access to this action.");
      }

      const ip = clientIp(req);
      const ipHash = ip ? hmacHex(ip) : null;

      if (opts.rateLimit) {
        const by = opts.rateLimit.by ?? (viewer ? "wallet" : "ip");
        const perWallet = by === "wallet" && viewer;
        const subject = perWallet ? `w:${viewer.wallet}` : `ip:${ipHash ?? "unknown"}`;
        // Without a trusted proxy header every client shares one "unknown" bucket;
        // give it a higher ceiling so one client can't lock everyone out
        // (set TRUST_PROXY=true behind a reverse proxy for per-client limits).
        const limit = perWallet || ipHash ? opts.rateLimit.limit : opts.rateLimit.limit * 20;
        const rl = await rateLimit(`${opts.rateLimit.name}:${subject}`, limit, opts.rateLimit.windowSec);
        if (!rl.allowed) {
          throw new ApiError(429, "rate_limited", "Too many requests. Please wait and try again.", {
            retryAfter: Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000),
          });
        }
      }

      const maxBody = opts.maxBodyBytes ?? 64 * 1024;
      const ctx: RouteContext<P> = {
        req,
        params: await routeCtx.params,
        viewer,
        ipHash,
        json: async (schema) => {
          const len = Number(req.headers.get("content-length") ?? 0);
          if (len > maxBody) throw new ApiError(413, "payload_too_large", "Request body too large");
          const text = await req.text();
          if (text.length > maxBody) throw new ApiError(413, "payload_too_large", "Request body too large");
          let body: unknown;
          try {
            body = text ? JSON.parse(text) : {};
          } catch {
            throw badRequest("Request body must be valid JSON");
          }
          return schema.parse(body);
        },
        query: (schema) => schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries())),
      };

      const result = await handler(ctx);
      if (result instanceof Response) return result;
      const res = NextResponse.json(result ?? { ok: true });
      res.headers.set("Cache-Control", "no-store");
      return res;
    } catch (e) {
      // Let Next.js control-flow signals (prerender bail-out, redirect, notFound) propagate.
      unstable_rethrow(e);
      return errorResponse(e);
    }
  };
}

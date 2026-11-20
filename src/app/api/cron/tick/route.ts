import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { runDueJobs } from "@/lib/jobs";
import { safeEqual } from "@/lib/security/crypto";

/**
 * Runs due background jobs (serverless replacement for `npm run worker`).
 * Call once a minute with "Authorization: Bearer <CRON_SECRET>" or "?key=<CRON_SECRET>".
 */
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = env.CRON_SECRET;
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? req.nextUrl.searchParams.get("key") ?? "";
  if (!secret || !safeEqual(provided, secret)) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Invalid cron secret" } }, { status: 401 });
  }
  // Vercel stops the function at maxDuration (60 s): no new job starts after 35 s; the rest run next minute.
  const results = await runDueJobs(new Date(), 35_000);
  return NextResponse.json({ ok: true, results }, { headers: { "Cache-Control": "no-store" } });
}

import { NextResponse } from "next/server";
import { route } from "@/lib/api/handler";
import { SESSION_COOKIE, revokeSession } from "@/lib/auth/session";

export const POST = route({}, async ({ req }) => {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ name: SESSION_COOKIE, value: "", path: "/", expires: new Date(0), httpOnly: true, sameSite: "lax" });
  return res;
});

import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { randomToken, sha256Hex } from "@/lib/security/crypto";

export const SESSION_COOKIE = "vyral_session";
const SESSION_TTL_MS = 7 * 86_400_000;

export type Role = "admin" | "reviewer";

export type Viewer = {
  wallet: string;
  role: Role | null;
  sessionId: string;
};

export async function createSession(wallet: string, meta: { ipHash: string | null; userAgent: string | null }) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db
    .insert(schema.users)
    .values({ wallet, lastSeenAt: new Date() })
    .onConflictDoUpdate({ target: schema.users.wallet, set: { lastSeenAt: new Date() } });
  await db.insert(schema.sessions).values({
    tokenHash: sha256Hex(token),
    wallet,
    expiresAt,
    ipHash: meta.ipHash,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt };
}

/** Resolves a session token to a viewer. Banned users lose their session. */
export async function viewerFromToken(token: string | undefined | null): Promise<Viewer | null> {
  if (!token || token.length > 200) return null;
  const rows = await db
    .select({
      sessionId: schema.sessions.id,
      wallet: schema.sessions.wallet,
      isBanned: schema.users.isBanned,
      role: schema.admins.role,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.wallet, schema.sessions.wallet))
    .leftJoin(schema.admins, eq(schema.admins.wallet, schema.sessions.wallet))
    .where(
      and(eq(schema.sessions.tokenHash, sha256Hex(token)), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, new Date())),
    )
    .limit(1);
  const row = rows[0];
  if (!row || row.isBanned) return null;
  return { wallet: row.wallet, role: row.role ?? null, sessionId: row.sessionId };
}

export async function revokeSession(token: string): Promise<void> {
  await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.tokenHash, sha256Hex(token)));
}

export async function revokeAllSessions(wallet: string): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.sessions.wallet, wallet), isNull(schema.sessions.revokedAt)));
}

export function sessionCookie(token: string, expiresAt: Date) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

export async function pruneSessions(): Promise<void> {
  await db
    .delete(schema.sessions)
    .where(or(lt(schema.sessions.expiresAt, new Date()), lt(schema.sessions.revokedAt, new Date(Date.now() - 86_400_000))));
}

export function hasRole(viewer: Viewer | null, required: Role): boolean {
  if (!viewer?.role) return false;
  return required === "reviewer" ? viewer.role === "reviewer" || viewer.role === "admin" : viewer.role === "admin";
}

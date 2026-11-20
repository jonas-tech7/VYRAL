/**
 * Social account linking. A link proves the wallet owner controls a platform
 * account; video ownership is checked against these links at submission.
 */
import { and, eq, isNull, lt } from "drizzle-orm";
import { ApiError } from "@/lib/api/errors";
import { db, schema } from "@/lib/db";
import { env, isProductionDeployment } from "@/lib/env";
import type { Platform } from "@/lib/domain/platforms";
import { simulatedAccountId } from "@/lib/providers/social/mock";
import {
  buildAuthorizeUrl,
  createPkce,
  exchangeCode,
  fetchIdentity,
  oauthConfigured,
  refreshTokens,
} from "@/lib/providers/social/oauth";
import type { LinkedAccountCredentials } from "@/lib/providers/social/types";
import { decryptSecret, encryptSecret, randomToken } from "@/lib/security/crypto";
import { audit } from "./audit";

export type LinkedAccount = {
  id: string;
  platform: Platform;
  handle: string;
  platformAccountId: string;
  verificationMethod: string;
  verifiedAt: Date;
};

export async function listLinkedAccounts(wallet: string): Promise<LinkedAccount[]> {
  const rows = await db
    .select()
    .from(schema.socialAccounts)
    .where(and(eq(schema.socialAccounts.wallet, wallet), isNull(schema.socialAccounts.revokedAt)));
  return rows.map((r) => ({
    id: r.id,
    platform: r.platform as Platform,
    handle: r.handle,
    platformAccountId: r.platformAccountId,
    verificationMethod: r.verificationMethod,
    verifiedAt: r.verifiedAt,
  }));
}

async function upsertLink(
  wallet: string,
  platform: Platform,
  identity: { platformAccountId: string; handle: string },
  method: "oauth" | "simulated",
  tokens?: { accessToken: string; refreshToken: string | null; expiresAt: Date | null; scopes: string | null },
): Promise<LinkedAccount> {
  return db.transaction(async (tx) => {
    const [taken] = await tx
      .select({ wallet: schema.socialAccounts.wallet, id: schema.socialAccounts.id })
      .from(schema.socialAccounts)
      .where(
        and(
          eq(schema.socialAccounts.platform, platform),
          eq(schema.socialAccounts.platformAccountId, identity.platformAccountId),
          isNull(schema.socialAccounts.revokedAt),
        ),
      );
    if (taken && taken.wallet !== wallet) {
      throw new ApiError(409, "account_linked_elsewhere", "This account is already linked to a different wallet.");
    }
    const values = {
      handle: identity.handle,
      accessTokenEnc: tokens ? encryptSecret(tokens.accessToken) : null,
      refreshTokenEnc: tokens?.refreshToken ? encryptSecret(tokens.refreshToken) : null,
      tokenExpiresAt: tokens?.expiresAt ?? null,
      scopes: tokens?.scopes ?? null,
      verificationMethod: method,
      verifiedAt: new Date(),
    };
    let id: string;
    if (taken) {
      await tx.update(schema.socialAccounts).set(values).where(eq(schema.socialAccounts.id, taken.id));
      id = taken.id;
    } else {
      // One live link per platform per wallet: replace any previous one.
      await tx
        .update(schema.socialAccounts)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.socialAccounts.wallet, wallet), eq(schema.socialAccounts.platform, platform), isNull(schema.socialAccounts.revokedAt)));
      const [row] = await tx
        .insert(schema.socialAccounts)
        .values({ wallet, platform, platformAccountId: identity.platformAccountId, ...values })
        .returning({ id: schema.socialAccounts.id });
      id = row.id;
    }
    await audit(tx, {
      actor: wallet,
      action: "social.link",
      targetType: "social_account",
      targetId: id,
      after: { platform, handle: identity.handle, method },
    });
    return {
      id,
      platform,
      handle: identity.handle,
      platformAccountId: identity.platformAccountId,
      verificationMethod: method,
      verifiedAt: values.verifiedAt,
    };
  });
}

/** Development only: links a handle without OAuth while the mock provider is active. */
export async function simulateLink(wallet: string, platform: Platform, handle: string): Promise<LinkedAccount> {
  if (env.SOCIAL_PROVIDER !== "mock" || isProductionDeployment) throw new ApiError(400, "not_available", "Simulated linking is only available in demo mode.");
  const clean = handle.replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9._]{2,40}$/.test(clean)) throw new ApiError(400, "invalid_request", "Enter a valid handle.");
  return upsertLink(wallet, platform, { platformAccountId: simulatedAccountId(platform, clean), handle: clean }, "simulated");
}

export async function startOAuth(wallet: string, platform: Platform, returnTo: string | null): Promise<string> {
  if (env.SOCIAL_PROVIDER !== "live" || !oauthConfigured(platform)) {
    throw new ApiError(400, "not_configured", `${platform} account linking is not configured.`);
  }
  const state = randomToken(24);
  const { verifier, challenge } = createPkce();
  await db.insert(schema.oauthStates).values({
    state,
    wallet,
    platform,
    codeVerifier: verifier,
    returnTo: returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/account",
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  return buildAuthorizeUrl(platform, state, challenge);
}

export async function completeOAuth(platform: Platform, state: string, code: string, sessionWallet: string | null) {
  const [row] = await db.delete(schema.oauthStates).where(eq(schema.oauthStates.state, state)).returning();
  if (!row || row.platform !== platform || row.expiresAt < new Date()) throw new ApiError(400, "invalid_state", "Link request expired. Please try again.");
  if (!sessionWallet || sessionWallet !== row.wallet) throw new ApiError(401, "unauthorized", "Sign in with the same wallet to finish linking.");
  const tokens = await exchangeCode(platform, code, row.codeVerifier);
  const identity = await fetchIdentity(platform, tokens.accessToken);
  await upsertLink(row.wallet, platform, identity, "oauth", tokens);
  return row.returnTo ?? "/account";
}

export async function unlinkAccount(wallet: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const res = await tx
      .update(schema.socialAccounts)
      .set({ revokedAt: new Date(), accessTokenEnc: null, refreshTokenEnc: null })
      .where(and(eq(schema.socialAccounts.id, id), eq(schema.socialAccounts.wallet, wallet), isNull(schema.socialAccounts.revokedAt)))
      .returning({ id: schema.socialAccounts.id, platform: schema.socialAccounts.platform });
    if (!res.length) throw new ApiError(404, "not_found", "Linked account not found.");
    await audit(tx, { actor: wallet, action: "social.unlink", targetType: "social_account", targetId: id, before: res[0] });
  });
}

/** Decrypted credentials, refreshed when close to expiry. */
export async function credentialsFor(socialAccountId: string): Promise<LinkedAccountCredentials | null> {
  const [acc] = await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, socialAccountId));
  if (!acc || acc.revokedAt) return null;
  let accessToken = acc.accessTokenEnc ? decryptSecret(acc.accessTokenEnc) : null;
  if (accessToken && acc.tokenExpiresAt && acc.tokenExpiresAt.getTime() - Date.now() < 5 * 60_000) {
    try {
      const refreshed = await refreshTokens(acc.platform as Platform, acc.refreshTokenEnc ? decryptSecret(acc.refreshTokenEnc) : null, accessToken);
      accessToken = refreshed.accessToken;
      await db
        .update(schema.socialAccounts)
        .set({
          accessTokenEnc: encryptSecret(refreshed.accessToken),
          refreshTokenEnc: refreshed.refreshToken ? encryptSecret(refreshed.refreshToken) : acc.refreshTokenEnc,
          tokenExpiresAt: refreshed.expiresAt,
        })
        .where(eq(schema.socialAccounts.id, acc.id));
    } catch (e) {
      console.warn(`[social] token refresh failed for ${acc.id}`, e instanceof Error ? e.message : e);
    }
  }
  return { socialAccountId: acc.id, platformAccountId: acc.platformAccountId, handle: acc.handle, accessToken };
}

export async function linkedCredentials(wallet: string, platform: Platform): Promise<LinkedAccountCredentials | null> {
  const [acc] = await db
    .select({ id: schema.socialAccounts.id })
    .from(schema.socialAccounts)
    .where(and(eq(schema.socialAccounts.wallet, wallet), eq(schema.socialAccounts.platform, platform), isNull(schema.socialAccounts.revokedAt)));
  return acc ? credentialsFor(acc.id) : null;
}

export async function pruneOAuthStates(): Promise<void> {
  await db.delete(schema.oauthStates).where(lt(schema.oauthStates.expiresAt, new Date()));
}

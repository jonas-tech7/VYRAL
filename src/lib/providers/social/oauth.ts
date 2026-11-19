/**
 * OAuth 2.0 account linking for social platforms (authorization code + PKCE).
 *
 * Linking proves that the wallet owner controls the platform account that
 * published a video, and grants the read scopes needed for authorised
 * metrics. Tokens are encrypted at rest (lib/security/crypto.ts).
 */
import { createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import type { Platform } from "@/lib/domain/platforms";
import { INSTAGRAM_GRAPH_VERSION } from "./live";
import { ProviderError } from "./types";

export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string | null;
};

export type AccountIdentity = { platformAccountId: string; handle: string };

type OAuthDef = {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientId: () => string | undefined;
  clientSecret: () => string | undefined;
  clientIdParam: string;
  scopeSeparator: string;
  extraAuthorizeParams?: Record<string, string>;
  basicAuth?: boolean;
  identity: (token: string) => Promise<AccountIdentity>;
};

const json = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ProviderError(`OAuth request failed (${res.status})`, res.status === 401 ? "unauthorized" : "upstream");
  return body;
};

const DEFS: Record<Platform, OAuthDef> = {
  youtube: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
    clientId: () => env.GOOGLE_CLIENT_ID,
    clientSecret: () => env.GOOGLE_CLIENT_SECRET,
    clientIdParam: "client_id",
    scopeSeparator: " ",
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
    identity: async (token) => {
      const body = (await json("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
        headers: { Authorization: `Bearer ${token}` },
      })) as { items?: Array<{ id: string; snippet?: { title?: string; customUrl?: string } }> };
      const ch = body.items?.[0];
      if (!ch) throw new ProviderError("No YouTube channel found for this Google account", "not_found");
      return { platformAccountId: ch.id, handle: ch.snippet?.customUrl?.replace(/^@/, "") ?? ch.snippet?.title ?? ch.id };
    },
  },
  tiktok: {
    authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    scopes: ["user.info.basic", "user.info.profile", "video.list"],
    clientId: () => env.TIKTOK_CLIENT_KEY,
    clientSecret: () => env.TIKTOK_CLIENT_SECRET,
    clientIdParam: "client_key",
    scopeSeparator: ",",
    identity: async (token) => {
      const body = (await json("https://open.tiktokapis.com/v2/user/info/?fields=open_id,username,display_name", {
        headers: { Authorization: `Bearer ${token}` },
      })) as { data?: { user?: { open_id?: string; username?: string; display_name?: string } } };
      const u = body.data?.user;
      if (!u?.open_id) throw new ProviderError("TikTok account lookup failed", "upstream");
      return { platformAccountId: u.open_id, handle: u.username ?? u.display_name ?? u.open_id };
    },
  },
  instagram: {
    authorizeUrl: "https://www.instagram.com/oauth/authorize",
    tokenUrl: "https://api.instagram.com/oauth/access_token",
    scopes: ["instagram_business_basic", "instagram_business_manage_insights"],
    clientId: () => env.INSTAGRAM_CLIENT_ID,
    clientSecret: () => env.INSTAGRAM_CLIENT_SECRET,
    clientIdParam: "client_id",
    scopeSeparator: ",",
    identity: async (token) => {
      const body = (await json(
        `https://graph.instagram.com/${INSTAGRAM_GRAPH_VERSION}/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`,
      )) as { user_id?: string; id?: string; username?: string };
      const id = body.user_id ?? body.id;
      if (!id) throw new ProviderError("Instagram account lookup failed", "upstream");
      return { platformAccountId: String(id), handle: body.username ?? String(id) };
    },
  },
  x: {
    authorizeUrl: "https://x.com/i/oauth2/authorize",
    tokenUrl: "https://api.x.com/2/oauth2/token",
    scopes: ["tweet.read", "users.read", "offline.access"],
    clientId: () => env.X_CLIENT_ID,
    clientSecret: () => env.X_CLIENT_SECRET,
    clientIdParam: "client_id",
    scopeSeparator: " ",
    basicAuth: true,
    identity: async (token) => {
      const body = (await json("https://api.x.com/2/users/me", { headers: { Authorization: `Bearer ${token}` } })) as {
        data?: { id?: string; username?: string };
      };
      if (!body.data?.id) throw new ProviderError("X account lookup failed", "upstream");
      return { platformAccountId: body.data.id, handle: body.data.username ?? body.data.id };
    },
  },
};

export function oauthConfigured(platform: Platform): boolean {
  const d = DEFS[platform];
  return Boolean(d.clientId() && d.clientSecret());
}

export function redirectUri(platform: Platform): string {
  return new URL(`/api/social/${platform}/callback`, env.APP_URL).toString();
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildAuthorizeUrl(platform: Platform, state: string, codeChallenge: string): string {
  const d = DEFS[platform];
  const clientId = d.clientId();
  if (!clientId) throw new ProviderError(`${platform} OAuth is not configured`, "not_configured");
  const params = new URLSearchParams({
    [d.clientIdParam]: clientId,
    response_type: "code",
    redirect_uri: redirectUri(platform),
    scope: d.scopes.join(d.scopeSeparator),
    state,
    ...(platform === "instagram" ? {} : { code_challenge: codeChallenge, code_challenge_method: "S256" }),
    ...d.extraAuthorizeParams,
  });
  return `${d.authorizeUrl}?${params}`;
}

async function tokenRequest(platform: Platform, params: Record<string, string>): Promise<TokenSet> {
  const d = DEFS[platform];
  const clientId = d.clientId();
  const clientSecret = d.clientSecret();
  if (!clientId || !clientSecret) throw new ProviderError(`${platform} OAuth is not configured`, "not_configured");
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (d.basicAuth) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    body.set("client_id", clientId);
  } else {
    body.set(d.clientIdParam, clientId);
    body.set("client_secret", clientSecret);
  }
  const res = (await json(d.tokenUrl, { method: "POST", headers, body })) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!res.access_token) throw new ProviderError("Token exchange failed", "unauthorized");
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token ?? null,
    expiresAt: res.expires_in ? new Date(Date.now() + res.expires_in * 1000) : null,
    scopes: res.scope ?? null,
  };
}

export async function exchangeCode(platform: Platform, code: string, codeVerifier: string): Promise<TokenSet> {
  const tokens = await tokenRequest(platform, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(platform),
    ...(platform === "instagram" ? {} : { code_verifier: codeVerifier }),
  });
  if (platform === "instagram") {
    // Exchange the short-lived token for a long-lived (~60 day) token.
    const qs = new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: DEFS.instagram.clientSecret() ?? "",
      access_token: tokens.accessToken,
    });
    const ll = (await json(`https://graph.instagram.com/access_token?${qs}`)) as { access_token?: string; expires_in?: number };
    if (ll.access_token) {
      return { ...tokens, accessToken: ll.access_token, expiresAt: ll.expires_in ? new Date(Date.now() + ll.expires_in * 1000) : null };
    }
  }
  return tokens;
}

export async function refreshTokens(platform: Platform, refreshToken: string | null, accessToken: string): Promise<TokenSet> {
  if (platform === "instagram") {
    const qs = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: accessToken });
    const body = (await json(`https://graph.instagram.com/refresh_access_token?${qs}`)) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new ProviderError("Instagram token refresh failed", "unauthorized");
    return { accessToken: body.access_token, refreshToken: null, expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : null, scopes: null };
  }
  if (!refreshToken) throw new ProviderError("No refresh token; relink the account", "unauthorized");
  return tokenRequest(platform, { grant_type: "refresh_token", refresh_token: refreshToken });
}

export function fetchIdentity(platform: Platform, accessToken: string): Promise<AccountIdentity> {
  return DEFS[platform].identity(accessToken);
}

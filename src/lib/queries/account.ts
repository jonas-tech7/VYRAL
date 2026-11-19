import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { PLATFORMS, type Platform } from "@/lib/domain/platforms";
import { oauthConfigured } from "@/lib/providers/social/oauth";
import { listLinkedAccounts } from "@/lib/services/social-accounts";
import { listPayouts } from "./public";

export async function getAccountData(wallet: string) {
  const [linked, claimable, inFlight, videos, disputes] = await Promise.all([
    listLinkedAccounts(wallet),
    listPayouts(sql`p.recipient_wallet = ${wallet} AND p.status = 'requires_attention'`, 20),
    listPayouts(sql`p.recipient_wallet = ${wallet} AND p.status IN ('pending', 'submitted')`, 20),
    db.execute(sql`
      SELECT v.id, v.platform, v.author_handle, v.status, v.status_reason, t.symbol, t.mint
      FROM videos v JOIN competitions c ON c.id = v.competition_id JOIN tokens t ON t.id = c.token_id
      WHERE v.creator_wallet = ${wallet} ORDER BY v.submitted_at DESC LIMIT 50
    `),
    db.execute(sql`
      SELECT d.id, d.category, d.message, d.status, d.resolution, d.created_at, d.resolved_at, t.symbol
      FROM disputes d LEFT JOIN competitions c ON c.id = d.competition_id LEFT JOIN tokens t ON t.id = c.token_id
      WHERE d.wallet = ${wallet} ORDER BY d.created_at DESC LIMIT 20
    `),
  ]);
  return {
    linked,
    socialMode: env.SOCIAL_PROVIDER,
    oauth: Object.fromEntries(PLATFORMS.map((p) => [p, oauthConfigured(p)])) as Record<Platform, boolean>,
    claimable,
    inFlight,
    videos: videos.rows.map((r) => {
      const x = r as Record<string, unknown>;
      return {
        id: x.id as string,
        platform: x.platform as Platform,
        authorHandle: (x.author_handle as string) ?? null,
        status: x.status as string,
        statusReason: (x.status_reason as string) ?? null,
        symbol: x.symbol as string,
        mint: x.mint as string,
      };
    }),
    disputes: disputes.rows.map((r) => {
      const x = r as Record<string, unknown>;
      return {
        id: x.id as string,
        category: x.category as string,
        message: x.message as string,
        status: x.status as string,
        resolution: (x.resolution as string) ?? null,
        createdAt: new Date(x.created_at as string),
        resolvedAt: x.resolved_at ? new Date(x.resolved_at as string) : null,
        symbol: (x.symbol as string) ?? null,
      };
    }),
  };
}

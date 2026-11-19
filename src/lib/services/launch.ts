/**
 * Token launch. Every token launched through VYRAL receives its competition
 * in the same transaction that records the token, using the protocol
 * configuration shown to the deployer before signing.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { getAllConfig } from "@/lib/config/store";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { buildTokenMetadata, coinPageUrl, launchLinkUrl } from "@/lib/launch/metadata";
import { LAUNCH_DECIMALS, LAUNCH_SUPPLY, launchProvider } from "@/lib/providers/launch";
import { storageProvider } from "@/lib/providers/storage";
import { simMarketCap, simPrice } from "@/lib/sim/market-sim";
import { audit } from "./audit";

const optionalUrl = (hosts?: string[]) =>
  z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => {
      if (!v) return true;
      try {
        const u = new URL(v);
        if (u.protocol !== "https:") return false;
        if (!hosts) return true;
        const h = u.hostname.replace(/^www\./, "");
        return hosts.includes(h);
      } catch {
        return false;
      }
    }, "Enter a valid https:// link");

export const launchInputSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(32, "Name is too long"),
  symbol: z
    .string()
    .trim()
    .transform((s) => s.replace(/^\$/, "").toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{2,10}$/, "Ticker must be 2–10 letters or digits")),
  description: z.string().trim().max(600, "Description is too long").default(""),
  imageUploadId: z.string().uuid("Upload a token image"),
  links: z
    .object({
      website: optionalUrl(),
      x: optionalUrl(["x.com", "twitter.com"]),
      telegram: optionalUrl(["t.me", "telegram.me"]),
      discord: optionalUrl(["discord.gg", "discord.com"]),
    })
    .prefault({}),
  payoutIntervalHours: z.number().int(),
  initialBuySol: z.number().min(0).max(50).default(0),
});
export type LaunchInput = z.infer<typeof launchInputSchema>;

export async function prepareLaunch(wallet: string, input: LaunchInput) {
  const configs = await getAllConfig();
  if (!configs.payouts.value.allowedIntervalsHours.includes(input.payoutIntervalHours)) {
    throw new ApiError(400, "invalid_request", "Choose one of the allowed payout intervals.");
  }
  const [upload] = await db
    .select()
    .from(schema.uploads)
    .where(and(eq(schema.uploads.id, input.imageUploadId), eq(schema.uploads.wallet, wallet)));
  if (!upload) throw new ApiError(400, "invalid_request", "Upload the token image again.");

  const absolute = (u: string) => (u.startsWith("http") ? u : new URL(u, env.APP_URL).toString());
  const provider = launchProvider();
  // Fix the address first where possible, so the metadata links to the coin's own page on VYRAL.
  const launchId = randomUUID();
  const reservedMint = provider.reserveMint ? await provider.reserveMint() : undefined;
  const vyralUrl = reservedMint ? coinPageUrl(reservedMint, env.APP_URL) : launchLinkUrl(launchId, env.APP_URL);
  const metadata = buildTokenMetadata({
    name: input.name,
    symbol: input.symbol,
    description: input.description,
    imageUrl: absolute(upload.url),
    imageContentType: upload.contentType,
    links: input.links,
    vyralUrl,
  });
  const stored = await storageProvider().put(`metadata/${randomUUID()}.json`, Buffer.from(JSON.stringify(metadata)), "application/json");
  const metadataUri = absolute(stored.url);

  const prepared = await provider.prepare({
    deployer: wallet,
    name: input.name,
    symbol: input.symbol,
    metadataUri,
    initialBuyLamports: Math.round(input.initialBuySol * 1e9),
    mint: reservedMint,
  });

  const [req] = await db
    .insert(schema.launchRequests)
    .values({
      id: launchId,
      deployerWallet: wallet,
      payload: { ...input, imageUrl: upload.url, metadataUri },
      mint: prepared.mint,
      provider: provider.id,
      intentMessage: prepared.intentMessage,
      transaction: prepared.transaction,
      expiresAt: prepared.expiresAt,
    })
    .returning({ id: schema.launchRequests.id });

  return {
    launchId: req.id,
    mint: prepared.mint,
    mode: prepared.mode,
    message: prepared.intentMessage,
    transaction: prepared.transaction,
    expiresAt: prepared.expiresAt.toISOString(),
    simulated: provider.isSimulated,
  };
}

export async function confirmLaunch(wallet: string, launchId: string, signature: string) {
  const [req] = await db.select().from(schema.launchRequests).where(eq(schema.launchRequests.id, launchId));
  if (!req || req.deployerWallet !== wallet) throw new ApiError(404, "not_found", "Launch request not found.");
  if (req.status === "confirmed") return { mint: req.mint, alreadyConfirmed: true };
  if (req.status !== "prepared") throw new ApiError(409, "invalid_state", "This launch request can no longer be confirmed.");
  if (req.expiresAt < new Date()) {
    await db.update(schema.launchRequests).set({ status: "expired" }).where(eq(schema.launchRequests.id, launchId));
    throw new ApiError(410, "expired", "This launch request expired. Start again.");
  }

  const provider = launchProvider();
  const result = await provider.confirm({
    prepared: { mint: req.mint, mode: req.transaction ? "transaction" : "message", intentMessage: req.intentMessage, transaction: req.transaction, expiresAt: req.expiresAt },
    deployer: wallet,
    signature,
  });
  if (!result.ok) throw new ApiError(422, "launch_not_verified", result.error);

  const payload = launchInputSchema.parse(req.payload);
  const p = req.payload as { imageUrl: string; metadataUri: string };
  const configs = await getAllConfig();
  const now = new Date();

  return db.transaction(async (tx) => {
    const locked = await tx.execute<{ status: string }>(sql`SELECT status FROM launch_requests WHERE id = ${launchId} FOR UPDATE`);
    if (locked.rows[0]?.status === "confirmed") return { mint: req.mint, alreadyConfirmed: true };

    await tx.insert(schema.users).values({ wallet }).onConflictDoNothing();
    const simulated = provider.isSimulated;
    const [token] = await tx
      .insert(schema.tokens)
      .values({
        mint: req.mint,
        name: payload.name,
        symbol: payload.symbol,
        description: payload.description,
        imageUrl: p.imageUrl,
        metadataUri: p.metadataUri,
        links: payload.links,
        deployerWallet: wallet,
        launchProvider: provider.id,
        isSimulated: simulated,
        poolAddress: result.poolAddress,
        launchSignature: result.launchSignature,
        decimals: LAUNCH_DECIMALS,
        totalSupply: LAUNCH_SUPPLY,
        launchedAt: now,
        ...(simulated
          ? {
              priceUsd: simPrice(req.mint, now, now),
              marketCapUsd: simMarketCap(req.mint, now, now),
              marketDataSource: "simulated",
              marketDataUpdatedAt: now,
            }
          : {}),
      })
      .returning({ id: schema.tokens.id });

    const interval = payload.payoutIntervalHours;
    const [competition] = await tx
      .insert(schema.competitions)
      .values({
        tokenId: token.id,
        status: "active",
        payoutIntervalHours: interval,
        minEligibleViews: configs.eligibility.value.minVerifiedViews,
        rewardCurve: configs.reward_curve.value,
        rulesConfigVersion: configs.reward_curve.version,
        startsAt: now,
        nextCheckpointAt: new Date(now.getTime() + interval * 3_600_000),
      })
      .returning({ id: schema.competitions.id });

    await tx
      .update(schema.launchRequests)
      .set({ status: "confirmed", tokenId: token.id, confirmedAt: now })
      .where(eq(schema.launchRequests.id, launchId));
    await audit(tx, {
      actor: wallet,
      action: "token.launch",
      targetType: "token",
      targetId: req.mint,
      after: {
        name: payload.name,
        symbol: payload.symbol,
        competitionId: competition.id,
        payoutIntervalHours: interval,
        rewardCurve: configs.reward_curve.value,
        rewardCurveVersion: configs.reward_curve.version,
        minEligibleViews: configs.eligibility.value.minVerifiedViews,
        simulated,
      },
    });
    return { mint: req.mint, alreadyConfirmed: false };
  });
}

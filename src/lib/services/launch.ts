/**
 * Token launch. Every token launched through VYRAL receives its competition
 * in the same transaction that records the token, using the protocol
 * configuration shown to the deployer before signing.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { hasRole, type Viewer } from "@/lib/auth/session";
import { getAllConfig, updateConfig } from "@/lib/config/store";
import { db, schema } from "@/lib/db";
import { env, launchesOpen } from "@/lib/env";
import { buildTokenMetadata, coinPageUrl, launchLinkUrl } from "@/lib/launch/metadata";
import { TERMS_VERSION } from "@/lib/legal";
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
  // pump.fun limits the name to 32 BYTES (emoji and accented letters take several).
  name: z
    .string()
    .trim()
    .min(2, "Name is too short")
    .refine((s) => Buffer.byteLength(s, "utf8") <= 32, "Name is too long (32 bytes max; emoji and accents count as several)"),
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
  /** Version of the Terms of Use the deployer accepted; stored with the launch request. */
  termsVersion: z.literal(TERMS_VERSION, { error: "Accept the current Terms of Use to launch." }),
  /** Admin only: register this launch as the official $VYRAL coin (header contract address). */
  official: z.boolean().optional(),
});
export type LaunchInput = z.infer<typeof launchInputSchema>;

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
/** Random lowercase id (storage keys are lowercase; 12 chars ≈ 62 bits). */
function shortId(n: number): string {
  return Array.from(randomBytes(n), (b) => ALPHABET[b % 36]).join("");
}

export async function prepareLaunch(wallet: string, input: LaunchInput, viewer?: Viewer | null) {
  if (!launchesOpen) throw new ApiError(503, "launches_closed", "Launching opens soon.");
  if (input.official && !hasRole(viewer ?? null, "admin")) throw new ApiError(403, "forbidden", "Only administrators can launch the official coin.");
  if (input.official && launchProvider().isSimulated) throw new ApiError(400, "simulated", "The official coin can only be launched on-chain, not in the demonstration environment.");
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
  // Short metadata link (makevyral.com/m/<12 chars>): the URI is part of the launch transaction, and every byte
  // saved keeps the coin, its locked fee split and the deployer's first buy inside one transaction.
  const metadataId = shortId(12);
  const stored = await storageProvider().put(`m/${metadataId}.json`, Buffer.from(JSON.stringify(metadata)), "application/json");
  const metadataUri = stored.url.startsWith("/api/files/") ? absolute(`/m/${metadataId}`) : stored.url;

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
    followUp: prepared.followUp ?? [],
    expiresAt: prepared.expiresAt.toISOString(),
    simulated: provider.isSimulated,
  };
}

export async function confirmLaunch(wallet: string, launchId: string, signature: string, viewer?: Viewer | null) {
  const [req] = await db.select().from(schema.launchRequests).where(eq(schema.launchRequests.id, launchId));
  if (!req || req.deployerWallet !== wallet) throw new ApiError(404, "not_found", "Launch request not found.");
  if (req.status === "confirmed") return { mint: req.mint, alreadyConfirmed: true };
  if (req.status !== "prepared") throw new ApiError(409, "invalid_state", "This launch request can no longer be confirmed.");
  // The expiry limits how long a launch can be SIGNED. A transaction that landed is verified on-chain below
  // (mint key, deployer and locked split), so a slow wallet prompt must not orphan a coin that already exists.
  if (req.expiresAt < new Date() && !req.transaction) {
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
  return recordConfirmedLaunch(req, result, viewer);
}

/**
 * The stored launch request, parsed with the Terms version it was accepted under (a later Terms update must not
 * make an already-signed launch impossible to record).
 */
const storedLaunchPayloadSchema = launchInputSchema.extend({ termsVersion: z.string() });

type LaunchRequestRow = typeof schema.launchRequests.$inferSelect;

/** Records a verified launch: token, competition, audit entry and (for the official coin) the header address. */
async function recordConfirmedLaunch(
  req: LaunchRequestRow,
  result: { launchSignature: string | null; poolAddress: string | null; launchedAt?: Date | null },
  viewer?: Viewer | null,
) {
  const provider = launchProvider();
  const launchId = req.id;
  const wallet = req.deployerWallet;
  const payload = storedLaunchPayloadSchema.parse(req.payload);
  const p = req.payload as { imageUrl: string; metadataUri: string };
  const configs = await getAllConfig();
  const now = new Date();

  const launched = await db.transaction(async (tx) => {
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
        // The coin's real creation time: videos published after it qualify, even while the confirmation was in flight.
        launchedAt: result.launchedAt && result.launchedAt < now ? result.launchedAt : now,
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

  // The official $VYRAL coin: its address goes into the site header straight away (admins only, real launches only; both re-checked here).
  if (!launched.alreadyConfirmed && payload.official && !provider.isSimulated && hasRole(viewer ?? null, "admin")) {
    await updateConfig(
      "platform_token",
      { mint: req.mint, symbol: payload.symbol },
      { wallet, role: viewer?.role ?? null },
      `Official ${payload.symbol} coin launched through VYRAL`,
    );
  }
  return launched;
}

/**
 * Launches whose transaction landed on-chain but whose confirmation never
 * reached VYRAL (closed tab, lost connection, wallet error after sending).
 *
 * The coin is recognised from its on-chain state, not from a signature: the
 * mint key exists only on VYRAL's server and only ever signed the prepared
 * launch, so a coin with that mint whose fee split is locked exactly to this
 * deployer and VYRAL's recipients is that launch. Requests whose coin was
 * never created are marked expired once their transaction can no longer land.
 * The official-coin flag is applied when the deployer is still an admin.
 */
export async function reconcileLaunches(now = new Date()) {
  const provider = launchProvider();
  if (provider.isSimulated || !provider.confirmFromChain) return { skipped: true };
  const pending = await db
    .select()
    .from(schema.launchRequests)
    .where(
      and(
        eq(schema.launchRequests.status, "prepared"),
        sql`${schema.launchRequests.transaction} IS NOT NULL`,
        sql`${schema.launchRequests.createdAt} < ${new Date(now.getTime() - 3 * 60_000)}`,
      ),
    )
    .orderBy(asc(schema.launchRequests.createdAt))
    .limit(25);
  let recorded = 0;
  let expired = 0;
  for (const r of pending) {
    try {
      const res = await provider.confirmFromChain({ mint: r.mint, deployer: r.deployerWallet });
      if (res.ok) {
        // The official-coin flag was only accepted from an admin at prepare; it still applies if they are one now.
        const [admin] = (r.payload as { official?: boolean }).official
          ? await db.select({ role: schema.admins.role }).from(schema.admins).where(eq(schema.admins.wallet, r.deployerWallet))
          : [];
        const deployer: Viewer | null = admin ? { wallet: r.deployerWallet, role: admin.role, sessionId: "reconcile" } : null;
        await recordConfirmedLaunch(r, { ...res, launchedAt: res.launchedAt ?? r.createdAt }, deployer);
        recorded++;
      } else if (res.missing && r.createdAt.getTime() < now.getTime() - 15 * 60_000) {
        // The coin does not exist and its transaction's blockhash expired long ago: it can never land.
        await db
          .update(schema.launchRequests)
          .set({ status: "expired" })
          .where(and(eq(schema.launchRequests.id, r.id), eq(schema.launchRequests.status, "prepared")));
        expired++;
      } else if (!res.missing) {
        console.error(`[launch] reconcile ${r.mint}: ${res.error}`);
        // A coin exists but does not verify (should never happen for a VYRAL-prepared mint): stop retrying after a
        // week so it cannot hold a slot forever. It stays visible in the database for an administrator.
        if (r.createdAt.getTime() < now.getTime() - 7 * 86_400_000) {
          await db
            .update(schema.launchRequests)
            .set({ status: "failed" })
            .where(and(eq(schema.launchRequests.id, r.id), eq(schema.launchRequests.status, "prepared")));
        }
      }
    } catch (err) {
      console.error(`[launch] reconcile ${r.mint} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return { checked: pending.length, recorded, expired };
}

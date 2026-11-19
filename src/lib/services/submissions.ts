/**
 * Video submission.
 *
 * Every rule is evaluated server-side on submit (the preview is advisory).
 * Publication time comes from the platform (or the clearly-labelled
 * simulation in demo mode), never from the client.
 *
 * Pre-launch videos are recorded as rejected rather than silently dropped:
 * the (platform, video id) unique key then blocks resubmission forever, and
 * the stored content fingerprint lets the fraud engine catch re-uploads of
 * the same footage under a new URL.
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { ApiError } from "@/lib/api/errors";
import { getConfig } from "@/lib/config/store";
import { db, schema } from "@/lib/db";
import { mentionsContractAddress } from "@/lib/domain/mentions";
import { PLATFORM_LABEL, type Platform } from "@/lib/domain/platforms";
import { socialProvider } from "@/lib/providers/social";
import { ProviderError, type ResolvedVideo } from "@/lib/providers/social/types";
import { parseVideoUrl, type ParsedVideoUrl } from "@/lib/providers/social/url";
import { audit } from "./audit";
import { evaluateVideoFraud } from "./fraud";
import { rescoreVideo } from "./scoring";
import { linkedCredentials, listLinkedAccounts } from "./social-accounts";

export type CheckId =
  | "competition_open"
  | "not_previously_submitted"
  | "short_form"
  | "published_after_launch"
  | "mentions_contract_address"
  | "account_ownership"
  | "submission_limit"
  | "creator_standing";

export type SubmissionCheck = { id: CheckId; ok: boolean; label: string; detail: string | null };

export type SubmissionPreview = {
  video: {
    platform: Platform;
    videoId: string;
    canonicalUrl: string;
    authorHandle: string;
    authorAccountId: string;
    publishedAt: string;
    publishedAtSource: ResolvedVideo["publishedAtSource"];
    views: number | null;
    likes: number | null;
    comments: number | null;
  };
  checks: SubmissionCheck[];
  canSubmit: boolean;
  ownership: { required: boolean; linked: boolean; linkedHandle: string | null; expectedHandle: string; simulated: boolean };
  launchedAt: string;
  simulated: boolean;
};

const fmt = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16) + " UTC";

async function competitionByMint(mint: string) {
  const [row] = await db
    .select({ competition: schema.competitions, token: schema.tokens })
    .from(schema.competitions)
    .innerJoin(schema.tokens, eq(schema.tokens.id, schema.competitions.tokenId))
    .where(eq(schema.tokens.mint, mint));
  if (!row) throw new ApiError(404, "not_found", "Competition not found.");
  return row;
}

function providerErrorToApi(e: unknown): never {
  if (e instanceof ProviderError) {
    const status = e.code === "rate_limited" ? 503 : e.code === "not_configured" ? 503 : 422;
    throw new ApiError(status, `provider_${e.code}`, e.message);
  }
  throw e;
}

async function parseWithExpansion(url: string): Promise<ParsedVideoUrl> {
  const parsed = parseVideoUrl(url);
  if (parsed.ok) return parsed.value;
  if (parsed.shortLink) {
    const expanded = await socialProvider()
      .expandShortLink(parsed.shortLink.platform, parsed.shortLink.url)
      .catch(providerErrorToApi);
    const again = parseVideoUrl(expanded);
    if (again.ok) return again.value;
  }
  throw new ApiError(422, "invalid_url", parsed.error === "short_link" ? "Paste the full video link." : parsed.error);
}

async function evaluate(wallet: string, mint: string, url: string) {
  const { competition, token } = await competitionByMint(mint);
  const parsed = await parseWithExpansion(url);
  const eligibility = (await getConfig("eligibility")).value;

  const [existing] = await db
    .select({ id: schema.videos.id, status: schema.videos.status, competitionId: schema.videos.competitionId })
    .from(schema.videos)
    .where(and(eq(schema.videos.platform, parsed.platform), eq(schema.videos.platformVideoId, parsed.videoId)));

  const credentials = await linkedCredentials(wallet, parsed.platform);
  const resolved = await socialProvider()
    .resolve(parsed, credentials, { contractAddress: token.mint, symbol: token.symbol })
    .catch(providerErrorToApi);
  const mentionsCa = mentionsContractAddress(resolved.postText, token.mint);

  const linked = (await listLinkedAccounts(wallet)).find((a) => a.platform === parsed.platform) ?? null;
  const owns = Boolean(linked && linked.platformAccountId === resolved.authorAccountId);

  const [{ n: activeSubs }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.videos)
    .where(
      and(eq(schema.videos.competitionId, competition.id), eq(schema.videos.creatorWallet, wallet), ne(schema.videos.status, "rejected")),
    );
  const [user] = await db.select({ isBanned: schema.users.isBanned }).from(schema.users).where(eq(schema.users.wallet, wallet));

  const checks: SubmissionCheck[] = [
    {
      id: "competition_open",
      ok: competition.status === "active",
      label: "Competition is accepting entries",
      detail: competition.status === "paused" ? "Paused by administrators" : competition.status === "ended" ? "Competition has ended" : null,
    },
    {
      id: "not_previously_submitted",
      ok: !existing,
      label: "Not previously submitted",
      detail: existing ? (existing.status === "rejected" ? "This video was submitted before and rejected." : "This video is already entered.") : null,
    },
    {
      id: "short_form",
      ok: resolved.isShortForm,
      label: `Eligible format (${PLATFORM_LABEL[parsed.platform]})`,
      detail: resolved.isShortForm ? null : "Only short-form videos qualify.",
    },
    {
      id: "published_after_launch",
      ok: resolved.publishedAt.getTime() > token.launchedAt.getTime(),
      label: "Published after the token launch",
      detail: `Published ${fmt(resolved.publishedAt)} · launched ${fmt(token.launchedAt)}`,
    },
    {
      id: "mentions_contract_address",
      ok: mentionsCa,
      label: "Post contains the coin's contract address",
      detail: mentionsCa
        ? "Found in the caption, title or description."
        : resolved.postText === null
          ? "The platform did not return the post's text. Try again in a few minutes."
          : `Add ${token.mint} to the caption, title or description, then submit again.`,
    },
    {
      id: "account_ownership",
      ok: !eligibility.requireLinkedAccount || owns,
      label: `Published by your linked ${PLATFORM_LABEL[parsed.platform]} account`,
      detail: owns
        ? `@${linked!.handle}`
        : linked
          ? `Video author is @${resolved.authorHandle}; your linked account is @${linked.handle}.`
          : `Link @${resolved.authorHandle} to this wallet to prove ownership.`,
    },
    {
      id: "submission_limit",
      ok: Number(activeSubs) < eligibility.maxSubmissionsPerCreatorPerCompetition,
      label: "Within the per-creator entry limit",
      detail: `${activeSubs} of ${eligibility.maxSubmissionsPerCreatorPerCompetition} entries used`,
    },
    {
      id: "creator_standing",
      ok: !user?.isBanned,
      label: "Creator in good standing",
      detail: user?.isBanned ? "This wallet is suspended." : null,
    },
  ];

  return { competition, token, parsed, resolved, checks, existing, linked, owns, eligibility };
}

export async function previewSubmission(wallet: string, mint: string, url: string): Promise<SubmissionPreview> {
  const r = await evaluate(wallet, mint, url);
  return {
    video: {
      platform: r.parsed.platform,
      videoId: r.parsed.videoId,
      canonicalUrl: r.resolved.canonicalUrl,
      authorHandle: r.resolved.authorHandle,
      authorAccountId: r.resolved.authorAccountId,
      publishedAt: r.resolved.publishedAt.toISOString(),
      publishedAtSource: r.resolved.publishedAtSource,
      views: r.resolved.metrics?.views ?? null,
      likes: r.resolved.metrics?.likes ?? null,
      comments: r.resolved.metrics?.comments ?? null,
    },
    checks: r.checks,
    canSubmit: r.checks.every((c) => c.ok),
    ownership: {
      required: r.eligibility.requireLinkedAccount,
      linked: r.owns,
      linkedHandle: r.linked?.handle ?? null,
      expectedHandle: r.resolved.authorHandle,
      simulated: socialProvider().isSimulated,
    },
    launchedAt: r.token.launchedAt.toISOString(),
    simulated: socialProvider().isSimulated,
  };
}

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

export async function createSubmission(wallet: string, mint: string, url: string, ipHash: string | null) {
  const r = await evaluate(wallet, mint, url);
  const failing = r.checks.filter((c) => !c.ok);

  const baseRow = {
    competitionId: r.competition.id,
    creatorWallet: wallet,
    platform: r.parsed.platform,
    submittedUrl: url.slice(0, 2048),
    canonicalUrl: r.resolved.canonicalUrl,
    platformVideoId: r.parsed.videoId,
    authorAccountId: r.resolved.authorAccountId,
    authorHandle: r.resolved.authorHandle,
    socialAccountId: r.owns ? r.linked!.id : null,
    title: r.resolved.title,
    postText: r.resolved.postText,
    thumbnailUrl: r.resolved.thumbnailUrl,
    contentFingerprint: r.resolved.contentFingerprint,
    publishedAt: r.resolved.publishedAt,
    publishedAtSource: r.resolved.publishedAtSource,
    submitIpHash: ipHash,
    isSimulated: socialProvider().isSimulated,
  };

  // Pre-launch content: record the rejection permanently, then refuse.
  if (failing.length === 1 && failing[0].id === "published_after_launch") {
    try {
      await db.insert(schema.videos).values({
        ...baseRow,
        status: "rejected",
        statusReason: "published_before_launch",
        reviewedBy: "system:eligibility",
        reviewedAt: new Date(),
        reviewNote: failing[0].detail,
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
    throw new ApiError(422, "published_before_launch", "Only videos published after the token launch are eligible.", { checks: r.checks });
  }
  if (failing.length > 0) {
    throw new ApiError(422, `check_failed_${failing[0].id}`, failing[0].detail ?? failing[0].label, { checks: r.checks });
  }

  try {
    return await db.transaction(async (tx) => {
      const [video] = await tx
        .insert(schema.videos)
        .values({ ...baseRow, status: "verified", statusReason: null })
        .returning();
      const m = r.resolved.metrics;
      if (m) {
        await tx.insert(schema.metricSnapshots).values({
          videoId: video.id,
          capturedAt: m.capturedAt,
          views: m.views,
          likes: m.likes,
          comments: m.comments,
          shares: m.shares,
          source: m.source,
        });
        await tx
          .update(schema.videos)
          .set({ views: m.views, likes: m.likes, comments: m.comments, shares: m.shares, metricsUpdatedAt: m.capturedAt, metricsSource: m.source })
          .where(eq(schema.videos.id, video.id));
      }
      const score = await rescoreVideo(tx, {
        id: video.id,
        platform: r.parsed.platform,
        views: m?.views ?? 0,
        likes: m?.likes ?? 0,
        comments: m?.comments ?? 0,
      });
      const fraud = await evaluateVideoFraud(tx, video.id);
      await audit(tx, {
        actor: wallet,
        action: "video.submit",
        targetType: "video",
        targetId: video.id,
        after: { platform: r.parsed.platform, videoId: r.parsed.videoId, competition: mint, status: fraud.status },
        ipHash,
      });
      return { id: video.id, status: fraud.status, viralScore: score.score, riskScore: fraud.riskScore };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError(409, "already_submitted", "This video has already been submitted.");
    throw e;
  }
}

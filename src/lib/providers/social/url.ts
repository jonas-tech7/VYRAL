/**
 * Video URL parsing and canonicalisation.
 *
 * Duplicate protection keys on (platform, videoId), never on the raw URL, so
 * tracking parameters, mobile hosts or alternate URL shapes cannot be used to
 * enter the same video twice.
 */
import type { Platform } from "@/lib/domain/platforms";

export type ParsedVideoUrl = {
  platform: Platform;
  videoId: string;
  canonicalUrl: string;
  handle: string | null;
};

export type ParseResult =
  | { ok: true; value: ParsedVideoUrl }
  | { ok: false; error: string; shortLink?: { platform: Platform; url: string } };

const TIKTOK_ID = /^\d{15,21}$/;
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const IG_CODE = /^[A-Za-z0-9_-]{5,40}$/;
const X_ID = /^\d{10,21}$/;
const HANDLE = /^[A-Za-z0-9._]{1,40}$/;

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^(www\.|m\.|mobile\.)/, "");
}

export function parseVideoUrl(input: string): ParseResult {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Paste a video link." };
  if (raw.length > 2048) return { ok: false, error: "That link is too long." };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: "That doesn't look like a valid link." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "Only web links are supported." };
  if (url.username || url.password) return { ok: false, error: "That doesn't look like a valid link." };

  const host = normalizeHost(url.hostname);
  const parts = url.pathname.split("/").filter(Boolean);

  // TikTok
  if (host === "tiktok.com") {
    if (parts[0] === "t" && parts[1]) {
      return { ok: false, error: "short_link", shortLink: { platform: "tiktok", url: `https://www.tiktok.com/t/${parts[1]}/` } };
    }
    const vi = parts.indexOf("video");
    if (vi >= 1 && parts[0].startsWith("@") && TIKTOK_ID.test(parts[vi + 1] ?? "")) {
      const handle = parts[0].slice(1);
      const id = parts[vi + 1];
      return {
        ok: true,
        value: {
          platform: "tiktok",
          videoId: id,
          canonicalUrl: `https://www.tiktok.com/@${encodeURIComponent(handle)}/video/${id}`,
          handle: HANDLE.test(handle) ? handle : null,
        },
      };
    }
    return { ok: false, error: "Use a TikTok video link like tiktok.com/@creator/video/123…" };
  }
  if (host === "vm.tiktok.com" || host === "vt.tiktok.com") {
    if (parts[0]) return { ok: false, error: "short_link", shortLink: { platform: "tiktok", url: `https://${host}/${parts[0]}/` } };
    return { ok: false, error: "Use a TikTok video link like tiktok.com/@creator/video/123…" };
  }

  // YouTube Shorts
  if (host === "youtube.com" || host === "youtu.be" || host === "music.youtube.com") {
    let id: string | null = null;
    if (host === "youtu.be") id = parts[0] ?? null;
    else if (parts[0] === "shorts" || parts[0] === "live") id = parts[1] ?? null;
    else if (parts[0] === "watch") id = url.searchParams.get("v");
    if (id && YT_ID.test(id)) {
      return { ok: true, value: { platform: "youtube", videoId: id, canonicalUrl: `https://www.youtube.com/shorts/${id}`, handle: null } };
    }
    return { ok: false, error: "Use a YouTube Shorts link like youtube.com/shorts/…" };
  }

  // Instagram Reels
  if (host === "instagram.com" || host === "instagr.am") {
    const idx = parts.findIndex((p) => p === "reel" || p === "reels" || p === "p" || p === "tv");
    const code = idx >= 0 ? parts[idx + 1] : undefined;
    if (code && IG_CODE.test(code)) {
      const handle = idx === 1 && HANDLE.test(parts[0]) ? parts[0] : null;
      return { ok: true, value: { platform: "instagram", videoId: code, canonicalUrl: `https://www.instagram.com/reel/${code}/`, handle } };
    }
    return { ok: false, error: "Use an Instagram Reel link like instagram.com/reel/…" };
  }

  // X
  if (host === "x.com" || host === "twitter.com") {
    const si = parts.indexOf("status");
    const id = si >= 1 ? parts[si + 1] : undefined;
    if (id && X_ID.test(id)) {
      const maybeHandle = parts[0] !== "i" && HANDLE.test(parts[0]) ? parts[0] : null;
      return {
        ok: true,
        value: { platform: "x", videoId: id, canonicalUrl: `https://x.com/${maybeHandle ?? "i"}/status/${id}`, handle: maybeHandle },
      };
    }
    return { ok: false, error: "Use an X post link like x.com/creator/status/…" };
  }

  return { ok: false, error: "Supported platforms: TikTok, YouTube Shorts, Instagram Reels and X." };
}

/**
 * Creation time embedded in snowflake-style IDs. Used only as a consistency
 * cross-check against platform-reported publication times (and by the mock
 * provider); the platform API remains the source of truth.
 */
export function idEmbeddedTimestamp(platform: Platform, videoId: string): Date | null {
  try {
    if (platform === "tiktok" && TIKTOK_ID.test(videoId)) {
      const seconds = Number(BigInt(videoId) >> BigInt(32));
      return plausible(new Date(seconds * 1000));
    }
    if (platform === "x" && X_ID.test(videoId)) {
      const ms = Number((BigInt(videoId) >> BigInt(22)) + BigInt(1288834974657));
      return plausible(new Date(ms));
    }
  } catch {
    return null;
  }
  return null;
}

function plausible(d: Date): Date | null {
  const min = Date.UTC(2014, 0, 1);
  const max = Date.now() + 86_400_000;
  return d.getTime() >= min && d.getTime() <= max ? d : null;
}

/** Builds a snowflake-style ID that embeds `at` (used by the demo seed). */
export function makeEmbeddedId(platform: "tiktok" | "x", at: Date, entropy: number): string {
  if (platform === "tiktok") {
    return ((BigInt(Math.floor(at.getTime() / 1000)) << BigInt(32)) | BigInt(entropy >>> 0)).toString();
  }
  return (((BigInt(at.getTime()) - BigInt(1288834974657)) << BigInt(22)) | BigInt(entropy & 0x3fffff)).toString();
}

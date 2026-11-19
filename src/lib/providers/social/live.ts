/**
 * LIVE social provider — authorised platform data only.
 *
 *  - YouTube Shorts: YouTube Data API v3 (app API key). Ownership is proven
 *    by the creator's linked Google account (channel ID match).
 *  - TikTok: Display API with the creator's OAuth token. The API only returns
 *    videos owned by the authorising account, so ownership is implicit.
 *  - Instagram Reels: Instagram API with Instagram Login (creator OAuth).
 *    Media is looked up within the authorised account's media.
 *  - X: API v2 (app bearer token) for metrics; ownership via the creator's
 *    linked X account (author ID match).
 *
 * Requires platform app credentials and, for TikTok/Instagram, approved
 * scopes. Must be validated against each platform's sandbox before launch.
 */
import { joinPostText } from "@/lib/domain/mentions";
import type { Platform } from "@/lib/domain/platforms";
import { env } from "@/lib/env";
import { dHashFromUrl } from "./fingerprint";
import type { LinkedAccountCredentials, MetricsRequest, MetricsResult, ResolvedVideo, SocialProvider } from "./types";
import { ProviderError } from "./types";
import { parseVideoUrl, type ParsedVideoUrl } from "./url";

export const INSTAGRAM_GRAPH_VERSION = "v23.0";
const SHORTS_MAX_SECONDS = 180;
const TIMEOUT_MS = 10_000;

async function getJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (res.status === 429) throw new ProviderError("Platform rate limit reached", "rate_limited", true);
  if (res.status === 401 || res.status === 403) throw new ProviderError("Platform authorisation failed", "unauthorized");
  if (res.status === 404) throw new ProviderError("Video not found", "not_found");
  if (!res.ok) throw new ProviderError(`Platform API error (${res.status})`, "upstream", res.status >= 500);
  return res.json();
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

function isoDurationSeconds(iso: string | undefined): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? "");
  if (!m) return Number.POSITIVE_INFINITY;
  return (Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0)) || 0;
}

function requireCredentials(c: LinkedAccountCredentials | null, platform: Platform): LinkedAccountCredentials & { accessToken: string } {
  if (!c?.accessToken) {
    throw new ProviderError(`Link your ${platform === "tiktok" ? "TikTok" : "Instagram"} account to submit this video.`, "unauthorized");
  }
  return c as LinkedAccountCredentials & { accessToken: string };
}

/* ------------------------------- YouTube ------------------------------ */

type YtItem = {
  id: string;
  snippet?: {
    publishedAt?: string;
    channelId?: string;
    channelTitle?: string;
    title?: string;
    description?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
};

async function youtubeVideos(ids: string[]): Promise<YtItem[]> {
  if (!env.YOUTUBE_API_KEY) throw new ProviderError("YOUTUBE_API_KEY is not configured", "not_configured");
  const out: YtItem[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const qs = new URLSearchParams({ part: "snippet,statistics,contentDetails", id: ids.slice(i, i + 50).join(","), key: env.YOUTUBE_API_KEY });
    const body = (await getJson(`https://www.googleapis.com/youtube/v3/videos?${qs}`)) as { items?: YtItem[] };
    out.push(...(body.items ?? []));
  }
  return out;
}

/* -------------------------------- TikTok ------------------------------ */

type TtVideo = {
  id: string;
  create_time?: number;
  cover_image_url?: string;
  title?: string;
  video_description?: string;
  duration?: number;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
};

async function tiktokQuery(accessToken: string, ids: string[]): Promise<TtVideo[]> {
  const fields = "id,create_time,cover_image_url,title,video_description,duration,view_count,like_count,comment_count,share_count";
  const body = (await getJson(`https://open.tiktokapis.com/v2/video/query/?fields=${fields}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ filters: { video_ids: ids.slice(0, 20) } }),
  })) as { data?: { videos?: TtVideo[] }; error?: { code?: string; message?: string } };
  if (body.error?.code && body.error.code !== "ok") throw new ProviderError(`TikTok: ${body.error.message ?? body.error.code}`, "upstream");
  return body.data?.videos ?? [];
}

/* ------------------------------ Instagram ----------------------------- */

type IgMedia = {
  id: string;
  shortcode?: string;
  timestamp?: string;
  media_type?: string;
  media_product_type?: string;
  thumbnail_url?: string;
  caption?: string;
  like_count?: number;
  comments_count?: number;
};

async function instagramFindByShortcode(accessToken: string, shortcode: string): Promise<IgMedia | null> {
  const fields = "id,shortcode,timestamp,media_type,media_product_type,thumbnail_url,caption,like_count,comments_count";
  let next: string | null =
    `https://graph.instagram.com/${INSTAGRAM_GRAPH_VERSION}/me/media?fields=${fields}&limit=50&access_token=${encodeURIComponent(accessToken)}`;
  for (let page = 0; next && page < 10; page++) {
    const body = (await getJson(next)) as { data?: IgMedia[]; paging?: { next?: string } };
    const hit = body.data?.find((m) => m.shortcode === shortcode);
    if (hit) return hit;
    next = body.paging?.next ?? null;
  }
  return null;
}

async function instagramMedia(accessToken: string, mediaId: string): Promise<IgMedia> {
  const fields = "id,shortcode,timestamp,media_type,media_product_type,like_count,comments_count";
  return (await getJson(
    `https://graph.instagram.com/${INSTAGRAM_GRAPH_VERSION}/${mediaId}?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`,
  )) as IgMedia;
}

async function instagramViews(accessToken: string, mediaId: string): Promise<number> {
  const body = (await getJson(
    `https://graph.instagram.com/${INSTAGRAM_GRAPH_VERSION}/${mediaId}/insights?metric=views&access_token=${encodeURIComponent(accessToken)}`,
  )) as { data?: Array<{ name: string; values?: Array<{ value?: number }>; total_value?: { value?: number } }> };
  const metric = body.data?.find((d) => d.name === "views");
  return num(metric?.total_value?.value ?? metric?.values?.[0]?.value);
}

/* ---------------------------------- X --------------------------------- */

type XTweet = {
  id: string;
  created_at?: string;
  author_id?: string;
  text?: string;
  /** Full text of long posts (text is truncated for them). */
  note_tweet?: { text?: string };
  public_metrics?: { like_count?: number; reply_count?: number; retweet_count?: number; quote_count?: number; impression_count?: number };
  attachments?: { media_keys?: string[] };
};
type XMedia = { media_key: string; type?: string; preview_image_url?: string; duration_ms?: number; public_metrics?: { view_count?: number } };

async function xTweets(ids: string[]): Promise<{ tweets: XTweet[]; media: XMedia[]; users: Array<{ id: string; username: string }> }> {
  if (!env.X_BEARER_TOKEN) throw new ProviderError("X_BEARER_TOKEN is not configured", "not_configured");
  const tweets: XTweet[] = [];
  const media: XMedia[] = [];
  const users: Array<{ id: string; username: string }> = [];
  for (let i = 0; i < ids.length; i += 100) {
    const qs = new URLSearchParams({
      ids: ids.slice(i, i + 100).join(","),
      "tweet.fields": "created_at,public_metrics,author_id,attachments,text,note_tweet",
      expansions: "attachments.media_keys,author_id",
      "media.fields": "type,public_metrics,duration_ms,preview_image_url",
      "user.fields": "username",
    });
    const body = (await getJson(`https://api.x.com/2/tweets?${qs}`, {
      headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` },
    })) as { data?: XTweet[]; includes?: { media?: XMedia[]; users?: Array<{ id: string; username: string }> } };
    tweets.push(...(body.data ?? []));
    media.push(...(body.includes?.media ?? []));
    users.push(...(body.includes?.users ?? []));
  }
  return { tweets, media, users };
}

function xVideoMetrics(t: XTweet, media: XMedia[]) {
  const video = media.find((m) => t.attachments?.media_keys?.includes(m.media_key) && (m.type === "video" || m.type === "animated_gif"));
  return {
    video,
    views: num(video?.public_metrics?.view_count ?? t.public_metrics?.impression_count),
    likes: num(t.public_metrics?.like_count),
    comments: num(t.public_metrics?.reply_count),
    shares: num(t.public_metrics?.retweet_count) + num(t.public_metrics?.quote_count),
  };
}

/* ------------------------------ Provider ------------------------------ */

const SHORT_LINK_HOSTS = new Set(["vm.tiktok.com", "vt.tiktok.com", "www.tiktok.com", "tiktok.com"]);

export class LiveSocialProvider implements SocialProvider {
  readonly id = "live" as const;
  readonly isSimulated = false;

  async expandShortLink(platform: Platform, url: string): Promise<string> {
    const u = new URL(url);
    // Only follow redirects for known short-link hosts (no open SSRF surface).
    if (platform !== "tiktok" || !SHORT_LINK_HOSTS.has(u.hostname)) throw new ProviderError("Unsupported short link", "unsupported");
    let current = u.toString();
    for (let hop = 0; hop < 3; hop++) {
      const res = await fetch(current, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
      const loc = res.headers.get("location");
      if (!loc) break;
      current = new URL(loc, current).toString();
      const parsed = parseVideoUrl(current);
      if (parsed.ok) return parsed.value.canonicalUrl;
      if (!SHORT_LINK_HOSTS.has(new URL(current).hostname)) break;
    }
    throw new ProviderError("Could not expand the short link. Paste the full video URL.", "not_found");
  }

  async resolve(parsed: ParsedVideoUrl, credentials: LinkedAccountCredentials | null): Promise<ResolvedVideo> {
    const now = new Date();
    switch (parsed.platform) {
      case "youtube": {
        const [item] = await youtubeVideos([parsed.videoId]);
        if (!item?.snippet?.publishedAt || !item.snippet.channelId) throw new ProviderError("Video not found", "not_found");
        const thumb = item.snippet.thumbnails?.high?.url ?? item.snippet.thumbnails?.default?.url ?? null;
        return {
          platform: "youtube",
          videoId: parsed.videoId,
          canonicalUrl: parsed.canonicalUrl,
          authorAccountId: item.snippet.channelId,
          authorHandle: item.snippet.channelTitle ?? item.snippet.channelId,
          title: item.snippet.title ?? null,
          postText: joinPostText(item.snippet.title, item.snippet.description),
          thumbnailUrl: thumb,
          publishedAt: new Date(item.snippet.publishedAt),
          publishedAtSource: "platform_api",
          isShortForm: isoDurationSeconds(item.contentDetails?.duration) <= SHORTS_MAX_SECONDS,
          metrics: {
            views: num(item.statistics?.viewCount),
            likes: num(item.statistics?.likeCount),
            comments: num(item.statistics?.commentCount),
            shares: 0,
            capturedAt: now,
            source: "youtube_data_api_v3",
          },
          contentFingerprint: thumb ? await dHashFromUrl(thumb) : null,
        };
      }
      case "tiktok": {
        const c = requireCredentials(credentials, "tiktok");
        const [v] = await tiktokQuery(c.accessToken, [parsed.videoId]);
        if (!v?.create_time) {
          throw new ProviderError("This video isn't published by your linked TikTok account.", "not_owned");
        }
        return {
          platform: "tiktok",
          videoId: parsed.videoId,
          canonicalUrl: parsed.canonicalUrl,
          authorAccountId: c.platformAccountId,
          authorHandle: c.handle,
          title: v.title ?? v.video_description ?? null,
          postText: joinPostText(v.title, v.video_description),
          thumbnailUrl: v.cover_image_url ?? null,
          publishedAt: new Date(v.create_time * 1000),
          publishedAtSource: "platform_api",
          isShortForm: true,
          metrics: {
            views: num(v.view_count),
            likes: num(v.like_count),
            comments: num(v.comment_count),
            shares: num(v.share_count),
            capturedAt: now,
            source: "tiktok_display_api",
          },
          contentFingerprint: v.cover_image_url ? await dHashFromUrl(v.cover_image_url) : null,
        };
      }
      case "instagram": {
        const c = requireCredentials(credentials, "instagram");
        const media = await instagramFindByShortcode(c.accessToken, parsed.videoId);
        if (!media?.timestamp) throw new ProviderError("This reel isn't published by your linked Instagram account.", "not_owned");
        const isReel = media.media_product_type === "REELS" || media.media_type === "VIDEO";
        return {
          platform: "instagram",
          videoId: parsed.videoId,
          canonicalUrl: parsed.canonicalUrl,
          authorAccountId: c.platformAccountId,
          authorHandle: c.handle,
          title: media.caption?.slice(0, 200) ?? null,
          postText: joinPostText(media.caption),
          thumbnailUrl: media.thumbnail_url ?? null,
          publishedAt: new Date(media.timestamp),
          publishedAtSource: "platform_api",
          isShortForm: isReel,
          metrics: {
            views: await instagramViews(c.accessToken, media.id),
            likes: num(media.like_count),
            comments: num(media.comments_count),
            shares: 0,
            capturedAt: now,
            source: "instagram_graph_api",
          },
          contentFingerprint: media.thumbnail_url ? await dHashFromUrl(media.thumbnail_url) : null,
        };
      }
      case "x": {
        const { tweets, media, users } = await xTweets([parsed.videoId]);
        const t = tweets[0];
        if (!t?.created_at || !t.author_id) throw new ProviderError("Post not found", "not_found");
        const m = xVideoMetrics(t, media);
        if (!m.video) throw new ProviderError("This post doesn't contain a video.", "unsupported");
        return {
          platform: "x",
          videoId: parsed.videoId,
          canonicalUrl: parsed.canonicalUrl,
          authorAccountId: t.author_id,
          authorHandle: users.find((u) => u.id === t.author_id)?.username ?? t.author_id,
          title: null,
          postText: joinPostText(t.note_tweet?.text ?? t.text),
          thumbnailUrl: m.video.preview_image_url ?? null,
          publishedAt: new Date(t.created_at),
          publishedAtSource: "platform_api",
          isShortForm: (m.video.duration_ms ?? 0) <= 10 * 60_000,
          metrics: { views: m.views, likes: m.likes, comments: m.comments, shares: m.shares, capturedAt: now, source: "x_api_v2" },
          contentFingerprint: m.video.preview_image_url ? await dHashFromUrl(m.video.preview_image_url) : null,
        };
      }
    }
  }

  async fetchMetrics(requests: MetricsRequest[]): Promise<Map<string, MetricsResult | ProviderError>> {
    const out = new Map<string, MetricsResult | ProviderError>();
    const now = new Date();
    const fail = (keys: string[], e: unknown) => {
      const err = e instanceof ProviderError ? e : new ProviderError(String(e), "upstream", true);
      for (const k of keys) out.set(k, err);
    };

    const yt = requests.filter((r) => r.platform === "youtube");
    if (yt.length) {
      try {
        const items = await youtubeVideos(yt.map((r) => r.videoId));
        for (const r of yt) {
          const it = items.find((i) => i.id === r.videoId);
          out.set(
            r.key,
            it
              ? {
                  views: num(it.statistics?.viewCount),
                  likes: num(it.statistics?.likeCount),
                  comments: num(it.statistics?.commentCount),
                  shares: 0,
                  capturedAt: now,
                  source: "youtube_data_api_v3",
                  postText: joinPostText(it.snippet?.title, it.snippet?.description),
                }
              : new ProviderError("Video unavailable", "not_found"),
          );
        }
      } catch (e) {
        fail(yt.map((r) => r.key), e);
      }
    }

    const xs = requests.filter((r) => r.platform === "x");
    if (xs.length) {
      try {
        const { tweets, media } = await xTweets(xs.map((r) => r.videoId));
        for (const r of xs) {
          const t = tweets.find((x) => x.id === r.videoId);
          if (!t) {
            out.set(r.key, new ProviderError("Post unavailable", "not_found"));
            continue;
          }
          const m = xVideoMetrics(t, media);
          out.set(r.key, {
            views: m.views,
            likes: m.likes,
            comments: m.comments,
            shares: m.shares,
            capturedAt: now,
            source: "x_api_v2",
            postText: joinPostText(t.note_tweet?.text ?? t.text),
          });
        }
      } catch (e) {
        fail(xs.map((r) => r.key), e);
      }
    }

    // TikTok: batch per linked account (tokens are per creator).
    const tt = requests.filter((r) => r.platform === "tiktok");
    const byAccount = new Map<string, MetricsRequest[]>();
    for (const r of tt) {
      const k = r.credentials?.socialAccountId ?? "none";
      byAccount.set(k, [...(byAccount.get(k) ?? []), r]);
    }
    for (const [, group] of byAccount) {
      const token = group[0].credentials?.accessToken;
      if (!token) {
        fail(group.map((r) => r.key), new ProviderError("Linked TikTok account missing or revoked", "unauthorized"));
        continue;
      }
      for (let i = 0; i < group.length; i += 20) {
        const chunk = group.slice(i, i + 20);
        try {
          const videos = await tiktokQuery(token, chunk.map((r) => r.videoId));
          for (const r of chunk) {
            const v = videos.find((x) => x.id === r.videoId);
            out.set(
              r.key,
              v
                ? {
                    views: num(v.view_count),
                    likes: num(v.like_count),
                    comments: num(v.comment_count),
                    shares: num(v.share_count),
                    capturedAt: now,
                    source: "tiktok_display_api",
                    postText: joinPostText(v.title, v.video_description),
                  }
                : new ProviderError("Video unavailable or no longer owned by the linked account", "not_found"),
            );
          }
        } catch (e) {
          fail(chunk.map((r) => r.key), e);
        }
      }
    }

    // Instagram: one media + insights call per reel.
    for (const r of requests.filter((x) => x.platform === "instagram")) {
      const token = r.credentials?.accessToken;
      if (!token) {
        out.set(r.key, new ProviderError("Linked Instagram account missing or revoked", "unauthorized"));
        continue;
      }
      try {
        const found = await instagramFindByShortcode(token, r.videoId);
        if (!found) {
          out.set(r.key, new ProviderError("Reel unavailable", "not_found"));
          continue;
        }
        const media = await instagramMedia(token, found.id);
        out.set(r.key, {
          views: await instagramViews(token, found.id),
          likes: num(media.like_count),
          comments: num(media.comments_count),
          shares: 0,
          capturedAt: now,
          source: "instagram_graph_api",
          // The shortcode lookup already returned the caption.
          postText: joinPostText(found.caption),
        });
      } catch (e) {
        fail([r.key], e);
      }
    }

    return out;
  }
}

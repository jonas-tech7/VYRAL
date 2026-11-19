/**
 * MOCK social provider — development only.
 *
 * Returns simulated, deterministic metadata and metrics so the full
 * submission → verification → scoring → payout pipeline can run without
 * platform credentials. Every value it produces is tagged "simulated" and the
 * UI shows a demonstration-data notice while it is active.
 *
 * Publication times: for TikTok and X the creation time embedded in the video
 * ID is used (so a real pasted link resolves to its true creation date);
 * otherwise a stable simulated time is derived from the video ID.
 */
import type { Platform } from "@/lib/domain/platforms";
import { unit } from "@/lib/sim/random";
import { simFingerprint, simHandle, simMetrics } from "@/lib/sim/social-sim";
import type { LinkedAccountCredentials, MetricsRequest, MetricsResult, ResolvedVideo, SocialProvider } from "./types";
import { ProviderError } from "./types";
import { idEmbeddedTimestamp, type ParsedVideoUrl } from "./url";

export function simulatedAccountId(platform: Platform, handle: string): string {
  return `sim:${platform}:${handle.toLowerCase()}`;
}

/** Stable simulated publish time for IDs without an embedded timestamp. */
export function simulatedPublishedAt(platform: Platform, videoId: string, now: Date): Date {
  const u = unit(`${platform}:${videoId}:published`);
  // ~10% of simulated videos predate typical launches so the eligibility rule is visible.
  if (u < 0.1) return new Date(Date.UTC(2026, 0, 15) + Math.floor(u * 10 * 86_400_000 * 30));
  const hours = 1 + Math.floor(unit(`${platform}:${videoId}:age`) * 46);
  const anchor = Math.floor(now.getTime() / 86_400_000) * 86_400_000; // stable within a UTC day
  return new Date(Math.min(anchor - hours * 3_600_000 + 86_400_000, now.getTime() - 10 * 60_000));
}

export class MockSocialProvider implements SocialProvider {
  readonly id = "mock" as const;
  readonly isSimulated = true;

  async expandShortLink(): Promise<string> {
    throw new ProviderError(
      "Short links can't be expanded while simulated data is active. Paste the full video link.",
      "unsupported",
    );
  }

  async resolve(parsed: ParsedVideoUrl, credentials: LinkedAccountCredentials | null): Promise<ResolvedVideo> {
    const now = new Date();
    const handle = parsed.handle ?? credentials?.handle ?? simHandle(parsed.platform, parsed.videoId);
    const publishedAt = idEmbeddedTimestamp(parsed.platform, parsed.videoId) ?? simulatedPublishedAt(parsed.platform, parsed.videoId, now);
    if (publishedAt > now) throw new ProviderError("Video not found.", "not_found");
    const m = simMetrics(parsed.platform, parsed.videoId, publishedAt, now);
    return {
      platform: parsed.platform,
      videoId: parsed.videoId,
      canonicalUrl: parsed.canonicalUrl,
      authorAccountId: simulatedAccountId(parsed.platform, handle),
      authorHandle: handle,
      title: null,
      thumbnailUrl: null,
      publishedAt,
      publishedAtSource: "simulated",
      isShortForm: true,
      metrics: { ...m, capturedAt: now, source: "simulated" },
      contentFingerprint: simFingerprint(parsed.platform, parsed.videoId),
    };
  }

  async fetchMetrics(requests: MetricsRequest[]): Promise<Map<string, MetricsResult | ProviderError>> {
    const now = new Date();
    const out = new Map<string, MetricsResult | ProviderError>();
    for (const r of requests) {
      const m = simMetrics(r.platform, r.videoId, r.publishedAt, now);
      out.set(r.key, { ...m, capturedAt: now, source: "simulated" });
    }
    return out;
  }
}

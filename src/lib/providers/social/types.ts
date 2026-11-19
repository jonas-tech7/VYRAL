import type { Platform } from "@/lib/domain/platforms";
import type { ParsedVideoUrl } from "./url";

export type LinkedAccountCredentials = {
  socialAccountId: string;
  platformAccountId: string;
  handle: string;
  accessToken: string | null;
};

export type ResolvedVideo = {
  platform: Platform;
  videoId: string;
  canonicalUrl: string;
  authorAccountId: string;
  authorHandle: string;
  title: string | null;
  /** Full post text as returned by the platform (title, caption, description), searched for the contract address. */
  postText: string | null;
  thumbnailUrl: string | null;
  publishedAt: Date;
  /** "platform_api" for authorised platform data, "simulated" for the mock provider. */
  publishedAtSource: "platform_api" | "simulated";
  /** False for long-form uploads that don't qualify (e.g. a regular YouTube video). */
  isShortForm: boolean;
  metrics: MetricsResult | null;
  contentFingerprint: string | null;
};

export type MetricsResult = {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  capturedAt: Date;
  source: string;
  /** Latest post text when the platform returns it with the metrics (undefined: not available). */
  postText?: string | null;
};

/** What the post is expected to reference; the simulated provider uses it to simulate post text. */
export type ResolveContext = { contractAddress: string; symbol: string };

export type MetricsRequest = {
  key: string;
  platform: Platform;
  videoId: string;
  publishedAt: Date;
  credentials: LinkedAccountCredentials | null;
};

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_found"
      | "not_owned"
      | "unauthorized"
      | "rate_limited"
      | "unsupported"
      | "not_configured"
      | "upstream",
    readonly retryable = false,
  ) {
    super(message);
  }
}

export interface SocialProvider {
  readonly id: "mock" | "live";
  readonly isSimulated: boolean;
  /** Expands platform short links (e.g. vm.tiktok.com) to a full video URL. */
  expandShortLink(platform: Platform, url: string): Promise<string>;
  /**
   * Fetches authoritative video metadata. `credentials` is the submitting
   * wallet's linked account on that platform, when one exists.
   */
  resolve(parsed: ParsedVideoUrl, credentials: LinkedAccountCredentials | null, context?: ResolveContext): Promise<ResolvedVideo>;
  /** Batch metric refresh; failures are returned per key. */
  fetchMetrics(requests: MetricsRequest[]): Promise<Map<string, MetricsResult | ProviderError>>;
}

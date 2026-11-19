import { env } from "@/lib/env";
import { LiveSocialProvider } from "./live";
import { MockSocialProvider } from "./mock";
import type { SocialProvider } from "./types";

let instance: SocialProvider | null = null;

export function socialProvider(): SocialProvider {
  if (!instance) instance = env.SOCIAL_PROVIDER === "live" ? new LiveSocialProvider() : new MockSocialProvider();
  return instance;
}

export * from "./types";
export { parseVideoUrl } from "./url";

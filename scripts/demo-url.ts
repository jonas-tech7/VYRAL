/**
 * DEMO MODE helper: prints fresh TikTok and X video links whose IDs encode a
 * publication time a few minutes ago, so they pass the "published after
 * launch" rule against the simulated social provider. (Real links to older
 * videos are correctly refused as pre-launch.) Each link can be submitted once.
 *
 *   npm run demo:url -- [handle]
 */
import { randomInt } from "node:crypto";
import { makeEmbeddedId } from "@/lib/providers/social/url";

const handle = (process.argv[2] ?? "democreator").replace(/^@/, "");
const at = new Date(Date.now() - 5 * 60_000);

console.log(`Demo video links (simulated publish time ${at.toISOString()}):\n`);
for (let i = 0; i < 3; i++) {
  console.log(`  https://www.tiktok.com/@${handle}/video/${makeEmbeddedId("tiktok", at, randomInt(2 ** 31))}`);
}
console.log(`  https://x.com/${handle}/status/${makeEmbeddedId("x", at, randomInt(2 ** 22))}`);
console.log("\nThe first check asks you to link @" + handle + " (simulated in demo mode), then you can submit.");

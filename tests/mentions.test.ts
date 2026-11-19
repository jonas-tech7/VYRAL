import { describe, expect, it } from "vitest";
import { joinPostText, mentionsContractAddress } from "@/lib/domain/mentions";
import { buildTokenMetadata, coinPageUrl, launchLinkUrl } from "@/lib/launch/metadata";
import { simulatedPostText } from "@/lib/providers/social/mock";
import { composeWithView } from "@/lib/scoring/calibration";

const CA = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

describe("Contract address in post text", () => {
  it("finds the exact address in captions, titles and links", () => {
    expect(mentionsContractAddress(`New meme 🚀\nCA: ${CA}`, CA)).toBe(true);
    expect(mentionsContractAddress(`Buy here https://pump.fun/coin/${CA}`, CA)).toBe(true);
    expect(mentionsContractAddress(joinPostText("My title", `desc ${CA}`), CA)).toBe(true);
  });

  it("is exact and case-sensitive (base58)", () => {
    expect(mentionsContractAddress(CA.toLowerCase(), CA)).toBe(false);
    expect(mentionsContractAddress(CA.slice(0, -1), CA)).toBe(false);
    expect(mentionsContractAddress("no address here", CA)).toBe(false);
    expect(mentionsContractAddress(null, CA)).toBe(false);
  });

  it("ignores invisible characters hidden inside the address", () => {
    const hidden = `${CA.slice(0, 10)}​${CA.slice(10)}`;
    expect(mentionsContractAddress(hidden, CA)).toBe(true);
  });

  it("joins post text fields and drops empty ones", () => {
    expect(joinPostText(" Title ", null, undefined, "", "Body")).toBe("Title\nBody");
    expect(joinPostText(null, "  ")).toBeNull();
  });

  it("simulates captions with and without the address in demo mode", () => {
    expect(mentionsContractAddress(simulatedPostText("7412345678901234567", { contractAddress: CA, symbol: "TEST" }), CA)).toBe(true);
    expect(mentionsContractAddress(simulatedPostText("7412345678901234000", { contractAddress: CA, symbol: "TEST" }), CA)).toBe(false);
  });
});

describe("Calibrated multipliers", () => {
  it("combine view difficulty with the calibrated rate", () => {
    expect(composeWithView(2.49, 1.42)).toBeCloseTo(3.536, 3);
    expect(composeWithView(1, 0.8)).toBe(0.8);
    expect(composeWithView(100, 1)).toBe(20); // clamped to the schema bounds
  });
});

describe("Launch metadata", () => {
  const base = {
    name: "Glacier Cat",
    symbol: "GLCAT",
    imageUrl: "https://vyral.example/api/files/images/a.webp",
    imageContentType: "image/webp",
    vyralUrl: coinPageUrl(CA, "https://vyral.example"),
  };

  it("links every coin to its own page on VYRAL", () => {
    expect(base.vyralUrl).toBe(`https://vyral.example/competitions/${CA}`);
    const m = buildTokenMetadata({ ...base, description: "The coldest cat on Solana.", links: {} });
    expect(m.external_url).toBe(base.vyralUrl);
    expect(m.extensions.vyral).toBe(base.vyralUrl);
    expect(m.extensions.website).toBe(base.vyralUrl);
    expect(m.description).toBe(`The coldest cat on Solana.\n\nMake it go viral on VYRAL: ${base.vyralUrl}`);
  });

  it("keeps the deployer's own website and works without a description", () => {
    const m = buildTokenMetadata({ ...base, description: "  ", links: { website: "https://glaciercat.example", x: "https://x.com/glaciercat" } });
    expect(m.extensions.website).toBe("https://glaciercat.example");
    expect(m.extensions.twitter).toBe("https://x.com/glaciercat");
    expect(m.external_url).toBe(base.vyralUrl);
    expect(m.description).toBe(`Make it go viral on VYRAL: ${base.vyralUrl}`);
  });

  it("uses a forwarding link when the address is not known yet", () => {
    expect(launchLinkUrl("3f2c9a1e-0000-4000-8000-000000000000", "https://vyral.example")).toBe(
      "https://vyral.example/l/3f2c9a1e-0000-4000-8000-000000000000",
    );
  });
});

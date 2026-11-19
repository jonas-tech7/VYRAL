/**
 * Token metadata written at launch.
 *
 * Every coin launched on VYRAL links to its own page on VYRAL, so wherever the
 * coin shows up (launchpads, wallets, explorers) people can find its
 * competition: as the metadata's external_url, as `extensions.vyral`, and as
 * the last line of the description, which most apps display. The deployer's
 * own website stays available as `extensions.website`.
 */

/** The coin's page on VYRAL (its competition). */
export function coinPageUrl(mint: string, appUrl: string): string {
  return new URL(`/competitions/${mint}`, appUrl).toString();
}

/**
 * Permanent link for launches whose address is only known after the launch
 * service prepares the transaction; /l/<id> forwards to the coin's page.
 */
export function launchLinkUrl(launchId: string, appUrl: string): string {
  return new URL(`/l/${launchId}`, appUrl).toString();
}

export type TokenMetadataInput = {
  name: string;
  symbol: string;
  description: string;
  imageUrl: string;
  imageContentType: string;
  links: { website?: string; x?: string; telegram?: string; discord?: string };
  /** The coin's page on VYRAL (see coinPageUrl / launchLinkUrl). */
  vyralUrl: string;
};

export function buildTokenMetadata(p: TokenMetadataInput) {
  const description = [p.description.trim(), `Make it go viral on VYRAL: ${p.vyralUrl}`].filter(Boolean).join("\n\n");
  return {
    name: p.name,
    symbol: p.symbol,
    description,
    image: p.imageUrl,
    external_url: p.vyralUrl,
    extensions: {
      vyral: p.vyralUrl,
      website: p.links.website ?? p.vyralUrl,
      twitter: p.links.x,
      telegram: p.links.telegram,
      discord: p.links.discord,
    },
    properties: { files: [{ uri: p.imageUrl, type: p.imageContentType }] },
  };
}

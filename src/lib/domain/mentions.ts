/** Zero-width characters and the BOM, which can hide inside copied text. */
const INVISIBLE = /[​-‍⁠﻿]/g;

/**
 * True when a post's text (caption, title or description) contains the
 * token's contract address. Solana addresses are base58 and case-sensitive,
 * so the match is exact; a link that embeds the address (e.g. a launchpad or
 * explorer URL) counts as well.
 */
export function mentionsContractAddress(text: string | null | undefined, contractAddress: string): boolean {
  if (!text || !contractAddress) return false;
  return text.replace(INVISIBLE, "").includes(contractAddress);
}

/** Joins the text fields a platform returns for a post into one searchable string. */
export function joinPostText(...parts: Array<string | null | undefined>): string | null {
  const text = parts
    .map((p) => p?.trim())
    .filter(Boolean)
    .join("\n");
  return text.length > 0 ? text.slice(0, 10_000) : null;
}

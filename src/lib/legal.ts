/**
 * Version of the Terms of Use. Launches record the version the deployer
 * accepted; bump it whenever the Terms change materially.
 * Client-safe: no server imports here.
 */
export const TERMS_VERSION = "2026-11-19";

export const LEGAL_LINKS = [
  { href: "/legal/terms", label: "Terms of Use" },
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/imprint", label: "Imprint" },
] as const;

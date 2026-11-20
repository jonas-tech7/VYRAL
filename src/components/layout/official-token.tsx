import { connection } from "next/server";
import { getConfig } from "@/lib/config/store";
import { OfficialTokenPill } from "./official-token-pill";

/**
 * The official $VYRAL contract address, shown as soon as an administrator sets
 * it (launch with "official coin" checked, or the admin dashboard). Renders
 * nothing until then. "pill" sits in the header bar from the lg breakpoint;
 * "strip" is a full-width row under the header on smaller screens, where the
 * bar has no room for it.
 */
export async function OfficialToken({ variant }: { variant: "pill" | "strip" }) {
  await connection();
  const { value } = await getConfig("platform_token");
  if (!value.mint) return null;
  return <OfficialTokenPill mint={value.mint} symbol={value.symbol} variant={variant} />;
}

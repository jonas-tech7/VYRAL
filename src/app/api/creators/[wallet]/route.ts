import { notFound, route } from "@/lib/api/handler";
import { getCreatorProfile } from "@/lib/queries/public";
import { isValidAddress } from "@/lib/solana/keys";

export const GET = route<{ wallet: string }>(
  { rateLimit: { name: "public-read", limit: 600, windowSec: 60, by: "ip" } },
  async ({ params }) => {
    if (!isValidAddress(params.wallet)) throw notFound("Creator not found");
    const profile = await getCreatorProfile(params.wallet);
    if (!profile) throw notFound("Creator not found");
    return profile;
  },
);

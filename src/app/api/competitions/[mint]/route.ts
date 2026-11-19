import { notFound, route } from "@/lib/api/handler";
import { getCompetitionDetail } from "@/lib/queries/public";

export const GET = route<{ mint: string }>(
  { rateLimit: { name: "public-read", limit: 600, windowSec: 60, by: "ip" } },
  async ({ params }) => {
    const detail = await getCompetitionDetail(params.mint);
    if (!detail) throw notFound("Competition not found");
    return detail;
  },
);

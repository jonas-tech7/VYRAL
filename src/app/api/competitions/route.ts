import { z } from "zod";
import { route } from "@/lib/api/handler";
import { COMPETITION_SORTS, listCompetitions } from "@/lib/queries/public";

const query = z.object({
  sort: z.enum(COMPETITION_SORTS).default("trending"),
  q: z.string().trim().max(64).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

export const GET = route({ rateLimit: { name: "public-read", limit: 600, windowSec: 60, by: "ip" } }, async ({ query: q }) => {
  const { sort, q: search, page } = q(query);
  const { items, total } = await listCompetitions({ sort, q: search, limit: 25, offset: (page - 1) * 25 });
  return { items, total, page };
});

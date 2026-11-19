import { z } from "zod";
import { route } from "@/lib/api/handler";
import { CHART_RANGES, getCandles, type ChartRange } from "@/lib/queries/public";

const query = z.object({ range: z.enum(Object.keys(CHART_RANGES) as [ChartRange, ...ChartRange[]]).default("1D") });

export const GET = route<{ mint: string }>(
  { rateLimit: { name: "public-read", limit: 600, windowSec: 60, by: "ip" } },
  async ({ params, query: q }) => {
    const { range } = q(query);
    return { range, candles: await getCandles(params.mint, range) };
  },
);

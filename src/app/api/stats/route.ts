import { route } from "@/lib/api/handler";
import { getPlatformStats } from "@/lib/queries/public";

export const GET = route({ rateLimit: { name: "public-read", limit: 600, windowSec: 60, by: "ip" } }, async () => getPlatformStats());

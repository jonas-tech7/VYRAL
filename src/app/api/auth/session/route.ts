import { route } from "@/lib/api/handler";

export const GET = route({}, async ({ viewer }) => ({
  wallet: viewer?.wallet ?? null,
  role: viewer?.role ?? null,
}));

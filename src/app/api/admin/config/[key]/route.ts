import { z } from "zod";
import { badRequest, route } from "@/lib/api/handler";
import { CONFIG_KEYS, type ConfigKey } from "@/lib/config/schemas";
import { getConfig, updateConfig } from "@/lib/config/store";
import { rescoreAllActive } from "@/lib/services/scoring";

const body = z.object({ value: z.unknown(), note: z.string().trim().min(3, "Describe the reason for this change").max(1000) });

function keyOf(raw: string): ConfigKey {
  if (!(CONFIG_KEYS as readonly string[]).includes(raw)) throw badRequest("Unknown configuration key");
  return raw as ConfigKey;
}

export const GET = route<{ key: string }>({ auth: "reviewer" }, async ({ params }) => getConfig(keyOf(params.key)));

export const PUT = route<{ key: string }>(
  { auth: "admin", rateLimit: { name: "admin-config", limit: 120, windowSec: 3600, by: "wallet" }, maxBodyBytes: 32 * 1024 },
  async ({ params, json, viewer, ipHash }) => {
    const key = keyOf(params.key);
    const { value, note } = await json(body);
    const saved = await updateConfig(key, value, { wallet: viewer!.wallet, role: viewer!.role, ipHash }, note);
    const rescored = key === "scoring" ? await rescoreAllActive() : 0;
    return { ...saved, rescored };
  },
);

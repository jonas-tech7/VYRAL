/**
 * Versioned protocol configuration.
 *
 * Reads are cached per process for a few seconds. Writes validate against the
 * zod schema, bump the version, append to config_history and write an audit
 * record in the same transaction.
 */
import { eq, sql } from "drizzle-orm";
import { db, schema, type Executor } from "@/lib/db";
import { audit } from "@/lib/services/audit";
import { DEFAULT_CONFIG } from "./defaults";
import { CONFIG_KEYS, CONFIG_SCHEMAS, type ConfigKey, type ConfigShapes } from "./schemas";

export type VersionedConfig<K extends ConfigKey> = {
  key: K;
  value: ConfigShapes[K];
  version: number;
  updatedAt: Date | null;
  updatedBy: string;
};

const TTL_MS = 5_000;
const cache = new Map<ConfigKey, { at: number; entry: VersionedConfig<ConfigKey> }>();

export async function getConfig<K extends ConfigKey>(key: K, ex: Executor = db): Promise<VersionedConfig<K>> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS && ex === db) return hit.entry as VersionedConfig<K>;
  const [row] = await ex.select().from(schema.configEntries).where(eq(schema.configEntries.key, key));
  let entry: VersionedConfig<K>;
  if (!row) {
    entry = { key, value: DEFAULT_CONFIG[key], version: 0, updatedAt: null, updatedBy: "system:defaults" };
  } else {
    const parsed = CONFIG_SCHEMAS[key].safeParse(row.value);
    if (!parsed.success) throw new Error(`Stored config "${key}" v${row.version} is invalid: ${parsed.error.message}`);
    entry = { key, value: parsed.data, version: row.version, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
  }
  if (ex === db) cache.set(key, { at: Date.now(), entry: entry as VersionedConfig<ConfigKey> });
  return entry;
}

export async function getAllConfig(ex: Executor = db) {
  const [scoring, eligibility, payouts, reward_curve, fraud] = await Promise.all([
    getConfig("scoring", ex),
    getConfig("eligibility", ex),
    getConfig("payouts", ex),
    getConfig("reward_curve", ex),
    getConfig("fraud", ex),
  ]);
  return { scoring, eligibility, payouts, reward_curve, fraud };
}

export function invalidateConfigCache() {
  cache.clear();
}

export class ConfigValidationError extends Error {
  constructor(readonly issues: Array<{ path: string; message: string }>) {
    super("Invalid configuration");
  }
}

export async function updateConfig<K extends ConfigKey>(
  key: K,
  value: unknown,
  actor: { wallet: string; role: string | null; ipHash?: string | null },
  note?: string | null,
): Promise<VersionedConfig<K>> {
  const parsed = CONFIG_SCHEMAS[key].safeParse(value);
  if (!parsed.success) {
    throw new ConfigValidationError(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const result = await db.transaction(async (tx) => {
    // Serialise concurrent edits of the same key.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`config:${key}`}))`);
    const [current] = await tx.select().from(schema.configEntries).where(eq(schema.configEntries.key, key));
    const version = (current?.version ?? 0) + 1;
    const now = new Date();
    await tx
      .insert(schema.configEntries)
      .values({ key, value: parsed.data, version, updatedBy: actor.wallet, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.configEntries.key,
        set: { value: parsed.data, version, updatedBy: actor.wallet, updatedAt: now },
      });
    await tx.insert(schema.configHistory).values({ key, version, value: parsed.data, updatedBy: actor.wallet, note: note ?? null });
    await audit(tx, {
      actor: actor.wallet,
      actorRole: actor.role,
      action: `config.update.${key}`,
      targetType: "config",
      targetId: `${key}@v${version}`,
      before: current?.value ?? null,
      after: parsed.data,
      note,
      ipHash: actor.ipHash,
    });
    return { key, value: parsed.data, version, updatedAt: now, updatedBy: actor.wallet } as VersionedConfig<K>;
  });
  invalidateConfigCache();
  return result;
}

/** Writes version 1 of any missing config key (idempotent). */
export async function ensureConfigDefaults(ex: Executor = db): Promise<void> {
  for (const key of CONFIG_KEYS) {
    const value = DEFAULT_CONFIG[key];
    const inserted = await ex
      .insert(schema.configEntries)
      .values({ key, value, version: 1, updatedBy: "system:defaults" })
      .onConflictDoNothing()
      .returning({ key: schema.configEntries.key });
    if (inserted.length) {
      await ex
        .insert(schema.configHistory)
        .values({ key, version: 1, value, updatedBy: "system:defaults", note: "Initial configuration" })
        .onConflictDoNothing();
    }
  }
  invalidateConfigCache();
}

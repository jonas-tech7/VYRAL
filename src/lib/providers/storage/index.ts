/**
 * Object storage for token images and metadata.
 *  - local:    files under UPLOAD_DIR, served by /api/files/[...key] (development / single host)
 *  - database: rows in the `stored_files` table, served by /api/files/[...key]
 *              (serverless hosts such as Vercel, which have no persistent disk)
 *  - pinata:   IPFS pinning for permanent, content-addressed token metadata
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";

export interface StorageProvider {
  readonly id: "local" | "database" | "pinata";
  put(key: string, data: Buffer, contentType: string): Promise<{ url: string }>;
}

const SAFE_KEY = /^[a-z0-9][a-z0-9/_.-]{2,200}$/;

function isSafeKey(key: string): boolean {
  return SAFE_KEY.test(key) && !key.includes("..");
}

export function resolveLocalPath(key: string): string | null {
  if (!isSafeKey(key)) return null;
  const root = path.resolve(env.UPLOAD_DIR);
  const full = path.resolve(root, key);
  return full.startsWith(root + path.sep) ? full : null;
}

class LocalStorage implements StorageProvider {
  readonly id = "local" as const;
  async put(key: string, data: Buffer) {
    const full = resolveLocalPath(key);
    if (!full) throw new Error("Invalid storage key");
    await mkdir(/*turbopackIgnore: true*/ path.dirname(full), { recursive: true });
    await writeFile(/*turbopackIgnore: true*/ full, data);
    return { url: `/api/files/${key}` };
  }
}

class DatabaseStorage implements StorageProvider {
  readonly id = "database" as const;
  async put(key: string, data: Buffer, contentType: string) {
    if (!isSafeKey(key)) throw new Error("Invalid storage key");
    await db
      .insert(schema.storedFiles)
      .values({ key, contentType, data })
      .onConflictDoUpdate({ target: schema.storedFiles.key, set: { contentType, data } });
    return { url: `/api/files/${key}` };
  }
}

class PinataStorage implements StorageProvider {
  readonly id = "pinata" as const;
  async put(key: string, data: Buffer, contentType: string) {
    const form = new FormData();
    form.append("network", "public");
    form.append("name", key);
    form.append("file", new Blob([new Uint8Array(data)], { type: contentType }), path.basename(key));
    const res = await fetch("https://uploads.pinata.cloud/v3/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.PINATA_JWT}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Pinata upload failed (${res.status})`);
    const body = (await res.json()) as { data?: { cid?: string } };
    if (!body.data?.cid) throw new Error("Pinata upload returned no CID");
    const gateway = env.PINATA_GATEWAY ?? "gateway.pinata.cloud";
    return { url: `https://${gateway}/ipfs/${body.data.cid}` };
  }
}

export async function readLocalFile(key: string): Promise<Buffer | null> {
  const full = resolveLocalPath(key);
  if (!full) return null;
  try {
    return await readFile(/*turbopackIgnore: true*/ full);
  } catch {
    return null;
  }
}

/**
 * Reads a file served by /api/files: from the database first (when that
 * provider is active), falling back to local disk.
 */
export async function readStoredFile(key: string): Promise<Buffer | null> {
  if (!isSafeKey(key)) return null;
  if (env.STORAGE_PROVIDER === "database") {
    const [row] = await db
      .select({ data: schema.storedFiles.data })
      .from(schema.storedFiles)
      .where(eq(schema.storedFiles.key, key))
      .limit(1);
    if (row) return row.data;
  }
  return readLocalFile(key);
}

let instance: StorageProvider | null = null;
export function storageProvider(): StorageProvider {
  if (!instance) {
    instance =
      env.STORAGE_PROVIDER === "pinata"
        ? new PinataStorage()
        : env.STORAGE_PROVIDER === "database"
          ? new DatabaseStorage()
          : new LocalStorage();
  }
  return instance;
}

/**
 * Token image uploads. Images are decoded and re-encoded server-side
 * (512×512 WebP, metadata stripped), so only clean raster data is stored or
 * served regardless of what was uploaded.
 */
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { ApiError } from "@/lib/api/errors";
import { db, schema } from "@/lib/db";
import { storageProvider } from "@/lib/providers/storage";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function storeTokenImage(wallet: string, file: File) {
  if (!ALLOWED.has(file.type)) throw new ApiError(415, "unsupported_media_type", "Use a PNG, JPG, WebP or GIF image.");
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "payload_too_large", "Images must be 4 MB or smaller.");
  const input = Buffer.from(await file.arrayBuffer());

  let output: Buffer;
  try {
    const img = sharp(input, { limitInputPixels: 25_000_000, animated: false });
    const meta = await img.metadata();
    if (!meta.width || !meta.height || meta.width < 64 || meta.height < 64) {
      throw new ApiError(422, "image_too_small", "Images must be at least 64×64 pixels.");
    }
    output = await img.rotate().resize(512, 512, { fit: "cover" }).webp({ quality: 88 }).toBuffer();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(422, "invalid_image", "That file couldn't be read as an image.");
  }

  const key = `tokens/${randomUUID()}.webp`;
  const { url } = await storageProvider().put(key, output, "image/webp");
  const [row] = await db
    .insert(schema.uploads)
    .values({ wallet, storageKey: key, url, contentType: "image/webp", bytes: output.byteLength })
    .returning({ id: schema.uploads.id });
  return { id: row.id, url };
}

/**
 * Perceptual "difference hash" (dHash) of a video thumbnail: 64 bits, hex.
 * Near-identical frames produce hashes within a small Hamming distance, which
 * lets the fraud engine detect re-uploads of the same content under new URLs.
 */
import sharp from "sharp";

const MAX_BYTES = 5 * 1024 * 1024;

export async function dHash(image: Buffer): Promise<string> {
  const { data } = await sharp(image, { limitInputPixels: 40_000_000 })
    .greyscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits += data[y * 9 + x] > data[y * 9 + x + 1] ? "1" : "0";
    }
  }
  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export async function dHashFromUrl(url: string): Promise<string | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    const res = await fetch(u, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return null;
    return await dHash(buf);
  } catch {
    return null;
  }
}

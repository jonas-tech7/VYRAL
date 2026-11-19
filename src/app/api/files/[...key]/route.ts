import { NextResponse, type NextRequest } from "next/server";
import { readLocalFile } from "@/lib/providers/storage";

const TYPES: Record<string, string> = { webp: "image/webp", json: "application/json" };

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/files/[...key]">) {
  const { key } = await ctx.params;
  const joined = key.join("/");
  const ext = joined.split(".").pop() ?? "";
  const type = TYPES[ext];
  if (!type) return new NextResponse("Not found", { status: 404 });
  const data = await readLocalFile(joined);
  if (!data) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
    },
  });
}

import { NextResponse, type NextRequest } from "next/server";
import { readStoredFile } from "@/lib/providers/storage";

const ID = /^[a-z0-9]{12}$/;

/**
 * Token metadata (pump.fun, wallets and explorers read it from the coin's URI).
 * The short path keeps the URI small enough for the launch, its locked fee
 * split and the deployer's first buy to fit in one transaction.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/m/[id]">) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return new NextResponse("Not found", { status: 404 });
  const data = await readStoredFile(`m/${id}.json`);
  if (!data) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

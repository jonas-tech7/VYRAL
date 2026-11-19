import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@/lib/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Permanent link written into token metadata when the launch service only
 * assigns the token address after the metadata exists. Forwards to the coin's
 * page on VYRAL once the launch is live, otherwise to the home page.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/l/[id]">) {
  const { id } = await ctx.params;
  let target = "/";
  if (UUID.test(id)) {
    const [launch] = await db
      .select({ mint: schema.launchRequests.mint, status: schema.launchRequests.status })
      .from(schema.launchRequests)
      .where(eq(schema.launchRequests.id, id));
    if (launch?.status === "confirmed") target = `/competitions/${launch.mint}`;
  }
  return NextResponse.redirect(new URL(target, req.url), { status: 307, headers: { "Cache-Control": "no-store" } });
}

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { db, schema } from "@/lib/db";
import { audit } from "./audit";
import type { Actor } from "./admin";

export const DISPUTE_CATEGORIES = ["video_rejected", "score_incorrect", "payout_issue", "ownership", "other"] as const;

export const disputeInputSchema = z
  .object({
    category: z.enum(DISPUTE_CATEGORIES),
    videoId: z.string().uuid().optional(),
    payoutId: z.string().uuid().optional(),
    message: z.string().trim().min(20, "Describe the issue in at least 20 characters").max(2000),
  })
  .refine((d) => d.videoId || d.payoutId || d.category === "other", "Select the video or payout this concerns");

export async function createDispute(wallet: string, input: z.infer<typeof disputeInputSchema>) {
  let competitionId: string | null = null;
  if (input.videoId) {
    const [v] = await db.select().from(schema.videos).where(eq(schema.videos.id, input.videoId));
    if (!v || v.creatorWallet !== wallet) throw new ApiError(403, "forbidden", "You can only dispute your own submissions.");
    competitionId = v.competitionId;
  }
  if (input.payoutId) {
    const [p] = await db.select().from(schema.payouts).where(eq(schema.payouts.id, input.payoutId));
    if (!p) throw new ApiError(404, "not_found", "Payout not found.");
    competitionId = p.competitionId;
  }
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.disputes)
    .where(and(eq(schema.disputes.wallet, wallet), eq(schema.disputes.status, "open")));
  if (Number(n) >= 5) throw new ApiError(429, "too_many_open", "You already have 5 open disputes. Wait for a response first.");

  return db.transaction(async (tx) => {
    const [d] = await tx
      .insert(schema.disputes)
      .values({ wallet, category: input.category, videoId: input.videoId ?? null, payoutId: input.payoutId ?? null, competitionId, message: input.message })
      .returning({ id: schema.disputes.id });
    await audit(tx, { actor: wallet, action: "dispute.open", targetType: "dispute", targetId: d.id, after: { category: input.category } });
    return { id: d.id };
  });
}

export async function resolveDispute(id: string, status: "resolved" | "rejected", resolution: string, actor: Actor) {
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(schema.disputes).where(eq(schema.disputes.id, id)).for("update");
    if (!d) throw new ApiError(404, "not_found", "Dispute not found.");
    if (d.status !== "open") throw new ApiError(409, "invalid_state", "This dispute is already closed.");
    await tx
      .update(schema.disputes)
      .set({ status, resolution, resolvedBy: actor.wallet, resolvedAt: new Date() })
      .where(eq(schema.disputes.id, id));
    await audit(tx, {
      actor: actor.wallet,
      actorRole: actor.role,
      action: `dispute.${status}`,
      targetType: "dispute",
      targetId: id,
      before: { status: d.status },
      after: { status },
      note: resolution,
      ipHash: actor.ipHash,
    });
    return { ok: true };
  });
}

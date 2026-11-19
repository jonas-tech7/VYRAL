import { schema, type Executor } from "@/lib/db";

export type AuditEntry = {
  actor: string;
  actorRole?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  note?: string | null;
  ipHash?: string | null;
};

/** Append-only audit record. Pass the open transaction so the log commits atomically with the change. */
export async function audit(ex: Executor, e: AuditEntry): Promise<void> {
  await ex.insert(schema.auditLogs).values({
    actor: e.actor,
    actorRole: e.actorRole ?? null,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId ?? null,
    before: (e.before ?? null) as never,
    after: (e.after ?? null) as never,
    note: e.note ?? null,
    ipHash: e.ipHash ?? null,
  });
}

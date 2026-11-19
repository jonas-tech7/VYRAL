import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { connection } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  await connection();
  try {
    const res = await db.execute(sql`SELECT max(finished_at) AS last_job FROM job_runs WHERE status = 'ok'`);
    const lastJob = (res.rows[0] as { last_job: string | null }).last_job;
    return NextResponse.json({ ok: true, database: "up", lastWorkerRun: lastJob }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, database: "down" }, { status: 503 });
  }
}

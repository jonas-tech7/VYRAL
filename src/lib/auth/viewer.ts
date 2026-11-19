import { cookies } from "next/headers";
import { connection } from "next/server";
import { SESSION_COOKIE, viewerFromToken, type Viewer } from "./session";

/** Current signed-in wallet for Server Components (call inside a Suspense boundary). */
export async function getViewer(): Promise<Viewer | null> {
  // Session validity depends on the current time: always resolve at request time,
  // never inside a prerendered (or per-session prefetched) shell.
  await connection();
  const store = await cookies();
  return viewerFromToken(store.get(SESSION_COOKIE)?.value);
}

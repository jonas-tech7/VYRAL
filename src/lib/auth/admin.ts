import { hasRole, type Role, type Viewer } from "./session";
import { getViewer } from "./viewer";

/**
 * Authorisation for admin Server Components. Call at the top of every admin
 * data component (layouts and pages render in parallel, so a layout-level
 * check alone is not sufficient). Mutations are additionally authorised by
 * the API route handlers.
 */
export async function requireRole(role: Role): Promise<{ ok: true; viewer: Viewer } | { ok: false; viewer: Viewer | null }> {
  const viewer = await getViewer();
  if (!viewer || !hasRole(viewer, role)) return { ok: false, viewer };
  return { ok: true, viewer };
}

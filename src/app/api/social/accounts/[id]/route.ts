import { badRequest, route } from "@/lib/api/handler";
import { unlinkAccount } from "@/lib/services/social-accounts";

export const DELETE = route<{ id: string }>({ auth: "user" }, async ({ params, viewer }) => {
  if (!/^[0-9a-f-]{36}$/.test(params.id)) throw badRequest("Invalid id");
  await unlinkAccount(viewer!.wallet, params.id);
  return { ok: true };
});

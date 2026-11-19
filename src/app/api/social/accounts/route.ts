import { route } from "@/lib/api/handler";
import { listLinkedAccounts } from "@/lib/services/social-accounts";

export const GET = route({ auth: "user" }, async ({ viewer }) => ({ accounts: await listLinkedAccounts(viewer!.wallet) }));

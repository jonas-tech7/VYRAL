import { route } from "@/lib/api/handler";
import { computeCalibration } from "@/lib/services/admin";

export const GET = route({ auth: "admin" }, async () => computeCalibration());

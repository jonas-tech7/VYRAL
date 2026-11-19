import { ApiError, route } from "@/lib/api/handler";
import { MAX_UPLOAD_BYTES, storeTokenImage } from "@/lib/services/uploads";

export const POST = route(
  { auth: "user", rateLimit: { name: "upload", limit: 30, windowSec: 3600, by: "wallet" } },
  async ({ req, viewer }) => {
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > MAX_UPLOAD_BYTES + 64 * 1024) throw new ApiError(413, "payload_too_large", "Images must be 4 MB or smaller.");
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "invalid_request", "Attach an image file.");
    return storeTokenImage(viewer!.wallet, file);
  },
);

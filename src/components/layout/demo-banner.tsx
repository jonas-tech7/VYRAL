import Link from "next/link";
import { showDemo } from "@/lib/env";

/** Shown whenever any provider runs on simulated data. */
export function DemoBanner() {
  if (!showDemo) return null;
  return (
    <div className="border-b border-edge bg-raised">
      <p className="mx-auto max-w-[1200px] px-4 py-2 text-center text-[12px] leading-relaxed text-ink-3 sm:px-6">
        <span className="font-medium text-ink-2">Demonstration environment.</span> Market data, video metrics, fees and payouts are simulated and not
        connected to live services.{" "}
        <Link href="/docs/architecture#providers" className="text-ink-2 underline decoration-edge-strong underline-offset-2 hover:text-ink">
          How live data connects
        </Link>
      </p>
    </div>
  );
}

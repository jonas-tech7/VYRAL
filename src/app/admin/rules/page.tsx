import { connection } from "next/server";
import { Suspense } from "react";
import { AccessDenied } from "@/components/admin/admin-ui";
import { AdminHeader } from "@/components/admin/admin-page";
import { EligibilityEditor, FraudEditor, PayoutsEditor, RewardCurveEditor } from "@/components/admin/rules-editors";
import { Skeleton } from "@/components/ui/misc";
import { requireRole } from "@/lib/auth/admin";
import { getAllConfig } from "@/lib/config/store";

export default function AdminRulesPage() {
  return (
    <>
      <AdminHeader
        title="Rules & reward curve"
        description="Every save creates a new version, is validated server-side and written to the audit log. Changes are visible publicly in the documentation."
      />
      <Suspense fallback={<Skeleton className="h-[900px] w-full" />}>
        <Rules />
      </Suspense>
    </>
  );
}

async function Rules() {
  await connection();
  const auth = await requireRole("admin");
  if (!auth.ok) return <AccessDenied signedIn={Boolean(auth.viewer)} />;
  const cfg = await getAllConfig();
  return (
    <div className="flex animate-fade-in flex-col gap-8">
      <RewardCurveEditor initial={cfg.reward_curve.value} version={cfg.reward_curve.version} />
      <PayoutsEditor initial={cfg.payouts.value} version={cfg.payouts.version} />
      <EligibilityEditor initial={cfg.eligibility.value} version={cfg.eligibility.version} />
      <FraudEditor initial={cfg.fraud.value} version={cfg.fraud.version} />
    </div>
  );
}

import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { LaunchForm } from "@/components/launch/launch-form";
import { Container, PageHeader, Skeleton } from "@/components/ui/misc";
import { getAllConfig } from "@/lib/config/store";
import { LAUNCH_SUPPLY, launchProvider } from "@/lib/providers/launch";

export const metadata: Metadata = {
  title: "Launch a coin",
  description: "Launch a token on Solana with a built-in video competition funded by its creator fees.",
};

export default function LaunchPage() {
  return (
    <Container>
      <PageHeader
        title="Launch a coin"
        description="Every token launched on VYRAL gets its own video competition. Review exactly how creator fees are shared before you sign."
      />
      <Suspense fallback={<Skeleton className="h-[720px] w-full" />}>
        <LaunchContent />
      </Suspense>
    </Container>
  );
}

async function LaunchContent() {
  await connection();
  const cfg = await getAllConfig();
  return (
    <LaunchForm
      config={{
        allowedIntervalsHours: cfg.payouts.value.allowedIntervalsHours,
        defaultIntervalHours: cfg.payouts.value.defaultIntervalHours,
        minVerifiedViews: cfg.eligibility.value.minVerifiedViews,
        rewardCurve: cfg.reward_curve.value,
        rewardCurveVersion: cfg.reward_curve.version,
        simulated: launchProvider().isSimulated,
        supply: LAUNCH_SUPPLY,
      }}
    />
  );
}

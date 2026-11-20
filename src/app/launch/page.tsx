import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { LaunchForm } from "@/components/launch/launch-form";
import { Container, Notice, PageHeader, Skeleton } from "@/components/ui/misc";
import { hasRole } from "@/lib/auth/session";
import { getViewer } from "@/lib/auth/viewer";
import { getAllConfig } from "@/lib/config/store";
import { launchesOpen } from "@/lib/env";
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
        description="Every coin launched on VYRAL goes live on pump.fun with its own video competition. Half of its creator fees fund the competition, locked on-chain."
      />
      <Suspense fallback={<Skeleton className="h-[720px] w-full" />}>
        <LaunchContent />
      </Suspense>
    </Container>
  );
}

async function LaunchContent() {
  await connection();
  if (!launchesOpen) {
    return (
      <Notice className="max-w-[640px]">
        Launching opens soon. Every coin launched on VYRAL goes live on pump.fun with its own video competition.
      </Notice>
    );
  }
  const [cfg, viewer] = await Promise.all([getAllConfig(), getViewer()]);
  return (
    <LaunchForm
      config={{
        allowedIntervalsHours: cfg.payouts.value.allowedIntervalsHours,
        defaultIntervalHours: cfg.payouts.value.defaultIntervalHours,
        minVerifiedViews: cfg.eligibility.value.minVerifiedViews,
        simulated: launchProvider().isSimulated,
        supply: LAUNCH_SUPPLY,
        canSetOfficial: hasRole(viewer, "admin") && !launchProvider().isSimulated,
      }}
    />
  );
}

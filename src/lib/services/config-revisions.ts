/**
 * Revisions of the shipped default configuration.
 *
 * `ensureConfigDefaults` only writes version 1 of missing keys, so databases
 * created before a default changed keep the old value. Each revision below is
 * applied once, through the normal versioned + audit-logged config path, and
 * only while the stored value still equals the previous default: anything an
 * administrator has changed is never overwritten.
 */
import { DEFAULT_CONFIG } from "@/lib/config/defaults";
import type { ConfigKey, ConfigShapes } from "@/lib/config/schemas";
import { getConfig, updateConfig } from "@/lib/config/store";
import { PLATFORMS } from "@/lib/domain/platforms";
import { rescoreAllActive } from "./scoring";

type Revision<K extends ConfigKey> = {
  id: string;
  key: K;
  /** True while the stored value is still the previous shipped default. */
  appliesTo: (current: ConfigShapes[K]) => boolean;
  next: (current: ConfigShapes[K]) => ConfigShapes[K];
  note: string;
};

const SYSTEM_ACTOR = { wallet: "system:defaults", role: "admin" } as const;

const PAYOUT_MINIMUM_500: Revision<"eligibility"> = {
  id: "2026-11-payout-minimum-500",
  key: "eligibility",
  appliesTo: (c) => c.minVerifiedViews === 5_000,
  next: (c) => ({ ...c, minVerifiedViews: DEFAULT_CONFIG.eligibility.minVerifiedViews }),
  note: "Default revision: payout minimum lowered from 5,000 to 500 verified views.",
};

const BENCHMARK_MULTIPLIERS: Revision<"scoring"> = {
  id: "2026-11-benchmark-multipliers",
  key: "scoring",
  appliesTo: (c) =>
    PLATFORMS.every((p) => {
      const m = c.multipliers[p];
      return m.source.kind === "default" && m.view === 1 && m.like === 1 && m.comment === 1;
    }),
  next: (c) => ({ ...c, multipliers: structuredClone(DEFAULT_CONFIG.scoring.multipliers) }),
  note: "Default revision: research-based platform multipliers (benchmark-sqrt-v1) replace the neutral starting values.",
};

const X_ESTIMATE: Revision<"scoring"> = {
  id: "2026-11-x-estimate",
  key: "scoring",
  appliesTo: (c) => {
    const m = c.multipliers.x;
    return m.source.kind === "default" && m.view === 1 && m.like === 1 && m.comment === 1;
  },
  next: (c) => ({ ...c, multipliers: { ...c.multipliers, x: structuredClone(DEFAULT_CONFIG.scoring.multipliers.x) } }),
  note: "Default revision: X uses the Instagram Reels values as an estimate until VYRAL has its own data.",
};

const FEE_SPLIT_FLAT: Revision<"reward_curve"> = {
  id: "2026-11-pumpfun-fee-split",
  key: "reward_curve",
  appliesTo: (c) =>
    c.interpolation === "linear" &&
    c.points.length === 2 &&
    c.points[0].marketCapUsd === 20_000 &&
    c.points[0].rewardBps === 5_000 &&
    c.points[1].marketCapUsd === 100_000 &&
    c.points[1].rewardBps === 2_500,
  next: () => structuredClone(DEFAULT_CONFIG.reward_curve),
  note: "Default revision: coins launch on pump.fun with 50% of creator fees locked to the reward vault, so all fees reaching the vault fund rewards.",
};

async function run<K extends ConfigKey>(rev: Revision<K>): Promise<boolean> {
  const current = await getConfig(rev.key);
  if (!rev.appliesTo(current.value)) return false;
  await updateConfig(rev.key, rev.next(current.value), SYSTEM_ACTOR, rev.note);
  return true;
}

/** Applies pending default revisions. Returns the ids that were applied. */
export async function applyDefaultRevisions(): Promise<string[]> {
  const applied: string[] = [];
  if (await run(PAYOUT_MINIMUM_500)) applied.push(PAYOUT_MINIMUM_500.id);
  if (await run(FEE_SPLIT_FLAT)) applied.push(FEE_SPLIT_FLAT.id);
  let rescore = false;
  if (await run(BENCHMARK_MULTIPLIERS)) {
    applied.push(BENCHMARK_MULTIPLIERS.id);
    rescore = true;
  }
  if (await run(X_ESTIMATE)) {
    applied.push(X_ESTIMATE.id);
    rescore = true;
  }
  if (rescore) await rescoreAllActive();
  return applied;
}

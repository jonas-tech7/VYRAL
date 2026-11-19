/**
 * Pure checkpoint math: eligibility, winner selection and fee allocation.
 * Database orchestration lives in lib/services/checkpoints.ts.
 */
import { compareEntries } from "@/lib/scoring/viral-score";

export type LeaderboardEntry = {
  id: string;
  creatorWallet: string;
  viralScore: number;
  views: number;
  submittedAt: Date;
  publishedAt: Date;
  status: "verified" | "under_review" | "rejected";
  openFlagCount: number;
  creatorBanned: boolean;
};

export type EligibilityRules = {
  minVerifiedViews: number;
  launchedAt: Date;
  checkpointAt: Date;
  excludedWallets: string[];
};

export type IneligibilityReason =
  | "not_verified"
  | "below_min_views"
  | "open_flags"
  | "creator_banned"
  | "published_before_launch"
  | "submitted_after_checkpoint"
  | "excluded_wallet";

export function eligibilityOf(entry: LeaderboardEntry, rules: EligibilityRules): IneligibilityReason | null {
  if (entry.status !== "verified") return "not_verified";
  if (entry.creatorBanned) return "creator_banned";
  if (entry.openFlagCount > 0) return "open_flags";
  if (entry.publishedAt <= rules.launchedAt) return "published_before_launch";
  if (entry.submittedAt > rules.checkpointAt) return "submitted_after_checkpoint";
  if (rules.excludedWallets.includes(entry.creatorWallet)) return "excluded_wallet";
  if (entry.views < rules.minVerifiedViews) return "below_min_views";
  return null;
}

export function rankEntries<T extends LeaderboardEntry>(entries: T[]): T[] {
  return [...entries].sort(compareEntries);
}

export function selectWinner<T extends LeaderboardEntry>(entries: T[], rules: EligibilityRules): T | null {
  for (const e of rankEntries(entries)) {
    if (eligibilityOf(e, rules) === null) return e;
  }
  return null;
}

export type Allocation = { rewardLamports: number; retainedLamports: number };

/**
 * Splits confirmed fees for a window. Integer lamports only; the reward is
 * rounded down so the protocol never allocates more than it collected.
 */
export function allocateFees(feesLamports: number, rewardBps: number): Allocation {
  if (!Number.isSafeInteger(feesLamports) || feesLamports < 0) throw new Error("fees must be a non-negative safe integer");
  if (!Number.isInteger(rewardBps) || rewardBps < 0 || rewardBps > 10_000) throw new Error("rewardBps out of range");
  const reward = Math.floor((feesLamports * rewardBps) / 10_000);
  return { rewardLamports: reward, retainedLamports: feesLamports - reward };
}

/**
 * Next checkpoint strictly after `now`, keeping the competition's cadence
 * anchored to its start time. Missed boundaries are collapsed (no
 * retroactive checkpoints); fees simply roll forward.
 */
export function nextCheckpointAfter(startsAt: Date, intervalHours: number, now: Date): Date {
  const intervalMs = intervalHours * 3_600_000;
  const elapsed = now.getTime() - startsAt.getTime();
  const k = elapsed < 0 ? 1 : Math.floor(elapsed / intervalMs) + 1;
  return new Date(startsAt.getTime() + k * intervalMs);
}

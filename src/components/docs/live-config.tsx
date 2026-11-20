import { connection } from "next/server";
import { getAllConfig } from "@/lib/config/store";
import { PLATFORM_LABEL, PLATFORMS } from "@/lib/domain/platforms";
import { bpsToPct, compactNumber, dateTimeUtc, fullNumber, sol } from "@/lib/format";
import { CREATOR_FEE_SPLIT } from "@/lib/launch/fee-split";

/** Live protocol parameters rendered into the docs, so documentation never drifts from configuration. */

function Caption({ version, updatedAt }: { version: number; updatedAt: Date | null }) {
  return (
    <p className="!mt-2 text-[12px] text-ink-4">
      Live configuration · v{version}
      {updatedAt ? ` · updated ${dateTimeUtc(updatedAt)}` : ""}
    </p>
  );
}

export async function LiveScoring() {
  await connection();
  const { scoring } = await getAllConfig();
  const c = scoring.value;
  return (
    <div>
      <table>
        <thead>
          <tr>
            <th>Component</th>
            <th>Weight</th>
            <th>Reference ceiling (= 100)</th>
            <th>Engagement cap</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Views</td>
            <td>{c.weights.views}%</td>
            <td>{compactNumber(c.referenceCeilings.views)}</td>
            <td>—</td>
          </tr>
          <tr>
            <td>Likes</td>
            <td>{c.weights.likes}%</td>
            <td>{compactNumber(c.referenceCeilings.likes)}</td>
            <td>{(c.engagementCaps.likesPerView * 100).toFixed(1)}% of views</td>
          </tr>
          <tr>
            <td>Comments</td>
            <td>{c.weights.comments}%</td>
            <td>{compactNumber(c.referenceCeilings.comments)}</td>
            <td>{(c.engagementCaps.commentsPerView * 100).toFixed(2)}% of views</td>
          </tr>
        </tbody>
      </table>
      <Caption version={scoring.version} updatedAt={scoring.updatedAt} />
    </div>
  );
}

export async function LiveMultipliers() {
  await connection();
  const { scoring } = await getAllConfig();
  const m = scoring.value.multipliers;
  return (
    <div>
      <table>
        <thead>
          <tr>
            <th>Platform</th>
            <th>View</th>
            <th>Like</th>
            <th>Comment</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {PLATFORMS.map((p) => (
            <tr key={p}>
              <td>{PLATFORM_LABEL[p]}</td>
              <td>{m[p].view.toFixed(3)}</td>
              <td>{m[p].like.toFixed(3)}</td>
              <td>{m[p].comment.toFixed(3)}</td>
              <td>
                {m[p].source.kind === "calibrated"
                  ? `Calibrated (n=${fullNumber(m[p].source.sampleSize ?? 0)}, ${m[p].source.windowDays}d)`
                  : (m[p].source.note ?? "Neutral default")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Caption version={scoring.version} updatedAt={scoring.updatedAt} />
    </div>
  );
}

export async function LiveEligibility() {
  await connection();
  const { eligibility, payouts } = await getAllConfig();
  return (
    <div>
      <table>
        <tbody>
          <tr>
            <td>Minimum verified views for payouts</td>
            <td>{fullNumber(eligibility.value.minVerifiedViews)}</td>
          </tr>
          <tr>
            <td>Linked account required</td>
            <td>{eligibility.value.requireLinkedAccount ? "Yes" : "No"}</td>
          </tr>
          <tr>
            <td>Entries per creator per competition</td>
            <td>{eligibility.value.maxSubmissionsPerCreatorPerCompetition}</td>
          </tr>
          <tr>
            <td>Token deployer may win its own competition</td>
            <td>{payouts.value.excludeDeployerFromRewards ? "No" : "Yes"}</td>
          </tr>
        </tbody>
      </table>
      <Caption version={eligibility.version} updatedAt={eligibility.updatedAt} />
    </div>
  );
}

export async function LivePayouts() {
  await connection();
  const { payouts } = await getAllConfig();
  const p = payouts.value;
  return (
    <div>
      <table>
        <tbody>
          <tr>
            <td>Payout intervals available at launch</td>
            <td>{p.allowedIntervalsHours.map((h) => `${h}h`).join(", ")} (default {p.defaultIntervalHours}h)</td>
          </tr>
          <tr>
            <td>Reference market cap TWAP window</td>
            <td>{p.twapWindowMinutes} minutes</td>
          </tr>
          <tr>
            <td>Minimum price observations in window</td>
            <td>{p.minPriceSamples}</td>
          </tr>
          <tr>
            <td>Maximum price staleness</td>
            <td>{p.maxPriceStalenessMinutes} minutes</td>
          </tr>
          <tr>
            <td>Minimum payout (dust threshold)</td>
            <td>{sol(p.minPayoutLamports)}</td>
          </tr>
          <tr>
            <td>Automatic transaction attempts</td>
            <td>{p.autoAttemptBudget}</td>
          </tr>
        </tbody>
      </table>
      <Caption version={payouts.version} updatedAt={payouts.updatedAt} />
    </div>
  );
}

/**
 * The creator-fee split every coin launches with. It is written into each
 * coin's launch transaction and locked on-chain, so unlike the parameters
 * above it has no live configuration version.
 */
export function FeeSplit() {
  const rows = [
    { bps: CREATOR_FEE_SPLIT.vaultBps, dot: "bg-accent", to: "VYRAL's reward vault, for the coin's competition" },
    { bps: CREATOR_FEE_SPLIT.deployerBps, dot: "bg-ink-2", to: "The deployer's wallet" },
    { bps: CREATOR_FEE_SPLIT.buybackBps, dot: "bg-ink-3", to: "VYRAL's platform wallet: buys and burns $VYRAL" },
    { bps: CREATOR_FEE_SPLIT.treasuryBps, dot: "bg-ink-4", to: "VYRAL's platform wallet: forwarded to the treasury" },
  ];
  return (
    <div>
      <div className="my-4 flex h-2.5 gap-px overflow-hidden rounded-full bg-overlay-2" aria-hidden>
        {rows.map((r) => (
          <div key={r.dot} className={`h-full ${r.dot}`} style={{ width: `${r.bps / 100}%` }} />
        ))}
      </div>
      <table>
        <thead>
          <tr>
            <th>Share of creator fees</th>
            <th>Paid by pump.fun to</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.dot}>
              <td>
                <span className="inline-flex items-center gap-2 text-ink">
                  <span className={`size-2 rounded-full ${r.dot}`} aria-hidden />
                  {bpsToPct(r.bps)}
                </span>
              </td>
              <td>{r.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="!mt-2 text-[12px] text-ink-4">Set in each coin&apos;s launch transaction and locked on-chain</p>
    </div>
  );
}

export async function LiveFraud() {
  await connection();
  const { fraud } = await getAllConfig();
  const f = fraud.value;
  return (
    <div>
      <table>
        <tbody>
          <tr>
            <td>Severity weights (low / medium / high)</td>
            <td>
              {f.severityWeights.low} / {f.severityWeights.medium} / {f.severityWeights.high}
            </td>
          </tr>
          <tr>
            <td>Review threshold for accumulated low signals</td>
            <td>risk ≥ {f.reviewRiskThreshold}</td>
          </tr>
          <tr>
            <td>View spike</td>
            <td>
              ≥ {f.spike.rateMultiple}× the video&apos;s prior median rate and ≥ {compactNumber(f.spike.minDeltaViews)} new views
            </td>
          </tr>
          <tr>
            <td>Fingerprint match (re-uploads)</td>
            <td>Hamming distance ≤ {f.fingerprint.maxHammingDistance} of 64 bits</td>
          </tr>
          <tr>
            <td>Uniform growth</td>
            <td>
              {f.uniformGrowth.minIntervals} consecutive hours with variation &lt; {(f.uniformGrowth.maxCoefficientOfVariation * 100).toFixed(0)}%
            </td>
          </tr>
        </tbody>
      </table>
      <Caption version={fraud.version} updatedAt={fraud.updatedAt} />
    </div>
  );
}

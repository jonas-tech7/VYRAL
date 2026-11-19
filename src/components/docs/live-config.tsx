import { connection } from "next/server";
import { CurveChart } from "@/components/charts/curve-chart";
import { getAllConfig } from "@/lib/config/store";
import { PLATFORM_LABEL, PLATFORMS } from "@/lib/domain/platforms";
import { bpsToPct, compactNumber, dateTimeUtc, fullNumber, sol, usd } from "@/lib/format";

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

export async function LiveCurve() {
  await connection();
  const { reward_curve } = await getAllConfig();
  const c = reward_curve.value;
  return (
    <div>
      <div className="not-prose my-4 rounded-lg border border-edge p-4">
        <CurveChart curve={c} height={200} />
      </div>
      <table>
        <thead>
          <tr>
            <th>Reference market cap</th>
            <th>Share of new confirmed fees to the winner</th>
          </tr>
        </thead>
        <tbody>
          {c.points.map((pt) => (
            <tr key={pt.marketCapUsd}>
              <td>{usd(pt.marketCapUsd, { compact: true })}</td>
              <td>{bpsToPct(pt.rewardBps)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Interpolation: <strong>{c.interpolation}</strong>. Below the first point the first share applies; above the last point, the last share applies.
      </p>
      <Caption version={reward_curve.version} updatedAt={reward_curve.updatedAt} />
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

import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { FeeSplit, LiveEligibility, LiveFraud, LiveMultipliers, LivePayouts, LiveScoring } from "@/components/docs/live-config";
import { bpsToPct } from "@/lib/format";
import { CREATOR_FEE_SPLIT } from "@/lib/launch/fee-split";

export type DocPage = { slug: string; title: string; description: string; body: () => ReactNode };

const VAULT_PCT = bpsToPct(CREATOR_FEE_SPLIT.vaultBps);
const DEPLOYER_PCT = bpsToPct(CREATOR_FEE_SPLIT.deployerBps);
const BUYBACK_PCT = bpsToPct(CREATOR_FEE_SPLIT.buybackBps);
const TREASURY_PCT = bpsToPct(CREATOR_FEE_SPLIT.treasuryBps);
const PLATFORM_PCT = bpsToPct(CREATOR_FEE_SPLIT.buybackBps + CREATOR_FEE_SPLIT.treasuryBps);

function Live({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p className="text-[13px] text-ink-4">Loading live configuration…</p>}>{children}</Suspense>;
}

const overview: DocPage = {
  slug: "",
  title: "Introduction",
  description: "How VYRAL turns a token's creator fees into rewards for the creators who make it go viral.",
  body: () => (
    <>
      <p>
        <strong>Memes are attention.</strong> A coin lives on the people who talk about it: the videos, the reposts, the conversation. VYRAL exists to
        make coins go viral &mdash; that is where the name comes from.
      </p>
      <p>
        VYRAL is a token launchpad on Solana where every launch opens its own video competition. Coins launch on pump.fun, and {VAULT_PCT} of the
        creator fees each coin earns from trading are used to pay the creators and influencers who promote it best. Every 3 or 6 hours, the top-ranked
        eligible video is paid, ranked by a transparent score and settled as a Solana transaction anyone can verify.
      </p>
      <p>
        The incentives point the same way. Creators are paid for the reach they actually generate, and the coin gains the attention it needs to be
        discovered. More attention can bring more trading, and trading generates the fees that fund the next rewards.
      </p>
      <h2 id="loop">The loop</h2>
      <ol>
        <li>
          <strong>Launch.</strong> A deployer launches a coin on pump.fun. The launch transaction splits the coin&apos;s creator fees ({VAULT_PCT} to
          its competition, {DEPLOYER_PCT} to the deployer, {PLATFORM_PCT} to VYRAL&apos;s platform wallet for the $VYRAL buyback and the treasury)
          and locks the split on-chain. VYRAL verifies the launch and opens the competition in the
          same step that records the coin.
        </li>
        <li>
          <strong>Create.</strong> Creators publish videos on TikTok, YouTube Shorts, Instagram Reels or X after the launch and submit the links.
          Publication time and ownership are verified with platform data.
        </li>
        <li>
          <strong>Compete.</strong> Views, likes and comments sync automatically. The <Link href="/docs/viral-score">Viral Score</Link> ranks videos
          comparably across platforms; an <Link href="/docs/anti-fraud">anti-fraud system</Link> routes suspicious entries to human review.
        </li>
        <li>
          <strong>Get paid.</strong> Every 3 or 6 hours a <Link href="/docs/payouts">checkpoint</Link> pays the top eligible creator the coin&apos;s
          confirmed fees in the reward vault. Each payout is a Solana transaction anyone can verify.
        </li>
      </ol>
      <h2 id="principles">Principles</h2>
      <ul>
        <li>Competitions are continuous. There are no fixed 24-hour rounds; a token&apos;s competition runs for as long as it is active.</li>
        <li>Only fees that were actually collected and confirmed on-chain fund rewards. Unallocated fees stay accounted for and roll forward.</li>
        <li>The creator-fee split is locked on-chain at launch. Neither the deployer nor VYRAL can change it, and VYRAL never holds the deployer&apos;s share.</li>
        <li>Every parameter that affects money — scoring weights, platform multipliers, thresholds — is versioned, visible and audit-logged.</li>
        <li>Automated systems flag; people decide. No creator is rejected on a single suspicious metric.</li>
        <li>VYRAL never asks for a seed phrase or private key. Wallets sign messages and transactions locally.</li>
      </ul>
      <h2 id="demo">Demonstration environment</h2>
      <p>
        When any data provider runs in development mode, the site shows a notice at the top of every page and marks simulated records. See{" "}
        <Link href="/docs/architecture#providers">Architecture → Providers</Link> for how live data sources are connected.
      </p>
    </>
  ),
};

const launching: DocPage = {
  slug: "launching",
  title: "Launching a token",
  description: "What a deployer configures, what is fixed, and how the launch is signed.",
  body: () => (
    <>
      <p>Every coin launches on pump.fun. Launching takes a few minutes and requires a connected Solana wallet. You provide:</p>
      <ul>
        <li>Name (2–32 characters) and ticker (2–10 letters or digits)</li>
        <li>An image (PNG, JPG, WebP or GIF up to 4 MB, re-encoded to a 512×512 WebP with metadata removed)</li>
        <li>An optional description and social links (website, X, Telegram, Discord)</li>
        <li>The competition&apos;s payout interval, chosen from the intervals administrators allow</li>
        <li>An optional initial buy, executed in the launch transaction (live launches only)</li>
      </ul>
      <h2 id="fixed">Fixed parameters</h2>
      <p>
        Supply (1,000,000,000) and decimals (6) are set by the launch program, and mint authority is revoked at launch. The creator-fee split is fixed
        as well: {VAULT_PCT} to the coin&apos;s competition, {DEPLOYER_PCT} to you, {BUYBACK_PCT} to the $VYRAL buyback and {TREASURY_PCT} to the
        VYRAL treasury, locked on-chain in the launch transaction (see{" "}
        <Link href="/docs/fees">Fees &amp; payouts</Link>). The eligibility rules in force at launch are copied into the competition; administrators can
        update them later, and every change is logged.
      </p>
      <h2 id="signing">Signing</h2>
      <p>
        The server prepares the launch transaction and signs it for the new mint; your wallet signs and sends it. The transaction creates the coin on
        pump.fun, makes pump.fun&apos;s fee-sharing configuration the coin&apos;s creator, sets the shares ({VAULT_PCT} to VYRAL&apos;s reward vault,{" "}
        {DEPLOYER_PCT} to your wallet, {PLATFORM_PCT} to VYRAL&apos;s platform wallet) and revokes the configuration&apos;s admin. Because the mint&apos;s signature covers the whole transaction, the
        split cannot be removed or altered without invalidating it.
      </p>
      <p>
        Before recording the token, VYRAL verifies the confirmed transaction on-chain: that it succeeded, that you signed it, that it created the
        prepared mint, and that the coin&apos;s creator fees are routed through the fee split with the expected shares and a revoked admin. In the
        demonstration environment you sign a launch-intent message instead, and no token is created on-chain.
      </p>
      <h2 id="after">After launch</h2>
      <p>
        You land on the token&apos;s competition page. Videos published from that moment on are eligible. As deployer you receive {DEPLOYER_PCT} of the
        coin&apos;s creator fees, paid to your wallet by pump.fun each time the fees are distributed; VYRAL never holds them. By default your own videos
        cannot win your token&apos;s competition.
      </p>
      <h2 id="linked">Linked to its VYRAL page</h2>
      <p>
        Every coin launched on VYRAL links to its own page on VYRAL (<code>/competitions/&lt;contract address&gt;</code>) from the moment it exists. The
        link is written into the token metadata as its <code>external_url</code>, as <code>extensions.vyral</code> and as the last line of the
        description, so wherever the coin appears, people can find its competition. Your own website stays in <code>extensions.website</code>. When a
        launch service only assigns the address after the metadata is written, the link is a permanent <code>/l/&lt;launch id&gt;</code> address that
        forwards to the coin&apos;s page.
      </p>
    </>
  ),
};

const competitions: DocPage = {
  slug: "competitions",
  title: "Competitions",
  description: "Continuous competitions, checkpoints and competition states.",
  body: () => (
    <>
      <p>
        Every token has exactly one competition. It starts at launch and runs continuously. Instead of rounds with a fixed end, it has
        <strong> checkpoints</strong> on a fixed cadence (every 3 or 6 hours, anchored to the launch time). At each checkpoint the current
        top-ranked eligible video is paid, and the competition simply continues.
      </p>
      <h2 id="leaderboard">Leaderboard</h2>
      <p>
        All submitted videos that aren&apos;t rejected appear on the leaderboard, ranked by Viral Score. Ties break by views, then earlier submission.
        Videos below the view threshold appear as <em>not yet eligible</em>; flagged videos appear as <em>under review</em> and cannot win until a reviewer
        clears them.
      </p>
      <h2 id="states">States</h2>
      <table>
        <thead>
          <tr>
            <th>State</th>
            <th>Behaviour</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Active</td>
            <td>Accepting entries; checkpoints pay winners.</td>
          </tr>
          <tr>
            <td>Paused</td>
            <td>Set by administrators (with a public reason). No new entries; checkpoints are recorded as skipped and fees roll over until it resumes.</td>
          </tr>
          <tr>
            <td>Ended</td>
            <td>Final. No entries or payouts.</td>
          </tr>
        </tbody>
      </table>
    </>
  ),
};

const viralScore: DocPage = {
  slug: "viral-score",
  title: "Viral Score",
  description: "How videos are ranked comparably across platforms.",
  body: () => (
    <>
      <p>
        The Viral Score (model <code>viral-score-v1</code>) ranks videos by attention. Views carry the most weight; likes and comments add signal about
        engagement. Because the same raw number means different things on different platforms, metrics are normalised before they are combined.
      </p>
      <h2 id="formula">Formula</h2>
      <pre>
        <code>{`1. adjusted     = raw × multiplier[platform][metric]
2. likes'       = min(likes_adj,    views_adj × likeCap)
   comments'    = min(comments_adj, views_adj × commentCap)
3. component(x) = 100 × log10(1 + x) / log10(1 + ceiling)
4. score        = Σ weight × component / 100`}</code>
      </pre>
      <ul>
        <li>
          <strong>Platform multipliers</strong> are exchange rates. A like multiplier of 0.5 on a platform means one like there counts as half a baseline
          like, because likes are twice as easy to obtain.
        </li>
        <li>
          <strong>Engagement caps</strong> stop bought likes or comments from outranking reach: engagement only counts up to a fixed share of views.
        </li>
        <li>
          <strong>Logarithmic scaling</strong> reflects heavy-tailed attention: going from 10K to 100K views matters as much as 100K to 1M. A metric at its
          reference ceiling scores 100; values above it score above 100, so ranking stays strictly ordered.
        </li>
      </ul>
      <Live>
        <LiveScoring />
      </Live>
      <h2 id="example">Worked example</h2>
      <p>
        A TikTok video (TikTok is the baseline platform, multipliers 1.00) with 1,000,000 views, 80,000 likes and 1,500 comments scores: views
        85.71, likes 81.72, comments 67.60 → <strong>80.18</strong>. The full breakdown of every score is stored with the video, and every checkpoint
        stores the configuration it used.
      </p>
      <h2 id="multipliers">Platform multipliers</h2>
      <Live>
        <LiveMultipliers />
      </Live>
      <p>
        A like on TikTok is not worth the same as a like on YouTube Shorts: some platforms hand out views, likes and comments far more easily than
        others. Each platform therefore has three separate multipliers (views, likes, comments), and every value cites its source in the table above.
      </p>
      <h3 id="benchmark">Starting values: published benchmarks (benchmark-sqrt-v1)</h3>
      <p>
        TikTok is the baseline (1.00). For every metric, <code>multiplier = √(TikTok average per video ÷ platform average per video)</code>, using the
        largest published cross-platform short-form studies:
      </p>
      <table>
        <thead>
          <tr>
            <th>Average per video</th>
            <th>TikTok</th>
            <th>Instagram Reels</th>
            <th>YouTube Shorts</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Views</td>
            <td>32,895</td>
            <td>23,074</td>
            <td>5,321</td>
            <td>Metricool, State of Short-Form Social Media 2026 (6.18M videos, 375K accounts)</td>
          </tr>
          <tr>
            <td>Likes</td>
            <td>1,097</td>
            <td>765</td>
            <td>88</td>
            <td>Same study, as reported in a secondary summary</td>
          </tr>
          <tr>
            <td>Comments</td>
            <td>50</td>
            <td>20</td>
            <td>10</td>
            <td>Socialinsider, TikTok vs Reels vs Shorts 2026, as reported in secondary summaries</td>
          </tr>
        </tbody>
      </table>
      <ul>
        <li>
          <strong>Why the square root?</strong> Platform averages mix very different account sizes and content types. Full ratios (YouTube likes: 12.5×)
          would over-correct; the square root keeps the direction and dampens the size (3.53×). YouTube Shorts likes are additionally capped at
          1.75×, so likes on one platform can&apos;t dominate the ranking. A typical Short still ranks below a typical TikTok video with the same
          relative performance, but the gap narrows.
        </li>
        <li>
          <strong>Where sources disagree</strong>, the multiplier stays neutral: Metricool reports Reels with the most comments per video, Socialinsider
          reports TikTok ahead, so the Reels comment multiplier is 1.00.
        </li>
        <li>
          <strong>X is an estimate</strong>: no comparable published short-form benchmark exists (X counts every post impression as a view), so X uses
          the Instagram Reels values (views ×1.19, likes ×1.20) as a product decision until VYRAL&apos;s own data replaces them. It is labelled as an
          estimate in the table above.
        </li>
        <li>
          These are published study averages applied with a documented method, not official platform figures, and they are a starting point.
        </li>
      </ul>
      <h3 id="calibration">Replacing them with VYRAL&apos;s own data</h3>
      <p>
        Once enough verified videos exist, administrators can apply a calibration from VYRAL&apos;s own history (<code>median-rate-ratio-v1</code>): for
        each platform, the median likes-per-view and comments-per-view of verified, unflagged videos (≥ 1,000 views, last 90 days) is compared to the
        median across platforms. The ratio is shrunk toward 1.0 for small samples (<code>m = raw^(n / (n + 50))</code>), clamped to [0.1, 10], and
        requires at least 30 videos per platform and two platforms with data. Because likes and comments are scored on absolute counts, the applied
        value combines both difficulties: <code>like multiplier = view multiplier × calibrated like-rate multiplier</code>.
      </p>
      <p>
        View multipliers are never calibrated automatically: engagement data cannot tell how strictly a platform counts a view. They change only by an
        administrator decision with a cited source. A manual value cannot be saved without a source note.
      </p>
      <h2 id="changes">Changes</h2>
      <p>
        A configuration change bumps its version, is written to an append-only audit log, and rescores videos in active competitions. Past checkpoints
        keep the scores and configuration snapshot they were decided with.
      </p>
    </>
  ),
};

const eligibility: DocPage = {
  slug: "eligibility",
  title: "Eligibility & verification",
  description: "Submission rules, ownership, publication time and payout eligibility.",
  body: () => (
    <>
      <h2 id="submission">Submitting a video</h2>
      <ul>
        <li>
          <strong>Published after launch.</strong> The publication time comes from the platform (YouTube Data API, TikTok Display API, Instagram Graph API,
          X API). A video published before the token launched never qualifies — editing it or resubmitting it doesn&apos;t change its original
          publication time.
        </li>
        <li>
          <strong>Recorded rejections.</strong> Pre-launch submissions are stored as rejected, so the same video can never be entered again, and its visual
          fingerprint lets the fraud system recognise re-uploads of the same footage under a new link.
        </li>
        <li>
          <strong>Once, anywhere.</strong> A video (platform + video ID) can be entered once across all competitions, regardless of URL format or tracking
          parameters.
        </li>
        <li>
          <strong>Contract address in the post.</strong> The caption, title or description must contain the coin&apos;s contract address (a link that
          contains it counts too). VYRAL reads the post text from the platform when you submit and again at every metrics refresh; removing the address
          later sends the entry back to human review.
        </li>
        <li>
          <strong>Ownership.</strong> The video must be published by a platform account linked to your wallet. Linking uses each platform&apos;s official OAuth
          flow and grants read-only access to that account&apos;s video metrics.
        </li>
        <li>
          <strong>Short-form only.</strong> YouTube entries must be Shorts-length; Instagram entries must be Reels or videos; X entries must contain video.
        </li>
      </ul>
      <h2 id="payout">Payout eligibility</h2>
      <p>At a checkpoint, a video can win only if it is:</p>
      <ul>
        <li>Verified (not under review or rejected) and without open medium- or high-severity flags</li>
        <li>At or above the verified view threshold (500 verified views by default). If no video reaches it, nobody is paid and the fees roll over</li>
        <li>Submitted before the checkpoint time, by a creator in good standing</li>
        <li>Not submitted by the token&apos;s deployer (unless administrators change this rule)</li>
      </ul>
      <Live>
        <LiveEligibility />
      </Live>
      <h2 id="statuses">Statuses</h2>
      <table>
        <tbody>
          <tr>
            <td>Verified</td>
            <td>Passed submission checks; metrics are tracked and the video can win once eligible.</td>
          </tr>
          <tr>
            <td>Under review</td>
            <td>Flagged by automated checks. Stays on the leaderboard but cannot win until a reviewer decides.</td>
          </tr>
          <tr>
            <td>Rejected</td>
            <td>Failed a rule or a review. Creators can open a dispute from their account page.</td>
          </tr>
        </tbody>
      </table>
    </>
  ),
};

const antiFraud: DocPage = {
  slug: "anti-fraud",
  title: "Anti-fraud",
  description: "Signals, risk scoring, human review and disputes.",
  body: () => (
    <>
      <p>
        Every metric sync runs a set of independent detectors over the video&apos;s history and context. Detectors produce flags with a severity and the
        evidence behind them. Flags never reject a video on their own.
      </p>
      <h2 id="signals">Signals</h2>
      <table>
        <thead>
          <tr>
            <th>Signal</th>
            <th>What it looks for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Suspicious view spike</td>
            <td>A sync interval whose view rate far exceeds the video&apos;s own prior median. Low severity alone (organic virality spikes too); medium when engagement does not follow.</td>
          </tr>
          <tr>
            <td>Possible purchased views</td>
            <td>Large view increases with a like rate far below the video&apos;s baseline.</td>
          </tr>
          <tr>
            <td>Possible purchased likes</td>
            <td>Likes jumping without matching views.</td>
          </tr>
          <tr>
            <td>Unnatural engagement ratios</td>
            <td>Like or comment rates beyond configured bounds; high reach with near-zero engagement.</td>
          </tr>
          <tr>
            <td>Repetitive growth patterns</td>
            <td>Near-constant hourly growth over many hours, and increments in exact round numbers — typical of scripted delivery.</td>
          </tr>
          <tr>
            <td>Metrics regression</td>
            <td>Views or likes dropping between syncs, consistent with a platform removing inauthentic activity.</td>
          </tr>
          <tr>
            <td>Reused content</td>
            <td>The video&apos;s perceptual fingerprint matches footage published before the launch or by another wallet.</td>
          </tr>
          <tr>
            <td>Duplicate submissions</td>
            <td>The same footage entered several times by one wallet.</td>
          </tr>
          <tr>
            <td>Suspicious creator activity</td>
            <td>Unusual submission velocity, one social account linked to several wallets, many wallets from one network, or the token deployer entering its own competition.</td>
          </tr>
        </tbody>
      </table>
      <h2 id="routing">Risk and review</h2>
      <ul>
        <li>Any medium- or high-severity flag moves a video to <em>under review</em>. It stays visible but cannot win until a reviewer decides.</li>
        <li>Low-severity signals are informational; several of them together route a video to review once their combined risk reaches the threshold.</li>
        <li>Reviewers verify (dismissing the flags) or reject (confirming them), always with a note. A dismissed signal is not raised again unless its severity increases.</li>
        <li>Every decision is written to the append-only audit log. Creators can dispute decisions from their account page.</li>
      </ul>
      <Live>
        <LiveFraud />
      </Live>
    </>
  ),
};

const payouts: DocPage = {
  slug: "payouts",
  title: "Payouts",
  description: "Checkpoints, allocation, transaction safety and fallbacks.",
  body: () => (
    <>
      <h2 id="checkpoint">At every checkpoint</h2>
      <ol>
        <li>Retrieve the latest verified video statistics.</li>
        <li>Calculate current Viral Scores.</li>
        <li>Identify the highest-ranking eligible video.</li>
        <li>Compute the reference market cap, which is recorded with the checkpoint.</li>
        <li>Allocate the coin&apos;s fees in the reward vault that are collected, confirmed and not yet allocated: all of them go to the winner.</li>
        <li>Send the reward to the winning creator&apos;s wallet.</li>
        <li>Record the transaction publicly on the competition page.</li>
      </ol>
      <p>
        Steps 1–5 happen in a single database transaction. The checkpoint is keyed by competition and scheduled time, so it can only ever be processed
        once — retries, crashes and multiple workers cannot create a second payout.
      </p>
      <h2 id="reference">Reference market cap</h2>
      <p>
        <code>reference market cap = TWAP(price, window) × on-chain supply</code>. Prices are sampled every minute from an aggregator of on-chain
        liquidity; supply is read from the token mint, and each observation is weighted by how long it was the latest price. The reference market cap
        does not change the reward: it is recorded with every checkpoint and shown in the competition&apos;s checkpoint log. If there are too few
        observations or the latest is stale, the checkpoint is skipped and fees roll over.
      </p>
      <Live>
        <LivePayouts />
      </Live>
      <h2 id="allocation">Allocation</h2>
      <pre>
        <code>{`fees_in_window = Σ confirmed vault fees of the coin, not yet allocated   // integer lamports
reward         = fees_in_window                                          // 100% to the winner`}</code>
      </pre>
      <p>
        <code>fees_in_window</code> includes fees that rolled over from earlier checkpoints. Only the competition&apos;s share of a coin&apos;s creator
        fees ever reaches the reward vault; pump.fun pays the deployer&apos;s share directly, so nothing is deducted or retained at a checkpoint.
      </p>
      <p>Fees roll forward untouched when there are no new confirmed fees, no eligible video, or the reward is below the minimum. Missing price data never holds a payout back: the market cap is recorded when available but does not change the reward.</p>
      <h2 id="transactions">Transaction safety</h2>
      <ul>
        <li>Each attempt is a fully signed transfer from the reward vault with a memo <code>VYRAL payout &lt;id&gt;</code>. Its signature is stored before broadcast.</li>
        <li>At most one attempt can be in flight per payout — enforced by a database constraint.</li>
        <li>A new attempt is built only after the previous one is provably final: confirmed, failed on-chain, or its blockhash expired without the signature landing (an expired transaction can never land).</li>
        <li>A payout is shown as paid only once its transaction is finalized.</li>
      </ul>
      <h2 id="fallback">If a transfer fails</h2>
      <p>
        After the automatic attempts are exhausted, the payout is marked <em>needs attention</em>. The winning creator can claim it from their account
        page with a fresh wallet signature, which queues new attempts to the same wallet. Administrators can also retry, settle it with a transfer made
        outside the automatic flow (only after the transaction is verified on-chain to pay the right wallet at least the right amount), or void it, which
        returns its fees to the pool. All of these actions are logged.
      </p>
      <h2 id="verify">Verifying a payout yourself</h2>
      <p>
        Open the transaction signature from a competition&apos;s payout history in any Solana explorer. The transfer goes from the reward vault to the
        creator wallet listed, for the amount listed, and carries the payout ID in its memo.
      </p>
    </>
  ),
};

const fees: DocPage = {
  slug: "fees",
  title: "Fees & payouts",
  description: "Where rewards come from: the locked fee split, the fee keeper and what each checkpoint pays.",
  body: () => (
    <>
      <p>
        Every coin launched on VYRAL trades on pump.fun, and trading generates <strong>creator fees</strong>. How they are split between the
        coin&apos;s competition and its deployer is set when the coin launches and cannot be changed afterwards.
      </p>
      <h2 id="split">The split</h2>
      <FeeSplit />
      <p>
        The competition&apos;s {VAULT_PCT} is recorded for the coin and all of it funds that coin&apos;s competition. The deployer&apos;s {DEPLOYER_PCT}{" "}
        never passes through VYRAL: pump.fun pays it to the deployer&apos;s wallet directly, so VYRAL cannot hold, delay or redirect it.
      </p>
      <p>
        The buyback ({BUYBACK_PCT}) and treasury ({TREASURY_PCT}) shares are locked to one VYRAL platform wallet, which keeps the launch, its split and
        the deployer&apos;s first buy inside one transaction. A job splits every deposit to that wallet: a third is forwarded to the treasury, the rest
        buys $VYRAL through Jupiter in steps that stay under a price-impact limit, and every token bought is burned. Each buy, burn and transfer is
        listed with its transaction on the <Link href="/burns">Buyback &amp; burn</Link> page. The buyback spends fees that have already been
        collected; it is not a promise about price, and $VYRAL gives no claim on VYRAL&apos;s revenue.
      </p>
      <h2 id="locked">Locked on-chain</h2>
      <p>
        The split is part of the launch transaction. The transaction that creates the coin also makes pump.fun&apos;s fee-sharing configuration the
        coin&apos;s creator, sets the shares and revokes the configuration&apos;s admin. With the admin revoked, nobody (not the deployer, not
        VYRAL) can change the shares. VYRAL verifies all of this on-chain before it opens the coin&apos;s competition, and because the fee-sharing
        configuration is a public account, anyone can check it.
      </p>
      <h2 id="keeper">From pump.fun to the reward vault</h2>
      <p>
        A coin&apos;s creator fees accrue on pump.fun until they are distributed. Distribution is permissionless: anyone can trigger it, and the
        locked shares decide where the fees go. VYRAL&apos;s fee keeper triggers it for every coin on a regular schedule, once the accrued fees reach
        pump.fun&apos;s minimum distributable amount. Each distribution pays the vault&apos;s share into VYRAL&apos;s reward vault and the
        deployer&apos;s share to the deployer&apos;s wallet, in the same transaction.
      </p>
      <p>
        The amount the reward vault receives in a distribution is recorded as a fee for that coin, together with the transaction signature. It counts
        once the transaction is finalized; until then it is shown as pending and is never paid out.
      </p>
      <h2 id="checkpoints">What a checkpoint pays</h2>
      <p>
        At every checkpoint the top eligible video receives 100% of the coin&apos;s unallocated confirmed vault fees: everything recorded for the coin
        that no earlier checkpoint has allocated, including fees that rolled over. If no video is eligible (see{" "}
        <Link href="/docs/eligibility">Eligibility</Link>), nothing is paid and the fees roll over to the next checkpoint; the same happens when the
        amount is below the minimum payout. <Link href="/docs/payouts">Payouts</Link> describes the checkpoint and the transfer in detail.
      </p>
      <h2 id="funding">Nothing is pre-funded</h2>
      <p>
        Rewards are paid only from fees that were actually collected, and nothing is promised in advance. Fees are accounted per coin, so a coin&apos;s
        competition is paid only from that coin&apos;s fees: if a coin generates no fees, its competition pays nothing.
      </p>
    </>
  ),
};

const security: DocPage = {
  slug: "security",
  title: "Wallets & security",
  description: "Authentication, data protection and operational safeguards.",
  body: () => (
    <>
      <h2 id="wallets">Wallets</h2>
      <p>
        VYRAL uses the Solana wallet adapter with Wallet Standard detection, so Phantom, Solflare, Backpack and other compatible wallets work without
        extra setup. A wallet is required to launch tokens, submit videos and claim rewards.
      </p>
      <p>
        <strong>VYRAL will never ask for your seed phrase or private key.</strong>
      </p>
      <h2 id="signin">Sign-in</h2>
      <p>
        You sign a human-readable message (Sign-In With Solana format) containing a single-use nonce. The server verifies the ed25519 signature against
        the exact message it issued, consumes the nonce atomically, and sets an HttpOnly, SameSite session cookie. Signing creates no transaction and costs
        nothing. Reward claims require a fresh signature.
      </p>
      <h2 id="platform">Platform safeguards</h2>
      <ul>
        <li>Server-side validation of every request; state-changing requests are protected against cross-site requests.</li>
        <li>Rate limits on sign-in, uploads, submissions, launches, disputes and administrative actions.</li>
        <li>Administrator roles (admin, reviewer); every sensitive action is written to an append-only audit log enforced by the database.</li>
        <li>Linked-account OAuth tokens are encrypted at rest (AES-256-GCM); IP addresses are stored only as keyed hashes.</li>
        <li>Uploaded images are decoded and re-encoded server-side before being stored or served.</li>
        <li>Payouts are signed by a remote signer (KMS or custody service), or by a hot-wallet keypair held in the hosting environment. On mainnet the keypair is refused unless the operator opts in explicitly, it must be the reward vault itself, and each automatic transfer is capped (larger ones need an administrator). No signing key is stored in the database.</li>
      </ul>
    </>
  ),
};

const architecture: DocPage = {
  slug: "architecture",
  title: "Architecture",
  description: "Components, providers and background jobs.",
  body: () => (
    <>
      <h2 id="components">Components</h2>
      <ul>
        <li>
          <strong>Web app</strong> — Next.js (App Router) with server-rendered pages and route handlers for the API.
        </li>
        <li>
          <strong>PostgreSQL</strong> — the system of record, with integrity rules enforced in the schema (unique checkpoints, single in-flight payout
          attempt, append-only audit log, non-negative amounts).
        </li>
        <li>
          <strong>Worker</strong> — background jobs for price sampling, fee observation, metric synchronisation, checkpoints and payout execution. Each job
          holds a PostgreSQL advisory lock, so any number of worker replicas can run safely.
        </li>
      </ul>
      <h2 id="providers">Providers</h2>
      <p>
        Every external dependency sits behind a provider interface with a clearly-labelled development implementation. Switching to live data is a
        configuration change.
      </p>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Development</th>
            <th>Live</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>SOCIAL_PROVIDER</code>
            </td>
            <td>Simulated metrics</td>
            <td>YouTube Data API v3, TikTok Display API, Instagram Graph API, X API v2 + OAuth linking</td>
          </tr>
          <tr>
            <td>
              <code>LAUNCH_PROVIDER</code>
            </td>
            <td>Signed launch intent</td>
            <td>Launch on pump.fun with the creator-fee split locked in the same transaction, verified via RPC</td>
          </tr>
          <tr>
            <td>
              <code>PRICE_PROVIDER</code>
            </td>
            <td>Simulated market</td>
            <td>Jupiter price + on-chain supply (RPC); DexScreener volume for display</td>
          </tr>
          <tr>
            <td>
              <code>FEE_PROVIDER</code>
            </td>
            <td>Simulated fees</td>
            <td>Fee keeper distributes each coin&apos;s pump.fun creator fees; the reward vault&apos;s share is recorded per coin, confirmed at finality</td>
          </tr>
          <tr>
            <td>
              <code>PAYOUT_EXECUTOR</code>
            </td>
            <td>Simulated signatures</td>
            <td>SOL transfers from the reward vault, signed by a remote signer</td>
          </tr>
          <tr>
            <td>
              <code>STORAGE_PROVIDER</code>
            </td>
            <td>Local files</td>
            <td>IPFS (Pinata)</td>
          </tr>
        </tbody>
      </table>
      <h2 id="jobs">Background jobs</h2>
      <table>
        <tbody>
          <tr>
            <td>Price sampling</td>
            <td>Every minute — TWAP inputs, candles, token market data</td>
          </tr>
          <tr>
            <td>Fee distribution</td>
            <td>Every minute — distributes due coins&apos; creator fees, records the vault&apos;s share (pending) and confirms it at finality</td>
          </tr>
          <tr>
            <td>Metric sync</td>
            <td>Every two minutes, tiered — leaders and recent videos refresh most often</td>
          </tr>
          <tr>
            <td>Checkpoints</td>
            <td>Every 30 seconds — processes due checkpoints idempotently</td>
          </tr>
          <tr>
            <td>Payouts</td>
            <td>Every 15 seconds — builds, broadcasts, confirms and retries transfers</td>
          </tr>
        </tbody>
      </table>
    </>
  ),
};

const apiDoc: DocPage = {
  slug: "api",
  title: "Public API",
  description: "Read-only endpoints for integrations.",
  body: () => (
    <>
      <p>All endpoints return JSON and are rate-limited per client.</p>
      <table>
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Returns</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>GET /api/stats</code>
            </td>
            <td>Platform totals</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/competitions?sort=&amp;q=&amp;page=</code>
            </td>
            <td>Competitions with market data, pools and leaders</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/competitions/:mint</code>
            </td>
            <td>Competition detail, leaderboard, payouts and checkpoint log</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/tokens/:mint/candles?range=1D|1W|1M|ALL</code>
            </td>
            <td>OHLCV candles</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/creators/:wallet</code>
            </td>
            <td>Creator profile, submissions, payouts and history</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/health</code>
            </td>
            <td>Database status and last worker run</td>
          </tr>
        </tbody>
      </table>
    </>
  ),
};

export const DOCS: DocPage[] = [overview, launching, competitions, viralScore, eligibility, antiFraud, payouts, fees, security, architecture, apiDoc];

export const DOC_SECTIONS = [
  { group: "Getting started", items: [overview, launching, competitions].map((d) => ({ slug: d.slug, title: d.title })) },
  { group: "Protocol", items: [viralScore, eligibility, antiFraud, payouts, fees].map((d) => ({ slug: d.slug, title: d.title })) },
  { group: "Platform", items: [security, architecture, apiDoc].map((d) => ({ slug: d.slug, title: d.title })) },
];

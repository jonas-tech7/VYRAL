import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { ScoreCalculator } from "@/components/home/score-calculator";
import { ScoreFormula } from "@/components/home/score-formula";
import { ButtonLink } from "@/components/ui/button";
import { Container, Skeleton } from "@/components/ui/misc";
import { isEstimate } from "@/lib/config/defaults";
import { getAllConfig } from "@/lib/config/store";
import { PLATFORM_LABEL, PLATFORMS } from "@/lib/domain/platforms";
import { bpsToPct, cn, fullNumber } from "@/lib/format";
import { CREATOR_FEE_SPLIT } from "@/lib/launch/fee-split";

export const metadata: Metadata = {
  title: "How it works",
  description: "How VYRAL turns a token's creator fees into rewards for the creators who make it go viral: rules, Viral Score, multipliers and payouts.",
};

const SECTIONS = [
  { id: "idea", title: "The idea" },
  { id: "launch", title: "Launching a coin" },
  { id: "creators", title: "Taking part as a creator" },
  { id: "score", title: "The Viral Score" },
  { id: "multipliers", title: "Platform multipliers" },
  { id: "payouts", title: "Getting paid" },
  { id: "fees", title: "Where the money comes from" },
  { id: "fair-play", title: "Fair play" },
  { id: "safety", title: "Safety and risks" },
] as const;

export default function HowItWorksPage() {
  return (
    <Container>
      <header className="max-w-[760px] pb-4 pt-10 sm:pt-14">
        <p className="eyebrow">How it works</p>
        <h1 className="mt-3 text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-[46px]">Memes are attention.</h1>
        <p className="mt-4 text-[16px] leading-relaxed text-ink-2 sm:text-[17px]">
          VYRAL turns a token&apos;s creator fees into rewards for the creators who make it go viral. This page explains every rule that decides who gets
          paid, how much, and when. All numbers below are read live from the platform&apos;s configuration.
        </p>
      </header>
      <div className="grid gap-10 pt-8 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-16">
        <nav aria-label="On this page" className="hidden lg:block">
          <ol className="sticky top-[84px] flex flex-col gap-2.5 border-l border-edge pl-4 text-[13px]">
            {SECTIONS.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-ink-3 transition-colors hover:text-ink">
                  <span className="mr-2 font-mono text-[11px] text-ink-4">{String(i + 1).padStart(2, "0")}</span>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <Suspense fallback={<Skeleton className="h-[1200px] w-full max-w-[820px]" />}>
          <Content />
        </Suspense>
      </div>
    </Container>
  );
}

function Section({ id, index, title, children }: { id: string; index: number; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-[88px] border-t border-edge pb-14 pt-8 first:border-t-0 first:pt-0">
      <p className="font-mono text-[12px] text-ink-4">{String(index).padStart(2, "0")}</p>
      <h2 id={`${id}-title`} className="mt-2 text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-[26px]">
        {title}
      </h2>
      <div className="mt-4 text-[15px] leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

function Steps({ items }: { items: Array<{ title: string; body: ReactNode }> }) {
  return (
    <ol className="mt-5 grid gap-px overflow-hidden rounded-lg border border-edge bg-edge sm:grid-cols-2">
      {items.map((s, i) => (
        <li key={s.title} className="bg-canvas p-5">
          <span className="font-mono text-[12px] text-ink-4">{String(i + 1).padStart(2, "0")}</span>
          <p className="mt-3 text-[14.5px] font-medium text-ink">{s.title}</p>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

function Rule({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-canvas px-5 py-4">
      <p className="num font-mono text-[22px] font-medium tracking-[-0.02em] text-ink">{value}</p>
      <p className="mt-1 text-[12.5px] leading-snug text-ink-3">{label}</p>
    </div>
  );
}

const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="text-ink underline decoration-edge-strong underline-offset-[3px] hover:decoration-accent">
    {children}
  </Link>
);

async function Content() {
  await connection();
  const { scoring, eligibility, payouts } = await getAllConfig();
  const sc = scoring.value;
  const minViews = fullNumber(eligibility.value.minVerifiedViews);
  const intervals = payouts.value.allowedIntervalsHours.map((h) => `${h}h`).join(" or ");
  const vaultPct = bpsToPct(CREATOR_FEE_SPLIT.vaultBps);
  const deployerPct = bpsToPct(CREATOR_FEE_SPLIT.deployerBps);

  return (
    <div className="min-w-0 max-w-[820px]">
      <Section id="idea" index={1} title="The idea">
        <p>
          A coin lives on the people who talk about it: the videos, the reposts, the conversation. VYRAL exists to make coins go viral, which is where the
          name comes from. Every coin launched here opens its own video competition, and {vaultPct} of the creator fees it earns from trading are paid
          to the creators whose videos about it perform best.
        </p>
        <p className="mt-3">
          The incentives point the same way. Creators are paid for the reach they actually generate, and the coin gains the attention it needs to be
          discovered. Attention can bring trading, and trading generates the fees that fund the next rewards.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-edge bg-edge sm:grid-cols-4">
          <Rule value={intervals} label="Payout rounds, chosen at launch" />
          <Rule value={minViews} label="Verified views needed to be paid" />
          <Rule value="CA" label="Contract address required in every post" />
          <Rule value="4" label="Platforms: TikTok, YouTube Shorts, Instagram Reels, X" />
        </div>
      </Section>

      <Section id="launch" index={2} title="Launching a coin">
        <p>
          Anyone with a Solana wallet can launch a coin on pump.fun: name, ticker, image, an optional description and social links. Before signing, the
          launch screen shows exactly how the creator fees are shared. The coin&apos;s competition opens in the same step.
        </p>
        <ul className="mt-4 flex list-disc flex-col gap-2 pl-5 marker:text-ink-4">
          <li>
            <span className="text-ink">Fee split:</span> {vaultPct} of the coin&apos;s creator fees fund its competition and {deployerPct} go to the
            deployer. The split is set in the launch transaction and locked on-chain, so it can&apos;t be changed later.
          </li>
          <li>
            <span className="text-ink">Payout interval:</span> the deployer chooses whether rewards are paid every {intervals}. Shorter rounds pay smaller
            amounts more often; longer rounds collect more fees per payout.
          </li>
          <li>
            <span className="text-ink">Continuous:</span> there are no fixed rounds that end. The competition runs for as long as the coin is active.
          </li>
          <li>
            <span className="text-ink">Linked from day one:</span> every coin&apos;s token data links to its page on VYRAL, so wherever the coin shows
            up, people find its competition.
          </li>
          <li>
            <span className="text-ink">No self-dealing:</span> the wallet that deployed a coin cannot win its own competition.
          </li>
        </ul>
      </Section>

      <Section id="creators" index={3} title="Taking part as a creator">
        <Steps
          items={[
            {
              title: "Link your account",
              body: "Connect your TikTok, YouTube, Instagram or X account to your wallet. Only videos from linked accounts count, so nobody can submit your video as theirs.",
            },
            {
              title: "Post with the contract address",
              body: "Publish a short video about the coin after it launched. Put the coin's contract address in the caption, title or description.",
            },
            {
              title: "Submit the link",
              body: "Paste the video link on the coin's page. VYRAL reads the post from the platform and checks every rule automatically.",
            },
            {
              title: "Climb the leaderboard",
              body: "Views, likes and comments refresh automatically. Your Viral Score updates with them, and the top eligible video wins each round.",
            },
          ]}
        />
        <p className="mt-6 text-ink">Checked automatically on every submission</p>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 marker:text-ink-4">
          <li>The post contains the coin&apos;s contract address (a link containing it counts too). This proves the video is about this coin.</li>
          <li>The video was published after the coin launched. Older videos never qualify, even if edited or re-uploaded.</li>
          <li>It was published by your linked account, it is a short-form video, and it has not been entered before.</li>
          <li>You are within the limit of {eligibility.value.maxSubmissionsPerCreatorPerCompetition} entries per coin.</li>
        </ul>
        <p className="mt-4">
          The post text is checked again at every metrics refresh. If the contract address disappears later, the entry goes back to human review and
          cannot win until it is restored.
        </p>
      </Section>

      <Section id="score" index={4} title="The Viral Score">
        <p className="mb-6">
          One transparent number ranks every video. Views count the most, likes and comments add signal, and engagement only counts up to a plausible
          share of the views, so bought likes cannot outrank real reach.
        </p>
        <ScoreFormula config={sc} version={scoring.version} />
        <div className="mt-6">
          <ScoreCalculator config={sc} version={scoring.version} />
        </div>
      </Section>

      <Section id="multipliers" index={5} title="Platform multipliers">
        <p>
          A like on TikTok is not worth the same as a like on YouTube Shorts: some platforms hand out views, likes and comments far more easily than
          others. Each platform therefore has three separate multipliers, applied before scoring.
        </p>
        <div className="mt-5 overflow-x-auto rounded-lg border border-edge">
          <table className="w-full min-w-[560px] text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-edge text-[12px] text-ink-3">
                <th className="px-4 py-2.5 font-medium">Platform</th>
                <th className="px-4 py-2.5 text-right font-medium">Views</th>
                <th className="px-4 py-2.5 text-right font-medium">Likes</th>
                <th className="px-4 py-2.5 text-right font-medium">Comments</th>
                <th className="px-4 py-2.5 font-medium">Basis</th>
              </tr>
            </thead>
            <tbody>
              {PLATFORMS.map((p) => {
                const m = sc.multipliers[p];
                const basis =
                  m.source.kind === "calibrated"
                    ? `VYRAL data (n=${fullNumber(m.source.sampleSize ?? 0)})`
                    : p === "tiktok"
                      ? "Baseline"
                      : isEstimate(m.source.note)
                        ? "Estimate until data exists"
                        : m.view === 1 && m.like === 1 && m.comment === 1
                          ? "No comparable data yet"
                          : "Published benchmarks";
                return (
                  <tr key={p} className="border-b border-edge last:border-b-0">
                    <td className="px-4 py-3 text-ink">{PLATFORM_LABEL[p]}</td>
                    {[m.view, m.like, m.comment].map((v, i) => (
                      <td key={i} className={cn("num px-4 py-3 text-right font-mono", v > 1 ? "text-accent" : "text-ink-2")}>
                        ×{v.toFixed(2)}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-[12.5px] text-ink-3">{basis}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul className="mt-5 flex list-disc flex-col gap-2 pl-5 marker:text-ink-4">
          <li>
            <span className="text-ink">Method:</span> TikTok is the baseline (×1.00). For each metric, multiplier = √(TikTok average per video ÷ platform
            average per video), from the largest published short-form studies (Metricool 2026, 6.18 million videos; Socialinsider 2026).
          </li>
          <li>
            <span className="text-ink">Dampened on purpose:</span> the square root keeps the direction but avoids over-correcting, because study averages
            mix very different account sizes.
          </li>
          <li>
            <span className="text-ink">Careful where data is thin:</span> where sources disagree (Instagram comments), the value stays ×1.00. X has no
            comparable published data, so it uses the Instagram values as an estimate until VYRAL&apos;s own data replaces them.
          </li>
          <li>
            <span className="text-ink">Getting better over time:</span> once enough verified videos exist, the multipliers are recalibrated from
            VYRAL&apos;s own data (medians, last 90 days). Every change is versioned and published.
          </li>
        </ul>
        <p className="mt-4 text-[13.5px] text-ink-3">
          Sources, numbers and the calibration method in detail: <A href="/docs/viral-score#multipliers">Viral Score documentation</A>.
        </p>
      </Section>

      <Section id="payouts" index={6} title="Getting paid">
        <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-ink-4">
          <li>
            <span className="text-ink">Checkpoints:</span> every {intervals} (as chosen at launch), the highest-ranked eligible video receives the reward
            for that round.
          </li>
          <li>
            <span className="text-ink">Minimum {minViews} verified views:</span> a video only qualifies with at least {minViews} verified views. If no video
            reaches it, nobody is paid that round and the fees roll over to the next one.
          </li>
          <li>
            <span className="text-ink">On-chain and verifiable:</span> each payout is a Solana transaction. It is only shown as paid once the transaction
            is confirmed, and anyone can check it on a Solana explorer.
          </li>
          <li>
            <span className="text-ink">Under review means paused:</span> a video with open review flags cannot win until a person has cleared it.
          </li>
        </ul>
      </Section>

      <Section id="fees" index={7} title="Where the money comes from">
        <p>
          Rewards come only from the creator fees a coin generates when it is traded on pump.fun. When the coin launches, those fees are split in two,
          in the launch transaction itself:
        </p>
        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-edge bg-edge">
          <Rule value={vaultPct} label="To the coin's competition, through VYRAL's reward vault" />
          <Rule value={deployerPct} label="To the deployer's wallet, paid directly by pump.fun" />
        </div>
        <p className="mt-5">
          The split is locked on-chain: once the coin is live, neither the deployer nor VYRAL can change it, and VYRAL never holds the deployer&apos;s
          half. Everything that reaches the vault for a coin funds that coin&apos;s competition: at each checkpoint, the top eligible video receives
          everything collected since the last payout. If no video is eligible, the fees roll over to the next checkpoint.
        </p>
        <p className="mt-3">
          Only fees that were actually collected and confirmed on-chain are used. Pending fees are never paid out, nothing is pre-funded, and nothing is
          promised in advance. <A href="/docs/fees">Fees &amp; payouts</A>
        </p>
      </Section>

      <Section id="fair-play" index={8} title="Fair play">
        <p>
          Automated checks look for patterns typical of bought engagement: bursts of views without matching likes, round-number jumps, machine-like
          growth, reused videos, accounts shared between wallets and removed contract addresses.
        </p>
        <p className="mt-3">
          Automated systems flag; people decide. A suspicious video goes to human review instead of being rejected automatically, and creators can
          dispute a decision. <A href="/docs/anti-fraud">Anti-fraud</A>
        </p>
      </Section>

      <Section id="safety" index={9} title="Safety and risks">
        <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-ink-4">
          <li>
            VYRAL never asks for your seed phrase or private key. Your wallet only signs a message to sign in and approves transactions you start
            yourself.
          </li>
          <li>Coins are highly volatile and can lose all of their value. Attention does not guarantee a price.</li>
          <li>VYRAL rewards creators for attention; it does not promise returns to anyone. Nothing on this site is financial advice.</li>
          <li>
            Trades happen on independent third-party services, not on VYRAL. The <A href="/legal/terms">Terms of Use</A> and the{" "}
            <A href="/legal/privacy">Privacy Policy</A> apply.
          </li>
        </ul>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/launch" variant="primary" size="lg">
            Launch a Coin
          </ButtonLink>
          <ButtonLink href="/competitions" variant="secondary" size="lg">
            Explore Competitions
          </ButtonLink>
        </div>
      </Section>
    </div>
  );
}

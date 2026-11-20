import Link from "next/link";
import type { ReactNode } from "react";
import { bpsToPct } from "@/lib/format";
import { CREATOR_FEE_SPLIT } from "@/lib/launch/fee-split";

export type FaqItem = { id: string; q: string; a: () => ReactNode };

const VAULT_PCT = bpsToPct(CREATOR_FEE_SPLIT.vaultBps);
const DEPLOYER_PCT = bpsToPct(CREATOR_FEE_SPLIT.deployerBps);

export const FAQ: FaqItem[] = [
  {
    id: "what-is-vyral",
    q: "What is VYRAL?",
    a: () => (
      <p>
        VYRAL is a token launchpad on Solana built to make coins go viral &mdash; that is where the name comes from. Every token launched here goes
        live on pump.fun with its own video competition, and {VAULT_PCT} of the token&apos;s creator fees are paid to the creators and influencers whose
        videos about it perform best.
      </p>
    ),
  },
  {
    id: "why-it-helps",
    q: "How does this help a coin?",
    a: () => (
      <p>
        Attention is what lets a meme spread. Paying creators for the reach they actually generate gives people a lasting reason to make videos about a
        coin, so it keeps being seen and discussed. Creators earn from the attention they bring; the coin gains the visibility it needs to be
        discovered. Attention is not a guarantee of value, though &mdash; see <a href="#risks">the risks</a>.
      </p>
    ),
  },
  {
    id: "where-rewards-come-from",
    q: "Where does the reward money come from?",
    a: () => (
      <p>
        From the creator fees a token generates when it is traded on pump.fun. {VAULT_PCT} of them go to VYRAL&apos;s reward vault, and everything
        that reaches the vault for a token funds that token&apos;s competition. Only fees that were actually collected and confirmed on-chain are paid
        out. Pending fees are never used, and nothing is pre-funded or promised in advance. <Link href="/docs/fees">Fees &amp; payouts</Link>
      </p>
    ),
  },
  {
    id: "reward-share",
    q: "How much of the fees goes to creators?",
    a: () => (
      <p>
        Every token&apos;s pump.fun creator fees are split in its launch transaction: {VAULT_PCT} go to VYRAL&apos;s reward vault and fund the
        token&apos;s competition, and {DEPLOYER_PCT} go to the deployer&apos;s wallet. The deployer&apos;s share is paid by pump.fun directly; VYRAL
        never holds it. The split is locked on-chain, so neither the deployer nor VYRAL can change it later. At every checkpoint, the top eligible video
        receives all of the token&apos;s confirmed fees in the vault that haven&apos;t been paid out yet. <Link href="/docs/fees">Fees &amp; payouts</Link>
      </p>
    ),
  },
  {
    id: "payout-schedule",
    q: "How often are creators paid, and who gets paid?",
    a: () => (
      <p>
        At every checkpoint &mdash; every 3 or 6 hours, chosen when the token launches &mdash; the highest-ranked eligible video receives the reward
        for that window. A payout is only shown as paid once its Solana transaction is confirmed. <Link href="/docs/payouts">Payouts</Link>
      </p>
    ),
  },
  {
    id: "ranking",
    q: "How are videos ranked?",
    a: () => (
      <p>
        By the Viral Score. Views count the most (50% by default), likes and comments 25% each, on a logarithmic scale. Each platform has its own
        multipliers for views, likes and comments, so the platforms are compared fairly. Likes and comments only count up to a plausible share of the
        views, so bought engagement can&apos;t outrank real reach. <Link href="/how-it-works#score">How the Viral Score works</Link>
      </p>
    ),
  },
  {
    id: "platform-multipliers",
    q: "Why does a like on YouTube count more than a like on TikTok?",
    a: () => (
      <p>
        Because it is harder to get. In the largest published short-form study (Metricool 2026, 6.18 million videos), a TikTok video averages 1,097
        likes, a YouTube Short 88. VYRAL turns such differences into separate multipliers for views, likes and comments per platform, dampened with a
        square root so no platform gets an outsized advantage. For X there is no comparable published data yet, so it uses the Instagram values as an
        estimate, and once VYRAL has enough
        verified videos of its own, the values are recalibrated from that data. <Link href="/how-it-works#multipliers">Platform multipliers</Link>
      </p>
    ),
  },
  {
    id: "platforms",
    q: "Which platforms count?",
    a: () => <p>TikTok, YouTube Shorts, Instagram Reels and X. Only videos published after the token launched are accepted.</p>,
  },
  {
    id: "eligibility",
    q: "What does a video need to be paid?",
    a: () => (
      <ul>
        <li>Published after the token launched, from a platform account you have linked to your wallet</li>
        <li>The coin&apos;s contract address in the caption, title or description</li>
        <li>Verified, with at least 500 verified views. If no video reaches 500, nobody is paid and the fees roll over to the next checkpoint</li>
        <li>Submitted before the checkpoint, with no open review flags</li>
        <li>
          Not submitted by the wallet that deployed the token &mdash; deployers can&apos;t win their own competition.{" "}
          <Link href="/docs/eligibility">Eligibility</Link>
        </li>
      </ul>
    ),
  },
  {
    id: "fake-engagement",
    q: "How do you deal with fake views or bought likes?",
    a: () => (
      <p>
        Automated checks look for patterns typical of bought engagement: sudden bursts of views without matching likes, round-number jumps,
        machine-like growth, reused content and accounts shared between wallets. Suspicious videos are placed under review and a person decides. No one
        is rejected automatically, and creators can dispute a decision. <Link href="/docs/anti-fraud">Anti-fraud</Link>
      </p>
    ),
  },
  {
    id: "seed-phrase",
    q: "Do I ever need to share my seed phrase or private key?",
    a: () => (
      <p>
        No, never. VYRAL only asks your wallet to sign a message to sign in, and to approve transactions you start yourself. Anyone asking for your seed
        phrase or private key is not VYRAL.
      </p>
    ),
  },
  {
    id: "wallets",
    q: "Which wallets work?",
    a: () => <p>Phantom, Solflare, Backpack and other Solana wallets that support the Wallet Standard.</p>,
  },
  {
    id: "verify-payouts",
    q: "Can I verify payouts myself?",
    a: () => (
      <p>
        Yes. Every payout lists its transaction signature, which opens on a Solana explorer, and the payout history of every competition is public.
      </p>
    ),
  },
  {
    id: "risks",
    q: "What are the risks?",
    a: () => (
      <p>
        Tokens are highly volatile and can lose all of their value. Attention does not guarantee a price, and VYRAL does not promise returns to anyone.
        Nothing on this site is financial advice.
      </p>
    ),
  },
  {
    id: "demo-notice",
    q: "Why do I see a demo notice?",
    a: () => (
      <p>
        While parts of the platform run on simulated data, a notice is shown at the top of every page and simulated records are marked. Those videos,
        prices and payouts are not real.
      </p>
    ),
  },
];

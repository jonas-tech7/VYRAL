import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { env } from "@/lib/env";
import { LEGAL_LINKS } from "@/lib/legal";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/launch", label: "Launch a coin" },
      { href: "/explore", label: "Coins" },
      { href: "/competitions", label: "Competitions" },
      { href: "/creators", label: "Creator leaderboard" },
    ],
  },
  {
    title: "Protocol",
    links: [
      { href: "/docs/viral-score", label: "Viral Score" },
      { href: "/docs/payouts", label: "Payouts" },
      { href: "/docs/fees", label: "Fees & payouts" },
      { href: "/docs/anti-fraud", label: "Anti-fraud" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "/faq", label: "FAQ" },
      { href: "/docs", label: "Documentation" },
      { href: "/docs/security", label: "Security" },
      { href: "/docs/architecture", label: "Architecture" },
      { href: "/api/health", label: "System status" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-edge">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-[280px] text-[13px] leading-relaxed text-ink-3">
            The viral launchpad on Solana. Every launch runs a creator competition funded by its own creator fees.
          </p>
        </div>
        {COLUMNS.map((c) => (
          <div key={c.title}>
            <h3 className="text-[12.5px] text-ink-3">{c.title}</h3>
            <ul className="mt-3 flex flex-col gap-2.5">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-[13px] text-ink-2 transition-colors hover:text-ink">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-edge">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-4 py-5 text-[12px] text-ink-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>VYRAL · Create. Compete. Get Paid.</span>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1">
            {LEGAL_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="transition-colors hover:text-ink-2">
                {l.label}
              </Link>
            ))}
            <span>Solana {env.SOLANA_CLUSTER === "mainnet-beta" ? "Mainnet" : "Devnet"}</span>
          </nav>
        </div>
      </div>
    </footer>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Field, LegalDoc, legalOperator } from "@/components/legal/legal";
import { TERMS_VERSION } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of Use", description: "Terms of Use for VYRAL." };

export default function TermsPage() {
  const op = legalOperator();
  return (
    <LegalDoc title="Terms of Use" version={TERMS_VERSION}>
      <h2 id="scope">1. Scope and operator</h2>
      <p>
        These Terms govern the use of VYRAL (the &ldquo;Platform&rdquo;), operated by <Field value={op.name} label="Operator name or company" /> (the
        &ldquo;Operator&rdquo;, contact details in the <Link href="/legal/imprint">Imprint</Link>). By connecting a wallet, signing in, launching a token or
        submitting a video, you accept these Terms in the version shown above.
      </p>

      <h2 id="service">2. What VYRAL does</h2>
      <p>
        VYRAL lets users launch tokens on the Solana blockchain. Every token opens a video competition in which creators submit short videos about it. A share
        of the creator fees the token generates is paid to the best-ranked eligible video at regular checkpoints, according to the rules published on the
        Platform (<Link href="/how-it-works">How it works</Link>).
      </p>
      <p>
        <strong>Demonstration mode.</strong> While the demonstration notice is shown at the top of the Platform, tokens, video metrics, fees and payouts are
        simulated. They have no value, and no real tokens or funds are created or moved.
      </p>

      <h2 id="no-advice">3. No financial advice, no promise of returns</h2>
      <p>
        Nothing on the Platform is financial, investment, legal or tax advice, and nothing is a recommendation to buy or sell any token. The Operator does not
        promise any value, price, liquidity, attention or reward for any token, video or user.
      </p>

      <h2 id="risks">4. Risks</h2>
      <p>Tokens launched or traded through the Platform are highly speculative. In particular:</p>
      <ul>
        <li>a token can lose all of its value, quickly and permanently;</li>
        <li>prices can be extremely volatile, and tokens can become impossible to sell;</li>
        <li>blockchain transactions are irreversible, and mistakes (for example a wrong address) cannot be undone;</li>
        <li>software, including the Platform, wallets, blockchains and third-party services, can contain errors or fail;</li>
        <li>laws and regulations concerning crypto assets can change and affect tokens or the Platform.</li>
      </ul>
      <p>Only use funds you can afford to lose completely.</p>

      <h2 id="third-parties">5. Trading and third-party services</h2>
      <p>
        VYRAL does not execute trades and never holds users&apos; funds. &ldquo;Buy&rdquo; and &ldquo;Sell&rdquo; links lead to independent third-party
        services (for example Jupiter). Their own terms apply, and the Operator is not responsible for their availability, prices or execution. The same
        applies to wallets, blockchain networks, social media platforms and launch infrastructure used by the Platform.
      </p>

      <h2 id="wallets">6. Wallets</h2>
      <p>
        You use your own self-custodial wallet. VYRAL never asks for your seed phrase or private key; anyone who does is not VYRAL. You are responsible for
        keeping your wallet secure. Transactions you sign in your wallet are final.
      </p>

      <h2 id="launching">7. Launching a token</h2>
      <ul>
        <li>
          You are responsible for the name, ticker, image, description and links of your token. They must not infringe the rights of others (for example
          trademarks or copyrights), must not be misleading and must not violate any law.
        </li>
        <li>The fee sharing shown before you sign applies to your token. Every token&apos;s metadata links to its page on VYRAL.</li>
        <li>
          The Operator may pause competitions, hide tokens or refuse service where these Terms or applicable law are violated, or where this is necessary to
          protect users.
        </li>
      </ul>

      <h2 id="creators">8. Taking part as a creator</h2>
      <ul>
        <li>
          You may only submit videos you published yourself, from an account you linked to your wallet, after the token launched and with the token&apos;s
          contract address in the post. The terms of the respective social media platform continue to apply.
        </li>
        <li>
          Purchased or automated engagement (bots, view or like services) and any other manipulation are prohibited. The Operator may review, pause or reject
          entries; you can dispute a decision on the Platform.
        </li>
        <li>
          Rewards are paid only from fees that were actually collected and confirmed, according to the published rules (including the minimum number of
          verified views). Rules and parameters can change for the future; every change is versioned and published.
        </li>
        <li>You are responsible for any taxes on rewards you receive.</li>
      </ul>

      <h2 id="prohibited">9. Prohibited use</h2>
      <p>
        You must not use the Platform for fraud, market manipulation (for example pump-and-dump schemes or wash trading), impersonation, illegal content, to
        violate sanctions or other laws, or to attack, overload or circumvent the Platform&apos;s security.
      </p>

      <h2 id="availability">10. Availability and changes</h2>
      <p>
        The Operator aims to keep the Platform available but does not guarantee uninterrupted or error-free operation. Features can change or be discontinued.
      </p>

      <h2 id="liability">11. Liability</h2>
      <p>
        The Operator is liable without limitation for intent and gross negligence, for injury to life, body or health, and wherever liability is mandatory by
        law. For slight negligence, the Operator is liable only for the breach of essential obligations whose fulfilment makes the proper use of the Platform
        possible in the first place and on whose fulfilment users may regularly rely; this liability is limited to the damage that is foreseeable and typical
        for this kind of service. Otherwise, the Operator&apos;s liability is excluded, in particular for losses from price movements of tokens, for
        third-party services and for transactions users sign themselves.
      </p>

      <h2 id="eligibility">12. Who may use VYRAL</h2>
      <p>
        You must be at least 18 years old and legally able to enter into these Terms. You may not use the Platform where this is prohibited by the law that
        applies to you, or if you are subject to sanctions. You are responsible for complying with the laws of your country.
      </p>

      <h2 id="changes">13. Changes to these Terms</h2>
      <p>
        The Operator may change these Terms for the future. The current version and its date are shown on this page; launches record the version that was
        accepted.
      </p>

      <h2 id="law">14. Governing law</h2>
      <p>
        These Terms are governed by <Field value={op.governingLaw} label="governing law, e.g. the laws of the Federal Republic of Germany" />. If you are a
        consumer, mandatory consumer protection provisions of the country where you live remain unaffected.
      </p>

      <h2 id="contact">15. Contact</h2>
      <p>
        Questions about these Terms: <Field value={op.email} label="contact email" />.
      </p>
    </LegalDoc>
  );
}

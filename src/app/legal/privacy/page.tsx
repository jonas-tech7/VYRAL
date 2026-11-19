import type { Metadata } from "next";
import Link from "next/link";
import { Field, LegalDoc, legalOperator } from "@/components/legal/legal";

export const metadata: Metadata = { title: "Privacy Policy", description: "How VYRAL processes personal data." };

export default function PrivacyPage() {
  const op = legalOperator();
  return (
    <LegalDoc title="Privacy Policy" version="2026-11-19">
      <h2 id="controller">1. Controller</h2>
      <p>
        <Field value={op.name} label="Operator name or company" />
        <br />
        {op.addressLines.length ? (
          op.addressLines.map((l) => (
            <span key={l}>
              {l}
              <br />
            </span>
          ))
        ) : (
          <>
            <Field value={null} label="Street and number | Postcode and city | Country" />
            <br />
          </>
        )}
        Email: <Field value={op.email} label="contact email" />
      </p>

      <h2 id="summary">2. In short</h2>
      <ul>
        <li>No advertising, no tracking and no analytics cookies.</li>
        <li>One strictly necessary cookie keeps you signed in.</li>
        <li>IP addresses are only stored as keyed hashes, for rate limiting and fraud prevention.</li>
        <li>Blockchain data (wallet addresses, transactions) is public by design and cannot be deleted by anyone.</li>
      </ul>

      <h2 id="data">3. What data is processed, why, and on what legal basis</h2>
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Purpose</th>
            <th>Legal basis (GDPR)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Wallet address, signed sign-in message</td>
            <td>Signing in, launches, entries, payouts</td>
            <td>Art. 6(1)(b)</td>
          </tr>
          <tr>
            <td>
              Session cookie <code>vyral_session</code>
            </td>
            <td>Keeping you signed in (strictly necessary)</td>
            <td>Art. 6(1)(b); § 25(2) TDDDG</td>
          </tr>
          <tr>
            <td>Browser storage: selected wallet, risk acknowledgement</td>
            <td>Remembering your choices on your device only</td>
            <td>§ 25(2) TDDDG</td>
          </tr>
          <tr>
            <td>IP address (as a keyed hash)</td>
            <td>Rate limiting, abuse and fraud prevention</td>
            <td>Art. 6(1)(f): security of the Platform</td>
          </tr>
          <tr>
            <td>Linked social accounts: account ID, handle, access token (stored encrypted, read-only)</td>
            <td>Proving you own submitted videos, reading their metrics</td>
            <td>Art. 6(1)(b)</td>
          </tr>
          <tr>
            <td>Submitted videos: link, publication time, post text, views, likes, comments, image fingerprint</td>
            <td>Checking the rules, ranking, fraud prevention; shown publicly on leaderboards</td>
            <td>Art. 6(1)(b) and (f)</td>
          </tr>
          <tr>
            <td>Launched tokens: name, ticker, image, description, links, deployer wallet</td>
            <td>Operating the token and its competition; public</td>
            <td>Art. 6(1)(b)</td>
          </tr>
          <tr>
            <td>Payouts and audit logs</td>
            <td>Paying rewards, accountability for administrative decisions</td>
            <td>Art. 6(1)(b), (c) and (f)</td>
          </tr>
        </tbody>
      </table>

      <h2 id="recipients">4. Service providers and recipients</h2>
      <ul>
        <li>
          Hosting and database: <Field value={null} label="hosting provider, e.g. Vercel Inc." /> and{" "}
          <Field value={null} label="database provider, e.g. Neon" />, as processors under data processing agreements.
        </li>
        <li>Solana RPC providers, to read and send blockchain transactions.</li>
        <li>Google (YouTube), TikTok, Meta (Instagram) and X, only when you link an account or submit a video from that platform.</li>
        <li>Jupiter, only when you follow a Buy or Sell link (you then leave VYRAL).</li>
      </ul>
      <p>
        Some providers are located outside the EU. Transfers rely on <Field value={null} label="adequacy decision / EU standard contractual clauses" />.
      </p>

      <h2 id="blockchain">5. Blockchain data</h2>
      <p>
        Transactions on Solana, including wallet addresses and amounts, are public and permanent. VYRAL cannot change or delete them; this is a property of the
        blockchain, not a choice of VYRAL.
      </p>

      <h2 id="retention">6. Storage periods</h2>
      <ul>
        <li>Sessions and sign-in nonces: until they expire, then deleted automatically.</li>
        <li>Rate-limit records: about two days.</li>
        <li>Metric snapshots of videos: 90 days; price samples: 14 days.</li>
        <li>Accounts, entries, payouts and audit logs: as long as needed for the competition and legal obligations.</li>
        <li>Linked social accounts: until you unlink them on your account page.</li>
      </ul>

      <h2 id="rights">7. Your rights</h2>
      <p>
        You have the right to access (Art. 15), rectification (Art. 16), erasure (Art. 17), restriction (Art. 18), data portability (Art. 20) and to object to
        processing based on legitimate interests (Art. 21). You can also lodge a complaint with a data protection supervisory authority (Art. 77). Contact:{" "}
        <Field value={op.email} label="contact email" />.
      </p>

      <h2 id="security">8. Security</h2>
      <p>
        Connections are encrypted (TLS). Social media access tokens are encrypted at rest, IP addresses are hashed, and VYRAL never stores private keys or seed
        phrases. See <Link href="/docs/security">Wallets &amp; security</Link>.
      </p>
    </LegalDoc>
  );
}

import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Container, Notice, PageHeader, Skeleton } from "@/components/ui/misc";
import { Stat, StatGrid } from "@/components/ui/stat";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { getConfig } from "@/lib/config/store";
import { env } from "@/lib/env";
import { bpsToPct, compactNumber, dateTimeUtc, shortAddress, sol } from "@/lib/format";
import { CREATOR_FEE_SPLIT } from "@/lib/launch/fee-split";
import { buybackStats } from "@/lib/services/buyback";
import { explorerAccountUrl, explorerTxUrl } from "@/lib/solana/cluster";

export const metadata: Metadata = {
  title: "Buyback & burn",
  description: "Every coin launched on VYRAL buys back and burns $VYRAL with part of its creator fees. Every buy and burn, on-chain.",
};

export default function BurnsPage() {
  return (
    <Container>
      <PageHeader
        title="Buyback & burn"
        description={`${bpsToPct(CREATOR_FEE_SPLIT.buybackBps)} of every coin's creator fees buys $VYRAL on the open market, and every token bought is burned. Locked at launch, executed automatically, every transaction public.`}
      />
      <Suspense fallback={<Skeleton className="h-[520px] w-full" />}>
        <Burns />
      </Suspense>
    </Container>
  );
}

/** Base units → whole tokens (rounded down), for display. */
function tokens(raw: string, decimals: number | null): number {
  if (!raw || raw === "0") return 0;
  const d = decimals ?? 6;
  const big = BigInt(raw);
  return Number(big / 10n ** BigInt(d));
}

function Tx({ sig, label }: { sig: string | null; label: string }) {
  if (!sig) return null;
  return (
    <a href={explorerTxUrl(sig)} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-ink-2 underline decoration-edge-strong underline-offset-2 hover:text-ink">
      {label}
    </a>
  );
}

async function Burns() {
  await connection();
  const [s, { value: token }] = await Promise.all([buybackStats(), getConfig("platform_token")]);
  const burned = tokens(s.burnedRaw, s.decimals);
  return (
    <div className="flex animate-fade-in flex-col gap-10">
      {!token.mint ? <Notice>Buybacks start as soon as ${token.symbol} is live. Until then the buyback share collects in the platform wallet.</Notice> : null}
      <StatGrid>
        <Stat label={`$${token.symbol} burned`} value={compactNumber(burned)} sub={`${s.burns} burns`} size="lg" />
        <Stat label="SOL spent on buybacks" value={sol(s.spentLamports)} sub="Bought on the open market" size="lg" />
        <Stat label="Waiting for the next buy" value={sol(s.budgetLamports)} sub="Bought in small steps to limit price impact" size="lg" />
        <Stat label="Forwarded to the treasury" value={sol(s.forwardedLamports)} sub={`${bpsToPct(CREATOR_FEE_SPLIT.treasuryBps)} of creator fees`} size="lg" />
      </StatGrid>

      <div className="grid gap-3 text-[13px] text-ink-2 sm:grid-cols-2">
        {env.PLATFORM_FEE_ADDRESS ? (
          <p>
            Platform wallet:{" "}
            <a href={explorerAccountUrl(env.PLATFORM_FEE_ADDRESS)} target="_blank" rel="noreferrer" className="font-mono text-ink underline decoration-edge-strong underline-offset-2">
              {shortAddress(env.PLATFORM_FEE_ADDRESS, 6)}
            </a>
          </p>
        ) : null}
        {env.FEE_TREASURY_ADDRESS ? (
          <p>
            Treasury:{" "}
            <a href={explorerAccountUrl(env.FEE_TREASURY_ADDRESS)} target="_blank" rel="noreferrer" className="font-mono text-ink underline decoration-edge-strong underline-offset-2">
              {shortAddress(env.FEE_TREASURY_ADDRESS, 6)}
            </a>
          </p>
        ) : null}
      </div>

      <Table minWidth={760}>
        <THead>
          <TH>Time (UTC)</TH>
          <TH>Type</TH>
          <TH align="right">SOL</TH>
          <TH align="right">${token.symbol} burned</TH>
          <TH align="right">Transactions</TH>
        </THead>
        <tbody>
          {s.recent.length === 0 ? <EmptyRow colSpan={5}>No buybacks yet.</EmptyRow> : null}
          {s.recent.map((e) => (
            <TR key={e.id}>
              <TD className="text-ink-2">{dateTimeUtc(e.createdAt)}</TD>
              <TD>{e.kind === "buyback" ? "Buyback & burn" : "Treasury"}</TD>
              <TD align="right" numeric>
                {e.lamports ? sol(e.lamports) : "—"}
              </TD>
              <TD align="right" numeric>
                {e.tokensBurned ? compactNumber(tokens(e.tokensBurned, e.decimals)) : e.kind === "buyback" ? "pending" : "—"}
              </TD>
              <TD align="right">
                <span className="inline-flex gap-3">
                  <Tx sig={e.swapSignature} label="buy" />
                  <Tx sig={e.burnSignature} label="burn" />
                  <Tx sig={e.transferSignature} label="transfer" />
                </span>
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>

      <p className="max-w-[760px] text-[12.5px] leading-relaxed text-ink-3">
        The buyback is a mechanism, not a promise: it spends fees that have already been collected, at whatever the market price is, and burned
        tokens are gone for good. ${token.symbol} is not an investment and gives no claim on VYRAL&apos;s revenue, no ownership and no voting
        rights. Nothing here is financial advice.
      </p>
    </div>
  );
}

import { ArrowUpRight } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { explorerTxUrl } from "@/lib/solana/cluster";
import { shortAddress } from "@/lib/format";

/** Transaction signature with an explorer link; simulated signatures are labelled and never linked. */
export function TxSignature({ signature, simulated }: { signature: string | null; simulated: boolean }) {
  if (!signature) return <span className="text-ink-4">—</span>;
  if (simulated) {
    return (
      <span className="inline-flex items-center gap-2" title="Simulated transaction — not on-chain">
        <span className="font-mono text-[12px] text-ink-3">{shortAddress(signature, 5)}</span>
        <span className="rounded-sm bg-overlay-2 px-1 py-px text-[10px] uppercase tracking-wider text-ink-3">Sim</span>
      </span>
    );
  }
  return (
    <a
      href={explorerTxUrl(signature)}
      target="_blank"
      rel="noopener noreferrer"
      className="relative z-10 inline-flex items-center gap-1 font-mono text-[12px] text-ink-2 transition-colors hover:text-ink"
      title="Verify on Solscan"
    >
      {shortAddress(signature, 5)}
      <ArrowUpRight className="size-3" />
    </a>
  );
}

export function PayoutStatus({ status }: { status: string }) {
  switch (status) {
    case "confirmed":
      return <StatusBadge tone="positive">Confirmed</StatusBadge>;
    case "submitted":
      return <StatusBadge tone="neutral">Confirming</StatusBadge>;
    case "pending":
      return <StatusBadge tone="neutral">Queued</StatusBadge>;
    case "requires_attention":
      return <StatusBadge tone="warning">Needs attention</StatusBadge>;
    case "voided":
      return <StatusBadge tone="negative">Voided</StatusBadge>;
    default:
      return <StatusBadge>{status}</StatusBadge>;
  }
}

export const CHECKPOINT_OUTCOME: Record<string, string> = {
  awarded: "Awarded",
  no_eligible_winner: "No eligible video · fees rolled over",
  no_fees: "No new confirmed fees",
  below_minimum: "Below minimum · fees rolled over",
  skipped_paused: "Skipped · competition paused",
  skipped_price_data: "Skipped · no reliable price · fees rolled over",
  voided: "Voided · fees returned to pool",
  processing: "Processing",
};

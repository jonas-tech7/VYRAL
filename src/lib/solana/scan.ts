/**
 * Reading an address's transaction history without ever skipping a transaction.
 *
 * `getSignaturesForAddress` pages from the newest transaction backwards. A
 * plain "everything since the last signature" read silently drops the oldest
 * part whenever more transactions arrived than one run reads (busy periods,
 * spam). Here every stretch that was not read yet is remembered as a gap and
 * read on later runs, so each transaction is handed out exactly once, in any
 * order (newest first). Callers must save the returned state together with
 * the effects of the transactions they handled.
 */
import type { ConfirmedSignatureInfo, Connection, PublicKey } from "@solana/web3.js";

export type ScanState = {
  /** The newest signature taken into the walk; anything newer is new. */
  head?: string;
  /**
   * Stretches not read yet, newest first: the signatures older than `before`
   * and newer than `until` (no `until`: back to the address's first transaction).
   */
  gaps?: Array<{ before: string; until?: string }>;
};

/** "retry": not available yet, stop here and hand it out again next time. */
export type ScanOutcome = "done" | "retry";

type SignatureSource = Pick<Connection, "getSignaturesForAddress">;

export async function scanSignatures(
  connection: SignatureSource,
  address: PublicKey,
  state: ScanState,
  handle: (s: ConfirmedSignatureInfo) => Promise<ScanOutcome>,
  opts: { maxReads: number; maxPages?: number; pageSize?: number },
): Promise<{ state: ScanState; reads: number; stopped: boolean }> {
  const pageSize = opts.pageSize ?? 1000;
  let pagesLeft = opts.maxPages ?? 5;
  const gaps = (state.gaps ?? []).map((g) => ({ ...g }));
  let head = state.head;
  let reads = 0;
  let stopped = false;

  /** Hands out `list` (newest first) until the read budget runs out or a transaction is not available yet. */
  async function take(list: ConfirmedSignatureInfo[]): Promise<number> {
    let n = 0;
    for (const s of list) {
      if (s.err) {
        n++; // failed transactions move nothing: passed over without reading them
        continue;
      }
      if (reads >= opts.maxReads) break;
      reads++;
      if ((await handle(s)) === "retry") {
        stopped = true;
        break;
      }
      n++;
    }
    return n;
  }

  // 1. New transactions since the head.
  pagesLeft--;
  const fresh = await connection.getSignaturesForAddress(address, { until: head, limit: pageSize }, "confirmed");
  if (fresh.length) {
    const n = await take(fresh);
    if (n > 0) {
      // Whatever of this page was not handed out, plus anything older that did not fit in it, is a gap.
      if (n < fresh.length || fresh.length === pageSize) gaps.unshift({ before: fresh[n - 1].signature, until: head });
      head = fresh[0].signature;
    }
    // n === 0: nothing taken, the head stays and the same transactions come first next time.
  }

  // 2. Older gaps, newest first.
  while (!stopped && reads < opts.maxReads && pagesLeft > 0 && gaps.length) {
    const g = gaps[0];
    pagesLeft--;
    const batch = await connection.getSignaturesForAddress(address, { before: g.before, until: g.until, limit: pageSize }, "confirmed");
    const n = await take(batch);
    if (n === batch.length && batch.length < pageSize) {
      gaps.shift(); // reached the gap's lower end
    } else if (n > 0) {
      g.before = batch[n - 1].signature;
    } else {
      break;
    }
  }

  return { state: { head, gaps }, reads, stopped };
}

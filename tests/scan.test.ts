import { describe, expect, it } from "vitest";
import { PublicKey, type ConfirmedSignatureInfo } from "@solana/web3.js";
import { scanSignatures, type ScanState } from "@/lib/solana/scan";

/** An address history: index 0 is the oldest transaction. Mimics getSignaturesForAddress (newest first). */
function chain() {
  const history: ConfirmedSignatureInfo[] = [];
  let calls = 0;
  return {
    history,
    get calls() {
      return calls;
    },
    add(n: number, failedEvery = 0) {
      for (let i = 0; i < n; i++) {
        const k = history.length;
        history.push({ signature: `S${k}`, slot: k, err: failedEvery && k % failedEvery === 0 ? { InstructionError: [0, "x"] } : null, memo: null, blockTime: 1 });
      }
    },
    source: {
      async getSignaturesForAddress(_a: PublicKey, o?: { before?: string; until?: string; limit?: number }) {
        calls++;
        const idx = (s?: string) => (s ? history.findIndex((h) => h.signature === s) : -1);
        const top = o?.before ? idx(o.before) : history.length; // exclusive
        const bottom = o?.until ? idx(o.until) : -1; // exclusive
        const out: ConfirmedSignatureInfo[] = [];
        for (let i = top - 1; i > bottom && out.length < (o?.limit ?? 1000); i--) out.push(history[i]);
        return out;
      },
    },
  };
}

const ADDRESS = new PublicKey("11111111111111111111111111111111");

describe("gap-free signature scan", () => {
  it("hands out every successful transaction exactly once across runs, however many arrive", async () => {
    const c = chain();
    const seen = new Map<string, number>();
    const handle = async (s: ConfirmedSignatureInfo) => {
      seen.set(s.signature, (seen.get(s.signature) ?? 0) + 1);
      return "done" as const;
    };
    let state: ScanState = {};
    c.add(2_345, 7);
    for (let run = 0; run < 400; run++) {
      if (run % 3 === 0) c.add(37, 7); // new transactions between runs
      state = (await scanSignatures(c.source as never, ADDRESS, state, handle, { maxReads: 50, pageSize: 100, maxPages: 3 })).state;
    }
    const expected = c.history.filter((h) => !h.err).map((h) => h.signature);
    expect(seen.size).toBe(expected.length);
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
    expect(state.gaps).toEqual([]);
  });

  it("stays exactly-once when transactions are randomly unavailable for a while", async () => {
    const c = chain();
    let seed = 42;
    const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
    const delays = new Map<string, number>();
    const seen = new Map<string, number>();
    const handle = async (s: ConfirmedSignatureInfo) => {
      if (!delays.has(s.signature)) delays.set(s.signature, rand() < 0.05 ? 1 + Math.floor(rand() * 3) : 0);
      const left = delays.get(s.signature)!;
      if (left > 0) {
        delays.set(s.signature, left - 1);
        return "retry" as const;
      }
      seen.set(s.signature, (seen.get(s.signature) ?? 0) + 1);
      return "done" as const;
    };
    let state: ScanState = {};
    c.add(800, 5);
    // Bursty arrivals for a while (often more than one run reads), then runs until the backlog is gone.
    for (let run = 0; run < 600; run++) {
      if (rand() < 0.3) c.add(Math.floor(rand() * 120), 5);
      state = (await scanSignatures(c.source as never, ADDRESS, state, handle, { maxReads: 25, pageSize: 50, maxPages: 2 })).state;
    }
    for (let run = 0; run < 5_000 && (state.gaps?.length || state.head !== c.history.at(-1)?.signature); run++) {
      state = (await scanSignatures(c.source as never, ADDRESS, state, handle, { maxReads: 25, pageSize: 50, maxPages: 2 })).state;
    }
    const expected = c.history.filter((h) => !h.err).map((h) => h.signature);
    expect(seen.size).toBe(expected.length);
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
  });

  it("hands out a transaction again when it was not available yet", async () => {
    const c = chain();
    c.add(10);
    const done: string[] = [];
    let missing = new Set(["S5"]);
    const handle = async (s: ConfirmedSignatureInfo) => {
      if (missing.has(s.signature)) return "retry" as const;
      done.push(s.signature);
      return "done" as const;
    };
    let r = await scanSignatures(c.source as never, ADDRESS, {}, handle, { maxReads: 100, pageSize: 100 });
    expect(r.stopped).toBe(true);
    expect(done).toEqual(["S9", "S8", "S7", "S6"]);
    missing = new Set();
    r = await scanSignatures(c.source as never, ADDRESS, r.state, handle, { maxReads: 100, pageSize: 100 });
    expect(done).toEqual(["S9", "S8", "S7", "S6", "S5", "S4", "S3", "S2", "S1", "S0"]);
    expect(r.state).toEqual({ head: "S9", gaps: [] });
  });

  it("keeps the head when the newest transaction is not available, and passes failed ones over unread", async () => {
    const c = chain();
    c.add(6, 2); // S0, S2, S4 failed
    let reads = 0;
    const r = await scanSignatures(
      c.source as never,
      ADDRESS,
      {},
      async (s) => {
        reads++;
        return s.signature === "S5" ? "retry" : "done";
      },
      { maxReads: 100, pageSize: 100 },
    );
    expect(r.state.head).toBeUndefined();
    expect(reads).toBe(1);
    const all: string[] = [];
    await scanSignatures(c.source as never, ADDRESS, r.state, async (s) => (all.push(s.signature), "done"), { maxReads: 100, pageSize: 100 });
    expect(all).toEqual(["S5", "S3", "S1"]);
  });

  it("continues an old single cursor as the head", async () => {
    const c = chain();
    c.add(20);
    const got: string[] = [];
    const r = await scanSignatures(c.source as never, ADDRESS, { head: "S14" }, async (s) => (got.push(s.signature), "done"), { maxReads: 100, pageSize: 100 });
    expect(got).toEqual(["S19", "S18", "S17", "S16", "S15"]);
    expect(r.state).toEqual({ head: "S19", gaps: [] });
  });
});

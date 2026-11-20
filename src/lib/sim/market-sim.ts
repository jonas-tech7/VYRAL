/**
 * DEVELOPMENT SIMULATION — synthetic market data for mock providers and the
 * demo seed. Deterministic in (token key, launch time, t), so seeded history
 * and live mock updates form one continuous series.
 *
 * Nothing here is a market model or a protocol parameter.
 */
import { CREATOR_FEE_SPLIT } from "@/lib/launch/fee-split";
import { fractalNoise, logUniform, unit } from "./random";

export const SIM_TOTAL_SUPPLY = 1_000_000_000;
/** Simulated creator-fee rate applied to simulated volume (mock fee provider only). */
export const SIM_CREATOR_FEE_RATE = 0.003;
/** The part of it that reaches the reward vault under the locked fee split (what a competition is funded with). */
export const SIM_VAULT_FEE_RATE = SIM_CREATOR_FEE_RATE * (CREATOR_FEE_SPLIT.vaultBps / 10_000);

const HOUR = 3_600_000;

type Params = {
  startMcap: number;
  targetMcap: number;
  tauH: number;
  fade: boolean;
  fadeAtH: number;
  fadeDepth: number;
  vol: number;
  turnover: number;
};

const cache = new Map<string, Params>();

function params(key: string): Params {
  const hit = cache.get(key);
  if (hit) return hit;
  const u = (s: string) => unit(`${key}:${s}`);
  const p: Params = {
    startMcap: 4_200 + u("start") * 2_400,
    targetMcap: logUniform(Math.pow(u("target"), 1.35), 18_000, 6_500_000),
    tauH: 5 + u("tau") * 70,
    fade: u("fade") < 0.35,
    fadeAtH: 30 + u("fadeAt") * 150,
    fadeDepth: 0.25 + u("fadeDepth") * 0.45,
    vol: 0.1 + u("vol") * 0.16,
    turnover: 0.35 + u("turnover") * 2.2,
  };
  cache.set(key, p);
  return p;
}

const smoothstep = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Simulated market cap (USD) at time t. */
export function simMarketCap(key: string, launchedAt: Date, t: Date): number {
  const p = params(key);
  const ageH = Math.max((t.getTime() - launchedAt.getTime()) / HOUR, 0);
  const s = 1 - Math.exp(-ageH / p.tauH);
  let mc = p.startMcap * Math.pow(p.targetMcap / p.startMcap, s);
  if (p.fade) mc *= 1 - p.fadeDepth * smoothstep((ageH - p.fadeAtH) / 72);
  const swing = p.vol * fractalNoise(`${key}:swing`, ageH / 5, 4);
  const fine = 0.018 * fractalNoise(`${key}:fine`, ageH * 14, 2);
  // Early life is noisier on a bonding curve.
  const early = 1 + 1.5 * Math.exp(-ageH / 8);
  return mc * Math.exp(swing * early + fine);
}

export function simPrice(key: string, launchedAt: Date, t: Date): number {
  return simMarketCap(key, launchedAt, t) / SIM_TOTAL_SUPPLY;
}

/** Simulated trading volume rate in USD per hour at time t. */
export function simVolumeRate(key: string, launchedAt: Date, t: Date): number {
  const p = params(key);
  const ageH = Math.max((t.getTime() - launchedAt.getTime()) / HOUR, 0);
  const mc = simMarketCap(key, launchedAt, t);
  const activity = 1 + 3.5 * Math.exp(-ageH / 20);
  const n = 1 + 0.55 * fractalNoise(`${key}:vol`, ageH / 2, 3);
  return Math.max((mc * p.turnover * activity * n) / 24, 0);
}

/** Simulated 24h volume ending at t (numeric integration at 30-min steps). */
export function simVolume24h(key: string, launchedAt: Date, t: Date): number {
  let total = 0;
  const end = t.getTime();
  const start = Math.max(end - 24 * HOUR, launchedAt.getTime());
  const step = HOUR / 2;
  for (let x = start; x < end; x += step) {
    const dt = Math.min(step, end - x);
    total += (simVolumeRate(key, launchedAt, new Date(x + dt / 2)) * dt) / HOUR;
  }
  return total;
}

/** Simulated SOL/USD reference price (used only to convert simulated fees). */
export function simSolUsd(t: Date): number {
  return 162 + 14 * fractalNoise("sol-usd", t.getTime() / (36 * HOUR), 3);
}

export type SimCandle = { bucketStart: Date; open: number; high: number; low: number; close: number; volumeUsd: number };

export function simCandle(key: string, launchedAt: Date, bucketStart: Date, bucketMinutes = 5): SimCandle {
  const start = bucketStart.getTime();
  const span = bucketMinutes * 60_000;
  const pts: number[] = [];
  for (let i = 0; i <= 5; i++) {
    const at = Math.max(start + (span * i) / 5, launchedAt.getTime());
    pts.push(simPrice(key, launchedAt, new Date(at)));
  }
  const open = pts[0];
  const close = pts[pts.length - 1];
  const wick = 1 + 0.004 * (1 + unit(`${key}:w:${start}`));
  const high = Math.max(...pts) * wick;
  const low = Math.min(...pts) / wick;
  const volumeUsd = (simVolumeRate(key, launchedAt, new Date(start + span / 2)) * span) / HOUR;
  return { bucketStart, open, high, low, close, volumeUsd };
}

/**
 * Deterministic pseudo-randomness for the DEVELOPMENT SIMULATION only.
 * Never used for security-sensitive values (nonces, tokens, keys use
 * node:crypto).
 */

/** cyrb53 string hash → 53-bit integer. */
export function hash53(input: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Uniform [0, 1) derived from a string key. */
export function unit(key: string): number {
  return hash53(key) / 9007199254740992;
}

/** mulberry32 PRNG. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1D value noise in [-1, 1]; `x` in arbitrary units. */
export function valueNoise(seedKey: string, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = unit(`${seedKey}:${i}`) * 2 - 1;
  const b = unit(`${seedKey}:${i + 1}`) * 2 - 1;
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

/** Multi-octave noise in roughly [-1, 1]. */
export function fractalNoise(seedKey: string, x: number, octaves = 4): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(`${seedKey}:o${o}`, x * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}

/** Log-uniform sample between lo and hi. */
export function logUniform(u: number, lo: number, hi: number): number {
  return Math.exp(Math.log(lo) + u * (Math.log(hi) - Math.log(lo)));
}

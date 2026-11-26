// The simulation's only source of randomness: sfc32, seeded through splitmix32.
// State is four 32-bit integers in a plain object, so it hashes and snapshots
// like the rest of the world. Every operation stays in 32-bit integer maths.

export interface Rng {
  a: number;
  b: number;
  c: number;
  d: number;
}

const SEED_WARMUP = 12;

export function createRng(seed: number): Rng {
  let s = seed | 0;
  const mix = (): number => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) | 0;
  };
  const rng: Rng = { a: mix(), b: mix(), c: mix(), d: 1 };
  for (let i = 0; i < SEED_WARMUP; i++) nextU32(rng);
  return rng;
}

/** Advances the generator and returns an integer in [0, 2^32). */
export function nextU32(rng: Rng): number {
  const t = (((rng.a + rng.b) | 0) + rng.d) | 0;
  rng.d = (rng.d + 1) | 0;
  rng.a = rng.b ^ (rng.b >>> 9);
  rng.b = (rng.c + (rng.c << 3)) | 0;
  rng.c = (((rng.c << 21) | (rng.c >>> 11)) + t) | 0;
  return t >>> 0;
}

/**
 * An integer in [0, bound), with no modulo bias. `bound` must be an integer in
 * [1, 2^32]; anything else is a programming error and throws.
 */
export function nextInt(rng: Rng, bound: number): number {
  if (!Number.isInteger(bound) || bound < 1 || bound > 0x1_0000_0000) {
    throw new RangeError(`nextInt bound must be an integer in [1, 2^32], got ${bound}`);
  }
  // Reject the short tail of the 32-bit range so every residue is equally likely.
  const limit = 0x1_0000_0000 - (0x1_0000_0000 % bound);
  let x = nextU32(rng);
  while (x >= limit) x = nextU32(rng);
  return x % bound;
}

/** True with probability `numerator / denominator`. */
export function chance(rng: Rng, numerator: number, denominator: number): boolean {
  return nextInt(rng, denominator) < numerator;
}

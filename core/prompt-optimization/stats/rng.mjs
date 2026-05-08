/**
 * Mulberry32 — deterministic, fast, ~32-bit-state PRNG.
 *
 * Same seed + same call sequence produces identical streams across machines
 * and Node versions. NOT cryptographic. Mirrors eval/scripts/generate-splits.js
 * so split generation and statistical resampling share the same RNG family.
 *
 * Reference: Tommy Ettinger, https://github.com/skeeto/hash-prospector
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

export function randInt(rng, n) {
  return Math.floor(rng() * n);
}

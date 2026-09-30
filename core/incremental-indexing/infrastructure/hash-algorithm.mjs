/**
 * Configured content-hash algorithm. Split out of `hashing.mjs` so readers that
 * only need the NAME (the index config fingerprint) skip loading the hashers.
 * `hashing.mjs` evaluates the same resolver at its own load, so both agree.
 */
export function resolveHashAlgorithm(env = process.env) {
  const algo = (env.SWEET_SEARCH_HASH_ALGORITHM || 'xxhash3').toLowerCase();
  return algo === 'sha256' ? 'sha256' : 'xxhash3';
}

export const HASH_ALGORITHM = resolveHashAlgorithm();

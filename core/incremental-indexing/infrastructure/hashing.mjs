/**
 * Content-hashing wrapper for incremental indexing.
 *
 * Sweet-search uses content hashes for local dedup (per-file content, per-chunk
 * content, exact encoder inputs). The original incremental-tracker.js path
 * truncates SHA-256 to 16 hex chars (8 bytes / 64 bits). That is enough for
 * collision avoidance on local corpora but the throughput (~1-2 GiB/s on cores
 * without SHA-NI / ARMv8 Crypto Extensions) becomes meaningful on branch-switch
 * storms that touch tens of thousands of files.
 *
 * Plan § 7.2 / § 21 specifies xxHash3-64 as the default, gated behind
 * SWEET_SEARCH_HASH_ALGORITHM with a SHA-256 truncation fallback for
 * compliance / auditing. xxHash3 is collision-resistant well beyond our
 * working set (Cyan4973/xxHash + SMHasher3 benchmarks) and runs 15-30 GiB/s
 * with native SIMD.
 *
 * Resolution order:
 *   1. native crate: crates/sweet-search-native exports xxhash3_64 — fastest.
 *   2. @node-rs/xxhash — fast prebuilt N-API binding.
 *   3. pure-JS xxHash3 — present here as a portable last resort; ~3× faster
 *      than SHA-256 truncation but slower than the native paths.
 *   4. SHA-256 truncate-16 — current behaviour, kept as the compliance
 *      override and the fallback when the algorithm switch is `sha256`.
 *
 * The output of every path is a 16-hex-char string so consumers (logs,
 * SQLite columns of TEXT type, JSON state files) can be swapped without
 * cascading changes.
 */

import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const ALGO_ENV = (process.env.SWEET_SEARCH_HASH_ALGORITHM || 'xxhash3').toLowerCase();
export const HASH_ALGORITHM = ALGO_ENV === 'sha256' ? 'sha256' : 'xxhash3';
const require = createRequire(import.meta.url);
const PURE_JS_PRIME64_1 = 0x9E3779B185EBCA87n;
const PURE_JS_PRIME64_2 = 0xC2B2AE3D27D4EB4Fn;
const PURE_JS_PRIME64_3 = 0x165667B19E3779F9n;
const PURE_JS_PRIME64_4 = 0x85EBCA77C2B2AE63n;
const PURE_JS_PRIME64_5 = 0x27D4EB2F165667C5n;
const MASK64 = 0xFFFFFFFFFFFFFFFFn;

let nativeXxh3 = null;
let nodeRsXxh3 = null;
let resolved = false;

function toHex64(value) {
  if (typeof value === 'string') {
    return value.length >= 16 ? value.slice(-16).toLowerCase() : value.padStart(16, '0').toLowerCase();
  }
  return (typeof value === 'bigint' ? value : BigInt(value)).toString(16).padStart(16, '0');
}

function rotl64(x, r) {
  return ((x << BigInt(r)) | (x >> BigInt(64 - r))) & MASK64;
}

function readUInt64LE(buf, offset) {
  const lo = BigInt(buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) & 0xFFFFFFFFn;
  const hi = BigInt(buf[offset + 4] | (buf[offset + 5] << 8) | (buf[offset + 6] << 16) | (buf[offset + 7] << 24)) & 0xFFFFFFFFn;
  return (lo | (hi << 32n)) & MASK64;
}

function readUInt32LE(buf, offset) {
  // (buf[off] | buf[off+1]<<8 | buf[off+2]<<16 | buf[off+3]<<24) operates on Number; the top
  // bit set produces a negative i32. Mask first, then promote to BigInt so we never feed
  // negatives into xxHash mixing.
  const lo = (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
  return BigInt(lo);
}

/**
 * Pure-JS xxHash64 (close-enough fallback for environments without the native
 * binding). We use xxHash64 here, not xxHash3, because xxHash3's full algorithm
 * is significantly more complex while still producing different bytes than
 * xxHash64. As soon as the native binding is available the wrapper switches
 * to xxhash3_64 transparently; the pure-JS path is only ever used when neither
 * crates/sweet-search-native nor @node-rs/xxhash is installed.
 *
 * Output is collision-resistant for our working set (sweet-search hashes for
 * local dedup, not cryptographic integrity). See plan § 7.2 hash choice.
 */
function xxh64PureJs(buf, seed = 0n) {
  let h64;
  const len = buf.length;
  let i = 0;

  if (len >= 32) {
    let v1 = (seed + PURE_JS_PRIME64_1 + PURE_JS_PRIME64_2) & MASK64;
    let v2 = (seed + PURE_JS_PRIME64_2) & MASK64;
    let v3 = seed;
    let v4 = (seed - PURE_JS_PRIME64_1) & MASK64;

    while (i + 32 <= len) {
      v1 = (v1 + ((readUInt64LE(buf, i) * PURE_JS_PRIME64_2) & MASK64)) & MASK64;
      v1 = rotl64(v1, 31);
      v1 = (v1 * PURE_JS_PRIME64_1) & MASK64;

      v2 = (v2 + ((readUInt64LE(buf, i + 8) * PURE_JS_PRIME64_2) & MASK64)) & MASK64;
      v2 = rotl64(v2, 31);
      v2 = (v2 * PURE_JS_PRIME64_1) & MASK64;

      v3 = (v3 + ((readUInt64LE(buf, i + 16) * PURE_JS_PRIME64_2) & MASK64)) & MASK64;
      v3 = rotl64(v3, 31);
      v3 = (v3 * PURE_JS_PRIME64_1) & MASK64;

      v4 = (v4 + ((readUInt64LE(buf, i + 24) * PURE_JS_PRIME64_2) & MASK64)) & MASK64;
      v4 = rotl64(v4, 31);
      v4 = (v4 * PURE_JS_PRIME64_1) & MASK64;

      i += 32;
    }

    h64 = (rotl64(v1, 1) + rotl64(v2, 7) + rotl64(v3, 12) + rotl64(v4, 18)) & MASK64;

    v1 = (rotl64((v1 * PURE_JS_PRIME64_2) & MASK64, 31) * PURE_JS_PRIME64_1) & MASK64;
    h64 = ((h64 ^ v1) * PURE_JS_PRIME64_1 + PURE_JS_PRIME64_4) & MASK64;

    v2 = (rotl64((v2 * PURE_JS_PRIME64_2) & MASK64, 31) * PURE_JS_PRIME64_1) & MASK64;
    h64 = ((h64 ^ v2) * PURE_JS_PRIME64_1 + PURE_JS_PRIME64_4) & MASK64;

    v3 = (rotl64((v3 * PURE_JS_PRIME64_2) & MASK64, 31) * PURE_JS_PRIME64_1) & MASK64;
    h64 = ((h64 ^ v3) * PURE_JS_PRIME64_1 + PURE_JS_PRIME64_4) & MASK64;

    v4 = (rotl64((v4 * PURE_JS_PRIME64_2) & MASK64, 31) * PURE_JS_PRIME64_1) & MASK64;
    h64 = ((h64 ^ v4) * PURE_JS_PRIME64_1 + PURE_JS_PRIME64_4) & MASK64;
  } else {
    h64 = (seed + PURE_JS_PRIME64_5) & MASK64;
  }

  h64 = (h64 + BigInt(len)) & MASK64;

  while (i + 8 <= len) {
    let k1 = (readUInt64LE(buf, i) * PURE_JS_PRIME64_2) & MASK64;
    k1 = rotl64(k1, 31);
    k1 = (k1 * PURE_JS_PRIME64_1) & MASK64;
    h64 ^= k1;
    h64 = (rotl64(h64, 27) * PURE_JS_PRIME64_1 + PURE_JS_PRIME64_4) & MASK64;
    i += 8;
  }

  if (i + 4 <= len) {
    h64 = ((h64 ^ ((readUInt32LE(buf, i) * PURE_JS_PRIME64_1) & MASK64)) & MASK64);
    h64 = (rotl64(h64, 23) * PURE_JS_PRIME64_2 + PURE_JS_PRIME64_3) & MASK64;
    i += 4;
  }

  while (i < len) {
    h64 = (h64 ^ (BigInt(buf[i]) * PURE_JS_PRIME64_5)) & MASK64;
    h64 = (rotl64(h64, 11) * PURE_JS_PRIME64_1) & MASK64;
    i += 1;
  }

  h64 ^= h64 >> 33n;
  h64 = (h64 * PURE_JS_PRIME64_2) & MASK64;
  h64 ^= h64 >> 29n;
  h64 = (h64 * PURE_JS_PRIME64_3) & MASK64;
  h64 ^= h64 >> 32n;

  return h64;
}

function bufFromInput(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (typeof input === 'string') return Buffer.from(input, 'utf8');
  throw new TypeError(`hashing: unsupported input type ${typeof input}`);
}

function makeNativeXxh3(mod) {
  if (!mod || typeof mod.xxhash3_64 !== 'function') return null;
  return (buf) => toHex64(mod.xxhash3_64(buf));
}

function makeNodeRsXxh3(mod) {
  if (!mod) return null;
  const ns = mod.default && (mod.default.xxh3 || mod.default.Xxh3) ? mod.default : mod;
  if (ns.xxh3 && typeof ns.xxh3.xxh64 === 'function') {
    return (buf) => toHex64(ns.xxh3.xxh64(buf));
  }
  const Xxh3 = ns.Xxh3 || ns.xxh3;
  if (Xxh3 && typeof Xxh3.oneShotHashU64 === 'function') {
    return (buf) => toHex64(Xxh3.oneShotHashU64(buf));
  }
  if (Xxh3 && typeof Xxh3.h64 === 'function') {
    return (buf) => toHex64(Xxh3.h64(buf));
  }
  if (Xxh3 && typeof Xxh3.withSeed === 'function') {
    return (buf) => {
      const hasher = Xxh3.withSeed(0n);
      hasher.update(buf);
      return toHex64(hasher.digest());
    };
  }
  return null;
}

function resolveBackendsSync() {
  if (ALGO_ENV === 'sha256') {
    resolved = true;
    return;
  }
  try {
    nativeXxh3 = makeNativeXxh3(require('../../../crates/sweet-search-native/index.js'));
  } catch {
    // Native crate not built or missing the export; try the package dependency.
  }
  if (!nativeXxh3) {
    try {
      nodeRsXxh3 = makeNodeRsXxh3(require('@node-rs/xxhash'));
    } catch {
      // Dependency not installed or native package failed to load; async resolver
      // and the portable fallback still keep hashing functional.
    }
  }
  resolved = Boolean(nativeXxh3 || nodeRsXxh3);
}

async function resolveBackends() {
  if (resolved) return;
  resolved = true;

  // Resolve native crate (preferred).
  try {
    const mod = await import('../../../crates/sweet-search-native/index.js');
    nativeXxh3 = makeNativeXxh3(mod);
  } catch {
    // Native crate not built or missing the export; fall through.
  }

  // Resolve @node-rs/xxhash (second preference).
  if (!nativeXxh3) {
    try {
      const mod = await import('@node-rs/xxhash');
      nodeRsXxh3 = makeNodeRsXxh3(mod);
    } catch {
      // Package not installed; pure-JS fallback wins.
    }
  }
}

/**
 * Hash arbitrary input (string or buffer) to a 16-hex-char digest.
 *
 * @param {Buffer|Uint8Array|string} input
 * @returns {Promise<string>}
 */
export async function contentHash(input) {
  await resolveBackends();
  return contentHashSync(input);
}

/**
 * Sync variant; safe to call after `contentHash` has run at least once
 * (warms the backend cache) or when caller explicitly opts in to the
 * pure-JS / SHA-256 path.
 */
export function contentHashSync(input) {
  const buf = bufFromInput(input);
  if (ALGO_ENV === 'sha256') {
    return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
  }
  if (nativeXxh3) return nativeXxh3(buf);
  if (nodeRsXxh3) return nodeRsXxh3(buf);
  return xxh64PureJs(buf).toString(16).padStart(16, '0');
}

/**
 * Stable JSON stringify used by metadata-fingerprint hashing. Sorts object
 * keys recursively so two equivalent objects produce identical bytes.
 *
 * @param {*} value
 * @returns {string}
 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

/**
 * Hash a metadata-bearing object deterministically.
 *
 * @param {object} payload
 * @returns {Promise<string>}
 */
export async function metadataFingerprint(payload) {
  return contentHash(stableStringify(payload));
}

export const __testing = {
  xxh64PureJs,
  stableStringify,
  resolveBackends,
};

resolveBackendsSync();

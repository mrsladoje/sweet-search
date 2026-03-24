/**
 * WASM-accelerated distance functions with JS fallback (Fix 6).
 *
 * Three-tier MaxSim acceleration:
 *   Tier 1: Native Rust + Rayon (60x) — parallel across CPU cores, NEON/AVX2 SIMD
 *   Tier 2: WASM SIMD f32x4 (16x)    — portable, single-threaded
 *   Tier 3: JS fallback (3.5x)       — norm-cached flat-buffer scoring
 *
 * Also provides WASM-accelerated:
 *   - hamming_distance, int8_dot, int8_norm_sq (simd-distance.wasm)
 *
 * Build: node scripts/build-wasm.js (WASM)
 *        cd native-maxsim && npx napi build --release --platform (native)
 *        cd wasm-maxsim && RUSTFLAGS="-C target-feature=+simd128" cargo build --target wasm32-unknown-unknown --release (Rust WASM)
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';

const DATA_OFFSET = 0; // SIMD popcount needs no LUT

let wasmExports = null;
let wasmMem = null;
let initDone = false;

// Rust-compiled MaxSim WASM (LLVM-optimized f32x4 SIMD + fused dequant)
let maxsimExports = null;
let maxsimMem = null;

// Native Rust + Rayon addon (Tier 1 — fastest)
let nativeMaxsim = null;

// =============================================================================
// INITIALIZATION
// =============================================================================

let initPromise = null;

async function initWasm() {
  if (initDone) return true;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const require = createRequire(import.meta.url);

      // Tier 1: Try native Rust addon (rayon parallel + NEON/AVX2 SIMD)
      try {
        const nativePath = join(__dirname, '..', 'native-maxsim');
        // Try platform-specific binary name
        const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
        const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
        const binaryName = `maxsim.${platform}-${arch}.node`;
        const binaryPath = join(nativePath, binaryName);

        if (existsSync(binaryPath)) {
          nativeMaxsim = require(binaryPath);
        }
      } catch {
        // Native not available — fall through to WASM
      }

      // Tier 2a: Load hand-assembled SIMD distance WASM
      const wasmPath = join(__dirname, 'simd-distance.wasm');
      if (existsSync(wasmPath)) {
        const wasmBuffer = readFileSync(wasmPath);
        const { instance } = await WebAssembly.instantiate(wasmBuffer);
        wasmExports = instance.exports;
        wasmMem = new Uint8Array(wasmExports.memory.buffer);
      }

      // Tier 2b: Load Rust-compiled MaxSim WASM (LLVM-optimized, f32x4 SIMD)
      const maxsimPath = join(__dirname, 'maxsim.wasm');
      if (existsSync(maxsimPath)) {
        const maxsimBuffer = readFileSync(maxsimPath);
        const { instance } = await WebAssembly.instantiate(maxsimBuffer);
        maxsimExports = instance.exports;
        maxsimMem = new Uint8Array(instance.exports.memory.buffer);
      }

      initDone = true;

      if (nativeMaxsim) {
        console.log('[MaxSim] Tier 1: Native Rust + Rayon (parallel SIMD)');
      } else if (maxsimExports || wasmExports?.maxsim_f32) {
        console.log('[MaxSim] Tier 2: WASM SIMD f32x4');
      } else {
        console.log('[MaxSim] Tier 3: JS fallback');
      }

      return true;
    } catch {
      initPromise = null;
      return false;
    }
  })();

  return initPromise;
}

// Eager non-blocking init
initWasm().catch(() => {});

// =============================================================================
// POPCOUNT LUT (JS fallback)
// =============================================================================

const POPCOUNT_LUT = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  POPCOUNT_LUT[i] = (i & 1) + POPCOUNT_LUT[i >> 1];
}

// =============================================================================
// HAMMING DISTANCE
// =============================================================================

export function wasmHammingDistance(a, b) {
  if (wasmExports) {
    const aPtr = DATA_OFFSET;
    const bPtr = DATA_OFFSET + a.length;
    // Re-acquire view in case memory grew
    wasmMem = new Uint8Array(wasmExports.memory.buffer);
    wasmMem.set(a, aPtr);
    wasmMem.set(b, bPtr);
    return wasmExports.hamming_distance(aPtr, bPtr, a.length);
  }
  // JS fallback
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    distance += POPCOUNT_LUT[a[i] ^ b[i]];
  }
  return distance;
}

// =============================================================================
// INT8 COSINE SIMILARITY
// =============================================================================

export function wasmInt8Cosine(a, b) {
  if (wasmExports) {
    const aPtr = DATA_OFFSET;
    const bPtr = DATA_OFFSET + a.length;
    wasmMem = new Uint8Array(wasmExports.memory.buffer);
    wasmMem.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), aPtr);
    wasmMem.set(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), bPtr);

    const dot = wasmExports.int8_dot(aPtr, bPtr, a.length);
    const normA = wasmExports.int8_norm_sq(aPtr, a.length);
    const normB = wasmExports.int8_norm_sq(bPtr, b.length);

    const na = Math.sqrt(normA);
    const nb = Math.sqrt(normB);
    if (na === 0 || nb === 0) return 0;
    return dot / (na * nb);
  }
  // JS fallback
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const na = Math.sqrt(normA);
  const nb = Math.sqrt(normB);
  if (na === 0 || nb === 0) return 0;
  return dot / (na * nb);
}

// =============================================================================
// INT8 BATCHED DOT PRODUCT (Phase 1: copy query once, score slab)
// =============================================================================

/**
 * Batch int8 dot product: score multiple candidate vectors against one query.
 * Copies query once to WASM memory, candidates as contiguous slab.
 * Returns raw int8 dot products (not normalized).
 *
 * For normalized int8 vectors (from L2-normalized floats), the raw dot
 * approximates cosine * 127². Divide by 16129 for cosine-scale scores.
 *
 * @param {Int8Array} query - Query int8 vector
 * @param {Int8Array[]} candidates - Array of candidate int8 vectors
 * @returns {Int32Array} Raw dot products
 */
export function wasmInt8BatchDot(query, candidates) {
  const dim = query.length;
  const count = candidates.length;
  if (count === 0) return new Int32Array(0);

  if (wasmExports && wasmExports.int8_batch_dot) {
    const queryPtr = DATA_OFFSET;
    const slabPtr = DATA_OFFSET + dim;
    // Scores buffer: 4 bytes per candidate, placed after the slab
    const scoresPtr = slabPtr + count * dim;
    // Align scores pointer to 4-byte boundary
    const alignedScoresPtr = (scoresPtr + 3) & ~3;
    const needed = alignedScoresPtr + count * 4;

    wasmMem = new Uint8Array(wasmExports.memory.buffer);
    if (needed > wasmMem.length) {
      return _jsInt8BatchDot(query, candidates);
    }

    // Copy query once
    wasmMem.set(new Uint8Array(query.buffer, query.byteOffset, query.byteLength), queryPtr);

    // Copy all candidates as contiguous slab
    for (let i = 0; i < count; i++) {
      const v = candidates[i];
      wasmMem.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), slabPtr + i * dim);
    }

    // Single WASM call: scores all candidates internally, writes to output buffer
    wasmExports.int8_batch_dot(queryPtr, slabPtr, count, dim, alignedScoresPtr);

    // Read scores from WASM memory
    return new Int32Array(wasmExports.memory.buffer, alignedScoresPtr, count);
  }

  return _jsInt8BatchDot(query, candidates);
}

function _jsInt8BatchDot(query, candidates) {
  const dim = query.length;
  const scores = new Int32Array(candidates.length);
  for (let c = 0; c < candidates.length; c++) {
    let dot = 0;
    const v = candidates[c];
    for (let i = 0; i < dim; i++) dot += query[i] * v[i];
    scores[c] = dot;
  }
  return scores;
}

// =============================================================================
// FLOAT32 BATCHED DOT PRODUCT (Phase 2: Stage 2.5 float rescore)
// =============================================================================

/**
 * Batch float32 dot product: score multiple float vectors against one query.
 * Pure JS implementation — V8 JIT is competitive with WASM for float math.
 *
 * @param {Float32Array} query - Query float vector
 * @param {Float32Array[]} candidates - Array of candidate float vectors
 * @returns {Float64Array} Dot product scores
 */
export function float32BatchDot(query, candidates) {
  const dim = query.length;
  const scores = new Float64Array(candidates.length);
  for (let c = 0; c < candidates.length; c++) {
    const v = candidates[c];
    if (v.length !== dim) {
      throw new Error(`float32BatchDot dimension mismatch: query=${dim}, candidate[${c}]=${v.length}`);
    }
    let dot = 0;
    for (let i = 0; i < dim; i++) dot += query[i] * v[i];
    scores[c] = dot;
  }
  return scores;
}

// For L2-normalized vectors, dot product = cosine similarity.
// Use float32BatchDot directly — no separate cosine wrapper needed.

// =============================================================================
// INT8 DOT PRODUCT (raw, for asymmetric distance)
// =============================================================================

export function wasmInt8Dot(a, b) {
  if (wasmExports) {
    const aPtr = DATA_OFFSET;
    const bPtr = DATA_OFFSET + a.length;
    wasmMem = new Uint8Array(wasmExports.memory.buffer);
    wasmMem.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), aPtr);
    wasmMem.set(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), bPtr);
    return wasmExports.int8_dot(aPtr, bPtr, a.length);
  }
  // JS fallback
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// =============================================================================
// STATUS
// =============================================================================

// =============================================================================
// ASYMMETRIC DISTANCE (1-bit doc × int4 query)
// =============================================================================

export function wasmAsymmetricDistance(docBinary, queryInt4, queryNormScaled) {
  if (wasmExports) {
    const docPtr = DATA_OFFSET;
    const queryPtr = DATA_OFFSET + docBinary.length;
    wasmMem = new Uint8Array(wasmExports.memory.buffer);
    wasmMem.set(docBinary, docPtr);
    wasmMem.set(new Uint8Array(queryInt4.buffer, queryInt4.byteOffset, queryInt4.byteLength), queryPtr);
    return wasmExports.asymmetric_distance(docPtr, queryPtr, queryInt4.length, queryNormScaled);
  }
  // JS fallback
  let approxDot = 0;
  const dim = queryInt4.length;
  for (let byteIdx = 0; byteIdx < docBinary.length; byteIdx++) {
    let byte = docBinary[byteIdx];
    const baseIdx = byteIdx * 8;
    for (let bit = 7; bit >= 0; bit--) {
      const idx = baseIdx + (7 - bit);
      if (idx >= dim) break;
      if (byte & (1 << bit)) approxDot += queryInt4[idx];
      else approxDot -= queryInt4[idx];
    }
  }
  return queryNormScaled - 2 * approxDot;
}

// =============================================================================
// WASM MAXSIM F32
// =============================================================================

/**
 * Compute MaxSim score entirely in WASM f32 arithmetic.
 *
 * Copies query and doc float32 tokens to WASM memory, calls the WASM
 * maxsim_f32 kernel, returns the score. ~10-30x faster than JS for
 * large Q×D×dim workloads.
 *
 * Falls back to null if WASM is unavailable or data exceeds memory.
 *
 * @param {Float32Array} queryFlat - Q × dim float32 (contiguous)
 * @param {Float32Array} docFlat - D × dim float32 (contiguous)
 * @param {number} numQ - Number of query tokens
 * @param {number} numD - Number of document tokens
 * @param {number} dim - Token dimension
 * @returns {number|null} MaxSim score, or null if WASM unavailable
 */
export function wasmMaxSimF32(queryFlat, docFlat, numQ, numD, dim) {
  // Use Rust-compiled WASM only (handles arbitrary dim via scalar tail)
  if (!maxsimExports?.maxsim_f32) return null;
  const exports = maxsimExports;

  const mem = maxsimExports
    ? new Uint8Array(maxsimExports.memory.buffer)
    : (wasmMem = new Uint8Array(wasmExports.memory.buffer));

  const qBytes = numQ * dim * 4;
  const dBytes = numD * dim * 4;

  if (qBytes + dBytes + 1024 > mem.length) return null;

  const qPtr = DATA_OFFSET;
  const dPtr = DATA_OFFSET + qBytes;

  mem.set(new Uint8Array(queryFlat.buffer, queryFlat.byteOffset, qBytes), qPtr);
  mem.set(new Uint8Array(docFlat.buffer, docFlat.byteOffset, dBytes), dPtr);

  return exports.maxsim_f32(qPtr, dPtr, numQ, numD, dim);
}

/**
 * Compute MaxSim with fused int8 dequantization in WASM.
 *
 * Skips JS-side dequantization entirely: copies raw int8 tokens (4x smaller)
 * to WASM memory and dequantizes inline during scoring.
 *
 * @param {Float32Array} queryFlat - Q × dim float32 (contiguous)
 * @param {Int8Array} docInt8 - Raw int8 document tokens (D × dim)
 * @param {number} numQ - Number of query tokens
 * @param {number} numD - Number of document tokens
 * @param {number} dim - Token dimension
 * @param {number} min - Quantization min
 * @param {number} scale - Quantization scale
 * @returns {number|null} MaxSim score, or null if unavailable
 */
export function wasmMaxSimDequant(queryFlat, docInt8, numQ, numD, dim, min, scale) {
  if (!maxsimExports?.maxsim_dequant) return null;

  const qBytes = numQ * dim * 4; // float32
  const dBytes = numD * dim;     // int8 (4x smaller!)

  const mem = new Uint8Array(maxsimExports.memory.buffer);
  if (qBytes + dBytes + 1024 > mem.length) return null;

  const qPtr = DATA_OFFSET;
  const dPtr = DATA_OFFSET + qBytes;

  // Copy query (float32)
  mem.set(new Uint8Array(queryFlat.buffer, queryFlat.byteOffset, qBytes), qPtr);
  // Copy doc int8 (4x smaller copy than float32!)
  mem.set(new Uint8Array(docInt8.buffer, docInt8.byteOffset, dBytes), dPtr);

  return maxsimExports.maxsim_dequant(qPtr, dPtr, numQ, numD, dim, min, scale);
}

// =============================================================================
// NATIVE MAXSIM BATCH (Tier 1 — rayon parallel)
// =============================================================================

/**
 * Score all candidates in parallel using the native Rust + Rayon addon.
 *
 * @param {Float32Array} queryFlat - Q × dim float32
 * @param {number} numQ
 * @param {number} dim
 * @param {Array<{tokens: Int8Array|Buffer, numTokens: number, dim: number, min: number, scale: number}>} candidates
 * @returns {number[]|null} Array of MaxSim scores, or null if native unavailable
 */
export function nativeMaxSimBatch(queryFlat, numQ, dim, candidates) {
  if (!nativeMaxsim) return null;
  return nativeMaxsim.maxsimScoreBatch(queryFlat, numQ, dim, candidates);
}

export function isWasmAvailable() {
  return !!wasmExports;
}

export function isMaxSimWasmAvailable() {
  return !!maxsimExports;
}

export function isNativeMaxSimAvailable() {
  return !!nativeMaxsim;
}

export function getMaxSimTier() {
  if (nativeMaxsim) return 'native';
  if (maxsimExports || wasmExports?.maxsim_f32) return 'wasm';
  return 'js';
}

export { initWasm };

/**
 * Resident-slab Hamming kernel for the binary HNSW hot path.
 *
 * The legacy wasmHammingDistance() copies BOTH 64-byte operands into WASM
 * linear memory on every call — at M=64/ef=400 a query pays thousands of
 * memcpy+FFI round-trips, construction ~10⁴–10⁵ per insert. This kernel keeps
 * every indexed vector RESIDENT in its own WASM instance (mirrored from a
 * contiguous JS slab), so a distance is a single FFI call with zero copies:
 * measured ~85ns/dist vs ~490ns/dist for the copy-per-call path (M3 Max,
 * 64-byte vectors). When WASM is unavailable it falls back to an unrolled
 * SWAR popcount over the JS slab (~190ns/dist vs ~600ns for the byte-LUT).
 *
 * The JS slab is the source of truth; per-vector Uint8Array subarray views
 * keep the existing `vectors[i].binary` contract intact. The WASM mirror is
 * a private instance of simd-distance.wasm (its exported memory is module-
 * internal), so the shared instance used by wasmInt8BatchDot & friends keeps
 * its scratch-at-offset-0 layout untouched.
 *
 * All arithmetic is integer Hamming — every path returns bit-exact results.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// WASM memory layout (all offsets fixed so memory.grow never moves them):
//   [0, 256)                    staged query (256B covers 2048-bit vectors)
//   [256, 256+4*CAP)            batch index scratch (u32 node indices)
//   [.., +4*CAP)                batch distance output (u32)
//   [SLAB_BASE, ...)            resident vector slab
// BATCH_CAP is far above the max graph degree (2*M0 ≈ 256), so a whole
// neighbor block always fits in one hamming_batch call.
const QUERY_SLOT_BYTES = 256;
const BATCH_CAP = 4096;
const BATCH_IDX_PTR = QUERY_SLOT_BYTES;
const BATCH_OUT_PTR = BATCH_IDX_PTR + BATCH_CAP * 4;
const SLAB_BASE = BATCH_OUT_PTR + BATCH_CAP * 4;
const WASM_PAGE = 65536;

let cachedModule; // WebAssembly.Module | null once resolved

function getWasmModule() {
  if (cachedModule !== undefined) return cachedModule;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const bytes = readFileSync(join(here, 'simd-distance.wasm'));
    // Sync compile is fine: the module is ~1KB.
    cachedModule = new WebAssembly.Module(bytes);
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

// SWAR popcount of one u32 (subtract-shift-mask + multiply reduction).
// Exact for all inputs.
function popcnt32(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

export class HammingSlab {
  /**
   * @param {number} dimension - vector size in BYTES
   */
  constructor(dimension) {
    this.dim = dimension;
    this.words = dimension >>> 2;        // full u32 words
    this.tailBytes = dimension & 3;      // non-multiple-of-4 remainder
    this.capacity = 0;                   // vectors
    this.count = 0;
    this.slab = new Uint8Array(0);       // JS source of truth
    this.slabU32 = new Uint32Array(0);
    // Query scratch (JS fallback path): word view + byte view over one buffer
    this.queryU32 = new Uint32Array(Math.ceil(dimension / 4));
    this.queryBytes = new Uint8Array(this.queryU32.buffer, 0, dimension);

    // Batch scratch: callers fill batchIdx[0..n) with node indices, call
    // batchToQuery(n)/batchToVector(t, n), and read distances from the
    // returned batchOut. One FFI call per block instead of one per neighbor.
    this.batchIdx = new Uint32Array(BATCH_CAP);
    this.batchOut = new Uint32Array(BATCH_CAP);
    this._wasmIdxU32 = null; // cached views over WASM memory (rebuilt on grow)
    this._wasmOutU32 = null;

    // WASM mirror (optional)
    this.wasm = null;
    this.wasmMem = null;
    const mod = getWasmModule();
    if (mod) {
      try {
        const instance = new WebAssembly.Instance(mod);
        this.wasm = instance.exports;
        this.wasmMem = new Uint8Array(this.wasm.memory.buffer);
      } catch {
        this.wasm = null;
      }
    }
  }

  _wasmView() {
    if (this.wasm && this.wasmMem.buffer !== this.wasm.memory.buffer) {
      this.wasmMem = new Uint8Array(this.wasm.memory.buffer);
      this._wasmIdxU32 = null;
      this._wasmOutU32 = null;
    }
    return this.wasmMem;
  }

  /** Grow to hold at least `count` vectors. Existing views stay valid until
   *  a grow re-points them — callers must use the views returned by set(). */
  ensure(count) {
    if (count <= this.capacity) return false;
    let newCap = Math.max(1024, this.capacity * 2);
    while (newCap < count) newCap *= 2;
    const newSlab = new Uint8Array(newCap * this.dim);
    newSlab.set(this.slab.subarray(0, this.count * this.dim));
    this.slab = newSlab;
    this.slabU32 = new Uint32Array(newSlab.buffer, 0, (newCap * this.dim) >>> 2);
    this.capacity = newCap;
    if (this.wasm) {
      const needed = SLAB_BASE + newCap * this.dim;
      const have = this.wasm.memory.buffer.byteLength;
      if (needed > have) {
        try {
          this.wasm.memory.grow(Math.ceil((needed - have) / WASM_PAGE));
        } catch {
          // Growth refused (host memory pressure) — drop the mirror, JS
          // fallback keeps everything exact.
          this.wasm = null;
        }
      }
    }
    return true;
  }

  /**
   * Write vector bytes at index (append or overwrite) into the JS slab and
   * the WASM mirror. Returns the canonical subarray view for storage on the
   * node record.
   */
  set(idx, bytes) {
    this.ensure(idx + 1);
    const off = idx * this.dim;
    const n = Math.min(bytes.length, this.dim);
    this.slab.set(n === bytes.length ? bytes : bytes.subarray(0, n), off);
    if (n < this.dim) this.slab.fill(0, off + n, off + this.dim);
    if (this.wasm) {
      this._wasmView().set(this.slab.subarray(off, off + this.dim), SLAB_BASE + off);
    }
    if (idx >= this.count) this.count = idx + 1;
    return this.slab.subarray(off, off + this.dim);
  }

  /** Re-point a node's canonical view after grows (rarely needed by callers
   *  that persist views long-term across many inserts). */
  view(idx) {
    const off = idx * this.dim;
    return this.slab.subarray(off, off + this.dim);
  }

  /** Stage the query for distToQuery(). Shorter inputs are zero-padded. */
  setQuery(bytes) {
    const n = Math.min(bytes.length, this.dim);
    this.queryBytes.set(n === bytes.length ? bytes : bytes.subarray(0, n));
    if (n < this.dim) this.queryBytes.fill(0, n);
    if (this.wasm) {
      this._wasmView().set(this.queryBytes, 0);
    }
  }

  /** Hamming distance from the staged query to vector idx. */
  distToQuery(idx) {
    if (this.wasm) {
      return this.wasm.hamming_distance(0, SLAB_BASE + idx * this.dim, this.dim);
    }
    if (this.tailBytes === 0) {
      if (this.words === 16) return swar16(this.queryU32, 0, this.slabU32, idx << 4);
      const s = this.slabU32;
      const q = this.queryU32;
      const o = idx * this.words;
      let c = 0;
      for (let w = 0; w < this.words; w++) c += popcnt32(q[w] ^ s[o + w]);
      return c;
    }
    // dim not a multiple of 4: per-vector slab offsets are word-unaligned,
    // so fall back to a byte loop.
    const off = idx * this.dim;
    let c = 0;
    for (let i = 0; i < this.dim; i++) c += popcnt32(this.queryBytes[i] ^ this.slab[off + i]);
    return c;
  }

  /** Hamming distance between two resident vectors. */
  dist(aIdx, bIdx) {
    if (this.wasm) {
      return this.wasm.hamming_distance(
        SLAB_BASE + aIdx * this.dim,
        SLAB_BASE + bIdx * this.dim,
        this.dim
      );
    }
    if (this.tailBytes === 0) {
      if (this.words === 16) return swar16(this.slabU32, aIdx << 4, this.slabU32, bIdx << 4);
      const s = this.slabU32;
      const ao = aIdx * this.words;
      const bo = bIdx * this.words;
      let c = 0;
      for (let w = 0; w < this.words; w++) c += popcnt32(s[ao + w] ^ s[bo + w]);
      return c;
    }
    const aOff = aIdx * this.dim;
    const bOff = bIdx * this.dim;
    let c = 0;
    for (let i = 0; i < this.dim; i++) c += popcnt32(this.slab[aOff + i] ^ this.slab[bOff + i]);
    return c;
  }

  /**
   * Batch: distances from the staged query to batchIdx[0..n). Results land
   * in (and are returned as) batchOut. One FFI call per block on the WASM
   * path; order-preserving and bit-exact on every path.
   */
  batchToQuery(n) {
    return this._batch(0, n);
  }

  /** Batch: distances from resident vector targetIdx to batchIdx[0..n). */
  batchToVector(targetIdx, n) {
    if (this.wasm) return this._batch(SLAB_BASE + targetIdx * this.dim, n);
    const idx = this.batchIdx;
    const out = this.batchOut;
    for (let i = 0; i < n; i++) out[i] = this.dist(targetIdx, idx[i]);
    return out;
  }

  _batch(qPtr, n) {
    if (this.wasm && this.wasm.hamming_batch && n <= BATCH_CAP) {
      this._wasmView(); // refresh cached views if memory grew
      if (this._wasmIdxU32 === null) {
        this._wasmIdxU32 = new Uint32Array(this.wasm.memory.buffer, BATCH_IDX_PTR, BATCH_CAP);
        this._wasmOutU32 = new Uint32Array(this.wasm.memory.buffer, BATCH_OUT_PTR, BATCH_CAP);
      }
      const wIdx = this._wasmIdxU32;
      const idx = this.batchIdx;
      for (let i = 0; i < n; i++) wIdx[i] = idx[i];
      this.wasm.hamming_batch(qPtr, SLAB_BASE, this.dim, BATCH_IDX_PTR, n, BATCH_OUT_PTR);
      const wOut = this._wasmOutU32;
      const out = this.batchOut;
      for (let i = 0; i < n; i++) out[i] = wOut[i];
      return out;
    }
    const idx = this.batchIdx;
    const out = this.batchOut;
    for (let i = 0; i < n; i++) out[i] = this.distToQuery(idx[i]);
    return out;
  }

  reset() {
    this.count = 0;
    // Keep allocation; contents are overwritten by set() before reads.
  }
}

/**
 * Fully-unrolled 16-word (64-byte / 512-bit) SWAR Hamming with deferred
 * reduction in ≤7-word groups — 7 words × 8/byte-lane × 4 lanes = 224 < 256,
 * so the final multiply's top byte can't overflow. Bit-exact.
 */
function swar16(A, ao, B, bo) {
  let x, a = 0, b = 0, c = 0;
  x = A[ao] ^ B[bo];           x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); a += (x + (x >>> 4)) & 0x0f0f0f0f;
  x = A[ao + 1] ^ B[bo + 1];   x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); a += (x + (x >>> 4)) & 0x0f0f0f0f;
  x = A[ao + 2] ^ B[bo + 2];   x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); a += (x + (x >>> 4)) & 0x0f0f0f0f;
  x = A[ao + 3] ^ B[bo + 3];   x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); a += (x + (x >>> 4)) & 0x0f0f0f0f;
  x = A[ao + 4] ^ B[bo + 4];   x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); a += (x + (x >>> 4)) & 0x0f0f0f0f;
  x = A[ao + 5] ^ B[bo + 5];   x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); a += (x + (x >>> 4)) & 0x0f0f0f0f;
  x = A[ao + 6] ^ B[bo + 6];   x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); a += (x + (x >>> 4)) & 0x0f0f0f0f;
  x = A[ao + 7] ^ B[bo + 7];   x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); b += (x + (x >>> 4)) & 0x0f0f0f0f;
  x = A[ao + 8] ^ B[bo + 8];   x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); b += (x + (x >>> 4)) & 0x0f0f0f0f;
  x = A[ao + 9] ^ B[bo + 9];   x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); b += (x + (x >>> 4)) & 0x0f0f0f0f;
  x = A[ao + 10] ^ B[bo + 10]; x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); b += (x + (x >>> 4)) & 0x0f0f0f0f;
  x = A[ao + 11] ^ B[bo + 11]; x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); b += (x + (x >>> 4)) & 0x0f0f0f0f;
  x = A[ao + 12] ^ B[bo + 12]; x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); b += (x + (x >>> 4)) & 0x0f0f0f0f;
  x = A[ao + 13] ^ B[bo + 13]; x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); b += (x + (x >>> 4)) & 0x0f0f0f0f;
  x = A[ao + 14] ^ B[bo + 14]; x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); c += (x + (x >>> 4)) & 0x0f0f0f0f;
  x = A[ao + 15] ^ B[bo + 15]; x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); c += (x + (x >>> 4)) & 0x0f0f0f0f;
  return (Math.imul(a, 0x01010101) >>> 24)
       + (Math.imul(b, 0x01010101) >>> 24)
       + (Math.imul(c, 0x01010101) >>> 24);
}

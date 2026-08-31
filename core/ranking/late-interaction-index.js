#!/usr/bin/env node

/**
 * Late Interaction Index
 *
 * Token-level embeddings with compression for MaxSim scoring.
 * Uses LateOn-Code models for real late interaction.
 *
 * Index format v2.0: stores modelId in header for cross-model consistency checks.
 * Index format v3.0 (SSLX): fully binary segment format — 3.4x smaller on disk.
 */

import fs from 'fs/promises';
import { bootLog } from '../infrastructure/boot-log.js';
import { existsSync, createWriteStream, createReadStream, statSync } from 'fs';
import readline from 'readline';
import path from 'path';
import { DB_PATHS, LATE_INTERACTION_CONFIG } from '../infrastructure/config/index.js';
import { wasmMaxSimF32, wasmMaxSimDequantPerToken, wasmMaxSimDequant4Bit, wasmMaxSimPrepareQuery, nativeMaxSimBatch, nativeMaxSimBatchPerToken, nativeMaxSimBatch4Bit, initWasm, isNativeMaxSimAvailable, isNativePerTokenAvailable, isNative4BitAvailable } from '../infrastructure/simd-distance.js';
import { fastRotate, generateSignVector, calibrateWUSH, wushRotate } from '../infrastructure/quantization.js';
import { poolTokens } from './late-interaction-model.js';
import { loadBitmap, isSet } from '../infrastructure/tombstone-bitmap-reader.js';

// =============================================================================
// CRC32 (IEEE 802.3 polynomial, used for SSLX segment footer checksum)
// =============================================================================
const CRC32_TABLE = new Uint32Array(256);
{
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    CRC32_TABLE[i] = c >>> 0;
  }
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Quantize float32 to int8 for storage (per-document: single min/scale)
 */
function quantizeToInt8(floatArray) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < floatArray.length; i++) {
    const v = floatArray[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }

  if (max === min) {
    const int8Array = new Int8Array(floatArray.length);
    int8Array.fill(0);
    return { data: int8Array, min, scale: 0 };
  }

  const scale = (max - min) / 255;

  const int8Array = new Int8Array(floatArray.length);
  for (let i = 0; i < floatArray.length; i++) {
    int8Array[i] = Math.round((floatArray[i] - min) / scale) - 128;
  }

  return { data: int8Array, min, scale };
}

/**
 * Quantize float32 to int8 with per-token min/scale (Phase 1).
 * Each token gets its own min/scale, using the full INT8 range.
 *
 * @param {Float32Array} flat - Flattened token data (numTokens * tokenDim)
 * @param {number} numTokens
 * @param {number} tokenDim
 * @returns {{ data: Int8Array, minArray: Float32Array, scaleArray: Float32Array }}
 */
function quantizeToInt8PerToken(flat, numTokens, tokenDim) {
  const int8Array = new Int8Array(flat.length);
  const minArray = new Float32Array(numTokens);
  const scaleArray = new Float32Array(numTokens);

  for (let t = 0; t < numTokens; t++) {
    const off = t * tokenDim;
    let tMin = Infinity;
    let tMax = -Infinity;
    for (let d = 0; d < tokenDim; d++) {
      const v = flat[off + d];
      if (v < tMin) tMin = v;
      if (v > tMax) tMax = v;
    }

    minArray[t] = tMin;

    if (tMax === tMin) {
      scaleArray[t] = 0;
      // All zeros — midpoint
      for (let d = 0; d < tokenDim; d++) int8Array[off + d] = 0;
    } else {
      const sc = (tMax - tMin) / 255;
      scaleArray[t] = sc;
      for (let d = 0; d < tokenDim; d++) {
        int8Array[off + d] = Math.round((flat[off + d] - tMin) / sc) - 128;
      }
    }
  }

  return { data: int8Array, minArray, scaleArray };
}

/**
 * Quantize float32 to int4 with per-token min/scale (Phase 4).
 * Packs 2 values per byte: low nibble = even index, high nibble = odd index.
 * Each token gets its own min/scale, using the full 4-bit (16 levels) range.
 *
 * NOTE: CRA-2 (quantile-based boundaries) was reverted — a correct implementation
 * requires storing quantile centroids in the binary format so dequant can use them.
 * Without matching centroids, the encode/decode mismatch increases error.
 * CRA-2 should be revisited as a format-level change, not a drop-in encoder swap.
 *
 * @param {Float32Array} flat - Flattened token data (numTokens * tokenDim)
 * @param {number} numTokens
 * @param {number} tokenDim
 * @returns {{ data: Uint8Array, minArray: Float32Array, scaleArray: Float32Array }}
 */
function quantizeToInt4PerToken(flat, numTokens, tokenDim) {
  const packedSize = Math.ceil(tokenDim / 2);
  const packedArray = new Uint8Array(numTokens * packedSize);
  const minArray = new Float32Array(numTokens);
  const scaleArray = new Float32Array(numTokens);

  for (let t = 0; t < numTokens; t++) {
    const off = t * tokenDim;
    let tMin = Infinity;
    let tMax = -Infinity;
    for (let d = 0; d < tokenDim; d++) {
      const v = flat[off + d];
      if (v < tMin) tMin = v;
      if (v > tMax) tMax = v;
    }

    minArray[t] = tMin;

    const pOff = t * packedSize;
    if (tMax === tMin) {
      scaleArray[t] = 0;
    } else {
      const sc = (tMax - tMin) / 15; // 16 levels: 0..15
      scaleArray[t] = sc;
      for (let d = 0; d < tokenDim; d += 2) {
        const v0 = Math.round((flat[off + d] - tMin) / sc);
        const nibble0 = Math.max(0, Math.min(15, v0));
        let nibble1 = 0;
        if (d + 1 < tokenDim) {
          const v1 = Math.round((flat[off + d + 1] - tMin) / sc);
          nibble1 = Math.max(0, Math.min(15, v1));
        }
        packedArray[pOff + (d >> 1)] = (nibble1 << 4) | nibble0;
      }
    }
  }

  return { data: packedArray, minArray, scaleArray };
}

/**
 * Dequantize int4 (nibble-packed) back to float32 with per-token min/scale.
 *
 * @param {Uint8Array} packed - Nibble-packed data (numTokens * ceil(tokenDim/2))
 * @param {Float32Array} minArray - Per-token min values
 * @param {Float32Array} scaleArray - Per-token scale values
 * @param {number} numTokens
 * @param {number} tokenDim
 * @returns {Float32Array}
 */
function dequantInt4ToBuffer(packed, minArray, scaleArray, numTokens, tokenDim, out) {
  const packedSize = Math.ceil(tokenDim / 2);
  for (let t = 0; t < numTokens; t++) {
    const fOff = t * tokenDim;
    const pOff = t * packedSize;
    const tMin = minArray[t];
    const tScale = scaleArray[t];
    if (tScale === 0) {
      for (let d = 0; d < tokenDim; d++) out[fOff + d] = tMin;
    } else {
      for (let d = 0; d < tokenDim; d += 2) {
        const byte = packed[pOff + (d >> 1)];
        out[fOff + d] = (byte & 0x0F) * tScale + tMin;
        if (d + 1 < tokenDim) {
          out[fOff + d + 1] = ((byte >> 4) & 0x0F) * tScale + tMin;
        }
      }
    }
  }
}

function dequantizeFromInt4PerToken(packed, minArray, scaleArray, numTokens, tokenDim) {
  const out = new Float32Array(numTokens * tokenDim);
  dequantInt4ToBuffer(packed, minArray, scaleArray, numTokens, tokenDim, out);
  return out;
}

/**
 * Dequantize int8 back to float32
 */
function dequantizeFromInt8(int8Array, min, scale) {
  const floatArray = new Float32Array(int8Array.length);

  // Edge case: if scale is 0, all original values were equal to min
  if (scale === 0) {
    floatArray.fill(min);
    return floatArray;
  }

  for (let i = 0; i < int8Array.length; i++) {
    floatArray[i] = (int8Array[i] + 128) * scale + min;
  }
  return floatArray;
}

/**
 * Cosine similarity with pre-computed norms.
 * Avoids recomputing norms on every call (3x fewer FLOPs in inner loop).
 */
function cosineSimilarityFast(a, b, normA, normB) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot / (normA * normB + 1e-8);
}

/**
 * Compute L2 norm of a vector.
 */
function l2Norm(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  return Math.sqrt(sum);
}

/**
 * CRA-9: Voronoi-guided token pruning. Estimates token "uniqueness" by computing
 * mean distance to nearest neighbors. Tokens with small mean NN distance (tiny
 * Voronoi cells) are redundant — their information is well-represented by
 * neighbors. Tokens with large mean NN distance are unique and must be kept.
 *
 * @param {Array} tokens - Token vectors (first is protected)
 * @param {number} threshold - Keep ratio (0..1): fraction of tokens to keep
 * @returns {Array} Pruned token list
 */
/**
 * @param {Array} tokens - Token vectors (first is protected)
 * @param {number} keepRatio - Fraction of tokens to keep (0..1), e.g. 0.7 = keep 70%
 */
function voronoiPruneTokens(tokens, keepRatio) {
  if (tokens.length <= 2) return tokens;

  const dim = tokens[0].length;
  const n = tokens.length;

  // Compute nearest-neighbor distance for each non-protected token
  const importance = new Float32Array(n);
  importance[0] = Infinity; // protect first token

  for (let i = 1; i < n; i++) {
    let minDist = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      let dot = 0;
      for (let d = 0; d < dim; d++) dot += tokens[i][d] * tokens[j][d];
      const dist = 1 - dot; // cosine distance for L2-normalized vectors
      if (dist < minDist) minDist = dist;
    }
    importance[i] = minDist; // larger = more unique = keep
  }

  // Keep top keepRatio fraction by importance + always keep protected token
  const keepCount = Math.max(1, Math.round(n * keepRatio));
  const indexed = Array.from({ length: n }, (_, i) => ({ i, imp: importance[i] }));
  indexed.sort((a, b) => b.imp - a.imp);
  const keepSet = new Set(indexed.slice(0, keepCount).map(x => x.i));
  keepSet.add(0);

  return tokens.filter((_, i) => keepSet.has(i));
}

/**
 * Late Interaction Index Class
 */
const LI_SEGMENT_SIZE = 10_000;
const LI_SEGMENT_MAGIC = 0x4C495345; // "LISE" = Late Interaction Segment (legacy)
const SSLX_SEGMENT_MAGIC = 0x53534C58; // "SSLX" = Sweet Search Late indeX (v3 binary)
const SSLX_VERSION = 3;
const SSLX_HEADER_SIZE = 64;
const SSLX_DOC_ENTRY_SIZE = 20;

// =============================================================================
// SSLX v3 prefix reader (positions-only load)
//
// The incremental delta path needs only each segment's document IDS in
// on-disk order — it reads `_docSegmentPositions` and `_segments[].count` and
// never touches a token. Those ids live entirely in the file PREFIX
// (header + document table + id table), ahead of the token slab, so they can
// be read without materialising the slab. On this repository the slab is
// ~1.4 GB and was being flattened into `documents` on every working tick.
//
// Whole-file CRC verification is NOT dropped. It runs on the first read after a
// segment's filesystem identity (inode, size, mtime, ctime) changes; while the
// identity is unchanged the prefix read is used and the previously verified CRC
// still stands for those bytes. Structural prefix validation (magic, version,
// slabStart <= fileSize, numDocs vs the manifest's count) is the second line:
// any failure escalates to the full verified read rather than being trusted.
// =============================================================================

/**
 * Validate an SSLX header and derive the fixed part of the layout.
 * @param {Buffer} header At least SSLX_HEADER_SIZE bytes from offset 0.
 * @param {number} fileSize Size of the whole segment file in bytes.
 * @returns {{numDocs:number, idTableStart:number}|null} null when the prefix is
 *   not a structurally valid SSLX v3 header.
 */
function sslxPrefixLayout(header, fileSize) {
  if (!header || header.length < SSLX_HEADER_SIZE) return null;
  if (header.readUInt32LE(0) !== SSLX_SEGMENT_MAGIC) return null;
  if (header.readUInt16LE(4) !== SSLX_VERSION) return null;
  const numDocs = header.readUInt32LE(8);
  // Doc table + the u32 id-table length + the 4-byte CRC footer must all fit.
  const idTableStart = SSLX_HEADER_SIZE + numDocs * SSLX_DOC_ENTRY_SIZE;
  if (!Number.isSafeInteger(idTableStart)) return null;
  if (idTableStart + 4 + 4 > fileSize) return null;
  return { numDocs, idTableStart };
}

/**
 * Parse `numDocs` length-prefixed UTF-8 ids out of an id-table slice.
 * @returns {string[]|null} null when an entry runs past the table.
 */
function parseSslxIdTable(idTable, numDocs) {
  const ids = new Array(numDocs);
  let off = 0;
  for (let i = 0; i < numDocs; i++) {
    if (off + 2 > idTable.length) return null;
    const idLen = idTable.readUInt16LE(off);
    if (off + 2 + idLen > idTable.length) return null;
    ids[i] = idTable.toString('utf-8', off + 2, off + 2 + idLen);
    off += 2 + idLen;
  }
  return ids;
}

/**
 * Filesystem identity of a segment file: inode, size, and nanosecond mtime and
 * ctime. Any content rewrite, truncation, replacement or in-place byte flip
 * moves at least one of these, so an unchanged key means the bytes we CRC'd
 * before are still the bytes on disk.
 * @returns {{key:string, size:number}|null}
 */
function segmentIdentity(segPath) {
  try {
    const st = statSync(segPath, { bigint: true });
    return {
      key: `${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`,
      size: Number(st.size),
    };
  } catch {
    return null;
  }
}

export class LateInteractionIndex {
  constructor(options = {}) {
    this.tokenDim = options.tokenDim || LATE_INTERACTION_CONFIG.tokenDimension;
    this.maxTokens = options.maxTokens || 512;
    const defaultQuantization = LATE_INTERACTION_CONFIG.quantization || 'int8';
    this.useInt8 = options.useInt8 ?? (defaultQuantization === 'int8' || defaultQuantization === 'int4');
    this.quantBits = options.quantBits ?? (
      options.useInt8 === true ? 8
        : options.useInt8 === false ? 32
          : defaultQuantization === 'int4' ? 4
            : (this.useInt8 ? 8 : 32)
    ); // 8=int8, 4=int4-nibble, 32=float32
    this.indexPath = options.indexPath || DB_PATHS.lateInteraction || path.join(process.cwd(), '.sweet-search', 'late-interaction-tokens.db');
    this.modelId = options.modelId || LATE_INTERACTION_CONFIG.model || null;
    this.poolFactor = options.poolFactor || 1;
    this.streamChunkSize = options.streamChunkSize || (8 * 1024 * 1024);
    this.loadExisting = options.loadExisting ?? true;

    // Positions-only load (incremental delta path). When true, a SEGMENTED load
    // populates `_docSegmentPositions`, `_segments`, `_segmentDir` and the
    // format config from the manifest, but never materialises a token slab into
    // `documents`. Search readers must leave this false — scoring needs tokens.
    // It has no effect on the legacy single-file format, which has no prefix to
    // read; that path still loads in full.
    this.positionsOnly = options.positionsOnly ?? false;
    // Cross-load verified-identity cache: segment path -> identity key of the
    // last read whose whole-file CRC32 was verified. Supplied by the caller so
    // its lifetime (and its bound) is owned where the ticks are, not here.
    this._positionsCache = options.positionsCache instanceof Map ? options.positionsCache : null;
    // Set by `load()` when it swallows a non-ENOENT failure; `init()` rethrows
    // it for positions-only readers (see init()).
    this._loadFailure = null;

    // Phase 3: norm-based token pruning threshold (0 = disabled)
    this.normPruneThreshold = options.normPruneThreshold || 0;
    // CRA-9: Use Voronoi cell volume instead of norm for pruning decisions.
    // voronoiKeepRatio is a separate param (0..1, fraction to KEEP), not overloaded
    // from normPruneThreshold which is an absolute norm threshold.
    this.voronoiPrune = options.voronoiPrune ?? false;
    this.voronoiKeepRatio = options.voronoiKeepRatio ?? 0.7; // keep 70% by default

    // WHT rotation (Phase 2): seed > 0 enables Walsh-Hadamard rotation
    // before quantization. Equalizes dimension variance for better INT8 fidelity.
    // Default OFF (0) for backward compat — legacy indexes don't persist whtSeed,
    // so defaulting ON would rotate queries against unrotated documents.
    this.whtSeed = options.whtSeed ?? 0;
    // CRA-4: 'natural' (default, backward-compat) or 'sequency' (opt-in, new indexes only)
    this.whtOrdering = options.whtOrdering || 'natural';
    this._signVector = null; // lazy-init on first add/query

    // CRA-10: SAQ-style adaptive bit allocation per dimension segment.
    // When enabled, dimensions with higher post-WHT variance get more bits (up to 6)
    // and low-variance dimensions get fewer (down to 3). Average stays at 4 bits.
    // Only useful if post-WHT variance ratio > 1.5 (otherwise uniform is optimal).
    this.adaptiveBitAlloc = options.adaptiveBitAlloc ?? false;

    // CRA-8 / Phase 5: Matryoshka dimension truncation. When matryoshkaDim is set
    // and less than tokenDim, token vectors are truncated to the first matryoshkaDim
    // dimensions before quantization. Requires a model trained with Matryoshka objective.
    // The effective storage dimension becomes matryoshkaDim instead of tokenDim.
    this.matryoshkaDim = options.matryoshkaDim || 0; // 0 = disabled

    // CRA-6: Token importance weights. When enabled, MaxSim scoring weights each
    // doc token's similarity by its pre-normalization L2 norm (a proxy for IDF —
    // high-norm tokens carry more information). Uses softmax over tokenNorms.
    this.useTokenWeights = options.useTokenWeights ?? false;

    // CRA-3: WUSH calibrated rotation. When wushCalibrate is true and whtSeed > 0,
    // collects sample embeddings during add() and calibrates the rotation matrix
    // after wushSampleSize samples. Replaces bare WHT with WUSH transform.
    this.wushCalibrate = options.wushCalibrate ?? false;
    this._wushSamples = []; // collected during add(), cleared after calibration
    this._wushSampleSize = options.wushSampleSize || 10000;
    this._wushCalibration = null; // { eigenVecs, invSqrtEigenVals } after calibration

    // In-memory storage
    this.documents = new Map(); // id -> { tokens, metadata }
    this.initialized = false;
    this._hasPerTokenQuant = false; // tracked for getStats — set on add/load
    this._loadedExisting = false;

    // Dedup: alias pointer sidecar. aliasId -> { exemplarId, clusterId, metadata }.
    // Aliases skip LI encoding entirely — MaxSim dereferences the exemplar's
    // per-token matrix from `this.documents` on every getTokens/getTokensFlat.
    // Persisted as a JSON sidecar next to the SSLX stub so the binary segment
    // format is untouched.
    this.aliasPointers = new Map();

    // Segmented flush state (Phase C)
    this._currentSegment = new Map();
    this._segments = []; // { path, count } of flushed segments
    this._segmentDir = null;
    this._segmentSize = options.segmentSize || LI_SEGMENT_SIZE;
    this._docSegmentPositions = new Map(); // doc id -> { segmentPath, docIndex }
    this._staleBitmapCache = new Map(); // segment path -> { mtimeMs, size, bitmap }

    // Bounded build mode (Phase C completion). When `buildEvict` is set,
    // _flushSegment() drops each flushed segment's per-token slabs from
    // `this.documents` so peak indexing memory stays O(one segment) instead of
    // O(all docs) — the regression that let large repos accumulate the entire
    // per-token corpus in the heap. Only safe during a from-scratch build (no
    // search reads, no rewrite-from-documents save path). The fast-path save()
    // writes the manifest from the already-flushed segment files, so it never
    // needs the evicted docs back. A lightweight id set keeps alias-pointer
    // registration valid after the exemplar's tokens are gone, and running
    // doc/token totals keep getStats() + the save() doc-count accurate.
    this._evictMode = !!options.buildEvict;
    this._evictedDocs = 0;
    this._evictedTokens = 0;
    this._addedIds = this._evictMode ? new Set() : null;
  }

  /**
   * Reset segment state for a new save path. Call before save() when the
   * output path differs from the load path (staged builds).
   *
   * @param {string} newIndexPath - Where save() should write the stub file.
   * @param {object} [options]
   * @param {string} [options.stagingSegmentDir] - Distinct directory to write
   *   segments into during staging. Must NOT collide with the live segments
   *   directory ({finalIndexPath}.segments). Defaults to {newIndexPath}.segments
   *   which is unsafe when the staging stub is adjacent to a live stub — callers
   *   doing stage-and-swap MUST pass an explicit non-colliding path.
   * @param {string} [options.finalIndexPath] - The post-swap location of the
   *   stub file. Used to derive the `segmentDir` basename recorded inside the
   *   stub so that after atomic promotion the stub points at {finalIndexPath}.segments
   *   (resolved relative to the stub's dirname on load).
   */
  resetForSave(newIndexPath, options = {}) {
    this.indexPath = newIndexPath;
    // Discard loaded segment refs — save() will rewrite from this.documents.
    const { stagingSegmentDir = null, finalIndexPath = null } = options;
    // Pre-seed _segmentDir with the staging path so _flushSegment() writes
    // into the staging directory rather than re-deriving it from indexPath
    // (which would collide with a live {indexPath}.segments when the caller
    // uses {live}.tmp as the stub staging path).
    this._segmentDir = stagingSegmentDir;
    this._finalIndexPath = finalIndexPath;
    this._segments = [];
    this._currentSegment = new Map();
    // Reset bounded-build counters for the fresh staged save.
    this._evictedDocs = 0;
    this._evictedTokens = 0;
    if (this._addedIds) this._addedIds.clear();
  }

  /**
   * True if `id` is (or was) a document in this build — checks both the live
   * `documents` map and, in bounded build mode, the lightweight id set that
   * survives segment eviction. Alias-pointer registration uses this to verify
   * an exemplar exists even after its per-token slab has been flushed+evicted.
   */
  hasDoc(id) {
    if (this.documents.has(id)) return true;
    return this._addedIds ? this._addedIds.has(id) : false;
  }

  /**
   * Initialize or load index
   */
  async init() {
    if (this.initialized) return;

    // Ensure WASM MaxSim kernel is ready
    await initWasm();

    if (this.loadExisting && existsSync(this.indexPath)) {
      await this.load();
      this._loadedExisting = true;
      // A POSITIONS-ONLY reader is a WRITER's read view: the incremental delta
      // path uses it to decide which documents to retire and then appends a new
      // segment. `load()` swallows every failure into a console.error, and the
      // maintainer runs detached with `stdio: 'ignore'`, so a segment that
      // fails its CRC would leave the delta running on PARTIAL positions —
      // missing retirements and appending on top of corrupt state, silently.
      // Refuse instead. The search-side (full) reader keeps its existing
      // degrade-to-empty tolerance: that path is the warm query path and must
      // not change behaviour.
      if (this.positionsOnly && this._loadFailure) {
        const err = this._loadFailure;
        this._loadFailure = null;
        throw err;
      }
    }

    this.initialized = true;
  }

  /**
   * Add document with token embeddings
   *
   * @param {string} id - Document ID
   * @param {number[][]} tokenEmbeddings - Array of token embeddings (each token is a vector)
   * @param {Object} metadata - Optional metadata
   */
  async add(id, tokenEmbeddings, metadata = {}) {
    await this.init();

    // Truncate embeddings to tokenDim
    let truncated = tokenEmbeddings.slice(0, this.maxTokens).map(emb =>
      emb.slice(0, this.tokenDim)
    );

    // CRA-6: Capture pre-normalization norms for token importance weighting.
    // The model's preNorms reflect how much each token was "activated" — after L2
    // normalization all norms become ~1, making post-norm weighting a no-op.
    const preNorms = tokenEmbeddings.preNorms
      ? new Float32Array(tokenEmbeddings.preNorms).slice(0, truncated.length)
      : null;

    // Phase 3: Token pruning — drop low-information tokens before pooling.
    if ((this.normPruneThreshold > 0 || this.voronoiPrune) && truncated.length > 1) {
      if (this.voronoiPrune) {
        // CRA-9: Voronoi-guided token importance — tokens with small Voronoi cells
        // (many nearby neighbors) are redundant and safe to prune.
        truncated = voronoiPruneTokens(truncated, this.voronoiKeepRatio);
      } else if (this.normPruneThreshold > 0) {
        // Original norm-based pruning (Phase 3 baseline).
        // Uses pre-normalization norms when available (from the model's L2 normalization
        // step, attached as tokenEmbeddings.preNorms). Pre-norm magnitude measures how much
        // the model "activated" for each token — low pre-norm = low information content.
        const preNorms = tokenEmbeddings.preNorms;
        const kept = [truncated[0]]; // always keep first token (CLS-equivalent)
        for (let t = 1; t < truncated.length; t++) {
          let norm;
          if (preNorms) {
            norm = preNorms[t];
          } else {
            let normSq = 0;
            const v = truncated[t];
            for (let d = 0; d < v.length; d++) normSq += v[d] * v[d];
            norm = Math.sqrt(normSq);
          }
          if (norm >= this.normPruneThreshold) kept.push(truncated[t]);
        }
        truncated = kept;
      }
    }

    // Phase 3: Token pooling — reduce token count by averaging consecutive groups.
    // Only pool here if tokens haven't already been pooled upstream (e.g., by
    // encodeDocuments). The _pooledUpstream flag is set by the indexing pipeline
    // when it calls encodeDocuments with poolFactor > 1. If tokens arrive from
    // an external source without going through encodeDocuments, this pools them.
    if (this.poolFactor > 1 && !metadata._pooledUpstream) {
      truncated = poolTokens(truncated.map(t => t instanceof Float32Array ? t : new Float32Array(t)), this.poolFactor);
    }

    // CRA-8: Matryoshka dimension truncation — keep only first matryoshkaDim dimensions.
    // Applied before rotation (Matryoshka training ensures prefix dimensions are most informative).
    if (this.matryoshkaDim > 0 && this.matryoshkaDim < this.tokenDim) {
      for (let t = 0; t < truncated.length; t++) {
        truncated[t] = new Float32Array(truncated[t]).slice(0, this.matryoshkaDim);
      }
    }

    // Effective dimension for quantization (respects Matryoshka truncation)
    const effectiveDim = (this.matryoshkaDim > 0 && this.matryoshkaDim < this.tokenDim)
      ? this.matryoshkaDim : this.tokenDim;

    // WHT rotation (Phase 2): rotate each token before quantization.
    // Equalizes dimension variance so scalar quantization uses full INT8 range.
    // Lazy-init sign vector (deterministic from whtSeed).
    if (this.whtSeed > 0 && !this._signVector) {
      this._signVector = generateSignVector(effectiveDim, this.whtSeed);
    }

    // CRA-3: Collect samples for WUSH calibration (before rotation)
    if (this.wushCalibrate && this.whtSeed > 0 && !this._wushCalibration) {
      for (let t = 0; t < truncated.length && this._wushSamples.length < this._wushSampleSize; t++) {
        this._wushSamples.push(new Float32Array(truncated[t]));
      }
      // Calibrate once we have enough samples
      if (this._wushSamples.length >= this._wushSampleSize) {
        this._wushCalibration = calibrateWUSH(this._wushSamples, effectiveDim);
        this._wushSamples = []; // free memory
      }
    }

    // Apply rotation in-place before flattening (if WHT enabled)
    if (this.whtSeed > 0) {
      for (let t = 0; t < truncated.length; t++) {
        if (this._wushCalibration) {
          // CRA-3: WUSH calibrated rotation
          truncated[t] = wushRotate(
            new Float32Array(truncated[t]),
            this._wushCalibration.eigenVecs,
            this._wushCalibration.invSqrtEigenVals,
            this._signVector,
          );
        } else {
          truncated[t] = fastRotate(new Float32Array(truncated[t]), this._signVector, this.whtOrdering === 'sequency');
        }
      }
    }

    // Flatten typed arrays into a single contiguous buffer.
    // Use effectiveDim (respects Matryoshka truncation) for stride and quantization.
    const storageDim = effectiveDim;
    const totalElements = truncated.length * storageDim;
    const flat = new Float32Array(totalElements);
    for (let i = 0; i < truncated.length; i++) {
      flat.set(truncated[i], i * storageDim);
    }

    // Pre-compute per-token L2 norms (on rotated vectors — WHT preserves norms).
    const tokenNorms = new Float32Array(truncated.length);
    for (let t = 0; t < truncated.length; t++) {
      const offset = t * storageDim;
      let normSq = 0;
      for (let d = 0; d < storageDim; d++) {
        normSq += flat[offset + d] * flat[offset + d];
      }
      tokenNorms[t] = Math.sqrt(normSq);
    }

    let docEntry;
    if (this.quantBits === 4) {
      // Phase 4: 4-bit nibble-packed quantization (2 values per byte)
      const { data, minArray, scaleArray } = quantizeToInt4PerToken(flat, truncated.length, storageDim);
      docEntry = { tokens: data, numTokens: truncated.length, dim: storageDim, minArray, scaleArray, metadata, tokenNorms, preNorms, quantBits: 4 };
    } else if (this.useInt8) {
      const { data, minArray, scaleArray } = quantizeToInt8PerToken(flat, truncated.length, storageDim);
      docEntry = { tokens: data, numTokens: truncated.length, dim: storageDim, minArray, scaleArray, metadata, tokenNorms, preNorms };
    } else {
      docEntry = { tokens: flat, numTokens: truncated.length, dim: storageDim, metadata, tokenNorms, preNorms };
    }

    this.documents.set(id, docEntry);
    if (docEntry.minArray) this._hasPerTokenQuant = true;
    this._currentSegment.set(id, docEntry);
    if (this._evictMode) this._addedIds.add(id);

    // Flush segment to disk when full — releases memory for completed segments
    if (this._currentSegment.size >= this._segmentSize) {
      await this._flushSegment();
    }
  }

  /**
   * Flush the current segment to disk and release its memory.
   * Documents remain in this.documents for search during indexing.
   */
  async _flushSegment() {
    if (this._currentSegment.size === 0) return;

    if (!this._segmentDir) {
      this._segmentDir = this.indexPath + '.segments';
    }
    // Always ensure the segment directory exists — resetForSave() may have
    // pre-seeded _segmentDir with a staging path that hasn't been created yet.
    await fs.mkdir(this._segmentDir, { recursive: true });

    const segIdx = this._segments.length;
    const segPath = path.join(this._segmentDir, `segment-${String(segIdx).padStart(4, '0')}.bin`);

    await this._writeSegmentFile(segPath, this._currentSegment);
    this._segments.push({ path: segPath, count: this._currentSegment.size });

    // Bounded build mode: drop this segment's per-token slabs from the live
    // documents map now that they're durable on disk. Keeps peak heap O(one
    // segment). The id set + running totals preserve everything later stages
    // need (alias validity via hasDoc(), doc/token counts for save()+stats).
    if (this._evictMode) {
      for (const [id, doc] of this._currentSegment) {
        this.documents.delete(id);
        this._evictedDocs++;
        this._evictedTokens += doc.numTokens || 0;
      }
    }

    // Release segment memory — these docs will be reloaded from segments during load()
    this._currentSegment = new Map();
  }

  /**
   * Write a segment in SSLX v3 fully-binary format.
   *
   * Layout: HEADER (64B) + DOC_TABLE (N*20B) + ID_TABLE + TOKEN_SLAB + FOOTER (4B CRC32)
   */
  async _writeSegmentFile(segPath, segmentMap) {
    const numDocs = segmentMap.size;
    const entries = []; // { id, idBuf, doc } in insertion order
    // Collect entries and compute total sizes.
    // Use each doc's stored dim (may differ from this.tokenDim due to Matryoshka truncation).
    let totalTokenBytes = 0;
    let totalIdBytes = 0;

    for (const [id, doc] of segmentMap) {
      const idBuf = Buffer.from(id, 'utf-8');
      totalIdBytes += 2 + idBuf.length; // u16 len + utf8 bytes
      const numTokens = doc.numTokens;
      const docDim = doc.dim;
      const docBytesPerDim = (doc.quantBits === 4) ? 0.5 : (this.useInt8 ? 1 : 4);
      const tokenPayload = Math.ceil(numTokens * docDim * docBytesPerDim);
      // token data + norms (always) + preNorms (if present) + per-token min/scale (if this doc has them)
      totalTokenBytes += tokenPayload + numTokens * 4; // tokens + norms
      if (doc.preNorms) totalTokenBytes += numTokens * 4; // preNorms (f32)
      if (doc.minArray) totalTokenBytes += numTokens * 8; // min(f32) + scale(f32) per token
      entries.push({ id, idBuf, doc });
    }

    const docTableSize = numDocs * SSLX_DOC_ENTRY_SIZE;
    const idTableSize = 4 + totalIdBytes; // u32 totalIdBytes + per-doc entries
    const totalSize = SSLX_HEADER_SIZE + docTableSize + idTableSize + totalTokenBytes + 4; // +4 for CRC32 footer
    const buf = Buffer.alloc(totalSize);

    // --- HEADER (64 bytes) ---
    buf.writeUInt32LE(SSLX_SEGMENT_MAGIC, 0);       // [0..3]  magic
    buf.writeUInt16LE(SSLX_VERSION, 4);              // [4..5]  version
    // Use the effective storage dim in the header so reload parses slabs correctly.
    // For Matryoshka, this is matryoshkaDim; otherwise tokenDim.
    const headerDim = (this.matryoshkaDim > 0 && this.matryoshkaDim < this.tokenDim)
      ? this.matryoshkaDim : this.tokenDim;
    buf.writeUInt8(this.quantBits, 6);                 // [6]     quantBits (4=int4, 8=int8, 32=float32)
    buf.writeUInt8(headerDim, 7);                      // [7]     tokenDim (effective storage dim)
    buf.writeUInt32LE(numDocs, 8);                    // [8..11] numDocuments
    buf.writeUInt8(this.poolFactor || 1, 12);         // [12]    poolFactor
    // [13..15] reserved
    if (this.modelId) {                               // [16..47] modelId (32B, zero-padded)
      const modelBuf = Buffer.from(this.modelId, 'utf-8');
      modelBuf.copy(buf, 16, 0, Math.min(modelBuf.length, 32));
    }
    buf.writeUInt32LE(this.whtSeed || 0, 48);        // [48..51] whtSeed
    buf.writeUInt8(this.whtOrdering === 'sequency' ? 1 : 0, 52); // [52] whtOrdering: 0=natural, 1=sequency
    // [53..63] reserved (already zero)
    // Note: quantScheme is per-doc (stored in doc table reserved byte), not per-segment.

    // --- DOCUMENT TABLE (numDocs * 20 bytes) ---
    let docTableOffset = SSLX_HEADER_SIZE;
    let tokenSlabCursor = 0; // relative offset within token slab

    for (let i = 0; i < entries.length; i++) {
      const { doc } = entries[i];
      const off = docTableOffset + i * SSLX_DOC_ENTRY_SIZE;

      const isPerToken = !!doc.minArray;
      buf.writeUInt32LE(tokenSlabCursor, off);        // [0..3]  tokenDataOffset
      buf.writeUInt16LE(doc.numTokens, off + 4);       // [4..5]  numTokens
      buf.writeFloatLE(doc.min ?? 0, off + 6);         // [6..9]  min (scalar; 0 for per-token)
      buf.writeFloatLE(doc.scale ?? 0, off + 10);      // [10..13] scale (scalar; 0 for per-token)
      buf.writeUInt8(isPerToken ? 1 : 0, off + 14);    // [14]   quantScheme: 0=per-doc, 1=per-token
      buf.writeUInt8(doc.preNorms ? 1 : 0, off + 15);  // [15]   hasPreNorms: CRA-6 token importance
      // [16..19] reserved

      const docBPD = (doc.quantBits === 4) ? 0.5 : (this.useInt8 ? 1 : 4);
      const tokenPayload = Math.ceil(doc.numTokens * doc.dim * docBPD);
      tokenSlabCursor += tokenPayload + doc.numTokens * 4 // tokens + norms
        + (doc.preNorms ? doc.numTokens * 4 : 0)          // preNorms
        + (isPerToken ? doc.numTokens * 8 : 0);           // min/scale
    }

    // --- ID TABLE ---
    let idOffset = SSLX_HEADER_SIZE + docTableSize;
    buf.writeUInt32LE(totalIdBytes, idOffset);
    idOffset += 4;

    for (const { idBuf } of entries) {
      buf.writeUInt16LE(idBuf.length, idOffset);
      idBuf.copy(buf, idOffset + 2);
      idOffset += 2 + idBuf.length;
    }

    // --- TOKEN SLAB ---
    // Layout per doc: token_data | [minArray | scaleArray] (per-token only) | tokenNorms
    let slabOffset = SSLX_HEADER_SIZE + docTableSize + idTableSize;

    for (const { doc } of entries) {
      // Token data — 4-bit packed or int8/float32
      const slabBPD = (doc.quantBits === 4) ? 0.5 : (this.useInt8 ? 1 : 4);
      const tokenPayload = Math.ceil(doc.numTokens * doc.dim * slabBPD);
      const tokenSrc = Buffer.from(doc.tokens.buffer, doc.tokens.byteOffset, tokenPayload);
      tokenSrc.copy(buf, slabOffset);
      slabOffset += tokenPayload;

      // Per-token min/scale arrays — only for docs that actually have them
      if (doc.minArray) {
        Buffer.from(doc.minArray.buffer, doc.minArray.byteOffset, doc.numTokens * 4).copy(buf, slabOffset);
        slabOffset += doc.numTokens * 4;
        Buffer.from(doc.scaleArray.buffer, doc.scaleArray.byteOffset, doc.numTokens * 4).copy(buf, slabOffset);
        slabOffset += doc.numTokens * 4;
      }

      const norms = doc.tokenNorms || new Float32Array(doc.numTokens);
      const normSrc = Buffer.from(norms.buffer, norms.byteOffset, doc.numTokens * 4);
      normSrc.copy(buf, slabOffset);
      slabOffset += doc.numTokens * 4;

      // CRA-6: preNorms (pre-normalization norms for token importance weighting)
      if (doc.preNorms) {
        Buffer.from(doc.preNorms.buffer, doc.preNorms.byteOffset, doc.numTokens * 4).copy(buf, slabOffset);
        slabOffset += doc.numTokens * 4;
      }
    }

    // --- FOOTER (CRC32) ---
    const checksum = crc32(buf.subarray(0, totalSize - 4));
    buf.writeUInt32LE(checksum, totalSize - 4);

    await fs.writeFile(segPath, buf);
  }

  /**
   * Read a segment file. Auto-detects format by magic:
   *   0x4C495345 ("LISE") → legacy binary-header + JSON body
   *   0x53534C58 ("SSLX") → v3 fully-binary format
   *
   * Returns an array of doc objects for uniform downstream handling.
   */
  async _readSegmentFile(segPath) {
    const buf = await fs.readFile(segPath);
    const magic = buf.readUInt32LE(0);

    if (magic === SSLX_SEGMENT_MAGIC) {
      return this._readSegmentSSLX(buf, segPath);
    }
    if (magic === LI_SEGMENT_MAGIC) {
      const body = buf.subarray(64);
      return JSON.parse(body.toString('utf-8'));
    }
    throw new Error(`Invalid segment file (unknown magic 0x${magic.toString(16)}): ${segPath}`);
  }

  /**
   * Read ONLY the document ids of a segment, in on-disk order.
   *
   * Fast path (segment identity unchanged since its last verified read): three
   * positional reads of the file prefix — header, id-table length, id table.
   * Nothing from the token slab is read or allocated.
   *
   * Slow path (first read, or identity changed, or the prefix fails structural
   * validation): the whole file is read and its CRC32 footer verified exactly as
   * `_readSegmentFile` does, then only the prefix is parsed. Corruption is
   * therefore still caught on the first read after the segment changed — the
   * same read as before this optimisation — and a corrupt segment throws the
   * same error.
   *
   * @param {string} segPath
   * @param {number|null} expectedCount Manifest's document count for this
   *   segment, used as a structural cross-check. Pass null when unknown.
   * @returns {Promise<string[]>}
   */
  async _readSegmentIds(segPath, expectedCount = null) {
    const cache = this._positionsCache;
    const before = cache ? segmentIdentity(segPath) : null;

    if (before && cache.get(segPath) === before.key) {
      const ids = await this._readSslxIdsPrefix(segPath, before, expectedCount);
      if (ids) return ids;
      // Structurally suspect despite an unchanged identity, or the file moved
      // under us between the stat and the open: never trust it — drop the entry
      // and fall through to the full verified read.
      cache.delete(segPath);
    }

    let ids;
    try {
      ids = await this._readSegmentIdsVerified(segPath, expectedCount);
    } catch (err) {
      // A failed verification never leaves a remembered identity behind.
      cache?.delete(segPath);
      throw err;
    }
    if (cache) {
      // Re-stat AFTER the read: only cache an identity the read actually
      // observed, so a write racing between stat and read cannot be recorded as
      // verified.
      const after = segmentIdentity(segPath);
      if (after && before && after.key === before.key) cache.set(segPath, after.key);
      else cache.delete(segPath);
    }
    return ids;
  }

  /**
   * Prefix-only id read. Returns null (never throws) when anything about the
   * prefix fails validation, so the caller can escalate to the verified read.
   *
   * TOCTOU: the identity that authorises this trusted read was observed by a
   * `stat` BEFORE the `open`. Per-segment maintenance replaces a segment under
   * the same path, so the bytes can change in between. An `fstat` on the open
   * descriptor closes that window — if the identity moved, the CRC that
   * authorised this read no longer covers these bytes, so we refuse and let the
   * caller do the full verified read.
   *
   * @param {string} segPath
   * @param {{key:string, size:number}} identity Identity captured before open.
   * @param {number|null} expectedCount Manifest's document count, cross-checked.
   */
  async _readSslxIdsPrefix(segPath, identity, expectedCount) {
    const fileSize = identity.size;
    let fh = null;
    try {
      fh = await fs.open(segPath, 'r');
      const opened = await fh.stat({ bigint: true });
      if (`${opened.ino}:${opened.size}:${opened.mtimeNs}:${opened.ctimeNs}` !== identity.key) return null;
      const header = Buffer.allocUnsafe(SSLX_HEADER_SIZE);
      if ((await fh.read(header, 0, SSLX_HEADER_SIZE, 0)).bytesRead !== SSLX_HEADER_SIZE) return null;
      const layout = sslxPrefixLayout(header, fileSize);
      if (!layout) return null;
      if (Number.isInteger(expectedCount) && expectedCount !== layout.numDocs) return null;

      const lenBuf = Buffer.allocUnsafe(4);
      if ((await fh.read(lenBuf, 0, 4, layout.idTableStart)).bytesRead !== 4) return null;
      const totalIdBytes = lenBuf.readUInt32LE(0);
      const idStart = layout.idTableStart + 4;
      // slabStart must sit inside the file, ahead of the 4-byte CRC footer.
      const slabStart = idStart + totalIdBytes;
      if (!Number.isSafeInteger(slabStart) || slabStart + 4 > fileSize) return null;

      const idTable = Buffer.allocUnsafe(totalIdBytes);
      if (totalIdBytes > 0
        && (await fh.read(idTable, 0, totalIdBytes, idStart)).bytesRead !== totalIdBytes) return null;
      return parseSslxIdTable(idTable, layout.numDocs);
    } catch {
      return null;
    } finally {
      if (fh) await fh.close().catch(() => {});
    }
  }

  /**
   * Whole-file read with CRC32 verification, returning only the ids. Same
   * detection and same error messages as `_readSegmentFile`; it simply stops
   * before decoding the token slab.
   *
   * `expectedCount` is the manifest's count for this segment. A valid CRC only
   * proves the FILE is self-consistent; it says nothing about whether the
   * manifest agrees with it. A disagreement means the two artifacts describe
   * different states, which is exactly the condition under which
   * `_docSegmentPositions` and `manifest.totalDocuments` diverge — so it is an
   * error here, not something to accept silently.
   */
  async _readSegmentIdsVerified(segPath, expectedCount = null) {
    const buf = await fs.readFile(segPath);
    const magic = buf.readUInt32LE(0);
    const checkCount = (ids) => {
      if (Number.isInteger(expectedCount) && ids.length !== expectedCount) {
        throw new Error(`Segment document count mismatch in ${segPath}: manifest=${expectedCount} segment=${ids.length}`);
      }
      return ids;
    };

    if (magic === SSLX_SEGMENT_MAGIC) {
      const storedCrc = buf.readUInt32LE(buf.length - 4);
      const computedCrc = crc32(buf.subarray(0, buf.length - 4));
      if (storedCrc !== computedCrc) {
        throw new Error(`CRC32 mismatch in ${segPath}: stored=0x${storedCrc.toString(16)} computed=0x${computedCrc.toString(16)}`);
      }
      const layout = sslxPrefixLayout(buf, buf.length);
      if (!layout) throw new Error(`Invalid SSLX segment header in ${segPath}`);
      const totalIdBytes = buf.readUInt32LE(layout.idTableStart);
      const idStart = layout.idTableStart + 4;
      if (idStart + totalIdBytes + 4 > buf.length) {
        throw new Error(`Invalid SSLX id table in ${segPath}: table overruns the file`);
      }
      const ids = parseSslxIdTable(buf.subarray(idStart, idStart + totalIdBytes), layout.numDocs);
      if (!ids) throw new Error(`Invalid SSLX id table in ${segPath}: entry overruns the table`);
      return checkCount(ids);
    }
    if (magic === LI_SEGMENT_MAGIC) {
      // Legacy LISE segments are a JSON body with no prefix and no checksum;
      // there is nothing cheaper to read than the whole document array.
      const docs = JSON.parse(buf.subarray(64).toString('utf-8'));
      return checkCount(docs.map((doc) => doc.id));
    }
    throw new Error(`Invalid segment file (unknown magic 0x${magic.toString(16)}): ${segPath}`);
  }

  /**
   * Parse an SSLX v3 fully-binary segment buffer.
   * Returns array of { id, tokens (Int8Array/Float32Array), numTokens, dim, min, scale, tokenNorms }.
   */
  _readSegmentSSLX(buf, segPath) {
    // Validate CRC32
    const storedCrc = buf.readUInt32LE(buf.length - 4);
    const computedCrc = crc32(buf.subarray(0, buf.length - 4));
    if (storedCrc !== computedCrc) {
      throw new Error(`CRC32 mismatch in ${segPath}: stored=0x${storedCrc.toString(16)} computed=0x${computedCrc.toString(16)}`);
    }

    // --- HEADER ---
    const quantBits = buf.readUInt8(6);
    const tokenDim = buf.readUInt8(7);
    const numDocs = buf.readUInt32LE(8);
    const is4bit = quantBits === 4;
    const isInt8 = quantBits === 8;
    const isQuantized = is4bit || isInt8;
    const bytesPerDim = is4bit ? 0.5 : (isInt8 ? 1 : 4);

    // --- DOCUMENT TABLE ---
    const docTableStart = SSLX_HEADER_SIZE;
    const docEntries = [];
    for (let i = 0; i < numDocs; i++) {
      const off = docTableStart + i * SSLX_DOC_ENTRY_SIZE;
      docEntries.push({
        tokenDataOffset: buf.readUInt32LE(off),
        numTokens: buf.readUInt16LE(off + 4),
        min: buf.readFloatLE(off + 6),
        scale: buf.readFloatLE(off + 10),
        isPerToken: buf.readUInt8(off + 14) === 1,
        hasPreNorms: buf.readUInt8(off + 15) === 1,
      });
    }

    // --- ID TABLE ---
    let idOffset = docTableStart + numDocs * SSLX_DOC_ENTRY_SIZE;
    const totalIdBytes = buf.readUInt32LE(idOffset);
    idOffset += 4;

    const ids = [];
    for (let i = 0; i < numDocs; i++) {
      const idLen = buf.readUInt16LE(idOffset);
      const id = buf.toString('utf-8', idOffset + 2, idOffset + 2 + idLen);
      ids.push(id);
      idOffset += 2 + idLen;
    }

    // --- TOKEN SLAB ---
    // Layout per doc: token_data | [minArray | scaleArray] (per-token only) | tokenNorms
    const slabStart = docTableStart + numDocs * SSLX_DOC_ENTRY_SIZE + 4 + totalIdBytes;
    const docs = [];

    for (let i = 0; i < numDocs; i++) {
      const { tokenDataOffset, numTokens, min, scale, isPerToken, hasPreNorms } = docEntries[i];
      const absOffset = slabStart + tokenDataOffset;
      // 4-bit: ceil(tokenDim/2) bytes per token; 8-bit: tokenDim; float32: tokenDim*4
      const tokenPayload = Math.ceil(numTokens * tokenDim * bytesPerDim);
      let cursor = absOffset;

      // Alignment-safe copy: create fresh ArrayBuffer (always aligned) and
      // copy raw bytes from the file buffer. This avoids RangeError when the
      // slab start isn't 4-byte-aligned (ID table has variable length).
      let tokens;
      {
        const ab = new ArrayBuffer(tokenPayload);
        new Uint8Array(ab).set(buf.subarray(cursor, cursor + tokenPayload));
        tokens = is4bit ? new Uint8Array(ab) : (isInt8 ? new Int8Array(ab) : new Float32Array(ab));
      }
      cursor += tokenPayload;

      // Per-token min/scale arrays (only for docs flagged as per-token)
      let minArray, scaleArray;
      if (isPerToken) {
        const minAb = new ArrayBuffer(numTokens * 4);
        new Uint8Array(minAb).set(buf.subarray(cursor, cursor + numTokens * 4));
        minArray = new Float32Array(minAb);
        cursor += numTokens * 4;

        const scaleAb = new ArrayBuffer(numTokens * 4);
        new Uint8Array(scaleAb).set(buf.subarray(cursor, cursor + numTokens * 4));
        scaleArray = new Float32Array(scaleAb);
        cursor += numTokens * 4;
      }

      // Per-token norms (f32)
      const normAb = new ArrayBuffer(numTokens * 4);
      new Uint8Array(normAb).set(buf.subarray(cursor, cursor + numTokens * 4));
      const tokenNorms = new Float32Array(normAb);
      cursor += numTokens * 4;

      // CRA-6: Pre-normalization norms for token importance weighting
      let preNorms = null;
      if (hasPreNorms) {
        const preNormAb = new ArrayBuffer(numTokens * 4);
        new Uint8Array(preNormAb).set(buf.subarray(cursor, cursor + numTokens * 4));
        preNorms = new Float32Array(preNormAb);
        cursor += numTokens * 4;
      }

      const doc = {
        id: ids[i],
        tokens,
        numTokens,
        dim: tokenDim,
        tokenNorms,
      };
      if (preNorms) doc.preNorms = preNorms;
      if (is4bit) doc.quantBits = 4;

      if (isPerToken) {
        doc.minArray = minArray;
        doc.scaleArray = scaleArray;
      } else {
        doc.min = min;
        doc.scale = scale;
      }

      docs.push(doc);
    }

    return docs;
  }

  /**
   * Get token embeddings for a document
   */
  /**
   * Record an alias pointer for a chunk that shares an exemplar's per-token
   * matrix. MaxSim scoring dereferences `exemplarId` on every lookup, so no
   * embedding work happens for aliases.
   */
  addAlias(id, exemplarId, clusterId, metadata = {}) {
    this.aliasPointers.set(id, { exemplarId, clusterId, metadata });
  }

  _resolveForRead(id) {
    const ptr = this.aliasPointers.get(id);
    if (ptr) return ptr.exemplarId;
    return id;
  }

  _aliasSidecarPath(indexPath = this.indexPath) {
    return indexPath + '.aliases.json';
  }

  async _saveAliasSidecar(indexPath = this.indexPath) {
    const sidecarPath = this._aliasSidecarPath(indexPath);
    if (this.aliasPointers.size === 0) {
      // Remove any stale sidecar from a previous build.
      try { await fs.unlink(sidecarPath); } catch (_e) { /* not present */ }
      return;
    }
    // NDJSON (version 2): one header line, then one alias pointer per line,
    // flushed through a write stream in bounded batches. The previous
    // monolithic JSON.stringify of the whole payload hits V8's ~512 MB string
    // ceiling ("Invalid string length") on extreme-dedup repos, and the
    // matching readFile on load had the same ceiling.
    const ws = createWriteStream(sidecarPath, { encoding: 'utf8' });
    const finished = new Promise((resolve, reject) => {
      ws.on('error', reject);
      ws.on('finish', resolve);
    });
    const flush = (str) => new Promise((resolve, reject) => {
      ws.write(str, (err) => (err ? reject(err) : resolve()));
    });
    try {
      let lines = [JSON.stringify({ version: 2, count: this.aliasPointers.size })];
      for (const [aliasId, ptr] of this.aliasPointers) {
        lines.push(JSON.stringify({
          aliasId,
          exemplarId: ptr.exemplarId,
          clusterId: ptr.clusterId,
          metadata: ptr.metadata || {},
        }));
        if (lines.length >= 20000) {
          await flush(lines.join('\n') + '\n');
          lines = [];
        }
      }
      if (lines.length > 0) await flush(lines.join('\n') + '\n');
      ws.end();
      await finished;
    } catch (err) {
      finished.catch(() => { /* surfaced via throw below */ });
      ws.destroy();
      throw err;
    }
  }

  async _loadAliasSidecar(indexPath = this.indexPath) {
    const p = this._aliasSidecarPath(indexPath);
    if (!existsSync(p)) return;
    // Streamed line-by-line so no single string approaches V8's ~512 MB
    // ceiling. Two on-disk formats:
    //   v1 — one JSON.stringify'd { version: 1, aliases: [...] } line
    //   v2 — NDJSON: { version: 2, count } header, then one alias per line
    //
    // The input stream is destroyed in `finally`: early returns abandon the
    // readline iterator, and rl.close() does NOT destroy its input — an
    // fs read stream only auto-closes on 'end'/'error', so without the
    // explicit destroy every early return leaks an fd (fatal only in
    // long-lived processes like the daemon, but a leak everywhere).
    const input = createReadStream(p, { encoding: 'utf8' });
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    try {
      this.aliasPointers.clear();
      let first = true;
      let expected = 0;
      let parsed = 0;
      for await (const line of rl) {
        if (!line) continue;
        if (first) {
          first = false;
          const head = JSON.parse(line);
          if (head && Array.isArray(head.aliases)) {
            // v1 monolithic payload — the whole sidecar is this one line,
            // so JSON.parse succeeding IS the integrity check (any
            // truncation makes it unparseable).
            for (const { aliasId, exemplarId, clusterId, metadata } of head.aliases) {
              if (!this.documents.has(exemplarId)) continue; // orphan guard, see below
              this.aliasPointers.set(aliasId, { exemplarId, clusterId, metadata: metadata || {} });
            }
            return;
          }
          if (!head || head.version !== 2 || !Number.isFinite(head.count)) return;
          expected = head.count;
          continue;
        }
        const { aliasId, exemplarId, clusterId, metadata } = JSON.parse(line);
        parsed++;
        // Orphan guard: drop aliases whose exemplar is no longer in documents.
        // Happens if the file containing the exemplar was removed between
        // save and load (incremental re-index removed the exemplar file
        // but did not re-run dedup over the alias files).
        if (!this.documents.has(exemplarId)) continue;
        this.aliasPointers.set(aliasId, { exemplarId, clusterId, metadata: metadata || {} });
      }
      // Truncation guard: NDJSON has no whole-file parse to fail, so a file
      // cut exactly at a line boundary (crash mid-save, disk full) is valid
      // prefix NDJSON and would otherwise load a silent subset. The header's
      // `count` restores v1's all-or-nothing semantics. Compared against
      // PARSED lines, not kept aliases — the orphan guard intentionally
      // drops entries and must not trip this.
      if (parsed !== expected) {
        this.aliasPointers.clear();
      }
    } catch (_e) {
      // Malformed sidecar — treat as absent; aliases will be skipped at query time.
      this.aliasPointers.clear();
    } finally {
      rl.close();
      input.destroy();
    }
  }

  getTokens(id) {
    const resolved = this._resolveForRead(id);
    if (this.isDocumentTombstoned(resolved)) return null;
    const doc = this.documents.get(resolved);
    if (!doc) return null;

    let tokens;
    if (doc.quantBits === 4 && doc.minArray) {
      // Phase 4: 4-bit nibble-packed dequantize
      tokens = dequantizeFromInt4PerToken(doc.tokens, doc.minArray, doc.scaleArray, doc.numTokens, doc.dim);
    } else if (this.useInt8 && doc.minArray) {
      // Per-token dequantize (Phase 1)
      tokens = this._dequantPerToken(doc);
    } else if (this.useInt8 && doc.min !== undefined) {
      // Per-document dequantize (legacy)
      tokens = dequantizeFromInt8(doc.tokens, doc.min, doc.scale);
    } else {
      tokens = doc.tokens;
    }

    // Reshape into array of vectors
    const result = [];
    for (let i = 0; i < doc.numTokens; i++) {
      result.push(Array.from(tokens.slice(i * doc.dim, (i + 1) * doc.dim)));
    }

    return result;
  }

  /**
   * Get dequantized tokens as a flat Float32Array + metadata.
   * Avoids the expensive reshape step (creating N sub-arrays).
   * Used by the optimized scoreWithLateInteraction path.
   *
   * @param {string} id
   * @returns {{ flat: Float32Array, numTokens: number, dim: number } | null}
   */
  getTokensFlat(id) {
    const resolved = this._resolveForRead(id);
    if (this.isDocumentTombstoned(resolved)) return null;
    const doc = this.documents.get(resolved);
    if (!doc) return null;

    let flat;
    if (doc.quantBits === 4 && doc.minArray) {
      const floatSize = doc.numTokens * doc.dim;
      if (!this._dequantBuf || this._dequantBuf.length < floatSize) {
        this._dequantBuf = new Float32Array(floatSize);
      }
      dequantInt4ToBuffer(doc.tokens, doc.minArray, doc.scaleArray, doc.numTokens, doc.dim, this._dequantBuf);
      flat = this._dequantBuf;
    } else if (this.useInt8 && doc.minArray) {
      // Per-token dequantize (Phase 1) — pooled buffer
      const size = doc.tokens.length;
      if (!this._dequantBuf || this._dequantBuf.length < size) {
        this._dequantBuf = new Float32Array(size);
      }
      const buf = this._dequantBuf;
      const dim = doc.dim;
      for (let t = 0; t < doc.numTokens; t++) {
        const off = t * dim;
        const tMin = doc.minArray[t];
        const tScale = doc.scaleArray[t];
        if (tScale === 0) {
          for (let d = 0; d < dim; d++) buf[off + d] = tMin;
        } else {
          for (let d = 0; d < dim; d++) {
            buf[off + d] = (doc.tokens[off + d] + 128) * tScale + tMin;
          }
        }
      }
      flat = buf;
    } else if (this.useInt8 && doc.min !== undefined) {
      // Per-document dequantize (legacy) — pooled buffer
      const size = doc.tokens.length;
      if (!this._dequantBuf || this._dequantBuf.length < size) {
        this._dequantBuf = new Float32Array(size);
      }
      const buf = this._dequantBuf;
      const { min, scale } = doc;
      if (scale === 0) {
        buf.fill(min);
      } else {
        for (let i = 0; i < size; i++) {
          buf[i] = (doc.tokens[i] + 128) * scale + min;
        }
      }
      // SAFETY: Pooled buffer — caller MUST consume or copy contents before the
      // next getTokensFlat() call, which overwrites this buffer. The native batch
      // path (maxsim_batch) does not call getTokensFlat, so no aliasing risk there.
      flat = buf;
    } else {
      flat = doc.tokens instanceof Float32Array ? doc.tokens : new Float32Array(doc.tokens);
    }

    return { flat, numTokens: doc.numTokens, dim: doc.dim };
  }

  /**
   * Dequantize per-token int8 data to float32.
   * @private
   */
  _dequantPerToken(doc) {
    const float = new Float32Array(doc.tokens.length);
    const dim = doc.dim;
    for (let t = 0; t < doc.numTokens; t++) {
      const off = t * dim;
      const tMin = doc.minArray[t];
      const tScale = doc.scaleArray[t];
      if (tScale === 0) {
        for (let d = 0; d < dim; d++) float[off + d] = tMin;
      } else {
        for (let d = 0; d < dim; d++) {
          float[off + d] = (doc.tokens[off + d] + 128) * tScale + tMin;
        }
      }
    }
    return float;
  }

  /**
   * Prune low-value query tokens before MaxSim scoring.
   *
   * Strategies:
   * - normThreshold: drop tokens with L2 norm below this value (low-information tokens)
   * - maxQueryTokens: hard cap on query token count (keep highest-norm tokens)
   *
   * @param {number[][]} queryTokens
   * @param {Object} [options]
   * @param {number} [options.normThreshold=0] - Min L2 norm to keep a token
   * @param {number} [options.maxQueryTokens=0] - Max tokens (0 = unlimited)
   * @returns {number[][]} Pruned query tokens
   */
  pruneQueryTokens(queryTokens, options = {}) {
    const { normThreshold = 0, maxQueryTokens = 0 } = options;

    if (!normThreshold && !maxQueryTokens) return queryTokens;

    const withNorms = queryTokens.map(token => ({ token, norm: l2Norm(token) }));

    let filtered = normThreshold > 0
      ? withNorms.filter(t => t.norm >= normThreshold)
      : withNorms;

    // Ensure at least 1 token survives pruning
    if (filtered.length === 0) filtered = [withNorms[0]];

    // Apply budget cap (keep highest-norm tokens)
    if (maxQueryTokens > 0 && filtered.length > maxQueryTokens) {
      filtered.sort((a, b) => b.norm - a.norm);
      filtered = filtered.slice(0, maxQueryTokens);
    }

    return filtered.map(t => t.token);
  }

  /**
   * Subsample document tokens by stride to fit within a budget.
   * Keeps the first token (CLS-equivalent) plus evenly-spaced tokens.
   *
   * @param {number[][]} docTokens
   * @param {number} maxDocTokens - Budget (0 = unlimited)
   * @returns {number[][]}
   */
  subsampleDocTokens(docTokens, maxDocTokens) {
    if (!maxDocTokens || docTokens.length <= maxDocTokens) return docTokens;

    const result = [docTokens[0]]; // Keep first token (CLS/special)
    const remaining = maxDocTokens - 1;
    const stride = (docTokens.length - 1) / remaining;

    for (let i = 0; i < remaining; i++) {
      const idx = 1 + Math.round(i * stride);
      if (idx < docTokens.length) result.push(docTokens[idx]);
    }

    return result;
  }

  /**
   * MaxSim scoring - late interaction (optimized)
   *
   * For each query token, find max similarity with any document token.
   * Sum these max similarities for final score.
   * Pre-computed norms avoid recomputing per pair (3x fewer FLOPs).
   *
   * @param {number[][]} queryTokens
   * @param {number[][]} docTokens
   * @param {Object} [options] - Pruning options
   * @param {number} [options.maxQueryTokens] - Query token budget
   * @param {number} [options.normThreshold] - Min query token norm
   * @param {number} [options.maxDocTokens] - Document token budget (stride subsample)
   */
  maxSimScore(queryTokens, docTokens, options) {
    if (!docTokens || docTokens.length === 0) return 0;

    const effectiveQuery = (options && (options.maxQueryTokens || options.normThreshold))
      ? this.pruneQueryTokens(queryTokens, options)
      : queryTokens;

    const effectiveDocs = (options && options.maxDocTokens)
      ? this.subsampleDocTokens(docTokens, options.maxDocTokens)
      : docTokens;

    const qNorms = new Float32Array(effectiveQuery.length);
    for (let qi = 0; qi < effectiveQuery.length; qi++) {
      qNorms[qi] = l2Norm(effectiveQuery[qi]);
    }

    const dNorms = new Float32Array(effectiveDocs.length);
    for (let di = 0; di < effectiveDocs.length; di++) {
      dNorms[di] = l2Norm(effectiveDocs[di]);
    }

    let totalScore = 0;

    for (let qi = 0; qi < effectiveQuery.length; qi++) {
      const queryToken = effectiveQuery[qi];
      const qNorm = qNorms[qi];
      let maxSim = -Infinity;

      for (let di = 0; di < effectiveDocs.length; di++) {
        const sim = cosineSimilarityFast(queryToken, effectiveDocs[di], qNorm, dNorms[di]);
        if (sim > maxSim) maxSim = sim;
      }

      totalScore += Math.max(0, maxSim);
    }

    return totalScore / effectiveQuery.length;
  }

  _loadSegmentStaleBitmap(segmentPath) {
    // Per-query memo: scoreWithLateInteraction checks the same segment 2-3×
    // per candidate, and each uncached check costs a statSync. Within one
    // scoring pass a single freshness check per segment is equivalent — a
    // tombstone landing mid-pass races identically either way.
    const memo = this._staleQueryMemo;
    if (memo) {
      if (memo.has(segmentPath)) return memo.get(segmentPath);
      const bitmap = this._loadSegmentStaleBitmapUncached(segmentPath);
      memo.set(segmentPath, bitmap);
      return bitmap;
    }
    return this._loadSegmentStaleBitmapUncached(segmentPath);
  }

  _loadSegmentStaleBitmapUncached(segmentPath) {
    const sidecarPath = segmentPath + '.stale.bin';
    let stat;
    try {
      stat = statSync(sidecarPath, { bigint: true });
    } catch {
      this._staleBitmapCache.delete(segmentPath);
      return null;
    }
    const statKey = `${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}`;

    const cached = this._staleBitmapCache.get(segmentPath);
    if (cached && cached.statKey === statKey) {
      return cached.bitmap;
    }

    try {
      const bitmap = loadBitmap(sidecarPath);
      this._staleBitmapCache.set(segmentPath, {
        statKey,
        bitmap,
      });
      return bitmap;
    } catch (err) {
      if (process.env.SWEET_DEBUG) {
        console.debug(`[LateInteraction] ignoring unreadable stale bitmap ${sidecarPath}: ${err.message}`);
      }
      this._staleBitmapCache.set(segmentPath, {
        statKey,
        bitmap: null,
      });
      return null;
    }
  }

  isDocumentTombstoned(docId) {
    if (!docId) return false;
    const position = this._docSegmentPositions.get(docId);
    if (!position) return false;
    const bitmap = this._loadSegmentStaleBitmap(position.segmentPath);
    return bitmap ? isSet(bitmap, position.docIndex) : false;
  }

  /**
   * MaxSim scoring from flat buffers (avoids reshape/sub-array creation).
   *
   * Operates directly on a contiguous Float32Array with offset indexing.
   * Saves the cost of creating numTokens sub-arrays per candidate.
   *
   * @param {number[][]} queryTokens - Array of query token vectors
   * @param {Float32Array} docFlat - Flat buffer of dequantized doc tokens
   * @param {number} numDocTokens - Number of document tokens
   * @param {number} dim - Token dimension
   * @param {Float32Array} [docTokenNorms] - Pre-computed norms (from add-time)
   * @returns {number} MaxSim score
   */
  maxSimScoreFlat(queryTokens, docFlat, numDocTokens, dim, docTokenNorms, precomputedQueryFlat, preNorms) {
    if (!docFlat || numDocTokens === 0) return 0;

    // Try WASM kernel first — pass pre-flattened query if available
    // Skip WASM when token weighting is active (WASM doesn't support weights)
    if (!this.useTokenWeights) {
      const queryFlat = precomputedQueryFlat || this._flattenQueryTokens(queryTokens, dim);
      const wasmScore = wasmMaxSimF32(queryFlat, docFlat, queryTokens.length, numDocTokens, dim);
      if (wasmScore !== null) return wasmScore;
    }

    // CRA-6: Pre-compute softmax token weights from pre-normalization norms.
    // preNorms reflect how much the model "activated" for each token before L2
    // normalization. Post-norm norms are all ~1, making weighting meaningless.
    let tokenWeights = null;
    const weightSource = preNorms || null;
    if (this.useTokenWeights && weightSource && numDocTokens > 1) {
      tokenWeights = new Float32Array(numDocTokens);
      let maxNorm = -Infinity;
      for (let di = 0; di < numDocTokens; di++) {
        if (weightSource[di] > maxNorm) maxNorm = weightSource[di];
      }
      let expSum = 0;
      for (let di = 0; di < numDocTokens; di++) {
        tokenWeights[di] = Math.exp(weightSource[di] - maxNorm);
        expSum += tokenWeights[di];
      }
      const scale = numDocTokens / expSum;
      for (let di = 0; di < numDocTokens; di++) tokenWeights[di] *= scale;
    }

    // JS fallback
    let totalScore = 0;

    for (let qi = 0; qi < queryTokens.length; qi++) {
      const qVec = queryTokens[qi];

      // Compute query norm once
      let qNormSq = 0;
      for (let k = 0; k < dim; k++) qNormSq += qVec[k] * qVec[k];
      const qNorm = Math.sqrt(qNormSq);

      let maxSim = -Infinity;

      for (let di = 0; di < numDocTokens; di++) {
        const offset = di * dim;

        // Dot product with offset indexing (no sub-array creation)
        let dot = 0;
        for (let k = 0; k < dim; k++) {
          dot += qVec[k] * docFlat[offset + k];
        }

        // Use pre-computed doc norm if available, else compute
        let dNorm;
        if (docTokenNorms) {
          dNorm = docTokenNorms[di];
        } else {
          let dNormSq = 0;
          for (let k = 0; k < dim; k++) {
            const v = docFlat[offset + k];
            dNormSq += v * v;
          }
          dNorm = Math.sqrt(dNormSq);
        }

        let sim = dot / (qNorm * dNorm + 1e-8);
        // CRA-6: Apply token importance weight
        if (tokenWeights) sim *= tokenWeights[di];
        if (sim > maxSim) maxSim = sim;
      }

      if (maxSim > 0) totalScore += maxSim;
    }

    return totalScore / queryTokens.length;
  }

  /**
   * Flatten query token arrays into a contiguous Float32Array (reuses pooled buffer).
   * @private
   */
  _flattenQueryTokens(queryTokens, dim) {
    const numQ = queryTokens.length;
    if (!this._queryFlatBuf || this._queryFlatBuf.length < numQ * dim) {
      this._queryFlatBuf = new Float32Array(numQ * dim);
    }
    for (let qi = 0; qi < numQ; qi++) {
      const q = queryTokens[qi];
      const off = qi * dim;
      for (let k = 0; k < dim; k++) this._queryFlatBuf[off + k] = q[k];
    }
    return this._queryFlatBuf;
  }

  /**
   * CRA-5: Implicit decompression 4-bit MaxSim scorer.
   * Scores directly from nibble-packed data without materializing float32 arrays.
   *
   * For each (query_token, doc_token) pair, uses a 16-entry LUT built from the
   * doc token's min/scale. The LUT maps bucket index → partial dot product
   * contribution. This eliminates the dequant allocation entirely.
   * @private
   */
  _maxSimScore4BitImplicit(queryTokens, doc, precomputedQueryFlat) {
    const { tokens: packed, minArray, scaleArray, tokenNorms, numTokens, dim, preNorms } = doc;
    if (numTokens === 0) return 0;

    // CRA-6: Pre-compute token importance weights from pre-normalization norms.
    let tokenWeights = null;
    const weightSource = preNorms || null;
    if (this.useTokenWeights && weightSource && numTokens > 1) {
      tokenWeights = new Float32Array(numTokens);
      let maxNorm = -Infinity;
      for (let di = 0; di < numTokens; di++) {
        if (weightSource[di] > maxNorm) maxNorm = weightSource[di];
      }
      let expSum = 0;
      for (let di = 0; di < numTokens; di++) {
        tokenWeights[di] = Math.exp(weightSource[di] - maxNorm);
        expSum += tokenWeights[di];
      }
      const scale = numTokens / expSum;
      for (let di = 0; di < numTokens; di++) tokenWeights[di] *= scale;
    }

    const packedSize = Math.ceil(dim / 2);
    const numQ = queryTokens.length;
    let totalScore = 0;

    for (let qi = 0; qi < numQ; qi++) {
      const qVec = queryTokens[qi];

      let qNormSq = 0;
      for (let k = 0; k < dim; k++) qNormSq += qVec[k] * qVec[k];
      const qNorm = Math.sqrt(qNormSq);

      let maxSim = -Infinity;

      for (let di = 0; di < numTokens; di++) {
        const tMin = minArray[di];
        const tScale = scaleArray[di];
        const dNorm = tokenNorms[di];
        const pOff = di * packedSize;

        let dot = 0;
        for (let d = 0; d < dim; d += 2) {
          const byte = packed[pOff + (d >> 1)];
          const bucket0 = byte & 0x0F;
          dot += qVec[d] * (tMin + bucket0 * tScale);

          if (d + 1 < dim) {
            const bucket1 = (byte >>> 4) & 0x0F;
            dot += qVec[d + 1] * (tMin + bucket1 * tScale);
          }
        }

        let sim = dot / (qNorm * dNorm + 1e-8);
        if (tokenWeights) sim *= tokenWeights[di];
        if (sim > maxSim) maxSim = sim;
      }

      if (maxSim > 0) totalScore += maxSim;
    }

    return totalScore / numQ;
  }

  /**
   * Score candidates using MaxSim late interaction
   *
   * @param {number[][]} queryTokenEmbeddings - Query token embeddings
   * @param {Array} candidates - Array of { id, ... } candidates
   * @param {Object} [options] - Scoring options
   * @param {number} [options.maxCandidates] - Max candidates to score with MaxSim (rest keep original score)
   * @param {number} [options.maxQueryTokens] - Budget cap on query tokens (keep highest-norm tokens)
   * @param {number} [options.normThreshold] - Min L2 norm for query tokens
   * @param {number} [options.maxDocTokens] - Budget cap on doc tokens per candidate (stride subsample)
   * @returns {Array} Candidates with lateInteractionScore added
   */
  async scoreWithLateInteraction(queryTokenEmbeddings, candidates, options = {}) {
    await this.init();

    const { maxCandidates, maxQueryTokens, normThreshold, maxDocTokens } = options;

    // P1-fix: Truncate query tokens to the effective storage dimension.
    // When matryoshkaDim is active, docs are stored at matryoshkaDim width, so queries
    // must match to avoid comparing vectors in different-dimensional spaces.
    const scoringDim = (this.matryoshkaDim > 0 && this.matryoshkaDim < this.tokenDim)
      ? this.matryoshkaDim : this.tokenDim;

    let queryTokens = queryTokenEmbeddings.map(emb =>
      emb.slice(0, scoringDim)
    );

    // WHT rotation (Phase 2): rotate query tokens once (amortized across all candidates).
    // Required when index was built with whtSeed > 0 — scoring must happen in rotated space.
    if (this.whtSeed > 0) {
      if (!this._signVector) {
        this._signVector = generateSignVector(scoringDim, this.whtSeed);
      }
      if (this._wushCalibration) {
        // CRA-3: WUSH calibrated rotation for queries
        queryTokens = queryTokens.map(q => wushRotate(
          new Float32Array(q),
          this._wushCalibration.eigenVecs,
          this._wushCalibration.invSqrtEigenVals,
          this._signVector,
        ));
      } else {
        queryTokens = queryTokens.map(q => fastRotate(new Float32Array(q), this._signVector, this.whtOrdering === 'sequency'));
      }
    }

    // Pruning options (passed through to maxSimScore)
    const pruneOpts = (maxQueryTokens || normThreshold || maxDocTokens)
      ? { maxQueryTokens, normThreshold, maxDocTokens }
      : undefined;

    // Candidate pruning: pre-sort by initial score, only MaxSim-score the top N
    let toScore = candidates;
    let pruned = [];
    if (maxCandidates && candidates.length > maxCandidates) {
      const sorted = [...candidates].sort((a, b) => (b.score || 0) - (a.score || 0));
      toScore = sorted.slice(0, maxCandidates);
      pruned = sorted.slice(maxCandidates);
    }

    // Apply query token pruning once (shared across all candidates)
    const effectiveQueryTokens = (maxQueryTokens || normThreshold)
      ? this.pruneQueryTokens(queryTokens, { maxQueryTokens, normThreshold })
      : queryTokens;

    const scored = [];
    const pushScored = (c, score) => scored.push({ ...c, lateInteractionScore: score, originalScore: c.score });
    const pushFallback = (c, extra) => scored.push({ ...c, lateInteractionScore: c.score || 0, originalScore: c.score, ...extra });

    const useFlatPath = !maxDocTokens;
    const queryFlat = this._flattenQueryTokens(effectiveQueryTokens, scoringDim);

    // Tier 1: Native batch scoring (rayon parallel + SIMD)
    // Skip native/WASM tiers when useTokenWeights is active — those kernels
    // don't support importance weighting, so we must use the JS-tier weighted path.
    const nativeScored = new Set();

    // One tombstone freshness check (statSync) per segment for this scoring
    // pass; cleared after the synchronous scoring loops below. An exception
    // path can leave it set — the next pass overwrites it, and staleness is
    // bounded by one scoring pass either way.
    this._staleQueryMemo = new Map();

    // Resolve a doc-lookup ID for each candidate. Graph-expanded candidates
    // carry `_liChunkId` (a chunk id pointing into the LI index) while their
    // public `id` is the entity id from the code graph. Honouring _liChunkId
    // lets expanded candidates participate in MaxSim rerank.
    const docIdOf = (c) => c._liChunkId || c.id;
    const lookupDocIdOf = (c) => this._resolveForRead(docIdOf(c));

    if (useFlatPath && !this.useTokenWeights) {
      const groups = { bit4: [], perToken: [], perDoc: [] };
      for (const candidate of toScore) {
        const lookupDocId = lookupDocIdOf(candidate);
        if (this.isDocumentTombstoned(lookupDocId)) continue;
        const doc = this.documents.get(lookupDocId);
        if (!doc) continue;
        if (doc.quantBits === 4 && doc.minArray && doc.tokenNorms) {
          groups.bit4.push({ candidate, doc });
        } else if (doc.minArray && doc.tokenNorms) {
          groups.perToken.push({ candidate, doc });
        } else if (doc.min !== undefined) {
          groups.perDoc.push({ candidate, doc });
        }
      }

      const tokenBuf = doc => Buffer.from(doc.tokens.buffer, doc.tokens.byteOffset, doc.tokens.byteLength);
      const perTokenCand = doc => ({ tokens: tokenBuf(doc), numTokens: doc.numTokens, dim: doc.dim, minArray: doc.minArray, scaleArray: doc.scaleArray, tokenNorms: doc.tokenNorms });

      // Score each group with its native kernel, collect results
      const batchScore = (group, buildCand, scoreFn) => {
        if (group.length === 0 || !scoreFn) return;
        const nativeCands = group.map(g => buildCand(g.doc));
        const scores = scoreFn(queryFlat, effectiveQueryTokens.length, scoringDim, nativeCands);
        if (scores) {
          for (let i = 0; i < group.length; i++) {
            if (this.isDocumentTombstoned(lookupDocIdOf(group[i].candidate))) {
              pushFallback(group[i].candidate, { _liTombstoned: true });
              nativeScored.add(group[i].candidate.id);
              continue;
            }
            pushScored(group[i].candidate, scores[i]);
            nativeScored.add(group[i].candidate.id);
          }
        }
      };

      batchScore(groups.bit4, perTokenCand, isNative4BitAvailable() ? nativeMaxSimBatch4Bit : null);
      batchScore(groups.perToken, perTokenCand, isNativePerTokenAvailable() ? nativeMaxSimBatchPerToken : null);
      batchScore(groups.perDoc, doc => ({ tokens: tokenBuf(doc), numTokens: doc.numTokens, dim: doc.dim, min: doc.min, scale: doc.scale }), isNativeMaxSimAvailable() ? nativeMaxSimBatch : null);
    }

    // Tier 2 & 3: WASM fused dequant or JS fallback for candidates not scored natively.
    // Try WASM fused kernels first (avoids JS-side dequant), fall back to JS dequant + wasmMaxSimF32.
    // Stage the query bytes in WASM memory once — per-candidate calls below
    // skip the redundant Q×dim×4 query memcpy when the session id matches.
    const wasmQuerySession = (useFlatPath && !this.useTokenWeights)
      ? wasmMaxSimPrepareQuery(queryFlat, effectiveQueryTokens.length, scoringDim)
      : 0;
    for (const candidate of toScore) {
      if (nativeScored.has(candidate.id)) continue;
      const docId = lookupDocIdOf(candidate);
      if (this.isDocumentTombstoned(docId)) {
        pushFallback(candidate, { _liTombstoned: true });
        continue;
      }
      const doc = this.documents.get(docId);
      if (!doc) { pushFallback(candidate); continue; }

      if (useFlatPath) {
        // Try WASM fused kernels only when token weighting is OFF (WASM doesn't support weights)
        if (!this.useTokenWeights) {
          // Try WASM fused 4-bit kernel (no JS dequant needed)
          if (doc.quantBits === 4 && doc.minArray && doc.tokenNorms) {
            const wasmScore = wasmMaxSimDequant4Bit(
              queryFlat, doc.tokens, doc.minArray, doc.scaleArray, doc.tokenNorms,
              effectiveQueryTokens.length, doc.numTokens, doc.dim, wasmQuerySession,
            );
            if (wasmScore !== null) { pushScored(candidate, wasmScore); continue; }
          }

          // Try WASM fused per-token int8 kernel (no JS dequant needed)
          if (doc.minArray && doc.tokenNorms && doc.quantBits !== 4) {
            const wasmScore = wasmMaxSimDequantPerToken(
              queryFlat, doc.tokens, doc.minArray, doc.scaleArray, doc.tokenNorms,
              effectiveQueryTokens.length, doc.numTokens, doc.dim, wasmQuerySession,
            );
            if (wasmScore !== null) { pushScored(candidate, wasmScore); continue; }
          }
        }

        // CRA-5: JS implicit decompression — score directly from packed nibbles
        // using a per-query-token LUT (16 entries), avoiding f32 allocation.
        if (doc.quantBits === 4 && doc.minArray && doc.tokenNorms) {
          pushScored(candidate, this._maxSimScore4BitImplicit(
            effectiveQueryTokens, doc, queryFlat,
          ));
          continue;
        }

        // JS dequant → WASM f32 or JS fallback
        const flatData = this.getTokensFlat(docId);
        if (flatData) {
          pushScored(candidate, this.maxSimScoreFlat(
            effectiveQueryTokens, flatData.flat, flatData.numTokens, flatData.dim,
            doc?.tokenNorms, queryFlat, doc?.preNorms,
          ));
        } else {
          pushFallback(candidate);
        }
      } else {
        const docTokens = this.getTokens(docId);
        if (docTokens) {
          pushScored(candidate, this.maxSimScore(effectiveQueryTokens, docTokens, pruneOpts));
        } else {
          pushFallback(candidate);
        }
      }
    }

    this._staleQueryMemo = null;

    for (const candidate of pruned) pushFallback(candidate, { _pruned: true });

    scored.sort((a, b) => b.lateInteractionScore - a.lateInteractionScore);
    return scored;
  }

  /**
   * Save index to disk.
   *
   * Streams documents one-by-one to avoid V8's ~512MB string length limit
   * that JSON.stringify() hits on large indexes (>10K docs).
   */
  async save() {
    await fs.mkdir(path.dirname(this.indexPath), { recursive: true });

    // Total doc count including any flushed-and-evicted segments (bounded build
    // mode). In normal mode `_evictedDocs` is 0, so this is byte-identical to
    // `this.documents.size`.
    const effectiveTotal = this.documents.size + this._evictedDocs;

    // Use segmented format when the doc count exceeds one segment.
    // Always rewrite ALL segments from this.documents (the authoritative
    // state) — never reuse stale segment files from a previous load,
    // because documents may have been removed since then.
    const useSegmented = effectiveTotal >= this._segmentSize;

    if (useSegmented) {
      if (!this._loadedExisting) {
        if (this._currentSegment.size > 0) {
          await this._flushSegment();
        }

        const flushedCount = this._segments.reduce((sum, segment) => sum + segment.count, 0);
        if (flushedCount === effectiveTotal && this._segments.length > 0) {
          // Staging-aware segment directory. _segmentDir was pre-seeded by
          // resetForSave() when staging; otherwise derive from indexPath.
          const segDir = this._segmentDir || (this.indexPath + '.segments');
          const manifest = {
            version: '3.0',
            format: 'sslx-v3',
            modelId: this.modelId,
            tokenDim: this.tokenDim,
            matryoshkaDim: this.matryoshkaDim || 0,
            maxTokens: this.maxTokens,
            useInt8: this.useInt8,
            quantBits: this.quantBits,
            poolFactor: this.poolFactor,
            whtSeed: this.whtSeed || 0,
            whtOrdering: this.whtOrdering,
            totalDocuments: effectiveTotal,
            segments: this._segments.map((segment) => ({
              path: path.basename(segment.path),
              count: segment.count,
            })),
          };

          await fs.writeFile(path.join(segDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
          if (this._wushCalibration) {
            const cal = {
              eigenVecs: Array.from(this._wushCalibration.eigenVecs),
              invSqrtEigenVals: Array.from(this._wushCalibration.invSqrtEigenVals),
              dim: this.tokenDim,
            };
            await fs.writeFile(path.join(segDir, 'wush-calibration.json'), JSON.stringify(cal));
          }
          // Stub stores segmentDir as a basename resolved relative to the
          // stub's dirname on load. When staging, record the basename derived
          // from _finalIndexPath so that after atomic promotion the stub
          // points at {finalIndexPath}.segments without a rewrite.
          const stubSegmentDirBasename = this._finalIndexPath
            ? path.basename(this._finalIndexPath) + '.segments'
            : path.basename(segDir);
          await fs.writeFile(this.indexPath, JSON.stringify({
            version: '3.0',
            format: 'segmented',
            segmentDir: stubSegmentDirBasename,
          }));
          this._segmentDir = segDir;
          this._currentSegment = new Map();
          await this._saveAliasSidecar();
          if (process.env.DEBUG) console.log(`LateInteraction: Saved ${this.documents.size} documents across ${this._segments.length} segments`);
          return;
        }
      }

      // Staging-aware segment directory (see resetForSave comment)
      const segDir = this._segmentDir || (this.indexPath + '.segments');
      await fs.mkdir(segDir, { recursive: true });

      // Remove any old segment files in this directory
      try {
        const existing = await fs.readdir(segDir);
        for (const f of existing) {
          await fs.unlink(path.join(segDir, f));
        }
      } catch (_err) { /* dir may not exist yet */ }

      // Write fresh segments from this.documents
      const newSegments = [];
      let batch = new Map();
      let segIdx = 0;

      for (const [id, doc] of this.documents) {
        batch.set(id, doc);
        if (batch.size >= this._segmentSize) {
          const segPath = path.join(segDir, `segment-${String(segIdx).padStart(4, '0')}.bin`);
          await this._writeSegmentFile(segPath, batch);
          newSegments.push({ path: path.basename(segPath), count: batch.size });
          batch = new Map();
          segIdx++;
        }
      }
      // Flush remainder
      if (batch.size > 0) {
        const segPath = path.join(segDir, `segment-${String(segIdx).padStart(4, '0')}.bin`);
        await this._writeSegmentFile(segPath, batch);
        newSegments.push({ path: path.basename(segPath), count: batch.size });
      }

      const manifest = {
        version: '3.0',
        format: 'sslx-v3',
        modelId: this.modelId,
        tokenDim: this.tokenDim,
        matryoshkaDim: this.matryoshkaDim || 0,
        maxTokens: this.maxTokens,
        useInt8: this.useInt8,
        quantBits: this.quantBits,
        poolFactor: this.poolFactor,
        whtSeed: this.whtSeed || 0,
        whtOrdering: this.whtOrdering,
        totalDocuments: this.documents.size,
        segments: newSegments,
      };

      await fs.writeFile(path.join(segDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

      // CRA-3: Persist WUSH calibration alongside segments
      if (this._wushCalibration) {
        const cal = {
          eigenVecs: Array.from(this._wushCalibration.eigenVecs),
          invSqrtEigenVals: Array.from(this._wushCalibration.invSqrtEigenVals),
          dim: this.tokenDim,
        };
        await fs.writeFile(path.join(segDir, 'wush-calibration.json'), JSON.stringify(cal));
      }

      // Write a stub at the main index path pointing to segments.
      // segmentDir is stored as a basename relative to the stub's dirname so
      // atomic stage-and-swap semantics work: when staging to {live}.tmp with
      // segments at {live}.tmp-stage.segments, the stub records the POST-swap
      // basename ({basename(finalIndexPath)}.segments) so no stub rewrite is
      // needed when the caller atomically promotes both the stub and the
      // segments directory.
      const stubSegmentDirBasename = this._finalIndexPath
        ? path.basename(this._finalIndexPath) + '.segments'
        : path.basename(segDir);
      await fs.writeFile(this.indexPath, JSON.stringify({
        version: '3.0',
        format: 'segmented',
        segmentDir: stubSegmentDirBasename,
      }));

      // Update internal state to reflect fresh segments
      this._segmentDir = segDir;
      this._segments = newSegments.map(s => ({ path: path.join(segDir, s.path), count: s.count }));
      this._currentSegment = new Map();

      await this._saveAliasSidecar();
      if (process.env.DEBUG) console.log(`LateInteraction: Saved ${this.documents.size} documents across ${newSegments.length} segments`);
      return;
    }

    // Legacy single-file save (for small indexes or when no add() was called)
    const header = {
      version: '2.1',
      modelId: this.modelId,
      tokenDim: this.tokenDim,
      matryoshkaDim: this.matryoshkaDim || 0,
      maxTokens: this.maxTokens,
      useInt8: this.useInt8,
      quantBits: this.quantBits,
      poolFactor: this.poolFactor,
      whtSeed: this.whtSeed || 0,
      whtOrdering: this.whtOrdering,
    };

    let bytesWritten = 0;

    await new Promise((resolve, reject) => {
      const ws = createWriteStream(this.indexPath, { encoding: 'utf-8' });
      ws.on('error', reject);

      // Write header + opening array bracket
      const headerStr = JSON.stringify(header).slice(0, -1) + ',"documents":[';
      ws.write(headerStr);
      bytesWritten += headerStr.length;

      let first = true;
      for (const [id, doc] of this.documents) {
        const obj = {
          id,
          tokens: Array.from(doc.tokens),
          numTokens: doc.numTokens,
          dim: doc.dim,
          metadata: doc.metadata,
        };
        if (doc.quantBits === 4) obj.quantBits = 4;
        if (doc.tokenNorms) obj.tokenNorms = Array.from(doc.tokenNorms);
        if (doc.preNorms) obj.preNorms = Array.from(doc.preNorms);
        // Per-token quant (Phase 1/4) vs per-doc quant (legacy)
        if (doc.minArray) {
          obj.minArray = Array.from(doc.minArray);
          obj.scaleArray = Array.from(doc.scaleArray);
        } else {
          obj.min = doc.min;
          obj.scale = doc.scale;
        }
        const entry = JSON.stringify(obj);

        const chunk = first ? entry : ',' + entry;
        first = false;
        ws.write(chunk);
        bytesWritten += chunk.length;
      }

      ws.end(']}', () => {
        bytesWritten += 2;
        resolve();
      });
    });

    // CRA-3: Persist WUSH calibration alongside legacy single-file index
    if (this._wushCalibration) {
      const cal = {
        eigenVecs: Array.from(this._wushCalibration.eigenVecs),
        invSqrtEigenVals: Array.from(this._wushCalibration.invSqrtEigenVals),
        dim: this.tokenDim,
      };
      const wushPath = this.indexPath + '.wush-calibration.json';
      await fs.writeFile(wushPath, JSON.stringify(cal));
    }

    await this._saveAliasSidecar();

    const sizeMB = (bytesWritten / 1024 / 1024).toFixed(2);
    // DEBUG-only: this prints during the indexer's parallel embed+LI progress region;
    // a direct write here moves the cursor and duplicates a bar. The indexer's
    // "✓ Late interaction index built: N docs (X MB)" line already reports this.
    if (process.env.DEBUG) console.log(`LateInteraction: Saved ${this.documents.size} documents (${sizeMB} MB)`);
  }

  /**
   * Load index from disk.
   *
   * Uses streaming parse to avoid V8's ~512MB string length limit on large
   * indexes. Reads the file as a stream, extracts the header, then parses
   * each document object individually.
   */
  async load() {
    try {
      const stat = await fs.stat(this.indexPath);

      // Check if this is a segmented index (v3.0)
      let state;
      if (stat.size < 1024) {
        // Small file — likely a segment stub
        const data = await fs.readFile(this.indexPath, 'utf-8');
        state = JSON.parse(data);
        if (state.format === 'segmented') {
          // segmentDir may be stored as:
          //   - basename (new format, stage-and-swap safe): "foo.db.segments"
          //   - absolute path (legacy or pre-fix-state): "/abs/.../foo.db.segments"
          //   - absolute path with .tmp suffix (pre-fix broken state):
          //     "/abs/.../foo.db.tmp.segments" — self-heal by migrating the
          //     orphaned directory to the canonical name and rewriting the stub.
          let segDirAbs;
          if (path.isAbsolute(state.segmentDir)) {
            segDirAbs = state.segmentDir;
          } else {
            segDirAbs = path.join(path.dirname(this.indexPath), state.segmentDir);
          }

          // Self-heal: the pre-fix staged-save bug wrote an absolute
          // segmentDir with the `.tmp.segments` suffix into the promoted
          // stub. Detect that pattern and migrate the directory to the
          // canonical {indexPath}.segments name so the stub can be rewritten
          // as a stable basename. Race-safe: two concurrent processes may
          // both reach this branch; fs.rename atomicity ensures only one
          // succeeds, and we tolerate the loser's ENOENT / EEXIST.
          const canonicalSegDir = this.indexPath + '.segments';
          const maybeMigrate = async (from, to) => {
            try {
              await fs.rename(from, to);
              return true;
            } catch (err) {
              // ENOENT: another process already migrated it (source gone).
              // EEXIST / ENOTEMPTY: destination raced us (target populated).
              // EPERM: atomic rename may fall through on some platforms;
              //        treat as a best-effort miss and let downstream decide.
              if (err && (err.code === 'ENOENT' || err.code === 'EEXIST'
                || err.code === 'ENOTEMPTY' || err.code === 'EPERM')) {
                return false;
              }
              throw err;
            }
          };

          // Atomic stub rewrite via .tmp + rename, so a crash mid-heal cannot
          // leave a truncated stub file.
          const writeStubAtomic = async (stubContent) => {
            const stubTmp = this.indexPath + '.selfheal.tmp';
            await fs.writeFile(stubTmp, JSON.stringify(stubContent));
            try {
              await fs.rename(stubTmp, this.indexPath);
            } catch (err) {
              try { await fs.unlink(stubTmp); } catch (_e) { /* best effort */ }
              throw err;
            }
          };

          const looksLikeBrokenTmpState = segDirAbs !== canonicalSegDir
            && segDirAbs.endsWith('.tmp.segments')
            && path.dirname(segDirAbs) === path.dirname(canonicalSegDir);
          if (looksLikeBrokenTmpState) {
            if (existsSync(segDirAbs) && !existsSync(canonicalSegDir)) {
              console.warn(`[LateInteraction] Self-heal: migrating orphaned ${path.basename(segDirAbs)} to ${path.basename(canonicalSegDir)}`);
              await maybeMigrate(segDirAbs, canonicalSegDir);
            }
            // Only rewrite the stub if the canonical directory actually
            // exists after the migration attempt. Otherwise we'd point
            // a newly-rewritten stub at nothing and load would fail.
            if (existsSync(canonicalSegDir)) {
              await writeStubAtomic({
                version: '3.0',
                format: 'segmented',
                segmentDir: path.basename(canonicalSegDir),
              });
              segDirAbs = canonicalSegDir;
            }
          }

          // Second self-heal path: stub points at a non-existent segments dir
          // but an orphaned `.tmp.segments` exists nearby — migrate in place.
          if (!existsSync(segDirAbs)) {
            const tmpSegDir = this.indexPath + '.tmp.segments';
            if (existsSync(tmpSegDir) && !existsSync(canonicalSegDir)) {
              console.warn(`[LateInteraction] Self-heal: migrating orphaned ${path.basename(tmpSegDir)} to ${path.basename(canonicalSegDir)}`);
              await maybeMigrate(tmpSegDir, canonicalSegDir);
              if (existsSync(canonicalSegDir)) {
                await writeStubAtomic({
                  version: '3.0',
                  format: 'segmented',
                  segmentDir: path.basename(canonicalSegDir),
                });
                segDirAbs = canonicalSegDir;
              }
            }
          }
          await this._loadSegmented(segDirAbs);
          // Positions-only readers must not load the alias sidecar: its orphan
          // guard resolves each alias against `documents`, which is empty by
          // construction here, so every alias would be dropped. The delta path
          // never reads `aliasPointers`, and nothing it writes depends on them.
          if (!this.positionsOnly) await this._loadAliasSidecar();
          return;
        }
      }

      const useStreaming = stat.size > 256 * 1024 * 1024; // >256MB → stream

      if (!state) {
        if (useStreaming) {
          state = await this._loadStreaming();
        } else {
          const data = await fs.readFile(this.indexPath, 'utf-8');
          state = JSON.parse(data);
        }
      }

      // Model consistency check (v2.0+)
      if (state.modelId && this.modelId && state.modelId !== this.modelId) {
        const indexDim = state.tokenDim;
        const configDim = this.tokenDim;
        console.warn(`[LateInteraction] Index built with ${state.modelId} (${indexDim}d) but config says ${this.modelId} (${configDim}d).`);
        console.warn(`          Skipping late interaction scoring. Re-index to use the new model.`);
        this.modelMismatch = true;
        return;
      }

      this.tokenDim = state.tokenDim;
      this.matryoshkaDim = state.matryoshkaDim || 0;
      this.maxTokens = state.maxTokens;
      this.useInt8 = state.useInt8;
      this.quantBits = state.quantBits || (state.useInt8 ? 8 : 32);
      this.poolFactor = state.poolFactor || 1;
      if (state.whtSeed !== undefined) this.whtSeed = state.whtSeed;
      this.whtOrdering = state.whtOrdering || 'natural';
      if (state.modelId) this.modelId = state.modelId;

      // Documents may already be loaded by streaming path
      if (state.documents && !this._streamLoaded) {
        this.documents.clear();
        for (const doc of state.documents) {
          // 4-bit docs store packed nibbles as unsigned bytes (0-255);
          // int8 docs store signed values (-128..127); float32 uses f32.
          const is4bit = doc.quantBits === 4;
          const tokens = is4bit
            ? new Uint8Array(doc.tokens)
            : (this.useInt8 ? new Int8Array(doc.tokens) : new Float32Array(doc.tokens));

          const entry = {
            tokens,
            numTokens: doc.numTokens,
            dim: doc.dim,
            metadata: doc.metadata,
          };
          if (is4bit) entry.quantBits = 4;
          if (doc.tokenNorms) entry.tokenNorms = new Float32Array(doc.tokenNorms);
          if (doc.preNorms) entry.preNorms = new Float32Array(doc.preNorms);

          // Per-token quant (Phase 1/4) vs per-doc quant (legacy)
          if (doc.minArray) {
            entry.minArray = new Float32Array(doc.minArray);
            entry.scaleArray = new Float32Array(doc.scaleArray);
          } else {
            entry.min = doc.min;
            entry.scale = doc.scale;
          }

          this.documents.set(doc.id, entry);
        }
      }
      this._streamLoaded = false;
      // Detect per-token quant from first doc — O(1) vs scanning all docs
      for (const doc of this.documents.values()) {
        this._hasPerTokenQuant = !!doc.minArray;
        break;
      }

      // Rebuild norms only for docs that don't have persisted norms
      this._rebuildTokenNorms();

      // CRA-3: Load WUSH calibration for legacy single-file indexes
      const wushPath = this.indexPath + '.wush-calibration.json';
      if (existsSync(wushPath)) {
        try {
          const cal = JSON.parse(await fs.readFile(wushPath, 'utf-8'));
          this._wushCalibration = {
            eigenVecs: new Float64Array(cal.eigenVecs),
            invSqrtEigenVals: new Float64Array(cal.invSqrtEigenVals),
          };
          this.wushCalibrate = true;
        } catch { /* calibration missing or corrupt — fall back to bare WHT */ }
      }

      await this._loadAliasSidecar();

      bootLog(`LateInteraction: Loaded ${this.documents.size} documents (model: ${this.modelId || 'legacy'}, ${this.tokenDim}d)${this.aliasPointers.size > 0 ? `, ${this.aliasPointers.size} aliases` : ''}`);
    } catch (err) {
      if (err.code === 'ENOENT') {
        bootLog('LateInteraction: No existing index found');
      } else {
        // Recorded so `init()` can turn it into a hard error for the
        // positions-only (writer-side) reader. The full reader's behaviour is
        // unchanged: it still degrades to whatever loaded.
        this._loadFailure = err;
        console.error(`LateInteraction: Failed to load index: ${err.message}`);
      }
    }
  }

  /**
   * Load segmented index (Option 3: flatten all segments into this.documents).
   * All segment data is loaded into memory at search init — same search semantics
   * as the legacy single-file format. Memory savings come from indexing time only.
   */
  async _loadSegmented(segmentDir) {
    const manifestPath = path.join(segmentDir, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));

    // Model consistency check
    if (manifest.modelId && this.modelId && manifest.modelId !== this.modelId) {
      console.warn(`[LateInteraction] Segmented index built with ${manifest.modelId} but config says ${this.modelId}.`);
      console.warn(`          Skipping late interaction scoring. Re-index to use the new model.`);
      this.modelMismatch = true;
      return;
    }

    this.tokenDim = manifest.tokenDim;
    this.matryoshkaDim = manifest.matryoshkaDim || 0;
    this.maxTokens = manifest.maxTokens;
    this.useInt8 = manifest.useInt8;
    this.quantBits = manifest.quantBits || (manifest.useInt8 ? 8 : 32);
    this.poolFactor = manifest.poolFactor || 1;
    if (manifest.whtSeed !== undefined) this.whtSeed = manifest.whtSeed;
    this.whtOrdering = manifest.whtOrdering || 'natural';
    if (manifest.modelId) this.modelId = manifest.modelId;

    this.documents.clear();
    this._docSegmentPositions.clear();
    this._staleBitmapCache.clear();

    const isSSLX = manifest.format === 'sslx-v3';
    const visitedSegments = this.positionsOnly && this._positionsCache ? new Set() : null;

    for (const seg of manifest.segments) {
      const segPath = path.join(segmentDir, seg.path);

      // Positions-only: read the id prefix, apply the identical stale-document
      // skip, and record positions. `documents` stays empty.
      if (this.positionsOnly) {
        const ids = await this._readSegmentIds(segPath, Number.isInteger(seg.count) ? seg.count : null);
        visitedSegments?.add(segPath);
        const staleBitmapOnly = this._loadSegmentStaleBitmap(segPath);
        for (let docIndex = 0; docIndex < ids.length; docIndex++) {
          if (staleBitmapOnly && isSet(staleBitmapOnly, docIndex)) continue;
          this._docSegmentPositions.set(ids[docIndex], { segmentPath: segPath, docIndex });
        }
        continue;
      }

      const docs = await this._readSegmentFile(segPath);
      const staleBitmap = this._loadSegmentStaleBitmap(segPath);

      for (let docIndex = 0; docIndex < docs.length; docIndex++) {
        const doc = docs[docIndex];
        if (staleBitmap && isSet(staleBitmap, docIndex)) {
          continue;
        }
        // SSLX reader returns typed arrays directly; legacy LISE returns plain arrays
        const tokens = (doc.tokens instanceof Int8Array || doc.tokens instanceof Float32Array || doc.tokens instanceof Uint8Array)
          ? doc.tokens
          : (this.useInt8 ? new Int8Array(doc.tokens) : new Float32Array(doc.tokens));

        const entry = {
          tokens,
          numTokens: doc.numTokens,
          dim: doc.dim,
          metadata: doc.metadata,
        };
        if (doc.quantBits) entry.quantBits = doc.quantBits;

        // Per-token quant (Phase 1/4) vs per-doc quant (legacy)
        if (doc.minArray) {
          entry.minArray = doc.minArray;
          entry.scaleArray = doc.scaleArray;
        } else {
          entry.min = doc.min;
          entry.scale = doc.scale;
        }

        // SSLX segments include persisted tokenNorms — skip expensive rebuild
        if (doc.tokenNorms) entry.tokenNorms = doc.tokenNorms;
        // CRA-6: Restore pre-normalization norms for token importance weighting
        if (doc.preNorms) entry.preNorms = doc.preNorms;

        this.documents.set(doc.id, entry);
        this._docSegmentPositions.set(doc.id, { segmentPath: segPath, docIndex });
      }
    }

    for (const doc of this.documents.values()) {
      this._hasPerTokenQuant = !!doc.minArray;
      break;
    }
    this._rebuildTokenNorms();
    this._segmentDir = segmentDir;
    this._segments = manifest.segments.map(s => ({ path: path.join(segmentDir, s.path), count: s.count }));

    if (visitedSegments) {
      // Bound the verified-identity cache: drop entries for segments of THIS
      // directory that the current manifest no longer lists (compaction retires
      // segment files and never reuses their names).
      const prefix = segmentDir + path.sep;
      for (const key of this._positionsCache.keys()) {
        if (key.startsWith(prefix) && !visitedSegments.has(key)) this._positionsCache.delete(key);
      }
    }

    if (this.positionsOnly) {
      bootLog(`LateInteraction: Loaded ${this._docSegmentPositions.size} document positions from ${manifest.segments.length} segments (positions-only, model: ${this.modelId || 'legacy'}, ${this.tokenDim}d)`);
      return;
    }

    // CRA-3: Load WUSH calibration if it exists alongside segments
    const wushPath = path.join(segmentDir, 'wush-calibration.json');
    if (existsSync(wushPath)) {
      try {
        const cal = JSON.parse(await fs.readFile(wushPath, 'utf-8'));
        this._wushCalibration = {
          eigenVecs: new Float64Array(cal.eigenVecs),
          invSqrtEigenVals: new Float64Array(cal.invSqrtEigenVals),
        };
        this.wushCalibrate = true;
      } catch { /* calibration missing or corrupt — fall back to bare WHT */ }
    }

    bootLog(`LateInteraction: Loaded ${this.documents.size} documents from ${manifest.segments.length} segments (model: ${this.modelId || 'legacy'}, ${this.tokenDim}d)`);
  }

  /**
   * Stream-parse a large LI index file.
   *
   * Strategy: read the file as a Buffer (no V8 string limit), find the
   * `"documents":[` marker, then extract each document JSON object by
   * tracking brace depth. Each document is parsed individually (small
   * string, well under limits).
   *
   * @returns {Object} Header fields (version, modelId, tokenDim, etc.) — documents are loaded directly into this.documents
   */
  async _loadStreaming() {
    const marker = Buffer.from('"documents":[');
    const stream = createReadStream(this.indexPath, { highWaterMark: this.streamChunkSize });

    let header = null;
    let headerParts = [];
    let pending = Buffer.alloc(0);
    let docStart = -1;
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let docCount = 0;

    this.documents.clear();

    const parseDocument = (docBuf) => {
      const doc = JSON.parse(docBuf.toString('utf-8'));
      const is4bit = doc.quantBits === 4;
      const tokens = is4bit
        ? new Uint8Array(doc.tokens)
        : (header.useInt8 ? new Int8Array(doc.tokens) : new Float32Array(doc.tokens));

      const entry = {
        tokens,
        numTokens: doc.numTokens,
        dim: doc.dim,
        metadata: doc.metadata,
      };
      if (is4bit) entry.quantBits = 4;
      if (doc.tokenNorms) entry.tokenNorms = new Float32Array(doc.tokenNorms);
      if (doc.preNorms) entry.preNorms = new Float32Array(doc.preNorms);

      if (doc.minArray) {
        entry.minArray = new Float32Array(doc.minArray);
        entry.scaleArray = new Float32Array(doc.scaleArray);
      } else {
        entry.min = doc.min;
        entry.scale = doc.scale;
      }

      this.documents.set(doc.id, entry);

      docCount++;
      if (docCount % 5000 === 0) {
        bootLog(`LateInteraction: Streaming load ${docCount} documents...`);
      }
    };

    for await (const chunk of stream) {
      pending = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk;

      if (!header) {
        const markerIdx = pending.indexOf(marker);
        if (markerIdx === -1) {
          const keep = Math.min(marker.length - 1, pending.length);
          const flushLen = pending.length - keep;
          if (flushLen > 0) {
            headerParts.push(pending.subarray(0, flushLen));
            pending = pending.subarray(flushLen);
          }
          continue;
        }

        headerParts.push(pending.subarray(0, markerIdx));
        const headerStr = Buffer.concat(headerParts).toString('utf-8') + '"_":0}';
        header = JSON.parse(headerStr);
        headerParts = [];
        pending = pending.subarray(markerIdx + marker.length);
      }

      let i = 0;
      while (i < pending.length) {
        const byte = pending[i];

        if (docStart === -1) {
          if (byte === 0x20 || byte === 0x0A || byte === 0x0D || byte === 0x09 || byte === 0x2C) {
            i++;
            continue;
          }
          if (byte === 0x5D) {
            pending = Buffer.alloc(0);
            i = pending.length;
            break;
          }
          if (byte !== 0x7B) {
            i++;
            continue;
          }

          docStart = i;
          depth = 1;
          inString = false;
          escapeNext = false;
          i++;
          continue;
        }

        if (inString) {
          if (escapeNext) {
            escapeNext = false;
          } else if (byte === 0x5C) {
            escapeNext = true;
          } else if (byte === 0x22) {
            inString = false;
          }
          i++;
          continue;
        }

        if (byte === 0x22) {
          inString = true;
          i++;
          continue;
        }
        if (byte === 0x7B) {
          depth++;
          i++;
          continue;
        }
        if (byte === 0x7D) {
          depth--;
          i++;
          if (depth === 0) {
            parseDocument(pending.subarray(docStart, i));
            pending = pending.subarray(i);
            i = 0;
            docStart = -1;
          }
          continue;
        }

        i++;
      }

      if (docStart >= 0) {
        // Carry over incomplete document: slice from docStart so the opening
        // '{' is at position 0. Reset parser state so the re-scan from the
        // opening brace correctly re-establishes depth/string tracking.
        pending = pending.subarray(docStart);
        docStart = -1;
        depth = 0;
        inString = false;
        escapeNext = false;
      } else if (docStart === -1 && pending.length > 0) {
        pending = Buffer.alloc(0);
      }
    }

    if (!header) {
      throw new Error('Invalid LI index format: no documents array');
    }
    if (pending.length > 0) {
      throw new Error('Invalid LI index format: truncated document payload');
    }

    this._streamLoaded = true;
    return header;
  }

  /**
   * Reconstruct per-token L2 norms for all loaded documents.
   * Called after load() since tokenNorms are not persisted in the index file.
   * @private
   */
  _rebuildTokenNorms() {
    for (const [, doc] of this.documents) {
      if (doc.tokenNorms) continue; // already has norms (e.g., from add() or SSLX)

      let flat;
      if (doc.quantBits === 4 && doc.minArray) {
        // Phase 4: dequantize 4-bit nibble-packed data before computing norms
        flat = dequantizeFromInt4PerToken(doc.tokens, doc.minArray, doc.scaleArray, doc.numTokens, doc.dim);
      } else if (this.useInt8 && doc.minArray) {
        flat = this._dequantPerToken(doc);
      } else if (this.useInt8 && doc.min !== undefined) {
        flat = dequantizeFromInt8(doc.tokens, doc.min, doc.scale);
      } else {
        flat = doc.tokens;
      }

      const norms = new Float32Array(doc.numTokens);
      for (let t = 0; t < doc.numTokens; t++) {
        const offset = t * doc.dim;
        let normSq = 0;
        for (let d = 0; d < doc.dim; d++) {
          normSq += flat[offset + d] * flat[offset + d];
        }
        norms[t] = Math.sqrt(normSq);
      }
      doc.tokenNorms = norms;
    }
  }

  /**
   * Check which chunk IDs have pre-indexed token vectors.
   * Synchronous O(n) Map lookup — no SQL, no async needed.
   *
   * @param {Iterable<string>} chunkIds
   * @returns {Set<string>} IDs that have tokens in the index
   */
  hasTokens(chunkIds) {
    const available = new Set();
    for (const id of chunkIds) {
      const resolved = this._resolveForRead(id);
      if (!this.documents.has(resolved)) continue;
      if (this.isDocumentTombstoned(resolved)) continue;
      available.add(id);
    }
    return available;
  }

  /**
   * Get index statistics
   */
  getStats() {
    let totalTokens = this._evictedTokens || 0;
    for (const doc of this.documents.values()) {
      totalTokens += doc.numTokens;
    }

    // In bounded build mode, flushed docs are evicted from `documents` but their
    // counts live in `_evictedDocs`/`_evictedTokens` so stats stay accurate.
    const docCount = this.documents.size + (this._evictedDocs || 0);
    const avgTokens = docCount > 0 ?
      (totalTokens / docCount).toFixed(1) : 0;

    let bytesPerToken;
    if (this.quantBits === 4) {
      bytesPerToken = Math.ceil(this.tokenDim / 2) + 12;
    } else if (this.useInt8) {
      bytesPerToken = this.tokenDim + (this._hasPerTokenQuant ? 12 : 4);
    } else {
      bytesPerToken = this.tokenDim * 4 + 4;
    }
    const estimatedMB = (totalTokens * bytesPerToken / 1024 / 1024).toFixed(2);

    return {
      documents: docCount,
      totalTokens,
      avgTokensPerDoc: avgTokens,
      tokenDim: this.tokenDim,
      useInt8: this.useInt8,
      quantBits: this.quantBits,
      estimatedSizeMB: estimatedMB,
      modelId: this.modelId,
      poolFactor: this.poolFactor,
    };
  }
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  if (args.includes('--test')) {
    console.log('Testing Late Interaction Index...\n');

    const index = new LateInteractionIndex();
    await index.init();

    // Add test documents with fake token embeddings
    const doc1Tokens = Array(50).fill(null).map(() =>
      Array(64).fill(0).map(() => Math.random())
    );
    const doc2Tokens = Array(30).fill(null).map(() =>
      Array(64).fill(0).map(() => Math.random())
    );

    await index.add('doc1', doc1Tokens, { file: 'test1.js' });
    await index.add('doc2', doc2Tokens, { file: 'test2.js' });

    console.log('Stats:', index.getStats());

    // Test MaxSim scoring
    const queryTokens = Array(5).fill(null).map(() =>
      Array(64).fill(0).map(() => Math.random())
    );

    const candidates = [{ id: 'doc1', score: 0.5 }, { id: 'doc2', score: 0.6 }];
    const scored = await index.scoreWithLateInteraction(queryTokens, candidates);

    console.log('\nMaxSim Scores:');
    for (const s of scored) {
      console.log(`  ${s.id}: ${s.lateInteractionScore.toFixed(4)}`);
    }

    // Save and reload
    await index.save();
    console.log('\nSaved and reloading...');

    const index2 = new LateInteractionIndex();
    await index2.init();
    console.log('Reloaded stats:', index2.getStats());

  } else if (args.includes('--stats')) {
    const index = new LateInteractionIndex();
    await index.init();
    console.log('Late Interaction Index Stats:', index.getStats());

  } else {
    console.log(`
Late Interaction Index

Usage:
  node late-interaction-index.js --test    Run test with fake data
  node late-interaction-index.js --stats   Show index statistics

Storage Optimization:
  - 64-dim tokens (vs 128): 50% smaller, 1.5% accuracy loss
  - int8 quantization: 4x compression
  - Expected: ~200-700MB for 11k chunks (not 25GB!)

How it works:
  1. Store token-level embeddings at indexing time
  2. At query time, compute MaxSim between query & doc tokens
  3. MaxSim approximates cross-encoder quality at bi-encoder speed
`);
  }
}

export default LateInteractionIndex;

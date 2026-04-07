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
import { existsSync, createWriteStream, createReadStream } from 'fs';
import path from 'path';
import { DB_PATHS, LATE_INTERACTION_CONFIG } from '../infrastructure/config/index.js';
import { wasmMaxSimF32, wasmMaxSimDequantPerToken, wasmMaxSimDequant4Bit, nativeMaxSimBatch, nativeMaxSimBatchPerToken, nativeMaxSimBatch4Bit, initWasm, isNativeMaxSimAvailable, isNativePerTokenAvailable, isNative4BitAvailable } from '../infrastructure/simd-distance.js';
import { fastRotate, generateSignVector } from '../infrastructure/quantization.js';
import { poolTokens } from './late-interaction-model.js';

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
      // All zeros
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
 * Late Interaction Index Class
 */
const LI_SEGMENT_SIZE = 10_000;
const LI_SEGMENT_MAGIC = 0x4C495345; // "LISE" = Late Interaction Segment (legacy)
const SSLX_SEGMENT_MAGIC = 0x53534C58; // "SSLX" = Sweet Search Late indeX (v3 binary)
const SSLX_VERSION = 3;
const SSLX_HEADER_SIZE = 64;
const SSLX_DOC_ENTRY_SIZE = 20;

export class LateInteractionIndex {
  constructor(options = {}) {
    this.tokenDim = options.tokenDim || LATE_INTERACTION_CONFIG.tokenDimension;
    this.maxTokens = options.maxTokens || 512;
    this.useInt8 = options.useInt8 ?? (LATE_INTERACTION_CONFIG.quantization === 'int8');
    this.quantBits = options.quantBits || (this.useInt8 ? 8 : 32); // 8=int8, 4=int4-nibble, 32=float32
    this.indexPath = options.indexPath || DB_PATHS.lateInteraction || path.join(process.cwd(), '.sweet-search', 'late-interaction-tokens.db');
    this.modelId = options.modelId || LATE_INTERACTION_CONFIG.model || null;
    this.poolFactor = options.poolFactor || 1;
    this.streamChunkSize = options.streamChunkSize || (8 * 1024 * 1024);

    // Phase 3: norm-based token pruning threshold (0 = disabled)
    this.normPruneThreshold = options.normPruneThreshold || 0;

    // WHT rotation (Phase 2): seed > 0 enables Walsh-Hadamard rotation
    // before quantization. Equalizes dimension variance for better INT8 fidelity.
    // Default OFF (0) for backward compat — legacy indexes don't persist whtSeed,
    // so defaulting ON would rotate queries against unrotated documents.
    this.whtSeed = options.whtSeed ?? 0;
    this._signVector = null; // lazy-init on first add/query

    // In-memory storage
    this.documents = new Map(); // id -> { tokens, metadata }
    this.initialized = false;
    this._hasPerTokenQuant = false; // tracked for getStats — set on add/load

    // Segmented flush state (Phase C)
    this._currentSegment = new Map();
    this._segments = []; // { path, count } of flushed segments
    this._segmentDir = null;
    this._segmentSize = options.segmentSize || LI_SEGMENT_SIZE;
  }

  /**
   * Reset segment state for a new save path. Call before save() when the
   * output path differs from the load path (staged builds).
   */
  resetForSave(newIndexPath) {
    this.indexPath = newIndexPath;
    // Discard loaded segment refs — save() will rewrite from this.documents.
    // Clear _segmentDir so _flushSegment() derives a fresh directory from
    // the new indexPath instead of writing into the old live directory.
    this._segmentDir = null;
    this._segments = [];
    this._currentSegment = new Map();
  }

  /**
   * Initialize or load index
   */
  async init() {
    if (this.initialized) return;

    // Ensure WASM MaxSim kernel is ready
    await initWasm();

    if (existsSync(this.indexPath)) {
      await this.load();
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

    // Phase 3: Norm-based token pruning — drop low-information tokens before pooling.
    // Uses pre-normalization norms when available (from the model's L2 normalization
    // step, attached as tokenEmbeddings.preNorms). Pre-norm magnitude measures how much
    // the model "activated" for each token — low pre-norm = low information content.
    // Falls back to post-normalization L2 norms for external embeddings that haven't
    // been normalized (where post-norm varies meaningfully).
    if (this.normPruneThreshold > 0 && truncated.length > 1) {
      const preNorms = tokenEmbeddings.preNorms; // Float32Array from model, or undefined
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

    // Phase 3: Token pooling — reduce token count by averaging consecutive groups.
    // Only pool here if tokens haven't already been pooled upstream (e.g., by
    // encodeDocuments). The _pooledUpstream flag is set by the indexing pipeline
    // when it calls encodeDocuments with poolFactor > 1. If tokens arrive from
    // an external source without going through encodeDocuments, this pools them.
    if (this.poolFactor > 1 && !metadata._pooledUpstream) {
      truncated = poolTokens(truncated.map(t => t instanceof Float32Array ? t : new Float32Array(t)), this.poolFactor);
    }

    // WHT rotation (Phase 2): rotate each token before quantization.
    // Equalizes dimension variance so scalar quantization uses full INT8 range.
    // Lazy-init sign vector (deterministic from whtSeed).
    if (this.whtSeed > 0 && !this._signVector) {
      this._signVector = generateSignVector(this.tokenDim, this.whtSeed);
    }

    // Apply rotation in-place before flattening (if WHT enabled)
    if (this.whtSeed > 0) {
      for (let t = 0; t < truncated.length; t++) {
        truncated[t] = fastRotate(new Float32Array(truncated[t]), this._signVector);
      }
    }

    // Flatten typed arrays into a single contiguous buffer.
    const totalElements = truncated.length * this.tokenDim;
    const flat = new Float32Array(totalElements);
    for (let i = 0; i < truncated.length; i++) {
      flat.set(truncated[i], i * this.tokenDim);
    }

    // Pre-compute per-token L2 norms (on rotated vectors — WHT preserves norms).
    const tokenNorms = new Float32Array(truncated.length);
    for (let t = 0; t < truncated.length; t++) {
      const offset = t * this.tokenDim;
      let normSq = 0;
      for (let d = 0; d < this.tokenDim; d++) {
        normSq += flat[offset + d] * flat[offset + d];
      }
      tokenNorms[t] = Math.sqrt(normSq);
    }

    let docEntry;
    if (this.quantBits === 4) {
      // Phase 4: 4-bit nibble-packed quantization (2 values per byte)
      const { data, minArray, scaleArray } = quantizeToInt4PerToken(flat, truncated.length, this.tokenDim);
      docEntry = { tokens: data, numTokens: truncated.length, dim: this.tokenDim, minArray, scaleArray, metadata, tokenNorms, quantBits: 4 };
    } else if (this.useInt8) {
      const { data, minArray, scaleArray } = quantizeToInt8PerToken(flat, truncated.length, this.tokenDim);
      docEntry = { tokens: data, numTokens: truncated.length, dim: this.tokenDim, minArray, scaleArray, metadata, tokenNorms };
    } else {
      docEntry = { tokens: flat, numTokens: truncated.length, dim: this.tokenDim, metadata, tokenNorms };
    }

    this.documents.set(id, docEntry);
    if (docEntry.minArray) this._hasPerTokenQuant = true;
    this._currentSegment.set(id, docEntry);

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
      await fs.mkdir(this._segmentDir, { recursive: true });
    }

    const segIdx = this._segments.length;
    const segPath = path.join(this._segmentDir, `segment-${String(segIdx).padStart(4, '0')}.bin`);

    await this._writeSegmentFile(segPath, this._currentSegment);
    this._segments.push({ path: segPath, count: this._currentSegment.size });

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
    const is4bit = this.quantBits === 4;
    // Bytes per element per token dimension (hoisted — same for all docs in a segment)
    const bytesPerDim = is4bit ? 0.5 : (this.useInt8 ? 1 : 4);

    // Collect entries and compute total sizes
    let totalTokenBytes = 0;
    let totalIdBytes = 0;

    for (const [id, doc] of segmentMap) {
      const idBuf = Buffer.from(id, 'utf-8');
      totalIdBytes += 2 + idBuf.length; // u16 len + utf8 bytes
      const numTokens = doc.numTokens;
      const tokenPayload = Math.ceil(numTokens * this.tokenDim * bytesPerDim);
      // token data + norms (always) + per-token min/scale (if this doc has them)
      totalTokenBytes += tokenPayload + numTokens * 4; // tokens + norms
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
    buf.writeUInt8(this.quantBits, 6);                 // [6]     quantBits (4=int4, 8=int8, 32=float32)
    buf.writeUInt8(this.tokenDim, 7);                 // [7]     tokenDim
    buf.writeUInt32LE(numDocs, 8);                    // [8..11] numDocuments
    buf.writeUInt8(this.poolFactor || 1, 12);         // [12]    poolFactor
    // [13..15] reserved
    if (this.modelId) {                               // [16..47] modelId (32B, zero-padded)
      const modelBuf = Buffer.from(this.modelId, 'utf-8');
      modelBuf.copy(buf, 16, 0, Math.min(modelBuf.length, 32));
    }
    buf.writeUInt32LE(this.whtSeed || 0, 48);        // [48..51] whtSeed
    // [52..63] reserved (already zero)
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
      // [15..19] reserved

      const tokenPayload = Math.ceil(doc.numTokens * this.tokenDim * bytesPerDim);
      tokenSlabCursor += tokenPayload + doc.numTokens * 4 + (isPerToken ? doc.numTokens * 8 : 0);
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
      const tokenPayload = Math.ceil(doc.numTokens * this.tokenDim * bytesPerDim);
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
        isPerToken: buf.readUInt8(off + 14) === 1, // per-doc quantScheme flag
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
      const { tokenDataOffset, numTokens, min, scale, isPerToken } = docEntries[i];
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

      const doc = {
        id: ids[i],
        tokens,
        numTokens,
        dim: tokenDim,
        tokenNorms,
      };
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
  getTokens(id) {
    const doc = this.documents.get(id);
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
    const doc = this.documents.get(id);
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
  maxSimScoreFlat(queryTokens, docFlat, numDocTokens, dim, docTokenNorms, precomputedQueryFlat) {
    if (!docFlat || numDocTokens === 0) return 0;

    // Try WASM kernel first — pass pre-flattened query if available
    const queryFlat = precomputedQueryFlat || this._flattenQueryTokens(queryTokens, dim);
    const wasmScore = wasmMaxSimF32(queryFlat, docFlat, queryTokens.length, numDocTokens, dim);
    if (wasmScore !== null) return wasmScore;

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

        const sim = dot / (qNorm * dNorm + 1e-8);
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

    let queryTokens = queryTokenEmbeddings.map(emb =>
      emb.slice(0, this.tokenDim)
    );

    // WHT rotation (Phase 2): rotate query tokens once (amortized across all candidates).
    // Required when index was built with whtSeed > 0 — scoring must happen in rotated space.
    if (this.whtSeed > 0) {
      if (!this._signVector) {
        this._signVector = generateSignVector(this.tokenDim, this.whtSeed);
      }
      queryTokens = queryTokens.map(q => fastRotate(new Float32Array(q), this._signVector));
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
    const queryFlat = this._flattenQueryTokens(effectiveQueryTokens, this.tokenDim);

    // Tier 1: Native batch scoring (rayon parallel + SIMD)
    // Partition candidates by quantization type, batch-score each group with
    // the matching native kernel. Candidates without a native path fall through
    // to WASM/JS scoring below. No early returns — all candidates get real
    // MaxSim scores regardless of mixed quantization types in the corpus.
    const nativeScored = new Set(); // candidate ids scored by native kernels

    if (useFlatPath) {
      const groups = { bit4: [], perToken: [], perDoc: [] };
      for (const candidate of toScore) {
        const doc = this.documents.get(candidate.id);
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
        const scores = scoreFn(queryFlat, effectiveQueryTokens.length, this.tokenDim, nativeCands);
        if (scores) {
          for (let i = 0; i < group.length; i++) {
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
    for (const candidate of toScore) {
      if (nativeScored.has(candidate.id)) continue;
      const doc = this.documents.get(candidate.id);
      if (!doc) { pushFallback(candidate); continue; }

      if (useFlatPath) {
        // Try WASM fused 4-bit kernel (no JS dequant needed)
        if (doc.quantBits === 4 && doc.minArray && doc.tokenNorms) {
          const wasmScore = wasmMaxSimDequant4Bit(
            queryFlat, doc.tokens, doc.minArray, doc.scaleArray, doc.tokenNorms,
            effectiveQueryTokens.length, doc.numTokens, doc.dim,
          );
          if (wasmScore !== null) { pushScored(candidate, wasmScore); continue; }
        }

        // Try WASM fused per-token int8 kernel (no JS dequant needed)
        if (doc.minArray && doc.tokenNorms && doc.quantBits !== 4) {
          const wasmScore = wasmMaxSimDequantPerToken(
            queryFlat, doc.tokens, doc.minArray, doc.scaleArray, doc.tokenNorms,
            effectiveQueryTokens.length, doc.numTokens, doc.dim,
          );
          if (wasmScore !== null) { pushScored(candidate, wasmScore); continue; }
        }

        // JS dequant → WASM f32 or JS fallback
        const flatData = this.getTokensFlat(candidate.id);
        if (flatData) {
          pushScored(candidate, this.maxSimScoreFlat(
            effectiveQueryTokens, flatData.flat, flatData.numTokens, flatData.dim,
            doc?.tokenNorms, queryFlat,
          ));
        } else {
          pushFallback(candidate);
        }
      } else {
        const docTokens = this.getTokens(candidate.id);
        if (docTokens) {
          pushScored(candidate, this.maxSimScore(effectiveQueryTokens, docTokens, pruneOpts));
        } else {
          pushFallback(candidate);
        }
      }
    }

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

    // Use segmented format when the doc count exceeds one segment.
    // Always rewrite ALL segments from this.documents (the authoritative
    // state) — never reuse stale segment files from a previous load,
    // because documents may have been removed since then.
    const useSegmented = this.documents.size >= this._segmentSize;

    if (useSegmented) {
      // Derive segment dir from the current save path, NOT from a loaded index
      const segDir = this.indexPath + '.segments';
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
        maxTokens: this.maxTokens,
        useInt8: this.useInt8,
        quantBits: this.quantBits,
        poolFactor: this.poolFactor,
        whtSeed: this.whtSeed || 0,
        totalDocuments: this.documents.size,
        segments: newSegments,
      };

      await fs.writeFile(path.join(segDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

      // Write a stub at the main index path pointing to segments
      await fs.writeFile(this.indexPath, JSON.stringify({
        version: '3.0',
        format: 'segmented',
        segmentDir: segDir,
      }));

      // Update internal state to reflect fresh segments
      this._segmentDir = segDir;
      this._segments = newSegments.map(s => ({ path: path.join(segDir, s.path), count: s.count }));
      this._currentSegment = new Map();

      console.log(`LateInteraction: Saved ${this.documents.size} documents across ${newSegments.length} segments`);
      return;
    }

    // Legacy single-file save (for small indexes or when no add() was called)
    const header = {
      version: '2.1',
      modelId: this.modelId,
      tokenDim: this.tokenDim,
      maxTokens: this.maxTokens,
      useInt8: this.useInt8,
      quantBits: this.quantBits,
      poolFactor: this.poolFactor,
      whtSeed: this.whtSeed || 0,
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

    const sizeMB = (bytesWritten / 1024 / 1024).toFixed(2);
    console.log(`LateInteraction: Saved ${this.documents.size} documents (${sizeMB} MB)`);
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
          await this._loadSegmented(state.segmentDir);
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
      this.maxTokens = state.maxTokens;
      this.useInt8 = state.useInt8;
      this.quantBits = state.quantBits || (state.useInt8 ? 8 : 32);
      this.poolFactor = state.poolFactor || 1;
      if (state.whtSeed !== undefined) this.whtSeed = state.whtSeed;
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

      console.log(`LateInteraction: Loaded ${this.documents.size} documents (model: ${this.modelId || 'legacy'}, ${this.tokenDim}d)`);
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.log('LateInteraction: No existing index found');
      } else {
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
    this.maxTokens = manifest.maxTokens;
    this.useInt8 = manifest.useInt8;
    this.quantBits = manifest.quantBits || (manifest.useInt8 ? 8 : 32);
    this.poolFactor = manifest.poolFactor || 1;
    if (manifest.whtSeed !== undefined) this.whtSeed = manifest.whtSeed;
    if (manifest.modelId) this.modelId = manifest.modelId;

    this.documents.clear();

    const isSSLX = manifest.format === 'sslx-v3';

    for (const seg of manifest.segments) {
      const segPath = path.join(segmentDir, seg.path);
      const docs = await this._readSegmentFile(segPath);

      for (const doc of docs) {
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

        this.documents.set(doc.id, entry);
      }
    }

    for (const doc of this.documents.values()) {
      this._hasPerTokenQuant = !!doc.minArray;
      break;
    }
    this._rebuildTokenNorms();
    this._segmentDir = segmentDir;
    this._segments = manifest.segments.map(s => ({ path: path.join(segmentDir, s.path), count: s.count }));

    console.log(`LateInteraction: Loaded ${this.documents.size} documents from ${manifest.segments.length} segments (model: ${this.modelId || 'legacy'}, ${this.tokenDim}d)`);
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
        console.log(`LateInteraction: Streaming load ${docCount} documents...`);
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
      if (this.documents.has(id)) available.add(id);
    }
    return available;
  }

  /**
   * Get index statistics
   */
  getStats() {
    let totalTokens = 0;
    for (const doc of this.documents.values()) {
      totalTokens += doc.numTokens;
    }

    const avgTokens = this.documents.size > 0 ?
      (totalTokens / this.documents.size).toFixed(1) : 0;

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
      documents: this.documents.size,
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

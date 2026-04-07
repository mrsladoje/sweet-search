#!/usr/bin/env node

/**
 * Late Interaction Index
 *
 * Token-level embeddings with compression for MaxSim scoring.
 * Uses LateOn-Code models for real late interaction.
 *
 * Index format v2.0: stores modelId in header for cross-model consistency checks.
 */

import fs from 'fs/promises';
import { existsSync, createWriteStream, createReadStream } from 'fs';
import path from 'path';
import { DB_PATHS, LATE_INTERACTION_CONFIG } from '../infrastructure/config/index.js';
import { wasmMaxSimF32, nativeMaxSimBatch, initWasm, isNativeMaxSimAvailable } from '../infrastructure/simd-distance.js';

/**
 * Quantize float32 to int8 for storage
 */
function quantizeToInt8(floatArray) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < floatArray.length; i++) {
    const v = floatArray[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }

  // Edge case: if all values are equal (max === min), scale would be 0
  // causing division by zero. In this case, set all int8 values to 0
  // (the midpoint of the int8 range after offset adjustment).
  if (max === min) {
    const int8Array = new Int8Array(floatArray.length);
    // All values are the same, so quantize to 0 (midpoint)
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
const LI_SEGMENT_MAGIC = 0x4C495345; // "LISE" = Late Interaction Segment

export class LateInteractionIndex {
  constructor(options = {}) {
    this.tokenDim = options.tokenDim || LATE_INTERACTION_CONFIG.tokenDimension;
    this.maxTokens = options.maxTokens || 512;
    this.useInt8 = options.useInt8 ?? (LATE_INTERACTION_CONFIG.quantization === 'int8');
    this.indexPath = options.indexPath || DB_PATHS.lateInteraction || path.join(process.cwd(), '.sweet-search', 'late-interaction-tokens.db');
    this.modelId = options.modelId || LATE_INTERACTION_CONFIG.model || null;
    this.poolFactor = options.poolFactor || 1;
    this.streamChunkSize = options.streamChunkSize || (8 * 1024 * 1024);

    // In-memory storage
    this.documents = new Map(); // id -> { tokens, metadata }
    this.initialized = false;

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
    const truncated = tokenEmbeddings.slice(0, this.maxTokens).map(emb =>
      emb.slice(0, this.tokenDim)
    );

    // Flatten typed arrays into a single contiguous buffer.
    // Array.prototype.flat() does NOT flatten Float32Array elements — it leaves them as objects.
    const totalElements = truncated.length * this.tokenDim;
    const flat = new Float32Array(totalElements);
    for (let i = 0; i < truncated.length; i++) {
      flat.set(truncated[i], i * this.tokenDim);
    }

    // Pre-compute per-token L2 norms (always useful for fast cosine scoring).
    // Block-max metadata (maxAbsComp per dimension) is deferred — only computed
    // lazily on first query if norm variance > 0.05 (never for unit-norm models).
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
    if (this.useInt8) {
      const { data, min, scale } = quantizeToInt8(flat);
      docEntry = { tokens: data, numTokens: truncated.length, dim: this.tokenDim, min, scale, metadata, tokenNorms };
    } else {
      docEntry = { tokens: flat, numTokens: truncated.length, dim: this.tokenDim, metadata, tokenNorms };
    }

    this.documents.set(id, docEntry);
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

  /** Write a segment as a binary file with header + JSON document array. */
  async _writeSegmentFile(segPath, segmentMap) {
    const docs = [];
    for (const [id, doc] of segmentMap) {
      docs.push({
        id,
        tokens: Array.from(doc.tokens),
        numTokens: doc.numTokens,
        dim: doc.dim,
        min: doc.min,
        scale: doc.scale,
        metadata: doc.metadata,
      });
    }

    // Header: magic(4) + version(2) + docCount(4) + tokenDim(2) + useInt8(1) + padding(51) = 64 bytes
    const header = Buffer.alloc(64);
    header.writeUInt32LE(LI_SEGMENT_MAGIC, 0);
    header.writeUInt16LE(1, 4); // version
    header.writeUInt32LE(docs.length, 6);
    header.writeUInt16LE(this.tokenDim, 10);
    header.writeUInt8(this.useInt8 ? 1 : 0, 12);

    const body = Buffer.from(JSON.stringify(docs));
    await fs.writeFile(segPath, Buffer.concat([header, body]));
  }

  /** Read a segment file and return its documents array. */
  async _readSegmentFile(segPath) {
    const buf = await fs.readFile(segPath);
    const magic = buf.readUInt32LE(0);
    if (magic !== LI_SEGMENT_MAGIC) {
      throw new Error(`Invalid segment file: ${segPath}`);
    }
    const body = buf.subarray(64);
    return JSON.parse(body.toString('utf-8'));
  }

  /**
   * Get token embeddings for a document
   */
  getTokens(id) {
    const doc = this.documents.get(id);
    if (!doc) return null;

    let tokens;
    if (this.useInt8 && doc.min !== undefined) {
      // Dequantize
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
    if (this.useInt8 && doc.min !== undefined) {
      // Pool dequantization buffer to avoid 256KB alloc per candidate
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

    const queryTokens = queryTokenEmbeddings.map(emb =>
      emb.slice(0, this.tokenDim)
    );

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
    if (useFlatPath && this.useInt8 && isNativeMaxSimAvailable()) {
      const nativeCandidates = [];
      const candidateOrder = [];

      for (const candidate of toScore) {
        const doc = this.documents.get(candidate.id);
        if (doc && doc.min !== undefined) {
          nativeCandidates.push({
            tokens: Buffer.from(doc.tokens.buffer, doc.tokens.byteOffset, doc.tokens.byteLength),
            numTokens: doc.numTokens,
            dim: doc.dim,
            min: doc.min,
            scale: doc.scale,
          });
          candidateOrder.push(candidate);
        } else {
          pushFallback(candidate);
        }
      }

      if (nativeCandidates.length > 0) {
        const scores = nativeMaxSimBatch(
          queryFlat, effectiveQueryTokens.length, this.tokenDim, nativeCandidates,
        );

        if (scores) {
          for (let i = 0; i < candidateOrder.length; i++) {
            pushScored(candidateOrder[i], scores[i]);
          }
          for (const candidate of pruned) pushFallback(candidate, { _pruned: true });
          scored.sort((a, b) => b.lateInteractionScore - a.lateInteractionScore);
          return scored;
        }
      }
    }

    // Tier 2 & 3: per-candidate scoring (WASM or JS)
    for (const candidate of toScore) {
      if (useFlatPath) {
        const flatData = this.getTokensFlat(candidate.id);
        if (flatData) {
          const doc = this.documents.get(candidate.id);
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
        format: 'segmented',
        modelId: this.modelId,
        tokenDim: this.tokenDim,
        maxTokens: this.maxTokens,
        useInt8: this.useInt8,
        poolFactor: this.poolFactor,
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
      poolFactor: this.poolFactor,
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
        const entry = JSON.stringify({
          id,
          tokens: Array.from(doc.tokens),
          numTokens: doc.numTokens,
          dim: doc.dim,
          min: doc.min,
          scale: doc.scale,
          metadata: doc.metadata,
        });

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
      this.poolFactor = state.poolFactor || 1;
      if (state.modelId) this.modelId = state.modelId;

      // Documents may already be loaded by streaming path
      if (state.documents && !this._streamLoaded) {
        this.documents.clear();
        for (const doc of state.documents) {
          const tokens = this.useInt8 ?
            new Int8Array(doc.tokens) :
            new Float32Array(doc.tokens);

          this.documents.set(doc.id, {
            tokens,
            numTokens: doc.numTokens,
            dim: doc.dim,
            min: doc.min,
            scale: doc.scale,
            metadata: doc.metadata
          });
        }
      }
      this._streamLoaded = false;

      // Reconstruct tokenNorms (not persisted — recomputed from tokens on load)
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
    this.poolFactor = manifest.poolFactor || 1;
    if (manifest.modelId) this.modelId = manifest.modelId;

    this.documents.clear();

    for (const seg of manifest.segments) {
      const segPath = path.join(segmentDir, seg.path);
      const docs = await this._readSegmentFile(segPath);

      for (const doc of docs) {
        const tokens = this.useInt8 ? new Int8Array(doc.tokens) : new Float32Array(doc.tokens);
        this.documents.set(doc.id, {
          tokens,
          numTokens: doc.numTokens,
          dim: doc.dim,
          min: doc.min,
          scale: doc.scale,
          metadata: doc.metadata,
        });
      }
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
      const tokens = header.useInt8 ?
        new Int8Array(doc.tokens) :
        new Float32Array(doc.tokens);

      this.documents.set(doc.id, {
        tokens,
        numTokens: doc.numTokens,
        dim: doc.dim,
        min: doc.min,
        scale: doc.scale,
        metadata: doc.metadata,
      });

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
      if (doc.tokenNorms) continue; // already has norms (e.g., from add())

      let flat;
      if (this.useInt8 && doc.min !== undefined) {
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

    // Estimate storage
    const bytesPerToken = this.useInt8 ? this.tokenDim : this.tokenDim * 4;
    const estimatedMB = (totalTokens * bytesPerToken / 1024 / 1024).toFixed(2);

    return {
      documents: this.documents.size,
      totalTokens,
      avgTokensPerDoc: avgTokens,
      tokenDim: this.tokenDim,
      useInt8: this.useInt8,
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

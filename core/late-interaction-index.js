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
import { existsSync } from 'fs';
import path from 'path';
import { DB_PATHS, LATE_INTERACTION_CONFIG } from './config.js';

/**
 * Quantize float32 to int8 for storage
 */
function quantizeToInt8(floatArray) {
  const min = Math.min(...floatArray);
  const max = Math.max(...floatArray);

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
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
}

/**
 * Late Interaction Index Class
 */
export class LateInteractionIndex {
  constructor(options = {}) {
    this.tokenDim = options.tokenDim || LATE_INTERACTION_CONFIG.tokenDimension;
    this.maxTokens = options.maxTokens || 512;
    this.useInt8 = options.useInt8 ?? (LATE_INTERACTION_CONFIG.quantization === 'int8');
    this.indexPath = options.indexPath || DB_PATHS.lateInteraction || path.join(process.cwd(), '.sweet-search', 'late-interaction-tokens.db');
    this.modelId = options.modelId || LATE_INTERACTION_CONFIG.model || null;
    this.poolFactor = options.poolFactor || 1;

    // In-memory storage
    this.documents = new Map(); // id -> { tokens, metadata }
    this.initialized = false;
  }

  /**
   * Initialize or load index
   */
  async init() {
    if (this.initialized) return;

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

    if (this.useInt8) {
      // Quantize all tokens together for consistent scale
      const flat = truncated.flat();
      const { data, min, scale } = quantizeToInt8(flat);

      this.documents.set(id, {
        tokens: data,
        numTokens: truncated.length,
        dim: this.tokenDim,
        min,
        scale,
        metadata
      });
    } else {
      this.documents.set(id, {
        tokens: new Float32Array(truncated.flat()),
        numTokens: truncated.length,
        dim: this.tokenDim,
        metadata
      });
    }
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
   * MaxSim scoring - late interaction
   *
   * For each query token, find max similarity with any document token.
   * Sum these max similarities for final score.
   */
  maxSimScore(queryTokens, docTokens) {
    if (!docTokens || docTokens.length === 0) return 0;

    let totalScore = 0;

    for (const queryToken of queryTokens) {
      let maxSim = -Infinity;

      for (const docToken of docTokens) {
        const sim = cosineSimilarity(queryToken, docToken);
        if (sim > maxSim) maxSim = sim;
      }

      totalScore += Math.max(0, maxSim);
    }

    return totalScore / queryTokens.length;
  }

  /**
   * Score candidates using MaxSim late interaction
   *
   * @param {number[][]} queryTokenEmbeddings - Query token embeddings
   * @param {Array} candidates - Array of { id, ... } candidates
   * @returns {Array} Candidates with lateInteractionScore added
   */
  async scoreWithLateInteraction(queryTokenEmbeddings, candidates) {
    await this.init();

    const queryTokens = queryTokenEmbeddings.map(emb =>
      emb.slice(0, this.tokenDim)
    );

    const scored = [];

    for (const candidate of candidates) {
      const docTokens = this.getTokens(candidate.id);

      if (docTokens) {
        const lateInteractionScore = this.maxSimScore(queryTokens, docTokens);
        scored.push({
          ...candidate,
          lateInteractionScore,
          originalScore: candidate.score
        });
      } else {
        scored.push({
          ...candidate,
          lateInteractionScore: candidate.score || 0,
          originalScore: candidate.score
        });
      }
    }

    // Sort by late interaction score
    scored.sort((a, b) => b.lateInteractionScore - a.lateInteractionScore);

    return scored;
  }

  /**
   * Save index to disk
   */
  async save() {
    await fs.mkdir(path.dirname(this.indexPath), { recursive: true });

    const state = {
      version: '2.1',
      modelId: this.modelId,
      tokenDim: this.tokenDim,
      maxTokens: this.maxTokens,
      useInt8: this.useInt8,
      poolFactor: this.poolFactor,
      documents: []
    };

    for (const [id, doc] of this.documents) {
      state.documents.push({
        id,
        tokens: Array.from(doc.tokens),
        numTokens: doc.numTokens,
        dim: doc.dim,
        min: doc.min,
        scale: doc.scale,
        metadata: doc.metadata
      });
    }

    await fs.writeFile(this.indexPath, JSON.stringify(state));

    const size = (JSON.stringify(state).length / 1024 / 1024).toFixed(2);
    console.log(`LateInteraction: Saved ${this.documents.size} documents (${size} MB)`);
  }

  /**
   * Load index from disk
   */
  async load() {
    try {
      const data = await fs.readFile(this.indexPath, 'utf-8');
      const state = JSON.parse(data);

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

      console.log(`LateInteraction: Loaded ${this.documents.size} documents (model: ${this.modelId || 'legacy'}, ${this.tokenDim}d)`);
    } catch (err) {
      console.log('LateInteraction: No existing index found');
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

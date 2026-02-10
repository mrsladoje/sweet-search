#!/usr/bin/env node

/**
 * ColBERT Late Interaction Index
 *
 * Token-level embeddings with compression for MaxSim scoring.
 * Achieves cross-encoder quality at bi-encoder speed.
 *
 * Storage optimization (from research):
 * - 64-dim instead of 128-dim (1.5% accuracy loss, 50% storage savings)
 * - int8 quantization (4x compression)
 * - Result: ~200-700MB for 11k chunks instead of 25GB
 *
 * References:
 * - Jina ColBERT v2: https://jina.ai/news/jina-colbert-v2-multilingual-late-interaction-retriever-for-embedding-and-reranking/
 * - ColBERT pooling: https://www.answer.ai/posts/colbert-pooling.html
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { DB_PATHS } from './config.js';

const COLBERT_CONFIG = {
  tokenDim: 64,           // Reduced from 128 (1.5% accuracy loss, 50% storage savings)
  maxTokensPerDoc: 256,   // Max tokens to store per document
  useInt8: true,          // int8 quantization (4x compression)
  indexPath: DB_PATHS.colbert || path.join(process.cwd(), '.sweet-search', 'colbert-tokens.db'),
};

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
 * ColBERT Index Class
 */
export class ColBERTIndex {
  constructor(options = {}) {
    this.tokenDim = options.tokenDim || COLBERT_CONFIG.tokenDim;
    this.maxTokens = options.maxTokens || COLBERT_CONFIG.maxTokensPerDoc;
    this.useInt8 = options.useInt8 ?? COLBERT_CONFIG.useInt8;
    this.indexPath = options.indexPath || COLBERT_CONFIG.indexPath;

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
   * MaxSim scoring - ColBERT late interaction
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
   * Score candidates using ColBERT MaxSim
   *
   * @param {number[][]} queryTokenEmbeddings - Query token embeddings
   * @param {Array} candidates - Array of { id, ... } candidates
   * @returns {Array} Candidates with colbertScore added
   */
  async scoreWithColBERT(queryTokenEmbeddings, candidates) {
    await this.init();

    const queryTokens = queryTokenEmbeddings.map(emb =>
      emb.slice(0, this.tokenDim)
    );

    const scored = [];

    for (const candidate of candidates) {
      const docTokens = this.getTokens(candidate.id);

      if (docTokens) {
        const colbertScore = this.maxSimScore(queryTokens, docTokens);
        scored.push({
          ...candidate,
          colbertScore,
          originalScore: candidate.score
        });
      } else {
        scored.push({
          ...candidate,
          colbertScore: candidate.score || 0,
          originalScore: candidate.score
        });
      }
    }

    // Sort by ColBERT score
    scored.sort((a, b) => b.colbertScore - a.colbertScore);

    return scored;
  }

  /**
   * Save index to disk
   */
  async save() {
    await fs.mkdir(path.dirname(this.indexPath), { recursive: true });

    const state = {
      version: '1.0',
      tokenDim: this.tokenDim,
      maxTokens: this.maxTokens,
      useInt8: this.useInt8,
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
    console.log(`ColBERT: Saved ${this.documents.size} documents (${size} MB)`);
  }

  /**
   * Load index from disk
   */
  async load() {
    try {
      const data = await fs.readFile(this.indexPath, 'utf-8');
      const state = JSON.parse(data);

      this.tokenDim = state.tokenDim;
      this.maxTokens = state.maxTokens;
      this.useInt8 = state.useInt8;

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

      console.log(`ColBERT: Loaded ${this.documents.size} documents`);
    } catch (err) {
      console.log('ColBERT: No existing index found');
    }
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
      estimatedSizeMB: estimatedMB
    };
  }
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  if (args.includes('--test')) {
    console.log('Testing ColBERT Index...\n');

    const index = new ColBERTIndex();
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
    const scored = await index.scoreWithColBERT(queryTokens, candidates);

    console.log('\nMaxSim Scores:');
    for (const s of scored) {
      console.log(`  ${s.id}: ${s.colbertScore.toFixed(4)}`);
    }

    // Save and reload
    await index.save();
    console.log('\nSaved and reloading...');

    const index2 = new ColBERTIndex();
    await index2.init();
    console.log('Reloaded stats:', index2.getStats());

  } else if (args.includes('--stats')) {
    const index = new ColBERTIndex();
    await index.init();
    console.log('ColBERT Index Stats:', index.getStats());

  } else {
    console.log(`
ColBERT Late Interaction Index

Usage:
  node colbert-index.js --test    Run test with fake data
  node colbert-index.js --stats   Show index statistics

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

export default ColBERTIndex;

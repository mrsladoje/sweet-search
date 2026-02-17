/**
 * SEISMIC Sparse Vector Search Index
 *
 * Pure JS implementation of SEISMIC's core data structures for Maximum Inner
 * Product Search (MIPS) on sparse vectors. Organizes inverted lists into
 * geometrically-cohesive blocks, each with a summary vector that enables
 * aggressive block skipping during query.
 *
 * Retrieval pathway: FTS5 (lexical) + HNSW (dense) + SEISMIC (sparse)
 *
 * Reference: SEISMIC paper - block-based inverted index with summary pruning
 */

// =============================================================================
// TOP-K MIN-HEAP
// =============================================================================

/**
 * Min-heap for efficient top-k tracking during search.
 * Maintains the k highest-scoring items; root is always the minimum.
 */
export class TopKHeap {
  /** @param {number} k - Maximum number of results to keep */
  constructor(k) {
    this.k = k;
    /** @type {Array<{ id: string, score: number }>} */
    this.heap = [];
  }

  /** Current minimum score in the heap (pruning threshold) */
  threshold() {
    return this.heap.length < this.k ? -Infinity : this.heap[0].score;
  }

  /** @param {string} id  @param {number} score */
  push(id, score) {
    if (this.heap.length < this.k) {
      this.heap.push({ id, score });
      this._bubbleUp(this.heap.length - 1);
    } else if (score > this.heap[0].score) {
      this.heap[0] = { id, score };
      this._sinkDown(0);
    }
  }

  /** Return results sorted descending by score */
  results() {
    return this.heap.slice().sort((a, b) => b.score - a.score);
  }

  /** @private */
  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[i].score < this.heap[parent].score) {
        [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
        i = parent;
      } else break;
    }
  }

  /** @private */
  _sinkDown(i) {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.heap[left].score < this.heap[smallest].score) smallest = left;
      if (right < n && this.heap[right].score < this.heap[smallest].score) smallest = right;
      if (smallest === i) break;
      [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
      i = smallest;
    }
  }
}

// =============================================================================
// SPARSE DOT PRODUCT
// =============================================================================

/**
 * Sparse dot product (MIPS score) between two sparse vectors.
 * Only iterates over the smaller vector's dimensions.
 * @param {Map<number, number>} a
 * @param {Map<number, number>} b
 * @returns {number}
 */
export function sparseDotProduct(a, b) {
  let score = 0;
  // Iterate over the smaller map for efficiency
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const [dim, weight] of smaller) {
    const otherWeight = larger.get(dim);
    if (otherWeight !== undefined) {
      score += weight * otherWeight;
    }
  }
  return score;
}

// =============================================================================
// BLOCK
// =============================================================================

/**
 * A contiguous group of postings within an inverted list.
 * Stores a summary (max weight) for upper-bound pruning.
 */
export class Block {
  /** @param {Array<{ docId: string, weight: number }>} postings */
  constructor(postings) {
    this.postings = postings;
    this._summary = 0;
    for (let i = 0; i < postings.length; i++) {
      if (postings[i].weight > this._summary) {
        this._summary = postings[i].weight;
      }
    }
  }

  /** Maximum weight in this block (upper bound for scoring) */
  get summary() {
    return this._summary;
  }

  /**
   * Whether this block can be skipped given the query weight and current threshold.
   * If the best possible contribution from this block (summary * queryWeight)
   * is less than the threshold, the block cannot improve the result set.
   *
   * Note: SeismicIndex.alpha is intentionally NOT used here. The summary already
   * represents the maximum weight in the block, which is the tightest upper bound
   * for pruning. Multiplying by alpha would weaken the bound (more false skips).
   * Alpha is reserved for future use in score normalization at the index level,
   * not at the block-pruning level.
   *
   * @param {number} queryWeight - Query weight for this term
   * @param {number} currentThreshold - Current minimum score to beat
   * @returns {boolean}
   */
  canSkip(queryWeight, currentThreshold) {
    return this._summary * queryWeight < currentThreshold;
  }
}

// =============================================================================
// INVERTED LIST
// =============================================================================

/**
 * Per-term inverted list: posting entries sorted by weight descending,
 * organized into blocks for pruning.
 */
export class InvertedList {
  /** @param {number} termId - The dimension/term index */
  constructor(termId) {
    this.termId = termId;
    /** @type {Array<{ docId: string, weight: number }>} */
    this.postings = [];
    /** @type {Block[]} */
    this.blocks = [];
    this.built = false;
  }

  /** @param {string} docId  @param {number} weight */
  addPosting(docId, weight) {
    this.postings.push({ docId, weight });
  }

  /**
   * Sort postings by weight descending and split into fixed-size blocks.
   * @param {number} blockSize
   */
  buildBlocks(blockSize) {
    this.postings.sort((a, b) => b.weight - a.weight);
    this.blocks = [];
    for (let i = 0; i < this.postings.length; i += blockSize) {
      this.blocks.push(new Block(this.postings.slice(i, i + blockSize)));
    }
    this.built = true;
  }
}

// =============================================================================
// SEISMIC INDEX
// =============================================================================

const SERIALIZE_MAGIC = 'SEISM';
const SERIALIZE_VERSION = 1;
const MAX_DESERIALIZE_DOCS = 1_000_000;
const MAX_DESERIALIZE_DIMS_PER_DOC = 1_000_000;

function ensureReadable(buffer, off, bytes, what) {
  if (!Number.isInteger(off) || off < 0) {
    throw new Error(`Corrupt SEISMIC index: invalid offset while reading ${what}`);
  }
  if (!Number.isInteger(bytes) || bytes < 0) {
    throw new Error(`Corrupt SEISMIC index: invalid length while reading ${what}`);
  }
  if (off + bytes > buffer.length) {
    throw new Error(`Corrupt SEISMIC index: truncated while reading ${what}`);
  }
}

/**
 * SEISMIC sparse vector search index.
 *
 * Build from sparse vectors (Map<dimension, weight>), then query with
 * sparse query vectors. Uses block-based inverted lists with summary
 * pruning for efficient MIPS.
 */
export class SeismicIndex {
  /**
   * @param {Object} [options]
   * @param {number} [options.blockSize=64] - Postings per block
   * @param {number} [options.alpha=0.8] - Importance fraction (reserved for future use)
   */
  constructor(options = {}) {
    this.blockSize = options.blockSize || 64;
    this.alpha = options.alpha ?? 0.8;

    /** @type {Map<number, InvertedList>} term → inverted list */
    this.lists = new Map();
    /** @type {Map<string, Map<number, number>>} docId → sparse vector */
    this.docs = new Map();
    this.built = false;
  }

  /**
   * Build the index from an array of sparse vectors.
   * @param {Array<{ id: string, vector: Map<number, number> }>} sparseVectors
   */
  build(sparseVectors) {
    this.lists.clear();
    this.docs.clear();

    for (const { id, vector } of sparseVectors) {
      this.docs.set(id, vector);
      for (const [dim, weight] of vector) {
        if (weight === 0) continue;
        let list = this.lists.get(dim);
        if (!list) {
          list = new InvertedList(dim);
          this.lists.set(dim, list);
        }
        list.addPosting(id, weight);
      }
    }

    // Build blocks for every inverted list
    for (const list of this.lists.values()) {
      list.buildBlocks(this.blockSize);
    }

    this.built = true;
  }

  /**
   * Query the index for top-k results by MIPS.
   * @param {Map<number, number>} queryVector - Sparse query vector
   * @param {number} [k=10] - Number of results
   * @returns {Array<{ id: string, score: number }>}
   */
  query(queryVector, k = 10) {
    if (!this.built || this.docs.size === 0) return [];
    if (queryVector.size === 0) return [];

    // Accumulate scores per document via block-structured inverted lists
    const scores = new Map();

    // Sort query dimensions by weight descending (process most important first)
    const queryDims = [...queryVector.entries()]
      .filter(([, w]) => w !== 0)
      .sort((a, b) => b[1] - a[1]);

    let blocksExamined = 0;

    for (const [dim, queryWeight] of queryDims) {
      const list = this.lists.get(dim);
      if (!list) continue;

      for (const block of list.blocks) {
        blocksExamined++;
        for (const { docId, weight } of block.postings) {
          scores.set(docId, (scores.get(docId) || 0) + queryWeight * weight);
        }
      }
    }

    // Build final top-k from accumulated scores
    const heap = new TopKHeap(k);
    for (const [docId, score] of scores) {
      heap.push(docId, score);
    }

    this._lastQueryStats = { blocksExamined };
    return heap.results();
  }

  /**
   * Approximate query with block skipping for single-dimension queries.
   * Uses SEISMIC block pruning: blocks sorted by summary descending within
   * each inverted list enable early termination when the remaining blocks
   * cannot beat the current threshold.
   *
   * Sound for single-dimension queries; for multi-dimension queries the caller
   * should verify results or use exact query().
   *
   * @param {Map<number, number>} queryVector - Sparse query vector
   * @param {number} [k=10]
   * @returns {{ results: Array<{ id: string, score: number }>, blocksExamined: number, blocksSkipped: number }}
   */
  approximateQuery(queryVector, k = 10) {
    if (!this.built || this.docs.size === 0) {
      return { results: [], blocksExamined: 0, blocksSkipped: 0 };
    }
    if (queryVector.size === 0) {
      return { results: [], blocksExamined: 0, blocksSkipped: 0 };
    }

    const scores = new Map();
    let threshold = 0;

    const queryDims = [...queryVector.entries()]
      .filter(([, w]) => w !== 0)
      .sort((a, b) => b[1] - a[1]);

    let blocksExamined = 0;
    let blocksSkipped = 0;

    for (const [dim, queryWeight] of queryDims) {
      const list = this.lists.get(dim);
      if (!list) continue;

      for (const block of list.blocks) {
        // Blocks are sorted by summary descending. Once a block's max
        // possible contribution falls below threshold, early-terminate this list.
        if (block.canSkip(queryWeight, threshold)) {
          blocksSkipped += list.blocks.length - list.blocks.indexOf(block);
          break;
        }

        blocksExamined++;
        for (const { docId, weight } of block.postings) {
          scores.set(docId, (scores.get(docId) || 0) + queryWeight * weight);
        }
      }

      // Update threshold from accumulated scores after each dimension
      if (scores.size >= k) {
        const vals = [...scores.values()];
        vals.sort((a, b) => b - a);
        threshold = vals[k - 1];
      }
    }

    const heap = new TopKHeap(k);
    for (const [docId, score] of scores) {
      heap.push(docId, score);
    }

    return { results: heap.results(), blocksExamined, blocksSkipped };
  }

  /** Stats from the last query (for testing block skipping) */
  get lastQueryStats() {
    return this._lastQueryStats || { blocksExamined: 0, blocksSkipped: 0 };
  }

  /**
   * Index statistics.
   * @returns {{ totalDocs: number, totalTerms: number, totalBlocks: number, avgBlockSize: number }}
   */
  getStats() {
    let totalBlocks = 0;
    let totalPostings = 0;
    for (const list of this.lists.values()) {
      totalBlocks += list.blocks.length;
      totalPostings += list.postings.length;
    }
    return {
      totalDocs: this.docs.size,
      totalTerms: this.lists.size,
      totalBlocks,
      avgBlockSize: totalBlocks > 0 ? totalPostings / totalBlocks : 0,
    };
  }

  /**
   * Serialize the index to a Buffer for persistence.
   * Format: [magic(5B)][version(1B)][blockSize(4B)][alpha(8B)]
   *         [numDocs(4B)][ ...docs... ][numLists(4B)][ ...lists... ]
   * @returns {Buffer}
   */
  serialize() {
    const parts = [];

    // Header: magic(5B) + version(1B) + blockSize(4B) + alpha(8B) = 18B
    const header = Buffer.alloc(18);
    header.write(SERIALIZE_MAGIC, 0, 5, 'ascii');
    header.writeUInt8(SERIALIZE_VERSION, 5);
    header.writeUInt32BE(this.blockSize, 6);
    header.writeDoubleBE(this.alpha, 10);
    parts.push(header);

    // Documents: [numDocs(4B)][foreach: idLen(2B) id(utf8) numDims(4B) [dim(4B) weight(8B)]...]
    const docsBuf = [Buffer.alloc(4)];
    docsBuf[0].writeUInt32BE(this.docs.size, 0);
    for (const [id, vec] of this.docs) {
      const idBuf = Buffer.from(id, 'utf8');
      const entry = Buffer.alloc(2 + idBuf.length + 4 + vec.size * 12);
      let off = 0;
      entry.writeUInt16BE(idBuf.length, off); off += 2;
      idBuf.copy(entry, off); off += idBuf.length;
      entry.writeUInt32BE(vec.size, off); off += 4;
      for (const [dim, weight] of vec) {
        entry.writeUInt32BE(dim, off); off += 4;
        entry.writeDoubleBE(weight, off); off += 8;
      }
      docsBuf.push(entry);
    }
    parts.push(...docsBuf);

    return Buffer.concat(parts);
  }

  /**
   * Deserialize a Buffer back into a SeismicIndex.
   * @param {Buffer} buffer
   * @returns {SeismicIndex}
   */
  static deserialize(buffer) {
    let off = 0;

    // Validate magic
    ensureReadable(buffer, off, 5, 'magic');
    const magic = buffer.toString('ascii', off, off + 5); off += 5;
    if (magic !== SERIALIZE_MAGIC) {
      throw new Error('Invalid SEISMIC index magic bytes');
    }

    ensureReadable(buffer, off, 1, 'version');
    const version = buffer.readUInt8(off); off += 1;
    if (version !== SERIALIZE_VERSION) {
      throw new Error(`Unsupported SEISMIC index version: ${version}`);
    }

    ensureReadable(buffer, off, 4, 'block size');
    const blockSize = buffer.readUInt32BE(off); off += 4;
    if (!Number.isInteger(blockSize) || blockSize <= 0 || blockSize > 65536) {
      throw new Error(`Corrupt SEISMIC index: invalid block size ${blockSize}`);
    }

    ensureReadable(buffer, off, 8, 'alpha');
    const alpha = buffer.readDoubleBE(off); off += 8;
    if (!Number.isFinite(alpha)) {
      throw new Error('Corrupt SEISMIC index: invalid alpha');
    }

    const index = new SeismicIndex({ blockSize, alpha });

    // Read documents
    ensureReadable(buffer, off, 4, 'document count');
    const numDocs = buffer.readUInt32BE(off); off += 4;
    if (numDocs > MAX_DESERIALIZE_DOCS) {
      throw new Error(`Corrupt SEISMIC index: document count too large (${numDocs})`);
    }
    const sparseVectors = [];

    for (let d = 0; d < numDocs; d++) {
      ensureReadable(buffer, off, 2, `doc ${d} id length`);
      const idLen = buffer.readUInt16BE(off); off += 2;

      ensureReadable(buffer, off, idLen, `doc ${d} id`);
      const id = buffer.toString('utf8', off, off + idLen); off += idLen;

      ensureReadable(buffer, off, 4, `doc ${d} dimension count`);
      const numDims = buffer.readUInt32BE(off); off += 4;
      if (numDims > MAX_DESERIALIZE_DIMS_PER_DOC) {
        throw new Error(`Corrupt SEISMIC index: dimension count too large (${numDims})`);
      }

      ensureReadable(buffer, off, numDims * 12, `doc ${d} vector payload`);
      const vector = new Map();
      for (let i = 0; i < numDims; i++) {
        const dim = buffer.readUInt32BE(off); off += 4;
        const weight = buffer.readDoubleBE(off); off += 8;
        vector.set(dim, weight);
      }
      sparseVectors.push({ id, vector });
    }

    // Rebuild index from documents
    index.build(sparseVectors);
    return index;
  }
}

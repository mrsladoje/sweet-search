/**
 * Embedding-similarity contamination filter.
 *
 * Layer 2 of the three-layer protocol in §11.1: catches paraphrase
 * contamination that exact n-gram match misses. Compares each probe's
 * needle against a corpus of pretraining-dump chunk embeddings and flags
 * any whose nearest-neighbour cosine similarity exceeds the threshold
 * (default 0.92, per CodeRankEmbed-on-CoIR sensitivity studies).
 *
 * Embedder is dependency-injected so this module stays pure and avoids
 * pulling the runtime CodeRankEmbed wiring into the build-time bounded
 * context. Caller wires a real embedder (or a mock for tests). The plan's
 * default is CodeRankEmbed; nothing in this filter assumes that.
 *
 * @param {object} args
 * @param {Array<{ id: string, needle: string }>} args.probes
 * @param {string[]} args.corpusChunks   — already-chunked pretraining text
 * @param {(texts: string[]) => Promise<number[][]>} args.embedder
 *   Batch embedder. Should return ℓ2-normalised vectors so cosine collapses
 *   to a dot product. The filter does NOT re-normalise.
 * @param {number} [args.threshold=0.92]
 * @param {number} [args.batchSize=64]
 * @returns {Promise<{
 *   flagged: Array<{ id: string, score: number, chunkIndex: number }>,
 *   clean: string[],
 *   stats: { probesChecked: number, probesFlagged: number, threshold: number, corpusChunks: number },
 * }>}
 */
export async function embeddingDecontaminate({
  probes,
  corpusChunks,
  embedder,
  threshold = 0.92,
  batchSize = 64,
}) {
  if (!Array.isArray(probes)) throw new TypeError('embedding-filter: probes must be an array');
  if (!Array.isArray(corpusChunks)) {
    throw new TypeError('embedding-filter: corpusChunks must be an array');
  }
  if (typeof embedder !== 'function') {
    throw new TypeError('embedding-filter: embedder must be a function (texts) => Promise<number[][]>');
  }
  if (!(threshold > 0 && threshold <= 1)) {
    throw new RangeError('embedding-filter: threshold must be in (0, 1]');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError('embedding-filter: batchSize must be a positive integer');
  }

  if (probes.length === 0 || corpusChunks.length === 0) {
    return {
      flagged: [],
      clean: probes.map(p => p.id),
      stats: { probesChecked: probes.length, probesFlagged: 0, threshold, corpusChunks: corpusChunks.length },
    };
  }

  const corpusVecs = [];
  for (let i = 0; i < corpusChunks.length; i += batchSize) {
    const batch = corpusChunks.slice(i, i + batchSize);
    const vecs = await embedder(batch);
    if (!Array.isArray(vecs) || vecs.length !== batch.length) {
      throw new Error('embedding-filter: embedder returned wrong-shape result');
    }
    corpusVecs.push(...vecs);
  }

  const flagged = [];
  const clean = [];
  for (let i = 0; i < probes.length; i += batchSize) {
    const batch = probes.slice(i, i + batchSize);
    const probeVecs = await embedder(batch.map(p => p.needle));
    if (!Array.isArray(probeVecs) || probeVecs.length !== batch.length) {
      throw new Error('embedding-filter: embedder returned wrong-shape result for probes');
    }
    for (let j = 0; j < batch.length; j++) {
      const probe = batch[j];
      const v = probeVecs[j];
      let bestScore = -Infinity;
      let bestIdx = -1;
      for (let k = 0; k < corpusVecs.length; k++) {
        const score = dot(v, corpusVecs[k]);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = k;
        }
      }
      if (bestScore >= threshold) {
        flagged.push({ id: probe.id, score: bestScore, chunkIndex: bestIdx });
      } else {
        clean.push(probe.id);
      }
    }
  }

  return {
    flagged,
    clean,
    stats: {
      probesChecked: probes.length,
      probesFlagged: flagged.length,
      threshold,
      corpusChunks: corpusChunks.length,
    },
  };
}

function dot(a, b) {
  if (a.length !== b.length) {
    throw new RangeError(`embedding-filter: dim mismatch (${a.length} vs ${b.length})`);
  }
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

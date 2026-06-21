/**
 * Indexing dedup phase.
 *
 * Runs after chunking, before embedding/LI encoding. Mutates allChunks in
 * place so both the vector and LI paths see the same annotations:
 *   - metadata.simhash        16-hex u64
 *   - metadata.clusterId      16-hex SHA1 (null for singletons)
 *   - metadata.exemplarId     chunk id of this cluster's exemplar (null if self)
 *   - metadata.isExemplar     boolean
 *
 * Downstream: aliases (metadata.exemplarId !== null) skip the bi-encoder
 * forward pass and the LI encoder, reusing the exemplar's vectors.
 */

import {
  isDedupAvailable,
  computeFingerprints,
  clusterFingerprints,
  DEDUP_CONFIG,
} from '../../infrastructure/index.js';
import { selectExemplar } from './exemplar-selector.js';

/**
 * Partition annotated chunks into exemplar vs alias lists, preserving original
 * order within each list. Used by the embedding and LI paths to split work.
 */
export function partitionByExemplar(allChunks, texts = null) {
  const exemplars = [];
  const aliases = [];
  const exemplarTexts = texts ? [] : null;
  for (let i = 0; i < allChunks.length; i++) {
    const chunk = allChunks[i];
    if (chunk.metadata?.exemplarId) {
      aliases.push(chunk);
    } else {
      exemplars.push(chunk);
      if (texts) exemplarTexts.push(texts[i]);
    }
  }
  return { exemplars, exemplarTexts, aliases };
}

/**
 * Run dedup on `allChunks` in place.
 *
 * Returns `{ skipped, reason?, stats }`.
 * When skipped, chunks retain their original shape and downstream treats
 * every chunk as its own exemplar (no annotations added).
 */
export async function runDedupPhase(allChunks, config = DEDUP_CONFIG) {
  if (!config.enabled) return { skipped: true, reason: 'disabled' };
  if (!isDedupAvailable()) {
    return { skipped: true, reason: 'native_addon_unavailable' };
  }
  if (!Array.isArray(allChunks) || allChunks.length === 0) {
    return { skipped: true, reason: 'empty' };
  }

  const texts = allChunks.map((c) => c.text || c.content || '');
  const fingerprints = computeFingerprints(texts, config);
  const clusters = clusterFingerprints(fingerprints, config);

  const stats = annotateDedupClusters(allChunks, fingerprints, clusters, config);

  return { skipped: false, stats };
}

/**
 * Apply dedup annotations (simhash + exemplar/alias assignment) to a list of
 * `items` given their `fingerprints` and the `clusters` from
 * clusterFingerprints(). Mutates each item's `.metadata` in place and returns
 * the stats object.
 *
 * `items[i]` must expose `.id`, a mutable `.metadata`, and be acceptable to
 * selectExemplar (text length via `.text`/`.content` OR a precomputed
 * `._textLen`, plus path/hash fields). The full-corpus path passes the chunk
 * objects directly; the streaming path passes lightweight per-chunk records
 * (text spilled to disk, length carried as `_textLen`) so the SAME global
 * dedup runs without holding every chunk's text in memory. Both paths produce
 * byte-identical annotations.
 */
export function annotateDedupClusters(items, fingerprints, clusters, config = DEDUP_CONFIG) {
  // Seed every item with simhash + self-exemplar defaults.
  for (let i = 0; i < items.length; i++) {
    const meta = (items[i].metadata = items[i].metadata || {});
    meta.simhash = fingerprints[i].simhashHex;
    meta.isExemplar = true;
    meta.exemplarId = null;
    meta.clusterId = null;
  }

  let clustersWithSiblings = 0;
  let totalAliases = 0;
  let liEligibleAliases = 0;
  let bytesSaved = 0;
  const liJaccardThreshold = config.liReuseEnabled
    ? (config.liReuseJaccardThreshold ?? 0.95)
    : Infinity;

  const lenOf = (it) =>
    typeof it._textLen === 'number' ? it._textLen : (it.text || it.content || '').length;

  for (const cluster of clusters) {
    if (!cluster.siblingIdxs || cluster.siblingIdxs.length === 0) continue;
    clustersWithSiblings++;

    // Build per-index Jaccard map vs the NAPI-chosen exemplar (smallest idx).
    // After we flip to the JS-chosen exemplar below, we recompute Jaccards
    // relative to the chosen exemplar. For Jaccard, d(a,b) = d(b,a), so a
    // sibling's Jaccard vs exemplar_new equals exemplar_new's Jaccard vs
    // exemplar_napi inverted: use the transitive property — MinHash Jaccard
    // is symmetric and the triangle approximation holds, so we treat the
    // NAPI exemplar's siblings as a known cluster and take the worst-case
    // Jaccard within that cluster for LI eligibility.
    const napiExemplar = cluster.exemplarIdx;
    const jaccardFromNapiExemplar = new Map();
    jaccardFromNapiExemplar.set(napiExemplar, 1.0);
    for (let i = 0; i < cluster.siblingIdxs.length; i++) {
      jaccardFromNapiExemplar.set(cluster.siblingIdxs[i], cluster.siblingJaccards[i]);
    }

    const memberIdxs = [cluster.exemplarIdx, ...cluster.siblingIdxs];
    const members = memberIdxs.map((idx) => ({ idx, chunk: items[idx] }));
    const exemplar = selectExemplar(members);
    const exemplarId = items[exemplar.idx].id;

    for (const m of members) {
      const meta = items[m.idx].metadata;
      meta.clusterId = cluster.clusterId;
      if (m.idx === exemplar.idx) {
        meta.isExemplar = true;
        meta.exemplarId = null;
        meta.aliasJaccard = null;
        meta.liReuseEligible = true;
      } else {
        meta.isExemplar = false;
        meta.exemplarId = exemplarId;
        // Two-tier admission: bi-encoder reuse always. LI reuse only when
        // the Jaccard vs the cluster is close to exact. We conservatively
        // take min(jaccard-to-napi-exemplar, jaccard-to-js-exemplar) by
        // using the stored napi jaccard as a proxy; for near-exact clusters
        // (≥0.95) the choice of exemplar within the cluster barely matters.
        const j = jaccardFromNapiExemplar.get(m.idx) ?? 0;
        meta.aliasJaccard = j;
        meta.liReuseEligible = j >= liJaccardThreshold;
        if (meta.liReuseEligible) liEligibleAliases++;
        totalAliases++;
        bytesSaved += lenOf(items[m.idx]);
      }
    }
  }

  return {
    totalChunks: items.length,
    clustersWithSiblings,
    totalAliases,
    liEligibleAliases,
    liReuseJaccardThreshold: liJaccardThreshold === Infinity ? null : liJaccardThreshold,
    bytesSaved,
  };
}

/**
 * Build a one-line human summary of dedup stats for indexer logs.
 */
export function formatDedupSummary(result) {
  if (result.skipped) return `Dedup skipped (${result.reason})`;
  const { clustersWithSiblings, totalAliases, liEligibleAliases, totalChunks, bytesSaved } = result.stats;
  if (totalAliases === 0) {
    return `Dedup: no near-duplicate clusters found (${totalChunks} chunks scanned)`;
  }
  const pct = ((totalAliases / totalChunks) * 100).toFixed(1);
  const kb = (bytesSaved / 1024).toFixed(1);
  const liNote = (liEligibleAliases ?? 0) > 0
    ? `, ${liEligibleAliases} eligible for LI reuse`
    : '';
  return `Dedup: ${clustersWithSiblings} clusters, ${totalAliases} aliases (${pct}% of ${totalChunks})${liNote}, ~${kb} KB of source text short-circuited`;
}

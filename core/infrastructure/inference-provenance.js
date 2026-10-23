/**
 * Inference provenance: which encoder backend produced the vectors an index
 * holds.
 *
 * Each encode path records `(kind, label, count)` in this process; the code
 * that publishes `reconcile-manifest.json` folds the counts into the
 * `vectors.encoders` and `lateInteraction.encoders` maps. The full indexer
 * replaces the maps on a full rebuild and adds to them otherwise; the
 * reconcile daemon always adds. The counts are encodes written since the
 * last full rebuild, so files that changed several times count more than
 * once.
 *
 * Informational only. It is deliberately NOT part of `config_fingerprint`:
 * a new compared field counts as a mismatch for every existing index and
 * would force a rebuild (config-fingerprint.js legacy policy).
 *
 * Labels:
 *   native  "<device>/<dtype>" from the addon (`model.backend`), prefixed
 *           "coreml+" when the CoreML cascade is armed: "cuda/bf16",
 *           "metal/bf16", "coreml+metal/bf16", "cpu/f32"
 *   ORT     "ort-<quant>/<execution provider>": "ort-q8/cpu", "ort-q8/coreml+cpu"
 *   other   "model-server" (shared model server RPC; it runs ORT)
 */

/**
 * Bump when a numerics fix changes what a backend writes, so an index can
 * tell vectors written before the fix from those written after.
 *   1: ModernBERT rotary positions in F32 (01aed96d), flash-attn CUDA errors
 *      reported, F32 L2 normalise on every backend.
 */
export const INFERENCE_REVISION = 1;

const counts = { dense: new Map(), li: new Map() };

/**
 * Count `n` vectors (dense: one per text; li: one per document) encoded by
 * `label`. Unknown labels are recorded as "unknown".
 */
export function recordEncode(kind, label, n) {
  const map = counts[kind];
  if (!map || !(n > 0)) return;
  const key = typeof label === 'string' && label ? label : 'unknown';
  map.set(key, (map.get(key) ?? 0) + n);
}

/** Counts recorded since the last take, then cleared. */
export function takeProvenance() {
  const out = { dense: Object.fromEntries(counts.dense), li: Object.fromEntries(counts.li) };
  counts.dense.clear();
  counts.li.clear();
  return out;
}

function addCounts(prev, next) {
  const out = { ...(prev && typeof prev === 'object' ? prev : {}) };
  for (const [label, n] of Object.entries(next || {})) out[label] = (out[label] ?? 0) + n;
  return out;
}

function foldTier(tier, recorded, replace) {
  const hasNew = Object.keys(recorded).length > 0;
  if (!hasNew && !replace) return tier;
  const prev = tier?.encoders;
  const sameRevision = prev?.revision === INFERENCE_REVISION;
  const encoders = {
    revision: INFERENCE_REVISION,
    counts: replace ? { ...recorded } : addCounts(sameRevision ? prev.counts : undefined, recorded),
  };
  // Counts written under an older revision stay visible, separately.
  if (!replace && prev && !sameRevision) encoders.olderRevisions = { ...(prev.olderRevisions || {}), [prev.revision ?? 0]: prev.counts ?? prev };
  else if (!replace && prev?.olderRevisions) encoders.olderRevisions = prev.olderRevisions;
  return { ...(tier || {}), encoders };
}

/**
 * Fold recorded counts into a manifest about to be published. Mutates and
 * returns `manifest`.
 *
 * @param {object} manifest  output of buildNextManifest
 * @param {{dense: object, li: object}} recorded  takeProvenance() result
 * @param {{replace?: boolean}} [options]  replace = full rebuild
 */
export function applyProvenance(manifest, recorded, { replace = false } = {}) {
  manifest.vectors = foldTier(manifest.vectors, recorded?.dense || {}, replace);
  manifest.lateInteraction = foldTier(manifest.lateInteraction, recorded?.li || {}, replace);
  return manifest;
}

const HALF = /\/(bf16|f16)$/;

/**
 * Classify an index's provenance for status output. Never triggers a
 * rebuild; it only says what is known.
 *
 * @param {object|null} manifest  reconcile-manifest.json
 * @returns {{ state: 'recorded'|'partial'|'unknown', notes: string[] }}
 */
export function classifyProvenance(manifest) {
  const notes = [];
  const tiers = [
    ['dense vectors', manifest?.vectors?.encoders],
    ['late-interaction vectors', manifest?.lateInteraction?.encoders],
  ];
  let recorded = 0;
  for (const [name, enc] of tiers) {
    if (!enc?.counts) {
      notes.push(`${name}: backend not recorded (built before provenance was kept)`);
      continue;
    }
    recorded++;
    // Several labels in one tier are normal: the reconcile daemon always
    // writes ORT vectors next to a GPU-built baseline (the same encoder
    // family the query path uses). Only facts that call for action become
    // notes.
    for (const [rev, older] of Object.entries(enc.olderRevisions || {})) {
      const half = Object.keys(older || {}).filter((l) => HALF.test(l));
      if (half.length) notes.push(`${name}: ${half.join(', ')} encodes from inference revision ${rev} predate numerics fixes; a rebuild replaces them`);
    }
  }
  if (recorded === 0) {
    notes.push('vectors written by a GPU in half precision before inference revision 1 can carry drift (late-interaction chunks over 256 tokens); a rebuild replaces them');
  }
  return { state: recorded === tiers.length ? 'recorded' : recorded ? 'partial' : 'unknown', notes };
}

/** One-line summary of a tier's encoder counts, or null. */
export function describeEncoders(enc) {
  if (!enc?.counts) return null;
  const parts = Object.entries(enc.counts).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ×${n}`);
  return parts.length ? parts.join(', ') : null;
}

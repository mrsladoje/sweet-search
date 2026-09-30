/**
 * Index config fingerprint.
 *
 * The full indexer stamps this object into `merkle-state.json` as
 * `config_fingerprint`. It records every setting that decides the on-disk
 * index FORMAT: the dense encoder, the late-interaction (LI) encoder, the
 * chunker, the encoder-input enrichment, and the sparse-gram weight table.
 *
 * Two readers compare it against the running code:
 *   - the full indexer (`incremental-tracker.js::getChangedFiles`) re-embeds
 *     every file on a mismatch;
 *   - the reconcile daemon's baseline gate
 *     (`incremental-indexing/infrastructure/baseline-readiness.mjs`) stops
 *     writing on a mismatch, so it never mixes old- and new-format chunks.
 *
 * Only values that change what the daemon would WRITE belong here. Research
 * env overrides that the daemon does not apply to its own writes (for example
 * `SWEET_SEARCH_LI_QUANT_BITS`: LI deltas reuse the loaded index's quantBits)
 * stay out, because a daemon spawned without them would otherwise stop for
 * no reason.
 *
 * Legacy policy: a stored fingerprint that lacks a field the current code
 * writes counts as a mismatch. Every index built before a field existed is
 * therefore rebuilt once by the next `sweet-search index`.
 */

import { EMBEDDING_CONFIG, LATE_INTERACTION_CONFIG } from '../infrastructure/config/index.js';
import { HASH_ALGORITHM } from '../incremental-indexing/infrastructure/hashing.mjs';
import { DEFAULT_SPARSE_GRAM_WEIGHTS_ID } from '../incremental-indexing/infrastructure/manifest.mjs';
import { describeFormatChanges } from '../incremental-indexing/infrastructure/staleness-display.mjs';
import { CHUNKING_VERSION, ENRICHMENT_VERSION } from './ast-chunker.js';

export const STATE_VERSION = '2.4';

// Quantization pipeline version — bump when changing the dense embedding
// pipeline to invalidate all existing indexes. v2 = int8 quantized embeddings.
const PIPELINE_VERSION = 2;

/**
 * Compared fields, in report order. `label` is the user-facing name; `reason`
 * is the machine reason the full indexer logs for the FIRST changed field.
 */
const FIELDS = [
  { key: 'provider', reason: 'provider_changed', label: 'embedding provider' },
  { key: 'model', reason: 'model_changed', label: 'embedding model' },
  { key: 'dimension', reason: 'dimension_changed', label: 'embedding dimension' },
  { key: 'hnswDimension', reason: 'hnsw_dimension_changed', label: 'HNSW dimension' },
  { key: 'pipelineVersion', reason: 'pipeline_version_changed', label: 'embedding pipeline version' },
  { key: 'hashAlgorithm', reason: 'hash_algorithm_changed', label: 'content hash algorithm' },
  { key: 'liModel', reason: 'li_model_changed', label: 'late-interaction model' },
  { key: 'liQuantization', reason: 'li_quantization_changed', label: 'late-interaction quantization' },
  { key: 'chunkingVersion', reason: 'chunking_version_changed', label: 'chunking version' },
  { key: 'enrichmentVersion', reason: 'enrichment_version_changed', label: 'enrichment version' },
  { key: 'sparseGramWeightsId', reason: 'sparse_gram_weights_changed', label: 'sparse-gram weights' },
];

/**
 * Build the fingerprint for the running code + configuration.
 */
export function buildConfigFingerprint() {
  return {
    provider: EMBEDDING_CONFIG.provider,
    model: EMBEDDING_CONFIG.model,
    dimension: EMBEDDING_CONFIG.dimension,
    hnswDimension: EMBEDDING_CONFIG.hnswDimension,
    pipelineVersion: PIPELINE_VERSION,
    hashAlgorithm: HASH_ALGORITHM,
    liModel: LATE_INTERACTION_CONFIG.enabled ? LATE_INTERACTION_CONFIG.model : null,
    liQuantization: LATE_INTERACTION_CONFIG.enabled ? LATE_INTERACTION_CONFIG.quantization : null,
    chunkingVersion: CHUNKING_VERSION,
    enrichmentVersion: ENRICHMENT_VERSION,
    sparseGramWeightsId: DEFAULT_SPARSE_GRAM_WEIGHTS_ID,
    version: STATE_VERSION,
  };
}

/**
 * List the fields whose stored value differs from `current`. A field missing
 * from `stored` is reported with `previous: null` (legacy index).
 *
 * @param {object|null} stored
 * @param {object} [current]
 * @returns {Array<{field: string, label: string, reason: string, previous: *, current: *}>}
 */
export function diffConfigFingerprint(stored, current = buildConfigFingerprint()) {
  const base = stored && typeof stored === 'object' ? stored : {};
  const changes = [];
  for (const { key, reason, label } of FIELDS) {
    const previous = Object.prototype.hasOwnProperty.call(base, key) ? base[key] : undefined;
    if (previous !== current[key]) {
      changes.push({ field: key, label, reason, previous: previous ?? null, current: current[key] ?? null });
    }
  }
  return changes;
}

/**
 * Validate a stored config fingerprint against the running configuration.
 *
 * @param {object|null} storedFingerprint  `config_fingerprint` from merkle-state.json
 * @returns {{valid: boolean, reason?: string, migrated?: boolean, changes?: Array, details?: object}}
 */
export function validateConfigFingerprint(storedFingerprint) {
  const current = buildConfigFingerprint();

  // A merkle state with no fingerprint predates v2.2 or was left by a
  // reconciler-only run. Neither is a known-format baseline.
  if (!storedFingerprint || typeof storedFingerprint !== 'object') {
    return {
      valid: false,
      reason: 'no_fingerprint',
      changes: diffConfigFingerprint(null, current),
      details: { message: 'Index has no config fingerprint (built by an old version)' },
    };
  }

  const changes = diffConfigFingerprint(storedFingerprint, current);
  if (changes.length > 0) {
    const first = changes[0];
    return {
      valid: false,
      reason: first.reason,
      changes,
      details: {
        previous: first.previous,
        current: first.current,
        message: `Index format changed: ${describeFormatChanges(changes)}`,
      },
    };
  }

  if (storedFingerprint.version !== current.version) {
    const change = {
      field: 'version', label: 'state version', reason: 'state_version_changed',
      previous: storedFingerprint.version ?? null, current: current.version,
    };
    return {
      valid: false,
      reason: 'state_version_changed',
      changes: [change],
      details: {
        previous: change.previous,
        current: change.current,
        message: `State version changed: ${change.previous} -> ${change.current}`,
      },
    };
  }

  return { valid: true };
}

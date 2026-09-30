/**
 * Baseline-readiness gate for the default-on incremental maintainer.
 *
 * Product contract: the incremental reconciler must NEVER be the first index
 * builder for a non-empty repo. The first index must come from the normal full
 * indexing path (`sweet-search index`). Before a complete baseline exists, the
 * maintainer stays dormant and reports `waiting_for_initial_index`; once a
 * complete baseline exists (including a valid empty one) reconcile runs normally.
 *
 * Why this is needed: the daemon's tick is a producer (`dirty-scan.mjs` diffs the
 * tree against `merkle-state.json`) plus a consumer (`production-reconciler.mjs`,
 * whose adapters call `createVectorSchema`/`createGraphSchema`). With no baseline,
 * `merkle-state.json` is absent so the producer enqueues the WHOLE tree, and the
 * consumer then builds `codebase.db` / `code-graph.db` / HNSW / LI / sparse from
 * scratch one budget-bounded tick at a time — leaving a PARTIAL index that search
 * mistakes for a complete one.
 *
 * "Complete baseline" is proven by what the FULL indexer writes in its final phase
 * (`indexing/indexer-phases.js::updateIncrementalStatePhase`), which the
 * incremental reconciler does NOT produce on its own:
 *
 *   1. `reconcile-manifest.json` published at `epoch >= 1`. The full indexer
 *      publishes this as its LAST step, so its presence means vectors + graph +
 *      HNSW + LI + sparse all finished building. A crash before that step leaves
 *      no manifest; a corrupt manifest reads back as null. (epoch alone is NOT a
 *      discriminator: a reconciler-only first tick also yields epoch 1.)
 *   2. `merkle-state.json` carrying a `config_fingerprint`. ONLY the full
 *      indexer's tracker (`indexing/incremental-tracker.js::updateState`) writes
 *      this field; the reconciler's `persistManifest` never adds it (it only
 *      preserves one already present). So `config_fingerprint` present ⟺ a full
 *      index ran at least once — the exact signal that distinguishes a real
 *      baseline from the reconciler-only partial state the old bug produced.
 *   3. The vectors DB named by the manifest exists on disk (the artifact search
 *      reads). Guards a manually-deleted / half-written baseline.
 *
 * A complete baseline must also be in the CURRENT index format: its
 * `config_fingerprint` must match `indexing/config-fingerprint.js::
 * buildConfigFingerprint()` (encoders, chunker, enrichment, sparse weights).
 * After an upgrade that changes the format, the reason is
 * `config-fingerprint-mismatch` and the daemon stays dormant exactly as for a
 * missing baseline, so it never writes new-format chunks into an old-format
 * index. `sweet-search index` re-embeds everything and restamps the
 * fingerprint, which re-opens the gate.
 *
 * A valid EMPTY baseline (a full index that produced an empty-but-valid index)
 * satisfies 1-3 with zero tracked files, so it counts as ready. A
 * partially-written, corrupt, or reconciler-only baseline fails 1 or 2 and does
 * not. The check is read-only: it never mutates the state dir.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readManifest } from './manifest.mjs';
import { validateConfigFingerprint } from '../../indexing/config-fingerprint.js';

/** Status label surfaced in logs and `reconcile status` when no baseline exists. */
export const WAITING_FOR_INITIAL_INDEX = 'waiting_for_initial_index';

/** Status label when a baseline exists but was built in an older index format. */
export const INDEX_REBUILD_REQUIRED = 'index_rebuild_required';

/** Not-ready reason for a baseline whose config fingerprint does not match. */
export const CONFIG_FINGERPRINT_MISMATCH = 'config-fingerprint-mismatch';

const MERKLE_STATE = 'merkle-state.json';
const DEFAULT_VECTORS_DB = 'codebase.db';

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Does the merkle state carry a `config_fingerprint`? The full indexer writes a
 * populated object; the reconciler never adds one. Accept either a non-empty
 * object or a non-empty string for forward/backward tolerance.
 */
function hasConfigFingerprint(merkle) {
  const fp = merkle ? merkle.config_fingerprint : null;
  if (!fp) return false;
  if (typeof fp === 'string') return fp.length > 0;
  if (typeof fp === 'object') return Object.keys(fp).length > 0;
  return false;
}

/**
 * Whether a complete baseline index exists for `stateDir`.
 *
 * @param {string} stateDir   The `.sweet-search` directory.
 * @returns {{ready: boolean, reason: string, changes?: Array}}
 *   `reason` is one of: `ready`, `no-state-dir`, `no-manifest`,
 *   `manifest-epoch-zero`, `no-merkle-state`, `no-config-fingerprint`,
 *   `config-fingerprint-mismatch`, `missing-vectors-db`. On a mismatch,
 *   `changes` lists each changed field ({field, label, previous, current}).
 */
export function hasCompleteBaseIndex(stateDir) {
  if (!stateDir || !fs.existsSync(stateDir)) {
    return { ready: false, reason: 'no-state-dir' };
  }

  const manifest = readManifest(stateDir);
  if (!manifest) {
    return { ready: false, reason: 'no-manifest' };
  }
  if (!Number.isInteger(manifest.epoch) || manifest.epoch < 1) {
    return { ready: false, reason: 'manifest-epoch-zero' };
  }

  const merkle = readJsonSafe(path.join(stateDir, MERKLE_STATE));
  if (!merkle) {
    return { ready: false, reason: 'no-merkle-state' };
  }
  if (!hasConfigFingerprint(merkle)) {
    return { ready: false, reason: 'no-config-fingerprint' };
  }
  const fingerprint = validateConfigFingerprint(merkle.config_fingerprint);
  if (!fingerprint.valid) {
    return { ready: false, reason: CONFIG_FINGERPRINT_MISMATCH, changes: fingerprint.changes || [] };
  }

  const vectorsRel = (manifest.vectors && manifest.vectors.path) || DEFAULT_VECTORS_DB;
  const vectorsPath = path.isAbsolute(vectorsRel) ? vectorsRel : path.join(stateDir, vectorsRel);
  if (!fs.existsSync(vectorsPath)) {
    return { ready: false, reason: 'missing-vectors-db' };
  }

  return { ready: true, reason: 'ready' };
}

/**
 * Readiness plus a human/machine-facing `state` label for status surfaces.
 *
 * @param {string} stateDir
 * @returns {{ready: boolean, reason: string, changes?: Array,
 *            state: 'indexed'|'waiting_for_initial_index'|'index_rebuild_required'}}
 */
export function baselineStatus(stateDir) {
  const result = hasCompleteBaseIndex(stateDir);
  let state = 'indexed';
  if (!result.ready) {
    state = result.reason === CONFIG_FINGERPRINT_MISMATCH ? INDEX_REBUILD_REQUIRED : WAITING_FOR_INITIAL_INDEX;
  }
  return { ...result, state };
}


// The full indexer writes `version` then `config_fingerprint` first, so the
// fingerprint sits in the first few hundred bytes of merkle-state.json. Search
// reads only this prefix instead of parsing a per-file state that can be MBs.
const FINGERPRINT_PREFIX_BYTES = 64 * 1024;

/**
 * Extract the flat `config_fingerprint` object from the head of a merkle-state
 * JSON text. Returns undefined when the key is not in `text`.
 */
function extractFingerprint(text) {
  const keyAt = text.indexOf('"config_fingerprint"');
  if (keyAt < 0) return undefined;
  const open = text.indexOf('{', keyAt);
  if (open < 0) return undefined;
  let inString = false;
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      return undefined; // fingerprint is flat; anything nested is not ours
    } else if (ch === '}') {
      try { return JSON.parse(text.slice(open, i + 1)); } catch { return undefined; }
    }
  }
  return undefined;
}

/**
 * Cheap search-time check: is the on-disk index in the current format?
 * Reads at most 64 KiB of merkle-state.json. Never throws.
 *
 * @param {string} stateDir
 * @returns {{match: boolean, changes: Array}|null}  null when there is no
 *   full-index fingerprint to compare (no index yet, or unreadable).
 */
export function indexFormatStatus(stateDir) {
  let fd = null;
  try {
    fd = fs.openSync(path.join(stateDir, MERKLE_STATE), 'r');
    const buf = Buffer.alloc(FINGERPRINT_PREFIX_BYTES);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const stored = extractFingerprint(buf.toString('utf8', 0, n));
    if (!stored || typeof stored !== 'object') return null;
    const result = validateConfigFingerprint(stored);
    return { match: result.valid, changes: result.valid ? [] : (result.changes || []) };
  } catch {
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

/**
 * Reconcile manifest reader / writer.
 *
 * Plan § 8.1. The manifest is the single source of truth for "which tier
 * artifacts and sidecars belong to which reconcile epoch". Readers pin
 * one manifest at query start and use only the paths it names for the
 * full query duration; the reconciler stages all per-tier writes under
 * `<artifact>.next` (or per-tier append paths) and publishes a new
 * manifest atomically via `fsync + rename`.
 *
 * Manifest shape (plan § 8.1):
 *
 *   {
 *     "epoch": 12847,
 *     "publishedAt": "2026-05-15T23:00:00.000Z",
 *     "codeGraph":      { "path": "code-graph.db", "epoch": 12847 },
 *     "vectors":        { "path": "codebase.db", "epoch": 12847 },
 *     "hnsw":           { "path": "codebase-hnsw.idx",
 *                          "stale": "codebase-hnsw.idx.stale.bin",
 *                          "epoch": 12847 },
 *     "binaryHnsw":     { "path": "codebase-binary-hnsw.idx", "epoch": 12847 },
 *     "lateInteraction":{ "manifest": "codebase-late-interaction.db.segments/manifest.json",
 *                          "epoch": 12847 },
 *     "sparseGram":     { "base": "codebase-sparse-grams.idx",
 *                          "deltas": ["codebase-sparse-grams.idx.deltas/12847-0.ssgrmdelta"],
 *                          "weightsId": "common-code-bigram-v1",
 *                          "epoch": 12847 }
 *   }
 *
 * The manifest is written to `.sweet-search/reconcile-manifest.json` with
 * a `*.tmp` staging file + fsync + rename + parent-dir fsync. Readers MUST
 * load the manifest fresh per query (cheap — single JSON read of a small
 * file); the reconciler is the only writer.
 */

import fs from 'node:fs';
import path from 'node:path';

export const MANIFEST_FILENAME = 'reconcile-manifest.json';
export const DEFAULT_SPARSE_GRAM_WEIGHTS_ID = 'common-code-bigram-v1';

function manifestPath(stateDir) {
  return path.join(stateDir, MANIFEST_FILENAME);
}

function tempManifestPath(stateDir) {
  return path.join(stateDir, MANIFEST_FILENAME + '.tmp');
}

/**
 * Build a zero-state manifest for a brand-new index. Plan § 25.2:
 * the manifest is created at first reconcile tick alongside the
 * STATE_VERSION bump.
 *
 * @param {object} paths   per-tier filename map relative to stateDir
 * @returns {object}
 */
export function zeroManifest(paths) {
  return {
    epoch: 0,
    publishedAt: new Date().toISOString(),
    codeGraph: { path: paths.codeGraph || 'code-graph.db', epoch: 0 },
    vectors: { path: paths.vectors || 'codebase.db', epoch: 0 },
    hnsw: {
      path: paths.hnsw || 'codebase-hnsw.idx',
      stale: paths.hnswStale || 'codebase-hnsw.idx.stale.bin',
      epoch: 0,
    },
    binaryHnsw: {
      path: paths.binaryHnsw || 'codebase-binary-hnsw.idx',
      epoch: 0,
    },
    lateInteraction: {
      manifest: paths.liManifest || 'codebase-late-interaction.db.segments/manifest.json',
      epoch: 0,
    },
    sparseGram: {
      base: paths.sparseBase || 'codebase-sparse-grams.idx',
      deltas: paths.sparseDeltas || [],
      weightsId: paths.weightsId || DEFAULT_SPARSE_GRAM_WEIGHTS_ID,
      epoch: 0,
    },
  };
}

/**
 * Read the current manifest. Returns `null` when none has been written
 * yet — callers fall back to the legacy "open whatever file exists"
 * behaviour until the reconciler runs at least once.
 *
 * @param {string} stateDir
 * @returns {object|null}
 */
export function readManifest(stateDir) {
  const p = manifestPath(stateDir);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    // A corrupted manifest is recoverable: the next reconcile tick
    // rebuilds it from the per-tier artifacts on disk. We return null so
    // callers can fall back to the legacy paths until then.
    return null;
  }
}

/**
 * Atomic write of a new manifest. Plan § 8.1 step 4 requires:
 *
 *   1. write `*.tmp`
 *   2. fsync the temp file
 *   3. atomically rename to the live name
 *   4. fsync the parent directory so the rename survives a power loss
 *
 * @param {string} stateDir
 * @param {object} manifest
 */
export function writeManifest(stateDir, manifest) {
  fs.mkdirSync(stateDir, { recursive: true });
  const tmp = tempManifestPath(stateDir);
  const live = manifestPath(stateDir);
  const data = JSON.stringify(manifest, null, 2);

  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, live);
  // Best-effort dir fsync. Some filesystems (e.g. tmpfs in containers)
  // throw EINVAL on directory fsync; that is harmless because no power
  // loss can affect them.
  try {
    const dirFd = fs.openSync(stateDir, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  } catch {
    // ignore
  }
}

/**
 * Build the next-epoch manifest from a previous manifest plus a list of
 * per-tier overrides. The reconciler calls this once per tick after the
 * per-tier writes finish staging.
 *
 * @param {object} prev    Previous manifest (use `zeroManifest` on first tick).
 * @param {{epoch:number, tiers:object}} delta
 * @returns {object}
 */
export function buildNextManifest(prev, delta) {
  if (!Number.isInteger(delta.epoch)) {
    throw new Error('buildNextManifest: delta.epoch must be an integer');
  }
  const out = {
    ...prev,
    epoch: delta.epoch,
    publishedAt: new Date().toISOString(),
  };
  const tiers = delta.tiers || {};
  for (const key of ['codeGraph', 'vectors', 'hnsw', 'binaryHnsw', 'lateInteraction', 'sparseGram']) {
    if (!tiers[key]) {
      // Carry forward the previous tier descriptor with the new epoch.
      out[key] = { ...(prev[key] || {}), epoch: delta.epoch };
      continue;
    }
    out[key] = { ...prev[key], ...tiers[key], epoch: delta.epoch };
  }
  return out;
}

/**
 * SQL predicate fragment that filters rows visible at a given manifest
 * epoch. Plan § 8.1.1 / § 7.2:
 *
 *   epoch_written <= :manifestEpoch
 *     AND (epoch_retired IS NULL OR epoch_retired > :manifestEpoch)
 *
 * Returned with named-parameter placeholders so callers can bind the
 * value once and reuse the prepared statement across queries.
 *
 * @param {string} [alias]   Optional table alias (e.g. `'v.'` or `'e.'`).
 * @returns {string}
 */
export function epochVisibilityPredicate(alias = '') {
  const normalizedAlias = alias.endsWith('.') ? alias.slice(0, -1) : alias;
  const a = normalizedAlias.length > 0 ? `${normalizedAlias}.` : '';
  return (
    `${a}epoch_written <= :manifestEpoch ` +
    `AND (${a}epoch_retired IS NULL OR ${a}epoch_retired > :manifestEpoch)`
  );
}

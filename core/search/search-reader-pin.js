import path from 'node:path';
import { DB_PATHS, PROJECT_ROOT } from '../infrastructure/config/index.js';
import { readManifest } from '../incremental-indexing/infrastructure/manifest.mjs';
import { beginRead, endRead } from '../incremental-indexing/infrastructure/reader-heartbeat.mjs';

function dataDirName() {
  const dir = path.basename(path.dirname(DB_PATHS.codebase || ''));
  return dir && dir !== '.' ? dir : '.sweet-search';
}

export function searchStateDir(projectRoot = process.cwd()) {
  const root = path.resolve(projectRoot || process.cwd());
  if (root === path.resolve(PROJECT_ROOT || process.cwd())) {
    return path.dirname(DB_PATHS.codebase);
  }
  return path.join(root, dataDirName());
}

// Negative cache for stateDirs known to have no reconcile-manifest.json.
// 1s TTL bounds staleness if reconcile starts publishing after first probe.
// Cleared per-stateDir whenever a manifest is observed.
const _manifestAbsentAt = new Map();
const MANIFEST_ABSENT_TTL_MS = 1000;

export function _resetManifestAbsentCache() {
  _manifestAbsentAt.clear();
}

export function beginPinnedRead({ projectRoot, stateDir, epoch, meta } = {}) {
  // Caller signaled "I already checked and there is no pinned epoch".
  // Heartbeat has no GC contract to honor without an epoch — no-op.
  if (epoch === null) return null;
  const resolvedStateDir = stateDir || (projectRoot ? searchStateDir(projectRoot) : null);
  if (!resolvedStateDir) return null;
  // Skip readManifest when we recently observed it was absent at this path.
  if (!Number.isInteger(epoch)) {
    const absentAt = _manifestAbsentAt.get(resolvedStateDir);
    if (absentAt !== undefined && Date.now() - absentAt < MANIFEST_ABSENT_TTL_MS) {
      return null;
    }
  }
  const manifest = Number.isInteger(epoch) ? null : readManifest(resolvedStateDir);
  const manifestEpoch = Number.isInteger(epoch)
    ? epoch
    : manifest?.epoch;
  if (!Number.isInteger(manifestEpoch)) {
    _manifestAbsentAt.set(resolvedStateDir, Date.now());
    return null;
  }
  _manifestAbsentAt.delete(resolvedStateDir);
  return {
    stateDir: resolvedStateDir,
    epoch: manifestEpoch,
    manifest,
    record: beginRead(resolvedStateDir, manifestEpoch, meta || {}),
  };
}

export function endPinnedRead(pin) {
  if (!pin) return;
  endRead(pin.stateDir, pin.record);
}

export async function withPinnedRead(options, fn) {
  const pin = beginPinnedRead(options);
  try {
    return await fn(pin?.epoch ?? null, pin);
  } finally {
    endPinnedRead(pin);
  }
}

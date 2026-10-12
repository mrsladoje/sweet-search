import { AsyncResource } from 'node:async_hooks';
import { existsSync } from 'node:fs';
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

// One heartbeat file per (state dir, epoch) for this process, shared by its concurrent reads
// and kept PIN_LINGER_MS after the last of them ends. A daemon that answers calls back to back
// then writes the file once, instead of a create and an unlink per call (~0.2 ms of a 1.4 ms
// ss-grep call on a small repo). A heartbeat that outlives its reads only holds the prune
// frontier (minLiveEpoch) back a little longer, which the GC contract allows: it never lets a
// row a reader still uses be pruned. The file goes when this process exits, and liveReaders
// drops it if the process dies first.
const PIN_LINGER_MS = 30_000;
// Linger timers run outside any ss-* call's context, so they keep none of its state alive.
const lingerScope = new AsyncResource('sweet-search-reader-pin');
const _sharedPins = new Map(); // `${stateDir}\0${epoch}` -> { stateDir, record, refs, timer }
let _exitHookInstalled = false;

function dropSharedPin(key) {
  const shared = _sharedPins.get(key);
  if (!shared) return;
  _sharedPins.delete(key);
  if (shared.timer) clearTimeout(shared.timer);
  endRead(shared.stateDir, shared.record);
}

/** Drop every heartbeat no read holds (tests; process exit drops all of them). */
export function _flushLingeringPins() {
  for (const [key, shared] of [..._sharedPins]) if (shared.refs === 0) dropSharedPin(key);
}

function acquireSharedPin(stateDir, epoch, meta) {
  const key = `${stateDir}\0${epoch}`;
  let shared = _sharedPins.get(key);
  // The file can vanish under a pin (a rebuild that clears the state dir): write it again,
  // keeping the reads that hold it.
  if (shared && !existsSync(shared.record.path)) {
    shared.record = beginRead(stateDir, epoch, meta || {});
  }
  if (!shared) {
    shared = { stateDir, record: beginRead(stateDir, epoch, meta || {}), refs: 0, timer: null };
    _sharedPins.set(key, shared);
    if (!_exitHookInstalled) {
      _exitHookInstalled = true;
      process.once('exit', () => { for (const k of [..._sharedPins.keys()]) dropSharedPin(k); });
    }
  }
  if (shared.timer) { clearTimeout(shared.timer); shared.timer = null; }
  shared.refs++;
  return { key, record: shared.record };
}

function releaseSharedPin(key) {
  const shared = _sharedPins.get(key);
  if (!shared || --shared.refs > 0) return;
  shared.timer = lingerScope.runInAsyncScope(() => setTimeout(() => {
    if (_sharedPins.get(key) === shared && shared.refs === 0) dropSharedPin(key);
  }, PIN_LINGER_MS));
  shared.timer.unref?.();
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
  const { key, record } = acquireSharedPin(resolvedStateDir, manifestEpoch, meta);
  return {
    stateDir: resolvedStateDir,
    epoch: manifestEpoch,
    manifest,
    record,
    key,
    released: false,
  };
}

export function endPinnedRead(pin) {
  if (!pin || pin.released) return;
  pin.released = true;
  releaseSharedPin(pin.key);
}

export async function withPinnedRead(options, fn) {
  const pin = beginPinnedRead(options);
  try {
    return await fn(pin?.epoch ?? null, pin);
  } finally {
    endPinnedRead(pin);
  }
}

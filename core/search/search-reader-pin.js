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

export function beginPinnedRead({ projectRoot, stateDir, epoch, meta } = {}) {
  const resolvedStateDir = stateDir || (projectRoot ? searchStateDir(projectRoot) : null);
  if (!resolvedStateDir) return null;
  const manifest = Number.isInteger(epoch) ? null : readManifest(resolvedStateDir);
  const manifestEpoch = Number.isInteger(epoch)
    ? epoch
    : manifest?.epoch;
  if (!Number.isInteger(manifestEpoch)) return null;
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

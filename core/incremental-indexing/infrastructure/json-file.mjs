/**
 * Small JSON state-file helpers shared by the reconciler and the maintenance jobs.
 * Writes go to `<file>.tmp.<pid>` and are renamed into place, so a reader never sees a
 * half-written file. They do not fsync: use `manifest.mjs` for state that must survive a crash.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/** Parsed JSON of `filePath`, or `fallback` when the file is missing or unparseable. */
export function readJsonFile(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return fallback; }
}

export async function writeJsonAtomic(filePath, payload) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  await fsp.writeFile(tmp, JSON.stringify(payload, null, 2));
  await fsp.rename(tmp, filePath);
}

export function writeJsonAtomicSync(filePath, payload, { compact = false } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, compact ? JSON.stringify(payload) : JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, filePath);
}

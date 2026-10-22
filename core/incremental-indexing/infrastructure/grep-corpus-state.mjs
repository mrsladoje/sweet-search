/**
 * Grep-only corpus state (the `grep_files` table of file-state.db, file-state-store.mjs).
 *
 * The sparse-gram (ss-grep) corpus is wider than embedding admission
 * (core/indexing/grep-corpus.js): tracked `vendor/`, `LICENSE`, `*.csv` and other
 * git-visible files that no embedding tier holds. The `files` table tracks only the
 * embedding-admitted files, so these grep-only files need their own record, or the
 * maintainer never sees them change and ss-grep answers from the full build's grams.
 *
 * Shape: `{ files: { [rel]: { size, mtime_ns, hash? } } }`. The full build writes the
 * table (stat only) with the sparse-gram base; the reconciler updates the rows of the
 * grep-only files it reconciles (stat + content hash). The dirty scan compares stats.
 */

import fs from 'node:fs';
import { readGrepStateObject, writeGrepStateObject } from './file-state-store.mjs';

/** @returns {{files: Record<string, {size: string, mtime_ns: string, hash?: string}>}} */
export function readGrepCorpusState(stateDir) {
  return { files: readGrepStateObject(stateDir) };
}

export function writeGrepCorpusState(stateDir, state) {
  writeGrepStateObject(stateDir, state.files || {});
}

/** The stat a grep-only entry records (lstat: the corpus never follows symlinks). Null when absent. */
export function grepStatEntry(absPath) {
  try {
    const st = fs.lstatSync(absPath, { bigint: true });
    return { size: st.size.toString(), mtime_ns: st.mtimeNs.toString() };
  } catch {
    return null;
  }
}

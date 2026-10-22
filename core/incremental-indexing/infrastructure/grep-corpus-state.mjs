/**
 * Grep-only corpus state (`grep-corpus-state.json`).
 *
 * The sparse-gram (ss-grep) corpus is wider than embedding admission
 * (core/indexing/grep-corpus.js): tracked `vendor/`, `LICENSE`, `*.csv` and other
 * git-visible files that no embedding tier holds. merkle-state.json tracks only the
 * embedding-admitted files, so these grep-only files need their own record, or the
 * maintainer never sees them change and ss-grep answers from the full build's grams.
 *
 * Shape: `{ files: { [rel]: { size, mtime_ns, hash? } } }`. The full build writes it
 * (stat only) next to the sparse-gram base; the reconciler updates the entries of the
 * grep-only files it reconciles (stat + content hash). The dirty scan compares stats.
 */

import fs from 'node:fs';
import path from 'node:path';

export const GREP_CORPUS_STATE = 'grep-corpus-state.json';

/** @returns {{files: Record<string, {size: string, mtime_ns: string, hash?: string}>}} */
export function readGrepCorpusState(stateDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(stateDir, GREP_CORPUS_STATE), 'utf8'));
    if (parsed && parsed.files && typeof parsed.files === 'object') return parsed;
  } catch { /* absent or unreadable: no grep-only file is known */ }
  return { files: {} };
}

export function writeGrepCorpusState(stateDir, state) {
  fs.mkdirSync(stateDir, { recursive: true });
  const file = path.join(stateDir, GREP_CORPUS_STATE);
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ files: state.files || {} }));
  fs.renameSync(tmp, file);
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

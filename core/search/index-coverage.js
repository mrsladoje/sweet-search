/**
 * "Is this path in the index, and if not, why?"
 *
 * THE DEFECT THIS REPLACES. The ss-* wrappers answered that question with a PATH predicate
 * (`admitsShape`). The indexer also drops files by CONTENT — a committed bundle like
 * `dist/index.js` is git-tracked, so the path rules re-admit it and then the minified-shape
 * rule drops it anyway. The path predicate said "admitted", so the wrapper printed a bare
 * `(no matches)` and the agent read that as "searched and absent" rather than "never
 * searchable". Measured cost on the fresh pool: `--in dist/index.js` returned bare zeros,
 * `ss-semantic` returned a whole-file `[FALLBACK]` span (7 of 58 calls, five of them on
 * `dist/index.js` lines 1-35000), and `ss-read` handed back 13,396 tokens of minified
 * JavaScript in a single call.
 *
 * THE FIX. Ask the index itself. A file with no live row in the vector table is not indexed,
 * whatever rule dropped it, so this cannot drift from the indexer the way a re-implemented
 * predicate does. The REASON is then a best-effort explanation, and being wrong about the
 * reason is harmless — being wrong about "is it searchable" is not.
 *
 * Fails OPEN throughout: if the database cannot be opened or queried, every path reports
 * "indexed" and the wrappers behave exactly as they did before. A hint is never worth
 * breaking a search over.
 */

import path from 'node:path';
import { existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { createRequire } from 'node:module';

// better-sqlite3 is a native CommonJS addon and admission-policy.js is loaded through the
// same bridge, so both resolve relative to THIS file rather than to whatever cwd a wrapper
// happens to run in.
const require = createRequire(import.meta.url);

const normalizeRel = rel => String(rel || '').replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * Human-readable reasons, in the order they are tested.
 *
 * `kind` separates the two cases that must never be conflated:
 *   'excluded' the indexer will NEVER hold this file. Say so and point elsewhere.
 *   'stale'    the indexer WOULD hold it; this index just has not seen it yet, which is
 *              what a file the agent created two turns ago looks like. Telling that agent
 *              "not indexed, look at the source it was built from" would be a lie about
 *              its own new code, and it is a measured case: 7 of 1,251 sweet lexical calls
 *              on the fresh pool were genuine stale-index zeros on the agent's own file
 *              (register E3).
 */
export const REASONS = {
  vendored: { kind: 'excluded', text: 'declared vendored by .gitattributes' },
  minified: { kind: 'excluded', text: 'a minified or generated bundle — detected by content shape, not by path' },
  unsupported: { kind: 'excluded', text: 'not an indexed file type' },
  denied: { kind: 'excluded', text: 'build output, a dependency directory, or an ignored path' },
  oversized: { kind: 'excluded', text: 'over the index size limit' },
  notYetIndexed: { kind: 'stale', text: 'this index has not seen it yet — it may be new or just written' },
  absent: { kind: 'excluded', text: 'not present in this index' },
};

/**
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {string} [opts.dbPath]  vector database; defaults to <projectRoot>/.sweet-search/codebase.db
 * @param {object} [opts.admissionPolicy]  a pre-built createAdmissionPolicy() result, if the
 *   caller already has one. Only used to EXPLAIN, never to decide.
 */
export async function createIndexCoverage({ projectRoot, dbPath, admissionPolicy = null } = {}) {
  const root = projectRoot || process.cwd();
  const db = dbPath || path.join(root, '.sweet-search', 'codebase.db');

  // The admission policy is needed ONLY to explain a miss, and building it costs about 18 ms.
  // The common case is a file that IS indexed, so it is loaded lazily: `ss-read` on an
  // ordinary source file must not pay for machinery that exists to write an error message.
  // Its module graph has a top-level await, so it cannot be `require`d — which is why the
  // lazy getter, and therefore `notIndexedNote`, are async. A load failure leaves it null and
  // every reason degrades to a true but vaguer statement; it never makes a path look indexed
  // when it is not.
  let policy = admissionPolicy, policyTried = !!admissionPolicy;
  async function getPolicy() {
    if (policyTried) return policy;
    policyTried = true;
    try {
      const mod = await import('../indexing/admission-policy.js');
      policy = mod.createAdmissionPolicy({ projectRoot: root });
    } catch { policy = null; }
    return policy;
  }

  let handle = null, opened = false, usable = false;
  function open() {
    if (opened) return handle;
    opened = true;
    if (!existsSync(db)) return null;
    try {
      // Lazy + synchronous: this runs only on a zero-result branch, so the cost is paid
      // once, on the path where the agent is already about to be told something useful.
      const Database = require('better-sqlite3');
      handle = new Database(db, { readonly: true, fileMustExist: true });
      // A retired row is a file the index used to hold; it is not searchable now.
      handle.prepare('SELECT 1 FROM vectors WHERE file_path = ? AND epoch_retired IS NULL LIMIT 1').get('');
      usable = true;
    } catch { handle = null; usable = false; }
    return handle;
  }

  let stmt = null;
  /**
   * True when the index holds at least one live chunk for this path.
   * Returns true (fail open) whenever the index cannot answer.
   */
  function isIndexed(rel) {
    const r = normalizeRel(rel);
    if (!r) return true;
    if (!open() || !usable) return true;
    try {
      stmt ||= handle.prepare('SELECT 1 AS hit FROM vectors WHERE file_path = ? AND epoch_retired IS NULL LIMIT 1');
      return stmt.get(r) !== undefined;
    } catch { return true; }
  }

  /**
   * True when the index holds a live chunk for ANY path under this directory.
   * Prefix match on the normalised relative path; the file_path index makes it a range scan.
   */
  function dirHasIndexedFiles(rel) {
    const r = normalizeRel(rel).replace(/\/+$/, '');
    if (!r || r === '.') return true;
    if (!open() || !usable) return true;
    try {
      return handle.prepare(
        'SELECT 1 AS hit FROM vectors WHERE file_path >= ? AND file_path < ? AND epoch_retired IS NULL LIMIT 1',
      ).get(`${r}/`, `${r}0`) !== undefined;   // '0' is the byte after '/'
    } catch { return true; }
  }

  /**
   * Why a path is not indexed: `{kind, text}` from REASONS. Never throws. Callers branch on
   * `kind`, because refusing to show a file body is right for 'excluded' and wrong for
   * 'stale'.
   */
  async function exclusionReason(rel) {
    const r = normalizeRel(rel);
    const abs = path.isAbsolute(rel) ? rel : path.join(root, r);
    let admissibleByPath = false;
    const p = await getPolicy();
    if (p) {
      try {
        if (p.linguistAttr(r) === 'vendored') return REASONS.vendored;
        if (!p.matchesInclude(r)) return REASONS.unsupported;
        if (p.isOversizedAbs(abs)) return REASONS.oversized;
        if (!p.admitsShape(r)) return REASONS.denied;
        admissibleByPath = true;
      } catch { /* fall through to the content check */ }
    }
    // Admitted by path but absent from the index. The content-shape rule is the usual
    // cause and is exactly what the old path-only predicate could not see.
    if (looksLikeBundle(abs)) return REASONS.minified;
    // Admissible, not a bundle, still missing: this index is behind, not this file excluded.
    if (admissibleByPath) return REASONS.notYetIndexed;
    return REASONS.absent;
  }

  /**
   * The note to print instead of a bare `(no matches)` or a file body, as
   * `{kind, reason, rel, isDir, text}`. Returns null when the path IS indexed, does not
   * exist, or sits outside the project — in each of those the caller's normal output is
   * already the right output.
   */
  async function notIndexedNote(scopePath) {
    if (!scopePath) return null;
    try {
      const abs = path.isAbsolute(scopePath) ? scopePath : path.resolve(root, scopePath);
      if (!existsSync(abs)) return null;
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      if (!rel || rel.startsWith('..')) return null;
      const isDir = statSync(abs).isDirectory();
      if (isDir) {
        if (dirHasIndexedFiles(rel)) return null;
        const p = await getPolicy();
        const reason = (p && p.isExcluded(rel)) ? REASONS.denied : REASONS.absent;
        return {
          kind: reason.kind, reason: reason.text, rel, isDir: true,
          text: `(not indexed: ${scopePath} — ${reason.text}. Nothing under it is searchable; look at tracked source instead.)`,
        };
      }
      // The hot path stops here: an indexed file costs one indexed sqlite lookup and never
      // touches the admission policy.
      if (isIndexed(rel)) return null;
      const reason = await exclusionReason(rel);
      const advice = reason.kind === 'stale'
        ? 'Search cannot see it yet; read it directly instead.'
        : 'It is not searchable; look at the source it was built from.';
      return {
        kind: reason.kind, reason: reason.text, rel, isDir: false,
        text: `(not indexed: ${scopePath} — ${reason.text}. ${advice})`,
      };
    } catch { return null; }
  }

  function close() { try { handle?.close(); } catch { /* already gone */ } handle = null; }

  return { isIndexed, dirHasIndexedFiles, exclusionReason, notIndexedNote, close };
}

// --- helpers ---------------------------------------------------------------------------

/**
 * Content-shape bundle check, matching the indexer's own rule closely enough to name a
 * reason. Deliberately a cheap head+tail read, not a re-import of the indexer: this runs
 * on an error path and must never be the reason a hint fails to print.
 */
export function looksLikeBundle(absPath) {
  let fd;
  try {
    const st = statSync(absPath);
    if (!st.isFile() || st.size < 1024) return false;   // a sub-1KB file is never a bundle
    fd = openSync(absPath, 'r');
    const buf = Buffer.alloc(Math.min(32768, st.size));
    const n = readSync(fd, buf, 0, buf.length, 0);
    const head = buf.slice(0, n).toString('utf8');
    const lines = head.split('\n');
    // Drop a trailing partial line so a single 32KB-wide line is not measured short.
    if (lines.length > 1 && st.size > n) lines.pop();
    if (!lines.length) return false;
    const sorted = lines.map(l => l.length).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return median > 200;
  } catch { return false; }
  finally { if (fd !== undefined) { try { closeSync(fd); } catch { /* */ } } }
}

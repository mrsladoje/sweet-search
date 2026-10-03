/**
 * Which lines a file shows when ss-grep gives it fewer lines than it has stored matches
 * (SS_FIX_GREP_LINES, default ON since 2026-10-03; 0 = legacy). Without the switch a file shows its first `a` stored
 * matches in line order, and those are often imports, package lines and header comments.
 *
 * Classes, from the code-graph entities of the file:
 *   0  declaration: a symbol starts on the line or up to 3 lines earlier, and the symbol's
 *      name (last component) is on the line as a whole word
 *   1  inside some symbol's span
 *   2  outside every symbol span
 * A file shows its `a` lowest (class, line) matches, printed in line order.
 *
 * Freshness gate: a file gets classes only when its source is not newer than the published
 * index (index-freshness.js) and it has visible entities. Anything else keeps the prefix.
 * RESIDUAL RISK: stale data the gate cannot see (an index published after an edit but built
 * from older content; spans an extractor got wrong) can still promote a wrong line, and the
 * line limit can then drop an earlier useful match. The name-on-line check guards only
 * class 0, not class 1.
 */

const DECL_WINDOW = 3;

function isIdentChar(code) {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

/** Last component of a qualified entity name (`Oracle.hasConflict` → `hasConflict`). */
export function entityShortName(name) {
  const parts = String(name || '').split(/::|->|[.#]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/** True when `name` occurs in `text` with no identifier character on either side. */
export function nameOnLine(name, text) {
  if (!name || !text) return false;
  for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
    const before = at > 0 ? text.charCodeAt(at - 1) : -1;
    const after = at + name.length < text.length ? text.charCodeAt(at + name.length) : -1;
    if (!isIdentChar(before) && !isIdentChar(after)) return true;
  }
  return false;
}

/**
 * Class of each line, one sweep over line-sorted rows and start-sorted entities.
 *
 * @param {Array<{line: number, text: string}>} rows - sorted by line
 * @param {Array<{name: string, startLine: number, endLine: number}>} entities - sorted by startLine
 * @returns {number[]} class per row
 */
export function classifyGrepLines(rows, entities) {
  const ents = entities
    .filter(e => Number.isInteger(e?.startLine) && Number.isInteger(e?.endLine))
    .map(e => ({ start: e.startLine, end: Math.max(e.startLine, e.endLine), short: entityShortName(e.name) }));
  const out = new Array(rows.length);
  let next = 0;        // first entity not yet started at the current line
  let maxEnd = -1;     // largest end among entities started so far
  for (let r = 0; r < rows.length; r++) {
    const line = rows[r].line;
    while (next < ents.length && ents[next].start <= line) {
      if (ents[next].end > maxEnd) maxEnd = ents[next].end;
      next++;
    }
    let cls = maxEnd >= line ? 1 : 2;
    const text = rows[r].text || '';
    for (let e = next - 1; e >= 0 && ents[e].start >= line - DECL_WINDOW; e--) {
      if (nameOnLine(ents[e].short, text)) { cls = 0; break; }
    }
    out[r] = cls;
  }
  return out;
}

/**
 * Stamp `lineClass` on bare-grep result rows of every fresh, indexed file with more than
 * one row. Rows of other files are left untouched (no `lineClass`), which the renderer reads
 * as "keep the prefix".
 *
 * @param {Array<{file: string, line: number, content?: string}>} results - grouped per file
 * @param {{entitiesInFile: (file: string) => Array, isFresh: (file: string) => boolean}} io
 * @returns {{files: number, stamped: number}} counts, for stats
 */
export function stampGrepLineClasses(results, { entitiesInFile, isFresh }) {
  let files = 0;
  let stamped = 0;
  let i = 0;
  while (i < results.length) {
    const start = i;
    const file = results[i].file;
    while (i < results.length && results[i].file === file) i++;
    if (i - start < 2) continue;
    files++;
    if (!isFresh(file)) continue;
    let entities;
    try { entities = entitiesInFile(file) || []; } catch { entities = []; }
    if (entities.length === 0) continue;
    const group = results.slice(start, i).map(r => ({ line: r.line, text: r.content ?? r.text ?? '' }))
      .map((row, idx) => ({ ...row, idx }))
      .sort((a, b) => a.line - b.line || a.idx - b.idx);
    const classes = classifyGrepLines(group, entities);
    for (let g = 0; g < group.length; g++) results[start + group[g].idx].lineClass = classes[g];
    stamped++;
  }
  return { files, stamped };
}

/**
 * Indices (into `ms`) of the `a` matches a file shows: lowest (class, line) first, returned
 * in line order. Null when any row lacks a class, so the caller keeps its prefix exactly.
 *
 * @param {Array<{line: number, lineClass?: number}>} ms - one file's stored matches, line order
 * @param {number} a
 * @returns {number[]|null}
 */
export function selectGrepLinesByClass(ms, a) {
  if (a >= ms.length) return null;
  for (const m of ms) if (!Number.isInteger(m?.lineClass)) return null;
  const idx = ms.map((_, j) => j);
  idx.sort((x, y) => ms[x].lineClass - ms[y].lineClass || ms[x].line - ms[y].line || x - y);
  const picked = idx.slice(0, a);
  picked.sort((x, y) => ms[x].line - ms[y].line || x - y);
  return picked;
}

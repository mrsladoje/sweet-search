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
 * Spread (SS_FIX_GREP_LINE_SPREAD, default ON since 2026-10-04; 0 = the order above, byte for
 * byte): each row also carries `lineSymbol`, its innermost enclosing symbol. The file first
 * shows one class 0/1 non-comment line per symbol, in (class, line) order, then fills the
 * rest in (class, line) order. Three hits in one function no longer hide a hit in the next one (r3hb-grdb-07:
 * reentrantSync 194/207/220 hid preconditionNoUnsafeTransactionLeft 304). Dev replays of
 * truncated files: 2026-10-04 final run (324 files) +9 gold symbols shown, none lost, gold
 * lines equal, comment lines 74 -> 62; 2026-10-03 runs (146 files) +2 / -1 gold symbols.
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

const SPACE = 32;
const TAB = 9;
const SLASH = 47;
const STAR = 42;
const HASH = 35;

/**
 * Comment shape, by its first characters: `//`, `/*`, `*` (a block comment's body) or `#`
 * followed by a space or the end (`#include`, `#[derive]`, `#!` are code). A doc comment in a
 * class body must not take the class's one spread slot.
 */
export function isCommentLine(text) {
  if (!text) return false;
  let i = 0;
  while (i < text.length && (text.charCodeAt(i) === SPACE || text.charCodeAt(i) === TAB)) i++;
  const c = text.charCodeAt(i);
  if (c === STAR) return true;
  const d = i + 1 < text.length ? text.charCodeAt(i + 1) : -1;
  if (c === SLASH) return d === SLASH || d === STAR;
  if (c === HASH) return d === -1 || d === SPACE || d === TAB;
  return false;
}

/**
 * Class of each line, one sweep over line-sorted rows and start-sorted entities.
 *
 * @param {Array<{line: number, text: string}>} rows - sorted by line
 * @param {Array<{name: string, startLine: number, endLine: number}>} entities - sorted by
 *   startLine, then endLine descending (an enclosing symbol before the ones it holds)
 * @param {number[]|null} [symbolsOut] - when given, receives per row the index (into the
 *   usable entities) of the innermost symbol whose span holds the line, or -1
 * @returns {number[]} class per row
 */
export function classifyGrepLines(rows, entities, symbolsOut = null) {
  const ents = entities
    .filter(e => Number.isInteger(e?.startLine) && Number.isInteger(e?.endLine))
    .map(e => ({ start: e.startLine, end: Math.max(e.startLine, e.endLine), short: entityShortName(e.name) }));
  const out = new Array(rows.length);
  let next = 0;        // first entity not yet started at the current line
  let maxEnd = -1;     // largest end among entities started so far
  // Started symbols, innermost on top: an ended one on top is popped; one that ended under an
  // open one is popped with it later and never read.
  const open = symbolsOut ? [] : null;
  for (let r = 0; r < rows.length; r++) {
    const line = rows[r].line;
    while (next < ents.length && ents[next].start <= line) {
      if (ents[next].end > maxEnd) maxEnd = ents[next].end;
      if (open) open.push(next);
      next++;
    }
    if (open) {
      while (open.length && ents[open[open.length - 1]].end < line) open.pop();
      symbolsOut[r] = open.length ? open[open.length - 1] : -1;
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
 * `defines: true` on a row where a symbol named exactly `name` starts (on the line or up to
 * DECL_WINDOW lines above, the name on the line): the grep pattern's own definition. The
 * renderer lists such files first (zod `safeParse`: parse.ts:80 came after 15 test files).
 */
function stampDefinitionRows(results, start, end, name, { entitiesInFile, isFresh }) {
  const file = results[start].file;
  let rows = null;
  for (let r = start; r < end; r++) if (nameOnLine(name, results[r].content ?? results[r].text ?? '')) (rows ??= []).push(r);
  if (!rows || !isFresh(file)) return;
  let entities;
  try { entities = entitiesInFile(file) || []; } catch { entities = []; }
  const starts = entities.filter((e) => entityShortName(e.name) === name).map((e) => e.startLine ?? e.start_line);
  for (const r of rows) {
    const line = results[r].line;
    if (starts.some((s) => Number.isInteger(s) && s <= line && s >= line - DECL_WINDOW)) results[r].defines = true;
  }
}

/**
 * Stamp `lineClass` and `lineSymbol` (innermost enclosing symbol of the file, or -1) on
 * bare-grep result rows of every fresh, indexed file with more than one row. Rows of other
 * files are left untouched (no `lineClass`), which the renderer reads as "keep the prefix".
 *
 * @param {Array<{file: string, line: number, content?: string}>} results - grouped per file
 * @param {{entitiesInFile: (file: string) => Array, isFresh: (file: string) => boolean}} io
 * @returns {{files: number, stamped: number}} counts, for stats
 */
export function stampGrepLineClasses(results, { entitiesInFile, isFresh, definedName = null }) {
  let files = 0;
  let stamped = 0;
  let i = 0;
  while (i < results.length) {
    const start = i;
    const file = results[i].file;
    while (i < results.length && results[i].file === file) i++;
    if (definedName) stampDefinitionRows(results, start, i, definedName, { entitiesInFile, isFresh });
    if (i - start < 2) continue;
    files++;
    if (!isFresh(file)) continue;
    let entities;
    try { entities = entitiesInFile(file) || []; } catch { entities = []; }
    if (entities.length === 0) continue;
    const group = results.slice(start, i).map(r => ({ line: r.line, text: r.content ?? r.text ?? '' }))
      .map((row, idx) => ({ ...row, idx }))
      .sort((a, b) => a.line - b.line || a.idx - b.idx);
    const symbols = new Array(group.length);
    const classes = classifyGrepLines(group, entities, symbols);
    for (let g = 0; g < group.length; g++) {
      const row = results[start + group[g].idx];
      row.lineClass = classes[g];
      row.lineSymbol = symbols[g];
    }
    stamped++;
  }
  return { files, stamped };
}

// Scratch marks for the spread pick, reused across calls. `lineSymbol` indexes a file's entity
// list (at most GREP_LINE_CLASS_ENTITY_CAP = 2048, search-pattern.js); rows per file are at
// most min(k, 100). A stamp equal to the current generation means "marked in this call".
const symbolMark = new Int32Array(2048);
let rowMark = new Int32Array(128);
let markGeneration = 0;
function nextMarkGeneration(rows) {
  if (rows > rowMark.length) rowMark = new Int32Array(rows);
  if (++markGeneration === 0x7fffffff) { symbolMark.fill(0); rowMark.fill(0); markGeneration = 1; }
  return markGeneration;
}

/**
 * Indices (into `ms`) of the `a` matches a file shows: lowest (class, line) first, returned
 * in line order. Null when any row lacks a class, so the caller keeps its prefix exactly.
 * `spread`: first one class 0/1 non-comment match per `lineSymbol`, in that order, then the
 * rest in that order (rows without an integer `lineSymbol` turn spread off for the file).
 *
 * @param {Array<{line: number, lineClass?: number, lineSymbol?: number}>} ms - one file's
 *   stored matches, line order
 * @param {number} a
 * @param {boolean} [spread]
 * @returns {number[]|null}
 */
export function selectGrepLinesByClass(ms, a, spread = false) {
  if (a >= ms.length) return null;
  let symbols = spread;
  for (const m of ms) {
    if (!Number.isInteger(m?.lineClass)) return null;
    if (symbols && !Number.isInteger(m.lineSymbol)) symbols = false;
  }
  const idx = ms.map((_, j) => j);
  idx.sort((x, y) => ms[x].lineClass - ms[y].lineClass || ms[x].line - ms[y].line || x - y);
  let picked;
  if (symbols) {
    // Linear, no allocation per call: marks are stamped with a fresh generation.
    const gen = nextMarkGeneration(ms.length);
    picked = [];
    for (let t = 0; t < idx.length && picked.length < a; t++) {
      const j = idx[t];
      const sym = ms[j].lineSymbol;
      if (ms[j].lineClass > 1 || sym < 0) continue;
      const small = sym < symbolMark.length;
      if (small ? symbolMark[sym] === gen : picked.some(p => ms[p].lineSymbol === sym)) continue;
      if (isCommentLine(ms[j].content ?? ms[j].text)) continue;
      if (small) symbolMark[sym] = gen;
      rowMark[j] = gen;
      picked.push(j);
    }
    for (let t = 0; t < idx.length && picked.length < a; t++) if (rowMark[idx[t]] !== gen) picked.push(idx[t]);
  } else {
    picked = idx.slice(0, a);
  }
  picked.sort((x, y) => ms[x].line - ms[y].line || x - y);
  return picked;
}

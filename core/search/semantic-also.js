/**
 * ss-semantic output helpers — name the next-best places in the file, and every
 * entity a printed span holds.
 *
 * `readSemantic` prints the spans that fit its token budget (default 600 tokens), so
 * one full-size chunk can fill the whole budget and the agent gets no hint that the
 * answer sits in another function (replay r3h-dgraph-08: one 4-function chunk printed,
 * `ToExportKvList` and `exportInternal` never named, three follow-up reads).
 *
 * Pure functions, no heavy imports: the ss-* client imports this file to format the
 * structured `alsoCandidates` / `entityNames` fields that `readSemantic` returns, so the
 * warm-daemon path and the in-process fallback print identical text. The candidates are
 * pointers, NOT shown spans — callers must not record them in the span ledger.
 */

export const ALSO_MAX = 5;
export const HEADER_SYMBOL_CAP = 4;

// Entity kinds worth naming. Fields, variables, consts and schema leaves are not places an
// agent reads; they would also swamp a header or an also line.
const NAMEABLE_KINDS = new Set([
  'function', 'method', 'arrowfunction', 'constructor',
  'class', 'struct', 'interface', 'enum', 'trait', 'impl', 'module', 'namespace',
  'typealias', 'type', 'object', 'rpc', 'service',
]);
const CALLABLE_KINDS = new Set(['function', 'method', 'arrowfunction', 'constructor']);

const kindOf = (e) => String(e?.type || '').toLowerCase();
const isNameable = (e) => !!e?.name && NAMEABLE_KINDS.has(kindOf(e));

function qualifiedName(e) {
  const parent = e.parentClass;
  return parent && !String(e.name).startsWith(`${parent}.`) ? `${parent}.${e.name}` : e.name;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && aEnd >= bStart;
}

/** Last line of a span that was really printed (a truncated span prints only a head). */
function shownEndLine(span) {
  if (span.truncated !== true || typeof span.text !== 'string') return span.endLine;
  const lines = span.text.split('\n');
  const count = span.text.endsWith('\n') ? lines.length - 1 : lines.length;
  return Math.min(span.endLine, span.startLine + Math.max(1, count) - 1);
}

/**
 * Batch the output-only graph lookups once per semantic request. Never cache across
 * requests: the next call must see graph edits and a newly published manifest.
 *
 * @param {object|null} graph - CodeGraphRepository
 * @param {string} file
 * @param {Array<object>} spans - budgeted spans, including truncation metadata
 * @param {Array<object>} pool - ranked candidate chunks
 * @returns {object|null} request-local findEntitiesInRange / findEnclosingEntity adapter
 */
export function createSemanticEntityLookup(graph, file, spans = [], pool = []) {
  if (!graph || !file) return null;
  const ranges = new Map();
  const key = (start, end) => `${start}:${end}`;
  const add = (startLine, endLine, includeInside) => {
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return;
    const k = key(startLine, endLine);
    const previous = ranges.get(k);
    ranges.set(k, { startLine, endLine, includeInside: includeInside || previous?.includeInside || false });
  };
  for (const span of spans) add(span.startLine, shownEndLine(span), true);
  for (const c of pool) {
    if (spans.some(s => overlaps(c?.startLine, c?.endLine, s.startLine, s.endLine))) continue;
    add(c?.startLine, c?.endLine, false);
  }
  if (!ranges.size) return null;
  let rows;
  try { rows = graph.findEntitiesForRanges(file, [...ranges.values()]); } catch { return null; }
  if (rows.length !== ranges.size) return null;
  const results = new Map([...ranges.keys()].map((k, i) => [k, rows[i]]));
  return {
    findEntitiesInRange(filePath, startLine, endLine) {
      return filePath === file ? [...(results.get(key(startLine, endLine))?.inRange || [])] : [];
    },
    findEnclosingEntity(filePath, startLine, endLine) {
      return filePath === file ? results.get(key(startLine, endLine))?.enclosing || null : null;
    },
  };
}

/**
 * Names of the entities a printed span holds, in file order: the entity the span sits
 * inside, plus every entity that starts inside it. Nested closures of a function are
 * skipped, and so is an entity of which the span shows only a stub (a signature line
 * pulled in by context padding). [] when the graph is missing or has nothing.
 *
 * @param {object|null} graph - CodeGraphRepository (findEntitiesInRange, findEnclosingEntity)
 */
export function spanEntityNames(graph, file, span) {
  if (!graph || !file || !Number.isInteger(span?.startLine) || !Number.isInteger(span?.endLine)) return [];
  const start = span.startLine;
  const end = shownEndLine(span);
  let found = [];
  try {
    const inside = graph.findEntitiesInRange?.(file, start, end) || [];
    const enclosing = graph.findEnclosingEntity?.(file, start, end) || null;
    found = enclosing ? [enclosing, ...inside] : inside;
  } catch {
    return [];
  }
  const names = [];
  const taken = [];
  const seen = new Set();
  found.sort((a, b) => (a.startLine - b.startLine) || (b.endLine - a.endLine));
  for (const e of found) {
    if (!isNameable(e) || !Number.isInteger(e.startLine) || !Number.isInteger(e.endLine)) continue;
    const len = e.endLine - e.startLine + 1;
    const shown = Math.min(e.endLine, end) - Math.max(e.startLine, start) + 1;
    if (shown < Math.min(len, 3)) continue; // stub of a neighbour, not content
    if (taken.some(t => CALLABLE_KINDS.has(kindOf(t)) && e.startLine >= t.startLine && e.endLine <= t.endLine)) continue;
    const name = qualifiedName(e);
    if (seen.has(name)) continue;
    seen.add(name);
    taken.push(e);
    names.push(name);
  }
  return names;
}

/** Entity names first (file order), then any chunk label the entities did not already cover. */
export function mergeSpanNames(entityNames, symbols) {
  const out = [];
  for (const n of [...(entityNames || []), ...(symbols || [])]) {
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * The entity a candidate chunk lies inside, or null. A class-like container much larger
 * than the chunk is no help as a pointer ("1-2000 Foo"), so it is ignored in favour of the
 * chunk's own range.
 */
function enclosingFor(graph, file, chunk) {
  if (!graph?.findEnclosingEntity) return null;
  let e;
  try { e = graph.findEnclosingEntity(file, chunk.startLine, chunk.endLine); } catch { return null; }
  if (!isNameable(e) || !Number.isInteger(e.startLine) || !Number.isInteger(e.endLine)) return null;
  const chunkLen = chunk.endLine - chunk.startLine + 1;
  const entityLen = e.endLine - e.startLine + 1;
  if (!CALLABLE_KINDS.has(kindOf(e)) && entityLen > chunkLen * 3) return null;
  return e;
}

const labelOrNull = (v) => (v && v !== 'unknown' && v !== 'code' ? String(v) : null);

/**
 * The next-best candidates that were ranked but not printed.
 *
 * @param {Array<{id?, symbol?, type?, startLine, endLine, score}>} pool - ranked chunks, best first
 * @param {Array<{startLine, endLine}>} printedSpans
 * @param {{ file: string, graph?: object|null, max?: number }} opts
 * @returns {Array<{startLine, endLine, name: string|null, kind: string|null, score: number}>}
 *   at most `max`, in score order; none overlaps a printed span; one entry per entity
 */
export function buildAlsoCandidates(pool, printedSpans, { file, graph = null, max = ALSO_MAX } = {}) {
  const out = [];
  for (const c of pool || []) {
    if (out.length >= max) break;
    if (!Number.isInteger(c?.startLine) || !Number.isInteger(c?.endLine)) continue;
    if ((printedSpans || []).some(s => overlaps(c.startLine, c.endLine, s.startLine, s.endLine))) continue;
    const ent = enclosingFor(graph, file, c);
    const entry = ent
      ? { startLine: ent.startLine, endLine: ent.endLine, name: qualifiedName(ent), kind: kindOf(ent) || null, score: c.score }
      : { startLine: c.startLine, endLine: c.endLine, name: labelOrNull(c.symbol), kind: labelOrNull(c.type), score: c.score };
    // One entry per place: a chunk lying inside an entry already chosen is the same place
    // (two body chunks of one function, a signature-only chunk of it).
    // Without a graph the stored chunk name stands in for the entity: chunks of one function share it.
    if (out.some(o => (entry.startLine >= o.startLine && entry.endLine <= o.endLine) || (!ent && entry.name && entry.name === o.name))) continue;
    out.push(entry);
  }
  return out;
}

/** `# also: 606-696 ToExportKvList · 775-944 exportInternal`, or '' when there is nothing. */
export function formatAlsoLine(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  const parts = candidates.map(c => `${c.startLine}-${c.endLine}${c.name ? ` ${c.name}` : ''}`);
  return `# also: ${parts.join(' · ')}`;
}

/** The ` [a, b, c, d, +2]` tail of a span header, or '' when the span has no names. */
export function formatSpanSymbols(span, cap = HEADER_SYMBOL_CAP) {
  const names = Array.isArray(span?.entityNames) && span.entityNames.length
    ? span.entityNames
    : (span?.symbols || []);
  if (!names.length) return '';
  const shown = names.slice(0, cap);
  if (names.length > cap) shown.push(`+${names.length - cap}`);
  return ` [${shown.join(', ')}]`;
}

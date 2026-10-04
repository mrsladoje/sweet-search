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
/** Names per `# also:` place; the hidden code is where a name is worth its tokens. */
export const ALSO_NAME_CAP = 5;

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

// The chunker names the pieces of a long definition `name (part 2)`; they are one name.
const baseSymbol = (s) => (s ? String(s).replace(/ \(part \d+\)$/, '') : s);
// `Sequel::TimedQueueConnectionPool` / `Collector.accept` -> the bare name.
const lastSegment = (n) => String(n).split(/::|\./).pop();

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

/** The printed line ranges of the spans (a truncated span: its printed head). */
function printedRanges(spans) {
  return (spans || [])
    .filter(s => Number.isInteger(s?.startLine) && Number.isInteger(s?.endLine))
    .map(s => ({ startLine: s.startLine, endLine: shownEndLine(s) }));
}

/**
 * The part of a..b no printed range covers: the longest such stretch (the first on a tie),
 * or null when every line of it is printed.
 */
function unprintedPart(a, b, printed) {
  let pieces = [[a, b]];
  for (const p of printed) {
    const next = [];
    for (const [s, e] of pieces) {
      if (!overlaps(s, e, p.startLine, p.endLine)) { next.push([s, e]); continue; }
      if (s < p.startLine) next.push([s, p.startLine - 1]);
      if (e > p.endLine) next.push([p.endLine + 1, e]);
    }
    pieces = next;
  }
  let best = null;
  for (const [s, e] of pieces) if (!best || e - s > best[1] - best[0]) best = [s, e];
  return best ? { startLine: best[0], endLine: best[1] } : null;
}

/** The stretch of a..b that holds `line` and no printed line (line itself is unprinted). */
function unprintedStretch(a, b, printed, line) {
  let s = a;
  let e = b;
  for (const p of printed) {
    if (p.endLine < line) s = Math.max(s, p.endLine + 1);
    else if (p.startLine > line) e = Math.min(e, p.startLine - 1);
  }
  return { startLine: s, endLine: e };
}

/**
 * The ranked chunks as places the output can point at: each chunk's part outside the printed
 * code (a chunk the budget cut through keeps its unprinted rest), in score order. A chunk
 * printed whole is no place to point at.
 *
 * @param {Array<object>} pool - ranked chunks, best first
 * @param {Array<object>} spans - printed spans (truncation metadata included)
 * @returns {Array<object>} the chunk with startLine/endLine set to the unprinted part
 */
export function alsoPieces(pool, spans) {
  const printed = printedRanges(spans);
  const out = [];
  for (const c of pool || []) {
    if (!Number.isInteger(c?.startLine) || !Number.isInteger(c?.endLine)) continue;
    const part = unprintedPart(c.startLine, c.endLine, printed);
    if (part) out.push({ ...c, ...part });
  }
  return out;
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
  const add = (startLine, endLine) => {
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return;
    ranges.set(key(startLine, endLine), { startLine, endLine, includeInside: true });
  };
  for (const span of spans) add(span.startLine, shownEndLine(span));
  for (const p of alsoPieces(pool, spans)) add(p.startLine, p.endLine);
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
 * The entities of a..b worth naming, in file order: `enclosing` (when given) first, then
 * every nameable entity that starts inside. Nested closures of a function already taken are
 * skipped, and so is an entity of which the range holds only a stub (a signature line
 * pulled in by context padding).
 */
function rangeEntities(inside, enclosing, start, end) {
  const found = enclosing ? [enclosing, ...inside] : [...inside];
  found.sort((a, b) => (a.startLine - b.startLine) || (b.endLine - a.endLine));
  const taken = [];
  const seen = new Set();
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
  }
  return taken;
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
  let inside;
  let enclosing;
  try {
    inside = graph.findEntitiesInRange?.(file, start, end) || [];
    enclosing = graph.findEnclosingEntity?.(file, start, end) || null;
  } catch {
    return [];
  }
  return rangeEntities(inside, enclosing, start, end).map(qualifiedName);
}

/**
 * The names a span header prints: the graph's entity names (qualified), then any chunk label
 * they do not already cover — `name (part N)` pieces as one name, a label equal to the last
 * segment of an entity name (`accept` beside `Collector.accept`) as covered. A span the
 * budget cut adds no chunk labels: they name the whole merged span, most of it not printed.
 */
export function mergeSpanNames(entityNames, symbols, { truncated = false } = {}) {
  const out = [];
  const covered = new Set();
  for (const n of entityNames || []) {
    if (!n || out.includes(n)) continue;
    out.push(n);
    covered.add(lastSegment(n));
  }
  if (truncated) return out;
  for (const s of symbols || []) {
    const n = baseSymbol(s);
    if (!n || out.includes(n) || covered.has(lastSegment(n))) continue;
    out.push(n);
  }
  return out;
}

/**
 * The entity a candidate place lies inside, or null. A class-like container much larger
 * than the place is no help as a pointer ("1-2000 Foo"), so it is ignored in favour of the
 * place's own range.
 */
function enclosingFor(graph, file, piece) {
  if (!graph?.findEnclosingEntity) return null;
  let e;
  try { e = graph.findEnclosingEntity(file, piece.startLine, piece.endLine); } catch { return null; }
  if (!isNameable(e) || !Number.isInteger(e.startLine) || !Number.isInteger(e.endLine)) return null;
  const pieceLen = piece.endLine - piece.startLine + 1;
  const entityLen = e.endLine - e.startLine + 1;
  if (!CALLABLE_KINDS.has(kindOf(e)) && entityLen > pieceLen * 3) return null;
  return e;
}

function insideOf(graph, file, piece) {
  if (!graph?.findEntitiesInRange) return [];
  try { return graph.findEntitiesInRange(file, piece.startLine, piece.endLine) || []; } catch { return []; }
}

const labelOrNull = (v) => (v && v !== 'unknown' && v !== 'code' ? String(v) : null);

/**
 * The next-best places that were ranked but not printed, each with every entity it holds.
 *
 * A place is a ranked chunk's unprinted part (alsoPieces), widened to the function it lies
 * inside, never over printed lines. It names the function it lies inside and every
 * function or type that starts in it: a cAST chunk labelled `can_make_new?` also holds
 * `try_make_new` and `acquire`. A place that overlaps an earlier one joins it. A place
 * with no name is dropped (the printer names a cut no place covers: uncoveredCutRests).
 *
 * @param {Array<{id?, symbol?, type?, startLine, endLine, score}>} pool - ranked chunks, best first
 * @param {Array<object>} printedSpans - the printed spans (truncation metadata included)
 * @param {{ file: string, graph?: object|null, max?: number }} opts
 * @returns {Array<{startLine, endLine, names: string[], name: string|null, kind: string|null, score: number}>}
 *   at most `max`, in score order; none overlaps a printed line
 */
export function buildAlsoCandidates(pool, printedSpans, { file, graph = null, max = ALSO_MAX } = {}) {
  const printed = printedRanges(printedSpans);
  const out = [];
  for (const piece of alsoPieces(pool, printedSpans)) {
    if (out.length >= max) break;
    const ent = enclosingFor(graph, file, piece);
    let range = { startLine: piece.startLine, endLine: piece.endLine };
    if (ent) {
      // The whole function the piece lies in, minus any printed lines of it: the unprinted
      // stretch that holds the piece.
      range = unprintedStretch(Math.min(ent.startLine, piece.startLine), Math.max(ent.endLine, piece.endLine), printed, piece.startLine);
    }
    const inside = insideOf(graph, file, piece);
    const entities = graph ? rangeEntities(inside, ent, piece.startLine, piece.endLine) : [];
    let names = entities.map(qualifiedName);
    // No entity there at all (or no graph): the chunk's stored label stands in for one. A
    // piece that holds only the stub of an entity (a class's opening lines) is no place.
    if (!names.length && !inside.some(isNameable)) {
      const label = labelOrNull(baseSymbol(piece.symbol));
      if (label) names = [label];
    }
    const kind = entities[0] ? kindOf(entities[0]) || null : labelOrNull(piece.type);
    if (!names.length) continue;
    // One entry per place: a place inside or across an earlier one joins it (two body chunks
    // of one function, a signature-only chunk of it, two overloads).
    const host = out.find(o => overlaps(range.startLine, range.endLine, o.startLine, o.endLine)
      || (!entities.length && names.length && names.every(n => o.names.includes(n))));
    if (host) {
      if (overlaps(range.startLine, range.endLine, host.startLine, host.endLine)) {
        host.startLine = Math.min(host.startLine, range.startLine);
        host.endLine = Math.max(host.endLine, range.endLine);
      }
      for (const n of names) if (!host.names.includes(n)) host.names.push(n);
      host.name = host.names[0] || null;
      continue;
    }
    out.push({ startLine: range.startLine, endLine: range.endLine, names, name: names[0] || null, kind, score: piece.score });
  }
  return out;
}

/**
 * What one output has printed so far, for shortNames: `names` printed on their own, and the
 * `parents` of the qualified names printed.
 */
export function nameContext(names = []) {
  return { names: new Set(names), parents: new Set() };
}

/**
 * Print names without a `Parent.` prefix the reader can supply. A prefix is dropped when
 * the output has had no other parent so far and either this parent was printed already
 * (`ValueConcurrentObserver.asyncStart`, then `setNeedsFetching`) or it was printed as a
 * name of its own (`TimedQueueConnectionPool` in the heading, then `initialize`); and
 * inside one list after a name with the same parent (`Builder.traceId, parentId, id`).
 * Once two parents were printed (zipkin `Span` and `Builder`), a bare name could belong to
 * either, so only the list-local rule applies. A constructor named like its class (the
 * short form repeats a name of the list) is dropped: the class place holds it.
 *
 * @param {string[]} names
 * @param {{names: Set<string>, parents: Set<string>}} ctx - from nameContext() (updated)
 */
function shortNames(names, ctx) {
  const out = [];
  let lastParent = null;
  for (const n of names) {
    const s = String(n);
    const dot = s.lastIndexOf('.');
    const parent = dot > 0 ? s.slice(0, dot) : null;
    let short = s;
    if (parent) {
      const only = ctx.parents.size === 0 ? ctx.names.has(parent) : (ctx.parents.size === 1 && ctx.parents.has(parent));
      if (only || parent === lastParent) short = s.slice(dot + 1);
      ctx.parents.add(parent);
    }
    lastParent = parent;
    if (out.includes(short) || (short !== s && out.includes(s))) continue;
    if (short === s) ctx.names.add(s);
    out.push(short);
  }
  return out;
}

function capped(names, cap) {
  const shown = names.slice(0, cap);
  if (names.length > cap) shown.push(`+${names.length - cap}`);
  return shown.join(', ');
}

/** The names a span heading prints (entity names, else chunk labels). */
function headerNames(span) {
  return Array.isArray(span?.entityNames) && span.entityNames.length
    ? span.entityNames
    : mergeSpanNames([], span?.symbols, { truncated: span?.truncated === true });
}

/**
 * `## 11-80 TimedQueueConnectionPool, initialize, all_connections, disconnect`: the span's
 * printed lines and what they hold (at most `cap` names, then +N).
 *
 * @param {object} span
 * @param {object} [named] - nameContext() of this output (updated)
 */
export function formatSpanHeading(span, named = nameContext(), cap = HEADER_SYMBOL_CAP) {
  const names = shortNames(headerNames(span), named);
  return `## ${span.startLine}-${span.endLine}${names.length ? ` ${capped(names, cap)}` : ''}`;
}

/**
 * `# also: 123-172 preallocated_make_new, fill_queue · 174-234 can_make_new?, try_make_new, acquire`,
 * or '' when there is nothing.
 *
 * @param {Array<object>} candidates
 * @param {object} [named] - nameContext() of this output (updated)
 */
export function formatAlsoLine(candidates, named = nameContext(), cap = ALSO_NAME_CAP) {
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  const parts = candidates.map((c) => {
    const names = shortNames(Array.isArray(c.names) ? c.names : (c.name ? [c.name] : []), named);
    return `${c.startLine}-${c.endLine}${names.length ? ` ${capped(names, cap)}` : ''}`;
  });
  return `# also: ${parts.join(' · ')}`;
}

/**
 * The unprinted rest of each span the budget cut (exact ranges) that no also place covers,
 * as `a-b` ranges: the printer names them so a cut is never silent.
 */
export function uncoveredCutRests(spans, candidates) {
  const out = [];
  const covers = (candidates || []).filter(c => Number.isInteger(c?.startLine) && Number.isInteger(c?.endLine));
  for (const s of spans || []) {
    if (s?.truncated !== true || !Number.isInteger(s.fullEndLine) || !(s.fullEndLine > s.endLine)) continue;
    let pieces = [[s.endLine + 1, s.fullEndLine]];
    for (const c of covers) {
      const next = [];
      for (const [a, b] of pieces) {
        if (!overlaps(a, b, c.startLine, c.endLine)) { next.push([a, b]); continue; }
        if (a < c.startLine) next.push([a, c.startLine - 1]);
        if (b > c.endLine) next.push([c.endLine + 1, b]);
      }
      pieces = next;
    }
    // When places cover part of the rest, a stretch of at most two lines left over is the
    // context padding around a chunk (a closing brace, a blank line), not a place.
    const partly = pieces.length !== 1 || pieces[0][0] !== s.endLine + 1 || pieces[0][1] !== s.fullEndLine;
    for (const [a, b] of pieces) if (!partly || b - a + 1 > 2) out.push(`${a}-${b}`);
  }
  return out;
}

/** The ` [a, b, c, d, +2]` tail of a span header, or '' when the span has no names. */
export function formatSpanSymbols(span, cap = HEADER_SYMBOL_CAP) {
  const names = headerNames(span);
  if (!names.length) return '';
  return ` [${capped(names, cap)}]`;
}

/**
 * Builds, scores and selects the related rows and container member rows shown next to a result.
 */

import { informativeSubtokens } from '../query-sufficiency.js';
import { isSummaryOnly, isTestLikePath } from '../agent-output-fixes.js';

/** The entity the related rows hang off, by id (the expansion's label can be a member of it). */
const SCOPE_ENTITY_TYPES = new Set(['namespace', 'module', 'package']);

/**
 * The entity related rows describe. A namespace or module (C# `namespace Ocelot.X;` on the
 * chunk's first line) has no calls or types of its own: the first other definition in the
 * range stands for the entry instead (`types in class DownstreamPathPlaceholderReplacer`).
 */
export function relatedSubjectEntity(codeGraphRepo, entity) {
  const stored = entity.id && typeof codeGraphRepo?.getEntityById === 'function' ? safeCall(() => codeGraphRepo.getEntityById(entity.id)) : null;
  if (!SCOPE_ENTITY_TYPES.has(String(stored?.type || entity.type || '').toLowerCase())) return entity;
  if (typeof codeGraphRepo?.findEntitiesInRange !== 'function') return entity;
  const rows = safeCall(() => codeGraphRepo.findEntitiesInRange(entity.filePath, entity.startLine, entity.endLine)) || [];
  const inner = rows.find((r) => r.id !== entity.id && !SCOPE_ENTITY_TYPES.has(String(r.type || '').toLowerCase())
    && r.name && !String(r.name).startsWith('<anonymous'));
  return inner ? { ...entity, id: inner.id, name: inner.name, type: inner.type, startLine: inner.startLine, endLine: inner.endLine } : entity;
}

export function subjectOf(codeGraphRepo, entity) {
  const row = typeof codeGraphRepo.getEntityById === 'function' ? safeCall(() => codeGraphRepo.getEntityById(entity.id)) : null;
  return { name: row?.name || entity.name || null, type: row?.type || (row ? null : entity.type) || null };
}

/** Related rows the pack keeps by default (agent / agent_preview); agent_full 4, agent_full_xl 5. */
export const RELATED_DEFAULT_ROWS = 3;

/**
 * Name-only resolution: a call / use into another file, or a body type name, whose name has
 * this many definitions is dropped; so are the incoming rows of a target whose name has this
 * many definitions AND at least RELATED_AMBIGUOUS_FANIN incoming edges, or RELATED_GENERIC_DEFS
 * definitions whatever its fan-in.
 */
export const RELATED_AMBIGUOUS_DEFS = 3;

export const RELATED_AMBIGUOUS_FANIN = 20;

export const RELATED_GENERIC_DEFS = 10;

/** Incoming edges read to measure the fan-in (the rows printed are still at most 8). */
export const RELATED_FANIN_PROBE = 24;

export function safeCall(fn) {
  try { return fn(); } catch { return null; }
}

/** Old one-row-per-line text of a related row (SS_FIX_A=0 printers; token estimate). */
export function renderRelatedRowLine(row) {
  const range = (a, b) => (a && b && b > a) ? `${a}-${b}` : `${a || '?'}`;
  if (row.file && row.startLine) {
    const incoming = row.kind === 'caller' || row.kind === 'user';
    return `- ${row.kind} ${row.name} ${incoming ? '←' : '→'} ${row.file}:${range(row.startLine, row.endLine)} [${row.entityType}]`;
  }
  if (row.file) return `- ${row.kind} ${row.name} → ${row.file}`;
  if (row.unresolved) return `- ${row.kind} ${row.name} ← '${row.importPath}' (unresolved)`;
  if (row.line) return `- ${row.kind} ${row.name} (referenced at line ${row.line})`;
  return `- ${row.kind} ${row.name}`;
}

/**
 * The shortest suffix of `file` (whole path components) that no other repository file ends
 * with. `index`: basename → every repository path with that basename (fileBasenameIndex);
 * without it, the full path.
 */
export function shortestUniquePath(file, index) {
  const parts = String(file || '').split('/');
  const same = index instanceof Map ? index.get(parts[parts.length - 1]) : null;
  if (!Array.isArray(same) || same.length === 0) return file;
  for (let n = 1; n < parts.length; n++) {
    const suffix = parts.slice(-n).join('/');
    if (same.every((other) => other === file || !(other === suffix || other.endsWith(`/${suffix}`)))) return suffix;
  }
  return file;
}

// A query that asks about tests: then test-file related rows stay.
export const TEST_QUERY_RE = /\b(tests?|testing|unit[- ]?tests?|specs?|fixtures?|mocks?)\b/i;

/** Two lowercase subtokens agree: equal, or one is a prefix (>= 4 chars) of the other (chain/chained). */
function subtokensAgree(a, b) {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short);
}

function countAgreeing(tokens, queryTokens) {
  let n = 0;
  for (const t of tokens) {
    for (const q of queryTokens) if (subtokensAgree(t, q)) { n++; break; }
  }
  return n;
}

/**
 * Relevance of one related row to the query (cheap: a few token comparisons): +1 per name
 * subtoken that agrees with a query subtoken, +0.5 per path subtoken (file name and its
 * directory, at most 2), +1 when the row's entity is itself a search candidate.
 */
export function relatedRowScore(row, queryTokens, candidates = []) {
  const nameHits = countAgreeing(informativeSubtokens(row.name), queryTokens);
  let pathHits = 0;
  if (row.file) {
    const parts = String(row.file).split('/');
    const base = parts[parts.length - 1].replace(/\.[^.]+$/, '');
    const dir = parts.length > 1 ? parts[parts.length - 2] : '';
    pathHits = Math.min(2, countAgreeing(informativeSubtokens(`${base} ${dir}`), queryTokens));
  }
  const candidate = row.file && row.startLine
    && candidates.some((c) => c && c.file === row.file && c.startLine <= row.endLine && c.endLine >= row.startLine);
  return nameHits + 0.5 * pathHits + (candidate ? 1 : 0);
}

// Container rows. A summary row that names a large type
// (`lib/sequel/model/base.rb 4-2449 class Model`, an entity hit on the name Model) points at
// 2,445 lines and gave the agent nothing to read; the method that answered,
// primary_key_lookup at 1079, sat inside it. Such a row now names the type's members whose
// names agree with the query on at least CONTAINER_MEMBER_MIN_AGREE subtokens, best first.
export const CONTAINER_ROW_MIN_LINES = 120;

const CONTAINER_MEMBER_MIN_AGREE = 2;

const CONTAINER_MEMBERS_MAX = 3;

const CONTAINER_TYPES = new Set(['class', 'module', 'struct', 'interface', 'trait', 'impl', 'object', 'enum', 'protocol', 'extension', 'namespace', 'record', 'actor']);

const MEMBER_TYPES = new Set(['method', 'function', 'constructor', 'getter', 'setter', 'property', 'field', 'macro', 'constant']);

/**
 * The members of `row`'s span (entities of its file) that the query names: callables and
 * fields whose name subtokens agree with >= CONTAINER_MEMBER_MIN_AGREE query subtokens.
 * Best agreement first, then the larger share of the name, then file order; one per name.
 */
export function containerRowMembers(entities, row, queryTokens, max = CONTAINER_MEMBERS_MAX) {
  if (!Array.isArray(entities) || !queryTokens?.length) return [];
  const scored = [];
  for (const e of entities) {
    if (!e?.name || !MEMBER_TYPES.has(String(e.type || '').toLowerCase())) continue;
    // A constructor named like its type (`BatchInsertSpans` in class BatchInsertSpans) adds nothing.
    if (row.symbol && e.name === row.symbol) continue;
    if (!(e.startLine > row.startLine && e.endLine <= row.endLine)) continue;
    const tokens = [...informativeSubtokens(e.name)];
    if (!tokens.length) continue;
    const agree = countAgreeing(tokens, queryTokens);
    if (agree < CONTAINER_MEMBER_MIN_AGREE) continue;
    scored.push({ e, agree, share: agree / tokens.length });
  }
  scored.sort((a, b) => b.agree - a.agree || b.share - a.share || a.e.startLine - b.e.startLine);
  const out = [];
  for (const { e } of scored) {
    if (out.some(o => o.name === e.name)) continue;
    out.push({ name: e.name, type: e.type || null, startLine: e.startLine, endLine: e.endLine });
    if (out.length >= max) break;
  }
  return out;
}

/** Stamp `memberHits` on summary rows of large types (see containerRowMembers). */
export function annotateContainerRowMembers(results, codeGraphRepo, query) {
  if (!Array.isArray(results) || typeof codeGraphRepo?.findEntitiesInFile !== 'function') return;
  const queryTokens = [...informativeSubtokens(query || '')];
  if (!queryTokens.length) return;
  for (const r of results) {
    if (!isSummaryOnly(r) || !r.file || !CONTAINER_TYPES.has(String(r.symbolType || '').toLowerCase())) continue;
    if (!(Number.isInteger(r.startLine) && Number.isInteger(r.endLine)) || r.endLine - r.startLine + 1 < CONTAINER_ROW_MIN_LINES) continue;
    let entities = [];
    try { entities = codeGraphRepo.findEntitiesInFile(r.file, { limit: 2048 }); } catch { entities = []; }
    const members = containerRowMembers(entities, r, queryTokens);
    if (members.length) r.memberHits = members;
  }
}

/** Rows to show: no test-file rows unless the query asks about tests; score >= 1; best first; at most maxRows. */
export function selectRelatedRows(rows, query, candidates = [], maxRows = RELATED_DEFAULT_ROWS) {
  const queryTokens = [...informativeSubtokens(query)];
  const testsAsked = TEST_QUERY_RE.test(String(query || ''));
  return rows
    .map((row, i) => ({ row, i, score: (!testsAsked && row.file && isTestLikePath(row.file)) ? -1 : relatedRowScore(row, queryTokens, candidates) }))
    .filter((x) => x.score >= 1)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, Math.max(0, maxRows))
    .sort((a, b) => a.i - b.i)
    .map((x) => x.row);
}

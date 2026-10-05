/**
 * sweet-search read — filesystem-grounded file reader. Returns exact bytes from
 * disk; the vectors index may attach symbol/chunk metadata, but the returned
 * `text` always comes from node:fs, never from the (truncated) DB column.
 */

import { promises as fs, realpathSync, statSync } from 'node:fs';
import { GUTTER_FORMS, resolveGutterForm, gutterDelimiter } from './gutter-form.js';
import path from 'node:path';
import { CodebaseRepository } from '../infrastructure/codebase-repository.js';
import { CodeGraphRepository } from '../infrastructure/code-graph-repository.js';
import { DB_PATHS, PROJECT_ROOT } from '../infrastructure/config/index.js';
import { withPinnedRead } from './search-reader-pin.js';
import { emitToolIdentityAuto } from './cli-decoration.js';
import { resolveProjectRoot } from './server-identity.js';
import { resolveCwdPath } from './cwd-paths.js';
import {
  applyReadOmissionDecisions,
  collectReadShownSpans,
  exactRereadOmissionEnabled,
  renderReadOmission,
  resolveAgentSessionId,
} from './agent-span-ledger.js';
import { sendAgentSpanOperation } from './agent-span-client.js';
import { selectUnreadSymbols, nameWordsMatched } from './unread-symbol-ranking.js';
import { isTestPath } from '../graph/relationship-resolver.js';
import { containsToken, informativeSubtokens } from './query-sufficiency.js';
import { kindName, kindNameList } from './kind-words.js';

const CACHE_MAX_ENTRIES = 64;
const CACHE_LARGE_FILE_BYTES = 4 * 1024 * 1024; // 4MB — switch to range-read mode
const _cache = new Map(); // key -> { text|null, lineOffsets, size, mtimeMs }

// ---------------------------------------------------------------------------
// Span-gated whole-file expansion
//
// When a range read ALREADY covers a quarter of a small file, serving the rest
// costs little and removes the later re-read of the same file entirely. The
// carrying cost is bounded by construction: the remainder that gets injected is
// at most (1 - MIN_FRAC) of a file no larger than MAX_LINES.
//
// WHY THESE TWO NUMBERS (2026-08-14, three-harness replay, d11-c4-all-harnesses.mjs)
// ---------------------------------------------------------------------------
// Replayed over 102 sweet rollouts — 34 each on codex, opencode and claude-code,
// each harness's baseline reproducing its recorded arm cost to 100.0%:
//
//              codex     opencode   claude     mean     worst harness
//   0.25/600   -1.60%    -2.08%     -4.72%     -2.80%   -1.60%
//
// 71 of 72 configurations in a 9x8 grid save money on all three harnesses at
// once, so the mechanism is flat rather than tuned, and the exact constants
// matter far less than the fact that the gate exists.
//
// NOT any harness's argmax, deliberately, for two reasons.
//
// 1. THE CLIFF. On opencode and claude the effect MORE THAN DOUBLES between
//    cap 350 and cap 400 (opencode -0.93 -> -2.08, claude -1.54 -> -4.54). The
//    per-harness optima all sit at cap 400, i.e. directly ON that edge. 600 is
//    250 lines clear, and a corpus with slightly larger files moves the edge.
// 2. THE FRACTION HAS TO KEEP THE MECHANISM HONEST. 0.15 scores marginally
//    better on the worst harness (-2.07 vs -1.60, well inside the +/-1.5pp
//    bootstrap SE) but it means expanding a 500-line file after a 75-line
//    request. The policy only makes sense while "already paying for most of it"
//    is true, so the gate stays at a quarter.
//
// Anything in span 0.15-0.30 x cap 400-600 is the same policy on this evidence.
//
// ONE MEASUREMENT TRAP, recorded because it cost a wrong set of constants:
// `ss-read <file> <start>` is a SINGLE LINE in the bench wrapper, not
// start-to-EOF (_ss-helpers.mjs:523). A replay that reads it as start-to-EOF
// inflates the covered fraction on 176 of 1000 recorded calls and moved the
// codex figure from -1.60% to a spurious -3.30%. Parse the wrapper, not the
// library default.
const SPAN_EXPAND_MIN_FRAC = 0.25;
const SPAN_EXPAND_MAX_LINES = 600;

// Expansion is OPT-IN at the library boundary and enabled at the agent-facing
// entry points. It must NOT default on, because it changes `text` and `range`,
// and the retrieval evaluation harness (eval/read-workflows/runners.js) calls
// readFile() with a chunk range and measures containment from the lines that
// come back. A default-on expansion would silently inflate that measurement —
// the same class of accuracy regression that format-gating exists to prevent.
// So: measurement paths get the exact span they asked for, always.
// DEFAULT OFF EVERYWHERE, 2026-08-14, after a live paired A/B refuted the replay.
// Opt in per call with `spanExpand: true` AND `SS_READ_SPAN_EXPAND=1`.
//
// The replay predicted -1.60 / -2.08 / -4.72% on codex / opencode / claude-code. A live
// 3-rep A/B on all three measured **+4.78 / +19.79 / +11.72%** on the ideal column -- the
// sign inverted everywhere. Excluding the one task that never solves, claude-code is
// **+41.3%**. Trace analysis says why: the replay held the trajectory FIXED and only
// re-counted tokens, but an agent handed the whole file does MORE work, not less
// (claude-code: 105 edits with the gate on against 79 off, 23.6 calls against 20.5).
//
// The delivery mechanism itself works exactly as designed and replicates on all three
// harnesses -- whole-file serving ~69% against ~40%, and on codex and opencode re-reads
// fall 66% and 43%. On claude-code the same delivery change makes re-reads RISE 55%.
// So this is kept, tested and documented, and shipped to nobody.
// Evidence: SLATE-A-CLOSE-RESULTS.md 9.13.
export function spanExpandEnabled(req = {}) {
  if (process.env.SS_READ_SPAN_EXPAND !== '1') return false;
  if (req.format === 'benchmark' || req.format === 'raw' || req.format === 'json') return false;
  return req.spanExpand === true;
}

/**
 * Decide the effective line range for a read. Returns the requested range
 * unchanged unless the span gate fires.
 *
 * @returns {{startLine:number, endLine:number|null, expanded:boolean}}
 */
export function resolveSpanExpansion(totalLines, startLine, endLine, req = {}) {
  const reqStart = startLine ?? 1;
  const reqEnd = endLine ?? null;
  if (!spanExpandEnabled(req)) return { startLine: reqStart, endLine: reqEnd, expanded: false };
  if (!Number.isFinite(totalLines) || totalLines <= 0) return { startLine: reqStart, endLine: reqEnd, expanded: false };
  if (totalLines > SPAN_EXPAND_MAX_LINES) return { startLine: reqStart, endLine: reqEnd, expanded: false };
  const s = Math.max(1, reqStart | 0);
  const e = reqEnd == null ? totalLines : Math.min(totalLines, reqEnd | 0);
  const covered = Math.max(0, e - s + 1);
  if (covered >= totalLines) return { startLine: reqStart, endLine: reqEnd, expanded: false }; // already whole
  if (covered / totalLines < SPAN_EXPAND_MIN_FRAC) return { startLine: reqStart, endLine: reqEnd, expanded: false };
  return { startLine: 1, endLine: totalLines, expanded: true };
}

function _cacheKey(absPath, size, mtimeMs) {
  return `${absPath}|${size}|${mtimeMs}`;
}

function _cacheTouch(key, value) {
  if (_cache.has(key)) _cache.delete(key);
  _cache.set(key, value);
  while (_cache.size > CACHE_MAX_ENTRIES) {
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
  }
}

const _repos = new Map();
function _getRepo(projectRoot) {
  const dbPath = _codebasePathForProject(projectRoot);
  if (!_repos.has(dbPath)) {
    try { _repos.set(dbPath, new CodebaseRepository(dbPath)); }
    catch { _repos.set(dbPath, false); }
  }
  return _repos.get(dbPath) || null;
}

function _codebasePathForProject(projectRoot) {
  const root = path.resolve(projectRoot || process.cwd());
  if (root === path.resolve(PROJECT_ROOT || process.cwd())) return DB_PATHS.codebase;
  const stateDir = path.basename(path.dirname(DB_PATHS.codebase || '.sweet-search/codebase.db'));
  return path.join(root, stateDir, 'codebase.db');
}

// Code-graph (entities) access for the unread-ABOVE trailer. The chunk table
// names functions and classes; the entity table also names fields, enum
// constants and properties — the state a method reads, which is exactly what
// sits above a mid-file read window (squashql-295: a field declared at L35,
// read at L207, window 170-235). Opened lazily, cached per project.
const _graphRepos = new Map();
function _getGraphRepo(projectRoot) {
  const root = path.resolve(projectRoot || process.cwd());
  const dbPath = root === path.resolve(PROJECT_ROOT || process.cwd())
    ? DB_PATHS.codeGraph
    : path.join(root, path.basename(path.dirname(DB_PATHS.codeGraph || '.sweet-search/code-graph.db')), 'code-graph.db');
  if (!_graphRepos.has(dbPath)) {
    try { _graphRepos.set(dbPath, new CodeGraphRepository(dbPath)); }
    catch { _graphRepos.set(dbPath, false); }
  }
  return _graphRepos.get(dbPath) || null;
}

/** The project's code-graph repository (null when it cannot be opened); shared with read-semantic. */
export function getGraphRepoForProject(projectRoot) {
  return _getGraphRepo(projectRoot);
}

function _resolvePath(p, projectRoot) {
  if (!p) throw new Error('path is required');
  if (path.isAbsolute(p)) return p;
  return path.resolve(projectRoot || process.cwd(), p);
}

function _projectRelative(absPath, projectRoot) {
  const root = projectRoot || process.cwd();
  const normalized = _normalizeRelativePath(path.relative(root, absPath));
  if (normalized) return normalized;
  try {
    return _normalizeRelativePath(
      path.relative(realpathSync.native(root), realpathSync.native(absPath)),
    ) || absPath;
  } catch {
    return absPath;
  }
}

function _normalizeRelativePath(rel) {
  const normalized = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  return (
    normalized && !normalized.startsWith('../') && !path.isAbsolute(normalized)
      ? normalized
      : null
    );
}

// ---------------------------------------------------------------------------
// Line-offset table — index of byte offsets where each line starts.
// lineOffsets[i] = byte offset of start of line (i+1). lineOffsets has
// totalLines entries. To slice lines [a..b] (1-based, inclusive):
//   start = lineOffsets[a-1]
//   end   = (b < totalLines) ? lineOffsets[b] : buffer.length
// ---------------------------------------------------------------------------

function _buildLineOffsets(buf) {
  const offsets = [0];
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0A /* \n */) offsets.push(i + 1);
  }
  // If the file ends without a trailing newline, the final offset isn't a
  // line start — strip it. The line count is offsets.length.
  if (offsets[offsets.length - 1] === buf.length) offsets.pop();
  return offsets;
}

// ---------------------------------------------------------------------------
// Read implementation
// ---------------------------------------------------------------------------

async function _readFromDisk(absPath) {
  // statSync is OK here — async stat costs more than the sync syscall.
  let stat;
  try { stat = statSync(absPath); }
  catch (err) { throw new Error(`stat failed: ${err.code || err.message}`); }
  if (!stat.isFile()) throw new Error('not a regular file');

  const key = _cacheKey(absPath, stat.size, stat.mtimeMs);
  const cached = _cache.get(key);
  if (cached) {
    _cacheTouch(key, cached);
    return { ...cached, key, size: stat.size, mtimeMs: stat.mtimeMs };
  }

  // For large files we still read fully on first call (Node fs has no
  // efficient line-aware streaming primitive), but subsequent line-range
  // reads will reuse the cached offset table without re-reading from disk.
  // If the file is enormous and the caller asked for a range, we read just
  // enough bytes to cover the range — see _sliceLines().
  const buf = await fs.readFile(absPath);
  const lineOffsets = _buildLineOffsets(buf);
  const isLarge = stat.size > CACHE_LARGE_FILE_BYTES;
  const entry = {
    text: isLarge ? null : buf.toString('utf8'),
    lineOffsets,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
  _cacheTouch(key, entry);

  // Even for large files we return the freshly-read text on this call so the
  // first read is correct; subsequent calls can stream by line range.
  return {
    text: entry.text ?? buf.toString('utf8'),
    lineOffsets,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    key,
  };
}

function _normalizeLineRange(lineOffsets, startLine, endLine) {
  // Returns the exact disk bytes for lines [startLine..endLine] (1-based,
  // inclusive). Trailing newlines that are present on disk are preserved —
  // we are a filesystem-grounded reader and must never silently mutate
  // returned content.
  const total = lineOffsets.length;
  if (total === 0) return { startLine: 1, endLine: 0, totalLines: 0, startByte: 0, endByte: 0 };
  const s = Math.max(1, startLine | 0);
  // A start past the last line selects nothing. It used to fall through with
  // startByte undefined, and the slice then returned the WHOLE file under a
  // header like "lines 400-293 of 293".
  if (s > total) return { startLine: s, endLine: s - 1, totalLines: total, startByte: null, endByte: null, pastEnd: true };
  const eRaw = (endLine == null) ? total : (endLine | 0);
  const e = Math.min(total, Math.max(s, eRaw));
  const startByte = lineOffsets[s - 1];
  return { startLine: s, endLine: e, totalLines: total, startByte, endByte: null };
}

function _sliceLines(text, lineOffsets, startLine, endLine) {
  const range = _normalizeLineRange(lineOffsets, startLine, endLine);
  if (range.totalLines === 0) return { text: '', startLine: 1, endLine: 0, totalLines: 0 };
  if (range.pastEnd) return { text: '', startLine: range.startLine, endLine: range.endLine, totalLines: range.totalLines };
  const endByte = (range.endLine < range.totalLines)
    ? lineOffsets[range.endLine]
    : Buffer.byteLength(text, 'utf8');
  // Slice on bytes via Buffer view to handle multibyte UTF-8 safely.
  const buf = Buffer.from(text, 'utf8');
  const slice = buf.subarray(range.startByte, endByte).toString('utf8');
  return { text: slice, startLine: range.startLine, endLine: range.endLine, totalLines: range.totalLines };
}

async function _sliceLinesFromDisk(absPath, lineOffsets, fileSize, startLine, endLine) {
  const range = _normalizeLineRange(lineOffsets, startLine, endLine);
  if (range.totalLines === 0) return { text: '', startLine: 1, endLine: 0, totalLines: 0 };
  if (range.pastEnd) return { text: '', startLine: range.startLine, endLine: range.endLine, totalLines: range.totalLines };
  const endByte = (range.endLine < range.totalLines) ? lineOffsets[range.endLine] : fileSize;
  const len = Math.max(0, endByte - range.startByte);
  const handle = await fs.open(absPath, 'r');
  try {
    const buf = Buffer.allocUnsafe(len);
    await handle.read(buf, 0, len, range.startByte);
    return {
      text: buf.toString('utf8'),
      startLine: range.startLine,
      endLine: range.endLine,
      totalLines: range.totalLines,
    };
  } finally {
    await handle.close();
  }
}

// ---------------------------------------------------------------------------
// Index metadata enrichment
// ---------------------------------------------------------------------------

function _parseMeta(rawMeta) {
  if (!rawMeta) return null;
  if (typeof rawMeta === 'object') return rawMeta;
  try { return JSON.parse(rawMeta); } catch { return null; }
}

function _metaSymbol(meta) {
  return meta.name ?? meta.symbol ?? null;
}

function _metaType(meta) {
  return meta.type ?? meta.chunk_type ?? null;
}

function _metaStartLine(meta) {
  return typeof meta.startLine === 'number' ? meta.startLine
    : typeof meta.line_start === 'number' ? meta.line_start
      : null;
}

function _metaEndLine(meta) {
  return typeof meta.endLine === 'number' ? meta.endLine
    : typeof meta.line_end === 'number' ? meta.line_end
      : null;
}

function _attachIndexMetadata(filePathRel, projectRoot) {
  const repo = _getRepo(projectRoot);
  if (!repo) return { indexed: false, chunks: [], language: null };

  const rows = repo.getChunksByFilePath(filePathRel);
  if (rows.length === 0) return { indexed: false, chunks: [], language: null };

  const chunks = [];
  let language = null;
  for (const row of rows) {
    const meta = _parseMeta(row.metadata) || {};
    if (!language && meta.language) language = meta.language;
    chunks.push({
      id: row.id,
      symbol: _metaSymbol(meta),
      type: _metaType(meta),
      startLine: _metaStartLine(meta),
      endLine: _metaEndLine(meta),
      signature: meta.signature ?? null,
    });
  }
  // Order by startLine for predictable consumption.
  chunks.sort((a, b) => (a.startLine ?? 0) - (b.startLine ?? 0));
  return { indexed: true, chunks, language };
}

// ---------------------------------------------------------------------------
// Remainder definition sniffing — fallback symbol names for the "what
// remains" trailer when the index has no named chunks in the unread span
// (e.g. C++ files where the chunker recorded `name: null`). Scans ONLY the
// remainder lines of the buffer already in memory: zero I/O, capped.
// ---------------------------------------------------------------------------

const SNIFF_MAX_LINES = 4000;
const UNREAD_SYMBOLS_MAX = 5;        // hard cap on named symbols in the trailer
const UNREAD_SYMBOLS_MIN_LINES = 20; // smaller remainders get the short form
const C_FAMILY_EXTS = new Set(['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx', '.java', '.cs', '.m', '.mm']);
const _unreadSymbolCandidates = new WeakMap();
const ABOVE_STATE_TYPES = new Set(['field', 'property', 'variable', 'constant', 'const', 'static', 'enum_constant']);

// Keyword-introduced definitions (Python/Ruby/JS/TS/Go/Rust/Kotlin/PHP/...).
const KEYWORD_DEF_RE = /^\s*(?:export\s+|default\s+|pub(?:\([^)]*\))?\s+|static\s+|async\s+|abstract\s+|final\s+|public\s+|private\s+|protected\s+|inline\s+|constexpr\s+|unsafe\s+|override\s+|open\s+|sealed\s+)*(?:def|fn|func|function\*?|class|struct|enum|trait|interface|impl|object|module|proc)\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*(?:(?:::|\.)[A-Za-z_][\w]*)*)/;
// C-family definitions at low indent: `[return-type] Qualified::name(args...`
// with no trailing `;` (declarations) — captures the identifier before the
// first `(`. The return-type prefix is lazy so qualification stays intact.
const C_DEF_RE = /^(?:[A-Za-z_][\w:<>,*&~\s]*?[\s*&]+)?((?:[A-Za-z_~][\w]*::)*(?:~?[A-Za-z_][\w]*|operator\s*[^\s(]{1,3}))\s*\(/;
const C_CONTROL_RE = /^\s*(?:if|for|while|switch|return|else|do|catch|case|sizeof|new|delete|throw|goto|using|typedef)\b/;

// The chunker names the pieces of a long definition `name (part 2)`, `name (part 3)`. A
// trailer lists DEFINITIONS, so the pieces are one name: `addTypeDocOptions (part 14),
// addTypeDocOptions (part 15), …` filled all five slots with one function.
function _baseSymbol(symbol) {
  return symbol ? String(symbol).replace(/ \(part \d+\)$/, '') : symbol;
}

// Entity kinds with a body the reader can be in the middle of. A class or module that
// runs on past the window says nothing the below line does not.
const BODY_ENTITY_TYPES = new Set(['function', 'method', 'arrowFunction', 'objectArrow', 'constructor', 'macro']);

/**
 * The smallest function-like entity that spans `line` and also `line + step` (step -1:
 * it started above the window; +1: it runs on below it). Null when there is none.
 */
function _bodyEntityAcross(graph, filePathRel, line, step) {
  if (!graph || typeof graph.findEnclosingEntity !== 'function') return null;
  const lo = Math.min(line, line + step);
  const hi = Math.max(line, line + step);
  let e = null;
  try { e = graph.findEnclosingEntity(filePathRel, lo, hi); } catch { e = null; }
  if (!e || !e.name || !BODY_ENTITY_TYPES.has(e.type)) return null;
  if (!Number.isInteger(e.startLine) || !Number.isInteger(e.endLine)) return null;
  return { symbol: e.name, type: e.type, startLine: e.startLine, endLine: e.endLine };
}

// Lines between a window's end and the next definition that still count as "right after"
// (a blank line, an annotation).
const NEXT_DEFINITION_GAP = 3;

/** The function / method / type whose first line is within NEXT_DEFINITION_GAP lines after `endLine`. */
function _definitionRightAfter(projectRoot, filePathRel, endLine) {
  const graph = _getGraphRepo(projectRoot);
  if (!graph || typeof graph.findEntitiesInRange !== 'function') return null;
  let rows = [];
  try { rows = graph.findEntitiesInRange(filePathRel, endLine + 1, endLine + NEXT_DEFINITION_GAP) || []; } catch { rows = []; }
  const e = rows.find(r => r?.name && (BODY_ENTITY_TYPES.has(r.type) || TYPE_ENTITY_TYPES.has(r.type))
    && Number.isInteger(r.startLine) && Number.isInteger(r.endLine));
  return e ? { symbol: e.name, type: e.type, startLine: e.startLine } : null;
}

/**
 * The code graph's kind for each listed symbol it holds (same name, same first line). The
 * chunker labels kinds on its own and calls a Swift / Kotlin / Python method a function; the
 * graph knows its container (grdb `functions openConnection` read `methods`).
 */
function _graphKinds(projectRoot, filePathRel, symbols, lo, hi) {
  if (!symbols.length) return symbols;
  const graph = _getGraphRepo(projectRoot);
  if (!graph || typeof graph.findEntityWithNameInRange !== 'function') return symbols.map(({ endLine: _end, ...row }) => row);
  return symbols.map((sym) => {
    if (!sym?.symbol || !Number.isInteger(sym.startLine)) return sym;
    // A chunk starts at the doc comment above its definition: the definition starts
    // somewhere in the chunk's own lines.
    const end = Number.isInteger(sym.endLine) && sym.endLine >= sym.startLine ? sym.endLine : sym.startLine;
    let e = null;
    try { e = graph.findEntityWithNameInRange(filePathRel, sym.startLine, Math.min(hi, end), sym.symbol); } catch { e = null; }
    const { endLine: _end, ...row } = sym;
    return e?.type && e.type !== sym.type ? { ...row, type: e.type } : row;
  });
}

const TYPE_ENTITY_TYPES = new Set(['class', 'struct', 'enum', 'interface', 'trait', 'impl', 'extension', 'protocol', 'object', 'actor', 'record']);

/** The smallest type entity that spans lines lo..hi, or null. */
function _typeEntityAround(graph, filePathRel, lo, hi) {
  if (!graph || typeof graph.findEnclosingEntity !== 'function') return null;
  let e = null;
  try { e = graph.findEnclosingEntity(filePathRel, lo, hi); } catch { e = null; }
  if (!e || !e.name || !TYPE_ENTITY_TYPES.has(e.type)) return null;
  if (!Number.isInteger(e.startLine) || !Number.isInteger(e.endLine)) return null;
  return { symbol: e.name, type: e.type, startLine: e.startLine, endLine: e.endLine };
}

function _sniffRemainderDefinitions(text, isCFamily) {
  const names = [];
  const seen = new Set();
  const lines = text.split('\n', SNIFF_MAX_LINES);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\S/.test(line)) continue;
    let name = null;
    const kw = line.match(KEYWORD_DEF_RE);
    if (kw) name = kw[1];
    else if (isCFamily && /^[A-Za-z_]/.test(line) && !line.trimEnd().endsWith(';') && !C_CONTROL_RE.test(line)) {
      const m = line.match(C_DEF_RE);
      if (m) name = m[1].replace(/\s+/g, '');
    }
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push({ symbol: name, type: null, startLine: i + 1 }); // startLine relative; caller offsets
    }
  }
  return names;
}

/**
 * SS_UNREAD_ABOVE=0 switches the above-trailer off. Default ON as a bounded
 * mechanism (one capped line, only when the window reads state declared
 * above; ≤0.6% of prompt tokens on the 2026-09-03 180-rollout replay). The
 * Gate 2 microsmoke that day showed no solve flip on squashql (0/6 with 6/6
 * exposure) and no control regression; the owner chose to ship it as a
 * cheap mechanism rather than a proven lever. Consulted at RENDER time only,
 * in the wrapper's own process; the structured field is always computed.
 */
export function unreadAboveEnabled() {
  return process.env.SS_UNREAD_ABOVE !== '0';
}

/**
 * Named symbols lying fully above `windowStart`, deduped by name: the ones
 * the window's text references first, then file order. Chunk rows first (functions/classes), then code-graph entities
 * (adds fields/constants/properties). Entities enclosing the window — the
 * class the window sits inside — are excluded: they are not "unread".
 */
function _collectAboveSymbols(chunks, filePathRel, projectRoot, windowStart, windowText = '') {
  const byName = new Map();
  const push = (rawSymbol, type, startLine, endLine) => {
    const symbol = _baseSymbol(rawSymbol);
    if (!symbol || byName.has(symbol)) return;
    byName.set(symbol, { symbol, type: type ?? null, startLine, endLine, referenced: false });
  };
  for (const c of chunks) {
    if (c.startLine == null || c.endLine == null || c.endLine >= windowStart) continue;
    push(c.symbol, c.type, c.startLine, c.endLine);
  }
  const graph = _getGraphRepo(projectRoot);
  if (graph && typeof graph.findEntitiesInRange === 'function') {
    let entities = [];
    try { entities = graph.findEntitiesInRange(filePathRel, 1, windowStart - 1) || []; }
    catch { entities = []; }
    for (const e of entities) {
      if (!Number.isInteger(e?.endLine) || e.endLine >= windowStart) continue;
      push(e.name, e.type, e.startLine, e.endLine);
    }
  }
  // Symbols the shown window READS come first: a field referenced by the
  // code in view is the state the reader has not seen, and it must survive
  // the five-slot cap even when no query evidence is available to rank it.
  // "Referenced" means a STATE read: a field/constant named in the window, or
  // any symbol read through the receiver (`this.x`, `self.x`, `self::x`, `@x`).
  // A plain call to a same-file method is not a signal — a Java window nearly
  // always makes one, and the 2026-09-03 replay showed that loose rule fired
  // on 80% of reads for no navigational gain (the below-trailer already
  // covers method-to-method movement).
  if (windowText) {
    const text = String(windowText);
    for (const [identifier] of text.matchAll(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g)) {
      const hit = byName.get(identifier);
      if (hit && ABOVE_STATE_TYPES.has(String(hit.type || '').toLowerCase())) hit.referenced = true;
    }
    for (const m of text.matchAll(/(?:\b(?:this|self)\s*(?:\.|::)\s*|(?<![\w$])@)([A-Za-z_$][A-Za-z0-9_$]{2,})/g)) {
      const hit = byName.get(m[1]);
      if (hit) hit.referenced = true;
    }
  }
  return [...byName.values()].sort((a, b) =>
    Number(b.referenced) - Number(a.referenced)
    || (a.startLine ?? 0) - (b.startLine ?? 0));
}

const INTERFACE_IMPLS_MAX = 2;        // more implementing classes than this: name none
const INTERFACE_CALL_LINES_MAX = 3;   // at most this many trailer lines per read

// Test roots that isTestPath (file-name and tests/ spec/ mocks/ dirs) does not cover:
// C# and Java suites live under unit/, acceptance/, integration/ (ocelot TestLoggerFactory).
const TEST_ROOT_DIR_RE = /(?:^|\/)(?:unit|acceptance|integration|e2e|functional)(?:[-_]?tests?)?\//i;
const isTestLikePath = (p) => isTestPath(p) || TEST_ROOT_DIR_RE.test(p || '');

/**
 * Pick the interface calls worth a trailer line from the graph rows of one read window.
 * Nothing for a test file (its calls go to test doubles). Test implementations are dropped,
 * same-method overloads count once, and a call whose implementation sits in the file being
 * read is skipped (it is already in view). One row per interface method, at its first call.
 */
export function selectInterfaceCalls(rows, filePathRel) {
  if (!Array.isArray(rows) || rows.length === 0 || isTestLikePath(filePathRel)) return [];
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.target)) continue;
    const byMethod = new Map();
    for (const i of row.impls || []) {
      if (isTestLikePath(i.filePath)) continue;
      const key = `${i.owner || ''}.${i.name}`;
      if (!byMethod.has(key)) byMethod.set(key, i);
    }
    const impls = [...byMethod.values()];
    if (impls.length === 0 || impls.length > INTERFACE_IMPLS_MAX) continue;
    if (impls.some(i => i.filePath === filePathRel)) continue;
    seen.add(row.target);
    out.push({ line: row.line, call: row.call, target: row.target, impls });
    if (out.length >= INTERFACE_CALL_LINES_MAX) break;
  }
  return out;
}

/** Interface calls worth a trailer in lines [startLine, endLine] of an indexed file (ss-grep hits). */
export function interfaceCallsInRange(projectRoot, filePathRel, startLine, endLine) {
  return _collectInterfaceCalls(filePathRel, projectRoot, startLine, endLine);
}

function _collectInterfaceCalls(filePathRel, projectRoot, startLine, endLine) {
  const graph = _getGraphRepo(projectRoot);
  if (!graph || typeof graph.findInterfaceCallImplementations !== 'function') return [];
  let rows = [];
  try { rows = graph.findInterfaceCallImplementations(filePathRel, startLine, endLine) || []; }
  catch { rows = []; }
  return selectInterfaceCalls(rows, filePathRel);
}

/**
 * The interface-call trailer: one line per call in the window that goes through an
 * interface with one or two implementations, naming the implementing method and where
 * it is. Returns '' when there is none.
 */
export function renderInterfaceImpls(result) {
  const calls = result?.interfaceCalls;
  if (!Array.isArray(calls) || calls.length === 0) return '';
  return calls.map(c => {
    const impls = c.impls.map(i => `${i.owner ? i.owner + '.' : ''}${i.name} (${i.filePath}:${i.startLine})`).join(', ');
    return `line ${c.line} ${c.call} calls interface ${c.target}, implemented by ${impls}`;
  }).join('\n');
}

/**
 * The above-symbols that carry a reason to print, in candidate order (referenced first, then
 * file order): the ones the window READS, and the ones the session's query evidence names.
 * The above line lists only these (owner review 2026-10-04): the rest of the file's head is
 * no pointer the reader needs.
 */
function _aboveSignalSymbols(candidates, queryEvidence) {
  const anchors = Array.isArray(queryEvidence?.anchors) ? queryEvidence.anchors.filter((a) => typeof a === 'string' && a.length >= 3) : [];
  const subtokens = new Set(Array.isArray(queryEvidence?.subtokens) ? queryEvidence.subtokens.filter((t) => typeof t === 'string' && t.length >= 3) : []);
  const named = (c) => {
    const name = String(c.symbol || '');
    const lower = name.toLowerCase();
    for (const anchor of anchors) {
      if (containsToken(name, anchor, { caseSensitive: /[A-Z]/.test(anchor) }) || lower.includes(anchor.toLowerCase())) return true;
    }
    // Words of the name: at least half of them must be in the queries. One shared word of a
    // longer name is no signal (`rule` from a query about the solver matched every `*Rule*`
    // method of Solver.php: getRuleSetSize, makeAssertionRuleDecisions).
    const terms = [...new Set(informativeSubtokens(name))];
    const hits = terms.filter((term) => subtokens.has(term)).length;
    return nameWordsMatched(hits, terms.length);
  };
  return (candidates || []).filter((c) => c.referenced || named(c));
}

/** `{symbol, type}` rows → the kind-word list (`class Pool, methods a, b`) + ` +N more`. */
function _kindList(symbols, moreCount) {
  const text = kindNameList(symbols.map((s) => ({ name: s.symbol, type: s.type })));
  return text && moreCount > 0 ? `${text} +${moreCount} more` : text;
}

// ---------------------------------------------------------------------------
// Public API — single read
// ---------------------------------------------------------------------------

/**
 * Read one file (or one line range of one file).
 *
 * @param {Object} req
 * @param {string} req.path - File path. Absolute or relative to projectRoot.
 * @param {number} [req.startLine] - 1-based, inclusive
 * @param {number} [req.endLine] - 1-based, inclusive
 * @param {string} [req.projectRoot] - default: process.cwd()
 * @param {boolean} [req.includeMetadata=true] - attach index chunks/language
 * @returns {Promise<Object>}
 */
async function _readFileUnpinned(req) {
  const t0 = performance.now();
  const projectRoot = req.projectRoot || process.cwd();
  const absPath = _resolvePath(req.path, projectRoot);
  const relForIndex = _projectRelative(absPath, projectRoot);

  let disk;
  try {
    disk = await _readFromDisk(absPath);
  } catch (err) {
    return {
      file: req.path,
      ok: false,
      error: err.message || String(err),
      exact: true,
      indexed: false,
    };
  }

  const wantsRange = req.startLine != null || req.endLine != null;
  // Span gate: a range that already covers a quarter of a small file is served
  // whole, so the later re-read of the same file never happens.
  const span = wantsRange
    ? resolveSpanExpansion(disk.lineOffsets.length, req.startLine, req.endLine, req)
    : { startLine: 1, endLine: null, expanded: false };
  const fullText = !wantsRange && disk.text == null
    ? await fs.readFile(absPath, 'utf8')
    : disk.text;
  const sliced = wantsRange
    ? (disk.text == null
        ? await _sliceLinesFromDisk(absPath, disk.lineOffsets, disk.size, span.startLine, span.endLine)
        : _sliceLines(disk.text, disk.lineOffsets, span.startLine, span.endLine))
    : { text: fullText, startLine: 1, endLine: disk.lineOffsets.length, totalLines: disk.lineOffsets.length };

  let language = null;
  let chunks = [];
  let indexed = false;
  if (req.includeMetadata !== false) {
    const meta = _attachIndexMetadata(relForIndex, projectRoot);
    indexed = meta.indexed;
    chunks = meta.chunks;
    language = meta.language;
  }

  // "What remains" trailer data (2026-07, within-file blind-spot fix): when
  // a range read stops before EOF, record what the UNREAD remainder below
  // the window contains — computed from the full chunk table BEFORE the
  // overlap-narrowing just below. A bare "(lines a-b of N)" marker is
  // provably ignored by agents (the botan-2738 shape: three reads, never
  // past line 205 of 272, fix surface below); naming the symbols is what
  // makes the remainder actionable. Whole-file reads and read-to-EOF stay
  // byte-identical (unreadBelow stays null).
  let unreadBelow = null;
  if (wantsRange && sliced.totalLines > 0 && sliced.endLine < sliced.totalLines) {
    // Token diet: a tiny remainder needs no symbol list — the range plus the
    // continue command IS the affordance; names only earn their tokens when
    // the unread span is big enough to hide a sibling branch.
    const remainderLines = sliced.totalLines - sliced.endLine;
    const seen = new Set();
    let symbols = [];
    if (remainderLines >= UNREAD_SYMBOLS_MIN_LINES) {
      for (const c of chunks) {
        if (c.startLine == null || c.startLine <= sliced.endLine) continue;
        const symbol = _baseSymbol(c.symbol);
        if (!symbol || seen.has(symbol)) continue;
        seen.add(symbol);
        symbols.push({ symbol, type: c.type ?? null, startLine: c.startLine, endLine: c.endLine });
      }
      // Index had no named chunks in the remainder (common for C/C++ where the
      // chunker stores name:null) — sniff definition lines from the in-memory
      // buffer instead. Zero I/O; capped at SNIFF_MAX_LINES.
      if (symbols.length === 0 && disk.text != null) {
        const remainder = _sliceLines(disk.text, disk.lineOffsets, sliced.endLine + 1, sliced.totalLines);
        const isCFamily = C_FAMILY_EXTS.has(path.extname(absPath).toLowerCase());
        symbols = _sniffRemainderDefinitions(remainder.text, isCFamily)
          .map(s => ({ ...s, startLine: sliced.endLine + s.startLine }));
      }
    }
    symbols = _graphKinds(projectRoot, relForIndex, symbols, sliced.endLine + 1, sliced.totalLines);
    // The definition that starts right after the window is where the reader goes next, and is
    // named first. The chunk list misses it when the window ends inside its doc comment: the
    // chunk starts at the comment, inside the window (r3hb-okhttp-12: `ss-read RealCall.kt 360
    // 407` ended on callDone's KDoc; the list named five other methods, the agent read again).
    const next = remainderLines >= UNREAD_SYMBOLS_MIN_LINES
      ? _definitionRightAfter(projectRoot, relForIndex, sliced.endLine) : null;
    if (next) symbols = [next, ...symbols.filter(s => s.symbol !== next.symbol)];
    unreadBelow = {
      startLine: sliced.endLine + 1,
      endLine: sliced.totalLines,
      symbols: symbols.slice(0, UNREAD_SYMBOLS_MAX),
      moreCount: Math.max(0, symbols.length - UNREAD_SYMBOLS_MAX),
      ...(next ? { next } : {}),
    };
    _unreadSymbolCandidates.set(unreadBelow, symbols);
  }

  // Mirror trailer for the span ABOVE the window (2026-09-03, smoke-loss
  // forensics L1b). The below-trailer was built for the botan shape (fix
  // surface below the last read); squashql-295 is the first documented
  // above-window miss, with 18 rollouts: the field a method reads was declared
  // and assigned above a 170-235 window and nothing named it. Same diet, same
  // cap. Symbols come from the chunk table UNIONED with code-graph entities
  // (fields are entities, not chunks), then the sniff fallback. Rendered only
  // by the ss-read surface; readFile callers merely receive the field.
  let unreadAbove = null;
  if (wantsRange && sliced.totalLines > 0 && sliced.startLine > 1 && sliced.startLine <= sliced.totalLines) {
    const aboveLines = sliced.startLine - 1;
    let symbols = [];
    if (aboveLines >= UNREAD_SYMBOLS_MIN_LINES) {
      symbols = _collectAboveSymbols(chunks, relForIndex, projectRoot, sliced.startLine, sliced.text);
      if (symbols.length === 0 && disk.text != null) {
        const above = _sliceLines(disk.text, disk.lineOffsets, 1, aboveLines);
        const isCFamily = C_FAMILY_EXTS.has(path.extname(absPath).toLowerCase());
        symbols = _sniffRemainderDefinitions(above.text, isCFamily);
      }
    }
    symbols = _graphKinds(projectRoot, relForIndex, symbols, 1, sliced.startLine - 1);
    unreadAbove = {
      startLine: 1,
      endLine: aboveLines,
      symbols: symbols.slice(0, UNREAD_SYMBOLS_MAX),
      moreCount: Math.max(0, symbols.length - UNREAD_SYMBOLS_MAX),
    };
    _unreadSymbolCandidates.set(unreadAbove, symbols);
  }

  // The definition the window cuts through (2026-10-04). The below/above lists name only
  // definitions that START outside the window, so `ss-read f 84 86` inside `hold` (84-105)
  // never said that hold runs on to 105 — the one hint the reader needs to finish what it
  // is reading. enclosingStart: a function that began above the window; enclosingEnd: one
  // that continues below it (the same entity when the window sits inside one body).
  let enclosingStart = null;
  let enclosingEnd = null;
  if (wantsRange && sliced.totalLines > 0 && sliced.startLine <= sliced.endLine) {
    const graph = _getGraphRepo(projectRoot);
    if (sliced.startLine > 1) enclosingStart = _bodyEntityAcross(graph, relForIndex, sliced.startLine, -1);
    if (sliced.endLine < sliced.totalLines) enclosingEnd = _bodyEntityAcross(graph, relForIndex, sliced.endLine, +1);
    // No function around the window: the type it lies in (grdb `ss-read Database.swift 299`,
    // a field of `class Database` 146-1954; nothing else says whose member it is).
    if (!enclosingStart && !enclosingEnd && sliced.startLine > 1 && sliced.endLine < sliced.totalLines) {
      const type = _typeEntityAround(graph, relForIndex, sliced.startLine - 1, sliced.endLine + 1);
      if (type) enclosingStart = enclosingEnd = type;
    }
  }

  // Interface-call trailer data (2026-10-04, r3-ocelot-03 micro-smoke): a call made
  // through an interface-typed field (`_replacer.Replace`) names only the interface, and
  // agents stopped there in every rollout that reached the line. The graph already links
  // the interface method to the class that implements it (`overrides` edges), so the
  // read names that class. Agent format only; ss-read renders it (renderInterfaceImpls).
  let interfaceCalls = [];
  if (req.format === 'agent') {
    interfaceCalls = _collectInterfaceCalls(relForIndex, projectRoot, sliced.startLine, sliced.endLine);
  }

  // If a line range was requested, narrow attached chunks to the overlap.
  if (wantsRange && chunks.length) {
    chunks = chunks.filter(c =>
      c.startLine == null || c.endLine == null
        ? true
        : (c.endLine >= sliced.startLine && c.startLine <= sliced.endLine),
    );
  }

  return {
    file: req.path,
    absolutePath: absPath,
    ok: true,
    exact: true,
    indexed,
    language,
    totalLines: sliced.totalLines,
    bytes: disk.size,
    mtimeMs: disk.mtimeMs,
    range: wantsRange ? { startLine: sliced.startLine, endLine: sliced.endLine } : null,
    spanExpanded: span.expanded || undefined,
    text: sliced.text,
    chunks,
    unreadBelow,
    unreadAbove,
    enclosingStart,
    enclosingEnd,
    interfaceCalls,
    timings: { totalMs: +(performance.now() - t0).toFixed(2) },
  };
}

export async function readFile(req) {
  const projectRoot = req?.projectRoot || process.cwd();
  return withPinnedRead(
    { projectRoot, meta: { tool: 'read', path: req?.path ?? null, count: 1 } },
    () => _readFileUnpinned({ ...req, projectRoot }),
  );
}

/**
 * Batch read — up to 20 files in parallel. Per-file failures are returned
 * inline; the batch never throws unless `files` is malformed.
 *
 * @param {Object[]} files - [{ path, startLine?, endLine? }, ...]
 * @param {Object}   [opts]
 * @param {string}   [opts.projectRoot]
 * @param {boolean}  [opts.includeMetadata=true]
 * @returns {Promise<{files: Object[], totalMs: number}>}
 */
export async function readFiles(files, opts = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    return { files: [], totalMs: 0 };
  }
  if (files.length > 20) {
    throw new Error(`read accepts at most 20 files; got ${files.length}`);
  }
  const projectRoot = opts.projectRoot || process.cwd();
  return withPinnedRead({ projectRoot, meta: { tool: 'read', count: files.length } }, async () => {
    const t0 = performance.now();
    const results = await Promise.all(files.map(f => _readFileUnpinned({
      path: f.path,
      startLine: f.startLine,
      endLine: f.endLine,
      projectRoot,
      includeMetadata: opts.includeMetadata !== false,
      spanExpand: opts.spanExpand === true,
      format: opts.format,
    })));
    return { files: results, totalMs: +(performance.now() - t0).toFixed(2) };
  });
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Render the "what remains" trailer for a range read that stopped before
 * EOF. Names the symbols in the unread remainder — the actionable form (a
 * bare truncation marker is ignored; see the 2026-07 within-file design
 * note). The `read` CLI adds the continue command; ss-read prints
 * `# [X ends at N; ]below a-b: names` and no command. Returns '' when the
 * read covered the whole file / reached EOF.
 *
 * @param {Object} result - readFile() result
 * @param {{ command?: 'read'|'ss-read', queryEvidence?: {anchors?: string[], subtokens?: string[]} }} [opts]
 *   continue-command surface plus agent-session query evidence
 * @returns {string} one line without trailing newline, or ''
 */
export function renderUnreadBelow(result, { command = 'read', queryEvidence = null } = {}) {
  const u = result?.unreadBelow;
  if (!u) return '';
  // ss-read: the definition the window ends inside is named with its end line, and so is
  // not listed again among the definitions below.
  const inside = command === 'ss-read' ? result.enclosingEnd : null;
  const keep = (s) => !inside || s.symbol !== inside.symbol;
  let symbols = (u.symbols || []).filter(keep);
  let moreCount = u.moreCount || 0;
  if (queryEvidence || inside) {
    const candidates = (_unreadSymbolCandidates.get(u) || u.symbols || []).filter(keep);
    if (queryEvidence) {
      const selected = selectUnreadSymbols(candidates, queryEvidence, UNREAD_SYMBOLS_MAX);
      symbols = selected.symbols;
      moreCount = selected.moreCount;
    } else {
      symbols = candidates.slice(0, UNREAD_SYMBOLS_MAX);
      moreCount = Math.max(0, candidates.length - UNREAD_SYMBOLS_MAX);
    }
  }
  // The definition right after the window stays first whatever the query ranks above it.
  const next = u.next && keep(u.next) ? u.next : null;
  if (next && symbols[0]?.symbol !== next.symbol) {
    // It is one of the candidates: brought forward from the hidden ones, it swaps places with
    // the last shown name, and the hidden count stays the same.
    symbols = [next, ...symbols.filter(s => s.symbol !== next.symbol)].slice(0, UNREAD_SYMBOLS_MAX);
  }
  const names = symbols.map(s => s.symbol).join(', ');
  const more = moreCount > 0 ? ` +${moreCount} more` : '';
  if (command === 'ss-read') {
    // No continue command: the agent writes `ss-read <file> <a> <b>` itself, and the
    // command used to repeat the whole path and suggest reading the entire rest.
    const start = result.enclosingStart;
    // After the code block, no `#` (owner review 2026-10-04); every name with its kind word.
    const ends = inside && !(start && start.symbol === inside.symbol && start.startLine === inside.startLine)
      ? `${kindName(inside.symbol, inside.type)} ends at ${inside.endLine}; ` : '';
    const list = _kindList(symbols, moreCount);
    return `${ends}below ${u.startLine}-${u.endLine}${list ? ': ' + list : ''}`;
  }
  return `# unread below (${u.startLine}-${u.endLine})${names ? ': ' + names + more : ''} — continue: read ${result.file} ${u.startLine}-${u.endLine}`;
}

/**
 * ss-read only: the function the window starts inside. `# inside hold 84-112` when the
 * window lies within one body (then the below line does not repeat it), else
 * `# hold starts at 84`. Returns '' when the window starts at a body's first line or
 * outside any.
 */
export function renderEnclosingStart(result) {
  const s = result?.enclosingStart;
  if (!s) return '';
  const e = result.enclosingEnd;
  if (e && e.symbol === s.symbol && e.startLine === s.startLine) return `inside ${kindName(s.symbol, s.type)} ${s.startLine}-${s.endLine}`;
  return `${kindName(s.symbol, s.type)} starts at ${s.startLine}`;
}

/**
 * Mirror of renderUnreadBelow for the span above a range read's window.
 * Gated on `command === 'ss-read'`, NOT on format: `agent` is the CLI's
 * default read format, so a format gate would leak into human output. Only
 * the ss-read wrapper passes the command. Returns '' otherwise.
 */
export function renderUnreadAbove(result, { command = 'read', queryEvidence = null } = {}) {
  const u = result?.unreadAbove;
  if (!u || command !== 'ss-read' || !unreadAboveEnabled()) return '';
  const candidates = _unreadSymbolCandidates.get(u) || u.symbols || [];
  // Signal gate (render-time, so the structured field stays complete): print only the
  // symbols the window reads or the query names; nothing when there are none.
  const signal = _aboveSignalSymbols(candidates, queryEvidence);
  if (signal.length === 0) return '';
  let symbols = signal.slice(0, UNREAD_SYMBOLS_MAX);
  let moreCount = signal.length - symbols.length;
  if (queryEvidence) ({ symbols, moreCount } = selectUnreadSymbols(signal, queryEvidence, UNREAD_SYMBOLS_MAX));
  const list = _kindList(symbols, moreCount);
  return `above ${u.startLine}-${u.endLine}: ${list}`;
}

function _formatAgent(result, opts = {}) {
  if (!result.ok) {
    return `### ${result.file}\n[error] ${result.error}\n`;
  }
  const omitted = renderReadOmission(result, opts);
  if (omitted) return `### ${result.file}\n${omitted}\n`;
  const fence = result.language ? '```' + result.language : '```';
  const range = result.range
    ? ` (lines ${result.range.startLine}-${result.range.endLine} of ${result.totalLines})`
    : ` (${result.totalLines} lines)`;
  let symbolHint = '';
  if (result.chunks && result.chunks.length > 0 && result.chunks.length <= 12) {
    const names = result.chunks
      .map(c => c.symbol ? `${c.type || 'symbol'}:${c.symbol}` : null)
      .filter(Boolean);
    if (names.length) symbolHint = `\nsymbols: ${names.join(', ')}`;
  }
  const remainder = renderUnreadBelow(result, opts);
  // Optional line-number gutter (SS_READ_LINENUMS=0 disables). Native Claude Code Read
  // numbers every line; ss-read did not, so sweet edited with less line grounding than
  // its comparison arm. The delimiter is the resolved per-harness form (none on
  // claude-code and codex, `N<TAB>` on pi and devin) — see numberCodeLines for why the
  // exact-anchor delimiter is a tab and not the `N| ` it replaced, nor cat -n's padded
  // field, and gutter-form.js for why claude-code gets none. Skipped for spans
  // < 15 lines (short reads don't need it and the prefix is pure token cost).
  // Prior art: pi-hashline +14pp Sonnet.
  const body = shouldNumberLines(result, opts)
    ? numberLines(result.text, result.range ? result.range.startLine : 1)
    : result.text;
  return `### ${result.file}${range}${symbolHint}\n${fence}\n${fenceBody(body)}\n\`\`\`${remainder ? '\n' + remainder : ''}\n`;
}

/**
 * Code for a fenced block: the source's own final newline dropped, because the closing
 * fence supplies the line break. Keeping it printed an empty line after the last source
 * line, which reads as one more (blank) line of the file.
 */
export function fenceBody(text) {
  const t = String(text ?? '');
  return t.endsWith('\r\n') ? t.slice(0, -2) : t.endsWith('\n') ? t.slice(0, -1) : t;
}

// Line-number gutter is ON by default for AGENT-consumption output (measured
// −16% agent cost, no solve loss; native Claude Code Read numbers every line so
// this closes the grounding asymmetry). Two off-switches: SS_READ_LINENUMS=0
// (explicit disable, e.g. A/B) and benchmark/raw formats (protect retrieval
// measurement — the JSON/benchmark path never calls these renderers anyway, but
// the guard is belt-and-suspenders). Skipped under 15 lines (short reads don't
// need it and the prefix is pure token cost).
export function lineGutterEnabled(opts = {}) {
  if (opts.lineNumbers === false) return false;
  if (opts.lineNumbers === true) return true;
  if (opts.format === 'benchmark' || opts.format === 'raw' || opts.format === 'json') return false;
  if (process.env.SS_READ_LINENUMS === '0') return false;
  // Per-harness form 'none' (codex and claude-code by default) — see gutter-form.js.
  return resolveGutterForm().form !== 'none';
}

// The gutter delimiter. Prefix each line with `N<TAB>` starting at startLine.
//
// WHY A TAB, AND WHY NOT THE `N| ` IT REPLACED (2026-08-12)
// --------------------------------------------------------
// `N| ` injects ONE SPACE between the delimiter and the content, and a model
// rebuilding an exact-match edit anchor has to strip all of `123| ` (5 chars),
// not the visually salient `123|` (4). Stripping 4 carries one extra leading
// space into the anchor and the harness's edit tool rejects it. sweet does not
// own that edit tool (Claude Code `Edit`, codex `apply_patch`), so the only
// possible fix is on the render side.
//
// Measured on the 2026-08-11 three-harness run, claude-code:
//   sweet  15,205 gutter lines as `N| `  → 20 anchor failures, 14 of which
//          match the read reconstructed with `N|` stripped instead of `N| `,
//          and do NOT match the true source. Per-line delta exactly +1 space.
//   native 19,499 gutter lines as `N<TAB>` → 0 whitespace-carry failures.
//          (Its 8 anchor failures are unrelated: decoding garbage, a
//          replace_all ambiguity, anchors absent from the file.)
// Same harness, same model, same tasks, comparable gutter volume, opposite
// outcome. A tab has no adjacent injected whitespace, so the off-by-one is
// structurally impossible rather than merely less likely.
//
// The tab-indented worry is refuted by the same evidence:
// joshuakgoldberg__bingo-274 renders TAB-indented TypeScript as `5<TAB><TAB>…`
// and its 4 exact-match edits all succeeded, with leading content tabs
// reproduced verbatim — the model strips the gutter tab and keeps the rest.
// SUPERSEDED for claude-code: the 2026-08-28 study (66 rollouts per cell) found the
// carry after all — the model strips the digits and keeps the gutter tab, and 8 of 61
// claude-code edits in tab-indented repos failed. Claude Code gets no gutter since
// 2026-10-02 (gutter-form.js).
//
// This is NOT `cat -n`. cat -n pads the number into a fixed-width field
// (`%6d`), which is what was tried and rejected for miscalibrating edit
// wrapping (Claude Code #36654). The number here stays unpadded, so the prefix
// width still varies with digit count exactly as `N| ` did.
// PER-HARNESS FORM (2026-09-02, extended 2026-09-22, claude-code -> none 2026-10-02).
// The tab above is the exact-anchor form: pi and devin. Opencode, cursor and
// deepseek-harness get `N:` (tolerant matchers, where a carried tab is absorbed
// silently and written into tab-indented files), grok-build gets `N→` (the
// prefix its own read tool prints), codex gets no gutter (its ~2,500-token
// output cap makes it pure cost), and claude-code gets no gutter (measured: no edit
// failures without it, cheaper). An undetected harness gets `N:`, the one form
// that cannot corrupt a file. See gutter-form.js for the evidence per harness.
// The harness is detected from the measured harnesses' env markers, then
// process ancestry, then the inferred harnesses' env markers;
// `SS_READ_GUTTER=tab|pipe|colon|arrow|none` overrides.
// numberCodeLines and stripCodeLineNumbers both default to the resolved
// delimiter, so the round-trip stays exact under every form.
export const GUTTER_DELIMITER = GUTTER_FORMS.tab;
export { GUTTER_FORMS, resolveGutterForm, gutterDelimiter } from './gutter-form.js';

export function numberCodeLines(text, startLine = 1, delimiter = gutterDelimiter()) {
  if (!text) return text;
  if (delimiter === '') return text; // form 'none': the agent sees the source as-is
  const lines = text.split('\n');
  const hasTrailingNL = lines.length > 1 && lines[lines.length - 1] === '';
  const body = hasTrailingNL ? lines.slice(0, -1) : lines;
  const numbered = body.map((ln, i) => `${startLine + i}${delimiter}${ln}`).join('\n');
  return hasTrailingNL ? numbered + '\n' : numbered;
}

// Inverse of numberCodeLines: recover the exact source text from a rendered
// gutter body. Exists so the round-trip is asserted by tests rather than
// assumed, and so any future delimiter change has to keep it exact.
export function stripCodeLineNumbers(text, delimiter = gutterDelimiter()) {
  if (!text) return text;
  if (delimiter === '') return text;
  const lines = text.split('\n');
  const hasTrailingNL = lines.length > 1 && lines[lines.length - 1] === '';
  const body = hasTrailingNL ? lines.slice(0, -1) : lines;
  const stripped = body.map((ln) => {
    const at = ln.indexOf(delimiter);
    return at > 0 && /^\d+$/.test(ln.slice(0, at)) ? ln.slice(at + delimiter.length) : ln;
  }).join('\n');
  return hasTrailingNL ? stripped + '\n' : stripped;
}

function shouldNumberLines(result, opts) {
  if (!lineGutterEnabled(opts) || !result.text) return false;
  // Count source lines: a final newline is not a 15th line.
  return fenceBody(result.text).split('\n').length >= 15;
}

function numberLines(text, startLine) {
  return numberCodeLines(text, startLine);
}

export function formatReadResults(results, format = 'agent', opts = {}) {
  if (format === 'json') {
    return JSON.stringify({ files: results.files, totalMs: results.totalMs }, null, 2);
  }
  if (format === 'raw') {
    return results.files.map(r => r.ok ? r.text : `[error: ${r.file}] ${r.error}`).join('\n\n');
  }
  return results.files.map((result) => _formatAgent(result, { ...opts, format })).join('\n');
}

// ---------------------------------------------------------------------------
// CLI handler
// ---------------------------------------------------------------------------

function _parseLineRange(spec) {
  // Accepts "45-92", "45:92", "45" (single line), or "45-" (open end).
  if (!spec) return [null, null];
  const m = String(spec).match(/^(\d+)(?:[-:](\d+)?)?$/);
  if (!m) throw new Error(`invalid --lines spec: ${spec}`);
  const start = +m[1];
  const end = m[2] != null ? +m[2] : (spec.includes('-') || spec.includes(':') ? null : start);
  return [start, end];
}

function _parseArgs(args) {
  const positional = [];
  let format = 'agent';
  let startLine = null;
  let endLine = null;
  let includeMetadata = true;
  let plain = false;
  let noBanner = false;
  let force = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') format = 'json';
    else if (a === '--raw') format = 'raw';
    else if (a === '--agent') format = 'agent';
    else if (a === '--no-metadata') includeMetadata = false;
    else if (a === '--no-banner') noBanner = true;
    else if (a === '--force') force = true;
    else if (a === '--format' || a.startsWith('--format=')) {
      const v = a === '--format' ? args[++i] : a.slice('--format='.length);
      if (v === 'json' || v === 'raw' || v === 'agent') format = v;
      else if (v === 'plain') plain = true;
      else throw new Error(`unknown --format value: ${v}`);
    } else if (a === '--lines') {
      const [s, e] = _parseLineRange(args[++i]);
      startLine = s; endLine = e;
    } else if (a === '--help' || a === '-h') {
      return { help: true };
    } else if (a.startsWith('--')) {
      // Unknown flag — surface clearly rather than silently swallowing.
      throw new Error(`unknown flag: ${a}`);
    } else {
      positional.push(a);
    }
  }
  return { positional, format, startLine, endLine, includeMetadata, plain, noBanner, force };
}

function _printHelp() {
  process.stdout.write([
    'sweet-search read — filesystem-grounded file reader',
    '',
    'Usage:',
    '  sweet-search read <path> [...path]   Read 1-20 files',
    '  sweet-search read <path> --lines 45-92',
    '',
    'Options:',
    '  --lines <a-b>     1-based inclusive range. Use "45-" for open end, "45" for one line.',
    '  --json            Emit JSON (machine-readable)',
    '  --raw             Emit raw text only (no fences/headers)',
    '  --agent           Default — markdown fenced block + symbol hints',
    '  --format <fmt>    json | raw | agent | plain (plain = no identity line)',
    '  --no-banner       Suppress the identity line',
    '  --no-metadata     Skip index metadata attachment',
    '  --force           Retry the exact read named by an omission',
    '',
  ].join('\n'));
}

export async function handleReadCli(args) {
  let parsed;
  try { parsed = _parseArgs(args); }
  catch (err) { process.stderr.write(`[sweet-search read] ${err.message}\n`); process.exit(2); }
  if (parsed.help || !parsed.positional || parsed.positional.length === 0) {
    _printHelp();
    process.exit(parsed.help ? 0 : 2);
  }
  const wantsRange = parsed.startLine != null || parsed.endLine != null;
  if (wantsRange && parsed.positional.length > 1) {
    process.stderr.write('[sweet-search read] --lines requires exactly one path\n');
    process.exit(2);
  }
  // Shell semantics: a path relative to the cwd wins, else it stays root-relative.
  const root = resolveProjectRoot();
  const files = parsed.positional.map(p => ({
    path: resolveCwdPath(p, { root }),
    startLine: wantsRange ? parsed.startLine : undefined,
    endLine: wantsRange ? parsed.endLine : undefined,
  }));
  // Agent-facing entry point: the span gate is on here. `format` still vetoes it
  // for benchmark/raw/json so a measurement run never sees an expanded span.
  const out = await readFiles(files, {
    projectRoot: root,          // the paths above are root-relative; never the cwd
    includeMetadata: parsed.includeMetadata,
    spanExpand: true,
    format: parsed.format,
  });
  let queryEvidence = null;
  if (parsed.format === 'agent' && exactRereadOmissionEnabled()) {
    const agentSessionId = resolveAgentSessionId();
    const spans = collectReadShownSpans(out, { projectRoot: resolveProjectRoot() });
    const response = await sendAgentSpanOperation({
      operation: 'read',
      sessionId: agentSessionId,
      spans,
      force: parsed.force,
    });
    if (response?.ok && Array.isArray(response.decisions)) {
      const decisions = Array.from({ length: out.files.length }, () => ({ omit: false }));
      spans.forEach((span, index) => { decisions[span.resultIndex] = response.decisions[index]; });
      applyReadOmissionDecisions(out, decisions);
    }
    queryEvidence = response?.queryEvidence || null;
  }
  if (parsed.format !== 'json') {
    const detail = files.length === 1 ? files[0].path : `${files.length} files`;
    emitToolIdentityAuto('read', detail, { plain: parsed.plain, noBanner: parsed.noBanner });
  }
  process.stdout.write(formatReadResults(out, parsed.format, {
    surface: 'cli',
    force: parsed.force,
    queryEvidence,
  }));
  if (parsed.format !== 'json') process.stdout.write('\n');
  // Non-zero exit if every file failed (so shell pipelines see the error).
  const allFailed = out.files.length > 0 && out.files.every(f => !f.ok);
  process.exit(allFailed ? 1 : 0);
}

// Test-only export — clears caches between unit tests.
export function __resetReadCachesForTests() {
  _cache.clear();
  for (const repo of _repos.values()) repo?.close?.();
  _repos.clear();
  for (const repo of _graphRepos.values()) repo?.close?.();
  _graphRepos.clear();
}

export const __testing = { projectRelative: _projectRelative, codebasePathForProject: _codebasePathForProject };

// ── ss-read <file> <symbol> ────────────────────────────────────────────────────────────
// The definitions named `spec` in one file, from the code graph: `name`, or `Owner.name`
// (also `Owner::name`, `Owner#name`) to pick a member of one type. Exact-case matches win
// over case-insensitive ones; file order. Each: { name, type, startLine, endLine, parentClass }.
export function findSymbolSpans(projectRoot, filePath, spec) {
  const root = projectRoot || process.cwd();
  const filePathRel = _projectRelative(_resolvePath(filePath, root), root);
  const raw = String(spec || '').trim().replace(/\(\)$/, '');
  if (!raw) return [];
  const parts = raw.split(/::|#|\./).filter(Boolean);
  const name = parts[parts.length - 1];
  const owner = parts.length > 1 ? parts[parts.length - 2] : null;
  const graph = _getGraphRepo(projectRoot);
  let entities = [];
  if (graph && typeof graph.findEntitiesInFile === 'function') {
    try { entities = graph.findEntitiesInFile(filePathRel, { limit: 2048 }); } catch { entities = []; }
  }
  // No code graph (or it holds nothing for this file): the index's named chunks, the
  // `(part N)` pieces of one definition joined into one span.
  if (!entities.length) entities = _chunkDefinitions(filePathRel, root);
  const ownerOk = (e) => !owner || String(e.parentClass || '').toLowerCase() === owner.toLowerCase()
    || String(e.parentClass || '').toLowerCase().endsWith(`.${owner.toLowerCase()}`);
  const exact = entities.filter(e => e.name === name && ownerOk(e));
  const hits = exact.length ? exact : entities.filter(e => String(e.name).toLowerCase() === name.toLowerCase() && ownerOk(e));
  const seen = new Set();
  return hits.filter((e) => {
    const key = `${e.startLine}:${e.endLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(e => ({ name: e.name, type: e.type, startLine: e.startLine, endLine: e.endLine, parentClass: e.parentClass || null }));
}

function _chunkDefinitions(filePathRel, projectRoot) {
  const byName = new Map();
  for (const c of _attachIndexMetadata(filePathRel, projectRoot).chunks) {
    const name = _baseSymbol(c.symbol);
    if (!name || !Number.isInteger(c.startLine) || !Number.isInteger(c.endLine)) continue;
    const prev = byName.get(name);
    if (prev && c.startLine <= prev.endLine + 1) prev.endLine = Math.max(prev.endLine, c.endLine);
    else if (!prev) byName.set(name, { name, type: c.type || null, startLine: c.startLine, endLine: c.endLine, parentClass: null });
  }
  return [...byName.values()];
}

// A line that belongs to the comment or attribute block right above a definition.
const LEADING_DOC_LINE_RE = /^\s*(?:\/\/|\/\*|\*|#(?!include|define|if|endif|import|pragma)|--|;;|@\w|\[\w|"""|''')/;

/**
 * The first line of the doc comment / attribute block that ends right above line `start`
 * (1-based) in `lines`, at most `max` lines up. A blank line ends the block.
 */
export function leadingDocStart(lines, start, max = 40) {
  let s = start;
  while (s > 1 && start - (s - 1) <= max) {
    const line = lines[s - 2];
    if (line == null || !line.trim() || !LEADING_DOC_LINE_RE.test(line)) break;
    s--;
  }
  return s;
}


// The most lines `ss-read <file> <symbol>` serves; a longer definition is cut there and the
// "below" trailer names what follows.
export const SYMBOL_READ_MAX_LINES = 300;

/**
 * The range `ss-read <file> <symbol>` serves: the first definition named `spec`, from the
 * doc comment / attributes right above it to its last line (at most maxLines). Null when the
 * file has no such definition. `others` = the other definitions of that name in the file.
 */
export async function resolveSymbolRead(projectRoot, filePath, spec, { maxLines = SYMBOL_READ_MAX_LINES } = {}) {
  const spans = findSymbolSpans(projectRoot, filePath, spec);
  if (!spans.length) return null;
  const span = spans[0];
  let start = span.startLine;
  try {
    const disk = await _readFromDisk(_resolvePath(filePath, projectRoot || process.cwd()));
    start = leadingDocStart(String(disk.text ?? disk.content ?? '').split(/\r?\n/), span.startLine);
  } catch { /* the definition line itself */ }
  const end = Math.min(span.endLine, start + maxLines - 1);
  return { span, startLine: start, endLine: end, cut: end < span.endLine, others: spans.slice(1) };
}

/** Names of the definitions in a file, for the "no definition named X" error (at most max). */
export function definitionNamesInFile(projectRoot, filePath, max = 12) {
  const root = projectRoot || process.cwd();
  const graph = _getGraphRepo(root);
  if (!graph || typeof graph.findEntitiesInFile !== 'function') return [];
  let entities = [];
  try { entities = graph.findEntitiesInFile(_projectRelative(_resolvePath(filePath, root), root), { limit: 2048 }); } catch { entities = []; }
  const names = [];
  for (const e of entities) if (e.name && !names.includes(e.name)) names.push(e.name);
  return names.slice(0, max);
}

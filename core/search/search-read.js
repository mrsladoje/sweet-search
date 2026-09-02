/**
 * sweet-search read — filesystem-grounded file reader. Returns exact bytes from
 * disk; the vectors index may attach symbol/chunk metadata, but the returned
 * `text` always comes from node:fs, never from the (truncated) DB column.
 */

import { promises as fs, realpathSync, statSync } from 'node:fs';
import { GUTTER_FORMS, resolveGutterForm, gutterDelimiter } from './gutter-form.js';
import path from 'node:path';
import { CodebaseRepository } from '../infrastructure/codebase-repository.js';
import { DB_PATHS, PROJECT_ROOT } from '../infrastructure/config/index.js';
import { withPinnedRead } from './search-reader-pin.js';
import { emitToolIdentityAuto } from './cli-decoration.js';
import { resolveProjectRoot } from './server-identity.js';
import {
  applyReadOmissionDecisions,
  collectReadShownSpans,
  exactRereadOmissionEnabled,
  renderReadOmission,
  resolveAgentSessionId,
} from './agent-span-ledger.js';
import { sendAgentSpanOperation } from './agent-span-client.js';
import { selectUnreadSymbols } from './unread-symbol-ranking.js';

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
  const eRaw = (endLine == null) ? total : (endLine | 0);
  const e = Math.min(total, Math.max(s, eRaw));
  const startByte = lineOffsets[s - 1];
  return { startLine: s, endLine: e, totalLines: total, startByte, endByte: null };
}

function _sliceLines(text, lineOffsets, startLine, endLine) {
  const range = _normalizeLineRange(lineOffsets, startLine, endLine);
  if (range.totalLines === 0) return { text: '', startLine: 1, endLine: 0, totalLines: 0 };
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

// Keyword-introduced definitions (Python/Ruby/JS/TS/Go/Rust/Kotlin/PHP/...).
const KEYWORD_DEF_RE = /^\s*(?:export\s+|default\s+|pub(?:\([^)]*\))?\s+|static\s+|async\s+|abstract\s+|final\s+|public\s+|private\s+|protected\s+|inline\s+|constexpr\s+|unsafe\s+|override\s+|open\s+|sealed\s+)*(?:def|fn|func|function\*?|class|struct|enum|trait|interface|impl|object|module|proc)\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*(?:(?:::|\.)[A-Za-z_][\w]*)*)/;
// C-family definitions at low indent: `[return-type] Qualified::name(args...`
// with no trailing `;` (declarations) — captures the identifier before the
// first `(`. The return-type prefix is lazy so qualification stays intact.
const C_DEF_RE = /^(?:[A-Za-z_][\w:<>,*&~\s]*?[\s*&]+)?((?:[A-Za-z_~][\w]*::)*(?:~?[A-Za-z_][\w]*|operator\s*[^\s(]{1,3}))\s*\(/;
const C_CONTROL_RE = /^\s*(?:if|for|while|switch|return|else|do|catch|case|sizeof|new|delete|throw|goto|using|typedef)\b/;

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
        if (!c.symbol || seen.has(c.symbol)) continue;
        seen.add(c.symbol);
        symbols.push({ symbol: c.symbol, type: c.type ?? null, startLine: c.startLine });
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
    unreadBelow = {
      startLine: sliced.endLine + 1,
      endLine: sliced.totalLines,
      symbols: symbols.slice(0, UNREAD_SYMBOLS_MAX),
      moreCount: Math.max(0, symbols.length - UNREAD_SYMBOLS_MAX),
    };
    _unreadSymbolCandidates.set(unreadBelow, symbols);
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
 * EOF. Names the symbols in the unread remainder plus the exact continue
 * command — the actionable form (a bare truncation marker is ignored;
 * see the 2026-07 within-file design note). Returns '' when the read
 * covered the whole file / reached EOF.
 *
 * @param {Object} result - readFile() result
 * @param {{ command?: 'read'|'ss-read', queryEvidence?: {anchors?: string[], subtokens?: string[]} }} [opts]
 *   continue-command surface plus agent-session query evidence
 * @returns {string} one line without trailing newline, or ''
 */
export function renderUnreadBelow(result, { command = 'read', queryEvidence = null } = {}) {
  const u = result?.unreadBelow;
  if (!u) return '';
  let symbols = u.symbols || [];
  let moreCount = u.moreCount || 0;
  if (queryEvidence) {
    const candidates = _unreadSymbolCandidates.get(u) || u.symbols || [];
    const selected = selectUnreadSymbols(candidates, queryEvidence, UNREAD_SYMBOLS_MAX);
    symbols = selected.symbols;
    moreCount = selected.moreCount;
  }
  const names = symbols.map(s => s.symbol).join(', ');
  const more = moreCount > 0 ? ` +${moreCount} more` : '';
  const cont = command === 'ss-read'
    ? `ss-read ${result.file} ${u.startLine} ${u.endLine}`
    : `read ${result.file} ${u.startLine}-${u.endLine}`;
  return `# unread below (${u.startLine}-${u.endLine})${names ? ': ' + names + more : ''} — continue: ${cont}`;
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
  // its comparison arm. `N<TAB>` form — see numberCodeLines for why the delimiter is a
  // tab and not the `N| ` it replaced, nor cat -n's padded field. Skipped for spans
  // < 15 lines (short reads don't need it and the prefix is pure token cost).
  // Prior art: pi-hashline +14pp Sonnet.
  const body = shouldNumberLines(result, opts)
    ? numberLines(result.text, result.range ? result.range.startLine : 1)
    : result.text;
  return `### ${result.file}${range}${symbolHint}\n${fence}\n${body}\n\`\`\`${remainder ? '\n' + remainder : ''}\n`;
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
  // Per-harness form 'none' (codex by default) — see gutter-form.js.
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
//
// This is NOT `cat -n`. cat -n pads the number into a fixed-width field
// (`%6d`), which is what was tried and rejected for miscalibrating edit
// wrapping (Claude Code #36654). The number here stays unpadded, so the prefix
// width still varies with digit count exactly as `N| ` did.
// PER-HARNESS FORM (2026-09-02). The tab above is the claude-code form and the
// default. Opencode gets `N:` and codex gets no gutter — see gutter-form.js for
// the measured reasons (silent tab carry on tab-indented files under the
// four-pass edit seek those two harnesses use; codex's ~2,500-token output cap
// makes the gutter pure cost there). The harness is detected from process
// ancestry, then env markers; `SS_READ_GUTTER=tab|pipe|colon|none` overrides.
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
  return result.text.split('\n').length >= 15;
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
  const files = parsed.positional.map(p => ({
    path: p,
    startLine: wantsRange ? parsed.startLine : undefined,
    endLine: wantsRange ? parsed.endLine : undefined,
  }));
  // Agent-facing entry point: the span gate is on here. `format` still vetoes it
  // for benchmark/raw/json so a measurement run never sees an expanded span.
  const out = await readFiles(files, {
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
}

export const __testing = { projectRelative: _projectRelative, codebasePathForProject: _codebasePathForProject };

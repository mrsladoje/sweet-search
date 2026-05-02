/**
 * sweet-search read — filesystem-grounded file reader.
 *
 * Returns exact bytes from disk. The vectors index may attach symbol/chunk
 * metadata for indexed files, but the returned `text` always comes from
 * `node:fs`, never from the (truncated) DB column.
 *
 * Design notes (see docs/READ_TOOLS_AND_TOOLUSE_ENFORCEMENT_PLAN.md):
 *   - Filesystem is ground truth. Never return DB-stored text as content.
 *   - Batch up to 20 files; per-file errors do not fail the batch.
 *   - Warm-process cache keyed by `path|size|mtimeMs` avoids re-reading hot
 *     files; line-offset table lets line-range reads avoid materialising the
 *     whole content for large files.
 *
 * DDD: this module lives in the search/ application layer (allowed to import
 * infrastructure for filesystem grounding and chunk metadata).
 */

import { promises as fs, statSync } from 'node:fs';
import path from 'node:path';
import { CodebaseRepository } from '../infrastructure/codebase-repository.js';
import { DB_PATHS } from '../infrastructure/config/index.js';

// ---------------------------------------------------------------------------
// Cache — keyed by absolutePath|size|mtimeMs (any change invalidates).
// Bounded LRU. Entries hold either the full text + line-offset table, or just
// the line-offset table for very large files where we deliberately avoid
// caching the whole content.
// ---------------------------------------------------------------------------

const CACHE_MAX_ENTRIES = 64;
const CACHE_LARGE_FILE_BYTES = 4 * 1024 * 1024; // 4MB — switch to range-read mode
const _cache = new Map(); // key -> { text|null, lineOffsets, size, mtimeMs }

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

// ---------------------------------------------------------------------------
// Repository singleton — lazy and tolerant of a missing/empty DB.
// ---------------------------------------------------------------------------

let _repo = null;
function _getRepo() {
  if (_repo === null) {
    try { _repo = new CodebaseRepository(DB_PATHS.codebase); }
    catch { _repo = false; }
  }
  return _repo || null;
}

// ---------------------------------------------------------------------------
// Path resolution helpers
// ---------------------------------------------------------------------------

function _resolvePath(p, projectRoot) {
  if (!p) throw new Error('path is required');
  if (path.isAbsolute(p)) return p;
  return path.resolve(projectRoot || process.cwd(), p);
}

function _projectRelative(absPath, projectRoot) {
  const root = projectRoot || process.cwd();
  const rel = path.relative(root, absPath);
  // Inside the project root → use relative form (matches vectors.file_path).
  // Outside → keep the absolute path (no chunks will match anyway).
  return rel.startsWith('..') || path.isAbsolute(rel) ? absPath : rel;
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
    bufferRef: isLarge ? null : null, // not held — text is the canonical form
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

function _attachIndexMetadata(filePathRel) {
  const repo = _getRepo();
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
export async function readFile(req) {
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
  const fullText = !wantsRange && disk.text == null
    ? await fs.readFile(absPath, 'utf8')
    : disk.text;
  const sliced = wantsRange
    ? (disk.text == null
        ? await _sliceLinesFromDisk(absPath, disk.lineOffsets, disk.size, req.startLine ?? 1, req.endLine ?? null)
        : _sliceLines(disk.text, disk.lineOffsets, req.startLine ?? 1, req.endLine ?? null))
    : { text: fullText, startLine: 1, endLine: disk.lineOffsets.length, totalLines: disk.lineOffsets.length };

  let language = null;
  let chunks = [];
  let indexed = false;
  if (req.includeMetadata !== false) {
    const meta = _attachIndexMetadata(relForIndex);
    indexed = meta.indexed;
    chunks = meta.chunks;
    language = meta.language;
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
    text: sliced.text,
    chunks,
    timings: { totalMs: +(performance.now() - t0).toFixed(2) },
  };
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
  const t0 = performance.now();
  const results = await Promise.all(files.map(f => readFile({
    path: f.path,
    startLine: f.startLine,
    endLine: f.endLine,
    projectRoot: opts.projectRoot,
    includeMetadata: opts.includeMetadata !== false,
  })));
  return { files: results, totalMs: +(performance.now() - t0).toFixed(2) };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function _formatAgent(result) {
  if (!result.ok) {
    return `### ${result.file}\n[error] ${result.error}\n`;
  }
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
  return `### ${result.file}${range}${symbolHint}\n${fence}\n${result.text}\n\`\`\`\n`;
}

export function formatReadResults(results, format = 'agent') {
  if (format === 'json') {
    return JSON.stringify({ files: results.files, totalMs: results.totalMs }, null, 2);
  }
  if (format === 'raw') {
    return results.files.map(r => r.ok ? r.text : `[error: ${r.file}] ${r.error}`).join('\n\n');
  }
  return results.files.map(_formatAgent).join('\n');
}

// ---------------------------------------------------------------------------
// CLI handler
// Usage:
//   sweet-search read path/to/file.ts
//   sweet-search read path/to/file.ts --lines 45-92
//   sweet-search read a.ts b.ts c.ts
//   sweet-search read path/to/file.ts --json
//   sweet-search read path/to/file.ts --raw
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
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') format = 'json';
    else if (a === '--raw') format = 'raw';
    else if (a === '--agent') format = 'agent';
    else if (a === '--no-metadata') includeMetadata = false;
    else if (a === '--lines') {
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
  return { positional, format, startLine, endLine, includeMetadata };
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
    '  --no-metadata     Skip index metadata attachment',
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
  const out = await readFiles(files, { includeMetadata: parsed.includeMetadata });
  process.stdout.write(formatReadResults(out, parsed.format));
  if (parsed.format !== 'json') process.stdout.write('\n');
  // Non-zero exit if every file failed (so shell pipelines see the error).
  const allFailed = out.files.length > 0 && out.files.every(f => !f.ok);
  process.exit(allFailed ? 1 : 0);
}

// Test-only export — clears caches between unit tests.
export function __resetReadCachesForTests() {
  _cache.clear();
  _repo = null;
}

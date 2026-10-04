/**
 * sweet-search read-semantic — span selection by hybrid retrieval, content from disk.
 *
 * Pipeline:
 *   1. Enumerate candidate spans for the target file from the vectors index.
 *   2. Build a candidate union from three signals:
 *        - lexical:  term matches (regex over query terms) on chunk text + symbol
 *        - symbol:   exact substring match against the chunk's symbol/signature
 *        - MaxSim:   ColBERT-style late interaction (token-level), if the LI
 *                    index is available for these chunk IDs
 *   3. Rank by Reciprocal Rank Fusion (RRF). If MaxSim ran, do a final
 *      LI-only re-rank over the fused top-K and use the LI score as the
 *      authoritative score on returned spans.
 *   4. Re-read the selected spans from disk (filesystem ground truth).
 *   5. Expand by contextLines, merge adjacent/overlapping spans, enforce a
 *      character/token budget.
 *
 * Why hybrid: a pure single-vector dense path is known to be weaker on code
 * than ColBERT-style late interaction, and even MaxSim alone underperforms
 * BM25+MaxSim fusion on out-of-domain queries (AllianceCoder 2025; ECIR 2026
 * Late Interaction workshop survey). For per-file span selection we don't
 * have a strong corpus-level lexical index to lean on — symbol-name and
 * regex token candidates are the cheap and effective substitutes.
 *
 * DDD: search/ application layer. Allowed to import infrastructure (DB,
 * config) and ranking (LI). Never imports indexing/ or query/. Single-file
 * scope, so no graph-domain dependency required here; the candidate union
 * has a documented seam where graph 1-hop neighbors can plug in later
 * (cross-file would belong in a separate corpus-level read tool).
 */

import path from 'node:path';
import fs from 'node:fs';
import { CodebaseRepository } from '../infrastructure/codebase-repository.js';
import { DB_PATHS, LATE_INTERACTION_CONFIG, PROJECT_ROOT } from '../infrastructure/config/index.js';
import { applyPersistedLiModel } from '../infrastructure/init-config.js';
import { lineGutterEnabled, numberCodeLines, getGraphRepoForProject } from './search-read.js';
import { buildAlsoCandidates, collectNameKinds, createSemanticEntityLookup, mergeSpanNames, spanEntityNames } from './semantic-also.js';
import { readFile as readFileExact } from './search-read.js';
import { withPinnedRead } from './search-reader-pin.js';
import { emitToolIdentityAuto } from './cli-decoration.js';
import { resolveCwdPath } from './cwd-paths.js';
import { indexFreshness } from './index-freshness.js';
import { enforceExactCharBudget, exactFallbackSpan } from './semantic-span-budget.js';

// Applies the user's persisted LI model exactly once per (projectRoot, env)
// pair so encodeQuery/_getLateInteractionIndex below see the right variant.
// Without this an edge-only init silently uses the standard 768d model for
// query encoding while the on-disk LI index was built with the 256d edge
// model — every score becomes nonsense (the dim mismatch trips the
// modelMismatch guard but query encoding has already paid the wrong-cost).
const _appliedLiPerRoot = new Map(); // projectRoot -> appliedModel
function _ensurePersistedLiModelApplied(projectRoot) {
  const key = projectRoot || process.cwd();
  if (_appliedLiPerRoot.has(key)) return;
  const r = applyPersistedLiModel(key);
  _appliedLiPerRoot.set(key, r.applied);
}

// ---------------------------------------------------------------------------
// Defaults — keep modest so a one-file call stays under ~100ms after warmup.
// ---------------------------------------------------------------------------

const DEFAULTS = {
  topK: 5,
  threshold: 0.4,            // MaxSim score floor when LI ranks
  contextLines: 2,           // expand selected spans by ±N lines
  maxChars: 8000,            // hard cap on returned exact text
  rrfK: 60,                  // standard RRF constant
  lexicalWeight: 1.0,
  symbolWeight: 1.5,         // symbol-name hits are stronger evidence per-file
  maxsimWeight: 1.6,         // late interaction wins ties
  // Demotion factors applied to the final re-rank score (after MaxSim re-rank).
  // Stage 3 diagnosis (2026-05-13, PHASE6_REDO ss-semantic) found:
  //  - chunks with null/unknown symbol metadata frequently win top-1 when
  //    they're really file-header fragments or unnamed code blocks
  //    (CPP-002, RB-001, C-005, PY-004 dev failures)
  //  - tiny chunks (≤ 5 lines) inflate MaxSim by concentrating literal
  //    token presence in a small window (RB-001 `module Sinatra`,
  //    C-005 single-line `redisContext *redisConnectWithOptions(...)`).
  // Multiplicative demotion at the final-rank stage is conservative: the
  // chunk is still returned, just less likely to be top-1. Tunable; 0.85
  // was chosen by inspecting per-failure score margins (typical wrong-vs-
  // gold gap is 0.01-0.04, so 0.85 reliably flips the cases identified).
  unsymboledDemote: 0.85,
  smallChunkDemote: 0.85,
  smallChunkMaxLines: 5,
};

const APPROX_CHARS_PER_TOKEN = 4;

// ---------------------------------------------------------------------------
// Module-level lazy singletons
// ---------------------------------------------------------------------------

const RECONCILE_MANIFEST_FILENAME = 'reconcile-manifest.json';

function _projectKey(projectRoot) {
  return path.resolve(projectRoot || PROJECT_ROOT || process.cwd());
}

function _dataDirName() {
  const dir = path.basename(path.dirname(DB_PATHS.codebase || ''));
  return dir && dir !== '.' ? dir : '.sweet-search';
}

function _stateDirForProject(projectRoot) {
  const root = _projectKey(projectRoot);
  if (root === path.resolve(PROJECT_ROOT)) return path.dirname(DB_PATHS.codebase);
  return path.join(root, _dataDirName());
}

function _codebasePathForProject(projectRoot, manifest = null) {
  const descriptor = manifest?.vectors?.path || manifest?.vectors?.dbPath;
  if (descriptor) {
    return _resolveStatePath(projectRoot, descriptor);
  }
  return _defaultCodebasePathForProject(projectRoot);
}

function _defaultCodebasePathForProject(projectRoot) {
  const root = _projectKey(projectRoot);
  if (root === path.resolve(PROJECT_ROOT)) return DB_PATHS.codebase;
  return path.join(_stateDirForProject(root), 'codebase.db');
}

function _readReconcileManifest(projectRoot) {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(_stateDirForProject(projectRoot), RECONCILE_MANIFEST_FILENAME), 'utf-8'),
    );
    return Number.isInteger(manifest?.epoch) ? manifest : null;
  } catch {
    return null;
  }
}

function _resolveStatePath(projectRoot, filePath) {
  if (!filePath) return null;
  if (path.isAbsolute(filePath)) return filePath;
  return path.join(_stateDirForProject(projectRoot), filePath);
}

function _lateInteractionIndexPath(projectRoot, manifest) {
  const descriptor = manifest?.lateInteraction?.path
    || manifest?.lateInteraction?.indexPath
    || manifest?.lateInteraction?.manifest;
  if (descriptor) {
    const resolved = _resolveStatePath(projectRoot, descriptor);
    const segmentDir = path.dirname(resolved);
    return segmentDir.endsWith('.segments')
      ? segmentDir.slice(0, -'.segments'.length)
      : resolved;
  }
  const root = _projectKey(projectRoot);
  if (root === path.resolve(PROJECT_ROOT)) return DB_PATHS.lateInteraction;
  if (DB_PATHS.lateInteraction && fs.existsSync(DB_PATHS.lateInteraction)) {
    return DB_PATHS.lateInteraction;
  }
  return path.join(_stateDirForProject(root), path.basename(DB_PATHS.lateInteraction));
}

function _sourceStaleness(projectRoot, filePathRel, manifest = _readReconcileManifest(projectRoot)) {
  const abs = path.isAbsolute(filePathRel)
    ? filePathRel
    : path.resolve(projectRoot, filePathRel);
  const freshness = indexFreshness(abs, manifest);
  if (!freshness.known || !freshness.stale) return null;
  return {
    stale: true,
    indexEpoch: manifest.epoch,
    indexPublishedAt: manifest.publishedAt,
    sourceMtime: freshness.mtime.toISOString(),
    warning: 'source file is newer than the semantic index; spans were selected from stale index metadata and text was reread from disk',
  };
}

const _repos = new Map();
function _getRepo(projectRoot, manifest = _readReconcileManifest(projectRoot)) {
  const key = _projectKey(projectRoot);
  const dbPath = _codebasePathForProject(projectRoot, manifest);
  const baseDbPath = _defaultCodebasePathForProject(projectRoot);
  let entry = _repos.get(key);
  if (!entry || entry.dbPath !== dbPath || entry.baseDbPath !== baseDbPath) {
    entry?.repo?.close?.();
    try {
      entry = { dbPath, baseDbPath, repo: new CodebaseRepository(baseDbPath) };
      _repos.set(key, entry);
    } catch {
      return null;
    }
  }
  const repo = entry.repo;
  repo.refreshManifestEpoch?.();
  return repo;
}

let _liIndex = null;
let _liInitPromise = null;
let _liProjectKey = null;
let _liManifestEpoch = null;
async function _getLateInteractionIndex(projectRoot, manifest = _readReconcileManifest(projectRoot)) {
  const projectKey = _projectKey(projectRoot);
  const manifestEpoch = Number.isInteger(manifest?.epoch) ? manifest.epoch : null;
  const samePin = _liProjectKey === projectKey && _liManifestEpoch === manifestEpoch;
  if (_liIndex !== null && samePin) return _liIndex || null;
  if (_liIndex !== null && !samePin) {
    _liIndex = null;
    _liInitPromise = null;
  }
  if (_liInitPromise) return _liInitPromise;
  if (!LATE_INTERACTION_CONFIG?.enabled) return null;
  _liInitPromise = (async () => {
    try {
      const { LateInteractionIndex } = await import('../ranking/late-interaction-index.js');
      const idx = new LateInteractionIndex({
        indexPath: _lateInteractionIndexPath(projectRoot, manifest),
      });
      await idx.init();
      // If the index is empty (no segments, no docs), treat as unavailable —
      // saves a noisy warning later when scoreWithLateInteraction runs.
      if (!idx.documents || idx.documents.size === 0) {
        _liIndex = false;
        _liProjectKey = projectKey;
        _liManifestEpoch = manifestEpoch;
        return null;
      }
      _liIndex = idx;
      _liProjectKey = projectKey;
      _liManifestEpoch = manifestEpoch;
      return idx;
    } catch {
      _liIndex = false;
      _liProjectKey = projectKey;
      _liManifestEpoch = manifestEpoch;
      return null;
    } finally {
      _liInitPromise = null;
    }
  })();
  return _liInitPromise;
}

let _encodeQueryFn = null;
async function _getEncodeQuery() {
  if (_encodeQueryFn) return _encodeQueryFn;
  try {
    const mod = await import('../ranking/late-interaction-model.js');
    _encodeQueryFn = mod.encodeQuery;
    return _encodeQueryFn;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _projectRelative(absOrRelPath, projectRoot) {
  const root = projectRoot || process.cwd();
  const abs = path.isAbsolute(absOrRelPath)
    ? absOrRelPath
    : path.resolve(root, absOrRelPath);
  const rel = path.relative(root, abs);
  const normalized = _normalizeRelativePath(rel);
  if (normalized) return normalized;
  try {
    const realRel = path.relative(
      fs.realpathSync.native(root),
      fs.realpathSync.native(abs),
    );
    return _normalizeRelativePath(realRel) || abs;
  } catch {
    return abs;
  }
}

function _normalizeRelativePath(rel) {
  const normalized = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    return null;
  }
  if (path.isAbsolute(normalized)) return null;
  return normalized;
}

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

function _tokenizeQuery(q) {
  // Split on non-word, lowercase, drop very short tokens — close enough to
  // BM25-grade tokenisation for per-file term hits without a full index.
  return Array.from(new Set(
    String(q).toLowerCase().split(/[^a-zA-Z0-9_]+/g).filter(t => t.length >= 2),
  ));
}

function _escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Candidate enumeration — load chunk metadata + per-chunk on-disk text slice
// ---------------------------------------------------------------------------

async function _loadFileChunks(filePathRel, projectRoot, manifest = _readReconcileManifest(projectRoot)) {
  const repo = _getRepo(projectRoot, manifest);
  if (!repo) return { chunks: [], language: null };
  const rows = repo.getChunksByFilePath(filePathRel);
  if (rows.length === 0) return { chunks: [], language: null };

  // Read whole file once (filesystem is ground truth) — slice each span on disk.
  let diskRead;
  try {
    diskRead = await readFileExact({
      path: filePathRel,
      projectRoot,
      includeMetadata: false,
    });
  } catch {
    return { chunks: [], language: null };
  }
  if (!diskRead.ok) return { chunks: [], language: null };

  const fileText = diskRead.text;
  const lineToOffset = (() => {
    const offsets = [0];
    for (let i = 0; i < fileText.length; i++) {
      if (fileText.charCodeAt(i) === 10 /* \n */) offsets.push(i + 1);
    }
    return offsets;
  })();
  const totalLines = lineToOffset.length;

  let language = null;
  const chunks = [];
  for (const row of rows) {
    const meta = _parseMeta(row.metadata) || {};
    if (!language && meta.language) language = meta.language;
    const startLine = _metaStartLine(meta);
    const endLine = _metaEndLine(meta);
    if (startLine == null || endLine == null) continue;
    if (startLine < 1 || startLine > totalLines) continue;

    const a = Math.max(1, startLine);
    const b = Math.min(totalLines, Math.max(a, endLine));
    const startByte = lineToOffset[a - 1];
    const endByte = (b < totalLines) ? lineToOffset[b] : fileText.length;
    // Preserve disk bytes exactly (including a trailing newline if it was on
    // disk) — chunk text is consumed by lexical scoring, not returned.
    const exactText = fileText.slice(startByte, endByte);

    chunks.push({
      id: row.id,
      symbol: _metaSymbol(meta),
      type: _metaType(meta),
      signature: meta.signature ?? null,
      startLine: a,
      endLine: b,
      exactText, // re-read from disk
    });
  }
  chunks.sort((c1, c2) => c1.startLine - c2.startLine);
  return { chunks, language, totalLines, fileText };
}

// ---------------------------------------------------------------------------
// Candidate scoring signals (per file)
// ---------------------------------------------------------------------------

function _scoreLexical(chunks, queryTerms) {
  if (queryTerms.length === 0) return new Map();
  const re = new RegExp(`\\b(?:${queryTerms.map(_escapeRegex).join('|')})\\b`, 'gi');
  const scores = new Map();
  for (const c of chunks) {
    re.lastIndex = 0;
    let hits = 0;
    let m;
    while ((m = re.exec(c.exactText)) !== null) {
      hits++;
      if (hits > 50) break; // cap runaway counters on huge chunks
    }
    if (hits > 0) {
      // Diminishing returns — first hits carry more weight than the 30th.
      scores.set(c.id, Math.log2(1 + hits));
    }
  }
  return scores;
}

function _scoreSymbol(chunks, queryTerms, queryRaw) {
  if (queryTerms.length === 0) return new Map();
  const lowerRaw = String(queryRaw).toLowerCase();
  const scores = new Map();
  for (const c of chunks) {
    const sym = (c.symbol || '').toLowerCase();
    if (!sym) continue;
    let s = 0;
    // Word-boundary match prevents short symbols from collecting +2 just for
    // being a substring of an unrelated longer token in the query. Stage 3
    // PHASE6_REDO diagnosis (2026-05-13) found two ss-semantic dev FAILs
    // (JV-004 `Show getType` → `get` chunk got +2 from "get" ⊂ "gettype";
    // LU-001 `trace _class metatable` → `class` chunk got +2 from "class"
    // ⊂ "_class") where this substring-rule over-credited the wrong chunk.
    // The word-boundary form still credits genuine mentions (e.g., "query"
    // as a real query token still matches `query`-symbol chunks — ZG-001
    // ambiguity is preserved). Structural rule, no per-language signal,
    // no stopword growth.
    const reBoundary = new RegExp(`(?:^|[^a-zA-Z0-9_])${_escapeRegex(sym)}(?=[^a-zA-Z0-9_]|$)`, 'i');
    if (sym && reBoundary.test(lowerRaw)) s += 2;         // query mentions symbol as a word
    for (const t of queryTerms) {
      if (sym === t) s += 3;                              // exact name match
      else if (sym.includes(t)) s += 1;                   // substring (chunk symbol contains query token)
    }
    if (s > 0) scores.set(c.id, s);
  }
  return scores;
}

async function _scoreLateInteraction(chunks, query, projectRoot, lateInteractionIndexOverride = null, manifest = undefined) {
  if (chunks.length === 0) return { scores: new Map(), ran: false };
  const liIndex = lateInteractionIndexOverride || await _getLateInteractionIndex(projectRoot, manifest);
  if (!liIndex) return { scores: new Map(), ran: false };

  // Only score chunks whose IDs actually appear in the LI index. Use the
  // public availability API so alias pointers and live tombstone sidecars
  // share the same visibility contract as normal search.
  const available = liIndex.hasTokens(chunks.map(c => c.id));
  const candidates = chunks
    .filter(c => available.has(c.id))
    .map(c => ({ id: c.id, score: 0 }));
  if (candidates.length === 0) return { scores: new Map(), ran: false };

  const encodeQuery = await _getEncodeQuery();
  if (!encodeQuery) return { scores: new Map(), ran: false };

  let qTokens;
  try { qTokens = await encodeQuery(query); }
  catch { return { scores: new Map(), ran: false }; }
  if (!qTokens || qTokens.length === 0) return { scores: new Map(), ran: false };

  let scored;
  try {
    scored = await liIndex.scoreWithLateInteraction(qTokens, candidates);
  } catch {
    return { scores: new Map(), ran: false };
  }

  const out = new Map();
  for (const r of scored) out.set(r.id, r.lateInteractionScore ?? r.score ?? 0);
  return { scores: out, ran: true };
}

// ---------------------------------------------------------------------------
// Reciprocal Rank Fusion over multiple signal maps
// ---------------------------------------------------------------------------

function _rrfFuse(signalMaps, weights, rrfK) {
  // signalMaps: [{ id -> score }] in same order as `weights`
  const fused = new Map();
  for (let i = 0; i < signalMaps.length; i++) {
    const m = signalMaps[i];
    if (!m || m.size === 0) continue;
    const w = weights[i] ?? 1;
    const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
    for (let r = 0; r < sorted.length; r++) {
      const [id] = sorted[r];
      const contribution = w / (rrfK + r + 1);
      fused.set(id, (fused.get(id) || 0) + contribution);
    }
  }
  return fused;
}

// ---------------------------------------------------------------------------
// Span post-processing — context expansion, merging, budget enforcement
// ---------------------------------------------------------------------------

// Lines of the same definition between two selected pieces that still print as one span.
const SAME_DEFINITION_GAP_LINES = 40;
const _baseSymbol = (sym) => (sym ? String(sym).replace(/ \(part \d+\)$/, '') : null);

function _expandAndMergeSpans(selected, totalLines, contextLines, gapMergeFits = () => true) {
  if (selected.length === 0) return [];
  const padded = selected
    .map(s => ({
      ...s,
      coreStart: s.startLine,
      coreEnd: s.endLine,
      startLine: Math.max(1, s.startLine - contextLines),
      endLine: Math.min(totalLines, s.endLine + contextLines),
    }))
    .sort((a, b) => a.startLine - b.startLine);

  const merged = [];
  for (const span of padded) {
    const last = merged[merged.length - 1];
    // Two pieces of one long definition (`f (part 5)`, `f (part 8)`) with a short gap print
    // as one span: the gap is the same function's code, and two fragments with a hole read
    // as two places (grdb asyncConcurrentRead 572-607 and 638-644).
    const sameDefinition = last && span.startLine - last.endLine - 1 <= SAME_DEFINITION_GAP_LINES
      && last.symbols.some((x) => _baseSymbol(x) && _baseSymbol(x) === _baseSymbol(span.symbol))
      && gapMergeFits(last.startLine, Math.max(last.endLine, span.endLine));
    // Overlapping or touching spans merge too only while the result fits the budget; two
    // spans that do not fit together stay apart, so the budget keeps the better one whole
    // (ocelot RoundRobin 7-63 + 64-128 merged to 7-128 and the cut lost 64-128, the answer).
    // Chunks that themselves overlap must merge; spans that only touch or overlap through
    // their context padding merge only while the result fits the budget (sequel timed_queue:
    // five adjacent chunks merged into 9-292 through padding, the cut kept 9-79 and lost the
    // `preconnect` chunk the question names).
    const coresOverlap = last && span.coreStart <= last.coreEnd;
    const touching = last && span.startLine <= last.endLine + 1
      && (coresOverlap || gapMergeFits(last.startLine, Math.max(last.endLine, span.endLine)));
    if (last && (touching || sameDefinition)) {
      // Overlap or touching — merge.
      last.endLine = Math.max(last.endLine, span.endLine);
      last.coreStart = Math.min(last.coreStart, span.coreStart);
      last.coreEnd = Math.max(last.coreEnd, span.coreEnd);
      last.score = Math.max(last.score, span.score);
      last.symbols = Array.from(new Set([
        ...(last.symbols || []),
        ...(span.symbol ? [span.symbol] : []),
      ]));
      last.types = Array.from(new Set([
        ...(last.types || []),
        ...(span.type ? [span.type] : []),
      ]));
      last.chunkIds.push(span.id);
    } else {
      merged.push({
        startLine: span.startLine,
        endLine: span.endLine,
        coreStart: span.coreStart,
        coreEnd: span.coreEnd,
        score: span.score,
        symbols: span.symbol ? [span.symbol] : [],
        types: span.type ? [span.type] : [],
        chunkIds: [span.id],
      });
    }
  }
  return merged;
}

// A context line above a span that only closes the previous definition, or is blank.
const PAD_ABOVE_NOISE = /^\s*(?:[}\])]+[;,)]*)?\s*$|^\s*end\s*$/;
// A context line below a span that is blank or starts the next definition's comment.
const PAD_BELOW_NOISE = /^\s*$|^\s*(?:\/\/|\/\*|\*|#(?!\[)|--)/;

/**
 * Context padding (contextLines above and below a span's chunks) that is no context: the
 * previous definition's closing `}` above (zipkin, drogon spans opened with a stray `}`), the
 * next definition's doc comment below. Lines of the chunks themselves are never trimmed.
 */
function _trimContextPadding(spans, fileText, lineOffsets) {
  const lineAt = (n) => fileText.slice(lineOffsets[n - 1] ?? 0, (lineOffsets[n] ?? fileText.length + 1) - 1);
  for (const sp of spans) {
    while (Number.isInteger(sp.coreStart) && sp.startLine < sp.coreStart && PAD_ABOVE_NOISE.test(lineAt(sp.startLine))) sp.startLine++;
    while (Number.isInteger(sp.coreEnd) && sp.endLine > sp.coreEnd && PAD_BELOW_NOISE.test(lineAt(sp.endLine))) sp.endLine--;
  }
  return spans;
}

function _sliceSpanFromDisk(fileText, lineOffsets, startLine, endLine) {
  const total = lineOffsets.length;
  if (total === 0) return '';
  const a = Math.max(1, startLine | 0);
  const b = Math.min(total, Math.max(a, endLine | 0));
  const startByte = lineOffsets[a - 1];
  const endByte = (b < total) ? lineOffsets[b] : fileText.length;
  // Return disk-exact bytes; never strip newlines that exist on disk.
  return fileText.slice(startByte, endByte);
}

function _enforceCharBudget(spans, fileText, lineOffsets, maxChars) {
  // Greedy: take spans by score until we'd blow the budget. The minimum
  // span we always include is the top-1 (truncated if it alone exceeds the
  // budget) — better to return one truncated span than nothing.
  const ranked = [...spans].sort((a, b) => b.score - a.score);
  const kept = [];
  let used = 0;
  for (const span of ranked) {
    const text = _sliceSpanFromDisk(fileText, lineOffsets, span.startLine, span.endLine);
    const cost = text.length;
    if (kept.length === 0 && cost > maxChars) {
      // Truncate the single top span; prefer head of the span (definition first).
      const truncatedText = text.slice(0, maxChars);
      kept.push({ ...span, text: truncatedText, truncated: true });
      used += truncatedText.length;
      break;
    }
    if (used + cost > maxChars) continue;
    kept.push({ ...span, text });
    used += cost;
  }
  // Restore line order in the final output for readability.
  kept.sort((a, b) => a.startLine - b.startLine);
  return { spans: kept, charsUsed: used };
}

function _fallbackSpanFromRead(fallback, maxChars) {
  const text = fallback.text || '';
  const capped = text.length > maxChars ? text.slice(0, maxChars) : text;
  return {
    startLine: 1,
    endLine: fallback.totalLines,
    score: 0,
    symbols: [],
    types: [],
    chunkIds: [],
    text: capped,
    truncated: capped.length < text.length || undefined,
  };
}

function _fallbackSpanFromText(fileText, totalLines, maxChars) {
  const capped = fileText.length > maxChars ? fileText.slice(0, maxChars) : fileText;
  return {
    startLine: 1,
    endLine: totalLines,
    score: 0,
    symbols: [],
    types: [],
    chunkIds: [],
    text: capped,
    truncated: capped.length < fileText.length || undefined,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @param {Object} req
 * @param {string} req.path - File path (project-relative or absolute)
 * @param {string} req.query - Natural language query
 * @param {number} [req.topK=5]
 * @param {number} [req.threshold=0.4] - MaxSim score floor when LI runs
 * @param {number} [req.contextLines=2]
 * @param {number} [req.maxChars=8000]
 * @param {number} [req.maxTokens] - Convenience: ~maxChars / 4
 * @param {string} [req.projectRoot]
 * @param {boolean} [req.verbose=false] - include timings + signal contributions
 * @param {boolean} [req.exactRanges=false] - a span cut by the budget holds whole lines and
 *   reports exactly the printed range (SS_FIX_SEMANTIC_RANGES; semantic-span-budget.js)
 * @param {boolean} [req.pickExcerpt=false] - an over-budget span is excerpted around its best
 *   chunk (SS_FIX_SEMANTIC_PICK); implies exactRanges
 * @param {Object} [req._lateInteractionIndex] - private daemon injection; same-project index only
 * @returns {Promise<Object>}
 */
async function _readSemanticUnpinned(req) {
  const t0 = performance.now();
  if (!req || !req.path) throw new Error('path is required');
  if (!req.query || !String(req.query).trim()) throw new Error('query is required');

  const projectRoot = req.projectRoot || process.cwd();
  _ensurePersistedLiModelApplied(projectRoot);
  const filePathRel = _projectRelative(req.path, projectRoot);
  // One manifest read per request — _sourceStaleness/_getRepo/_getLateInteractionIndex
  // each re-read the same file otherwise (it cannot change mid-request usefully).
  const reconcileManifest = _readReconcileManifest(projectRoot);
  const staleness = _sourceStaleness(projectRoot, filePathRel, reconcileManifest);

  const topK = req.topK ?? DEFAULTS.topK;
  const threshold = req.threshold ?? DEFAULTS.threshold;
  const contextLines = req.contextLines ?? DEFAULTS.contextLines;
  const maxChars = req.maxChars
    ?? (req.maxTokens != null ? req.maxTokens * APPROX_CHARS_PER_TOKEN : DEFAULTS.maxChars);
  const verbose = !!req.verbose;
  // SS_FIX_SEMANTIC_RANGES / SS_FIX_SEMANTIC_PICK (semantic-span-budget.js); absent = unchanged.
  const pickExcerpt = req.pickExcerpt === true;
  const exactRanges = pickExcerpt || req.exactRanges === true;

  const tLoad0 = performance.now();
  const { chunks, language, totalLines, fileText } = await _loadFileChunks(filePathRel, projectRoot, reconcileManifest);
  const tLoad1 = performance.now();

  // No chunks at all → fall back to plain read so the caller still gets
  // exact text. Document the fallback in the response.
  if (!chunks || chunks.length === 0) {
    const fallback = await readFileExact({ path: req.path, projectRoot });
    if (exactRanges && fallback.ok) {
      const span = exactFallbackSpan(fallback.text || '', fallback.totalLines, maxChars);
      return {
        file: filePathRel,
        query: req.query,
        ok: true,
        indexed: false,
        fellBack: true,
        reason: 'file not indexed for semantic span selection — returning whole file via plain read',
        language: fallback.language,
        totalLines: fallback.totalLines,
        spans: [span],
        charsReturned: span.text.length,
        approxTokensReturned: Math.ceil(span.text.length / APPROX_CHARS_PER_TOKEN),
        ...(staleness ? { staleness, warnings: [staleness.warning] } : {}),
        timings: { totalMs: +(performance.now() - t0).toFixed(2) },
      };
    }
    return {
      file: filePathRel,
      query: req.query,
      ok: fallback.ok,
      indexed: false,
      fellBack: true,
      reason: 'file not indexed for semantic span selection — returning whole file via plain read',
      language: fallback.language,
      totalLines: fallback.totalLines,
      spans: fallback.ok ? [_fallbackSpanFromRead(fallback, maxChars)] : [],
      charsReturned: fallback.ok ? Math.min((fallback.text || '').length, maxChars) : 0,
      approxTokensReturned: fallback.ok ? Math.ceil(Math.min((fallback.text || '').length, maxChars) / APPROX_CHARS_PER_TOKEN) : 0,
      ...(staleness ? { staleness, warnings: [staleness.warning] } : {}),
      timings: { totalMs: +(performance.now() - t0).toFixed(2) },
    };
  }

  // Build line-offset table over the disk text once for span re-reads.
  const lineOffsets = (() => {
    const offsets = [0];
    for (let i = 0; i < fileText.length; i++) {
      if (fileText.charCodeAt(i) === 10) offsets.push(i + 1);
    }
    return offsets;
  })();

  const queryTerms = _tokenizeQuery(req.query);

  const tLex0 = performance.now();
  const lexicalScores = _scoreLexical(chunks, queryTerms);
  const symbolScores = _scoreSymbol(chunks, queryTerms, req.query);
  const tLex1 = performance.now();

  const tLi0 = performance.now();
  const { scores: maxsimScores, ran: liRan } = await _scoreLateInteraction(
    chunks,
    req.query,
    projectRoot,
    req._lateInteractionIndex || null,
    reconcileManifest,
  );
  const tLi1 = performance.now();

  // Threshold gate on MaxSim — drop chunks whose LI score is too low. This
  // is purely a score-floor: chunks still surviving via lexical/symbol can
  // be retained downstream, since the floor is a MaxSim-specific quality
  // signal.
  if (liRan && threshold > 0) {
    for (const [id, s] of [...maxsimScores]) {
      if (s < threshold) maxsimScores.delete(id);
    }
  }

  // Fuse — all three signals contribute via RRF.
  const fused = _rrfFuse(
    [lexicalScores, symbolScores, maxsimScores],
    [DEFAULTS.lexicalWeight, DEFAULTS.symbolWeight, DEFAULTS.maxsimWeight],
    DEFAULTS.rrfK,
  );

  // If everything is empty, return the whole file as a graceful fallback
  // with a low confidence marker rather than nothing.
  if (fused.size === 0) {
    const span = exactRanges
      ? exactFallbackSpan(fileText, totalLines, maxChars)
      : _fallbackSpanFromText(fileText, totalLines, maxChars);
    const chars = exactRanges ? span.text.length : Math.min(fileText.length, maxChars);
    return {
      file: filePathRel,
      query: req.query,
      ok: true,
      indexed: true,
      fellBack: true,
      reason: 'no chunk matched query signals — returning whole file',
      language,
      totalLines,
      spans: [span],
      charsReturned: chars,
      approxTokensReturned: Math.ceil(chars / APPROX_CHARS_PER_TOKEN),
      signals: verbose ? { liRan, lexicalHits: 0, symbolHits: 0, maxsimHits: 0 } : undefined,
      ...(staleness ? { staleness, warnings: [staleness.warning] } : {}),
      timings: verbose ? {
        loadMs: +(tLoad1 - tLoad0).toFixed(2),
        lexicalMs: +(tLex1 - tLex0).toFixed(2),
        liMs: +(tLi1 - tLi0).toFixed(2),
        totalMs: +(performance.now() - t0).toFixed(2),
      } : { totalMs: +(performance.now() - t0).toFixed(2) },
    };
  }

  // Take top-K by fused score, then pull the actual chunk records.
  const idToChunk = new Map(chunks.map(c => [c.id, c]));
  // A chunk whose definition the question names is the place it asks about. A mention
  // shaped like code (`preConnect`, `pre_connect`, `preconnect(`, a backticked name, or a
  // symbol that is itself camelCase / snake_case) pins the chunk first. A plain word
  // ("what does close do") can also be English, so it gets a bounded boost only.
  const rawQuery = String(req.query);
  const queryWords = new Set((rawQuery.match(/[A-Za-z_][A-Za-z0-9_]*[?!]?/g) || []).map(w => w.toLowerCase()));
  const codeMentions = new Set();
  for (const m of rawQuery.matchAll(/`([^`]+)`|(?:\.|::)?([A-Za-z_][A-Za-z0-9_]*)(\s*\()?/g)) {
    if (m[1]) { for (const w of m[1].match(/[A-Za-z_][A-Za-z0-9_]*/g) || []) codeMentions.add(w.toLowerCase()); continue; }
    const w = m[2];
    if (m[3] || /^[.:]/.test(m[0]) || /[_0-9]|[a-z][A-Z]/.test(w)) codeMentions.add(w.toLowerCase());
  }
  const namedByQuery = (r) => {
    const raw = String(_baseSymbol(r.symbol) || '').split(/\.|::|#/).pop();
    const sym = raw.toLowerCase();
    if (sym.length < 3 || !queryWords.has(sym)) return 0;
    return codeMentions.has(sym) || /_|[a-z][A-Z]/.test(raw) ? 2 : 1;
  };
  const NAMED_WORD_BOOST = 1.15;
  const namedScore = (r) => (namedByQuery(r) === 1 ? r.score * NAMED_WORD_BOOST : r.score);
  // Overshoot a bit before the LI re-rank: the pool holds the top topK*2 DEFINITIONS, every
  // piece of one counted once. Eight pieces of one long function (grdb asyncConcurrentRead
  // parts 1-8) otherwise filled the pool and kept every other definition from the re-rank.
  const poolDefinitions = Math.max(topK * 2, topK);
  const seenDefinitions = new Set();
  const fusedTop = [];
  for (const entry of [...fused.entries()].sort((a, b) => b[1] - a[1])) {
    const c = idToChunk.get(entry[0]);
    const def = c ? `${_baseSymbol(c.symbol) || `@${c.startLine}`}` : entry[0];
    if (!seenDefinitions.has(def)) {
      if (seenDefinitions.size >= poolDefinitions) continue;
      seenDefinitions.add(def);
    }
    fusedTop.push(entry);
  }
  // A chunk the question names joins the pool even when its fused score left it out.
  const pooled = new Set(fusedTop.map(([id]) => id));
  for (const c of chunks) if (!pooled.has(c.id) && namedByQuery(c)) fusedTop.push([c.id, fused.get(c.id) || 0]);

  // Final re-rank: prefer late-interaction score when LI ran; otherwise the
  // RRF score is the authority. This mirrors the SOTA pattern (cheap candidate
  // pool → expensive LI re-rank on the survivors).
  //
  // Multiplicative score demotions on null/unknown-symbol chunks and on tiny
  // chunks are applied here so the re-rank below sees the corrected score
  // (Stage 3 PHASE6_REDO ss-semantic, 2026-05-13). Demotion is intentionally
  // applied AFTER the MaxSim re-rank threshold gate above — chunks still
  // survive into the result, they're just less likely to win top-1.
  const unsymDemote = req.unsymboledDemote ?? DEFAULTS.unsymboledDemote;
  const smallDemote = req.smallChunkDemote ?? DEFAULTS.smallChunkDemote;
  const smallChunkMaxLines = req.smallChunkMaxLines ?? DEFAULTS.smallChunkMaxLines;

  const rankedAll = fusedTop
    .map(([id, fusedScore]) => {
      const c = idToChunk.get(id);
      if (!c) return null;
      const li = maxsimScores.get(id);
      const baseScore = liRan && li != null ? li : fusedScore;
      // Stage 3 PHASE6_REDO ss-semantic (2026-05-13): demote only the
      // INTERSECTION of (null-or-unknown symbol) AND (≤ smallChunkMaxLines).
      // Earlier OR-form regressed typescript-lib (interface declarations
      // are legitimately small AND symboled; OR-rule demoted them too).
      // The intersection targets exactly the RB-001 pattern — short
      // unnamed code fragments that win MaxSim by concentrated literal
      // tokens (e.g., 3-line `module Sinatra` decl beating the 24-line
      // Base class body). Multiplicative composition gives 0.85*0.85=0.7225x
      // when both conditions fire.
      const symMeta = c.symbol;
      const isUnsymboled = !symMeta || symMeta === 'unknown';
      const chunkLines = c.endLine - c.startLine + 1;
      const isSmall = chunkLines <= smallChunkMaxLines;
      const demoteFactor = (isUnsymboled && isSmall)
        ? unsymDemote * smallDemote
        : 1;
      const finalScore = baseScore * demoteFactor;
      return {
        id,
        symbol: c.symbol,
        type: c.type,
        startLine: c.startLine,
        endLine: c.endLine,
        score: finalScore,
        signals: {
          lexical: lexicalScores.get(id) || 0,
          symbol: symbolScores.get(id) || 0,
          maxsim: liRan ? (maxsimScores.get(id) ?? null) : null,
          fused: fusedScore,
          baseScore,
          demoteFactor,
        },
      };
    })
    .filter(Boolean)
    .sort((a, b) => ((namedByQuery(b) === 2) - (namedByQuery(a) === 2)) || (namedScore(b) - namedScore(a)));
  const ranked = rankedAll.slice(0, topK);

  // A gap of one definition is filled only while the merged span fits the budget: an
  // over-budget span is cut from its head, and the cut dropped the best piece (composer
  // doUpdate 493-693: the top-scoring 668-691, the `setLockData` call, fell off the end).
  const spanChars = (a, b) => (lineOffsets[Math.min(b, lineOffsets.length - 1)] ?? fileText.length) - (lineOffsets[a - 1] ?? 0);
  const merged = _trimContextPadding(
    _expandAndMergeSpans(ranked, totalLines, contextLines, (a, b) => spanChars(a, b) <= maxChars),
    fileText, lineOffsets,
  );
  const { spans, charsUsed } = exactRanges
    ? enforceExactCharBudget(merged, fileText, lineOffsets, maxChars, {
      pick: pickExcerpt,
      parts: pickExcerpt ? ranked.map(s => ({
        startLine: Math.max(1, s.startLine - contextLines),
        endLine: Math.min(totalLines, s.endLine + contextLines),
        score: s.score,
      })) : undefined,
    })
    : _enforceCharBudget(merged, fileText, lineOffsets, maxChars);

  // Output-only pointers: what the printed spans hold, and the next-best ranked places that
  // the budget left out. Neither changes ranking or which spans are printed, and the
  // candidates are not shown spans (the caller must not ledger them).
  const graph = createSemanticEntityLookup(getGraphRepoForProject(projectRoot), filePathRel, spans, rankedAll);
  for (const span of spans) {
    const entityNames = spanEntityNames(graph, filePathRel, span);
    if (entityNames.length) span.entityNames = mergeSpanNames(entityNames, span.symbols, { truncated: span.truncated === true });
  }
  const alsoCandidates = buildAlsoCandidates(rankedAll, spans, { file: filePathRel, graph });
  const nameKinds = collectNameKinds(graph, rankedAll);

  return {
    file: filePathRel,
    query: req.query,
    ok: true,
    indexed: true,
    fellBack: false,
    language,
    totalLines,
    spans,
    alsoCandidates,
    nameKinds,
    charsReturned: charsUsed,
    approxTokensReturned: Math.ceil(charsUsed / APPROX_CHARS_PER_TOKEN),
    ...(staleness ? { staleness, warnings: [staleness.warning] } : {}),
    signals: verbose ? {
      liRan,
      lexicalHits: lexicalScores.size,
      symbolHits: symbolScores.size,
      maxsimHits: maxsimScores.size,
      fusedCandidates: fused.size,
      preMergeRanked: ranked,
    } : undefined,
    timings: verbose ? {
      loadMs: +(tLoad1 - tLoad0).toFixed(2),
      lexicalMs: +(tLex1 - tLex0).toFixed(2),
      liMs: +(tLi1 - tLi0).toFixed(2),
      totalMs: +(performance.now() - t0).toFixed(2),
    } : { totalMs: +(performance.now() - t0).toFixed(2) },
  };
}

export async function readSemantic(req) {
  const projectRoot = req?.projectRoot || process.cwd();
  return withPinnedRead(
    {
      projectRoot,
      meta: {
        tool: 'read-semantic',
        path: req?.path ?? null,
        query: req?.query ? String(req.query).slice(0, 200) : null,
      },
    },
    () => _readSemanticUnpinned({ ...req, projectRoot }),
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatReadSemanticResult(result, format = 'agent') {
  if (format === 'json') return JSON.stringify(result, null, 2);

  const gutterOn = lineGutterEnabled({ format });
  const fence = result.language ? '```' + result.language : '```';
  const header = result.fellBack
    ? `### ${result.file} — full file (${result.reason || 'fallback'})`
    : `### ${result.file} — top spans for: ${JSON.stringify(result.query)}`;
  const lines = [header];
  if (!result.ok) {
    lines.push(`[error]`);
    return lines.join('\n');
  }
  for (const warning of result.warnings || []) {
    lines.push(`[warning] ${warning}`);
  }
  for (const span of result.spans) {
    const label = span.symbols && span.symbols.length
      ? `${span.symbols.join(', ')} (lines ${span.startLine}-${span.endLine})`
      : `lines ${span.startLine}-${span.endLine}`;
    lines.push(`-- ${label}${typeof span.score === 'number' ? ` — score=${span.score.toFixed(3)}` : ''}`);
    lines.push(fence);
    // Line-number gutter (default ON for agent format; benchmark uses json path).
    lines.push(gutterOn && String(span.text || '').split('\n').length >= 15
      ? numberCodeLines(span.text, span.startLine || 1)
      : span.text);
    lines.push('```');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI handler
//   sweet-search read-semantic path/to/file.ts "how does X work"
//   sweet-search read-semantic path/to/file.ts "..." --top 5 --threshold 0.4
//   sweet-search read-semantic path/to/file.ts "..." --json --verbose
// ---------------------------------------------------------------------------

function _parseArgs(args) {
  const positional = [];
  let format = 'agent';
  let topK; let threshold; let contextLines; let maxChars; let maxTokens; let verbose = false;
  let plain = false; let noBanner = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') format = 'json';
    else if (a === '--agent') format = 'agent';
    else if (a === '--no-banner') noBanner = true;
    else if (a === '--format' || a.startsWith('--format=')) {
      const v = a === '--format' ? args[++i] : a.slice('--format='.length);
      if (v === 'json' || v === 'agent') format = v;
      else if (v === 'plain') plain = true;
      else throw new Error(`unknown --format value: ${v}`);
    }
    else if (a === '--verbose') verbose = true;
    else if (a === '--top' || a === '--top-k' || a === '-k') topK = +args[++i];
    else if (a === '--threshold') threshold = +args[++i];
    else if (a === '--context') contextLines = +args[++i];
    else if (a === '--max-chars') maxChars = +args[++i];
    else if (a === '--max-tokens') maxTokens = +args[++i];
    else if (a === '--help' || a === '-h') return { help: true };
    else if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
    else positional.push(a);
  }
  return { positional, format, topK, threshold, contextLines, maxChars, maxTokens, verbose, plain, noBanner };
}

function _printHelp() {
  process.stdout.write([
    'sweet-search read-semantic — return only the file spans relevant to a query',
    '',
    'Usage:',
    '  sweet-search read-semantic <file> "<query>"',
    '',
    'Options:',
    '  --top, -k <n>       Max ranked spans before merging (default: 5)',
    '  --threshold <f>     MaxSim score floor when LI runs (default: 0.4)',
    '  --context <n>       Lines of pre/post context per selected span (default: 2)',
    '  --max-chars <n>     Hard cap on returned text (default: 8000)',
    '  --max-tokens <n>    Convenience cap (~chars/4)',
    '  --json              Emit JSON',
    '  --format <fmt>      json | agent | plain (plain = no identity line)',
    '  --no-banner         Suppress the identity line',
    '  --verbose           Include timings + per-signal scores',
    '',
  ].join('\n'));
}

export async function handleReadSemanticCli(args) {
  let parsed;
  try { parsed = _parseArgs(args); }
  catch (err) { process.stderr.write(`[sweet-search read-semantic] ${err.message}\n`); process.exit(2); }
  if (parsed.help || !parsed.positional || parsed.positional.length < 2) {
    _printHelp();
    process.exit(parsed.help ? 0 : 2);
  }
  const [file, ...queryParts] = parsed.positional;
  const query = queryParts.join(' ');
  const result = await readSemantic({
    // Shell semantics: a path relative to the cwd wins, else it stays root-relative.
    path: resolveCwdPath(file, { root: PROJECT_ROOT }),
    projectRoot: PROJECT_ROOT,   // never the cwd: from a subdirectory nothing was found
    query,
    topK: parsed.topK,
    threshold: parsed.threshold,
    contextLines: parsed.contextLines,
    maxChars: parsed.maxChars,
    maxTokens: parsed.maxTokens,
    verbose: parsed.verbose,
  });
  if (parsed.format !== 'json') {
    emitToolIdentityAuto('read-semantic', `${file} · "${query}"`, { plain: parsed.plain, noBanner: parsed.noBanner });
  }
  process.stdout.write(formatReadSemanticResult(result, parsed.format));
  if (parsed.format !== 'json') process.stdout.write('\n');
  process.exit(result.ok ? 0 : 1);
}

// Test-only export — clears caches between unit tests.
export function __resetReadSemanticCachesForTests() {
  for (const entry of _repos.values()) entry?.repo?.close?.();
  _repos.clear();
  _liIndex = null;
  _liInitPromise = null;
  _liProjectKey = null;
  _liManifestEpoch = null;
  _encodeQueryFn = null;
  _appliedLiPerRoot.clear();
}

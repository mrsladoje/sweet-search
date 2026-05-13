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
import { CodebaseRepository } from '../infrastructure/codebase-repository.js';
import { DB_PATHS, LATE_INTERACTION_CONFIG } from '../infrastructure/config/index.js';
import { applyPersistedLiModel } from '../infrastructure/init-config.js';
import { readFile as readFileExact } from './search-read.js';

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

let _repo = null;
function _getRepo() {
  if (_repo === null) {
    try { _repo = new CodebaseRepository(DB_PATHS.codebase); }
    catch { _repo = false; }
  }
  return _repo || null;
}

let _liIndex = null;
let _liInitPromise = null;
async function _getLateInteractionIndex() {
  if (_liIndex) return _liIndex;
  if (_liInitPromise) return _liInitPromise;
  if (!LATE_INTERACTION_CONFIG?.enabled) return null;
  _liInitPromise = (async () => {
    try {
      const { LateInteractionIndex } = await import('../ranking/late-interaction-index.js');
      const idx = new LateInteractionIndex({});
      await idx.init();
      // If the index is empty (no segments, no docs), treat as unavailable —
      // saves a noisy warning later when scoreWithLateInteraction runs.
      if (!idx.documents || idx.documents.size === 0) {
        _liIndex = false;
        return null;
      }
      _liIndex = idx;
      return idx;
    } catch {
      _liIndex = false;
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
  return rel.startsWith('..') || path.isAbsolute(rel) ? abs : rel;
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

async function _loadFileChunks(filePathRel, projectRoot) {
  const repo = _getRepo();
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
    if (sym && lowerRaw.includes(sym)) s += 2;            // raw query mentions the symbol
    for (const t of queryTerms) {
      if (sym === t) s += 3;                              // exact name match
      else if (sym.includes(t)) s += 1;                   // substring
    }
    if (s > 0) scores.set(c.id, s);
  }
  return scores;
}

async function _scoreLateInteraction(chunks, query) {
  if (chunks.length === 0) return { scores: new Map(), ran: false };
  const liIndex = await _getLateInteractionIndex();
  if (!liIndex) return { scores: new Map(), ran: false };

  // Only score chunks whose IDs actually appear in the LI index.
  const candidates = chunks
    .filter(c => liIndex.documents.has(c.id))
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

function _expandAndMergeSpans(selected, totalLines, contextLines) {
  if (selected.length === 0) return [];
  const padded = selected
    .map(s => ({
      ...s,
      startLine: Math.max(1, s.startLine - contextLines),
      endLine: Math.min(totalLines, s.endLine + contextLines),
    }))
    .sort((a, b) => a.startLine - b.startLine);

  const merged = [];
  for (const span of padded) {
    const last = merged[merged.length - 1];
    if (last && span.startLine <= last.endLine + 1) {
      // Overlap or touching — merge.
      last.endLine = Math.max(last.endLine, span.endLine);
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
        score: span.score,
        symbols: span.symbol ? [span.symbol] : [],
        types: span.type ? [span.type] : [],
        chunkIds: [span.id],
      });
    }
  }
  return merged;
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
 * @returns {Promise<Object>}
 */
export async function readSemantic(req) {
  const t0 = performance.now();
  if (!req || !req.path) throw new Error('path is required');
  if (!req.query || !String(req.query).trim()) throw new Error('query is required');

  const projectRoot = req.projectRoot || process.cwd();
  _ensurePersistedLiModelApplied(projectRoot);
  const filePathRel = _projectRelative(req.path, projectRoot);

  const topK = req.topK ?? DEFAULTS.topK;
  const threshold = req.threshold ?? DEFAULTS.threshold;
  const contextLines = req.contextLines ?? DEFAULTS.contextLines;
  const maxChars = req.maxChars
    ?? (req.maxTokens != null ? req.maxTokens * APPROX_CHARS_PER_TOKEN : DEFAULTS.maxChars);
  const verbose = !!req.verbose;

  const tLoad0 = performance.now();
  const { chunks, language, totalLines, fileText } = await _loadFileChunks(filePathRel, projectRoot);
  const tLoad1 = performance.now();

  // No chunks at all → fall back to plain read so the caller still gets
  // exact text. Document the fallback in the response.
  if (!chunks || chunks.length === 0) {
    const fallback = await readFileExact({ path: req.path, projectRoot });
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
  const { scores: maxsimScores, ran: liRan } = await _scoreLateInteraction(chunks, req.query);
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
    return {
      file: filePathRel,
      query: req.query,
      ok: true,
      indexed: true,
      fellBack: true,
      reason: 'no chunk matched query signals — returning whole file',
      language,
      totalLines,
      spans: [_fallbackSpanFromText(fileText, totalLines, maxChars)],
      charsReturned: Math.min(fileText.length, maxChars),
      approxTokensReturned: Math.ceil(Math.min(fileText.length, maxChars) / APPROX_CHARS_PER_TOKEN),
      signals: verbose ? { liRan, lexicalHits: 0, symbolHits: 0, maxsimHits: 0 } : undefined,
      timings: verbose ? {
        loadMs: +(tLoad1 - tLoad0).toFixed(2),
        lexicalMs: +(tLex1 - tLex0).toFixed(2),
        liMs: +(tLi1 - tLi0).toFixed(2),
        totalMs: +(performance.now() - t0).toFixed(2),
      } : { totalMs: +(performance.now() - t0).toFixed(2) },
    };
  }

  // Take top-K by fused score, then pull the actual chunk records.
  const fusedTop = [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(topK * 2, topK)); // overshoot a bit before LI re-rank
  const idToChunk = new Map(chunks.map(c => [c.id, c]));

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

  const ranked = fusedTop
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
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const merged = _expandAndMergeSpans(ranked, totalLines, contextLines);
  const { spans, charsUsed } = _enforceCharBudget(merged, fileText, lineOffsets, maxChars);

  return {
    file: filePathRel,
    query: req.query,
    ok: true,
    indexed: true,
    fellBack: false,
    language,
    totalLines,
    spans,
    charsReturned: charsUsed,
    approxTokensReturned: Math.ceil(charsUsed / APPROX_CHARS_PER_TOKEN),
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

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatReadSemanticResult(result, format = 'agent') {
  if (format === 'json') return JSON.stringify(result, null, 2);

  const fence = result.language ? '```' + result.language : '```';
  const header = result.fellBack
    ? `### ${result.file} — full file (${result.reason || 'fallback'})`
    : `### ${result.file} — top spans for: ${JSON.stringify(result.query)}`;
  const lines = [header];
  if (!result.ok) {
    lines.push(`[error]`);
    return lines.join('\n');
  }
  for (const span of result.spans) {
    const label = span.symbols && span.symbols.length
      ? `${span.symbols.join(', ')} (lines ${span.startLine}-${span.endLine})`
      : `lines ${span.startLine}-${span.endLine}`;
    lines.push(`-- ${label}${typeof span.score === 'number' ? ` — score=${span.score.toFixed(3)}` : ''}`);
    lines.push(fence);
    lines.push(span.text);
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
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') format = 'json';
    else if (a === '--agent') format = 'agent';
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
  return { positional, format, topK, threshold, contextLines, maxChars, maxTokens, verbose };
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
    path: file,
    query,
    topK: parsed.topK,
    threshold: parsed.threshold,
    contextLines: parsed.contextLines,
    maxChars: parsed.maxChars,
    maxTokens: parsed.maxTokens,
    verbose: parsed.verbose,
  });
  process.stdout.write(formatReadSemanticResult(result, parsed.format));
  if (parsed.format !== 'json') process.stdout.write('\n');
  process.exit(result.ok ? 0 : 1);
}

// Test-only export — clears caches between unit tests.
export function __resetReadSemanticCachesForTests() {
  _repo = null;
  _liIndex = null;
  _liInitPromise = null;
  _encodeQueryFn = null;
  _appliedLiPerRoot.clear();
}

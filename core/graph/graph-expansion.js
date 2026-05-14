/**
 * Graph Expansion Module
 *
 * Expands search results by following relationship edges in the entity graph.
 * Given top-k search results, performs 1-hop (or 2-hop) traversal to include
 * related code chunks (imports, extends, implements, uses, calls).
 *
 * This helps with multi-hop coding questions where the answer spans
 * multiple related entities.
 */

// Default edge types to follow during expansion
const DEFAULT_EDGE_TYPES = new Set(['imports', 'extends', 'implements', 'uses', 'calls']);

// SQLite-variable-limit guard. Mirrors SAFE_IN_CLAUSE_BATCH in
// core/infrastructure/db-utils.js; inlined here so this module stays
// import-free (callers inject all dependencies). 2-hop expansion can in
// principle balloon to thousands of IDs when a seed entity has many
// outgoing edges; without this guard, an `IN(?,?,...)` over a >32k array
// crashes with "too many SQL variables". Fail fast at 999 with a clear
// message instead.
const _SAFE_IN_CLAUSE_BATCH = 999;
function _assertInClauseSize(n, label) {
  if (n > _SAFE_IN_CLAUSE_BATCH) {
    throw new RangeError(
      `${label}: IN(?,?,...) clause would bind ${n} parameters, exceeding ` +
      `SAFE_IN_CLAUSE_BATCH=${_SAFE_IN_CLAUSE_BATCH}. Chunk via ` +
      `chunkedIn() in core/infrastructure/db-utils.js or upstream-cap the input.`
    );
  }
}

// Per-stage profiling hooks. No-op unless `globalThis.__stageTimings` is set
// by scripts/profile-search-stages.mjs (same convention as search-hybrid.js
// and search-postprocess.js).
function __ptStart() {
  return globalThis.__stageTimings ? performance.now() : null;
}
function __ptEnd(stage, t0) {
  if (t0 == null || !globalThis.__stageTimings) return;
  const ms = performance.now() - t0;
  const buf = globalThis.__stageTimings;
  (buf[stage] = buf[stage] || []).push(ms);
}

// --- Token Estimation Helpers ---

// Language-specific tokens-per-line averages (from CodeSearchNet analysis)
const TOKENS_PER_LINE = {
  java: 15, kotlin: 14, swift: 13,
  go: 12, c: 12, cpp: 12, php: 11,
  javascript: 10, typescript: 10, jsx: 10, tsx: 10,
  ruby: 9, python: 8,
};

// Map file extensions to language keys
const EXT_TO_LANG = {
  js: 'javascript', ts: 'typescript', py: 'python', rb: 'ruby',
  kt: 'kotlin', cc: 'cpp', cxx: 'cpp', h: 'c', hpp: 'cpp', m: 'c',
};

/**
 * Estimate token count from text using whitespace splitting.
 * ±10-15% of real BPE counts, <0.1ms for typical chunks.
 */
function estimateTokenCount(text) {
  if (!text) return 0;
  return (text.match(/\S+/g) || []).length;
}

/**
 * Fallback token estimate using language-specific multipliers.
 * Much better than flat ×10 for mixed-language codebases.
 */
function fallbackTokenEstimate(result) {
  const ext = (result.file_path || result.file || result.metadata?.file || result.metadata?.path || '')
    .split('.').pop()?.toLowerCase();
  const lang = result.metadata?.language || EXT_TO_LANG[ext] || ext;
  const perLine = TOKENS_PER_LINE[lang] || 10;
  const startLine = result.start_line || result.startLine || 0;
  const endLine = result.end_line || result.endLine || startLine;
  return Math.max(1, (endLine - startLine + 1)) * perLine;
}

/**
 * Batch-load chunk texts from codebase.db vectors table.
 * Accepts either a CodebaseRepository or a raw better-sqlite3 Database (legacy).
 * @param {import('../infrastructure/codebase-repository.js').CodebaseRepository|import('better-sqlite3').Database} codebaseDbOrRepo
 * @param {string[]} ids - Vector IDs to look up
 * @returns {Map<string, string>} id → text
 */
export function loadChunkTexts(codebaseDbOrRepo, ids) {
  if (!codebaseDbOrRepo || !ids || ids.length === 0) return new Map();
  // Repository path (preferred)
  if (typeof codebaseDbOrRepo.getChunkTexts === 'function') {
    return codebaseDbOrRepo.getChunkTexts(ids);
  }
  // Legacy raw-DB path (backward compat)
  try {
    _assertInClauseSize(ids.length, 'graph-expansion.getChunkTexts');
    const ph = ids.map(() => '?').join(',');
    const rows = codebaseDbOrRepo.prepare(
      `SELECT id, text FROM vectors WHERE id IN (${ph})`
    ).all(...ids);
    return new Map(rows.map(r => [r.id, r.text]));
  } catch {
    return new Map();
  }
}

/**
 * Compute accurate token estimates for a mixed set of results.
 * Original results (from HNSW) use codebaseDb text; expanded results
 * use readFileLines (injected to keep this module import-free).
 *
 * @param {Array} results
 * @param {Object} options
 * @param {import('better-sqlite3').Database} [options.codebaseDb]
 * @param {Function} [options.readFileLines] - (filePath, startLine, endLine) => string|null
 * @returns {Map<number, number>} index → token count
 */
export function computeTokenEstimates(results, options = {}) {
  const { codebaseDb, readFileLines } = options;
  const estimates = new Map();

  const originalIds = [];
  const originalIndexes = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r.is_expanded && r.id) {
      originalIds.push(r.id);
      originalIndexes.push(i);
    } else if (r.is_expanded && readFileLines) {
      const filePath = r.file_path || r.file;
      const startLine = r.start_line || r.startLine;
      const endLine = r.end_line || r.endLine;
      if (filePath && startLine) {
        const text = readFileLines(filePath, startLine, endLine);
        if (text) {
          estimates.set(i, estimateTokenCount(text));
        }
      }
    }
  }

  // Batch-load original chunk texts from codebase.db
  const textMap = loadChunkTexts(codebaseDb, originalIds);
  for (let j = 0; j < originalIds.length; j++) {
    const text = textMap.get(originalIds[j]);
    if (text) {
      estimates.set(originalIndexes[j], estimateTokenCount(text));
    }
  }

  return estimates;
}

// Score decay per hop (graph-expanded results are less relevant than direct hits)
const HOP_DECAY = 0.6;
const HOP2_DECAY = 0.35;

// Edge priority scores for adaptive 2-hop ranking
const EDGE_PRIORITY = {
  extends: 4,
  implements: 4,
  imports: 3,
  calls: 2,
  uses: 1,
};

// PathRAG/LEGO-GraphRAG SOTA scoring constants for adaptive 2-hop
const BASE_ALPHA = 0.55;
const EDGE_ALPHA_BONUS = {
  extends: 0.25,     // effective alpha = 0.80
  implements: 0.25,  // effective alpha = 0.80
  imports: 0.10,     // effective alpha = 0.65
  calls: 0.05,       // effective alpha = 0.60
  uses: 0.00,        // effective alpha = 0.55
};
const FLOW_THRESHOLD = 0.05;

// Structural entity type boosts for reranking
const TYPE_BOOST = {
  class: 1.3,
  function: 1.2,
  method: 1.2,
  interface: 1.3,
  struct: 1.2,
};

function clampSemanticWeight(value) {
  if (!Number.isFinite(value)) return 0.4;
  return Math.max(0, Math.min(1, value));
}

function normalizeMinMax(values) {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map(v => (v - min) / (max - min));
}

function blendScores(graphScore, cosineSim, weight) {
  return (1 - weight) * graphScore + weight * cosineSim;
}

/**
 * Expand search results using the entity relationship graph.
 *
 * @param {import('better-sqlite3').Database} db - The code graph database
 * @param {Array} results - Initial search results with entity IDs
 * @param {Object} options
 * @param {string} options.expandMode - 'none' | '1hop' | '2hop'
 * @param {number} options.maxExpanded - Max expanded results to add
 * @param {number} options.tokenBudget - Max total tokens in expanded set
 * @param {Set<string>} options.edgeTypes - Relationship types to follow
 * @returns {Array} Expanded and reranked results
 */
export function expandResults(db, results, options = {}) {
  const {
    expandMode = '1hop',
    maxExpanded = 10,
    tokenBudget = 8000,
    edgeTypes = DEFAULT_EDGE_TYPES,
    adaptiveHop2 = false,
    hop2TokenBudget = 4000,
    expandedBudget,
    queryInt8 = null,
    hnswIndex = null,
    semanticWeight = 0.4,
    cosineSimilarity = null,
    codebaseDb = null,
    readFileLines = null,
    format = null,
  } = options;
  // F1 envelope cap (2026-05-07): drop graph-expanded entities whose line span
  // exceeds maxEnvelopeLines. The taxonomy diagnosed mega-class envelopes
  // (Flask App 951L, Scaffold 646L, uv do_lock 555L) as the #1 failure mode —
  // these are pulled from the entity DB by graph expansion, not the chunker.
  // Capped here so the seed chunks (30-60 lines each) keep the top spot.
  //
  // Format-gated to agent: GCSN NL queries don't carry format='agent' so are
  // unaffected. Cap default 500 was selected by dev sweep over {Inf, 500, 300,
  // 200, 150, 100}: cap=500 was the only value with zero regressions on
  // FreshStack uv (lower caps regressed PASS counts). Yields +1 probe PASS
  // (S5-Q9 Flask Scaffold class) and +1 FreshStack PARTIAL (UV-NL-2 do_lock).
  // Held-out probes flat — no overfit signature, but also no held-out transfer
  // since the failure mode (mega-class envelope) isn't present in held-out.
  const maxEnvelopeLines = (() => {
    const raw = process.env.SWEET_SEARCH_MAX_ENVELOPE_LINES;
    if (raw != null && raw !== '') {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return options.maxEnvelopeLines ?? 500;
  })();
  const isAgentFormat = format === 'agent' || format === 'agent_full'
    || format === 'agent_full_xl' || format === 'agent_preview'
    || process.env.SWEET_SEARCH_FORCE_BM25F_BOOSTS === '1';
  const envelopeCapEnabled = isAgentFormat && Number.isFinite(maxEnvelopeLines);
  const clampedSemanticWeight = clampSemanticWeight(semanticWeight);

  if (expandMode === 'none' || results.length === 0) return results;

  // Collect entity IDs from results
  const __t_seeds = __ptStart();
  const seedIds = collectSeedIds(db, results);
  __ptEnd('expand:collectSeedIds', __t_seeds);
  if (seedIds.size === 0) return results;

  // 1-hop expansion: find neighbors via forward + reverse edges
  const __t_hop1 = __ptStart();
  const expanded = expandOneHop(db, seedIds, edgeTypes);
  __ptEnd('expand:expandOneHop', __t_hop1);

  // 2-hop expansion (if requested)
  if (expandMode === '2hop' && expanded.size > 0) {
    const __t_hop2 = __ptStart();
    if (adaptiveHop2) {
      expandSecondHopAdaptive(db, seedIds, expanded, edgeTypes, {
        maxHop2: maxExpanded,
        tokenBudget: hop2TokenBudget,
        queryInt8,
        hnswIndex,
        semanticWeight: clampedSemanticWeight,
        cosineSimilarity,
      });
    } else {
      expandSecondHop(db, seedIds, expanded, edgeTypes, {
        queryInt8,
        hnswIndex,
        semanticWeight: clampedSemanticWeight,
        cosineSimilarity,
      });
    }
    __ptEnd(adaptiveHop2 ? 'expand:expandSecondHopAdaptive' : 'expand:expandSecondHop', __t_hop2);
  }

  if (expanded.size === 0) return results;

  // Look up entity details for expanded IDs, respecting maxExpanded
  const expandedIds = [...expanded.keys()].slice(0, maxExpanded);
  const __t_lookup = __ptStart();
  let expandedResults = lookupEntities(db, expandedIds, expanded);
  __ptEnd('expand:lookupEntities', __t_lookup);

  // F1 envelope cap: drop expanded entities exceeding line cap (agent format only).
  if (envelopeCapEnabled && expandedResults.length > 0) {
    const beforeLen = expandedResults.length;
    expandedResults = expandedResults.filter(er => {
      const lines = (er.endLine - er.startLine) + 1;
      return Number.isFinite(lines) && lines <= maxEnvelopeLines;
    });
    if (process.env.SWEET_SEARCH_DEBUG_ENVELOPE_CAP === '1' && expandedResults.length < beforeLen) {
      console.warn(`[envelope-cap] dropped ${beforeLen - expandedResults.length}/${beforeLen} expanded entities (cap=${maxEnvelopeLines})`);
    }
  }

  // Score expanded results relative to original results
  const maxOriginalScore = Math.max(...results.map(r => r.score || 0), 1);
  for (const er of expandedResults) {
    const hops = er.expansion?.hops || 1;
    const decay = er.expansion?.decay || (hops === 1 ? HOP_DECAY : HOP2_DECAY);
    er.score = maxOriginalScore * decay;
  }

  // Rerank expanded results using composite scoring (file proximity + entity type + semantic)
  const __t_rerank = __ptStart();
  rerankExpanded(expandedResults, results, {
    queryInt8,
    hnswIndex,
    semanticWeight: clampedSemanticWeight,
    cosineSimilarity,
  });
  __ptEnd('expand:rerankExpanded', __t_rerank);

  // Apply token budget
  const __t_budget = __ptStart();
  const { results: budgeted, stats: budgetStats } = applyTokenBudget(
    [...results, ...expandedResults], tokenBudget,
    { expandedBudget, codebaseDb, readFileLines }
  );
  __ptEnd('expand:applyTokenBudget', __t_budget);

  budgeted._budgetStats = budgetStats;
  return budgeted;
}

/**
 * Collect entity IDs from search results.
 * Tries entity_id from metadata, then falls back to file_path + line range matching.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Array} results
 * @returns {Set<string>}
 */
function collectSeedIds(db, results) {
  const seedIds = new Set();
  const needsLineMatch = [];

  // Distinguish chunk ids from entity ids by shape: chunk ids look like
  // `path/to/file.ext:start-end:n` (always contain `:`), entity ids are
  // hex hashes / opaque tokens that never contain `:`. Treating chunk ids
  // as entity ids feeds them into the relationships SQL and yields zero
  // neighbours — which silently disabled graph expansion on HNSW results.
  const looksLikeEntityId = (s) => typeof s === 'string' && !s.includes(':');

  for (const r of results) {
    if (r.entity_id) seedIds.add(r.entity_id);
    else if (r.metadata?.entity_id) seedIds.add(r.metadata.entity_id);
    else if (r.is_expanded && r.id) seedIds.add(r.id);
    else if (r.id && looksLikeEntityId(r.id)) seedIds.add(r.id);
    else needsLineMatch.push(r);
  }

  if (needsLineMatch.length === 0) return seedIds;

  // Per-result indexed point query. Hybrid output is keyed on chunk-ids
  // (path:start-end:n), so this fallback is the COMMON path for graph
  // expansion, not a rare one. The original implementation did a full
  // SELECT * FROM entities and then an O(N×M) JS-side scan to find the
  // smallest overlapping entity per result — costing ~11ms p50 on
  // production-sized indexes (10 results × 100k+ entities = 1M JS-side
  // comparisons + materialization GC). Replaced with a single prepared
  // statement that uses the (file_path, start_line, end_line) index for
  // O(log N) lookup. Reuses the same prepared statement across all
  // needsLineMatch results in one collectSeedIds call.
  let findStmt;
  try {
    findStmt = db.prepare(`
      SELECT id FROM entities
      WHERE file_path = ?
        AND start_line <= ?
        AND end_line >= ?
        AND stale_since IS NULL
      ORDER BY (end_line - start_line) ASC
      LIMIT 1
    `);
  } catch {
    return seedIds;
  }

  // Chunk-id pattern: `path/to/file.ext:<start>-<end>:<n>`. When metadata
  // doesn't carry file_path / line numbers (older indexes can be sparse),
  // parse them out of the id itself.
  const parseChunkId = (id) => {
    if (typeof id !== 'string' || !id.includes(':')) return null;
    const m = id.match(/^(.+):(\d+)-(\d+):(\d+)$/);
    if (!m) return null;
    return { file: m[1], startLine: parseInt(m[2], 10), endLine: parseInt(m[3], 10) };
  };

  for (const r of needsLineMatch) {
    let filePath = r.file_path || r.file || r.metadata?.file || r.metadata?.path;
    let lineStart = r.start_line || r.startLine
      || r.metadata?.line_start || r.metadata?.startLine || r.metadata?.start_line;
    let lineEnd = r.end_line || r.endLine
      || r.metadata?.line_end || r.metadata?.endLine || r.metadata?.end_line;
    if (!filePath || lineStart == null || lineEnd == null) {
      const parsed = parseChunkId(r.id);
      if (parsed) {
        filePath = filePath || parsed.file;
        lineStart = lineStart ?? parsed.startLine;
        lineEnd = lineEnd ?? parsed.endLine;
      }
    }
    if (!filePath || lineStart == null) continue;
    if (lineEnd == null) lineEnd = lineStart;

    // Smallest enclosing/overlapping entity wins (functions/methods over
    // file-level containers). The SQL ORDER BY (end_line - start_line) ASC
    // matches the JS `bestSize` selection in the prior implementation
    // exactly: same overlap predicate, same tie-breaker.
    try {
      const row = findStmt.get(filePath, lineEnd, lineStart);
      if (row?.id) seedIds.add(row.id);
    } catch {
      // Skip this result; preserves prior behavior of silently dropping
      // entries the lookup couldn't match.
    }
  }

  return seedIds;
}

/**
 * Perform 1-hop graph expansion from seed entity IDs.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Set<string>} seedIds
 * @param {Set<string>} edgeTypes
 * @returns {Map<string, {via: string, direction: string, score: number, hops?: number}>}
 */
export function expandOneHop(db, seedIds, edgeTypes) {
  const expanded = new Map();
  const seedArray = [...seedIds];
  _assertInClauseSize(seedArray.length, 'graph-expansion.expandOneHop.seeds');
  const placeholders = seedArray.map(() => '?').join(',');

  // Forward edges: seed -> neighbor
  let forwardRels;
  try {
    forwardRels = db.prepare(`
      SELECT DISTINCT target_id, type FROM relationships
      WHERE source_id IN (${placeholders}) AND target_id IS NOT NULL
    `).all(...seedArray);
  } catch {
    forwardRels = [];
  }

  // Reverse edges: neighbor -> seed
  let reverseRels;
  try {
    reverseRels = db.prepare(`
      SELECT DISTINCT source_id, type FROM relationships
      WHERE target_id IN (${placeholders}) AND source_id IS NOT NULL
    `).all(...seedArray);
  } catch {
    reverseRels = [];
  }

  for (const { rels, idField, direction } of [
    { rels: forwardRels, idField: 'target_id', direction: 'forward' },
    { rels: reverseRels, idField: 'source_id', direction: 'reverse' },
  ]) {
    for (const rel of rels) {
      const neighborId = rel[idField];
      if (edgeTypes.has(rel.type) && !seedIds.has(neighborId)) {
        const effectiveAlpha = BASE_ALPHA + (EDGE_ALPHA_BONUS[rel.type] || 0);
        const score = effectiveAlpha;
        const existing = expanded.get(neighborId);
        if (!existing || score > existing.score) {
          expanded.set(neighborId, { via: rel.type, direction, score });
        }
      }
    }
  }

  return expanded;
}

/**
 * Perform 2nd-hop expansion from the 1-hop neighbors.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Set<string>} seedIds - Original seeds
 * @param {Map<string, Object>} expanded - 1-hop expansion map (mutated in place)
 * @param {Set<string>} edgeTypes
 */
export function expandSecondHop(db, seedIds, expanded, edgeTypes, options = {}) {
  const {
    queryInt8 = null,
    hnswIndex = null,
    semanticWeight = 0.4,
    cosineSimilarity = null,
  } = options;
  const semanticEnabled = !!(queryInt8 && hnswIndex && cosineSimilarity && semanticWeight > 0);

  const hop1Ids = [...expanded.keys()];
  if (hop1Ids.length === 0) return;
  _assertInClauseSize(hop1Ids.length, 'graph-expansion.expand2Hop.forward');

  const ph = hop1Ids.map(() => '?').join(',');

  let hop2Forward;
  try {
    hop2Forward = db.prepare(`
      SELECT source_id, target_id, type FROM relationships
      WHERE source_id IN (${ph}) AND target_id IS NOT NULL
    `).all(...hop1Ids);
  } catch {
    return;
  }

  if (!semanticEnabled) {
    for (const rel of hop2Forward) {
      if (edgeTypes.has(rel.type) && !seedIds.has(rel.target_id) && !expanded.has(rel.target_id)) {
        expanded.set(rel.target_id, { via: rel.type, direction: 'forward', hops: 2 });
      }
    }
    return;
  }

  const excluded = new Set([...seedIds, ...expanded.keys()]);
  const candidates = [];
  for (const rel of hop2Forward) {
    if (!edgeTypes.has(rel.type) || excluded.has(rel.target_id)) continue;

    const hop1Entry = expanded.get(rel.source_id);
    const hop1Score = hop1Entry?.score ?? 1;  // identity: preserves old edgePriority × weight
    const graphScore = hop1Score * (EDGE_PRIORITY[rel.type] || 1) * (rel.weight || 1.0);
    let normSim = null;
    const entityInt8 = hnswIndex.getInt8Vector(rel.target_id);
    if (entityInt8) {
      const cosSim = cosineSimilarity(queryInt8, entityInt8);
      normSim = (cosSim + 1) / 2;
    }
    candidates.push({ rel, graphScore, normSim });
  }

  if (candidates.length === 0) return;
  const normalizedGraphScores = normalizeMinMax(candidates.map(c => c.graphScore));
  const bestByTarget = new Map();

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const normGraph = normalizedGraphScores[i];
    let score = normGraph;
    if (c.normSim != null) {
      score = blendScores(normGraph, c.normSim, semanticWeight);
    }

    const prev = bestByTarget.get(c.rel.target_id);
    if (!prev || score > prev.score) {
      bestByTarget.set(c.rel.target_id, { rel: c.rel, score });
    }
  }

  const ranked = [...bestByTarget.values()].sort((a, b) => b.score - a.score);
  for (const c of ranked) {
    expanded.set(c.rel.target_id, {
      via: c.rel.type,
      direction: 'forward',
      hops: 2,
    });
  }
}

/**
 * Perform adaptive 2nd-hop expansion with per-edge-type alpha decay,
 * degree normalization, and flow-based early stopping (PathRAG-style).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Set<string>} seedIds - Original seed entity IDs
 * @param {Map<string, Object>} hop1Expanded - 1-hop expansion map (mutated in place)
 * @param {Set<string>} edgeTypes - Allowed edge types
 * @param {Object} options
 * @param {number} options.maxHop2 - Max 2-hop entities to add
 * @param {number} options.tokenBudget - Token budget for 2-hop expansion
 * @returns {{ added: number, budgetUsed: number, candidates: number }}
 */
export function expandSecondHopAdaptive(db, seedIds, hop1Expanded, edgeTypes, options = {}) {
  const {
    maxHop2 = 5,
    tokenBudget = 4000,
    queryInt8 = null,
    hnswIndex = null,
    semanticWeight = 0.4,
    cosineSimilarity = null,
  } = options;
  const semanticEnabled = !!(queryInt8 && hnswIndex && cosineSimilarity && semanticWeight > 0);

  const hop1Ids = [...hop1Expanded.keys()];
  if (hop1Ids.length === 0) return { added: 0, budgetUsed: 0, candidates: 0 };
  _assertInClauseSize(hop1Ids.length, 'graph-expansion.expand2HopRanked.hop1');

  const ph = hop1Ids.map(() => '?').join(',');

  // Query out-degrees for hop-1 nodes, filtered to active edge types only.
  // Counting all edge types would over-penalize nodes with many irrelevant edges.
  // Safety: edgeTypes is always code-controlled (DEFAULT_EDGE_TYPES or intent policy
  // constants). Not parameterized because better-sqlite3 doesn't support mixing
  // positional params across two IN clauses cleanly. Never pass user input here.
  const typeList = [...edgeTypes].map(t => `'${t}'`).join(',');
  let degreeMap;
  try {
    const degRows = db.prepare(`
      SELECT source_id, COUNT(*) as deg FROM relationships
      WHERE source_id IN (${ph}) AND type IN (${typeList})
      GROUP BY source_id
    `).all(...hop1Ids);
    degreeMap = new Map(degRows.map(r => [r.source_id, r.deg]));
  } catch {
    degreeMap = new Map();
  }

  // Query candidate 2-hop targets with source, weights, and line ranges
  let rawCandidates;
  try {
    rawCandidates = db.prepare(`
      SELECT r.source_id, r.target_id, r.type, r.weight, e.file_path, e.start_line, e.end_line
      FROM relationships r
      JOIN entities e ON e.id = r.target_id AND e.stale_since IS NULL
      WHERE r.source_id IN (${ph}) AND r.target_id IS NOT NULL
    `).all(...hop1Ids);
  } catch {
    return { added: 0, budgetUsed: 0, candidates: 0 };
  }

  // Filter by edge types and score all paths.
  const excluded = new Set([...seedIds, ...hop1Expanded.keys()]);
  const vectorCache = semanticEnabled ? new Map() : null;
  const scoredCandidates = [];

  for (const c of rawCandidates) {
    if (!edgeTypes.has(c.type) || excluded.has(c.target_id)) continue;

    const effectiveAlpha = BASE_ALPHA + (EDGE_ALPHA_BONUS[c.type] || 0);
    const edgePriority = EDGE_PRIORITY[c.type] || 1;
    const weight = c.weight || 1.0;
    const outDegree = degreeMap.get(c.source_id) || 1;
    const hop1Entry = hop1Expanded.get(c.source_id);
    const hop1Score = hop1Entry?.score ?? effectiveAlpha;
    const graphScore = (hop1Score * effectiveAlpha * weight * edgePriority) / Math.sqrt(outDegree);

    let normSim = null;
    if (semanticEnabled) {
      if (!vectorCache.has(c.target_id)) {
        vectorCache.set(c.target_id, hnswIndex.getInt8Vector(c.target_id));
      }
      const entityInt8 = vectorCache.get(c.target_id);
      if (entityInt8) {
        const cosSim = cosineSimilarity(queryInt8, entityInt8);
        normSim = (cosSim + 1) / 2;
      }
    }

    const estimatedTokens = fallbackTokenEstimate({
      file_path: c.file_path,
      start_line: c.start_line,
      end_line: c.end_line,
    });

    scoredCandidates.push({
      target_id: c.target_id,
      source_id: c.source_id,
      type: c.type,
      graphScore,
      normSim,
      estimatedTokens,
      effectiveAlpha,
      outDegree,
    });
  }

  if (scoredCandidates.length === 0) return { added: 0, budgetUsed: 0, candidates: 0 };

  const normalizedGraphScores = semanticEnabled
    ? normalizeMinMax(scoredCandidates.map(c => c.graphScore))
    : [];

  // Multiple hop-1 sources may reach the same target — keep the highest score.
  const bestByTarget = new Map(); // target_id -> best scored entry
  for (let i = 0; i < scoredCandidates.length; i++) {
    const c = scoredCandidates[i];
    let score = c.graphScore;

    if (semanticEnabled) {
      const normGraph = normalizedGraphScores[i];
      score = normGraph;
      if (c.normSim != null) {
        score = blendScores(normGraph, c.normSim, semanticWeight);
      }
    }

    // PathRAG-style early stopping
    if (score < FLOW_THRESHOLD) continue;

    const prev = bestByTarget.get(c.target_id);
    if (prev && prev.score >= score) continue;
    bestByTarget.set(c.target_id, { ...c, score });
  }

  const scored = [...bestByTarget.values()];

  // Sort by composite score descending
  scored.sort((a, b) => b.score - a.score);

  // Greedily select candidates within token budget and maxHop2 limit
  let budgetUsed = 0;
  let count = 0;

  for (const s of scored) {
    if (count >= maxHop2) break;
    if (budgetUsed + s.estimatedTokens > tokenBudget && count > 0) break;

    const decay = s.effectiveAlpha * s.effectiveAlpha;

    hop1Expanded.set(s.target_id, {
      via: s.type,
      direction: 'forward',
      hops: 2,
      adaptiveScore: s.score,
      decay,
      sourceOutDegree: s.outDegree,
    });

    budgetUsed += s.estimatedTokens;
    count++;
  }

  return { added: count, budgetUsed, candidates: scored.length };
}

/**
 * Look up entity details for expanded IDs.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} expandedIds
 * @param {Map<string, Object>} expansionMeta
 * @returns {Array}
 */
function lookupEntities(db, expandedIds, expansionMeta) {
  if (expandedIds.length === 0) return [];
  _assertInClauseSize(expandedIds.length, 'graph-expansion.lookupEntities');

  const ph = expandedIds.map(() => '?').join(',');
  let entities;
  try {
    entities = db.prepare(`
      SELECT id, file_path, type, name, signature, start_line, end_line
      FROM entities WHERE id IN (${ph}) AND stale_since IS NULL
    `).all(...expandedIds);
  } catch {
    return [];
  }

  return entities.map(e => ({
    entity_id: e.id,
    id: e.id,
    file_path: e.file_path,
    file: e.file_path,
    name: e.name,
    type: e.type,
    signature: e.signature,
    startLine: e.start_line,
    endLine: e.end_line,
    start_line: e.start_line,
    end_line: e.end_line,
    expansion: expansionMeta.get(e.id),
    score: 0,
    is_expanded: true,
  }));
}

/**
 * Rerank expanded results using a composite score that combines the
 * decay-based score with file proximity and entity type relevance.
 *
 * Score factors:
 * 1. Decay score (already assigned by the caller)
 * 2. File proximity: entities in the same file as a seed result get a 1.5x boost
 * 3. Entity type relevance: structural types (class, interface, function, method, struct)
 *    receive a multiplicative boost (1.2-1.3x)
 *
 * Mutates `expandedResults` in place: updates `.score` and re-sorts descending.
 *
 * @param {Array} expandedResults - Expanded results with scores already assigned
 * @param {Array} seedResults - Original seed results (used to determine file proximity)
 * @returns {Array} The same array, sorted by reranked score descending
 */
export function rerankExpanded(expandedResults, seedResults, options = {}) {
  const {
    queryInt8 = null,
    hnswIndex = null,
    semanticWeight = 0.4,
    cosineSimilarity = null,
  } = options;
  const clampedSemanticWeight = clampSemanticWeight(semanticWeight);
  const semanticEnabled = !!(queryInt8 && hnswIndex && cosineSimilarity && clampedSemanticWeight > 0);

  if (expandedResults.length === 0) return expandedResults;

  const seedFiles = new Set(
    seedResults.map(r => r.file_path || r.file || r.metadata?.path).filter(Boolean)
  );

  const baseScores = [];

  for (const er of expandedResults) {
    let rerankScore = er.score || 0;

    // File proximity boost: entities in same file as seeds are more relevant
    const erFile = er.file_path || er.file || er.metadata?.path;
    if (erFile && seedFiles.has(erFile)) {
      rerankScore *= 1.5;
    }

    // Entity type relevance: structural entities are more valuable
    const entType = er.type || er.metadata?.chunk_type;
    if (TYPE_BOOST[entType]) {
      rerankScore *= TYPE_BOOST[entType];
    }

    baseScores.push(rerankScore);
  }

  if (!semanticEnabled) {
    for (let i = 0; i < expandedResults.length; i++) {
      expandedResults[i].score = baseScores[i];
    }
  } else {
    const normalizedGraphScores = normalizeMinMax(baseScores);
    for (let i = 0; i < expandedResults.length; i++) {
      const er = expandedResults[i];
      const normGraph = normalizedGraphScores[i];
      let rerankScore = normGraph;
      const entityId = er.entity_id || er.id;
      const entityInt8 = hnswIndex.getInt8Vector(entityId);
      if (entityInt8) {
        const cosSim = cosineSimilarity(queryInt8, entityInt8);
        const normSim = (cosSim + 1) / 2;
        rerankScore = blendScores(normGraph, normSim, clampedSemanticWeight);
      }
      er.score = rerankScore;
    }
  }

  // Re-sort by reranked score descending
  expandedResults.sort((a, b) => (b.score || 0) - (a.score || 0));
  return expandedResults;
}

/**
 * Apply token budget to limit total result set size.
 * Uses accurate token counts from chunk text when available,
 * falls back to language-specific per-line multipliers.
 *
 * @param {Array} results
 * @param {number} budget - Total token budget
 * @param {Object} [options]
 * @param {number} [options.expandedBudget] - Separate budget for expanded results
 * @param {import('better-sqlite3').Database} [options.codebaseDb] - For chunk text lookup
 * @param {Function} [options.readFileLines] - For expanded result text lookup
 * @returns {{ results: Array, stats: { original: Object, hop1: Object, hop2: Object, total: Object } }}
 */
export function applyTokenBudget(results, budget, options = {}) {
  const { expandedBudget, codebaseDb, readFileLines } = options;

  // Pre-compute accurate token estimates when data sources are available
  const tokenEstimates = (codebaseDb || readFileLines)
    ? computeTokenEstimates(results, { codebaseDb, readFileLines })
    : new Map();

  let totalTokens = 0;
  let expandedTokens = 0;
  const budgeted = [];
  const stats = {
    original: { count: 0, tokens: 0 },
    hop1: { count: 0, tokens: 0 },
    hop2: { count: 0, tokens: 0 },
    total: { count: 0, tokens: 0 },
  };

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    // Use accurate estimate if available, otherwise fall back to per-language heuristic
    const accurate = tokenEstimates.get(i);
    const estimatedTokens = (accurate != null && accurate > 0) ? accurate : fallbackTokenEstimate(r);
    const isExpanded = !!r.is_expanded;
    const hops = r.expansion?.hops || (isExpanded ? 1 : 0);

    // Check total budget (always include at least one result)
    if (totalTokens + estimatedTokens > budget && budgeted.length > 0) break;

    // Check expanded-specific budget
    if (isExpanded && expandedBudget != null && expandedTokens + estimatedTokens > expandedBudget) {
      continue;
    }

    totalTokens += estimatedTokens;
    if (isExpanded) expandedTokens += estimatedTokens;
    budgeted.push(r);

    // Track per-category stats
    if (!isExpanded) {
      stats.original.count++;
      stats.original.tokens += estimatedTokens;
    } else if (hops === 2) {
      stats.hop2.count++;
      stats.hop2.tokens += estimatedTokens;
    } else {
      stats.hop1.count++;
      stats.hop1.tokens += estimatedTokens;
    }
  }

  stats.total = { count: budgeted.length, tokens: totalTokens };
  return { results: budgeted, stats };
}

/**
 * Get expansion statistics for a set of entities.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} entityIds
 * @returns {{ total: number, byType: Record<string, number> }}
 */
export function getExpansionStats(db, entityIds) {
  if (!entityIds || entityIds.length === 0) return { total: 0, byType: {} };
  _assertInClauseSize(entityIds.length, 'graph-expansion.getExpansionStats');

  const ph = entityIds.map(() => '?').join(',');
  let rels;
  try {
    rels = db.prepare(`
      SELECT type, COUNT(*) as count FROM relationships
      WHERE (source_id IN (${ph}) OR target_id IN (${ph}))
      AND source_id IS NOT NULL AND target_id IS NOT NULL
      GROUP BY type
    `).all(...entityIds, ...entityIds);
  } catch {
    return { total: 0, byType: {} };
  }

  const byType = {};
  let total = 0;
  for (const r of rels) {
    byType[r.type] = r.count;
    total += r.count;
  }

  return { total, byType };
}

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
    priorityEdges = ['extends', 'implements'],
    expandedBudget,
  } = options;

  if (expandMode === 'none' || results.length === 0) return results;

  // Collect entity IDs from results
  const seedIds = collectSeedIds(db, results);
  if (seedIds.size === 0) return results;

  // 1-hop expansion: find neighbors via forward + reverse edges
  const expanded = expandOneHop(db, seedIds, edgeTypes);

  // 2-hop expansion (if requested)
  if (expandMode === '2hop' && expanded.size > 0) {
    if (adaptiveHop2) {
      expandSecondHopAdaptive(db, seedIds, expanded, edgeTypes, {
        maxHop2: maxExpanded,
        tokenBudget: hop2TokenBudget,
        priorityEdges,
      });
    } else {
      expandSecondHop(db, seedIds, expanded, edgeTypes);
    }
  }

  if (expanded.size === 0) return results;

  // Look up entity details for expanded IDs, respecting maxExpanded
  const expandedIds = [...expanded.keys()].slice(0, maxExpanded);
  const expandedResults = lookupEntities(db, expandedIds, expanded);

  // Score expanded results relative to original results
  const maxOriginalScore = Math.max(...results.map(r => r.score || 0), 1);
  for (const er of expandedResults) {
    const hops = er.expansion?.hops || 1;
    const decay = er.expansion?.decay || (hops === 1 ? HOP_DECAY : HOP2_DECAY);
    er.score = maxOriginalScore * decay;
  }

  // Rerank expanded results using composite scoring (file proximity + entity type)
  rerankExpanded(expandedResults, results);

  // Apply token budget
  const { results: budgeted, stats: budgetStats } = applyTokenBudget(
    [...results, ...expandedResults], tokenBudget, { expandedBudget }
  );

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

  for (const r of results) {
    if (r.entity_id) seedIds.add(r.entity_id);
    else if (r.metadata?.entity_id) seedIds.add(r.metadata.entity_id);
    else if (r.id) seedIds.add(r.id);
  }

  if (seedIds.size > 0) return seedIds;

  // Fallback: match results to entities by file_path + line range
  let entityLookup;
  try {
    entityLookup = db.prepare(`
      SELECT id, file_path, start_line, end_line
      FROM entities WHERE stale_since IS NULL
    `).all();
  } catch {
    return seedIds;
  }

  for (const r of results) {
    const filePath = r.file_path || r.file || r.metadata?.file || r.metadata?.path;
    const lineStart = r.start_line || r.startLine || r.metadata?.line_start || r.metadata?.startLine;
    if (!filePath) continue;

    for (const e of entityLookup) {
      if (e.file_path === filePath && e.start_line != null && lineStart != null &&
          e.start_line <= lineStart && e.end_line >= lineStart) {
        seedIds.add(e.id);
        break;
      }
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
 * @returns {Map<string, {via: string, direction: string, hops?: number}>}
 */
function expandOneHop(db, seedIds, edgeTypes) {
  const expanded = new Map();
  const seedArray = [...seedIds];
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

  for (const rel of forwardRels) {
    if (edgeTypes.has(rel.type) && !seedIds.has(rel.target_id)) {
      expanded.set(rel.target_id, { via: rel.type, direction: 'forward' });
    }
  }

  for (const rel of reverseRels) {
    if (edgeTypes.has(rel.type) && !seedIds.has(rel.source_id)) {
      expanded.set(rel.source_id, { via: rel.type, direction: 'reverse' });
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
function expandSecondHop(db, seedIds, expanded, edgeTypes) {
  const hop1Ids = [...expanded.keys()];
  if (hop1Ids.length === 0) return;

  const ph = hop1Ids.map(() => '?').join(',');

  let hop2Forward;
  try {
    hop2Forward = db.prepare(`
      SELECT DISTINCT target_id, type FROM relationships
      WHERE source_id IN (${ph}) AND target_id IS NOT NULL
    `).all(...hop1Ids);
  } catch {
    return;
  }

  for (const rel of hop2Forward) {
    if (edgeTypes.has(rel.type) && !seedIds.has(rel.target_id) && !expanded.has(rel.target_id)) {
      expanded.set(rel.target_id, { via: rel.type, direction: 'forward', hops: 2 });
    }
  }
}

/**
 * Perform adaptive 2nd-hop expansion with priority-based edge ranking,
 * token budget tracking, and score decay modulation.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Set<string>} seedIds - Original seed entity IDs
 * @param {Map<string, Object>} hop1Expanded - 1-hop expansion map (mutated in place)
 * @param {Set<string>} edgeTypes - Allowed edge types
 * @param {Object} options
 * @param {number} options.maxHop2 - Max 2-hop entities to add
 * @param {number} options.tokenBudget - Token budget for 2-hop expansion
 * @param {string[]} options.priorityEdges - Edge types to prioritize
 * @returns {{ added: number, budgetUsed: number, candidates: number }}
 */
function expandSecondHopAdaptive(db, seedIds, hop1Expanded, edgeTypes, options = {}) {
  const { maxHop2 = 5, tokenBudget = 4000, priorityEdges = ['extends', 'implements'] } = options;

  const hop1Ids = [...hop1Expanded.keys()];
  if (hop1Ids.length === 0) return { added: 0, budgetUsed: 0, candidates: 0 };

  const ph = hop1Ids.map(() => '?').join(',');
  const prioritySet = new Set(priorityEdges);

  // Query candidate 2-hop targets with weights and line ranges
  let rawCandidates;
  try {
    rawCandidates = db.prepare(`
      SELECT r.target_id, r.type, r.weight, e.start_line, e.end_line
      FROM relationships r
      JOIN entities e ON e.id = r.target_id AND e.stale_since IS NULL
      WHERE r.source_id IN (${ph}) AND r.target_id IS NOT NULL
    `).all(...hop1Ids);
  } catch {
    return { added: 0, budgetUsed: 0, candidates: 0 };
  }

  // Filter by edge types, dedup against seeds + 1-hop + within candidates
  const seen = new Set([...seedIds, ...hop1Expanded.keys()]);
  const scored = [];

  for (const c of rawCandidates) {
    if (!edgeTypes.has(c.type) || seen.has(c.target_id)) continue;
    seen.add(c.target_id);

    const priority = EDGE_PRIORITY[c.type] || 1;
    const weight = c.weight || 1.0;
    const score = priority * weight;
    const startLine = c.start_line || 0;
    const endLine = c.end_line || startLine;
    const estimatedTokens = Math.max(1, (endLine - startLine + 1)) * 10;

    scored.push({
      target_id: c.target_id,
      type: c.type,
      score,
      estimatedTokens,
      isPriority: prioritySet.has(c.type),
    });
  }

  // Sort by composite score descending
  scored.sort((a, b) => b.score - a.score);

  // Greedily select candidates within token budget and maxHop2 limit
  let budgetUsed = 0;
  let count = 0;

  for (const s of scored) {
    if (count >= maxHop2) break;
    if (budgetUsed + s.estimatedTokens > tokenBudget && count > 0) break;

    const decay = s.isPriority ? 0.45 : 0.25;

    hop1Expanded.set(s.target_id, {
      via: s.type,
      direction: 'forward',
      hops: 2,
      adaptiveScore: s.score,
      decay,
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
export function rerankExpanded(expandedResults, seedResults) {
  if (expandedResults.length === 0) return expandedResults;

  const seedFiles = new Set(
    seedResults.map(r => r.file_path || r.file || r.metadata?.path).filter(Boolean)
  );

  const TYPE_BOOST = {
    class: 1.3,
    function: 1.2,
    method: 1.2,
    interface: 1.3,
    struct: 1.2,
  };

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

    er.score = rerankScore;
  }

  // Re-sort by reranked score descending
  expandedResults.sort((a, b) => (b.score || 0) - (a.score || 0));
  return expandedResults;
}

/**
 * Apply token budget to limit total result set size.
 * Estimates tokens from line ranges. Tracks per-category consumption.
 *
 * @param {Array} results
 * @param {number} budget - Total token budget
 * @param {Object} [options]
 * @param {number} [options.expandedBudget] - Separate budget for expanded results
 * @returns {{ results: Array, stats: { original: Object, hop1: Object, hop2: Object, total: Object } }}
 */
export function applyTokenBudget(results, budget, options = {}) {
  const { expandedBudget } = options;
  let totalTokens = 0;
  let expandedTokens = 0;
  const budgeted = [];
  const stats = {
    original: { count: 0, tokens: 0 },
    hop1: { count: 0, tokens: 0 },
    hop2: { count: 0, tokens: 0 },
    total: { count: 0, tokens: 0 },
  };

  for (const r of results) {
    const startLine = r.start_line || r.startLine || 0;
    const endLine = r.end_line || r.endLine || startLine;
    // Rough estimate: ~10 tokens per line
    const estimatedTokens = Math.max(1, (endLine - startLine + 1)) * 10;
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

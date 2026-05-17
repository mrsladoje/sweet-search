/**
 * Repository Map Generator
 *
 * Builds a token-budget-constrained repo map by running PageRank on the
 * entity/relationship graph stored in SQLite. Inspired by Aider's repo map
 * approach but powered by Sweet Search's existing knowledge graph.
 *
 * Algorithm:
 * 1. Load entities + relationships from code-graph.db
 * 2. Build adjacency list, run PageRank (power iteration)
 * 3. Rank entities by score, group by file
 * 4. Binary search to fit within token budget
 * 5. Output condensed map: file → ranked symbols with signatures
 */

import Database from 'better-sqlite3';
import path from 'path';
import { DB_PATHS } from '../infrastructure/config/index.js';
import { applyReadPragmas } from '../infrastructure/db-utils.js';
import {
  createCodeGraphVisibility,
  entityVisibilityParams,
  entityVisibilitySql,
  readAdjacentManifest,
  readAdjacentManifestEpoch,
  relationshipVisibilityParams,
  relationshipVisibilitySql,
  resolveManifestCodeGraphPath,
} from '../infrastructure/code-graph-visibility.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TOKEN_BUDGET = 1024;
const DEFAULT_DAMPING = 0.85;
const DEFAULT_ITERATIONS = 20;
const CONVERGENCE_THRESHOLD = 1e-6;
// Rough chars-per-token estimate (conservative for code)
const CHARS_PER_TOKEN = 3.5;

// Entity types worth showing in the repo map (skip trivial ones)
const DISPLAY_ENTITY_TYPES = new Set([
  'class', 'function', 'method', 'interface', 'enum', 'struct',
  'trait', 'typeAlias', 'namespace', 'component', 'arrowFunction',
  'const', 'type', 'module', 'service', 'message', 'rpc',
]);

// ---------------------------------------------------------------------------
// PageRank
// ---------------------------------------------------------------------------

/**
 * Run PageRank on an adjacency list.
 * @param {Map<string, Set<string>>} outEdges - node → set of target nodes
 * @param {Set<string>} allNodes - all node IDs
 * @param {{ damping?: number, iterations?: number }} opts
 * @returns {Map<string, number>} node → PageRank score
 */
export function pageRank(outEdges, allNodes, opts = {}) {
  const damping = opts.damping ?? DEFAULT_DAMPING;
  const maxIter = opts.iterations ?? DEFAULT_ITERATIONS;
  const n = allNodes.size;
  if (n === 0) return new Map();

  const base = (1 - damping) / n;

  // Build inEdges for efficient reverse lookup
  const inEdges = new Map();
  for (const node of allNodes) inEdges.set(node, []);
  for (const [src, targets] of outEdges) {
    for (const tgt of targets) {
      if (inEdges.has(tgt)) {
        inEdges.get(tgt).push(src);
      }
    }
  }

  // Pre-compute out-degree and collect dangling nodes
  const outDegree = new Map();
  const danglingNodes = [];
  for (const node of allNodes) {
    const deg = (outEdges.get(node)?.size) || 0;
    outDegree.set(node, deg);
    if (deg === 0) danglingNodes.push(node);
  }

  // Initialize uniform scores
  let scores = new Map();
  const initScore = 1 / n;
  for (const node of allNodes) scores.set(node, initScore);

  // Power iteration
  for (let iter = 0; iter < maxIter; iter++) {
    // Redistribute dangling node mass uniformly
    let danglingSum = 0;
    for (const node of danglingNodes) {
      danglingSum += scores.get(node);
    }
    const danglingContrib = damping * danglingSum / n;

    const nextScores = new Map();
    let delta = 0;

    for (const node of allNodes) {
      let sum = 0;
      for (const src of inEdges.get(node)) {
        const deg = outDegree.get(src);
        if (deg > 0) {
          sum += scores.get(src) / deg;
        }
      }
      const newScore = base + damping * sum + danglingContrib;
      nextScores.set(node, newScore);
      delta += Math.abs(newScore - scores.get(node));
    }

    scores = nextScores;
    if (delta < CONVERGENCE_THRESHOLD) break;
  }

  return scores;
}

// ---------------------------------------------------------------------------
// Graph loading from SQLite
// ---------------------------------------------------------------------------

/**
 * Load graph data from the code-graph.db SQLite database.
 * @param {string} [dbPath] - Path to code-graph.db
 * @param {{ manifestEpoch?: number }} [opts]
 * @returns {{ entities: Array, relationships: Array }}
 */
export function loadGraph(dbPath, opts = {}) {
  const basePath = dbPath || DB_PATHS.codeGraph;
  const manifest = opts.manifest || readAdjacentManifest(basePath);
  const resolvedPath = resolveManifestCodeGraphPath(basePath, manifest);
  const db = new Database(resolvedPath, { readonly: true, timeout: 5000 });
  applyReadPragmas(db);

  try {
    const manifestEpoch = Number.isInteger(opts.manifestEpoch)
      ? opts.manifestEpoch
      : (Number.isInteger(manifest?.epoch) ? manifest.epoch : readAdjacentManifestEpoch(resolvedPath));
    const visibility = createCodeGraphVisibility(db, manifestEpoch);
    const entities = db.prepare(`
      SELECT id, file_path, type, name, signature, start_line, end_line
      FROM entities
      WHERE ${entityVisibilitySql(visibility)}
    `).all(...entityVisibilityParams(visibility));

    const relationships = db.prepare(`
      SELECT source_id, target_id, target_name, type, weight
      FROM relationships
      WHERE ${relationshipVisibilitySql(visibility, '')}
    `).all(...relationshipVisibilityParams(visibility));

    return { entities, relationships };
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Graph building
// ---------------------------------------------------------------------------

/**
 * Build adjacency structures from entities and relationships.
 * Nodes = entity IDs. Edges = relationships between entities.
 * Also creates file-level nodes connected to their entities.
 *
 * @param {{ entities: Array, relationships: Array }} graph
 * @returns {{ outEdges: Map<string, Set<string>>, allNodes: Set<string>, entityMap: Map<string, object>, fileEntities: Map<string, Array> }}
 */
export function buildAdjacency(graph) {
  const { entities, relationships } = graph;
  const allNodes = new Set();
  const outEdges = new Map();
  const entityMap = new Map();
  const fileEntities = new Map();

  // Register all entities as nodes
  for (const ent of entities) {
    allNodes.add(ent.id);
    entityMap.set(ent.id, ent);

    // Group entities by file
    if (!fileEntities.has(ent.file_path)) {
      fileEntities.set(ent.file_path, []);
    }
    fileEntities.get(ent.file_path).push(ent);
  }

  // Build name → entity ID lookup for resolving target_name references
  const nameToIds = new Map();
  for (const ent of entities) {
    const key = ent.name;
    if (!nameToIds.has(key)) nameToIds.set(key, []);
    nameToIds.get(key).push(ent.id);
  }

  // Add edges from relationships
  for (const rel of relationships) {
    const sourceId = rel.source_id;
    if (!sourceId) continue;
    if (!allNodes.has(sourceId)) continue;

    // Resolve target: prefer target_id, fallback to name lookup
    let targetIds = [];
    if (rel.target_id && allNodes.has(rel.target_id)) {
      targetIds = [rel.target_id];
    } else if (rel.target_name) {
      // For "Foo.bar" calls, try resolving "Foo" as entity
      const baseName = rel.target_name.includes('.')
        ? rel.target_name.split('.')[0]
        : rel.target_name;
      targetIds = (nameToIds.get(baseName) || []).filter(id => allNodes.has(id));
    }

    for (const targetId of targetIds) {
      if (targetId === sourceId) continue; // skip self-loops
      if (!outEdges.has(sourceId)) outEdges.set(sourceId, new Set());
      outEdges.get(sourceId).add(targetId);
    }
  }

  return { outEdges, allNodes, entityMap, fileEntities };
}

// ---------------------------------------------------------------------------
// Repo map rendering
// ---------------------------------------------------------------------------

/**
 * Format a single entity line for the repo map.
 * @param {object} ent - Entity from DB
 * @returns {string}
 */
function formatEntityLine(ent) {
  const sig = ent.signature
    ? ent.signature.replace(/\s+/g, ' ').trim()
    : ent.name;
  // Truncate very long signatures
  const maxSigLen = 120;
  const display = sig.length > maxSigLen ? sig.slice(0, maxSigLen) + '...' : sig;
  return `  ${ent.type}: ${display}`;
}

/**
 * Estimate token count for a string (rough heuristic).
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Render the repo map text from ranked entities, fitting within a token budget.
 * Uses binary search on entity count to find the maximum that fits.
 *
 * @param {Array<{ entity: object, score: number }>} rankedEntities - Sorted desc by score
 * @param {number} tokenBudget
 * @returns {{ text: string, entityCount: number, fileCount: number, totalEntities: number }}
 */
export function renderRepoMap(rankedEntities, tokenBudget) {
  if (rankedEntities.length === 0) {
    return { text: '(empty repo map — no entities found)', entityCount: 0, fileCount: 0, totalEntities: 0 };
  }

  // Binary search: find max N entities that fit in budget
  let lo = 1;
  let hi = rankedEntities.length;
  let bestN = 1;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const text = buildMapText(rankedEntities.slice(0, mid));
    if (estimateTokens(text) <= tokenBudget) {
      bestN = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const text = buildMapText(rankedEntities.slice(0, bestN));
  const files = new Set(rankedEntities.slice(0, bestN).map(e => e.entity.file_path));

  return {
    text,
    entityCount: bestN,
    fileCount: files.size,
    totalEntities: rankedEntities.length,
  };
}

/**
 * Build the formatted map text from a subset of ranked entities.
 * Groups by file, preserves score ordering within files.
 *
 * @param {Array<{ entity: object, score: number }>} entries
 * @returns {string}
 */
function buildMapText(entries) {
  // Group by file, maintaining insertion order (highest-ranked entity per file first)
  const fileGroups = new Map();
  const fileMaxScore = new Map();

  for (const { entity, score } of entries) {
    const fp = entity.file_path;
    if (!fileGroups.has(fp)) {
      fileGroups.set(fp, []);
      fileMaxScore.set(fp, score);
    }
    fileGroups.get(fp).push({ entity, score });
    if (score > fileMaxScore.get(fp)) {
      fileMaxScore.set(fp, score);
    }
  }

  // Sort files by their highest-scored entity
  const sortedFiles = [...fileGroups.entries()]
    .sort((a, b) => fileMaxScore.get(b[0]) - fileMaxScore.get(a[0]));

  const lines = [];
  for (const [filePath, ents] of sortedFiles) {
    lines.push(filePath);
    // Sort entities within file by line number for readability
    ents.sort((a, b) => (a.entity.start_line || 0) - (b.entity.start_line || 0));
    for (const { entity } of ents) {
      lines.push(formatEntityLine(entity));
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Generate a PageRank-scored repo map from the code graph.
 *
 * @param {object} [opts]
 * @param {number} [opts.tokenBudget=1024] - Max tokens for the output
 * @param {number} [opts.damping=0.85] - PageRank damping factor
 * @param {number} [opts.iterations=20] - Max PageRank iterations
 * @param {string} [opts.dbPath] - Override code-graph.db path
 * @param {string[]} [opts.focusFiles] - Boost scores for entities in these files
 * @param {string[]} [opts.focusEntities] - Boost scores for these entity names
 * @param {number} [opts.manifestEpoch] - Optional pinned manifest epoch for incremental readers
 * @returns {{ text: string, entityCount: number, fileCount: number, totalEntities: number, pageRankTimeMs: number }}
 */
export function generateRepoMap(opts = {}) {
  const tokenBudget = opts.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const start = Date.now();

  // 1. Load graph from SQLite
  const graph = loadGraph(opts.dbPath, {
    manifest: opts.manifest,
    manifestEpoch: opts.manifestEpoch,
  });

  if (graph.entities.length === 0) {
    return {
      text: '(empty repo map — no indexed entities. Run indexing first.)',
      entityCount: 0,
      fileCount: 0,
      totalEntities: 0,
      pageRankTimeMs: Date.now() - start,
    };
  }

  // 2. Build adjacency
  const { outEdges, allNodes, entityMap } = buildAdjacency(graph);

  // 3. Run PageRank
  const scores = pageRank(outEdges, allNodes, {
    damping: opts.damping,
    iterations: opts.iterations,
  });

  // 4. Apply focus boosts (personalized PageRank approximation)
  if (opts.focusFiles?.length) {
    for (const [nodeId, ent] of entityMap) {
      const entPath = ent.file_path;
      const matched = opts.focusFiles.some(f =>
        entPath === f ||
        entPath.endsWith('/' + f) ||
        path.resolve(entPath) === path.resolve(f)
      );
      if (matched) {
        scores.set(nodeId, (scores.get(nodeId) || 0) * 3);
      }
    }
  }
  if (opts.focusEntities?.length) {
    const focusNames = new Set(opts.focusEntities);
    for (const [nodeId, ent] of entityMap) {
      if (focusNames.has(ent.name)) {
        scores.set(nodeId, (scores.get(nodeId) || 0) * 3);
      }
    }
  }

  // 5. Rank entities, filter to display-worthy types
  const ranked = [];
  for (const [nodeId, score] of scores) {
    const ent = entityMap.get(nodeId);
    if (!ent) continue;
    if (!DISPLAY_ENTITY_TYPES.has(ent.type)) continue;
    ranked.push({ entity: ent, score });
  }
  ranked.sort((a, b) => b.score - a.score);

  // 6. Render with binary search for token budget
  const result = renderRepoMap(ranked, tokenBudget);

  return {
    ...result,
    pageRankTimeMs: Date.now() - start,
  };
}

export default { generateRepoMap, pageRank, loadGraph, buildAdjacency, renderRepoMap, estimateTokens };

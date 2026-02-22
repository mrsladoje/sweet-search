/**
 * Community Detector Module
 *
 * Discovers logical communities of code entities using the Leiden algorithm
 * on the entity/relationship graph stored in SQLite (code-graph.db).
 *
 * Algorithm core (Traag et al. 2019) lives in leiden-algorithm.js.
 * This module handles DB I/O, graph construction, and the public API.
 *
 * Fallback: directory-based grouping when code-graph.db is absent or too large.
 */

import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { DB_PATHS } from './config.js';
import { leidenCommunities, findConnectedComponents } from './leiden-algorithm.js';

// Re-export for existing consumers
export { leidenCommunities } from './leiden-algorithm.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENTITY_CUTOFF = 50_000;
const RELATIONSHIP_CUTOFF = 200_000;
const DEFAULT_TIMEOUT_MS = 2000;

// Relationship type weights for adjacency construction
const REL_WEIGHTS = {
  imports: 3,
  extends: 3,
  implements: 3,
  calls: 1,
  uses: 1,
};

// ---------------------------------------------------------------------------
// Graph Hash
// ---------------------------------------------------------------------------

/**
 * Compute sha256 hash of the code graph structure.
 *
 * @param {string} [dbPath] - Path to code-graph.db
 * @returns {string} hex digest
 */
export function computeGraphHash(dbPath) {
  const resolvedPath = dbPath || DB_PATHS.codeGraph;
  const db = new Database(resolvedPath, { readonly: true, timeout: 5000 });

  try {
    const rows = db.prepare(`
      SELECT source_id, target_id, type
      FROM relationships
      ORDER BY source_id, target_id, type
    `).all();

    const hash = createHash('sha256');
    for (const row of rows) {
      hash.update(`${row.source_id}\t${row.target_id}\t${row.type}\n`);
    }

    return hash.digest('hex');
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Directory Fallback
// ---------------------------------------------------------------------------

/**
 * Fallback: group entities by top-2 directory path segments.
 *
 * @param {Array<{id: number|string, name: string, file_path: string}>} entities
 * @returns {Array<{id: number, entityIds: Array, fileIds: Array, entityCount: number}>}
 */
export function fallbackDirectoryGrouping(entities) {
  const groups = new Map();

  for (const ent of entities) {
    const fp = ent.file_path || '';
    const parts = fp.split('/').filter(Boolean);
    const dirKey = parts.length >= 2 ? parts.slice(0, 2).join('/') : parts[0] || '(root)';

    if (!groups.has(dirKey)) {
      groups.set(dirKey, { entityIds: new Set(), fileIds: new Set() });
    }
    const g = groups.get(dirKey);
    g.entityIds.add(ent.id);
    if (fp) g.fileIds.add(fp);
  }

  let communityId = 0;
  const communities = [];
  for (const [, group] of groups) {
    communities.push({
      id: communityId++,
      entityIds: [...group.entityIds],
      fileIds: [...group.fileIds],
      entityCount: group.entityIds.size,
    });
  }

  return communities;
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Detect communities from code-graph.db relationships.
 *
 * @param {string} [dbPath] - Path to code-graph.db
 * @param {object} [options]
 * @param {number} [options.resolution=1.0]
 * @param {number} [options.maxIterations=10]
 * @param {number} [options.timeoutMs=2000]
 * @returns {{ communities: Array, graphHash: string, stale: boolean }}
 */
export function detectCommunities(dbPath, options = {}) {
  const resolvedPath = dbPath || DB_PATHS.codeGraph;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let db;
  try {
    db = new Database(resolvedPath, { readonly: true, timeout: 5000 });
  } catch {
    return { communities: [], graphHash: '', stale: false };
  }

  try {
    const entities = db.prepare(`
      SELECT id, name, type, file_path
      FROM entities
      WHERE stale_since IS NULL
    `).all();

    const relationships = db.prepare(`
      SELECT source_id, target_id, type
      FROM relationships
    `).all();

    // Hard cutoffs: fall back to directory grouping
    if (entities.length > ENTITY_CUTOFF || relationships.length > RELATIONSHIP_CUTOFF) {
      const graphHash = computeGraphHashFromRows(relationships);
      return {
        communities: fallbackDirectoryGrouping(entities),
        graphHash,
        stale: false,
      };
    }

    // Build weighted adjacency (undirected)
    const adjacency = buildWeightedAdjacency(entities, relationships);

    // Run Leiden
    const startTime = Date.now();
    const { assignment, converged } = leidenCommunities(adjacency, {
      resolution: options.resolution,
      maxIterations: options.maxIterations,
      timeoutMs,
    });
    const elapsed = Date.now() - startTime;
    const stale = !converged && elapsed >= timeoutMs;

    // Build entity lookup for file_path mapping
    const entityMap = new Map();
    for (const ent of entities) entityMap.set(ent.id, ent);

    // Group by community
    const commGroups = new Map();
    for (const [nodeId, commId] of assignment) {
      if (!commGroups.has(commId)) {
        commGroups.set(commId, { entityIds: [], fileIds: new Set() });
      }
      const g = commGroups.get(commId);
      g.entityIds.push(nodeId);
      const ent = entityMap.get(nodeId);
      if (ent?.file_path) g.fileIds.add(ent.file_path);
    }

    // Connectivity sanity check per community (BFS on induced subgraph)
    const finalCommunities = [];
    let nextId = 0;

    for (const [, group] of commGroups) {
      const memberSet = new Set(group.entityIds);
      const subAdj = new Map();
      for (const nodeId of group.entityIds) {
        const neighbors = adjacency.get(nodeId);
        if (!neighbors) continue;
        const subNeighbors = new Map();
        for (const [neighbor, w] of neighbors) {
          if (memberSet.has(neighbor)) subNeighbors.set(neighbor, w);
        }
        if (subNeighbors.size > 0) subAdj.set(nodeId, subNeighbors);
      }

      const components = findConnectedComponents(group.entityIds, subAdj);
      for (const comp of components) {
        const fileIds = new Set();
        const entityNames = [];
        for (const nodeId of comp) {
          const ent = entityMap.get(nodeId);
          if (ent?.file_path) fileIds.add(ent.file_path);
          if (ent?.name) entityNames.push(ent.name);
        }
        finalCommunities.push({
          id: nextId++,
          entityIds: comp,
          entityNames,
          fileIds: [...fileIds],
          entityCount: comp.length,
        });
      }
    }

    const graphHash = computeGraphHashFromRows(relationships);
    return { communities: finalCommunities, graphHash, stale };
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Build weighted undirected adjacency from entities and relationships.
 * @param {Array} entities
 * @param {Array} relationships
 * @returns {Map<number, Map<number, number>>}
 */
function buildWeightedAdjacency(entities, relationships) {
  const adjacency = new Map();
  const entityIds = new Set();
  for (const ent of entities) {
    entityIds.add(ent.id);
    adjacency.set(ent.id, new Map());
  }

  for (const rel of relationships) {
    const src = rel.source_id;
    const tgt = rel.target_id;
    // Self-edges (src === tgt) are intentionally dropped: they have no
    // effect on community structure (same-node edges don't influence
    // modularity delta-Q), and Leiden's self-loop handling in local
    // moving already skips them (leiden-algorithm.js line 172).
    if (!src || !tgt || src === tgt) continue;
    if (!entityIds.has(src) || !entityIds.has(tgt)) continue;

    const w = REL_WEIGHTS[rel.type] || 1;

    const srcNeighbors = adjacency.get(src);
    const tgtNeighbors = adjacency.get(tgt);
    srcNeighbors.set(tgt, (srcNeighbors.get(tgt) || 0) + w);
    tgtNeighbors.set(src, (tgtNeighbors.get(src) || 0) + w);
  }

  return adjacency;
}

/**
 * Compute graph hash from relationship rows (avoids re-querying DB).
 * Sorts a copy to avoid mutating caller-owned arrays.
 */
function computeGraphHashFromRows(relationships) {
  const sorted = [...relationships].sort((a, b) => {
    if (a.source_id !== b.source_id) return a.source_id - b.source_id;
    if (a.target_id !== b.target_id) return a.target_id - b.target_id;
    return (a.type || '') < (b.type || '') ? -1 : (a.type || '') > (b.type || '') ? 1 : 0;
  });

  const hash = createHash('sha256');
  for (const row of sorted) {
    hash.update(`${row.source_id}\t${row.target_id}\t${row.type}\n`);
  }
  return hash.digest('hex');
}

export default {
  detectCommunities,
  computeGraphHash,
  leidenCommunities,
  fallbackDirectoryGrouping,
};

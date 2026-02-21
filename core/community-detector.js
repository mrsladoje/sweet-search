/**
 * Community Detector Module
 *
 * Discovers logical communities of code entities using the Leiden algorithm
 * on the entity/relationship graph stored in SQLite (code-graph.db).
 *
 * The Leiden algorithm improves on Louvain by adding a refinement phase
 * that guarantees well-connected communities.
 *
 * Algorithm per iteration:
 *   1. Local moving – each node moves to the community maximizing modularity gain
 *   2. Refinement  – nodes within communities form sub-communities (connectivity guarantee)
 *   3. Aggregation  – collapse communities into super-nodes and repeat
 *
 * Fallback: directory-based grouping when code-graph.db is absent or too large.
 */

import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { DB_PATHS } from './config.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENTITY_CUTOFF = 50_000;
const RELATIONSHIP_CUTOFF = 200_000;
const DEFAULT_TIMEOUT_MS = 2000;      // 2x the 1s wall-clock budget
const DEFAULT_RESOLUTION = 1.0;
const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_CONVERGENCE_THRESHOLD = 1e-6;

// Relationship type weights for adjacency construction
const REL_WEIGHTS = {
  imports: 3,
  extends: 3,
  implements: 3,
  calls: 1,
  uses: 1,
};

// ---------------------------------------------------------------------------
// Leiden Algorithm (pure JS)
// ---------------------------------------------------------------------------

/**
 * Run the Leiden community detection algorithm on a weighted adjacency graph.
 *
 * @param {Map<number, Map<number, number>>} adjacency - node -> Map(neighbor -> weight)
 * @param {object} [options]
 * @param {number} [options.resolution=1.0]
 * @param {number} [options.maxIterations=10]
 * @param {number} [options.convergenceThreshold=1e-6]
 * @param {number} [options.timeoutMs] - abort after this many ms (returns partial)
 * @returns {{ assignment: Map<number, number>, converged: boolean, iterations: number }}
 *   assignment: node -> communityId
 */
export function leidenCommunities(adjacency, options = {}) {
  const resolution = options.resolution ?? DEFAULT_RESOLUTION;
  const maxIter = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const threshold = options.convergenceThreshold ?? DEFAULT_CONVERGENCE_THRESHOLD;
  const deadline = options.timeoutMs ? Date.now() + options.timeoutMs : Infinity;

  let currentAdj = adjacency;
  let currentNodes = [...adjacency.keys()];
  const n = currentNodes.length;
  if (n === 0) return { assignment: new Map(), converged: true, iterations: 0 };

  // Total edge weight (m = sum of all edge weights / 2 for undirected)
  let totalWeight = 0;
  for (const neighbors of adjacency.values()) {
    for (const w of neighbors.values()) totalWeight += w;
  }
  // Each edge counted twice in undirected representation
  const m2 = totalWeight; // 2m

  if (m2 === 0) {
    // No edges: each node is its own community
    const assignment = new Map();
    for (let i = 0; i < n; i++) assignment.set(currentNodes[i], i);
    return { assignment, converged: true, iterations: 0 };
  }

  // Initialize: each node in its own community
  const community = new Map();    // node -> communityId
  for (let i = 0; i < n; i++) community.set(currentNodes[i], currentNodes[i]);

  // Weighted degree per node: ki = sum of edge weights incident to node i
  const degree = new Map();
  for (const node of currentNodes) {
    let d = 0;
    const neighbors = currentAdj.get(node);
    if (neighbors) for (const w of neighbors.values()) d += w;
    degree.set(node, d);
  }

  let converged = false;
  let iter = 0;
  let prevQ = 0;

  for (iter = 0; iter < maxIter; iter++) {
    if (Date.now() > deadline) break;

    // --- Phase 1: Local moving ---
    const moved = localMovingPhase(
      currentNodes, currentAdj, community, degree, m2, resolution, deadline
    );

    if (!moved) {
      converged = true;
      break;
    }

    // --- Phase 2: Refinement (Leiden-specific) ---
    refinementPhase(currentNodes, currentAdj, community, degree, m2, resolution, deadline);

    // --- Phase 3: Aggregation — collapse communities into super-nodes ---
    const agg = aggregateGraph(currentNodes, currentAdj, community, degree);
    if (!agg) {
      // No further aggregation possible
      converged = true;
      break;
    }

    // Check convergence: modularity delta
    const q = computeModularity(currentAdj, community, degree, m2, resolution);
    if (iter > 0 && Math.abs(q - prevQ) < threshold) {
      converged = true;
      break;
    }
    prevQ = q;

    // Replace working graph with aggregated super-node graph for next iteration
    currentAdj = agg.adjacency;
    currentNodes = agg.nodes;
  }

  // Flatten hierarchical mappings: after aggregation, `community` may contain
  // transitive chains (node→c, c→cc) where c is a super-node from a prior
  // iteration. detectCommunities reads the map as node→final-community, so
  // every chain must be resolved to its terminal fixed-point.
  _flattenAssignment(community);

  return { assignment: community, converged, iterations: iter };
}

/**
 * Flatten transitive community assignments to fixed-point.
 * E.g. node 1→5, 5→9, 9→9 becomes node 1→9.
 * @param {Map<number, number>} community
 */
function _flattenAssignment(community) {
  for (const [node] of community) {
    let cur = community.get(node);
    // Follow chain to fixed-point (max 100 hops as safety)
    let hops = 0;
    while (community.has(cur) && community.get(cur) !== cur && hops < 100) {
      cur = community.get(cur);
      hops++;
    }
    community.set(node, cur);
  }
}

/**
 * Local moving phase: greedily move each node to neighbor community
 * that maximizes modularity gain.
 *
 * @returns {boolean} true if any node was moved
 */
function localMovingPhase(nodes, adjacency, community, degree, m2, resolution, deadline) {
  let anyMoved = false;
  // Randomize node order for better convergence
  const shuffled = [...nodes];
  shuffleArray(shuffled);

  // Community totals: sumTot[c] = sum of degrees of nodes in community c
  const sumTot = new Map();
  for (const node of nodes) {
    const c = community.get(node);
    sumTot.set(c, (sumTot.get(c) || 0) + degree.get(node));
  }

  for (const node of shuffled) {
    if (Date.now() > deadline) break;

    const currentComm = community.get(node);
    const ki = degree.get(node);
    const neighbors = adjacency.get(node);
    if (!neighbors || neighbors.size === 0) continue;

    // Compute weights to neighboring communities
    const commWeights = new Map(); // communityId -> weight from node to that community
    for (const [neighbor, w] of neighbors) {
      const nc = community.get(neighbor);
      commWeights.set(nc, (commWeights.get(nc) || 0) + w);
    }

    // Weight from node to its own community
    const kiIn = commWeights.get(currentComm) || 0;

    // Find best community to move to
    let bestComm = currentComm;
    let bestDeltaQ = 0;

    for (const [targetComm, kiTarget] of commWeights) {
      if (targetComm === currentComm) continue;

      const sigmaTotTarget = sumTot.get(targetComm) || 0;
      const sigmaTotCurrent = sumTot.get(currentComm) || 0;

      // Modularity gain of moving node from current to target:
      // ΔQ = [kiTarget/m2 - resolution * sigmaTotTarget * ki / (m2²)]
      //     - [kiIn/m2 - resolution * (sigmaTotCurrent - ki) * ki / (m2²)]
      const deltaQ =
        (kiTarget - kiIn) / m2 -
        resolution * ki * (sigmaTotTarget - sigmaTotCurrent + ki) / (m2 * m2);

      if (deltaQ > bestDeltaQ) {
        bestDeltaQ = deltaQ;
        bestComm = targetComm;
      }
    }

    if (bestComm !== currentComm) {
      // Move node to best community
      sumTot.set(currentComm, (sumTot.get(currentComm) || 0) - ki);
      sumTot.set(bestComm, (sumTot.get(bestComm) || 0) + ki);
      community.set(node, bestComm);
      anyMoved = true;
    }
  }

  return anyMoved;
}

/**
 * Refinement phase: within each community, allow nodes to form sub-communities
 * if doing so improves modularity. This ensures well-connected communities.
 */
function refinementPhase(nodes, adjacency, community, degree, m2, resolution, deadline) {
  // Group nodes by current community
  const commNodes = new Map();
  for (const node of nodes) {
    const c = community.get(node);
    if (!commNodes.has(c)) commNodes.set(c, []);
    commNodes.get(c).push(node);
  }

  for (const [, members] of commNodes) {
    if (Date.now() > deadline) break;
    if (members.length <= 2) continue; // Nothing to refine

    // Build sub-adjacency within this community
    const memberSet = new Set(members);
    const subAdj = new Map();
    for (const node of members) {
      const neighbors = adjacency.get(node);
      if (!neighbors) continue;
      const subNeighbors = new Map();
      for (const [neighbor, w] of neighbors) {
        if (memberSet.has(neighbor)) {
          subNeighbors.set(neighbor, w);
        }
      }
      if (subNeighbors.size > 0) subAdj.set(node, subNeighbors);
    }

    // Check connectivity via BFS; if disconnected, split into components
    const components = findConnectedComponents(members, subAdj);
    if (components.length > 1) {
      // F10: Log when splitting disconnected communities (stderr to avoid corrupting MCP JSON-RPC)
      process.stderr.write(`[CommunityDetector] Splitting disconnected community into ${components.length} connected components (${members.length} nodes)\n`);
      // Assign each disconnected component its own community
      // Keep first component with original community ID
      for (let ci = 1; ci < components.length; ci++) {
        const newCommId = components[ci][0]; // Use first node as community ID
        for (const node of components[ci]) {
          community.set(node, newCommId);
        }
      }
    }
  }
}

/**
 * Aggregate graph: collapse communities into super-nodes with merged edges.
 * Builds a new adjacency where each node is a community ID, and edge weights
 * are the sum of all inter-community edges.
 *
 * @returns {{ nodes: number[], adjacency: Map<number, Map<number, number>> } | null}
 *   null if no aggregation possible (every node is its own community)
 */
function aggregateGraph(nodes, adjacency, community, degree) {
  const uniqueComms = new Set(community.values());
  if (uniqueComms.size >= nodes.length) return null; // No aggregation happened

  // Build super-node adjacency: community -> Map(community -> weight)
  const superAdj = new Map();
  for (const c of uniqueComms) superAdj.set(c, new Map());

  for (const node of nodes) {
    const srcComm = community.get(node);
    const neighbors = adjacency.get(node);
    if (!neighbors) continue;

    for (const [neighbor, w] of neighbors) {
      const tgtComm = community.get(neighbor);
      if (srcComm === tgtComm) continue; // Skip intra-community edges
      const superNeighbors = superAdj.get(srcComm);
      superNeighbors.set(tgtComm, (superNeighbors.get(tgtComm) || 0) + w);
    }
  }

  // Update degree map for super-nodes
  for (const c of uniqueComms) {
    let d = 0;
    const neighbors = superAdj.get(c);
    if (neighbors) for (const w of neighbors.values()) d += w;
    degree.set(c, d);
  }

  // Update community map: each super-node starts in its own community
  for (const c of uniqueComms) community.set(c, c);

  return { nodes: [...uniqueComms], adjacency: superAdj };
}

/**
 * Compute modularity Q for the current partition.
 */
function computeModularity(adjacency, community, degree, m2, resolution) {
  if (m2 === 0) return 0;
  let q = 0;

  for (const [node, neighbors] of adjacency) {
    const ci = community.get(node);
    const ki = degree.get(node);

    for (const [neighbor, w] of neighbors) {
      if (community.get(neighbor) === ci) {
        const kj = degree.get(neighbor);
        q += w - resolution * (ki * kj) / m2;
      }
    }
  }

  return q / m2;
}

/**
 * Find connected components via BFS.
 * @param {Array<number>} nodes
 * @param {Map<number, Map<number, number>>} adjacency
 * @returns {Array<Array<number>>} list of components
 */
function findConnectedComponents(nodes, adjacency) {
  const visited = new Set();
  const components = [];

  for (const start of nodes) {
    if (visited.has(start)) continue;

    const component = [];
    const queue = [start];
    let head = 0;  // Index pointer avoids O(n) shift()
    visited.add(start);

    while (head < queue.length) {
      const current = queue[head++];
      component.push(current);

      const neighbors = adjacency.get(current);
      if (neighbors) {
        for (const neighbor of neighbors.keys()) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
    }

    components.push(component);
  }

  return components;
}

/**
 * Fisher-Yates shuffle (in-place).
 */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ---------------------------------------------------------------------------
// Graph Hash
// ---------------------------------------------------------------------------

/**
 * Compute sha256 hash of the code graph structure.
 * Streams over all (source_id, target_id, rel_type) tuples sorted lexicographically.
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
 * Used when code-graph.db is absent or exceeds hard cutoffs.
 *
 * @param {Array<{id: number|string, name: string, file_path: string}>} entities
 * @returns {Array<{id: number, entityIds: Array, fileIds: Array, entityCount: number}>}
 */
export function fallbackDirectoryGrouping(entities) {
  const groups = new Map(); // dirKey -> { entityIds: Set, fileIds: Set }

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
 * @param {number} [options.resolution=1.0] - Leiden resolution parameter
 * @param {number} [options.maxIterations=10]
 * @param {number} [options.timeoutMs=2000] - Max wall-clock time for Leiden
 * @returns {{ communities: Array<{id: number, entityIds: Array, fileIds: Array, entityCount: number}>, graphHash: string, stale: boolean }}
 */
export function detectCommunities(dbPath, options = {}) {
  const resolvedPath = dbPath || DB_PATHS.codeGraph;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let db;
  try {
    db = new Database(resolvedPath, { readonly: true, timeout: 5000 });
  } catch {
    // DB not found or unreadable: return empty
    return { communities: [], graphHash: '', stale: false };
  }

  try {
    // Load entities
    const entities = db.prepare(`
      SELECT id, name, type, file_path
      FROM entities
      WHERE stale_since IS NULL
    `).all();

    // Load relationships
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
    const commGroups = new Map(); // communityId -> { entityIds, fileIds }
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

    // Compute graph hash
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
 * imports/extends/implements → weight 3, calls/uses → weight 1.
 *
 * @param {Array} entities
 * @param {Array} relationships
 * @returns {Map<number, Map<number, number>>} node -> Map(neighbor -> weight)
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
    if (!src || !tgt || src === tgt) continue;
    if (!entityIds.has(src) || !entityIds.has(tgt)) continue;

    const w = REL_WEIGHTS[rel.type] || 1;

    // Undirected: add both directions
    const srcNeighbors = adjacency.get(src);
    const tgtNeighbors = adjacency.get(tgt);

    srcNeighbors.set(tgt, (srcNeighbors.get(tgt) || 0) + w);
    tgtNeighbors.set(src, (tgtNeighbors.get(src) || 0) + w);
  }

  return adjacency;
}

/**
 * Compute graph hash from relationship rows (avoids re-querying DB).
 * Sort order matches the SQL ORDER BY in computeGraphHash():
 *   numeric on source_id, then target_id, then lexicographic on type.
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

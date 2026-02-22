/**
 * Leiden Algorithm — Pure JS implementation (Traag et al., 2019)
 *
 * Three phases per iteration:
 *   1. Local moving — greedy modularity-maximizing node reassignment
 *   2. Refinement  — constrained singleton merge (well-connectedness guarantee)
 *   3. Aggregation  — collapse into super-nodes with self-loops preserving m2
 *
 * Extracted from community-detector.js for SOLID compliance.
 */

const DEFAULT_RESOLUTION = 1.0;
const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_CONVERGENCE_THRESHOLD = 1e-6;

/**
 * Run the Leiden community detection algorithm on a weighted adjacency graph.
 *
 * @param {Map<number, Map<number, number>>} adjacency - node -> Map(neighbor -> weight)
 * @param {object} [options]
 * @param {number} [options.resolution=1.0]
 * @param {number} [options.maxIterations=10]
 * @param {number} [options.convergenceThreshold=1e-6]
 * @param {number} [options.timeoutMs] - abort after this many ms (returns partial)
 * @param {number} [options.randomSeed] - deterministic seed for internal shuffles
 * @param {() => number} [options.randomFn] - custom RNG that returns [0, 1)
 * @returns {{ assignment: Map<number, number>, converged: boolean, iterations: number }}
 */
export function leidenCommunities(adjacency, options = {}) {
  const resolution = options.resolution ?? DEFAULT_RESOLUTION;
  const maxIter = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const threshold = options.convergenceThreshold ?? DEFAULT_CONVERGENCE_THRESHOLD;
  const deadline = options.timeoutMs ? Date.now() + options.timeoutMs : Infinity;
  const randomFn = typeof options.randomFn === 'function'
    ? options.randomFn
    : createRandomGenerator(options.randomSeed);

  let currentAdj = adjacency;
  let currentNodes = [...adjacency.keys()];
  const n = currentNodes.length;
  if (n === 0) return { assignment: new Map(), converged: true, iterations: 0 };

  // Total edge weight (m = sum of all edge weights / 2 for undirected)
  let totalWeight = 0;
  for (const neighbors of adjacency.values()) {
    for (const w of neighbors.values()) totalWeight += w;
  }
  const m2 = totalWeight; // 2m (each edge counted twice in undirected representation)

  if (m2 === 0) {
    const assignment = new Map();
    for (let i = 0; i < n; i++) assignment.set(currentNodes[i], i);
    return { assignment, converged: true, iterations: 0 };
  }

  // Initialize: each node in its own community
  const community = new Map();
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
      currentNodes, currentAdj, community, degree, m2, resolution, deadline, randomFn
    );

    if (!moved) {
      converged = true;
      break;
    }

    // Save P (local-moving partition) before refinement modifies community map.
    // Canonical Leiden: aggregate is based on P_refined, but the initial partition
    // of the aggregate network comes from P (Traag et al., 2019, §Methods).
    const localMovingPartition = new Map();
    for (const node of currentNodes) {
      localMovingPartition.set(node, community.get(node));
    }

    // --- Phase 2: Refinement (constrained singleton merge) ---
    refinementPhase(currentNodes, currentAdj, community, degree, m2, resolution, deadline, randomFn);

    // Check convergence on the refined partition (before aggregation mutates map)
    const q = computeModularity(currentAdj, community, degree, m2, resolution);
    if (iter > 0 && Math.abs(q - prevQ) < threshold) {
      converged = true;
      break;
    }
    prevQ = q;

    // --- Phase 3: Aggregation with self-loops + initial partition from P ---
    const agg = aggregateGraph(currentNodes, currentAdj, community, degree, localMovingPartition);
    if (!agg) {
      converged = true;
      break;
    }

    currentAdj = agg.adjacency;
    currentNodes = agg.nodes;
  }

  // Flatten hierarchical mappings: after aggregation, `community` may contain
  // transitive chains (node→c, c→cc). Resolve to terminal fixed-points.
  _flattenAssignment(community);

  return { assignment: community, converged, iterations: iter };
}

/**
 * Flatten transitive community assignments to fixed-point.
 * E.g. node 1→5, 5→9, 9→9 becomes node 1→9.
 *
 * Uses Floyd's tortoise-and-hare cycle detection. If a cycle is found the
 * node is assigned to itself (singleton community) as a safe fallback.
 * The 100-hop limit is kept as a belt-and-suspenders guard.
 *
 * @param {Map<number, number>} community
 */
function _flattenAssignment(community) {
  // Helper: advance one step along the chain; returns the same value if
  // already at a fixed-point (self-mapping or not in map).
  const step = (v) => {
    const next = community.get(v);
    return (next !== undefined && next !== v) ? next : v;
  };

  for (const [node] of community) {
    const start = community.get(node);
    if (start === undefined) continue;

    // Floyd's tortoise-and-hare — detect cycles without extra allocations.
    let slow = start;
    let fast = start;
    let hops = 0;
    let cycleDetected = false;

    while (hops < 100) {
      const slowNext = step(slow);
      const fastNext = step(step(fast));

      // Both pointers are already at fixed-points — normal termination.
      if (slowNext === slow && fastNext === fast) break;

      slow = slowNext;
      fast = fastNext;
      hops++;

      if (slow === fast && slow !== step(slow)) {
        // Pointers met but are NOT at a fixed-point — genuine cycle.
        cycleDetected = true;
        break;
      }
    }

    if (cycleDetected) {
      if (process.env.DEBUG_CATCHES) {
        process.stderr.write(
          `[leiden] _flattenAssignment: cycle detected for node ${node}, ` +
          `assigning singleton community.\n`
        );
      }
      community.set(node, node);
    } else {
      community.set(node, slow);
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 1: Local Moving
// ---------------------------------------------------------------------------

/**
 * Greedily move each node to the neighbor community maximizing modularity gain.
 * @returns {boolean} true if any node was moved
 */
function localMovingPhase(nodes, adjacency, community, degree, m2, resolution, deadline, randomFn) {
  let anyMoved = false;
  const shuffled = [...nodes];
  shuffleArray(shuffled, randomFn);

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

    // Compute weights to neighboring communities (skip self-loops —
    // their Q contribution is constant regardless of community assignment)
    const commWeights = new Map();
    for (const [neighbor, w] of neighbors) {
      if (neighbor === node) continue; // self-loop: ignore for delta-Q
      const nc = community.get(neighbor);
      commWeights.set(nc, (commWeights.get(nc) || 0) + w);
    }

    const kiIn = commWeights.get(currentComm) || 0;

    let bestComm = currentComm;
    let bestDeltaQ = 0;

    for (const [targetComm, kiTarget] of commWeights) {
      if (targetComm === currentComm) continue;

      const sigmaTotTarget = sumTot.get(targetComm) || 0;
      const sigmaTotCurrent = sumTot.get(currentComm) || 0;

      const deltaQ =
        (kiTarget - kiIn) / m2 -
        resolution * ki * (sigmaTotTarget - sigmaTotCurrent + ki) / (m2 * m2);

      if (deltaQ > bestDeltaQ) {
        bestDeltaQ = deltaQ;
        bestComm = targetComm;
      }
    }

    if (bestComm !== currentComm) {
      sumTot.set(currentComm, (sumTot.get(currentComm) || 0) - ki);
      sumTot.set(bestComm, (sumTot.get(bestComm) || 0) + ki);
      community.set(node, bestComm);
      anyMoved = true;
    }
  }

  return anyMoved;
}

// ---------------------------------------------------------------------------
// Phase 2: Refinement (constrained singleton merge)
// ---------------------------------------------------------------------------

/**
 * Canonical Leiden refinement (Traag et al. 2019 §Methods):
 *
 * For each community C in the current partition P:
 *   1. Start with singleton partition (each node in its own sub-community)
 *   2. Visit nodes in random order; only singletons may move to an adjacent
 *      sub-community within the same community C, if delta-Q > 0.
 *
 * Uses FULL graph degree/m2 (not sub-graph) for delta-Q computation.
 * Post-merge connectivity check splits any disconnected sub-communities.
 */
function refinementPhase(nodes, adjacency, community, degree, m2, resolution, deadline, randomFn) {
  const commNodes = new Map();
  for (const node of nodes) {
    const c = community.get(node);
    if (!commNodes.has(c)) commNodes.set(c, []);
    commNodes.get(c).push(node);
  }

  for (const [, members] of commNodes) {
    if (Date.now() > deadline) break;
    if (members.length <= 1) continue;

    const memberSet = new Set(members);

    // Step 1: Singleton partition
    const subComm = new Map();
    for (const node of members) subComm.set(node, node);

    const sumTot = new Map();
    for (const node of members) sumTot.set(node, degree.get(node) || 0);

    const subSize = new Map();
    for (const node of members) subSize.set(node, 1);

    // Step 2: Constrained singleton merge
    const shuffled = [...members];
    shuffleArray(shuffled, randomFn);

    for (const node of shuffled) {
      if (Date.now() > deadline) break;

      const currentSub = subComm.get(node);
      if ((subSize.get(currentSub) || 0) > 1) continue; // only singletons

      const neighbors = adjacency.get(node);
      if (!neighbors || neighbors.size === 0) continue;
      const ki = degree.get(node) || 0;

      const subWeights = new Map();
      for (const [neighbor, w] of neighbors) {
        if (neighbor === node) continue;
        if (!memberSet.has(neighbor)) continue;
        const nc = subComm.get(neighbor);
        subWeights.set(nc, (subWeights.get(nc) || 0) + w);
      }

      const kiIn = subWeights.get(currentSub) || 0;
      let bestSub = currentSub;
      let bestDeltaQ = 0;

      for (const [targetSub, kiTarget] of subWeights) {
        if (targetSub === currentSub) continue;
        const sigmaTotTarget = sumTot.get(targetSub) || 0;
        const sigmaTotCurrent = sumTot.get(currentSub) || 0;

        const deltaQ =
          (kiTarget - kiIn) / m2 -
          resolution * ki * (sigmaTotTarget - sigmaTotCurrent + ki) / (m2 * m2);

        if (deltaQ > bestDeltaQ) {
          bestDeltaQ = deltaQ;
          bestSub = targetSub;
        }
      }

      if (bestSub !== currentSub) {
        sumTot.set(currentSub, (sumTot.get(currentSub) || 0) - ki);
        sumTot.set(bestSub, (sumTot.get(bestSub) || 0) + ki);
        subSize.set(currentSub, (subSize.get(currentSub) || 1) - 1);
        subSize.set(bestSub, (subSize.get(bestSub) || 0) + 1);
        subComm.set(node, bestSub);
      }
    }

    // Write refined sub-communities back into the global community map
    for (const node of members) {
      community.set(node, subComm.get(node));
    }

    // Safety net: split disconnected sub-communities
    const subGroups = new Map();
    for (const node of members) {
      const sc = subComm.get(node);
      if (!subGroups.has(sc)) subGroups.set(sc, []);
      subGroups.get(sc).push(node);
    }

    for (const [, subMembers] of subGroups) {
      if (subMembers.length <= 1) continue;
      const subMemberSet = new Set(subMembers);
      const subAdj = new Map();
      for (const node of subMembers) {
        const nbrs = adjacency.get(node);
        if (!nbrs) continue;
        const sub = new Map();
        for (const [neighbor, w] of nbrs) {
          if (subMemberSet.has(neighbor)) sub.set(neighbor, w);
        }
        if (sub.size > 0) subAdj.set(node, sub);
      }
      const components = findConnectedComponents(subMembers, subAdj);
      if (components.length > 1) {
        process.stderr.write(`[CommunityDetector] Splitting disconnected sub-community into ${components.length} components (${subMembers.length} nodes)\n`);
        for (let ci = 1; ci < components.length; ci++) {
          const newId = components[ci][0];
          for (const node of components[ci]) community.set(node, newId);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 3: Aggregation
// ---------------------------------------------------------------------------

/**
 * Collapse refined partition into super-nodes.
 * - Intra-community edges become self-loops (preserves m2 across levels)
 * - Initial partition from P uses fresh IDs to avoid flattening cycles
 *
 * @param {number[]} nodes
 * @param {Map<number, Map<number, number>>} adjacency
 * @param {Map<number, number>} community - refined partition (P_refined)
 * @param {Map<number, number>} degree
 * @param {Map<number, number>} localMovingPartition - partition P (before refinement)
 * @returns {{ nodes: number[], adjacency: Map<number, Map<number, number>> } | null}
 */
function aggregateGraph(nodes, adjacency, community, degree, localMovingPartition) {
  const uniqueComms = new Set(community.values());
  if (uniqueComms.size >= nodes.length) return null;

  // Build super-node adjacency (including self-loops)
  const superAdj = new Map();
  for (const c of uniqueComms) superAdj.set(c, new Map());

  for (const node of nodes) {
    const srcComm = community.get(node);
    const neighbors = adjacency.get(node);
    if (!neighbors) continue;

    for (const [neighbor, w] of neighbors) {
      const tgtComm = community.get(neighbor);
      // Self-loops (srcComm === tgtComm) INCLUDED — preserves m2
      const superNeighbors = superAdj.get(srcComm);
      superNeighbors.set(tgtComm, (superNeighbors.get(tgtComm) || 0) + w);
    }
  }

  // Update degree for super-nodes (includes self-loop weight)
  for (const c of uniqueComms) {
    let d = 0;
    const neighbors = superAdj.get(c);
    if (neighbors) for (const w of neighbors.values()) d += w;
    degree.set(c, d);
  }

  // Initial partition from P: map each super-node to its P community.
  // Use fresh unique IDs to avoid cycles in the flattened community chain.
  const commToP = new Map();
  for (const node of nodes) {
    const refinedComm = community.get(node);
    if (!commToP.has(refinedComm)) {
      commToP.set(refinedComm, localMovingPartition.get(node));
    }
  }

  let maxId = 0;
  for (const k of community.keys()) if (k > maxId) maxId = k;
  for (const v of community.values()) if (v > maxId) maxId = v;
  let freshId = maxId + 1;

  const pToFresh = new Map();
  for (const c of uniqueComms) {
    const pc = commToP.get(c) ?? c;
    if (!pToFresh.has(pc)) pToFresh.set(pc, freshId++);
    community.set(c, pToFresh.get(pc));
  }

  return { nodes: [...uniqueComms], adjacency: superAdj };
}

// ---------------------------------------------------------------------------
// Modularity
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Graph Utilities
// ---------------------------------------------------------------------------

/**
 * Find connected components via BFS.
 * @param {Array<number>} nodes
 * @param {Map<number, Map<number, number>>} adjacency
 * @returns {Array<Array<number>>}
 */
export function findConnectedComponents(nodes, adjacency) {
  const visited = new Set();
  const components = [];

  for (const start of nodes) {
    if (visited.has(start)) continue;

    const component = [];
    const queue = [start];
    let head = 0;
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

/** Fisher-Yates shuffle (in-place). */
function shuffleArray(arr, randomFn) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Create deterministic RNG from a numeric seed, or fall back to Math.random.
 * Uses Mulberry32 — a fast 32-bit PRNG with full 2^32 period.
 * (Credited with passing BigCrush per https://gist.github.com/tommyettinger/46a874533244883189143505d203312c)
 *
 * @param {number | undefined} seed
 * @returns {() => number}  values in [0, 1)
 */
function createRandomGenerator(seed) {
  if (seed == null) return Math.random;
  if (!Number.isFinite(seed)) return Math.random;

  // Mulberry32: period 2^32, no known bias patterns.
  let state = (Math.trunc(seed) >>> 0) || 1;

  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

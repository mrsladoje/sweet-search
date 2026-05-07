/**
 * Forward Push — query-time Personalized PageRank over a directed call graph.
 *
 * The structural-trace tool calls this *twice* per query:
 *   - direction='backward' over reverse edges to rank CALLERS by importance
 *     relative to the target ("which of foo's callers are themselves
 *     important to foo").
 *   - direction='forward' over outgoing edges to rank CALLEES by importance
 *     relative to the target ("which of foo's callees coordinate substantive
 *     work, not just leaf utilities").
 *
 * The asymmetry matters: standard global PageRank consistently over-promotes
 * leaf utilities (loggers, formatters) when used to rank callees, because
 * those nodes have high in-degree from the rest of the codebase. Direction-
 * matched PPR from the target avoids that bias.
 *
 * Algorithm: Andersen, Chung, Lang (2006) Forward Push. Sub-linear in the
 * graph size; for typical 4-hop subgraphs the runtime is sub-10ms in JS.
 *
 * Domain layer: pure graph reasoning. Subgraph loading is delegated to the
 * caller via the `subgraph` argument so persistence can stay in
 * core/infrastructure/.
 */

const DEFAULT_ALPHA = 0.15;
const DEFAULT_EPSILON = 1e-4;
const DEFAULT_MAX_HOPS = 4;
const DEFAULT_MAX_NODES = 5000;

/**
 * Run Forward Push from a source node over a preloaded subgraph.
 *
 * The subgraph encodes a single direction: each entry maps a node to its
 * outgoing neighbours *in the direction we're traversing*. For caller PPR
 * the caller passes in a reversed-edge subgraph; for callee PPR a
 * forward-edge subgraph. The algorithm itself is direction-agnostic.
 *
 * @param {object} params
 * @param {string|number} params.sourceId
 * @param {Map<string|number, Map<string|number, number>>} params.subgraph - node → (neighbour → edge weight)
 * @param {number} [params.alpha=0.15] - teleport probability
 * @param {number} [params.epsilon=1e-4] - residual threshold
 * @param {number} [params.maxIterations=10000] - safety cap
 * @returns {Map<string|number, number>} node → PPR score (excludes the source)
 */
export function forwardPush({ sourceId, subgraph, alpha = DEFAULT_ALPHA, epsilon = DEFAULT_EPSILON, maxIterations = 10000 }) {
  const p = new Map();
  const r = new Map();
  if (!sourceId || !(subgraph instanceof Map)) return p;
  r.set(sourceId, 1);
  const queue = [sourceId];
  const inQueue = new Set([sourceId]);
  const totalOutWeight = new Map();
  let iter = 0;
  while (queue.length && iter < maxIterations) {
    iter++;
    const v = queue.shift();
    inQueue.delete(v);
    const rv = r.get(v) || 0;
    const neighbours = subgraph.get(v);
    let outW = totalOutWeight.get(v);
    if (outW === undefined) {
      outW = 0;
      if (neighbours) for (const w of neighbours.values()) outW += w;
      totalOutWeight.set(v, outW);
    }
    if (rv <= epsilon * Math.max(1, outW)) continue;
    p.set(v, (p.get(v) || 0) + alpha * rv);
    r.set(v, 0);
    if (!neighbours || outW <= 0) continue;
    const push = (1 - alpha) * rv / outW;
    for (const [u, w] of neighbours) {
      const newR = (r.get(u) || 0) + push * w;
      r.set(u, newR);
      let outU = totalOutWeight.get(u);
      if (outU === undefined) {
        const nu = subgraph.get(u);
        outU = 0;
        if (nu) for (const wu of nu.values()) outU += wu;
        totalOutWeight.set(u, outU);
      }
      if (!inQueue.has(u) && newR > epsilon * Math.max(1, outU)) {
        queue.push(u);
        inQueue.add(u);
      }
    }
  }
  p.delete(sourceId);
  return p;
}

/**
 * BFS-load a bounded directional subgraph around a target node.
 *
 * Input: a `loadFrontier(ids)` callback that returns one-hop edges for a
 * batch of frontier IDs in the chosen direction. The callback is supplied by
 * core/infrastructure/structural-context-repository.js so that all SQL stays
 * in the persistence layer.
 *
 * @param {object} params
 * @param {string|number} params.sourceId
 * @param {(ids: Array<string|number>) => Array<{ from: string|number, to: string|number, weight: number }>} params.loadFrontier
 * @param {number} [params.maxHops=4]
 * @param {number} [params.maxNodes=5000]
 * @returns {{ subgraph: Map<string|number, Map<string|number, number>>, nodeCount: number, hops: number }}
 */
export function loadDirectionalSubgraph({ sourceId, loadFrontier, maxHops = DEFAULT_MAX_HOPS, maxNodes = DEFAULT_MAX_NODES }) {
  const subgraph = new Map();
  const visited = new Set([sourceId]);
  let frontier = [sourceId];
  let hops = 0;
  while (frontier.length && hops < maxHops && visited.size < maxNodes) {
    hops++;
    const edges = loadFrontier(frontier) || [];
    const next = new Set();
    for (const edge of edges) {
      if (!edge || edge.from == null || edge.to == null) continue;
      let bucket = subgraph.get(edge.from);
      if (!bucket) {
        bucket = new Map();
        subgraph.set(edge.from, bucket);
      }
      const w = Number.isFinite(edge.weight) && edge.weight > 0 ? edge.weight : 1;
      bucket.set(edge.to, (bucket.get(edge.to) || 0) + w);
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        next.add(edge.to);
      }
      if (visited.size >= maxNodes) break;
    }
    frontier = [...next];
  }
  return { subgraph, nodeCount: visited.size, hops };
}

/**
 * Convenience wrapper: load a subgraph in the given direction and run
 * Forward Push from the source. Suitable for the structural-trace builder.
 *
 * @param {object} params
 * @param {string|number} params.sourceId
 * @param {(ids: Array<string|number>) => Array<{ from, to, weight }>} params.loadFrontier
 * @param {number} [params.alpha]
 * @param {number} [params.epsilon]
 * @param {number} [params.maxHops]
 * @param {number} [params.maxNodes]
 * @returns {{ scores: Map<string|number, number>, nodeCount: number, hops: number }}
 */
export function personalizedPageRank(params) {
  const { sourceId, loadFrontier, alpha, epsilon, maxHops, maxNodes } = params;
  const { subgraph, nodeCount, hops } = loadDirectionalSubgraph({ sourceId, loadFrontier, maxHops, maxNodes });
  const scores = forwardPush({ sourceId, subgraph, alpha, epsilon });
  return { scores, nodeCount, hops };
}

export const __TEST__ = { DEFAULT_ALPHA, DEFAULT_EPSILON };

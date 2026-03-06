# MinCut Plan (Revised)

Updated: 2026-03-03  
Status: Ready for execution in a new session (no benchmark runs required yet)

## 1. Decision Summary

This revision accepts the critical issues raised in review and narrows scope to what is both logically sound and latency-safe.

What changed:
- Dropped query-time s-t MinCut from graph expansion (it was conceptually wrong in prior design).
- Dropped plain global MinCut for module partitioning (leaf-isolation failure mode).
- Dropped Gomory-Hu and Karger from Phase 1 (complexity without near-term payoff).
- Deferred HNSW partitioning until we have vector k-NN graph construction in pipeline.
- Promoted community validation via MinCut as the most grounded first integration.

Primary goals:
- Query latency must not increase (target: <= +1ms p95 overhead, ideally net reduction).
- Accuracy must improve via better candidate quality and cleaner communities.

## 2. Non-Negotiables

- All expensive graph algorithms run at index time only.
- Query path uses precomputed metadata only (column lookups / simple arithmetic).
- Keep changes behind feature flags until evaluation is complete.
- No benchmark execution in this phase; only correctness + integration + latency-sanity tests.

## 3. Issue Disposition (Accepted)

1. UC1 previous super-source/sink Dinic design: accepted as flawed and removed.
2. UC2 plain MinCut for module boundaries: accepted as wrong objective; replaced with normalized-cut style spectral partitioning.
3. UC3 AST chunking with plain MinCut: deferred.
4. UC4 HNSW partitioning on dependency graph: accepted as wrong graph; deferred to vector k-NN graph track.
5. UC5 Gomory-Hu for bridge files: replaced by Brandes betweenness + articulation points.
6. UC6 community validation thresholding: upgraded to Connectivity Modifier style thresholding.

## 4. Priority Order (Execution)

1. P0: UC6 Community validation (Leiden + MinCut quality checks)
2. P1: UC2 Module boundaries (spectral / normalized-cut approximation)
3. P1: UC1 Structural importance for expansion (precomputed bridge signals)
4. P2: UC5 Bridge-file scoring refinements
5. Deferred: UC3 AST chunking, UC4 HNSW partitioning

## 5. Algorithms To Implement (Phase 1 Only)

Create `core/graph-algorithms.js` with:

1. `stoerWagnerMinCut(adjacency)`
- Exact global min-cut for undirected weighted graphs.
- Needed for community quality checks and split decisions.

2. `fiedlerBipartition(adjacency, options)`
- Spectral partition with sweep cut minimizing normalized-cut proxy.
- Needed for balanced module partitioning.

3. `brandesBetweenness(adjacency, options)`
- Node betweenness centrality for bridge scoring.
- Faster path to practical bridge signals than all-pairs min-cut infra.

4. `articulationPoints(adjacency)`
- Tarjan DFS articulation points for bottleneck detection.
- Complements betweenness for structural choke points.

5. Adjacency helpers
- Numeric-key adjacency for Leiden interop: `Map<number, Map<number, number>>`
- String-key adjacency for file-level graph: `Map<string, Map<string, number>>`

Not in Phase 1:
- Dinic
- Gomory-Hu
- Karger

### 5.1 Algorithm Implementation Notes (Execution-Critical)

1. Graph direction policy:
- For MinCut, Fiedler, betweenness, and articulation-point scoring, use an undirected weighted graph.
- Build undirected weights with the same symmetrization pattern used in `core/community-detector.js` (`buildWeightedAdjacency()` adds both directions).

2. Stoer-Wagner sketch:
```js
function stoerWagnerMinCut(adj) {
  let best = { weight: Infinity, partition: new Set() };
  let contracted = cloneAdjacency(adj);
  while (contracted.size > 1) {
    const { s, t, cutWeight, sideT } = minCutPhase(contracted);
    if (cutWeight < best.weight) best = { weight: cutWeight, partition: sideT };
    contractNode(contracted, s, t); // merge t into s
  }
  return best;
}
```

3. Fiedler sketch and disconnected-graph handling:
```js
function fiedlerBipartition(adj, options) {
  const components = findConnectedComponents([...adj.keys()], adj);
  if (components.length > 1) {
    // Run per component and skip tiny components (< minModuleSize)
    return partitionEachComponent(components, adj, options);
  }
  // Connected case: compute 2nd eigenvector of Laplacian
  // Use inverse/power iteration + deflation of trivial all-ones eigenvector.
  const v2 = computeFiedlerVector(adj, options);
  return sweepCutBySortedVector(adj, v2); // choose threshold minimizing normalized-cut proxy
}
```
- Reuse `findConnectedComponents` from `core/leiden-algorithm.js`.
- Do not attempt single-graph Fiedler on disconnected adjacency; it is not well-defined for module split decisions.

4. Bridge score normalization (must persist in [0, 1]):
```js
bridge_score = min(1.0, log(1 + raw_betweenness) / log(1 + max_betweenness))
```
- If `max_betweenness === 0`, set all scores to `0`.
- Query-time multiplier must be capped.

## 6. Use Case Plan

### UC6 (P0): Community Validation Enhancement

Objective:
- Validate and refine Leiden communities using cut-based cohesion checks.

Integration:
- Modify `core/community-detector.js`
- Hook after `leidenCommunities(...)` in `detectCommunities()`.

Method:
1. For each detected community, compute induced-subgraph min-cut weight.
2. Use Connectivity Modifier-inspired threshold: split candidates where cut is too weak for size (use `log10(n)` baseline + configurable multiplier).
3. Phase-1 behavior: keep split fragments as separate communities (no local Leiden rerun yet).
4. Optional Phase-2 behavior: rerun Leiden only on affected region if we need additional refinement.
5. Return metadata for observability:
- `validation: { splitCount, weakCommunities, thresholdPolicy }`

Expected impact:
- Better community integrity for vocab warmup and graph navigation.
- Query-time overhead: none (index-time only).

### UC2 (P1): Module Boundaries at Index Time

Objective:
- Partition file graph into balanced modules, avoiding plain min-cut leaf isolation.

Integration:
- Create `core/module-detector.js`
- Modify `core/graph-extractor.js` schema in `createGraphSchema()`
- Modify `core/indexer-build.js` (`buildCodeGraph`) to run module detection after `resolveRelationshipTargets(db)`.

Schema additions:
- `entities.module_id TEXT DEFAULT NULL`
- `entities.bridge_score REAL DEFAULT 0`
- Add index:
  - `CREATE INDEX IF NOT EXISTS idx_entities_module ON entities(module_id) WHERE module_id IS NOT NULL`

Method:
1. Build file-level weighted graph from resolved relationships.
2. Run recursive spectral bisection (`fiedlerBipartition`) with stop rules:
- `minModuleSize`
- `maxDepth`
- `minNormalizedCutGain`
3. Assign `module_id` to all entities by file.

Expected impact:
- Better ambiguity handling (same symbol names across subsystems).
- Enables module-aware candidate filtering in later phase.
- Query-time overhead: none (metadata lookup only).

### UC1 (P1): Structural Importance for Graph Expansion

Objective:
- Improve 2-hop candidate quality without query-time graph algorithms.

Integration:
- Modify `core/graph-expansion.js` in `expandSecondHopAdaptive()`.
- Reuse precomputed `bridge_score` and optional module affinity.

Method:
1. During indexing, compute per-file (and optionally per-entity) structural importance from:
- betweenness centrality
- articulation-point incidence
2. Persist as `bridge_score` in `entities`.
3. At query time, extend existing candidate query to include score column:
- Existing query already joins `entities e` for `file_path/start_line/end_line`.
- Add `e.bridge_score` and optionally `e.module_id`.
4. Update scoring:
- `finalScore = baseScore * (1 + bridgeLambda * bridge_score)`
- Optional module prior if seed module is known:
  - in-module multiplier `1 + moduleBoost`
  - cross-module multiplier `1 - crossModulePenalty`

Expected impact:
- Better top-k expansion relevance.
- Potential latency reduction from fewer irrelevant candidates surviving threshold/budget.
- Query-time overhead target: <1ms p95.

Bridge computation notes:
- Compute betweenness on the undirected symmetrized file graph.
- Store normalized `bridge_score` in `[0, 1]` using the formula in Section 5.1.

### UC5 (P2): Bridge File Utility Track

Objective:
- Strengthen cross-file retrieval and structural queries.

Method:
- Reuse UC1 bridge signals.
- Add optional boost in structural mode (`core/search-boost.js` or postprocess path).

Expected impact:
- Incremental; depends on query-router cross-file detection quality.

### Deferred UC4: HNSW Partitioning

Defer reason:
- Correct approach must partition vector k-NN graph, not dependency graph.
- Requires additional pipeline work not justified at current scale.

Future requirement before implementation:
1. Build k-NN graph from embedding vectors.
2. Use balanced partitioning objective.
3. Preserve recall with routing layer and shard fanout policy.

### Deferred UC3: AST Chunking

Defer reason:
- Marginal gain versus current tree-sitter chunking path.
- Adds algorithmic complexity with unclear near-term ROI.

## 7. Implementation Phases

## Phase 0: Proxy Metrics Baseline (only prerequisite)

Why:
- We need objective measurement before comparing any algorithmic changes.

Tasks:
- Add offline metrics report after indexing:
  - boundary crossing rate
  - expansion waste ratio
  - module ambiguity resolution rate
  - gated-candidate ratio
  - abstention ratio
- Save report artifact under `.sweet-search/` for run-to-run diffing.

Acceptance:
- Metrics are generated without benchmark harness.
- Report comparison script shows directional changes between two index runs.

## Phase A: Core Algorithms

Files:
- Create `core/graph-algorithms.js`
- Create `tests/graph-algorithms.test.js`

Deliverables:
- Deterministic implementations + seeded randomness where needed.
- Unit tests for correctness on canonical toy graphs.

Acceptance:
- 100% pass on algorithm test suite.
- Complexity constraints documented in JSDoc.

## Phase B: Community Validation (P0)

Files:
- Modify `core/community-detector.js`
- Modify `tests/community-detector.test.js`

Deliverables:
- Optional validation stage behind option flag:
  - `useCutValidation` default `false` initially.
- Validation metadata in return payload.
- Full CM loop support in same phase:
  - split-only mode (default first)
  - split+local-recluster mode (optional flag)
  - explicit threshold policy object `{ baselineLog10, multiplier, minCommunitySize }`

Acceptance:
- Existing community tests unchanged unless flag enabled.
- New tests prove weak-community split behavior.

## Phase C: Module Detection + Schema (P1)

Files:
- Create `core/module-detector.js`
- Modify `core/graph-extractor.js` (schema + indexes)
- Modify `core/indexer-build.js` (run detector post-resolution)
- Create `tests/module-detector.test.js`

Deliverables:
- Module assignment persisted to `entities.module_id`.
- Bridge score persisted to `entities.bridge_score`.
- Cut confidence + abstention integrated in this phase:
  - `module_confidence` persisted for entities in detected modules.
  - confidence formula (cheap, deterministic):
```js
confidence = clamp01((second_best_cut - best_cut) / max(best_cut, 1e-6))
```
  - low-confidence modules are marked abstained (no module/cut boost downstream).

Acceptance:
- Migration-safe behavior on existing DBs.
- No crashes when graph sparse/disconnected.
- Confidence marks are produced deterministically for identical inputs.

Indexer hook detail (critical):
- In `core/indexer-build.js`, `buildCodeGraph()` currently calls:
  - `resolveRelationshipTargets(db)` then
  - `db.close()`
- Insert module detection in this exact window:
```js
const resolutionStats = resolveRelationshipTargets(db);
const moduleStats = detectAndPersistModules(db, { ...options }); // insert here
db.close();
```

## Phase D: Query-Time Metadata Use (P1)

Files:
- Modify `core/graph-expansion.js`
- Modify `tests/adaptive-expansion.test.js`
- Modify `tests/path-level-scoring.test.js`

Deliverables:
- Query uses precomputed bridge/module metadata only.
- Optional feature flags:
  - `useBridgeScoreBoost`
  - `useModuleAffinity`
- Cut-certified expansion gating merged into this phase:
  - index time: precompute and persist module stats needed for risk:
    - `intra_weight(M)` for each module
    - `inter_weight(Ma, Mb)` for each adjacent module pair
  - query time: compute `cross_cut_risk` with cheap arithmetic only (no graph traversal)
  - formula for candidate `c` with seed module `Ms` and candidate module `Mc`:
```js
if (Ms === Mc) cross_cut_risk = 0
else {
  ratio = inter_weight(Ms, Mc) / max(1e-6, min(intra_weight(Ms), intra_weight(Mc)))
  cross_cut_risk = clamp01(1 - min(1, ratio))
}
```
  - soft penalty mode first, hard-filter mode optional.
- Abstention policy enforced: if module confidence below threshold, skip cut/module boosts for that candidate path.

Acceptance:
- No algorithmic graph computation in search path.
- Added tests verify score deltas and selection behavior.
- `cross_cut_risk` behavior is test-covered and deterministic.
- Module-pair stat lookup + arithmetic stays within query-time budget target (<1ms p95 overhead).

## Benchmark Gate

- Run full eval/benchmark suite only after Phases 0-A-B-C-D are complete and stable.

## Phase E (Post-Benchmark): Incremental Maintenance

Scope:
- Incremental MinCut / cut-metadata maintenance and warm-start recomputation.

Why deferred:
- Optimization of indexing cost should follow baseline correctness + measured overhead.

Acceptance:
- Recompute only affected components on incremental updates.
- Output includes `incrementalCutStats`.

## Phase F (Post-Benchmark): Research Track

Scope:
- Dual-graph objective (`a * structural + b * knn_sim`).
- Version-aware module stability (`module_churn_rate`) and reliability penalties.

Why deferred:
- Higher research/tuning scope; not required for first production-capable rollout.

## 8. Test Plan (No Benchmarks Yet)

Unit tests:
- `tests/graph-algorithms.test.js`
- `tests/module-detector.test.js`

Integration tests:
- `tests/community-detector.test.js`
- `tests/adaptive-expansion.test.js`
- `tests/path-level-scoring.test.js`

Latency-sanity tests (micro, not benchmark harness):
- Ensure query with expansion enabled does not regress by more than a small threshold in controlled fixture runs.
- Assert no additional DB round-trips beyond existing candidate query path.

### 8.1 Canonical Test Graphs (minimum coverage)

Stoer-Wagner:
- Barbell graph (two cliques linked by one bridge): min-cut is bridge edge set.
- Triangle graph: any 2-edge cut.
- Star graph: leaf edge is global min-cut.
- Disconnected graph: no crash; deterministic handling policy.

Fiedler:
- Two cliques + weak bridge: partition separates cliques.
- Path graph: vector shows smooth gradient and sensible midpoint split.
- Disconnected graph: per-component handling path exercised.

Brandes betweenness:
- Star graph: center highest.
- Path graph: middle nodes higher than endpoints.
- Complete graph: all nodes equal (or nearly equal within tolerance).

Articulation points:
- Barbell bridge node identified.
- Tree root/internal articulation identified.
- Cycle graph returns none.

## 9. Rollout Strategy

Stage 1:
- Phase 0 proxy metrics baseline only.

Stage 2:
- Phase A core algorithms.

Stage 3:
- Phase B community validation (split-only default, optional recluster path behind flag).

Stage 4:
- Phase C module detection + schema + cut-margin confidence.

Stage 5:
- Phase D query-time metadata use + cut-certified expansion gating.

Benchmark gate:
- Run full eval/benchmark suite after Stages 1-5 are stable.

Stage 6 (post-benchmark):
- Phase E incremental maintenance.

Stage 7 (post-benchmark):
- Phase F research track (dual-graph + version-aware stability).

## 10. Risks and Mitigations

1. Risk: Over-segmentation in module partitioning.
- Mitigation: stop rules (`minModuleSize`, normalized-cut gain floor).

2. Risk: Bridge scores over-amplify hubs.
- Mitigation: log-scale normalization + capped multiplier.

3. Risk: DB migration friction.
- Mitigation: additive columns only, idempotent index creation.

4. Risk: Community validation churn.
- Mitigation: keep optional and bounded; emit diagnostics.

5. Risk: Latency regression from extra query joins.
- Mitigation: reuse existing entity join in expansion query; no extra graph computations.

## 11. Open Decisions For Next Session

1. Community split threshold policy:
- Start with `log10(n)` baseline and tune multiplier.

2. Module cut stop criteria defaults:
- `minModuleSize`, `maxDepth`, `minNormalizedCutGain`.

3. Bridge score composition:
- betweenness-only vs betweenness + articulation hybrid.

4. Query-time module prior:
- hard filter vs soft boost/penalty.

## 12. SOTA Notes (As of 2026-03-03)

- Normalized cuts are preferred over plain min-cut for balanced partitioning objectives in segmentation/community-style tasks.
- Modern ANN partitioning work focuses on partitioning similarity/k-NN graphs, not arbitrary dependency graphs.
- Connectivity-modifier style workflows (Leiden + cut validation) are the strongest direct fit for our current graph stack.

Reference anchors to review in execution session:
- Shi & Malik (2000), normalized cuts.
- Traag et al. (2019), Leiden.
- Connectivity Modifier line of work (Park et al., 2023+).
- Gottesbueren et al. (VLDB 2025), graph partitioning for ANN.

## 13. Execution Checklist

- [ ] Phase 0: proxy metrics baseline
- [ ] Phase A: `core/graph-algorithms.js` + tests
- [ ] Phase B: community cut validation integration
- [ ] Phase C: module detector + schema migration + cut-margin confidence/abstention
- [ ] Phase D: graph expansion metadata boost + cut-certified gating
- [ ] Verify all tests pass (`npm test`)
- [ ] Run benchmark/eval gate
- [ ] Phase E: incremental maintenance (post-benchmark)
- [ ] Phase F: research track (post-benchmark)

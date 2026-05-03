# Low-Hanging Fix Recommendations

Updated 2026-05-03 after a second pass that re-indexed the real repos and ran the demotion / attractor experiments.

## Headline numbers

| profile | Recall@1 | Recall@10 | MRR@10 | source |
|---|---:|---:|---:|---|
| **GCSN dense** (s3=15, graphExpand=none) | 80.27 % | 93.80 % | **85.61 %** | full 6000 q |
| **graph-2hop pre-reindex** (use3Stage=false, no cascade) | 46.67 % | 79.33 % | 57.71 % | 300 q |
| **graph-2hop post-reindex** (use3Stage=true, cascade=true, CE unavailable → MaxSim only) | 47.46 % | **82.37 %** | 58.99 % | 295 q |
| **graph-2hop + offline path-demotion (factor 0.4 doc/test/0.5 type)** | **63.73 %** | 82.37 % | **70.54 %** | 295 q |

Reindex alone moved Recall@10 +3.04 pp on the graph benchmark. Adding the path-demotion rule, with no model change, moves Recall@1 by **+16.27 pp** and MRR by **+11.55 pp** at zero cost in Recall@10 (rescue=0, harm=0 at top-10 boundary).

## Ranked fix list

| # | Title | Benchmark | Bucket addressed | Evidence count | Expected impact | Risk | Production-safe? | Ablation needed? | Files likely touched |
|---|-------|-----------|------------------|---------------:|-----------------|------|------------------|------------------|----------------------|
| 1 | **Path/file-type demotion rule for `.md` / `/test/` / `.d.ts`, intent-gated** | graph-2hop (real-repo) | `reranker_demoted_gold`, `gold_present_without_graph_but_expansion_harmed` | offline test on post-reindex top-10 lists: **+16.27 pp Recall@1, +11.55 pp MRR@10, 0 harm at R@10**, rule fired on 219/295 (74 %) | **high (validated)** | low | yes — gated by query-intent keyword check; no production code change needed for the eval-side rule | yes — pick a soft factor (~0.7 captures 87 % of gain), then live ablation; do **not** apply to GCSN single-function corpus | `core/ranking/cascaded-scorer.js` (cascade path) **and** `core/search/search-postprocess.js` `buildMixedRerankPool` (legacy LI path) — both code paths need the same multiplier |
| 2 | **Re-index `eval/repos/{fastify,flask,ripgrep}` was DONE; bake the procedure into a script** | graph-2hop | all | post-reindex: chunk-bridge works (expandedWithLiChunk = expanded for 230/295), Recall@10 +3.04 pp, mean expanded surviving 0.247 → **6.07** | done; preserve the script | n/a | n/a | n/a | `eval/miss-analysis/_reindex_repos.sh` (committed) |
| 3 | **Cap chunk-count per source file in the GCSN benchmark corpus loader** | GCSN dense | `gold_not_in_top100_candidate_generation` (JS) | `emitFiles_57fa9c6b.js` alone produces **318 chunks = 4.57 % of the entire 6962-chunk index**; same file is top-1 across **18 unrelated JS+Ruby queries** with 31 distinct gold files | high — likely lifts JS top1 by 3-5 pp on its own | low | n/a (eval-only — corpus prep) | no (verifiable by re-running tracer) | `eval/lib/corpus.js` or `eval/lib/data-loader.js` (cap N chunks per file or skip the outlier) |
| 4 | **Bump `stage3Candidates` 15 → 30 in dense-eval harness only — with explicit MRR/Recall ablation** | GCSN dense | `gold_present_but_not_top10` | 132/138 (96 %) of rank-11-100 misses sit at no-rerank rank 16-30 — outside the s=15 rerank window | medium (rescue subset) | low | already production default | yes — revisit MRR@1 vs Recall@10 trade | `eval/run_benchmark.js`, `docs/PAPER_RANKING.md` |
| 5 | **Filter / quarantine non-semantic GCSN queries** (type-signature-only, copyright headers, raw-string openers, ≤2-word generic verbs) | GCSN dense | `gold_not_in_top100_candidate_generation` | 18 cand-gen misses have query <15 chars; `type_signature` shape gets 0 % top1; `"Copyright IBM Corp. 2016, 2018"` is a literal query (GC01094) | medium — cleans benchmark noise; lifts headline MRR by removing unwinnable cases | low | n/a (eval-only) | no | `eval/data/gencodesearchnet/queries.jsonl` (or pre-filter in `eval/lib/data-loader.js`) |
| 6 | **Investigate JavaScript & Ruby ~25 pp top1 gap vs Python/Go** — but partly explained by #3, so re-measure first | GCSN dense | `gold_not_in_top100_candidate_generation` (lang split) | JS 70.5/88.8, Ruby 70.2/88.7 vs Python 95.5/98.5, Go 92.2/98.3 | high if non-#3 root cause exists | medium | no | yes | `core/embedding/`, `core/indexing/index-codebase-v21.js` (chunk extraction); inspect chunk text per language |
| 7 | **De-rank embedding-attractor files (frequency-of-irrelevance heuristic)** | GCSN dense | `gold_not_in_top100_candidate_generation` | 20 attractor files identified; **rank-1** alone is responsible for 18 unrelated top-1 wins. Ranks 4-12 are 1-chunk Ruby/JS files with generic identifiers (`each`, `pmt`, `nper`, `with`, `body`) | medium | medium (could mis-fire on legit hits) | no | yes | `core/ranking/` — soft penalty after rerank, gated by an attractor list built from telemetry |
| 8 | **Cascade path needs an expanded-quota mechanism** (or just keep `cascadeEnabled=false` in production) | graph-2hop | `graph_added_gold_but_reranker_lost` | post-reindex: **mean_expanded_in_pool = 0** when cascade=true, because cascade bypasses `buildMixedRerankPool`. With cascade=false the legacy LI path already gives expanded entries 40 % of the rerank pool | low (production cascade is currently off-by-default) | medium | no | yes | `core/ranking/cascaded-scorer.js` |
| 9 | **Add per-query stage-rank instrumentation** (rank-of-gold per Stage 1/2/2.5/rerank) | both | instrumentation | needed to remove the dual-pass workaround in `trace_gcsn_misses.js` | low (tooling) | low | yes | no | `core/search/search-semantic.js`, `core/search/search-postprocess.js` |

## Reframed earlier findings

The first-pass analysis claimed **graph expansion was inert** because mean expanded surviving was 0.247/query. After the reindex, the same code produces 6.07 expanded/query (chunk-bridge intact). So the inertness was a **stale-index artifact** — applyTokenBudget ordering is **not** the bug. The fix table no longer recommends a budget-reorder change.

The new residual issue: even with expansion working, only 4/295 queries see gold added by the graph (was 1/300). Adaptive 2-hop's contribution is small; rescue=1, harm=1. The bigger lever for graph queries is the path-demotion rule (#1).

## What we deliberately did NOT recommend (and why)

- **Reorder `applyTokenBudget` ordering / reserve expanded budget.** Post-reindex evidence shows expanded entries already survive token-budget pruning (mean 6/query). The pre-reindex symptom was the chunk-bridge being broken by mixed-dim float vectors, not the budget order.
- **Production graphExpand default flips.** Mode A and mode B produced identical Recall@10 for 281/295 queries even after reindex.
- **Apply path-demotion to GCSN.** GCSN gold is single-function code by construction; demoting `.test.js` etc. on a single-file benchmark is meaningless. The rule is graph-2hop / real-repo only.
- **Broad embedding-text tweaks.** No miss pointed at a deterministic text-construction bug.
- **Cascade `gateThreshold` / `ceTopK` tuning.** Cascade gate isn't the issue when CE itself is unavailable in our env.
- **Filter rule based on absolute path patterns alone.** The intent-gating layer ("query asks about doc/test/type → don't demote") is what produced the 0-harm property; without it the rule would harm doc-seeking queries.

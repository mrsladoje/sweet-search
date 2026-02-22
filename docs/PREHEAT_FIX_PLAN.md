# Preheat Fix Plan: Eliminate Model Duplication & Optimize Cold Starts

**Status**: Implemented (Preheat-Only Variant, 2026-02-22)
**Date**: 2026-02-22
**Prerequisite**: VOCAB_PREWARM (already implemented)

## 1. Problem Statement

The current `.claude/helpers/session-preheat.sh` runs a massive inline Node.js script that duplicates the server's `init()` process. This causes:
- **Memory duplication**: ~150MB+ wasted loading components into a throwaway process.
- **CPU contention**: Multiple concurrent ONNX JIT compilations thrashing the CPU.
- **Maintenance overhead**: A 450+ line bash script with inline JS is hard to maintain and modify.

Furthermore, the current script lacks smart conditional logic:
- It unconditionally warms FlashRank even if ModernBERT is the designated local reranker.
- It lacks connection pooling for Voyage TLS warmup, meaning the established connection isn't optimally reused.
- It doesn't leverage optimized ONNX graph persistence.
- It blocks on the server being completely ready before running parallelizable non-server warmups.

## 2. Proposed Architecture

### 2.1 The "Thin Bash, Smart JS" Pattern

`session-preheat.sh` will drop from ~450 lines to ~130 lines. It becomes a thin bash wrapper that handles process lifecycle:
1. Acquires lock and cleans stale session slugs.
2. Spawns the `sweet-search` server (if not already running).
3. Delegates all warmup intelligence to a new `core/session-warmup.js` module.
4. Starts the index maintainer daemon.

### 2.2 Smart Warmup Flow

The new `session-warmup.js` implements a registry pattern with:
- **Per-component Idempotency**: Uses server health checks plus index/artifact existence checks to avoid redundant re-warm work.
- **Maximum Parallelization**: Runs lightweight pre-ready tasks (FTS5/HCGS, vocabulary preload, API TLS warmups) in parallel while polling server readiness.
- **Post-ready server-path warmups**: Runs query-router, FlashRank, and ColBERT warmups via real `/search` calls after readiness.
- **Async Server Init**: `search-server.js` starts accepting connections before `init()` completes, returning 503 on `/search` and `{ status: 'starting' }` on `/health` until ready. This enables warmup overlap with server boot.

### 2.3 Conditional Warmup Matrix

**Embedding Provider Matrix:**
| Active Provider | Warm CodeRankEmbed (Local)? | Warm API Connection? |
|-----------------|-----------------------------|----------------------|
| `local` | **YES** (Tier 1, blocking) | NO |
| `voyage` / `mistral` / `jina` | **YES** (Tier 3, lazy fallback for SemanticCache keys) | **YES** (Undici Pool) |

**Reranker Matrix (Two-Stage Cascade):**
FlashRank is always stage-1 (fast local filter, ~15ms). Stage-2 is conditional:

| Stage-2 Reranker | Warm FlashRank (Stage-1)? | Warm Stage-2? |
|------------------|---------------------------|---------------|
| None (default) | **YES** | NO |
| ModernBERT (`USE_LOCAL_RERANKER=true`) | **YES** | **YES** (+ JIT inference) |
| Voyage Rerank | **YES** | **YES** (TLS handshake) |
| Jina Rerank | **YES** | **YES** (TLS handshake) |

### 2.4 SOTA Warmup Techniques (Feb 2026)

1. **ONNX Optimized Graph Persistence**: ONNX Runtime's graph-optimization-level `'all'` + `optimizedModelFilePath` generates a pre-optimized `.onnx` file. Subsequent loads skip JIT compilation, saving ~2-5s per model.
2. **Undici Connection Pooling**: Replace `fetch()` with an `undici` `Pool` (with `keepAliveTimeout`) for the API connection warmup to ensure the established TLS tunnel is actually reused by the `sweet-search` server.
3. **Provider-Aware Connection Warmup**: Warm only the active embedding/reranker remote provider, and skip remote warmups when local providers are active.
4. **Boundary Rule**: Keep preheat/warmup orchestration in preheat files only (shell wrapper + `core/session-warmup.js`), without scattering preheat logic across domain modules.

---

## 3. Implementation Steps

1. **Create `core/session-warmup.js`**:
   - Implement the warmup registry pattern.
   - Implement the conditional warmup matrix.
   - Overlap pre-ready tasks with server readiness polling.
   - Use `undici` `Pool` for remote provider TLS warmup.
   - Add post-ready server-path warmups for query-router, FlashRank, and ColBERT.
2. **Refactor `.claude/helpers/session-preheat.sh`** into a thin bash wrapper that calls `core/session-warmup.js`.
3. **Keep warmup logic boundary-clean**: preheat logic stays in preheat files, domain files remain focused on serving/search.

## 4. Success Metrics

- **Memory**: ~300MB peak (down from ~500MB) due to eliminating duplicate ONNX loads.
- **Time**: ~4s total wall time, but with fully warmed I/O components actively overlapping the server boot window.
- **CPU**: Maximum parallelization for startup speed on modern machines.
- **Code Size**: Bash wrapper reduced to ~30 lines, with easily testable JS logic.

#!/usr/bin/env node
/**
 * Claude Code SessionStart hook: light-tier preheat.
 *
 * Loads the mmap'd HNSW index and cached vocab artifacts, then runs
 * FTS5 MATCH queries and HNSW seed traversals. Never generates new
 * embeddings. Budget: <3s (env-overridable).
 *
 * Lives in core/search/ because it composes two domains — vector-store
 * (HNSW load) and vocabulary (warmFromCache) — which vocabulary itself
 * is not allowed to import per the DDD dependency matrix.
 *
 * Always exits 0 — a failed preheat must not block Claude Code session start.
 */

import { warmFromCache } from '../vocabulary/index.js';
import { createHNSWIndex } from '../vector-store/index.js';

const budgetMs = Number(process.env.SWEET_SEARCH_PREHEAT_BUDGET_MS ?? 3000);
const maxFts5 = Number(process.env.SWEET_SEARCH_PREHEAT_MAX_FTS5 ?? 50);
const maxHnsw = Number(process.env.SWEET_SEARCH_PREHEAT_MAX_HNSW ?? 100);
const verbose = Boolean(process.env.SWEET_SEARCH_PREHEAT_VERBOSE);

const timeout = setTimeout(() => {
  if (verbose) process.stderr.write(`[sweet-search preheat] budget exceeded (${budgetMs}ms)\n`);
  process.exit(0);
}, budgetMs);
timeout.unref();

let hnswIndex = null;
try {
  // mmap load is near-instant even for large indexes — we're just mapping
  // file pages into address space, not materializing the graph.
  hnswIndex = await createHNSWIndex({ load: true });
  if (typeof hnswIndex.load === 'function') {
    try {
      await hnswIndex.load(undefined, { mmap: true });
    } catch {
      // createHNSWIndex may have already loaded it; ignore double-load.
    }
  }
} catch (err) {
  if (verbose) process.stderr.write(`[sweet-search preheat] hnsw load skipped: ${err?.message || err}\n`);
  hnswIndex = null;
}

try {
  const result = await warmFromCache({
    maxFts5Queries: maxFts5,
    maxHnswTraversals: maxHnsw,
    hnswIndex,
  });
  if (verbose) process.stderr.write(`[sweet-search preheat] ${JSON.stringify(result)}\n`);
} catch (err) {
  if (verbose) process.stderr.write(`[sweet-search preheat] non-fatal: ${err?.message || err}\n`);
}

clearTimeout(timeout);
process.exit(0);

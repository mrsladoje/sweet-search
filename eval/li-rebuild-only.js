#!/usr/bin/env node
/**
 * Focused LI-only rebuild — discovers + chunks files, then builds the LI index.
 *
 * Skips embedding/HNSW/code-graph rebuild entirely. Useful for A/B testing
 * LI-side parameters (e.g. SWEET_SEARCH_LI_MAX_DOC_LENGTH) without paying
 * the full pipeline cost on every iteration.
 *
 * Usage:
 *   node eval/li-rebuild-only.js                       # default config
 *   SWEET_SEARCH_LI_MAX_DOC_LENGTH=1024 \
 *     node eval/li-rebuild-only.js                     # 1024 cap A/B
 */

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Sweet-search expects to operate on the project root
process.chdir(PROJECT_ROOT);

async function main() {
  const t0 = Date.now();

  console.log('═'.repeat(70));
  console.log('  LI-only rebuild');
  console.log('═'.repeat(70));
  console.log(`  SWEET_SEARCH_LI_MAX_DOC_LENGTH: ${process.env.SWEET_SEARCH_LI_MAX_DOC_LENGTH || '(default 2048)'}`);
  console.log(`  PROJECT_ROOT: ${PROJECT_ROOT}`);

  const { discoverFiles } = await import(path.join(PROJECT_ROOT, 'core/indexing/indexer-utils.js'));
  const { chunkFiles } = await import(path.join(PROJECT_ROOT, 'core/indexing/indexer-build.js'));
  const { buildLateInteractionIndex } = await import(path.join(PROJECT_ROOT, 'core/indexing/indexer-ann.js'));
  const { planAllocation } = await import(path.join(PROJECT_ROOT, 'core/indexing/indexer-pool.js'));
  const { DB_PATHS } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/config/index.js'));

  const tDiscovery = Date.now();
  const discovered = await discoverFiles();
  const files = Array.isArray(discovered) ? discovered : (discovered?.files || []);
  console.log(`\n[1/3] Discovered ${files.length} files in ${Date.now() - tDiscovery}ms`);

  const tChunk = Date.now();
  const preChunked = await chunkFiles(files);
  // chunkFiles returns { allChunks } in the indexer-phases path; we receive
  // either the bare array or the object — handle both.
  const allChunks = Array.isArray(preChunked) ? preChunked : (preChunked.allChunks || preChunked);
  console.log(`[2/3] Chunked into ${allChunks.length} chunks in ${((Date.now() - tChunk)/1000).toFixed(1)}s`);

  const tLi = Date.now();
  const resourcePlan = planAllocation();
  console.log(`[3/3] Building LI index (batch=${resourcePlan.lateInteractionBatchSize}, ` +
    `tokens=${resourcePlan.lateInteractionTokenBudget}, attn=${resourcePlan.lateInteractionAttentionBudget})...`);

  // Force the legacy single-file JSON format (segmentSize > corpus size).
  // The default SSLX-v3 segmented format kicks in at 10k docs but does NOT
  // persist per-doc metadata (startLine/endLine), which pattern search needs.
  // For benchmarking we need metadata, so we override segment size.
  const result = await buildLateInteractionIndex(allChunks, false, [], {
    poolFactor: 1,
    extendedSkiplist: false,
    loadFromPath: DB_PATHS.lateInteraction,
    saveToPath: DB_PATHS.lateInteraction,
    fullRebuild: true,
    workerCount: 1,
    threadsPerWorker: 0,
    batchSize: resourcePlan.lateInteractionBatchSize,
    batchSizeUpperCap: resourcePlan.lateInteractionBatchSizeUpperCap,
    tokenBudget: resourcePlan.lateInteractionTokenBudget,
    attentionBudget: resourcePlan.lateInteractionAttentionBudget,
    segmentSize: 200_000, // > corpus size → legacy JSON format with metadata
    projectRoot: PROJECT_ROOT, // LI skip policy loads .sweet-search.config.json from here
  });

  const liMs = Date.now() - tLi;
  const totalMs = Date.now() - t0;

  console.log('\n═'.repeat(70));
  console.log(`  LI build: ${(liMs/1000).toFixed(1)}s`);
  console.log(`  Total:    ${(totalMs/1000).toFixed(1)}s`);
  console.log(`  Result:   ${result?.documents || result?.added || '?'} docs`);
  console.log('═'.repeat(70));
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  console.error(err.stack);
  process.exit(1);
});

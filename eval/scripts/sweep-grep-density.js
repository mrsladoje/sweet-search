#!/usr/bin/env node
/**
 * Sweep grep density alpha + query enhancement for ColGrep pattern search.
 * Tests combinations to find optimal configuration.
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;

import SweetSearch from '../../core/search/sweet-search.js';
import { encodeQuery } from '../../core/ranking/late-interaction-model.js';
import { loadJsonl } from '../lib/data-loader.js';
import { computeMetrics } from '../lib/metrics.js';
import {
  evaluatePatternQuery, getRelevantChunkIds,
} from '../lib/pattern-evaluator.js';

// Warmup
console.log('Warming...');
const search = new SweetSearch();
await search.init();
await encodeQuery('warmup');
console.log('Ready.\n');

const splitArg = process.argv.find(a => a.startsWith('--split='));
const split = splitArg ? splitArg.split('=')[1] : 'dev';
let queries = loadJsonl(path.join(PROJECT_ROOT, 'eval/data/pattern-benchmark/queries.jsonl'));
if (split !== 'all') queries = queries.filter(q => q.split === split);
for (const q of queries) getRelevantChunkIds(q);
console.log(`Queries: ${queries.length} (split: ${split} — sweeps use dev by default)`);

const alphas = [0, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3];
const enhanceModes = [false, true];

async function runSweep(enhance, alpha) {
  const results = [];
  for (const q of queries) {
    const { results: searchResults, stats } = await search.search(q.semantic_query, {
      k: 10,
      mode: 'pattern',
      regex: q.regex,
      rerank: true,
      expand: false,
      grepDensityAlpha: alpha,
      enhanceQuery: enhance,
    });

    const evaluated = evaluatePatternQuery(q, searchResults.map(r => ({
      id: r.id || '',
      file: r.file || '',
      name: r.name || '',
      score: r.score || 0,
      type: r.type || '',
    })));
    evaluated.latencyMs = stats?.total_ms || 0;
    results.push(evaluated);
  }
  return computeMetrics(results);
}

// Run sweeps
for (const enhance of enhanceModes) {
  const label = enhance ? 'ENHANCED (regex tokens merged into query)' : 'PLAIN (separate regex + semantic)';
  console.log(`\n══ ${label} ══`);
  console.log('α'.padStart(6) + 'MRR@10'.padStart(10) + 'R@5'.padStart(8) + 'R@10'.padStart(8) + 'S@1'.padStart(8) + 'p50ms'.padStart(8));
  console.log('-'.repeat(48));

  for (const alpha of alphas) {
    const m = await runSweep(enhance, alpha);
    console.log(
      String(alpha).padStart(6) +
      `${(m.mrr_at_10 * 100).toFixed(1)}%`.padStart(10) +
      `${(m.recall_at_5 * 100).toFixed(1)}%`.padStart(8) +
      `${(m.recall_at_10 * 100).toFixed(1)}%`.padStart(8) +
      `${(m.success_at_1 * 100).toFixed(1)}%`.padStart(8) +
      `${m.latency_p50_ms.toFixed(0)}`.padStart(8)
    );
  }
}

search.close?.();

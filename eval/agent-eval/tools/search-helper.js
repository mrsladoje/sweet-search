#!/usr/bin/env node
/**
 * Lightweight search helper for B2 evaluation.
 * Called by the claude CLI agent via Bash.
 * Reuses a single SweetSearch instance per process.
 *
 * Usage:
 *   node eval/agent-eval/tools/search-helper.js --repo=fastify --query="HTTP server" --regex="function\s+\w+" [--format=agent] [--k=5]
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

const args = process.argv.slice(2);
const opts = {};
for (const arg of args) {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  opts[key] = rest.join('=') || 'true';
}

if (!opts.repo || !opts.query) {
  console.error('Usage: --repo=NAME --query="..." --regex="..." [--format=agent] [--k=5]');
  process.exit(1);
}

const repoRoot = opts.repo === 'sweet-search' ? ROOT : path.resolve(ROOT, 'eval/repos', opts.repo);
const ssDir = path.join(repoRoot, '.sweet-search');

process.env.SWEET_SEARCH_PROJECT_ROOT = repoRoot;

const SweetSearch = (await import('../../../core/search/index.js')).default;
const search = new SweetSearch({
  projectRoot: repoRoot,
  graphDbPath: path.join(ssDir, 'code-graph.db'),
  hnswPath: path.join(ssDir, 'codebase-hnsw.idx'),
  binaryHnswPath: path.join(ssDir, 'codebase-binary-hnsw.idx'),
  codebaseDbPath: path.join(ssDir, 'codebase.db'),
  sparseGramIndexPath: path.join(ssDir, 'codebase-sparse-grams.idx'),
  lateInteractionOptions: { indexPath: path.join(ssDir, 'codebase-late-interaction.db') },
});
await search.init();

const result = await search.search(opts.query, {
  k: parseInt(opts.k || '5'),
  mode: 'pattern',
  regex: opts.regex || '\\w+',
  format: opts.format || 'benchmark',
});

// Output compact JSON
if (result.format === 'agent') {
  console.log(JSON.stringify({
    confidence: result.confidence,
    sufficient: result.sufficient,
    tokensUsed: result.tokensUsed,
    results: (result.results || []).map(r => ({
      rank: r.rank,
      file: r.file,
      startLine: r.startLine,
      endLine: r.endLine,
      score: r.score,
      symbol: r.symbol,
      presentation: r.presentation,
      code: r.code?.slice(0, 3000) || null,
      summary: r.summary || null,
    })),
  }));
} else {
  console.log(JSON.stringify({
    results: (result.results || []).slice(0, parseInt(opts.k || '5')).map(r => ({
      file: r.file,
      startLine: r.startLine,
      endLine: r.endLine,
      score: r.score,
      name: r.name,
    })),
  }));
}

search.close();

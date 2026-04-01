#!/usr/bin/env node
/**
 * Analyze failing queries across all benchmark repos.
 * Shows: query, gold chunk, top-3 returned chunks, failure mode, and likely cause.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

import SweetSearch from '../../core/search/sweet-search.js';
import { encodeQuery } from '../../core/ranking/late-interaction-model.js';
import { evaluatePatternQuery, getRelevantChunkIds, classifyFailure, chunksMatch } from '../lib/pattern-evaluator.js';

const repos = [
  { name: 'sweet-search', queryFile: 'eval/data/pattern-benchmark/queries.jsonl', projectRoot: '.' },
  { name: 'ripgrep', queryFile: 'eval/data/pattern-benchmark-ripgrep/queries.jsonl', projectRoot: 'eval/repos/ripgrep' },
  { name: 'gin', queryFile: 'eval/data/pattern-benchmark-gin/queries.jsonl', projectRoot: 'eval/repos/gin' },
  { name: 'flask', queryFile: 'eval/data/pattern-benchmark-flask/queries.jsonl', projectRoot: 'eval/repos/flask' },
  { name: 'fastify', queryFile: 'eval/data/pattern-benchmark-fastify/queries.jsonl', projectRoot: 'eval/repos/fastify' },
];

const MAX_FAILURES = parseInt(process.argv.find(a => a.startsWith('--max='))?.split('=')[1] || '10');

// Warmup
process.env.SWEET_SEARCH_PROJECT_ROOT = ROOT;
const warmSearch = new SweetSearch();
await warmSearch.init();
await encodeQuery('warmup');
warmSearch.close?.();

for (const repo of repos) {
  const projectRoot = path.resolve(ROOT, repo.projectRoot);
  const queryFile = path.resolve(ROOT, repo.queryFile);
  if (!fs.existsSync(queryFile)) continue;

  const ssDir = path.join(projectRoot, '.sweet-search');
  const search = new SweetSearch({
    projectRoot,
    graphDbPath: path.join(ssDir, 'code-graph.db'),
    hnswPath: path.join(ssDir, 'codebase-hnsw.idx'),
    binaryHnswPath: path.join(ssDir, 'codebase-binary-hnsw.idx'),
    codebaseDbPath: path.join(ssDir, 'codebase.db'),
    lateInteractionOptions: { indexPath: path.join(ssDir, 'codebase-late-interaction.db') },
  });
  await search.init();

  const queries = fs.readFileSync(queryFile, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const valid = queries.filter(q => q.relevant_chunk_ids?.length > 0);

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${repo.name.toUpperCase()} — FAILURE ANALYSIS (up to ${MAX_FAILURES})`);
  console.log('═'.repeat(70));

  let failCount = 0;

  for (const q of valid) {
    if (failCount >= MAX_FAILURES) break;

    try {
      const { results: sr, stats } = await search.search(q.semantic_query, {
        k: 10, mode: 'pattern', regex: q.regex, rerank: true, expand: false,
      });

      const mapped = sr.map(r => ({
        id: r.id || '', file: r.file || '', name: r.name || '',
        score: r.score || 0, type: r.type || '',
        startLine: r.startLine, endLine: r.endLine,
      }));

      const e = evaluatePatternQuery(q, mapped);
      const goldIds = new Set(getRelevantChunkIds(q));
      const mode = classifyFailure(e, stats, goldIds);

      if (mode === 'hit') continue; // Skip successes

      failCount++;
      const goldList = [...goldIds];

      // Check if gold is in top-20 (beyond our k=10)
      let goldRank = -1;
      for (let i = 0; i < mapped.length; i++) {
        for (const gid of goldList) {
          if (chunksMatch(gid, mapped[i])) { goldRank = i + 1; break; }
        }
        if (goldRank > 0) break;
      }

      console.log(`\n  [${q.query_id}] ${mode.toUpperCase()}`);
      console.log(`  regex: ${q.regex}`);
      console.log(`  query: ${q.semantic_query}`);
      console.log(`  gold:  ${goldList.join(', ')}`);
      console.log(`  grep matches: ${stats?.grepMatches || '?'}, candidates: ${stats?.maxSimCandidates || '?'}`);

      if (mapped.length > 0) {
        console.log(`  top-3 returned:`);
        for (let i = 0; i < Math.min(3, mapped.length); i++) {
          const r = mapped[i];
          const isGold = goldList.some(g => chunksMatch(g, r));
          console.log(`    ${i+1}. ${r.id} (score=${r.score.toFixed(3)}) ${r.name ? '['+r.name+']' : ''} ${isGold ? '✓ GOLD' : ''}`);
        }
      } else {
        console.log(`  (no results returned)`);
      }

      if (goldRank > 0) {
        console.log(`  → gold at rank ${goldRank} (outside top-k)`);
      }

      // Diagnose likely cause
      if (mode === 'regex_miss') {
        console.log(`  CAUSE: Regex didn't match any line in the gold chunk's file, or chunk boundary gap`);
      } else if (mode === 'rerank_miss') {
        console.log(`  CAUSE: Gold was in candidates but MaxSim ranked it below top-10`);
      } else if (mode === 'mapping_miss') {
        console.log(`  CAUSE: Grep found the file but chunk had no LI embedding`);
      }

    } catch (err) {
      failCount++;
      console.log(`\n  [${q.query_id}] ERROR: ${err.message}`);
    }
  }

  if (failCount === 0) console.log('\n  No failures!');
  search.close?.();
}

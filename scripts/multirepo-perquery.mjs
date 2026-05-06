#!/usr/bin/env node
/**
 * Per-query multirepo bench dump.
 * Outputs JSON: { commit, results: [{ id, repo, query, regex, gold:[chunk_ids], top3:[{file,name,score,_anchorInjected}], rrAt10 }] }
 *
 * Loads SweetSearch via relative import from cwd, so when run from a worktree
 * checkout it picks up that commit's source.
 *
 * Usage: node scripts/multirepo-perquery.mjs --tag=ac280d4 --out=scripts/multirepo-ac280d4.json [--split=dev]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SweetSearch from '../core/search/index.js';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function args() {
  const a = process.argv.slice(2);
  const o = { tag: 'unknown', out: null, split: null, anchor: null };
  for (const x of a) {
    if (x.startsWith('--tag=')) o.tag = x.slice(6);
    else if (x.startsWith('--out=')) o.out = x.slice(6);
    else if (x.startsWith('--split=')) o.split = x.slice(8);
    else if (x === '--anchor=on') o.anchor = 'on';
    else if (x === '--anchor=off') o.anchor = 'off';
  }
  return o;
}

function loadSplit(name) {
  const p = path.join(ROOT, 'eval/splits/multirepo', `${name}.json`);
  if (!fs.existsSync(p)) return null;
  return new Set(JSON.parse(fs.readFileSync(p, 'utf8')).ids);
}

const REPOS = [
  { name: 'fastify',  queryFile: 'eval/data/pattern-benchmark-fastify/queries.jsonl', root: 'eval/repos/fastify' },
  { name: 'flask',    queryFile: 'eval/data/pattern-benchmark-flask/queries.jsonl',   root: 'eval/repos/flask' },
  { name: 'gin',      queryFile: 'eval/data/pattern-benchmark-gin/queries.jsonl',     root: 'eval/repos/gin' },
  { name: 'ripgrep',  queryFile: 'eval/data/pattern-benchmark-ripgrep/queries.jsonl', root: 'eval/repos/ripgrep' },
];

function rrAt10(top, gold) {
  if (!gold || !gold.length) return 0;
  const g = new Set(gold);
  for (let i = 0; i < Math.min(10, top.length); i++) {
    if (g.has(top[i].id)) return 1 / (i + 1);
  }
  return 0;
}

async function main() {
  const o = args();
  const splitIds = o.split ? loadSplit(o.split) : null;
  const commit = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch { return 'nogit'; } })();

  // Force-enable anchor for "on", disable for "off". Otherwise default.
  if (o.anchor === 'on') process.env.SWEET_SEARCH_ANCHOR_INJECTION = '1';

  const allResults = [];
  for (const repo of REPOS) {
    const projectRoot = path.resolve(ROOT, repo.root);
    const qf = path.resolve(ROOT, repo.queryFile);
    if (!fs.existsSync(qf)) continue;

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

    let queries = fs.readFileSync(qf, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    if (splitIds) queries = queries.filter(q => splitIds.has(q.query_id));
    queries = queries.filter(q => q.relevant_chunk_ids?.length > 0);

    process.stderr.write(`[${repo.name}] ${queries.length} queries\n`);
    let i = 0;
    for (const q of queries) {
      const opts = { k: 10, mode: 'pattern', regex: q.regex, rerank: true, expand: false };
      if (o.anchor === 'off') opts.ablations = new Set(['no-anchor-injection']);
      let sr = [];
      try {
        const r = await search.search(q.semantic_query, opts);
        sr = r.results || [];
      } catch (e) {
        sr = [];
      }
      const top = sr.slice(0, 5).map(r => ({
        id: r.id || '',
        file: r.file || r.metadata?.file || '',
        name: r.name || r.metadata?.name || '',
        type: r.type || r.metadata?.type || '',
        score: Number((r.score || 0).toFixed(4)),
        anchor: !!r._anchorInjected || !!r._anchorBoosted ? (r._anchorInjected ? 'inject' : 'boost') : null,
      }));
      const gold = q.relevant_chunk_ids || [];
      allResults.push({
        query_id: q.query_id,
        repo: repo.name,
        query: q.semantic_query,
        regex: q.regex,
        gold,
        top,
        rr10: rrAt10(top.length ? sr.slice(0, 10) : [], gold),
        success1: top[0] && gold.includes(top[0].id) ? 1 : 0,
      });
      i++;
      if (i % 30 === 0) process.stderr.write(`  ${i}/${queries.length}\n`);
    }
    try { search.close?.(); } catch {}
  }

  const summary = {
    commit, tag: o.tag, anchor: o.anchor, split: o.split,
    n: allResults.length,
    mrr10: allResults.reduce((s, r) => s + r.rr10, 0) / Math.max(1, allResults.length),
    s1: allResults.reduce((s, r) => s + r.success1, 0) / Math.max(1, allResults.length),
  };
  const payload = { summary, results: allResults };
  if (o.out) fs.writeFileSync(o.out, JSON.stringify(payload, null, 2));
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

main().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/**
 * Summarize miss-trace JSONL/JSON output into markdown.
 *
 * Usage:
 *   node eval/miss-analysis/summarize.js --benchmark=graph2hop
 *   node eval/miss-analysis/summarize.js --benchmark=gencodesearchnet
 *   node eval/miss-analysis/summarize.js --benchmark=both
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { benchmark: 'both', dir: __dirname };
  for (const a of args) {
    if (a.startsWith('--benchmark=')) opts.benchmark = a.split('=')[1];
    else if (a.startsWith('--dir=')) opts.dir = path.resolve(a.split('=')[1]);
  }
  return opts;
}

function fmtPct(x, digits = 2) { return `${(x * 100).toFixed(digits)}%`; }

function head(s, n = 80) { return (s || '').replace(/\s+/g, ' ').slice(0, n); }

function summarizeGraph2hop(records, meta) {
  const lines = [];
  lines.push('# Graph-2hop Real-Repo Miss Summary');
  lines.push('');
  lines.push(`Generated: ${meta.generatedAt}`);
  lines.push(`Total queries: ${records.length}`);
  lines.push(`Repos: ${meta.options.repos.join(', ')}`);
  lines.push(`Mode A (none): graphExpand=none, expand=false`);
  lines.push(`Mode B (2hop-adaptive): graphExpand=2hop, adaptiveHop2=true, expand=true`);
  lines.push(`use3Stage=false (test repos have mixed-dim float vectors → cascade off)`);
  lines.push('');

  const ok = records.filter(r => !r.error_none && !r.error_expand);

  // Headline
  const r1None = ok.filter(r => r.rankNone === 1).length;
  const r1Exp  = ok.filter(r => r.rankExpand === 1).length;
  const r10None = ok.filter(r => r.rankNone > 0 && r.rankNone <= 10).length;
  const r10Exp  = ok.filter(r => r.rankExpand > 0 && r.rankExpand <= 10).length;
  const rescue = ok.filter(r => r.rescue).length;
  const harm   = ok.filter(r => r.harm).length;
  const sameRank = ok.filter(r => r.rankNone === r.rankExpand).length;
  const expandedRan = ok.filter(r => (r.graphExpansion?.expanded ?? 0) > 0).length;
  const goldByGraph = ok.filter(r => r.goldAddedByExpansion).length;

  lines.push('## Headline numbers');
  lines.push('');
  lines.push('| metric | mode A (none) | mode B (2hop-adaptive) |');
  lines.push('|---|---|---|');
  lines.push(`| Recall@1  | ${r1None}/${ok.length} (${fmtPct(r1None/ok.length)}) | ${r1Exp}/${ok.length} (${fmtPct(r1Exp/ok.length)}) |`);
  lines.push(`| Recall@10 | ${r10None}/${ok.length} (${fmtPct(r10None/ok.length)}) | ${r10Exp}/${ok.length} (${fmtPct(r10Exp/ok.length)}) |`);
  lines.push('');
  lines.push(`Rescue (mode B top10 but mode A miss): **${rescue}**`);
  lines.push(`Harm (mode A top10 but mode B miss): **${harm}**`);
  lines.push(`Identical rank in both modes: **${sameRank}**/${ok.length}`);
  lines.push(`Queries where graph expansion produced any surviving expanded entry: **${expandedRan}**/${ok.length}`);
  lines.push(`Queries where gold was *added by expansion* (is_expanded=true): **${goldByGraph}**/${ok.length}`);
  lines.push('');

  // Bucket counts
  const bucketCounts = {};
  for (const r of ok) bucketCounts[r.bucket] = (bucketCounts[r.bucket] || 0) + 1;
  const repoBuckets = {};
  for (const r of ok) {
    repoBuckets[r.repo] = repoBuckets[r.repo] || {};
    repoBuckets[r.repo][r.bucket] = (repoBuckets[r.repo][r.bucket] || 0) + 1;
  }

  lines.push('## Buckets (mode B, 2hop-adaptive)');
  lines.push('');
  lines.push('| bucket | count | share |');
  lines.push('|---|---|---|');
  for (const [b, n] of Object.entries(bucketCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${b} | ${n} | ${fmtPct(n / ok.length)} |`);
  }
  lines.push('');

  // Per-repo
  lines.push('## Per-repo bucket distribution');
  lines.push('');
  lines.push('| repo | hit_top10 | reranker_demoted | mode_b_pushed_off | graph_seed_missing | graph_added_lost | other |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const repo of Object.keys(repoBuckets).sort()) {
    const b = repoBuckets[repo];
    const other = Object.keys(b).filter(k =>
      !['hit_top10','reranker_demoted_gold','mode_b_pushed_gold_off','graph_seed_missing','graph_added_gold_but_reranker_lost'].includes(k)
    ).reduce((s, k) => s + b[k], 0);
    lines.push(`| ${repo} | ${b.hit_top10 || 0} | ${b.reranker_demoted_gold || 0} | ${b.mode_b_pushed_gold_off || 0} | ${b.graph_seed_missing || 0} | ${b.graph_added_gold_but_reranker_lost || 0} | ${other} |`);
  }
  lines.push('');

  // Category breakdown (calls/validator/etc.)
  const catBuckets = {};
  for (const r of ok) {
    catBuckets[r.category] = catBuckets[r.category] || { total: 0, hit: 0 };
    catBuckets[r.category].total++;
    if (r.bucket === 'hit_top10') catBuckets[r.category].hit++;
  }
  lines.push('## Top-10 hit rate by category');
  lines.push('');
  lines.push('| category | hits/total | rate |');
  lines.push('|---|---|---|');
  for (const c of Object.keys(catBuckets).sort()) {
    const b = catBuckets[c];
    lines.push(`| ${c} | ${b.hit}/${b.total} | ${fmtPct(b.hit/b.total)} |`);
  }
  lines.push('');

  // Graph-expansion behavior summary
  const meanExpanded = ok.reduce((s, r) => s + (r.graphExpansion?.expanded || 0), 0) / ok.length;
  const meanLiPool   = ok.reduce((s, r) => s + (r.liStatsExpand?.candidates || 0), 0) / ok.length;
  const meanLiExpInPool = ok.reduce((s, r) => s + (r.liStatsExpand?.expandedInPool || 0), 0) / ok.length;
  lines.push('## Graph expansion behavior');
  lines.push('');
  lines.push(`- mean expanded entries surviving in result list: **${meanExpanded.toFixed(3)}**`);
  lines.push(`- mean LI rerank pool size: **${meanLiPool.toFixed(2)}**`);
  lines.push(`- mean expanded-in-pool slot usage: **${meanLiExpInPool.toFixed(3)}**`);
  lines.push(`- queries with cascade actually invoked: **${ok.filter(r => r.cascadeStatsExpand?.ceInvoked).length}**`);
  lines.push('');
  lines.push('Interpretation: under the validated graph benchmark profile (use3Stage=false because test repos have mixed-dim float vectors), the cascade rerank never runs and graph expansion contributes ~0 entries per query. **Mode B output is essentially identical to mode A output.**');
  lines.push('');

  // Representative misses — pick top 15
  lines.push('## Representative misses (15)');
  lines.push('');
  const representative = [];
  // 5 reranker_demoted_gold, 5 mode_b_pushed_gold_off, 5 graph_seed_missing
  for (const bucket of ['reranker_demoted_gold', 'mode_b_pushed_gold_off', 'graph_seed_missing', 'graph_added_gold_but_reranker_lost', 'graph_edge_missing']) {
    const sample = ok.filter(r => r.bucket === bucket).slice(0, 5);
    for (const r of sample) representative.push(r);
    if (representative.length >= 15) break;
  }
  for (const r of representative.slice(0, 15)) {
    lines.push(`### ${r.id} [${r.bucket}] (${r.repo}, ${r.category}, expected_hops=${r.expectedHops})`);
    lines.push(`- **query**: ${head(r.query, 160)}`);
    lines.push(`- **gold**: ${r.goldFiles.join(', ')} ${r.goldSymbols ? `(symbols: ${r.goldSymbols.join(', ')})` : ''}`);
    lines.push(`- **rankNone=${r.rankNone}, rankExpand=${r.rankExpand}, goldAddedByExpansion=${r.goldAddedByExpansion}**`);
    if (r.graphExpansion) {
      lines.push(`- expansion: mode=${r.graphExpansion.mode}, expanded=${r.graphExpansion.expanded}, expandedWithLiChunk=${r.graphExpansion.expandedWithLiChunk}`);
    }
    lines.push(`- top-3 (mode B): ${r.topExpand.slice(0, 3).map(t => `${t.file} (${t.score.toFixed(3)}${t.is_expanded ? ',exp' : ''})`).join(' | ')}`);
    lines.push('');
  }

  return lines.join('\n');
}

function summarizeGcsn(records, meta) {
  const lines = [];
  lines.push('# GenCodeSearchNet Dense Profile Miss Summary');
  lines.push('');
  lines.push(`Generated: ${meta.generatedAt}`);
  lines.push(`Total queries: ${records.length}  errors: ${meta.errors || 0}`);
  lines.push(`Profile: graphExpand=${meta.options.graphExpand}, stage3Candidates=${meta.options.stage3Candidates}, k=${meta.options.k}`);
  lines.push(`Second pass (rerank=false) for misses: ${meta.options.secondPass}`);
  lines.push('');

  const ok = records.filter(r => !r.error);
  const m = meta.metrics || {};
  lines.push('## Headline metrics');
  lines.push('');
  lines.push(`- MRR@10: **${fmtPct(m.mrr_at_10 || 0)}**`);
  lines.push(`- Recall@10: ${fmtPct(m.recall_at_10 || 0)}, Recall@50: ${fmtPct(m.recall_at_50 || 0)}, Recall@100: ${fmtPct(m.recall_at_100 || 0)}`);
  lines.push('');

  // Buckets
  const bucketCounts = {};
  for (const r of ok) bucketCounts[r.bucket] = (bucketCounts[r.bucket] || 0) + 1;
  lines.push('## Buckets');
  lines.push('');
  lines.push('| bucket | count | share |');
  lines.push('|---|---|---|');
  for (const [b, n] of Object.entries(bucketCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${b} | ${n} | ${fmtPct(n / ok.length)} |`);
  }
  lines.push('');

  // Per-language
  const langs = {};
  for (const r of ok) {
    const l = r.language || 'unknown';
    langs[l] = langs[l] || { total: 0, hit_top1: 0, hit_top10: 0, miss: 0 };
    langs[l].total++;
    if (r.bucket === 'hit_top1') langs[l].hit_top1++;
    if (r.bucket === 'hit_top1' || r.bucket === 'hit_top10') langs[l].hit_top10++;
    else langs[l].miss++;
  }
  lines.push('## Per-language hit rate');
  lines.push('');
  lines.push('| language | total | top1 | top1 rate | top10 rate | miss rate |');
  lines.push('|---|---|---|---|---|---|');
  for (const l of Object.keys(langs).sort()) {
    const x = langs[l];
    lines.push(`| ${l} | ${x.total} | ${x.hit_top1} | ${fmtPct(x.hit_top1 / x.total)} | ${fmtPct(x.hit_top10 / x.total)} | ${fmtPct(x.miss / x.total)} |`);
  }
  lines.push('');

  // Per-language miss bucket distribution
  const langMissBuckets = {};
  for (const r of ok) {
    if (r.bucket === 'hit_top1' || r.bucket === 'hit_top10') continue;
    const l = r.language || 'unknown';
    langMissBuckets[l] = langMissBuckets[l] || {};
    langMissBuckets[l][r.bucket] = (langMissBuckets[l][r.bucket] || 0) + 1;
  }
  lines.push('## Miss-bucket distribution per language');
  lines.push('');
  const allBuckets = new Set();
  for (const l of Object.keys(langMissBuckets)) for (const b of Object.keys(langMissBuckets[l])) allBuckets.add(b);
  const bucketOrder = [...allBuckets];
  lines.push(`| language | ${bucketOrder.join(' | ')} |`);
  lines.push(`|---|${bucketOrder.map(() => '---').join('|')}|`);
  for (const l of Object.keys(langMissBuckets).sort()) {
    const row = bucketOrder.map(b => langMissBuckets[l][b] || 0);
    lines.push(`| ${l} | ${row.join(' | ')} |`);
  }
  lines.push('');

  // Query-shape hit-rate
  const shapes = {};
  for (const r of ok) {
    const s = r.queryShape || 'normal';
    shapes[s] = shapes[s] || { total: 0, hit_top1: 0, hit_top10: 0 };
    shapes[s].total++;
    if (r.bucket === 'hit_top1') shapes[s].hit_top1++;
    if (r.bucket === 'hit_top1' || r.bucket === 'hit_top10') shapes[s].hit_top10++;
  }
  lines.push('## Query shape vs hit rate');
  lines.push('');
  lines.push('| shape | total | top1 rate | top10 rate |');
  lines.push('|---|---|---|---|');
  for (const s of Object.keys(shapes).sort()) {
    const x = shapes[s];
    lines.push(`| ${s} | ${x.total} | ${fmtPct(x.hit_top1 / x.total)} | ${fmtPct(x.hit_top10 / x.total)} |`);
  }
  lines.push('');

  // Reps
  lines.push('## Representative misses (20)');
  lines.push('');
  const rep = [];
  for (const bucket of [
    'gold_not_in_top100_candidate_generation',
    'gold_in_100_but_not_rerank_window',
    'reranker_demoted_gold',
    'gold_present_but_not_top10',
  ]) {
    const sample = ok.filter(r => r.bucket === bucket).slice(0, 5);
    for (const r of sample) rep.push(r);
    if (rep.length >= 20) break;
  }
  for (const r of rep.slice(0, 20)) {
    lines.push(`### ${r.queryId} [${r.bucket}] (${r.language}, shape=${r.queryShape})`);
    lines.push(`- **query**: ${head(r.query, 160)}`);
    lines.push(`- **gold**: ${r.expected.map(e => path.basename(e.filePath || '')).join(', ')} (funcs: ${r.expected.map(e => e.funcName).filter(Boolean).join(', ')})`);
    lines.push(`- **rankFinal=${r.goldRankFinal}, rankNoRerank=${r.goldRankNoRerank}**`);
    lines.push(`- top-3: ${r.top10.slice(0, 3).map(t => `${path.basename(t.file)} (${t.score.toFixed(3)})`).join(' | ')}`);
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const opts = parseArgs();
  const dir = opts.dir;

  if (opts.benchmark === 'graph2hop' || opts.benchmark === 'both') {
    const file = path.join(dir, 'graph2hop_records.json');
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const md = summarizeGraph2hop(data.records, data.meta);
      const out = path.join(dir, 'graph2hop_summary.md');
      fs.writeFileSync(out, md);
      console.log(`wrote ${out}`);
    } else {
      console.error(`missing ${file}`);
    }
  }

  if (opts.benchmark === 'gencodesearchnet' || opts.benchmark === 'both') {
    const file = path.join(dir, 'gencodesearchnet_records.json');
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const md = summarizeGcsn(data.records, data.meta);
      const out = path.join(dir, 'gencodesearchnet_summary.md');
      fs.writeFileSync(out, md);
      console.log(`wrote ${out}`);
    } else {
      console.error(`missing ${file}`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });

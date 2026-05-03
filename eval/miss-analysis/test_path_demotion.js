#!/usr/bin/env node
/**
 * Offline test: rerank graph2hop_records.json's existing top-10 lists by
 * applying a path/file-type demotion rule, then recompute Recall@10 / MRR /
 * rescue / harm. No production code is modified.
 *
 * Demotion rule (default):
 *   - .md, /docs/, .rst                 → multiply score by 0.4 unless query is "doc-seeking"
 *   - /test/, /tests/, .test.js, _spec  → multiply score by 0.4 unless query is "test-seeking"
 *   - .d.ts, /types/                    → multiply score by 0.5 unless query is "type-seeking"
 *
 * "Seeking" detection is naive (keyword in query): "documentation","docs","example","test","spec","fixture","type","interface","declaration".
 *
 * Outputs:
 *   eval/miss-analysis/path_demotion_report.md
 *
 * Usage:
 *   node eval/miss-analysis/test_path_demotion.js
 *   node eval/miss-analysis/test_path_demotion.js --records=path/to/records.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    records: path.join(__dirname, 'graph2hop_records.json'),
    out: path.join(__dirname, 'path_demotion_report.md'),
    docFactor: 0.4,
    testFactor: 0.4,
    typeFactor: 0.5,
  };
  for (const a of args) {
    if (a.startsWith('--records=')) opts.records = path.resolve(a.split('=')[1]);
    else if (a.startsWith('--out=')) opts.out = path.resolve(a.split('=')[1]);
    else if (a.startsWith('--doc-factor=')) opts.docFactor = parseFloat(a.split('=')[1]);
    else if (a.startsWith('--test-factor=')) opts.testFactor = parseFloat(a.split('=')[1]);
    else if (a.startsWith('--type-factor=')) opts.typeFactor = parseFloat(a.split('=')[1]);
  }
  return opts;
}

const DOC_RE  = /\.md$|\.rst$|\/docs?\//i;
const TEST_RE = /\/tests?\/|\.test\.[a-z]+$|_test\.[a-z]+$|_spec\.rb$|\.spec\.[a-z]+$/i;
const TYPE_RE = /\.d\.ts$|\/types\//i;

function classifyQueryIntent(q) {
  const s = (q || '').toLowerCase();
  return {
    docs:  /\b(doc|docs|documentation|example|guide|reference)\b/.test(s),
    tests: /\b(test|tests|spec|specs|fixture|fixtures|mock)\b/.test(s),
    types: /\b(type|types|interface|declaration|signature)\b/.test(s),
  };
}

function pathKind(p) {
  if (!p) return null;
  if (DOC_RE.test(p))  return 'doc';
  if (TEST_RE.test(p)) return 'test';
  if (TYPE_RE.test(p)) return 'type';
  return null;
}

function applyDemotion(top10, query, opts) {
  const intent = classifyQueryIntent(query);
  // Compute new score for each entry, then re-sort.
  const scored = top10.map(t => {
    const kind = pathKind(t.file);
    let mult = 1;
    if (kind === 'doc'  && !intent.docs)  mult = opts.docFactor;
    else if (kind === 'test' && !intent.tests) mult = opts.testFactor;
    else if (kind === 'type' && !intent.types) mult = opts.typeFactor;
    return { ...t, _orig: t.score, _mult: mult, score: (t.score || 0) * mult, _kind: kind };
  });
  // Stable sort by score desc.
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function rankIn(list, expectedBasenames) {
  for (let i = 0; i < list.length; i++) {
    const f = list[i].file || '';
    if (!f) continue;
    if (expectedBasenames.has(path.basename(f))) return i + 1;
  }
  return -1;
}

function fmtPct(x) { return `${(x * 100).toFixed(2)}%`; }

async function main() {
  const opts = parseArgs();
  const data = JSON.parse(fs.readFileSync(opts.records, 'utf-8'));
  const records = data.records || [];

  let baseHit10 = 0, baseR1 = 0, demoteHit10 = 0, demoteR1 = 0, mrrBase = 0, mrrDemote = 0;
  let rescue = 0, harm = 0, sameRank = 0;
  let demotionFired = 0;
  const intentDist = { docs: 0, tests: 0, types: 0, none: 0 };
  const flips = [];

  for (const r of records) {
    if (r.error_none || r.error_expand) continue;
    // Use the production-mode top-10 (mode B, already includes graph expansion).
    const baselineTop10 = r.topExpand || [];
    const goldFiles = r.goldFiles || [];
    if (goldFiles.length === 0) continue;
    const goldBase = new Set(goldFiles.map(f => path.basename(f)));
    const intent = classifyQueryIntent(r.query);
    if (intent.docs) intentDist.docs++;
    else if (intent.tests) intentDist.tests++;
    else if (intent.types) intentDist.types++;
    else intentDist.none++;

    const baselineRank = rankIn(baselineTop10, goldBase);
    const demotedTop10 = applyDemotion(baselineTop10, r.query, opts);
    const demotedRank = rankIn(demotedTop10, goldBase);

    // Did the rule actually change anything?
    const fired = demotedTop10.some(t => t._mult !== 1);
    if (fired) demotionFired++;

    if (baselineRank > 0 && baselineRank <= 10) baseHit10++;
    if (demotedRank > 0 && demotedRank <= 10) demoteHit10++;
    if (baselineRank === 1) baseR1++;
    if (demotedRank === 1) demoteR1++;

    mrrBase   += baselineRank > 0 && baselineRank <= 10 ? 1 / baselineRank : 0;
    mrrDemote += demotedRank  > 0 && demotedRank  <= 10 ? 1 / demotedRank  : 0;

    const baseInTop10 = baselineRank > 0 && baselineRank <= 10;
    const demoteInTop10 = demotedRank > 0 && demotedRank <= 10;
    if (demoteInTop10 && !baseInTop10) rescue++;
    if (!demoteInTop10 && baseInTop10) harm++;
    if (baselineRank === demotedRank) sameRank++;

    if (baselineRank !== demotedRank) {
      flips.push({
        id: r.id,
        repo: r.repo,
        query: r.query,
        baseRank: baselineRank,
        demoteRank: demotedRank,
        delta: (baselineRank > 0 && demotedRank > 0) ? baselineRank - demotedRank : null,
        baseTop3: baselineTop10.slice(0, 3).map(t => path.basename(t.file)),
        demoteTop3: demotedTop10.slice(0, 3).map(t => path.basename(t.file)),
        intent,
      });
    }
  }

  const ok = records.filter(r => !r.error_none && !r.error_expand && (r.goldFiles || []).length > 0).length;

  const lines = [];
  lines.push('# Path/file-type demotion offline test');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Records source: ${path.basename(opts.records)}  (${ok} usable)`);
  lines.push(`Demotion factors: doc=${opts.docFactor}, test=${opts.testFactor}, type=${opts.typeFactor}`);
  lines.push('Intent gating: skip demotion when query mentions doc/test/type-seeking keywords.');
  lines.push('');
  lines.push('## Headline');
  lines.push('');
  lines.push('| metric | baseline | with demotion | delta |');
  lines.push('|---|---:|---:|---:|');
  lines.push(`| Recall@1  | ${baseR1}/${ok} (${fmtPct(baseR1/ok)}) | ${demoteR1}/${ok} (${fmtPct(demoteR1/ok)}) | ${demoteR1 - baseR1} |`);
  lines.push(`| Recall@10 | ${baseHit10}/${ok} (${fmtPct(baseHit10/ok)}) | ${demoteHit10}/${ok} (${fmtPct(demoteHit10/ok)}) | ${demoteHit10 - baseHit10} |`);
  lines.push(`| MRR@10    | ${fmtPct(mrrBase/ok)} | ${fmtPct(mrrDemote/ok)} | ${((mrrDemote - mrrBase)/ok >= 0 ? '+' : '') + (((mrrDemote - mrrBase)/ok) * 100).toFixed(2)}pp |`);
  lines.push('');
  lines.push(`Rescue (top10 with demotion that wasn't with baseline): **${rescue}**`);
  lines.push(`Harm (top10 with baseline that isn't with demotion): **${harm}**`);
  lines.push(`Identical rank in both: **${sameRank}**/${ok}`);
  lines.push(`Queries where the rule fired (any demotion in top10): **${demotionFired}**/${ok}`);
  lines.push('');
  lines.push('## Query intent distribution');
  lines.push('');
  lines.push('| intent | n |');
  lines.push('|---|---:|');
  lines.push(`| docs  | ${intentDist.docs} |`);
  lines.push(`| tests | ${intentDist.tests} |`);
  lines.push(`| types | ${intentDist.types} |`);
  lines.push(`| none  | ${intentDist.none} |`);
  lines.push('');
  lines.push('## Rank flips');
  lines.push('');
  lines.push(`Total queries with a different rank under demotion: **${flips.length}**`);
  lines.push('');
  if (flips.length) {
    const positive = flips.filter(f => f.delta != null && f.delta > 0);
    const negative = flips.filter(f => f.delta != null && f.delta < 0);
    const newHits = flips.filter(f => f.baseRank <= 0 && f.demoteRank > 0);
    const newMisses = flips.filter(f => f.baseRank > 0 && f.demoteRank <= 0);
    lines.push(`- gold rank improved (positive delta): ${positive.length}`);
    lines.push(`- gold rank worsened (negative delta): ${negative.length}`);
    lines.push(`- new gold-in-top10 (was ≤0 → now in): ${newHits.length}`);
    lines.push(`- new gold-not-in-top10 (was in → now out): ${newMisses.length}`);
    lines.push('');

    lines.push('### 10 representative flips');
    lines.push('');
    const sample = [...positive.slice(0, 5), ...negative.slice(0, 5)];
    for (const f of sample) {
      lines.push(`- \`${f.id}\` (${f.repo}) base=${f.baseRank} → demote=${f.demoteRank} (Δ=${f.delta != null ? f.delta : 'n/a'})`);
      lines.push(`  - query: *"${(f.query || '').replace(/\s+/g, ' ').slice(0, 100)}"*  intent={docs:${f.intent.docs?'y':'n'},tests:${f.intent.tests?'y':'n'},types:${f.intent.types?'y':'n'}}`);
      lines.push(`  - top3 base: \`${f.baseTop3.join(' | ')}\``);
      lines.push(`  - top3 demote: \`${f.demoteTop3.join(' | ')}\``);
    }
    lines.push('');
  }

  // Per-repo
  const perRepo = {};
  for (const r of records) {
    if (r.error_none || r.error_expand) continue;
    if (!r.repo) continue;
    perRepo[r.repo] = perRepo[r.repo] || { ok: 0, baseHit10: 0, demoteHit10: 0 };
    perRepo[r.repo].ok++;
    const baseTop10 = r.topExpand || [];
    const goldBase = new Set((r.goldFiles||[]).map(f => path.basename(f)));
    const baseRank = rankIn(baseTop10, goldBase);
    const demoteRank = rankIn(applyDemotion(baseTop10, r.query, opts), goldBase);
    if (baseRank > 0 && baseRank <= 10) perRepo[r.repo].baseHit10++;
    if (demoteRank > 0 && demoteRank <= 10) perRepo[r.repo].demoteHit10++;
  }
  lines.push('## Per-repo Recall@10');
  lines.push('');
  lines.push('| repo | n | baseline | with demotion | delta |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const repo of Object.keys(perRepo).sort()) {
    const p = perRepo[repo];
    lines.push(`| ${repo} | ${p.ok} | ${fmtPct(p.baseHit10/p.ok)} | ${fmtPct(p.demoteHit10/p.ok)} | ${p.demoteHit10 - p.baseHit10} |`);
  }
  lines.push('');

  fs.writeFileSync(opts.out, lines.join('\n'));
  console.log(`wrote ${opts.out}`);
  console.log(`Recall@10  ${fmtPct(baseHit10/ok)} → ${fmtPct(demoteHit10/ok)}   (Δ ${demoteHit10 - baseHit10})`);
  console.log(`MRR@10     ${fmtPct(mrrBase/ok)} → ${fmtPct(mrrDemote/ok)}`);
  console.log(`rescue=${rescue}  harm=${harm}  rule fired on ${demotionFired}/${ok}`);
}

main().catch(err => { console.error(err); process.exit(1); });

#!/usr/bin/env node
/**
 * stage1-2-filter-and-rates.mjs — Stage 1 (filter v1 JSONL to best-shape
 * per gold under the agentic strategy) + Stage 2 (per-language failure
 * rate with strict + relaxed metrics).
 *
 * Strategy "agentic":
 *   default V7 (medium declarative + symbol)
 *   override JS-mobile -> V2 (short interrogative + symbol)
 *   override C-family  -> V4 (medium interrogative + symbol)
 *
 * Also reports the popular_weighted V1 strategy as a comparison.
 *
 * Writes:
 *   core/prompt-optimization/data/query-shapes/ss-search/failure-analysis/
 *     stage1-best-shape-rows-agentic.jsonl
 *     stage1-best-shape-rows-popular.jsonl
 *     stage2-per-language.json
 *     stage2-per-language.md
 *
 * DEV ONLY for inspection. Held-out aggregates computed separately for the
 * Stage 7 milestone check.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');

const SPLITS = path.join(REPO_ROOT, 'eval/ast-tester-probes/splits/manifest.json');
const INPUTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/inputs');
const V1_JSONL = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/tracks/track-a-phase6-redo-v1.jsonl');
const OUT_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-search/failure-analysis');

const STRATEGIES = {
  agentic: {
    default: 'V7',
    byFamily: { 'JS-mobile': 'V2', 'C-family': 'V4' },
  },
  popular: {
    default: 'V1',
    byFamily: {},
  },
};

function loadSplit() {
  const m = JSON.parse(fs.readFileSync(SPLITS, 'utf8'));
  const dev = new Set();
  const heldout = new Set();
  for (const [, sp] of Object.entries(m.perLanguage || {})) {
    for (const id of sp.dev || []) dev.add(id);
    for (const id of sp.heldout || []) heldout.add(id);
  }
  return { dev, heldout };
}

function loadInputs() {
  const out = new Map();
  for (const n of fs.readdirSync(INPUTS_DIR)) {
    if (!n.endsWith('.json')) continue;
    const obj = JSON.parse(fs.readFileSync(path.join(INPUTS_DIR, n), 'utf8'));
    if (obj.goldId) out.set(obj.goldId, obj);
  }
  return out;
}

function readJsonl(p) {
  const out = [];
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}

function shapeForGold(family, strat) { return strat.byFamily[family] || strat.default; }

function main() {
  const { dev, heldout } = loadSplit();
  const inputs = loadInputs();
  const allRows = readJsonl(V1_JSONL);

  const byGold = new Map();
  for (const r of allRows) {
    if (!byGold.has(r.goldId)) byGold.set(r.goldId, []);
    byGold.get(r.goldId).push(r);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // For each strategy, produce the best-shape JSONL (dev + heldout, but report
  // per-language stats DEV ONLY).
  const strategyResults = {};
  for (const [stratName, strat] of Object.entries(STRATEGIES)) {
    const bestRows = [];
    for (const [goldId, rows] of byGold.entries()) {
      const input = inputs.get(goldId);
      if (!input) continue;
      // V1/V2/V4/V7 only run on ast-tester golds in v1 (DP golds use V3/V5/V6)
      if (input.goldClass !== 'ast-tester') continue;
      const shape = shapeForGold(input.family, strat);
      const row = rows.find(r => r.shape === shape);
      if (!row) continue;
      bestRows.push({
        ...row,
        _split: dev.has(goldId) ? 'dev' : (heldout.has(goldId) ? 'heldout' : 'unknown'),
        _strategy: stratName,
      });
    }
    const outPath = path.join(OUT_DIR, `stage1-best-shape-rows-${stratName}.jsonl`);
    fs.writeFileSync(outPath, bestRows.map(r => JSON.stringify(r)).join('\n') + '\n');

    // Per-language stats (DEV)
    const devRows = bestRows.filter(r => r._split === 'dev');
    const byLang = {};
    for (const r of devRows) {
      const lang = r.language;
      if (!byLang[lang]) byLang[lang] = { PASS: 0, PARTIAL: 0, FAIL: 0, rows: [], fileRecallAt5Hits: 0 };
      byLang[lang][r.verdict]++;
      byLang[lang].rows.push(r);
      if (r.fileRecallAt5 === 1) byLang[lang].fileRecallAt5Hits++;
    }
    // Per family
    const byFam = {};
    for (const r of devRows) {
      const f = r.family;
      if (!byFam[f]) byFam[f] = { PASS: 0, PARTIAL: 0, FAIL: 0, count: 0, fileRecallAt5Hits: 0 };
      byFam[f][r.verdict]++;
      byFam[f].count++;
      if (r.fileRecallAt5 === 1) byFam[f].fileRecallAt5Hits++;
    }
    // Overall
    const overall = { PASS: 0, PARTIAL: 0, FAIL: 0, total: 0, fileRecallAt5Hits: 0 };
    for (const r of devRows) {
      overall[r.verdict]++;
      overall.total++;
      if (r.fileRecallAt5 === 1) overall.fileRecallAt5Hits++;
    }
    strategyResults[stratName] = { perLanguage: byLang, perFamily: byFam, overall, jsonlOut: path.relative(REPO_ROOT, outPath) };
  }

  // Cross-strategy comparison: V7-fail vs V1-pass correlation hypothesis
  const agenticByGold = new Map();
  for (const line of fs.readFileSync(path.join(OUT_DIR, 'stage1-best-shape-rows-agentic.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line); agenticByGold.set(r.goldId, r);
  }
  const popularByGold = new Map();
  for (const line of fs.readFileSync(path.join(OUT_DIR, 'stage1-best-shape-rows-popular.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line); popularByGold.set(r.goldId, r);
  }
  const crossTab = {
    devOnly: { P_P: 0, P_partial: 0, P_fail: 0, partial_P: 0, partial_partial: 0, partial_fail: 0, fail_P: 0, fail_partial: 0, fail_fail: 0 },
    v7FailV1Pass: [],  // The hypothesis cases
    v7FailV1Anything: { PASS: 0, PARTIAL: 0, FAIL: 0 },
  };
  for (const [goldId, a] of agenticByGold.entries()) {
    if (a._split !== 'dev') continue;
    const p = popularByGold.get(goldId);
    if (!p || p._split !== 'dev') continue;
    const aVer = a.verdict, pVer = p.verdict;
    const key = `${aVer === 'PASS' ? 'P' : aVer === 'PARTIAL' ? 'partial' : 'fail'}_${pVer === 'PASS' ? 'P' : pVer === 'PARTIAL' ? 'partial' : 'fail'}`;
    if (crossTab.devOnly[key] != null) crossTab.devOnly[key]++;
    if (aVer === 'FAIL') {
      crossTab.v7FailV1Anything[pVer]++;
      if (pVer === 'PASS') {
        crossTab.v7FailV1Pass.push({
          goldId, language: a.language, family: a.family,
          agentic: { shape: a.shape, top1: a.top1, query: a.query },
          popular: { shape: p.shape, top1: p.top1, query: p.query },
        });
      }
    }
  }

  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strategies: strategyResults,
    crossTab,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'stage2-per-language.json'), JSON.stringify(summary, null, 2));

  // Markdown
  const lines = [];
  lines.push('# ss-search Stage 1-2 best-shape filter + per-language failure rates');
  lines.push('');
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push('');
  lines.push(`## Strategies`);
  lines.push(`- agentic: V7 default; V2 for JS-mobile; V4 for C-family`);
  lines.push(`- popular: V1 (≤3 tokens symbol-only)`);
  lines.push('');
  for (const [name, res] of Object.entries(strategyResults)) {
    lines.push(`## Strategy: ${name} (dev only, ast-tester only)`);
    lines.push('');
    lines.push(`Overall: PASS=${res.overall.PASS} PARTIAL=${res.overall.PARTIAL} FAIL=${res.overall.FAIL} / ${res.overall.total}; file_recall@5 hits=${res.overall.fileRecallAt5Hits}`);
    lines.push('');
    lines.push(`### Per family`);
    lines.push('');
    lines.push('| family | n | PASS | PARTIAL | FAIL | fail_pct | file_recall@5 |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const [fam, s] of Object.entries(res.perFamily).sort((a, b) => (b[1].FAIL / b[1].count) - (a[1].FAIL / a[1].count))) {
      const failPct = s.count ? (s.FAIL / s.count * 100).toFixed(1) : '-';
      const fr5 = s.count ? (s.fileRecallAt5Hits / s.count * 100).toFixed(1) : '-';
      lines.push(`| ${fam} | ${s.count} | ${s.PASS} | ${s.PARTIAL} | ${s.FAIL} | ${failPct}% | ${fr5}% |`);
    }
    lines.push('');
    lines.push(`### Per language (sorted by FAIL desc)`);
    lines.push('');
    lines.push('| language | family | PASS | PARTIAL | FAIL | file_recall@5 |');
    lines.push('|---|---|---|---|---|---|');
    const sortedLangs = Object.entries(res.perLanguage)
      .map(([k, v]) => ({ lang: k, ...v, family: v.rows[0]?.family || '?' }))
      .sort((a, b) => b.FAIL - a.FAIL);
    for (const lang of sortedLangs) {
      const fr5 = lang.PASS + lang.PARTIAL + lang.FAIL > 0
        ? (lang.fileRecallAt5Hits / (lang.PASS + lang.PARTIAL + lang.FAIL) * 100).toFixed(1)
        : '-';
      lines.push(`| ${lang.lang} | ${lang.family} | ${lang.PASS} | ${lang.PARTIAL} | ${lang.FAIL} | ${fr5}% |`);
    }
    lines.push('');
  }

  lines.push('## Cross-strategy: V7-FAIL vs V1-PASS hypothesis');
  lines.push('');
  lines.push('Cross-tabulation (dev only). Rows = agentic verdict, columns = popular verdict.');
  lines.push('');
  lines.push('| agentic\\popular | PASS | PARTIAL | FAIL |');
  lines.push('|---|---|---|---|');
  lines.push(`| PASS | ${crossTab.devOnly.P_P} | ${crossTab.devOnly.P_partial} | ${crossTab.devOnly.P_fail} |`);
  lines.push(`| PARTIAL | ${crossTab.devOnly.partial_P} | ${crossTab.devOnly.partial_partial} | ${crossTab.devOnly.partial_fail} |`);
  lines.push(`| FAIL | ${crossTab.devOnly.fail_P} | ${crossTab.devOnly.fail_partial} | ${crossTab.devOnly.fail_fail} |`);
  lines.push('');
  lines.push(`agentic-FAIL distribution under popular: ${JSON.stringify(crossTab.v7FailV1Anything)}`);
  lines.push('');
  if (crossTab.v7FailV1Pass.length) {
    lines.push(`### Agentic-FAIL but popular(V1)-PASS — ${crossTab.v7FailV1Pass.length} cases`);
    lines.push('');
    for (const c of crossTab.v7FailV1Pass) {
      lines.push(`- **${c.goldId}** (${c.language}/${c.family})`);
      lines.push(`  - agentic(${c.agentic.shape}): \`${c.agentic.top1?.file}\` :: \`${c.agentic.top1?.symbol}\` (query: ${c.agentic.query.slice(0, 80)})`);
      lines.push(`  - popular(V1): \`${c.popular.top1?.file}\` :: \`${c.popular.top1?.symbol}\` (query: ${c.popular.query})`);
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'stage2-per-language.md'), lines.join('\n'));

  // Console
  process.stdout.write(`\nWrote stage1 jsonls and stage2 outputs to ${path.relative(REPO_ROOT, OUT_DIR)}\n\n`);
  for (const [name, res] of Object.entries(strategyResults)) {
    process.stdout.write(`=== ${name} (dev) ===\n`);
    process.stdout.write(`  total=${res.overall.total} PASS=${res.overall.PASS} PARTIAL=${res.overall.PARTIAL} FAIL=${res.overall.FAIL}\n`);
    process.stdout.write(`  file_recall@5 hits=${res.overall.fileRecallAt5Hits} (${(res.overall.fileRecallAt5Hits/res.overall.total*100).toFixed(1)}%)\n\n`);
  }
  process.stdout.write(`Cross-tab (dev) agentic vs popular:\n`);
  process.stdout.write(`            popular=PASS  PARTIAL  FAIL\n`);
  process.stdout.write(`  agentic=PASS    ${String(crossTab.devOnly.P_P).padStart(4)}  ${String(crossTab.devOnly.P_partial).padStart(7)}  ${String(crossTab.devOnly.P_fail).padStart(4)}\n`);
  process.stdout.write(`  agentic=PART    ${String(crossTab.devOnly.partial_P).padStart(4)}  ${String(crossTab.devOnly.partial_partial).padStart(7)}  ${String(crossTab.devOnly.partial_fail).padStart(4)}\n`);
  process.stdout.write(`  agentic=FAIL    ${String(crossTab.devOnly.fail_P).padStart(4)}  ${String(crossTab.devOnly.fail_partial).padStart(7)}  ${String(crossTab.devOnly.fail_fail).padStart(4)}\n`);
  process.stdout.write(`\n  agentic-FAIL → popular-PASS: ${crossTab.v7FailV1Pass.length}/${crossTab.devOnly.fail_P + crossTab.devOnly.fail_partial + crossTab.devOnly.fail_fail} (the hypothesis cases)\n`);
}

main();

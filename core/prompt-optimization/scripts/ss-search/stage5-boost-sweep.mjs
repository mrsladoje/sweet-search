#!/usr/bin/env node
/**
 * stage5-boost-sweep.mjs — re-run the FULL agentic dev sweep (V7 default,
 * V2 JS-mobile, V4 C-family) on ss-search at multiple identifier-mention
 * boost values, and report PASS/PARTIAL/FAIL deltas.
 *
 * Boost values tested by default: 1.15 (current), 1.25, 1.30, 1.40
 *
 * Honors:
 *   - No regressions on probes (validated separately via run-probes.mjs)
 *   - Format-gated (boost only fires for format=agent — GCSN unaffected)
 *   - DEV ONLY; held-out aggregated separately at milestones
 *
 * Output:
 *   core/prompt-optimization/data/query-shapes/ss-search/failure-analysis/
 *     stage5-boost-sweep-{value}.jsonl
 *     stage5-boost-sweep-summary.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SweetSearch } from '../../../search/sweet-search.js';
import { gradeResult } from '../track-a-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SPLITS = path.join(REPO_ROOT, 'eval/ast-tester-probes/splits/manifest.json');
const REPOS_MANIFEST = path.join(REPO_ROOT, 'eval/ast-tester-probes/repos.json');
const INPUTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/inputs');
const VARIANTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/variants');
const OUT_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-search/failure-analysis');

const WINNERS = {
  default: 'V7',
  byFamily: { 'JS-mobile': 'V2', 'C-family': 'V4' },
};

const BOOST_VALUES = (process.env.SS_BOOST_VALUES || '1.15,1.25,1.30').split(',').map(Number);

function loadDevGolds() {
  const m = JSON.parse(fs.readFileSync(SPLITS, 'utf8'));
  const dev = new Set();
  for (const [, sp] of Object.entries(m.perLanguage || {})) {
    for (const id of sp.dev || []) dev.add(id);
  }
  return dev;
}

function loadReposManifest() {
  const m = JSON.parse(fs.readFileSync(REPOS_MANIFEST, 'utf8'));
  const map = new Map();
  for (const e of m.repos || []) map.set(e.key || e.language, e);
  return map;
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

function loadVariant(lang, gold, shape) {
  const p = path.join(VARIANTS_DIR, `${lang}-${gold}-${shape}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

async function runOneBoost(boost, devGolds, inputs, reposMap) {
  process.env.SWEET_SEARCH_IDENTIFIER_MENTION_BOOST = String(boost);
  const rows = [];
  const byLang = new Map();
  for (const goldId of devGolds) {
    const input = inputs.get(goldId);
    if (!input || input.goldClass !== 'ast-tester') continue;
    if (!byLang.has(input.language)) byLang.set(input.language, []);
    byLang.get(input.language).push(input);
  }
  for (const [language, lst] of byLang.entries()) {
    const repoEntry = reposMap.get(language);
    if (!repoEntry) continue;
    const projectRoot = path.join(REPO_ROOT, repoEntry.localPath);
    const dataDir = path.join(projectRoot, '.sweet-search');
    if (!fs.existsSync(dataDir)) continue;
    const searcher = new SweetSearch({
      projectRoot,
      graphDbPath: path.join(dataDir, 'code-graph.db'),
      codebaseDbPath: path.join(dataDir, 'codebase.db'),
      hnswPath: path.join(dataDir, 'codebase-hnsw.idx'),
      binaryHnswPath: path.join(dataDir, 'codebase-binary-hnsw.idx'),
      sparseGramIndexPath: path.join(dataDir, 'codebase-sparse-grams.idx'),
      lateInteractionOptions: { indexPath: path.join(dataDir, 'codebase-late-interaction.db') },
    });
    await searcher.init();
    for (const input of lst) {
      const shape = WINNERS.byFamily[input.family] || WINNERS.default;
      const variant = loadVariant(input.language, input.goldId, shape);
      if (!variant) continue;
      const resp = await searcher.search(variant.query, { format: 'agent', k: 5, graphExpand: '2hop', adaptiveHop2: true });
      const results = resp?.results || [];
      const graded = gradeResult(input, results);
      rows.push({
        boost, goldId: input.goldId, language: input.language, family: input.family,
        shape, query: variant.query, verdict: graded.verdict,
        fileRecallAt1: graded.fileRecallAt1,
        fileRecallAt5: graded.fileRecallAt5,
        symbolRecallAt1: graded.symbolRecallAt1,
        top1: graded.top1,
      });
    }
    try { searcher.close(); } catch { /* */ }
  }
  return rows;
}

async function main() {
  const devGolds = loadDevGolds();
  const inputs = loadInputs();
  const reposMap = loadReposManifest();

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const allRuns = {};
  for (const boost of BOOST_VALUES) {
    process.stdout.write(`\n=== boost=${boost} ===\n`);
    const start = Date.now();
    const rows = await runOneBoost(boost, devGolds, inputs, reposMap);
    const wall = Date.now() - start;
    const counts = { PASS: 0, PARTIAL: 0, FAIL: 0 };
    let frAt5 = 0;
    for (const r of rows) {
      counts[r.verdict]++;
      if (r.fileRecallAt5 === 1) frAt5++;
    }
    process.stdout.write(`  PASS=${counts.PASS} PARTIAL=${counts.PARTIAL} FAIL=${counts.FAIL}  fr@5=${frAt5}/${rows.length} (${wall}ms)\n`);
    const outPath = path.join(OUT_DIR, `stage5-boost-sweep-${boost}.jsonl`);
    fs.writeFileSync(outPath, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    allRuns[boost] = { counts, frAt5, total: rows.length, rows };
  }

  // Diff each boost vs baseline (first in BOOST_VALUES)
  const baseBoost = BOOST_VALUES[0];
  const baseRows = allRuns[baseBoost].rows;
  const baseByGold = new Map(baseRows.map(r => [r.goldId, r]));
  const lines = ['# ss-search Stage 5 boost-sweep summary', '', `Generated: ${new Date().toISOString()}`, '', '## Per-boost dev numbers (90 ast-tester golds, agentic strategy)', '', '| boost | PASS | PARTIAL | FAIL | fr@5 |', '|---|---|---|---|---|'];
  for (const b of BOOST_VALUES) {
    const c = allRuns[b].counts;
    lines.push(`| ${b} | ${c.PASS} | ${c.PARTIAL} | ${c.FAIL} | ${allRuns[b].frAt5}/${allRuns[b].total} |`);
  }
  lines.push('');
  lines.push(`## Per-gold flips vs boost=${baseBoost}`);
  lines.push('');
  for (const b of BOOST_VALUES) {
    if (b === baseBoost) continue;
    const rows = allRuns[b].rows;
    const flips = [];
    for (const r of rows) {
      const base = baseByGold.get(r.goldId);
      if (!base) continue;
      if (base.verdict !== r.verdict) {
        flips.push({ goldId: r.goldId, from: base.verdict, to: r.verdict, file_from: base.top1?.file, sym_from: base.top1?.symbol, file_to: r.top1?.file, sym_to: r.top1?.symbol });
      }
    }
    lines.push(`### boost=${b}: ${flips.length} flips`);
    lines.push('');
    for (const f of flips) {
      const arrow = (f.from === 'PASS' && f.to !== 'PASS') ? '⚠ regress' : (f.to === 'PASS' && f.from !== 'PASS') ? '✓ improve' : '~ shift';
      lines.push(`- ${arrow} **${f.goldId}** ${f.from} → ${f.to}: \`${f.file_from}::${f.sym_from}\` → \`${f.file_to}::${f.sym_to}\``);
    }
    lines.push('');
  }
  fs.writeFileSync(path.join(OUT_DIR, 'stage5-boost-sweep-summary.md'), lines.join('\n'));
  process.stdout.write(`\nWrote stage5-boost-sweep-summary.md\n`);
}

main().catch(err => { process.stderr.write(`fatal ${err.stack || err.message}\n`); process.exit(1); });

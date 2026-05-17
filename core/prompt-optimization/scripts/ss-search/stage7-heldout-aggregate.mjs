#!/usr/bin/env node
/**
 * stage7-heldout-aggregate.mjs — run the agentic strategy (V7 / V2 / V4)
 * on the HELDOUT split with the current ranker rules. Aggregate-only
 * reporting per BEIR/CoIR discipline (no per-query inspection).
 *
 * Output: stage7-heldout-aggregate.json + .md
 *
 * Discipline: aggregate counts ONLY. Do not list which specific golds
 * PASSed/FAILed. Counts go into memory pin; deltas vs prior milestone
 * are okay; per-gold inspection is not.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SweetSearch } from '../../search-runtime.mjs';
import { gradeResult } from '../track-a-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SPLITS = path.join(REPO_ROOT, 'eval/ast-tester-probes/splits/manifest.json');
const REPOS_MANIFEST = path.join(REPO_ROOT, 'eval/ast-tester-probes/repos.json');
const INPUTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/inputs');
const VARIANTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/variants');
const OUT_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-search/failure-analysis');

const WINNERS = { default: 'V7', byFamily: { 'JS-mobile': 'V2', 'C-family': 'V4' } };

function loadHeldoutGolds() {
  const m = JSON.parse(fs.readFileSync(SPLITS, 'utf8'));
  const heldout = new Set();
  for (const [, sp] of Object.entries(m.perLanguage || {})) {
    for (const id of sp.heldout || []) heldout.add(id);
  }
  return heldout;
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

async function main() {
  const heldout = loadHeldoutGolds();
  const inputs = loadInputs();
  const reposMap = loadReposManifest();

  const byLang = new Map();
  for (const goldId of heldout) {
    const input = inputs.get(goldId);
    if (!input || input.goldClass !== 'ast-tester') continue;
    if (!byLang.has(input.language)) byLang.set(input.language, []);
    byLang.get(input.language).push(input);
  }

  const totals = { PASS: 0, PARTIAL: 0, FAIL: 0, n: 0, fileRecallAt5: 0 };
  const perFamily = {};
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
      const graded = gradeResult(input, resp?.results || []);
      totals.n++;
      totals[graded.verdict]++;
      if (graded.fileRecallAt5 === 1) totals.fileRecallAt5++;
      const fam = input.family;
      perFamily[fam] = perFamily[fam] || { PASS: 0, PARTIAL: 0, FAIL: 0, n: 0, fr5: 0 };
      perFamily[fam].n++;
      perFamily[fam][graded.verdict]++;
      if (graded.fileRecallAt5 === 1) perFamily[fam].fr5++;
    }
    try { searcher.close(); } catch { /* */ }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = { schemaVersion: 1, generatedAt: new Date().toISOString(), discipline: 'aggregate-only (BEIR/CoIR heldout)', totals, perFamily };
  fs.writeFileSync(path.join(OUT_DIR, 'stage7-heldout-aggregate.json'), JSON.stringify(out, null, 2));
  const md = [
    '# ss-search Stage 7 heldout aggregate (agentic strategy)',
    '',
    `Generated: ${out.generatedAt}`,
    '',
    `**DISCIPLINE**: aggregate-only per BEIR/CoIR. No per-query inspection.`,
    '',
    `## Heldout totals (${totals.n} ast-tester golds, V7 default / V2 JS-mobile / V4 C-family)`,
    '',
    `- PASS:    ${totals.PASS} (${(totals.PASS/totals.n*100).toFixed(1)}%)`,
    `- PARTIAL: ${totals.PARTIAL} (${(totals.PARTIAL/totals.n*100).toFixed(1)}%)`,
    `- FAIL:    ${totals.FAIL} (${(totals.FAIL/totals.n*100).toFixed(1)}%)`,
    `- file_recall@5: ${totals.fileRecallAt5}/${totals.n} (${(totals.fileRecallAt5/totals.n*100).toFixed(1)}%)`,
    '',
    `## Per family`,
    '',
    `| family | n | PASS | PARTIAL | FAIL | fr@5 |`,
    `|---|---|---|---|---|---|`,
  ];
  for (const [fam, s] of Object.entries(perFamily)) {
    md.push(`| ${fam} | ${s.n} | ${s.PASS} | ${s.PARTIAL} | ${s.FAIL} | ${s.fr5}/${s.n} |`);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'stage7-heldout-aggregate.md'), md.join('\n'));

  process.stdout.write(`heldout: PASS=${totals.PASS} PARTIAL=${totals.PARTIAL} FAIL=${totals.FAIL} fr@5=${totals.fileRecallAt5}/${totals.n}\n`);
}

main().catch(err => { process.stderr.write(`fatal ${err.stack || err.message}\n`); process.exit(1); });

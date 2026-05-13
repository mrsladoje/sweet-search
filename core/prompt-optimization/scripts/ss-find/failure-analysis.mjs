#!/usr/bin/env node
/**
 * ss-find failure analysis (Stage 1 + Stage 2 of the handoff).
 *
 * Stage 1: filter the 49-cell sweep (track-a-phase6-redo-ss-find-v1.jsonl)
 * down to one row per (gold, language) using the SHIPPED winning strategies:
 *   - default                : R5|Q3 (simple_global from recommendations-v2-ss-find.json)
 *   - JS-mobile family override: R3|Q4 (family override from same artifact)
 *
 * Stage 2: aggregate the dev-split rows ONLY (per CLAUDE.md BEIR discipline).
 * Held-out rows are written to a separate file but NEVER inspected per-query
 * during dev — the file is there for a milestone-aggregate run later.
 *
 * Outputs (all under data/query-shapes/ss-find/failure-analysis/):
 *   - best-cell-dev.jsonl       — one row per (gold, language) on dev split
 *   - best-cell-heldout.jsonl   — same, but held-out (DO NOT inspect per-query)
 *   - dev-per-language.json     — aggregate PASS/PARTIAL/FAIL + avg sym@1 per language
 *   - dev-per-family.json       — same, family-aggregated
 *   - dev-failures.jsonl        — every FAIL/PARTIAL row on dev, sorted by language
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { languageToFamily } from '../../data/query-shapes/family-map.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../..');

// Optional CLI arg: --track=<runId> picks the named JSONL; default is v1.
// Also accepts --suffix=<s> to append to output filenames (e.g., -v2).
function parseArgs(argv) {
  const out = { track: 'phase6-redo-ss-find-v1', suffix: '' };
  for (const a of argv) {
    if (a.startsWith('--track=')) out.track = a.slice('--track='.length);
    else if (a.startsWith('--suffix=')) out.suffix = a.slice('--suffix='.length);
  }
  return out;
}
const opts = parseArgs(process.argv.slice(2));

const JSONL_PATH = resolve(
  REPO_ROOT,
  `core/prompt-optimization/data/query-shapes/ss-find/tracks/track-a-${opts.track}.jsonl`,
);
const SPLITS_PATH = resolve(REPO_ROOT, 'eval/ast-tester-probes/splits/manifest.json');
const OUT_DIR = resolve(
  REPO_ROOT,
  'core/prompt-optimization/data/query-shapes/ss-find/failure-analysis',
);

mkdirSync(OUT_DIR, { recursive: true });

const SUFFIX = opts.suffix;
const file = (name) => resolve(OUT_DIR, name.replace(/\.([a-z]+)$/i, `${SUFFIX}.$1`));

// ---------- Load splits ----------
const splits = JSON.parse(readFileSync(SPLITS_PATH, 'utf8'));
/** Map goldId → 'dev' | 'heldout' (per the seed=42 manifest). */
const splitOf = new Map();
for (const [lang, { dev = [], heldout = [] }] of Object.entries(splits.perLanguage)) {
  for (const id of dev) splitOf.set(id, 'dev');
  for (const id of heldout) splitOf.set(id, 'heldout');
}

// ---------- Strategy picker ----------
// Per recommendations-v2-ss-find.json shipped 2026-05-13:
//   simple_global       = R5|Q3 (sym@1 = 86/143 = 60.1%)
//   JS-mobile override  = R3|Q4 (sym@1 = 22/31 = 71.0%)
function pickedCell(family) {
  if (family === 'JS-mobile') return { rCell: 'R3', qCell: 'Q4', strategy: 'js_mobile_override' };
  return { rCell: 'R5', qCell: 'Q3', strategy: 'simple_global' };
}

// ---------- Stream JSONL, filter to one row per (gold, language) ----------
const text = readFileSync(JSONL_PATH, 'utf8');
const lines = text.split('\n').filter(Boolean);
const picked = []; // rows that matched the (family-conditioned) winning cell

for (const line of lines) {
  let row;
  try { row = JSON.parse(line); } catch { continue; }
  // Skip the baseline rows (rCell === 'R2_baseline').
  if (row.rCell === 'R2_baseline') continue;
  const family = row.family || languageToFamily(row.language);
  const { rCell, qCell, strategy } = pickedCell(family);
  if (row.rCell !== rCell || row.qCell !== qCell) continue;
  const split = splitOf.get(row.goldId) || 'unknown';
  picked.push({ ...row, _split: split, _strategy: strategy });
}

// ---------- Split into dev / heldout ----------
const dev = picked.filter((r) => r._split === 'dev');
const heldout = picked.filter((r) => r._split === 'heldout');
const unknown = picked.filter((r) => r._split === 'unknown');

if (unknown.length > 0) {
  console.warn(`[warn] ${unknown.length} rows have unknown split (not in manifest):`);
  for (const r of unknown.slice(0, 5)) console.warn(`  - ${r.goldId} (${r.language})`);
}

// ---------- Stage 2: dev aggregates ----------
function aggregate(rows) {
  const byLang = new Map();
  const byFamily = new Map();
  for (const r of rows) {
    const langBucket = byLang.get(r.language) ?? {
      n: 0,
      pass: 0,
      partial: 0,
      fail: 0,
      file1: 0,
      sym1: 0,
      symRecallSum: 0,
      symRecallSqSum: 0,
      family: r.family || languageToFamily(r.language),
    };
    langBucket.n++;
    if (r.verdict === 'PASS') langBucket.pass++;
    else if (r.verdict === 'PARTIAL') langBucket.partial++;
    else langBucket.fail++;
    langBucket.file1 += r.fileRecallAt1 || 0;
    langBucket.sym1 += r.symbolRecallAt1 || 0;
    const sr = r.symbolRecallAt1 || 0;
    langBucket.symRecallSum += sr;
    langBucket.symRecallSqSum += sr * sr;
    byLang.set(r.language, langBucket);

    const family = langBucket.family;
    const famBucket = byFamily.get(family) ?? {
      n: 0,
      pass: 0,
      partial: 0,
      fail: 0,
      file1: 0,
      sym1: 0,
    };
    famBucket.n++;
    if (r.verdict === 'PASS') famBucket.pass++;
    else if (r.verdict === 'PARTIAL') famBucket.partial++;
    else famBucket.fail++;
    famBucket.file1 += r.fileRecallAt1 || 0;
    famBucket.sym1 += r.symbolRecallAt1 || 0;
    byFamily.set(family, famBucket);
  }
  // Finalise.
  const langOut = {};
  for (const [lang, b] of byLang.entries()) {
    const mean = b.symRecallSum / b.n;
    const variance = b.n > 1 ? (b.symRecallSqSum / b.n - mean * mean) : 0;
    langOut[lang] = {
      family: b.family,
      n: b.n,
      pass: b.pass,
      partial: b.partial,
      fail: b.fail,
      pass_rate: +(b.pass / b.n).toFixed(4),
      fail_rate: +(b.fail / b.n).toFixed(4),
      file_recall_at_1: +(b.file1 / b.n).toFixed(4),
      symbol_recall_at_1: +(b.sym1 / b.n).toFixed(4),
      symbol_recall_at_1_variance: +variance.toFixed(4),
    };
  }
  const famOut = {};
  for (const [family, b] of byFamily.entries()) {
    famOut[family] = {
      n: b.n,
      pass: b.pass,
      partial: b.partial,
      fail: b.fail,
      pass_rate: +(b.pass / b.n).toFixed(4),
      fail_rate: +(b.fail / b.n).toFixed(4),
      file_recall_at_1: +(b.file1 / b.n).toFixed(4),
      symbol_recall_at_1: +(b.sym1 / b.n).toFixed(4),
    };
  }
  return { langOut, famOut };
}

const { langOut: devByLang, famOut: devByFamily } = aggregate(dev);

// Sort languages by FAIL rate descending (worst first).
const sortedLangs = Object.entries(devByLang).sort(
  ([, a], [, b]) => b.fail_rate - a.fail_rate || a.symbol_recall_at_1 - b.symbol_recall_at_1,
);

// ---------- Write outputs ----------
function writeJsonl(path, rows) {
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}
function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

writeJsonl(file('best-cell-dev.jsonl'), dev);
writeJsonl(file('best-cell-heldout.jsonl'), heldout);

const devFailures = dev
  .filter((r) => r.verdict !== 'PASS')
  .sort((a, b) => {
    if (a.language !== b.language) return a.language.localeCompare(b.language);
    return a.goldId.localeCompare(b.goldId);
  });
writeJsonl(file('dev-failures.jsonl'), devFailures);

writeJson(file('dev-per-language.json'), {
  schemaVersion: 1,
  source: 'track-a-phase6-redo-ss-find-v1.jsonl',
  picker: 'R5|Q3 default, R3|Q4 for JS-mobile (per recommendations-v2-ss-find.json)',
  split: 'dev',
  languages_sorted_by_fail_rate_desc: sortedLangs.map(([l]) => l),
  per_language: Object.fromEntries(sortedLangs),
});

writeJson(file('dev-per-family.json'), {
  schemaVersion: 1,
  source: 'track-a-phase6-redo-ss-find-v1.jsonl',
  split: 'dev',
  per_family: devByFamily,
});

// ---------- Console summary ----------
console.log(`Picked ${picked.length} rows total (dev=${dev.length}, heldout=${heldout.length})`);
console.log('\n=== DEV — per-language (sorted by FAIL rate desc) ===');
console.log(
  'lang'.padEnd(14),
  'fam'.padEnd(22),
  'n'.padStart(3),
  'P'.padStart(3),
  'p'.padStart(3),
  'F'.padStart(3),
  'sym@1'.padStart(7),
  'file@1'.padStart(7),
);
for (const [lang, s] of sortedLangs) {
  console.log(
    lang.padEnd(14),
    (s.family || '').padEnd(22),
    String(s.n).padStart(3),
    String(s.pass).padStart(3),
    String(s.partial).padStart(3),
    String(s.fail).padStart(3),
    s.symbol_recall_at_1.toFixed(3).padStart(7),
    s.file_recall_at_1.toFixed(3).padStart(7),
  );
}
console.log('\n=== DEV — per-family ===');
for (const [family, s] of Object.entries(devByFamily)) {
  console.log(
    family.padEnd(22),
    'n=' + s.n,
    'P/p/F =', `${s.pass}/${s.partial}/${s.fail}`,
    'sym@1=' + s.symbol_recall_at_1.toFixed(3),
    'file@1=' + s.file_recall_at_1.toFixed(3),
  );
}
console.log('\nWrote dev failures:', devFailures.length, 'rows ->', file('dev-failures.jsonl'));

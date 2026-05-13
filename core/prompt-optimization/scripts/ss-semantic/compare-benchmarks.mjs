#!/usr/bin/env node
/**
 * compare-benchmarks.mjs — side-by-side strict vs behavioural on the same
 * 38 golds.
 *
 * Strict numbers: track-a-phase6-redo-ss-semantic-v2.jsonl filtered to the
 * family-conditioned best shape (V2 for C-family, V1 otherwise).
 *
 * Behavioural numbers: track-behavioural-stage05-v1.jsonl.
 *
 * For each (goldId, language) present in BOTH:
 *   - report verdict on strict vs behavioural
 *   - report top1_iou + max_iou
 *   - flag flips (strict FAIL → behavioural PASS, etc.)
 *
 * Per CLAUDE.md / handoff: behavioural-benchmark dev rows can be inspected
 * per-query (these are NEW golds; held-out has not been split for them yet).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const STRICT_TRACK = process.env.STRICT_TRACK
  ? path.resolve(REPO_ROOT, process.env.STRICT_TRACK)
  : path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-semantic/tracks/track-a-phase6-redo-ss-semantic-v3.jsonl');
const BEHAV_TRACK = process.env.BEHAV_TRACK
  ? path.resolve(REPO_ROOT, process.env.BEHAV_TRACK)
  : path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-semantic/tracks/track-behavioural-stage05-v2.jsonl');
const SPLITS_PATH = path.join(REPO_ROOT, 'eval/ast-tester-probes/splits/manifest.json');
const OUT_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-semantic/failure-analysis');

const FAMILY_OF_LANGUAGE = {
  java: 'OO-monolithic', csharp: 'OO-monolithic', kotlin: 'OO-monolithic', scala: 'OO-monolithic',
  rust: 'Systems-modular-terse', go: 'Systems-modular-terse',
  c: 'C-family', cpp: 'C-family', zig: 'C-family',
  javascript: 'JS-mobile', typescript: 'JS-mobile', 'typescript-lib': 'JS-mobile', dart: 'JS-mobile',
  python: 'Scripting-dynamic', ruby: 'Scripting-dynamic', php: 'Scripting-dynamic', lua: 'Scripting-dynamic', elixir: 'Scripting-dynamic',
};

function loadJsonl(p) {
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
}

function loadSplits() {
  const m = JSON.parse(fs.readFileSync(SPLITS_PATH, 'utf8'));
  const devSet = new Set();
  for (const [, s] of Object.entries(m.perLanguage)) for (const id of s.dev || []) devSet.add(id);
  return devSet;
}

function bestShape(family) { return family === 'C-family' ? 'V2' : 'V1'; }

function main() {
  const strictRows = loadJsonl(STRICT_TRACK);
  const behavRows = loadJsonl(BEHAV_TRACK);
  const devSet = loadSplits();

  // Index strict rows by (goldId, shape), taking only best-shape per family.
  const strictBest = new Map();
  for (const r of strictRows) {
    const fam = r.family || FAMILY_OF_LANGUAGE[r.language];
    if (!fam) continue;
    if (r.shape !== bestShape(fam)) continue;
    strictBest.set(r.goldId, r);
  }

  // Pair behavioural rows with their strict counterparts.
  const paired = [];
  for (const b of behavRows) {
    const s = strictBest.get(b.goldId);
    if (!s) continue;
    paired.push({
      goldId: b.goldId,
      language: b.language,
      family: b.family,
      isDev: devSet.has(b.goldId),
      strict: {
        query: s.query,
        shape: s.shape,
        verdict: s.verdict,
        top1: s.top1_iou,
        max: s.max_iou,
        coverage: s.coverage,
        spans: s.spans,
      },
      behavioural: {
        query: b.query,
        verdict: b.verdict,
        top1: b.top1_iou,
        max: b.max_iou,
        coverage: b.coverage,
        spans: b.spans,
      },
    });
  }

  function tallyOn(rows) {
    const t = { n: 0, strict: { PASS: 0, PARTIAL: 0, FAIL: 0 }, behavioural: { PASS: 0, PARTIAL: 0, FAIL: 0 }, flips: { 'FAIL→PASS': 0, 'FAIL→PARTIAL': 0, 'PASS→FAIL': 0, 'PARTIAL→PASS': 0, 'PASS→PARTIAL': 0, 'PARTIAL→FAIL': 0, same: 0 } };
    for (const p of rows) {
      t.n++;
      t.strict[p.strict.verdict]++;
      t.behavioural[p.behavioural.verdict]++;
      const k = p.strict.verdict === p.behavioural.verdict ? 'same' : `${p.strict.verdict}→${p.behavioural.verdict}`;
      t.flips[k] = (t.flips[k] ?? 0) + 1;
    }
    return t;
  }

  function pct(n, d) { return d > 0 ? (n / d * 100).toFixed(1) : '0.0'; }

  const all = tallyOn(paired);
  const devOnly = tallyOn(paired.filter((p) => p.isDev));

  function fmtTally(label, t) {
    return [
      `${label}: n=${t.n}`,
      `  strict:       PASS=${t.strict.PASS} (${pct(t.strict.PASS, t.n)}%) PART=${t.strict.PARTIAL} (${pct(t.strict.PARTIAL, t.n)}%) FAIL=${t.strict.FAIL} (${pct(t.strict.FAIL, t.n)}%)`,
      `  behavioural:  PASS=${t.behavioural.PASS} (${pct(t.behavioural.PASS, t.n)}%) PART=${t.behavioural.PARTIAL} (${pct(t.behavioural.PARTIAL, t.n)}%) FAIL=${t.behavioural.FAIL} (${pct(t.behavioural.FAIL, t.n)}%)`,
      `  flips: ${Object.entries(t.flips).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join('  ')}`,
    ].join('\n');
  }

  console.log(fmtTally('OVERALL (38 paired)', all));
  console.log('');
  console.log(fmtTally('DEV only', devOnly));

  // Per-family breakdown on dev
  console.log('\nDEV per-family:');
  const byFam = new Map();
  for (const p of paired.filter((x) => x.isDev)) {
    if (!byFam.has(p.family)) byFam.set(p.family, []);
    byFam.get(p.family).push(p);
  }
  for (const [fam, rows] of byFam) {
    const t = tallyOn(rows);
    console.log(`  ${fam.padEnd(22)} n=${t.n}  strict={P:${t.strict.PASS} p:${t.strict.PARTIAL} F:${t.strict.FAIL}}  behav={P:${t.behavioural.PASS} p:${t.behavioural.PARTIAL} F:${t.behavioural.FAIL}}  flips={F→P:${t.flips['FAIL→PASS']||0} P→F:${t.flips['PASS→FAIL']||0}}`);
  }

  // Detail every dev pair for the writeup.
  console.log('\nDEV per-row detail:');
  const fmt = (v) => v.toFixed(2);
  for (const p of paired.filter((x) => x.isDev).sort((a, b) => a.language.localeCompare(b.language) || a.goldId.localeCompare(b.goldId))) {
    const sV = p.strict.verdict.padEnd(7);
    const bV = p.behavioural.verdict.padEnd(7);
    const tag = p.strict.verdict !== p.behavioural.verdict ? '  ← FLIP' : '';
    console.log(`  ${p.language.padEnd(14)} ${p.goldId.padEnd(8)} strict[${sV} top1=${fmt(p.strict.top1)}] vs behav[${bV} top1=${fmt(p.behavioural.top1)}]${tag}`);
  }

  // Persist summary to disk for the writeup
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'stage05-comparison.json'), JSON.stringify({
    notes: 'Stage 0.5 side-by-side: strict ast-tester (best-shape) vs behavioural rewrite, on the same 38 golds.',
    allPaired: all,
    devOnly,
    perFamilyDev: Object.fromEntries([...byFam].map(([f, rs]) => [f, tallyOn(rs)])),
    paired,
  }, null, 2));
  console.log(`\nwrote: ${path.relative(REPO_ROOT, path.join(OUT_DIR, 'stage05-comparison.json'))}`);
}

main();

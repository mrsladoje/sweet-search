#!/usr/bin/env node
/**
 * Stage 0 — Benchmark-design audit for ss-semantic Phase 6 v2.
 *
 * Question we're answering: are our ast-tester golds the right shape to measure
 * ss-semantic's actual value? IoU>=0.5 against the containingChunk line range
 * may be too strict — a returned span that's slightly wider than the gold (and
 * thus more useful to the agent) gets graded FAIL.
 *
 * This script (no LLM, deterministic, dev-only):
 *   1. Loads the v1 sweep JSONL.
 *   2. Filters to DEV-set probes only via splits/manifest.json (per CLAUDE.md
 *      methodology — held-out per-query inspection is forbidden).
 *   3. Slices to the "best query" per (gold, language):
 *        - V2 for C-family (per recommendations-v2-ss-semantic.json override)
 *        - V1 for everyone else
 *   4. For each row: (a) tag the failure as IoU-threshold-artifact vs tool-floor,
 *      using max_iou + coverage + which-span-contains-gold heuristics, and
 *      (b) the input's gold metadata.
 *   5. Emits stage0-summary.json with per-family rollups and stage0-failures.jsonl
 *      with the 30 worst cases (FAIL only) for hand inspection.
 *
 * Heuristic taxonomy applied here (Stage 0 only):
 *   - "iou-threshold-artifact"   : top1_iou < 0.5 BUT max_iou >= 0.3 (some
 *                                  returned span substantially overlaps gold)
 *   - "wider-span-contains-gold" : top1_iou < 0.5 BUT coverage >= 0.8
 *                                  (a returned span covers ≥80% of gold lines)
 *   - "tool-miss"                : top1_iou == 0 AND max_iou < 0.1 AND coverage < 0.2
 *                                  (no span got close)
 *   - "partial-overlap-only"     : top1_iou > 0 BUT < 0.5, max_iou < 0.3
 *
 * These are starting heuristics, not the final taxonomy. The Stage 3 deep-dive
 * may refine them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SPLITS_PATH = path.join(REPO_ROOT, 'eval/ast-tester-probes/splits/manifest.json');
const RECS_PATH = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/recommendations-v2-ss-semantic.json');
const TRACK_PATH = process.env.SSSEM_TRACK
  ? path.resolve(REPO_ROOT, process.env.SSSEM_TRACK)
  : path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-semantic/tracks/track-a-phase6-redo-ss-semantic-v2.jsonl');
const INPUTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/inputs');
const OUT_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-semantic/failure-analysis');

const FAMILY_OF_LANGUAGE = {
  java: 'OO-monolithic', csharp: 'OO-monolithic', kotlin: 'OO-monolithic', scala: 'OO-monolithic',
  rust: 'Systems-modular-terse', go: 'Systems-modular-terse',
  c: 'C-family', cpp: 'C-family', zig: 'C-family',
  javascript: 'JS-mobile', typescript: 'JS-mobile', 'typescript-lib': 'JS-mobile', dart: 'JS-mobile',
  python: 'Scripting-dynamic', ruby: 'Scripting-dynamic', php: 'Scripting-dynamic', lua: 'Scripting-dynamic', elixir: 'Scripting-dynamic',
};

function loadSplits() {
  const m = JSON.parse(fs.readFileSync(SPLITS_PATH, 'utf8'));
  const devSet = new Set();
  for (const [, langSplit] of Object.entries(m.perLanguage)) {
    for (const id of langSplit.dev || []) devSet.add(id);
  }
  return devSet;
}

function loadJsonl(p) {
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('{'));
  return lines.map((l) => JSON.parse(l));
}

function chooseBestShape(family) {
  // Per recommendations-v2-ss-semantic.json:
  //   family_conditioned default = V1
  //   C-family override          = V2
  return family === 'C-family' ? 'V2' : 'V1';
}

function classifyFailure(row) {
  if (row.verdict === 'PASS') return 'pass';
  const t1 = row.top1_iou ?? 0;
  const mx = row.max_iou ?? 0;
  const cov = row.coverage ?? 0;
  if (t1 >= 0.5) return 'pass';
  if (t1 > 0 && t1 < 0.5 && mx < 0.3) return 'partial-overlap-only';
  if (t1 < 0.5 && cov >= 0.8) return 'wider-span-contains-gold';
  if (t1 < 0.5 && mx >= 0.3) return 'iou-threshold-artifact';
  if (t1 === 0 && mx < 0.1 && cov < 0.2) return 'tool-miss';
  if (t1 === 0 && mx < 0.3) return 'partial-overlap-only';
  return 'other';
}

function loadInput(language, goldId) {
  const p = path.join(INPUTS_DIR, `${language}-${goldId}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const devSet = loadSplits();
  const recs = JSON.parse(fs.readFileSync(RECS_PATH, 'utf8'));
  const rows = loadJsonl(TRACK_PATH);

  // Filter to dev rows, with the language-family-conditioned best shape.
  const bestRows = [];
  for (const r of rows) {
    if (!devSet.has(r.goldId)) continue;
    const family = r.family || FAMILY_OF_LANGUAGE[r.language];
    if (!family) continue;
    const best = chooseBestShape(family);
    if (r.shape !== best) continue;
    bestRows.push({ ...r, family, classification: classifyFailure(r) });
  }

  // Global rollup
  const counts = { total: 0, pass: 0, partial: 0, fail: 0 };
  const classifications = {};
  const perFamily = {};
  const perLanguage = {};

  for (const r of bestRows) {
    counts.total++;
    if (r.verdict === 'PASS') counts.pass++;
    else if (r.verdict === 'PARTIAL') counts.partial++;
    else counts.fail++;
    classifications[r.classification] = (classifications[r.classification] || 0) + 1;

    const f = r.family;
    if (!perFamily[f]) perFamily[f] = { n: 0, pass: 0, partial: 0, fail: 0, classifications: {} };
    perFamily[f].n++;
    if (r.verdict === 'PASS') perFamily[f].pass++;
    else if (r.verdict === 'PARTIAL') perFamily[f].partial++;
    else perFamily[f].fail++;
    perFamily[f].classifications[r.classification] = (perFamily[f].classifications[r.classification] || 0) + 1;

    const l = r.language;
    if (!perLanguage[l]) perLanguage[l] = { family: f, n: 0, pass: 0, partial: 0, fail: 0, classifications: {} };
    perLanguage[l].n++;
    if (r.verdict === 'PASS') perLanguage[l].pass++;
    else if (r.verdict === 'PARTIAL') perLanguage[l].partial++;
    else perLanguage[l].fail++;
    perLanguage[l].classifications[r.classification] = (perLanguage[l].classifications[r.classification] || 0) + 1;
  }

  // Pick FAIL rows for hand inspection, with input metadata for context.
  // Prioritize the ambiguous classifications (iou-threshold-artifact,
  // wider-span-contains-gold) so we can audit benchmark-design impact first.
  const failRows = bestRows.filter((r) => r.verdict === 'FAIL');
  const ambiguousFails = failRows.filter((r) =>
    r.classification === 'iou-threshold-artifact' || r.classification === 'wider-span-contains-gold');
  const toolMisses = failRows.filter((r) => r.classification === 'tool-miss');
  const partialFails = failRows.filter((r) => r.classification === 'partial-overlap-only');

  function attach(row) {
    const input = loadInput(row.language, row.goldId);
    return {
      goldId: row.goldId, language: row.language, family: row.family,
      query: row.query, shape: row.shape,
      goldRange: row.goldRange,
      goldRangeLen: row.goldRange.endLine - row.goldRange.startLine + 1,
      spans: row.spans,
      verdict: row.verdict, classification: row.classification,
      top1_iou: row.top1_iou, max_iou: row.max_iou, coverage: row.coverage, precision: row.precision,
      goldQuery: input?.goldQuery, goldNotes: input?.goldNotes,
      expectedSymbol: input?.expectedSymbol, expectedSymbolType: input?.expectedSymbolType,
      // Quick heuristic: does any returned span FULLY contain the gold?
      containsGold: row.spans.some((s) =>
        s.startLine <= row.goldRange.startLine && s.endLine >= row.goldRange.endLine),
      // What's the widest span containing >= 80% of gold?
      bestContainingSpan: row.spans.find((s) => {
        const ov = Math.min(s.endLine, row.goldRange.endLine) - Math.max(s.startLine, row.goldRange.startLine) + 1;
        const gLen = row.goldRange.endLine - row.goldRange.startLine + 1;
        return ov > 0 && ov / gLen >= 0.8;
      }) || null,
      top1IsFileHeader: row.spans.length > 0 && row.spans[0].startLine === 1 && row.spans[0].endLine < 100,
    };
  }

  // Write detailed failures: top 30, sorted by classification then by max_iou desc
  const detailed = [
    ...ambiguousFails,
    ...partialFails,
    ...toolMisses,
  ].map(attach);

  // Also: count "containsGold" rate among all dev rows + all FAIL rows
  const containsGoldAmongFails = detailed.filter((r) => r.containsGold).length;
  const top1FileHeaderAmongFails = detailed.filter((r) => r.top1IsFileHeader).length;

  const summary = {
    runId: 'phase6-redo-ss-semantic-v1',
    notes: 'Stage 0 benchmark-shape audit. DEV ONLY. Per CLAUDE.md, held-out is not inspected here.',
    devN: counts.total,
    counts,
    classifications,
    classifications_pct: Object.fromEntries(
      Object.entries(classifications).map(([k, v]) => [k, +((v / counts.total) * 100).toFixed(1)]),
    ),
    perFamily,
    perLanguage,
    benchmarkShapeSignals: {
      // Fraction of dev rows where verdict=FAIL despite max_iou >= 0.3.
      // These are the strongest candidates for "benchmark too strict".
      iouThresholdArtifact_rate: +((classifications['iou-threshold-artifact'] || 0) / counts.total * 100).toFixed(1),
      // Fraction of dev rows where a returned span covers ≥80% of gold but top1 still failed.
      widerSpanContainsGold_rate: +((classifications['wider-span-contains-gold'] || 0) / counts.total * 100).toFixed(1),
      // Among FAILs, what fraction had a span FULLY containing the gold range?
      failsWithContainingSpan_n: containsGoldAmongFails,
      failsWithContainingSpan_pct: detailed.length > 0 ? +(containsGoldAmongFails / detailed.length * 100).toFixed(1) : 0,
      // Among FAILs, how often was the top-1 span the file header (lines 1-?)?
      // This is the smoking-gun for the "first-chunk wins" Mode A analogue.
      failsWithTop1FileHeader_n: top1FileHeaderAmongFails,
      failsWithTop1FileHeader_pct: detailed.length > 0 ? +(top1FileHeaderAmongFails / detailed.length * 100).toFixed(1) : 0,
    },
    stageOneStopRule: {
      threshold: 'If iouThresholdArtifact_rate + widerSpanContainsGold_rate > 50%, escalate before Stage 1.',
      currentSum: +(((classifications['iou-threshold-artifact'] || 0) + (classifications['wider-span-contains-gold'] || 0)) / counts.total * 100).toFixed(1),
    },
  };

  fs.writeFileSync(path.join(OUT_DIR, 'stage0-summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(
    path.join(OUT_DIR, 'stage0-failures.jsonl'),
    detailed.map((r) => JSON.stringify(r)).join('\n'),
  );

  console.log('Stage 0 audit complete.');
  console.log(`  dev rows (best-query slice): ${counts.total}`);
  console.log(`  PASS=${counts.pass} (${(counts.pass / counts.total * 100).toFixed(1)}%)  PARTIAL=${counts.partial} (${(counts.partial / counts.total * 100).toFixed(1)}%)  FAIL=${counts.fail} (${(counts.fail / counts.total * 100).toFixed(1)}%)`);
  console.log(`  classifications (dev-only):`);
  for (const [k, v] of Object.entries(classifications).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(30)} ${String(v).padStart(3)}  (${(v / counts.total * 100).toFixed(1)}%)`);
  }
  console.log(`  benchmark-shape signals:`);
  console.log(`    failures with span fully containing gold: ${containsGoldAmongFails}/${detailed.length} (${detailed.length > 0 ? (containsGoldAmongFails / detailed.length * 100).toFixed(1) : 0}%)`);
  console.log(`    failures with top-1 = file header:         ${top1FileHeaderAmongFails}/${detailed.length} (${detailed.length > 0 ? (top1FileHeaderAmongFails / detailed.length * 100).toFixed(1) : 0}%)`);
  console.log(`  iou-threshold-artifact + wider-span-contains-gold = ${summary.stageOneStopRule.currentSum}% (stop rule: >50%)`);
  console.log(`  per-family:`);
  for (const [f, s] of Object.entries(perFamily)) {
    console.log(`    ${f.padEnd(22)} n=${s.n} PASS=${s.pass} PART=${s.partial} FAIL=${s.fail}`);
  }
  console.log(`  per-language (sorted by FAIL desc):`);
  const langs = Object.entries(perLanguage).sort((a, b) => (b[1].fail / b[1].n) - (a[1].fail / a[1].n));
  for (const [l, s] of langs) {
    const failPct = (s.fail / s.n * 100).toFixed(0);
    console.log(`    ${l.padEnd(16)} (${s.family.padEnd(22)}) n=${s.n}  PASS=${s.pass} PART=${s.partial} FAIL=${s.fail}  FAIL%=${failPct}`);
  }
  console.log(`  output:`);
  console.log(`    ${path.relative(REPO_ROOT, path.join(OUT_DIR, 'stage0-summary.json'))}`);
  console.log(`    ${path.relative(REPO_ROOT, path.join(OUT_DIR, 'stage0-failures.jsonl'))}`);
}

main();

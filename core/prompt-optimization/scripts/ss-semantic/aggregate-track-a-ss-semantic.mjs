#!/usr/bin/env node
/**
 * aggregate-track-a-ss-semantic.mjs — emit recommendations-v2-ss-semantic.json
 * from the ss-semantic Track A JSONL output (PHASE6_REDO §12.1, 2026-05-13).
 *
 * Mirrors aggregate-track-a-ss-find.mjs's 3-strategy template:
 *   1. simple_global       — single V-cell maximizing global IoU
 *   2. family_conditioned  — V-default + per-family overrides where the
 *                            family-best beats default by ≥ 8pp IoU
 *   3. popular_weighted    — agentic-tier weighted winner; diversity-
 *                            enforced if it collides with simple_global
 *
 * Primary metric: span-IoU (top-1) — the right rubric for in-file span
 * retrieval (file is the input, span is the output).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FAMILIES, COVERED_LANGUAGES, normalizeProbePackKey } from '../../data/query-shapes/family-map.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const TRACKS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-semantic/tracks');
const WEIGHTS_PATH = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-find/agentic-tier-weights.json');
const OUTPUT_PATH = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/recommendations-v2-ss-semantic.json');

const SCHEMA_VERSION = 1;
const FAMILY_OVERRIDE_THRESHOLD_PP = 0.08;
const V_CELLS = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7'];

const V_INSTRUCTION_TEXT = Object.freeze({
  V1: 'For ss-semantic (in-file span retrieval): phrase a very short imperative query consisting of the target symbol verbatim, optionally with one descriptor word (≤ 3 tokens).',
  V2: 'For ss-semantic: phrase a short interrogative query (4-8 tokens) that contains the target symbol verbatim. Use "how does X …" / "where is X …" framing.',
  V3: 'For ss-semantic: phrase a short declarative noun-phrase (4-8 tokens) describing the behaviour you want; the symbol is not required since the file is already known.',
  V4: 'For ss-semantic: phrase a medium interrogative query (9-15 tokens) that contains the target symbol verbatim and at least one domain-specific keyword.',
  V5: 'For ss-semantic: phrase a medium descriptive query (9-15 tokens) with generic English terms; the file is the input, so the symbol is not needed.',
  V6: 'For ss-semantic: phrase a long natural-language question (≥ 16 tokens) describing the behaviour without naming the symbol.',
  V7: 'For ss-semantic: phrase a medium declarative noun-phrase (9-15 tokens) that contains the target symbol verbatim and at least one domain-specific keyword.',
});

// §7 Stack-Overflow-2024 tier weights — kept as a reference scheme.
const TIER_WEIGHTS_SO = Object.freeze({
  javascript: 3, typescript: 3, python: 3, rust: 3, java: 3,
  csharp: 2, cpp: 2, go: 2, kotlin: 2, ruby: 2, php: 2, c: 2, dart: 2, 'typescript-lib': 2,
  scala: 1, lua: 1, elixir: 1, zig: 1,
});

function parseArgs(argv) {
  const out = { runId: null, dryRun: false, outPath: null };
  for (const arg of argv) {
    if (arg.startsWith('--run-id=')) out.runId = arg.slice('--run-id='.length);
    else if (arg.startsWith('--out=')) out.outPath = arg.slice('--out='.length);
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('usage: aggregate-track-a-ss-semantic.mjs [--run-id=<id>] [--out=<path>] [--dry-run]\n');
      process.exit(0);
    } else {
      process.stderr.write(`aggregate-track-a-ss-semantic: unknown arg "${arg}"\n`);
      process.exit(2);
    }
  }
  return out;
}

function pickLatestTrack() {
  if (!fs.existsSync(TRACKS_DIR)) return null;
  const files = fs.readdirSync(TRACKS_DIR)
    .filter((n) => n.startsWith('track-a-') && n.endsWith('.jsonl'))
    .map((n) => ({ name: n, mtime: fs.statSync(path.join(TRACKS_DIR, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0]?.name ? path.join(TRACKS_DIR, files[0].name) : null;
}

function loadJsonl(p) {
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
}

function mean(xs) { if (!xs.length) return null; let s = 0; for (const x of xs) s += x; return s / xs.length; }

export function buildPerCellTable(rows) {
  const t = {};
  for (const r of rows) {
    if (r.goldClass !== 'ast-tester') continue;
    if (r.shape === 'V_baseline') continue;
    t[r.shape] ||= { n: 0, iou: 0, coverage: 0, precision: 0 };
    t[r.shape].n++;
    t[r.shape].iou += r.top1_iou;
    t[r.shape].coverage += r.coverage;
    t[r.shape].precision += r.precision;
  }
  return t;
}

export function buildPerFamilyTable(rows) {
  const t = {};
  for (const f of Object.keys(FAMILIES)) t[f] = {};
  for (const r of rows) {
    if (r.goldClass !== 'ast-tester') continue;
    if (r.shape === 'V_baseline') continue;
    if (!t[r.family]) continue;
    t[r.family][r.shape] ||= { n: 0, iou: 0 };
    t[r.family][r.shape].n++;
    t[r.family][r.shape].iou += r.top1_iou;
  }
  return t;
}

export function buildPerLanguageTable(rows) {
  const t = {};
  for (const r of rows) {
    if (r.goldClass !== 'ast-tester') continue;
    if (r.shape === 'V_baseline') continue;
    const k = `${r.shape}|${r.language}`;
    t[k] ||= { n: 0, iou: 0 };
    t[k].n++;
    t[k].iou += r.top1_iou;
  }
  return t;
}

export function pickGlobalBest(table) {
  let best = { shape: null, score: -1, n: 0 };
  for (const [shape, c] of Object.entries(table)) {
    const s = c.iou / c.n;
    if (s > best.score) best = { shape, score: s, n: c.n, coverage: c.coverage / c.n, precision: c.precision / c.n };
  }
  return best;
}

export function pickFamilyBests(famTable) {
  const out = {};
  for (const [fam, cells] of Object.entries(famTable)) {
    let best = { shape: null, score: -1 };
    for (const [shape, c] of Object.entries(cells)) {
      const s = c.iou / c.n;
      if (s > best.score) best = { shape, score: s, n: c.n };
    }
    out[fam] = best;
  }
  return out;
}

export function pickWeightedBest(langTable, weights, excludeShape = null) {
  const accum = {};
  for (const [k, c] of Object.entries(langTable)) {
    const [shape, lang] = k.split('|');
    const canonical = normalizeProbePackKey(lang);
    const w = weights[canonical] ?? weights[lang] ?? 1;
    accum[shape] ||= { wSum: 0, wScoreSum: 0 };
    accum[shape].wSum += w;
    accum[shape].wScoreSum += w * (c.iou / c.n);
  }
  const ranked = Object.entries(accum)
    .filter(([, v]) => v.wSum > 0)
    .map(([shape, v]) => ({ shape, score: v.wScoreSum / v.wSum }))
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return { shape: null, score: -1, diversityEnforced: false };
  const natural = ranked[0];
  if (!excludeShape || natural.shape !== excludeShape) return { ...natural, diversityEnforced: false };
  const alt = ranked[1] ?? null;
  if (!alt) return { ...natural, diversityEnforced: false };
  return { ...alt, diversityEnforced: true, naturalWinner: natural };
}

function emitStrategy(shape, score, label, source) {
  if (!shape) return null;
  return {
    shape,
    primary_metric: 'top1_iou',
    iou_score: score,
    instruction_text: V_INSTRUCTION_TEXT[shape] ?? null,
    source,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const trackFile = opts.runId
    ? path.join(TRACKS_DIR, `track-a-${opts.runId}.jsonl`)
    : pickLatestTrack();
  if (!trackFile || !fs.existsSync(trackFile)) {
    process.stderr.write('aggregate-track-a-ss-semantic: no Track A JSONL found\n');
    process.exit(2);
  }
  process.stdout.write(`aggregate-track-a-ss-semantic: reading ${path.relative(REPO_ROOT, trackFile)}\n`);

  const rows = loadJsonl(trackFile);
  const runId = rows[0]?.runId || path.basename(trackFile, '.jsonl').replace(/^track-a-/, '');

  const weightsJson = JSON.parse(fs.readFileSync(WEIGHTS_PATH, 'utf8'));
  const weightsAgentic = weightsJson.weights;

  const cellTable = buildPerCellTable(rows);
  const famTable = buildPerFamilyTable(rows);
  const langTable = buildPerLanguageTable(rows);

  const baselineRows = rows.filter((r) => r.goldClass === 'ast-tester' && r.shape === 'V_baseline');
  const baselineIou = mean(baselineRows.map((r) => r.top1_iou));

  // Strategy 1 — simple_global
  const simpleGlobal = pickGlobalBest(cellTable);
  const strategy1 = emitStrategy(simpleGlobal.shape, simpleGlobal.score, 'simple-global',
    `best global top1-IoU across ${simpleGlobal.n} ast-tester golds`);

  // Strategy 2 — family_conditioned
  const famBests = pickFamilyBests(famTable);
  const overrides = {};
  for (const [family, fb] of Object.entries(famBests)) {
    if (!fb.shape || fb.shape === simpleGlobal.shape) continue;
    const onFam = famTable[family]?.[simpleGlobal.shape];
    const onFamScore = onFam ? onFam.iou / onFam.n : 0;
    const delta = fb.score - onFamScore;
    if (delta < FAMILY_OVERRIDE_THRESHOLD_PP) continue;
    overrides[family] = {
      shape: fb.shape,
      iou_score: fb.score,
      delta_vs_default_iou: delta,
      global_on_family_iou: onFamScore,
      instruction_text: V_INSTRUCTION_TEXT[fb.shape] ?? null,
      source: `family-best (Δ vs global = +${(delta * 100).toFixed(1)}pp IoU)`,
    };
  }
  const strategy2 = { default: { ...strategy1, source: 'family-conditioned default (= simple-global)' }, overrides };

  // Strategy 3 — popular_weighted (agentic-tier; diversity-enforced if collides with Strategy 1)
  const popAgentic = pickWeightedBest(langTable, weightsAgentic, simpleGlobal.shape);
  const popSO = pickWeightedBest(langTable, TIER_WEIGHTS_SO, simpleGlobal.shape);
  const strategy3 = emitStrategy(popAgentic.shape, popAgentic.score,
    popAgentic.diversityEnforced ? 'popular-weighted (agentic-tier, diversity-enforced)' : 'popular-weighted (agentic-tier)',
    popAgentic.diversityEnforced
      ? '2nd-best agentic-tier weighted IoU (top pick matched simple_global; promoted 2nd-best for GEPA diversity)'
      : 'best agentic-tier weighted IoU (TS/Python/Rust=5)');
  if (strategy3) {
    strategy3.diversity_enforced = popAgentic.diversityEnforced;
    if (popAgentic.naturalWinner) {
      strategy3.natural_winner = {
        shape: popAgentic.naturalWinner.shape,
        iou_score: popAgentic.naturalWinner.score,
        note: 'Natural agentic-tier winner; matched simple_global so 2nd-best was promoted instead for GEPA diversity.',
      };
    }
    strategy3.alt_so_tier = emitStrategy(popSO.shape, popSO.score, 'popular-weighted (so-tier)', 'best §7 Stack-Overflow-weighted IoU');
  }

  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    tool: 'ss-semantic',
    runId,
    generatedAt: new Date().toISOString(),
    plan_reference: 'docs/PHASE6_REDO.md §12.1 + 2026-05-13 ss-semantic redo',
    primary_metric: 'top1_iou',
    grid: { v_cells: V_CELLS, cells_per_gold: V_CELLS.length },
    families: Object.fromEntries(Object.entries(FAMILIES).map(([f, l]) => [f, { languages: [...l] }])),
    baseline: {
      shape: 'V_baseline (gold.query)',
      avg_top1_iou: baselineIou,
      n: baselineRows.length,
    },
    strategies: {
      simple_global: strategy1,
      family_conditioned: strategy2,
      popular_weighted_agentic: strategy3,
    },
    cell_table_global: cellTable,
    cell_table_by_family: famTable,
    manual_gates_pending: ['G2-thresholdout', 'G4-codex-author-review', 'doc-negative-regression'],
    behavior_notes: [
      'Three strategies shipped per the 2026-05-13 design. PHASE7 / GEPA picks empirically.',
      'Primary metric = span top-1 IoU (intersection-over-union with the gold containing-chunk line range).',
      'Doc-positive golds skipped (ss-semantic operates on a known file; doc-positive is "find this file from a description" — different intent).',
      'Variants reused VERBATIM from the ss-search V1-V7 corpus — the agent NL surface is identical.',
    ],
  };

  if (opts.dryRun) {
    process.stdout.write(`\n--- DRY-RUN ---\n`);
    process.stdout.write(`Strategy 1 (simple_global): ${strategy1.shape} (IoU ${strategy1.iou_score.toFixed(3)})\n`);
    process.stdout.write(`Strategy 2 (family_conditioned): default ${strategy2.default.shape}, ${Object.keys(overrides).length} override(s)\n`);
    for (const [fam, e] of Object.entries(overrides)) {
      process.stdout.write(`  ${fam.padEnd(25)} → ${e.shape} (Δ ${(e.delta_vs_default_iou * 100).toFixed(1)}pp)\n`);
    }
    process.stdout.write(`Strategy 3 (popular_weighted): ${strategy3?.shape} (IoU ${strategy3?.iou_score.toFixed(3)})  diversity_enforced=${strategy3?.diversity_enforced}\n`);
    process.exit(0);
  }
  const outPath = opts.outPath ? path.resolve(opts.outPath) : OUTPUT_PATH;
  fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2) + '\n');
  process.stdout.write(`aggregate-track-a-ss-semantic: wrote ${path.relative(REPO_ROOT, outPath)}\n`);
}

const isMainModule = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMainModule) {
  main().catch((err) => { process.stderr.write(`aggregate-track-a-ss-semantic: fatal ${err.stack || err.message}\n`); process.exit(1); });
}

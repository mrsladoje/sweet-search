#!/usr/bin/env node
/**
 * aggregate-track-a-ss-find.mjs — emit recommendations-v2-ss-find.json from
 * the ss-find Track A JSONL output (PHASE6_REDO §12.1, refined 2026-05-13).
 *
 * Emits THREE distinct strategies for PHASE7 / GEPA to evolve against:
 *   1. `default` (simple global)     — single (R, Q) cell that maximizes the
 *                                       global symbol_recall across all 144
 *                                       AST-tester golds. Used when family
 *                                       classification is unavailable.
 *   2. `family_overrides`            — per-family best (R, Q) cell. The
 *                                       agent runtime classifies the target
 *                                       file's language → family, then picks.
 *   3. `popular_weighted`            — single (R, Q) cell weighted by the
 *                                       2026 agentic-tier popularity weights
 *                                       (TS/Python/Rust=5, mainstream=3,
 *                                       longtail=1). Captures "what works
 *                                       for the languages agents actually
 *                                       edit most" — distinct from #1.
 *
 * Primary metric: symbol_recall@1 (strict PASS — file + symbol both match).
 * See PHASE6_REDO.md §6.1 + the 2026-05-13 ss-search amendment for why
 * symbol_recall is the primary metric for agent-deployment.
 *
 * Usage:
 *   node aggregate-track-a-ss-find.mjs                        # auto-pick latest jsonl
 *   node aggregate-track-a-ss-find.mjs --run-id=<id>
 *   node aggregate-track-a-ss-find.mjs --out=<path.json>
 *   node aggregate-track-a-ss-find.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FAMILIES, COVERED_LANGUAGES, normalizeProbePackKey } from '../../data/query-shapes/family-map.mjs';
import { R_CELLS, R_LABELS } from './r-templates.mjs';
import { Q_CELLS, Q_LABELS } from './author-variants-ss-find.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const TRACKS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-find/tracks');
const WEIGHTS_PATH = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-find/agentic-tier-weights.json');
const OUTPUT_PATH = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/recommendations-v2-ss-find.json');

const SCHEMA_VERSION = 1;
const FAMILY_OVERRIDE_THRESHOLD_PP = 0.08; // override iff family-best beats default by ≥ 8pp symbol_recall

// §7 Stack-Overflow-2024 tier weights — kept as a reference scheme for the
// "stack-overflow-weighted" companion alongside the agentic-tier scheme.
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
      process.stdout.write('usage: aggregate-track-a-ss-find.mjs [--run-id=<id>] [--out=<path>] [--dry-run]\n');
      process.exit(0);
    } else {
      process.stderr.write(`aggregate-track-a-ss-find: unknown arg "${arg}"\n`);
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

/**
 * Per (R, Q) global aggregate across all ast-tester golds. Returns
 * { fileMean, symMean, n } per cell.
 */
export function buildGlobalCellTable(rows) {
  const table = {};
  for (const r of rows) {
    if (r.goldClass !== 'ast-tester') continue;
    if (r.rCell === 'R2_baseline') continue;
    const k = `${r.rCell}|${r.qCell}`;
    table[k] ||= { n: 0, file: 0, sym: 0 };
    table[k].n++;
    table[k].file += r.fileRecallAt1;
    table[k].sym += r.symbolRecallAt1;
  }
  return table;
}

/**
 * Per (family, R, Q) aggregate. Returns map keyed by family → { cell → {fileMean, symMean, n} }.
 */
export function buildFamilyCellTable(rows) {
  const out = {};
  for (const family of Object.keys(FAMILIES)) out[family] = {};
  for (const r of rows) {
    if (r.goldClass !== 'ast-tester') continue;
    if (r.rCell === 'R2_baseline') continue;
    const k = `${r.rCell}|${r.qCell}`;
    const fam = r.family;
    if (!out[fam]) continue;
    out[fam][k] ||= { n: 0, file: 0, sym: 0 };
    out[fam][k].n++;
    out[fam][k].file += r.fileRecallAt1;
    out[fam][k].sym += r.symbolRecallAt1;
  }
  return out;
}

/**
 * Per (R, Q) × language aggregate. Used by the weighted-aggregate computation.
 */
export function buildLanguageCellTable(rows) {
  const out = {};
  for (const r of rows) {
    if (r.goldClass !== 'ast-tester') continue;
    if (r.rCell === 'R2_baseline') continue;
    const k = `${r.rCell}|${r.qCell}|${r.language}`;
    out[k] ||= { n: 0, file: 0, sym: 0 };
    out[k].n++;
    out[k].file += r.fileRecallAt1;
    out[k].sym += r.symbolRecallAt1;
  }
  return out;
}

/**
 * Pick the (R, Q) cell that maximizes a given metric over the global cell table.
 */
export function pickGlobalBest(table, metric) {
  let best = { cell: null, score: -1, file: 0, sym: 0, n: 0 };
  for (const [k, c] of Object.entries(table)) {
    const score = (c[metric === 'file' ? 'file' : 'sym']) / c.n;
    if (score > best.score) {
      best = { cell: k, score, file: c.file / c.n, sym: c.sym / c.n, n: c.n };
    }
  }
  return best;
}

/**
 * Weighted-aggregate winner over a per-language cell table. Each language
 * contributes its per-cell score with the supplied weight.
 *
 * `excludeCell` (optional) — if the top pick matches this cell key, the
 * function returns the 2nd-best cell instead. Used by Strategy 3 to ensure
 * the popular-weighted recommendation differs from Strategy 1 (simple-global)
 * so GEPA has genuine diversity to evolve against. The artifact records both
 * the natural-winner and the diversity-enforced pick.
 */
export function pickWeightedBest(langTable, weights, metric, excludeCell = null) {
  const accum = {};
  for (const [k, c] of Object.entries(langTable)) {
    const [rc, qc, lang] = k.split('|');
    const canonical = normalizeProbePackKey(lang);
    const w = weights[canonical] ?? weights[lang] ?? 1;
    const cell = `${rc}|${qc}`;
    accum[cell] ||= { wSum: 0, wScoreSum: 0, file: 0, sym: 0, nCells: 0 };
    const score = (c[metric === 'file' ? 'file' : 'sym']) / c.n;
    accum[cell].wSum += w;
    accum[cell].wScoreSum += w * score;
    accum[cell].file += w * (c.file / c.n);
    accum[cell].sym += w * (c.sym / c.n);
    accum[cell].nCells++;
  }
  // Rank all cells; return either the top or top-excluding-excludeCell.
  const ranked = Object.entries(accum)
    .filter(([, v]) => v.wSum > 0)
    .map(([k, v]) => ({ cell: k, score: v.wScoreSum / v.wSum, file: v.file / v.wSum, sym: v.sym / v.wSum }))
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return { cell: null, score: -1, file: 0, sym: 0 };
  const natural = ranked[0];
  if (!excludeCell || natural.cell !== excludeCell) return { ...natural, diversityEnforced: false };
  const alt = ranked[1] ?? null;
  if (!alt) return { ...natural, diversityEnforced: false };
  return { ...alt, diversityEnforced: true, naturalWinner: natural };
}

/**
 * Find per-family best cell on a metric.
 */
export function pickFamilyBests(famTable, metric) {
  const out = {};
  for (const [family, cells] of Object.entries(famTable)) {
    let best = { cell: null, score: -1, file: 0, sym: 0, n: 0 };
    for (const [k, c] of Object.entries(cells)) {
      const s = (c[metric === 'file' ? 'file' : 'sym']) / c.n;
      if (s > best.score) best = { cell: k, score: s, file: c.file / c.n, sym: c.sym / c.n, n: c.n };
    }
    out[family] = best;
  }
  return out;
}

// ─── instruction_text builders ────────────────────────────────────────────

function rExplain(rCell) {
  const m = {
    R1: 'bare literal (no anchors): the symbol itself, e.g., `detect_package_root`',
    R2: 'word-bounded literal: `\\b<symbol>\\b` — the canonical narrow anchor',
    R3: 'definition-anchored: `\\b<family-keyword>\\s+<symbol>\\b` — language-keyword + symbol; catches the def site',
    R4: 'wildcard around a sub-token: `\\b\\w*<stem>\\w*\\b` — catches morphological variants',
    R5: 'small alternation: `\\b(<symbol>|<sibling1>|<sibling2>)\\b` — symbol + 2 graph/chunk siblings',
    R6: 'broad alternation: `\\b(<6 domain tokens>)\\b` — 6 domain-content tokens',
    R7: 'character-class shape: `\\b[a-z_]*<stem>[a-z_]*\\b` — class-bounded morphology',
  };
  return m[rCell] ?? '';
}

function qExplain(qCell) {
  const m = {
    Q1: 'single domain keyword (1 token) — recycled from the symbol or a sub-token',
    Q2: 'very-short keyword phrase (2-4 tokens, NO symbol)',
    Q3: 'short imperative + symbol verbatim (4-8 tokens) — e.g., "find <Symbol> usage"',
    Q4: 'short interrogative + symbol verbatim (4-8 tokens) — e.g., "how does <Symbol> work"',
    Q5: 'medium descriptive (9-15 tokens, NO symbol) — behavior-focused',
    Q6: 'medium behavioral imperative (9-15 tokens, NO symbol) — "show every place that …"',
    Q7: 'long-NL narrative (≥ 16 tokens, NO symbol) — verbose context',
  };
  return m[qCell] ?? '';
}

function instructionTextForCell(rCell, qCell, label) {
  return (
    `${label ? `[${label}] ` : ''}For ss-find: build the regex as ${rExplain(rCell)} ` +
    `AND phrase the semantic query as ${qExplain(qCell)}.`
  );
}

function emitStrategyEntry(cell, label, source, metric = 'symbolRecallAt1') {
  if (!cell?.cell) return null;
  const [rCell, qCell] = cell.cell.split('|');
  return {
    rCell, qCell,
    rLabel: R_LABELS[rCell] ?? null,
    qLabel: Q_LABELS[qCell] ?? null,
    file_recall_at_1: cell.file,
    symbol_recall_at_1: cell.sym,
    primary_metric: metric,
    instruction_text: instructionTextForCell(rCell, qCell, label),
    source,
  };
}

// ─── main ─────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const trackFile = opts.runId
    ? path.join(TRACKS_DIR, `track-a-${opts.runId}.jsonl`)
    : pickLatestTrack();
  if (!trackFile || !fs.existsSync(trackFile)) {
    process.stderr.write('aggregate-track-a-ss-find: no Track A JSONL found\n');
    process.exit(2);
  }
  process.stdout.write(`aggregate-track-a-ss-find: reading ${path.relative(REPO_ROOT, trackFile)}\n`);

  const rows = loadJsonl(trackFile);
  const runId = rows[0]?.runId || path.basename(trackFile, '.jsonl').replace(/^track-a-/, '');

  const weightsJson = JSON.parse(fs.readFileSync(WEIGHTS_PATH, 'utf8'));
  const weightsAgentic = weightsJson.weights;

  const globalTable = buildGlobalCellTable(rows);
  const famTable = buildFamilyCellTable(rows);
  const langTable = buildLanguageCellTable(rows);

  // Baseline (R2-narrow + gold.query)
  const baselineRows = rows.filter((r) => r.goldClass === 'ast-tester' && r.rCell === 'R2_baseline');
  const baselineFile = baselineRows.length ? mean(baselineRows.map((r) => r.fileRecallAt1)) : null;
  const baselineSym = baselineRows.length ? mean(baselineRows.map((r) => r.symbolRecallAt1)) : null;

  // ─── Strategy 1 — simple global by symbol_recall ─────────────────────
  const simpleGlobal = pickGlobalBest(globalTable, 'sym');
  const strategy1 = emitStrategyEntry(simpleGlobal, 'simple-global', 'best global symbol_recall@1 across 144 ast-tester golds');

  // ─── Strategy 2 — family overrides ───────────────────────────────────
  const famBests = pickFamilyBests(famTable, 'sym');
  const overrides = {};
  for (const [family, fb] of Object.entries(famBests)) {
    if (!fb.cell) continue;
    if (fb.cell === simpleGlobal.cell) continue; // family matches global — no override
    // Only ship an override if the family-best beats the global cell on that family.
    const globalOnFamily = famTable[family]?.[simpleGlobal.cell];
    const globalOnFamilySym = globalOnFamily ? globalOnFamily.sym / globalOnFamily.n : 0;
    const delta = fb.sym - globalOnFamilySym;
    if (delta < FAMILY_OVERRIDE_THRESHOLD_PP) continue;
    const e = emitStrategyEntry(fb, `${family}-override`, `family-best (Δ vs global = +${(delta * 100).toFixed(1)}pp symbol_recall)`);
    if (e) {
      e.delta_vs_default_symbol_recall = delta;
      e.global_on_family_symbol_recall = globalOnFamilySym;
      overrides[family] = e;
    }
  }
  const strategy2 = {
    default: { ...strategy1, source: 'family-conditioned default (= simple-global)' },
    overrides,
  };

  // ─── Strategy 3 — popular-weighted (agentic tier) ────────────────────
  // Force diversity vs Strategy 1 so GEPA has a genuinely distinct
  // candidate. The natural agentic-tier winner is recorded in
  // `naturalWinner` for full transparency when it matches simple_global.
  const popularWeighted = pickWeightedBest(langTable, weightsAgentic, 'sym', simpleGlobal.cell);
  const popularSO = pickWeightedBest(langTable, TIER_WEIGHTS_SO, 'sym', simpleGlobal.cell);
  const strategy3 = emitStrategyEntry(popularWeighted, 'popular-weighted (agentic-tier)', popularWeighted.diversityEnforced
    ? `2nd-best weighted-agentic-tier cell (top pick matched simple_global; recorded under naturalWinner). Selected for GEPA diversity vs Strategy 1.`
    : 'best weighted symbol_recall under agentic-tier weights (TS/Python/Rust=5, mainstream=3, longtail=1)');
  if (strategy3) {
    strategy3.diversity_enforced = popularWeighted.diversityEnforced ?? false;
    if (popularWeighted.naturalWinner) {
      strategy3.natural_winner = {
        cell: popularWeighted.naturalWinner.cell,
        symbol_recall_at_1: popularWeighted.naturalWinner.sym,
        file_recall_at_1: popularWeighted.naturalWinner.file,
        note: 'Natural agentic-tier weighted winner; matched simple_global so the 2nd-best cell was promoted instead to preserve GEPA candidate diversity.',
      };
    }
    strategy3.alt_so_tier = emitStrategyEntry(popularSO, 'popular-weighted (so-tier)', 'best weighted symbol_recall under §7 Stack-Overflow tier weights — for reference');
  }

  // ─── Build the artifact ──────────────────────────────────────────────
  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    tool: 'ss-find',
    runId,
    generatedAt: new Date().toISOString(),
    plan_reference: 'docs/PHASE6_REDO.md §12.1 + 2026-05-13 ss-find amendment',
    primary_metric: 'symbolRecallAt1',
    grid: { r_cells: R_CELLS, q_cells: Q_CELLS, cells_per_gold: R_CELLS.length * Q_CELLS.length },
    families: Object.fromEntries(Object.entries(FAMILIES).map(([f, langs]) => [f, { languages: [...langs] }])),
    baseline: {
      regex: '\\b<expectedSymbol>\\b (R2-narrow)',
      query: '<gold.query> (the natural NL phrasing)',
      file_recall_at_1: baselineFile,
      symbol_recall_at_1: baselineSym,
      n: baselineRows.length,
    },
    strategies: {
      simple_global: strategy1,
      family_conditioned: strategy2,
      popular_weighted_agentic: strategy3,
    },
    // Full cell tables for transparency / downstream re-aggregation.
    cell_table_global: globalTable,
    cell_table_by_family: famTable,
    manual_gates_pending: ['G2-thresholdout', 'G4-codex-author-review', 'doc-negative-regression'],
    behavior_notes: [
      'Three strategies shipped per the 2026-05-13 design: PHASE7 / GEPA picks the one that performs best at agent-prompt-evolution time.',
      'Primary metric = symbol_recall@1 (strict PASS).',
      'family_conditioned.default mirrors simple_global. Overrides apply only where the family-best beats the global cell by ≥ 8pp symbol_recall.',
      'popular_weighted uses agentic-tier weights (TS/Python/Rust = 5). An alt_so_tier entry shows the §7 Stack-Overflow-weighted winner for reference.',
    ],
  };

  if (opts.dryRun) {
    process.stdout.write(`\n--- DRY-RUN ---\n`);
    process.stdout.write(`Strategy 1 (simple_global): ${strategy1?.rCell}×${strategy1?.qCell} ` +
      `(file ${(strategy1?.file_recall_at_1 * 100).toFixed(0)}%, sym ${(strategy1?.symbol_recall_at_1 * 100).toFixed(0)}%)\n`);
    process.stdout.write(`Strategy 2 (family_conditioned): default ${strategy2.default.rCell}×${strategy2.default.qCell}, ` +
      `${Object.keys(overrides).length} override(s)\n`);
    for (const [fam, e] of Object.entries(overrides)) {
      process.stdout.write(`  ${fam.padEnd(25)} → ${e.rCell}×${e.qCell} (Δ ${(e.delta_vs_default_symbol_recall * 100).toFixed(1)}pp)\n`);
    }
    process.stdout.write(`Strategy 3 (popular_weighted_agentic): ${strategy3?.rCell}×${strategy3?.qCell} ` +
      `(weighted sym ${(strategy3?.symbol_recall_at_1 * 100).toFixed(1)}%)\n`);
    process.exit(0);
  }
  const outPath = opts.outPath ? path.resolve(opts.outPath) : OUTPUT_PATH;
  fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2) + '\n');
  process.stdout.write(`aggregate-track-a-ss-find: wrote ${path.relative(REPO_ROOT, outPath)}\n`);
}

const isMainModule = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMainModule) {
  main().catch((err) => { process.stderr.write(`aggregate-track-a-ss-find: fatal ${err.stack || err.message}\n`); process.exit(1); });
}

#!/usr/bin/env node
/**
 * aggregate-track-a.mjs — emit recommendations-v2.json from the Track A
 * JSONL output per docs/PHASE6_REDO.md §5.5.8, §6.2, §10.
 *
 * Pipeline:
 *   1. Load every JSONL row from tracks/track-a-<runId>.jsonl (or the
 *      latest file in tracks/ if --run-id is omitted).
 *   2. For each (language, gold, shape) bucket, compute file_recall@1 etc.
 *      The baseline is the row with shape == "V_baseline" (the gold's
 *      original query phrasing, per §5.5.8).
 *   3. Per-language mean → family aggregate (uniform within-family per §7)
 *      → weighted aggregate (Tier 1/2/3 weights from §7).
 *   4. Paired permutation tests per (family, shape) cell vs baseline
 *      (10K iter, seed=42 per §5.5.8). BH-FDR at q=0.10 over the 35-cell
 *      space (5 families × 7 shapes per §9 G1).
 *   5. Apply §8.1 / §8.2 / §8.3 promotion rules + §9 gates (G1+G3+G5
 *      automatic; G2 thresholdout + G4 codex review marked `pending`).
 *   6. Write core/prompt-optimization/data/query-shapes/recommendations-v2.json.
 *
 * Usage:
 *   node aggregate-track-a.mjs                       # auto-pick latest track-a-*.jsonl
 *   node aggregate-track-a.mjs --run-id=<id>         # specific run
 *   node aggregate-track-a.mjs --out=path.json       # alt output path
 *   node aggregate-track-a.mjs --dry-run             # print summary, no file write
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pairedPermutationTest } from '../stats/paired-permutation.mjs';
import { benjaminiHochberg } from '../stats/bh-fdr.mjs';
import { FAMILIES, COVERED_LANGUAGES, normalizeProbePackKey } from '../data/query-shapes/family-map.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const TRACKS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/tracks');
const OUTPUT_PATH = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/recommendations-v2.json');
const WHITELIST_PATH = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/leakage-whitelist.json');

const SCHEMA_VERSION = 4; // bumped 2026-05-13 — added popular_weighted Strategy 3
const SHAPES = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7'];
const BASELINE_SHAPE = 'V_baseline';

// §7 popularity tier weights (Stack-Overflow-2024-calibrated, retained as
// `TIER_WEIGHTS_SO` for the legacy `weighted_aggregate` field).
const TIER_WEIGHTS = Object.freeze({
  // Tier-1 (weight=3)
  javascript: 3, typescript: 3, python: 3, rust: 3, java: 3,
  // Tier-2 (weight=2)
  csharp: 2, cpp: 2, go: 2, kotlin: 2, ruby: 2, php: 2, c: 2, dart: 2,
  // typescript-lib is normalized to typescript before lookup, but include
  // an explicit entry for safety on raw inputs.
  'typescript-lib': 2,
  // Tier-3 (weight=1)
  scala: 1, lua: 1, elixir: 1, zig: 1,
});

// Agentic-tier weights for the 2026-05-13 popular_weighted Strategy 3.
// Calibrated from GitHub Octoverse 2025 + JetBrains AI Pulse Jan 2026 +
// gradually.ai 2026 Claude Code / Codex stats. TS/Python/Rust are S-tier
// because the Octoverse data explicitly ties the TypeScript rise to AI-
// assisted-coding reliability.
const TIER_WEIGHTS_AGENTIC = Object.freeze({
  typescript: 5, python: 5, rust: 5, 'typescript-lib': 5,
  javascript: 3, java: 3, go: 3, csharp: 3,
  cpp: 2, c: 2, kotlin: 2, ruby: 2, dart: 2, php: 2,
  scala: 1, lua: 1, elixir: 1, zig: 1,
});

// ─── helpers ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    runId: null, dryRun: false, outPath: null, q: 0.10,
    primaryMetric: 'fileRecallAt1',
    promotionMode: 'within-family',   // 'within-family' (§8.1 strict) or 'global' (Option C)
    overridesPath: null,                // JSON: { "family": "Vk", ... }
  };
  for (const arg of argv) {
    if (arg.startsWith('--run-id=')) out.runId = arg.slice('--run-id='.length);
    else if (arg.startsWith('--out=')) out.outPath = arg.slice('--out='.length);
    else if (arg.startsWith('--q=')) out.q = Number(arg.slice('--q='.length));
    else if (arg === '--primary-metric=file_recall') out.primaryMetric = 'fileRecallAt1';
    else if (arg === '--primary-metric=symbol_recall') out.primaryMetric = 'symbolRecallAt1';
    else if (arg.startsWith('--primary-metric=')) {
      process.stderr.write('aggregate-track-a: --primary-metric must be file_recall or symbol_recall\n');
      process.exit(2);
    }
    else if (arg === '--promotion-mode=within-family') out.promotionMode = 'within-family';
    else if (arg === '--promotion-mode=global') out.promotionMode = 'global';
    else if (arg.startsWith('--overrides=')) out.overridesPath = arg.slice('--overrides='.length);
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('usage: aggregate-track-a.mjs [--run-id=<id>] [--out=path] [--q=0.10] [--primary-metric=file_recall|symbol_recall] [--promotion-mode=within-family|global] [--overrides=path.json] [--dry-run]\n');
      process.exit(0);
    } else {
      process.stderr.write(`aggregate-track-a: unknown arg "${arg}"\n`);
      process.exit(2);
    }
  }
  return out;
}

function pickLatestTrackA() {
  if (!fs.existsSync(TRACKS_DIR)) return null;
  const files = fs.readdirSync(TRACKS_DIR)
    .filter((n) => n.startsWith('track-a-') && n.endsWith('.jsonl'))
    .map((n) => ({ name: n, mtime: fs.statSync(path.join(TRACKS_DIR, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0]?.name ? path.join(TRACKS_DIR, files[0].name) : null;
}

function loadJsonl(p) {
  const txt = fs.readFileSync(p, 'utf8');
  const rows = [];
  for (const line of txt.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); }
    catch (err) {
      process.stderr.write(`aggregate-track-a: skipping malformed JSONL row: ${err.message}\n`);
    }
  }
  return rows;
}

/**
 * Bucket rows into:
 *   byGold     : goldId → { row, shapes: shape → row }
 *   byLanguage : language → goldIds
 *
 * `language` is normalised to the canonical id (typescript-lib → typescript).
 */
export function bucketRows(rows) {
  const byGold = new Map();
  const byLanguage = new Map();
  for (const row of rows) {
    const lang = normalizeProbePackKey(row.language);
    if (!byGold.has(row.goldId)) {
      byGold.set(row.goldId, {
        goldId: row.goldId, rawLanguage: row.language, language: lang,
        family: row.family, goldClass: row.goldClass, shapes: new Map(),
      });
    }
    byGold.get(row.goldId).shapes.set(row.shape, row);
    if (!byLanguage.has(lang)) byLanguage.set(lang, new Set());
    byLanguage.get(lang).add(row.goldId);
  }
  return { byGold, byLanguage };
}

/**
 * Build paired observation vectors for (family, shape) — baseline vs candidate.
 * Returns the gold-level pairs that have BOTH a baseline row AND a candidate
 * row. Golds with a missing baseline OR missing candidate are excluded from
 * the (family, shape) cell. `metric` selects fileRecallAt1 (default) or
 * symbolRecallAt1.
 */
export function pairsForCell({ byGold, family, shape, metric = 'fileRecallAt1' }) {
  const baseline = [];
  const candidate = [];
  const meta = [];
  for (const gold of byGold.values()) {
    if (gold.family !== family) continue;
    const baseRow = gold.shapes.get(BASELINE_SHAPE);
    const candRow = gold.shapes.get(shape);
    if (!baseRow || !candRow) continue;
    if (baseRow.error || candRow.error) continue;
    baseline.push(baseRow[metric]);
    candidate.push(candRow[metric]);
    meta.push({ goldId: gold.goldId, language: gold.language });
  }
  return { baseline, candidate, meta };
}

/**
 * Build paired observation vectors GLOBALLY (across all families) for a
 * given shape — used for Option-C global permutation per the 2026-05-13
 * promotion-rule amendment. n is much larger (≈ 144 for AST-tester golds)
 * so the test has substantially more power than the within-family check.
 */
export function pairsForGlobal({ byGold, shape, metric = 'fileRecallAt1' }) {
  const baseline = [];
  const candidate = [];
  const meta = [];
  for (const gold of byGold.values()) {
    // Only ast-tester golds carry a meaningful symbol_recall — doc-positive
    // golds have a null expected symbol, so the metric is vacuously zero or
    // one. Restrict to ast-tester for both metrics for consistency.
    if (gold.goldClass !== 'ast-tester') continue;
    const baseRow = gold.shapes.get(BASELINE_SHAPE);
    const candRow = gold.shapes.get(shape);
    if (!baseRow || !candRow) continue;
    if (baseRow.error || candRow.error) continue;
    baseline.push(baseRow[metric]);
    candidate.push(candRow[metric]);
    meta.push({ goldId: gold.goldId, language: gold.language, family: gold.family });
  }
  return { baseline, candidate, meta };
}

function mean(xs) {
  if (!xs.length) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/**
 * Per-language mean recall@1 for one shape across all that language's
 * eligible golds in the track output. `metric` switches between
 * fileRecallAt1 (default, §6.1 primary) and symbolRecallAt1 (strict).
 */
export function perLanguageMean({ byGold, language, shape, metric = 'fileRecallAt1' }) {
  const recalls = [];
  for (const gold of byGold.values()) {
    if (gold.language !== language) continue;
    const row = gold.shapes.get(shape);
    if (!row || row.error) continue;
    recalls.push(row[metric]);
  }
  return { mean: mean(recalls), n: recalls.length };
}

/**
 * Per-family aggregate (uniform within family per §7).
 */
export function perFamilyAggregate({ byGold, family, shape, metric = 'fileRecallAt1' }) {
  const langs = FAMILIES[family] || [];
  const langMeans = [];
  let nPairs = 0;
  for (const lang of langs) {
    const canonical = normalizeProbePackKey(lang);
    const { mean: m, n } = perLanguageMean({ byGold, language: canonical, shape, metric });
    if (m != null) {
      langMeans.push(m);
      nPairs += n;
    }
  }
  return { mean: mean(langMeans), nLangs: langMeans.length, nPairs };
}

/**
 * Macro-average (uniform across 18 covered languages).
 */
export function macroAggregate({ byGold, shape, metric = 'fileRecallAt1' }) {
  const langMeans = [];
  for (const lang of COVERED_LANGUAGES) {
    const { mean: m } = perLanguageMean({ byGold, language: lang, shape, metric });
    if (m != null) langMeans.push(m);
  }
  return mean(langMeans);
}

/**
 * Weighted aggregate using §7 tier weights.
 */
export function weightedAggregate({ byGold, shape, metric = 'fileRecallAt1' }) {
  let weightedSum = 0;
  let weightSum = 0;
  for (const lang of COVERED_LANGUAGES) {
    const { mean: m } = perLanguageMean({ byGold, language: lang, shape, metric });
    if (m == null) continue;
    const w = TIER_WEIGHTS[lang] ?? 1;
    weightedSum += w * m;
    weightSum += w;
  }
  return weightSum > 0 ? weightedSum / weightSum : null;
}

/**
 * G3 — token-overlap leakage. Hard-reject any candidate `instruction_text`
 * whose 3-grams overlap with dev-probe symbol/path/answer tokens that are
 * NOT in the whitelist.
 *
 * For PHASE6_REDO this gate runs only when an instruction_text is actually
 * supplied (the promotion artifact populates this at G4-pending time).
 * Without a candidate text, we mark the gate `pending-no-text`.
 */
export function checkLeakage(text, whitelist, devCorpus) {
  if (!text || !text.trim()) return { gate: 'pending-no-text' };
  const words = String(text).toLowerCase().split(/\W+/u).filter(Boolean);
  if (words.length < 3) return { gate: 'pass', reason: 'too short for 3-gram check' };
  const grams = new Set();
  for (let i = 0; i + 2 < words.length; i++) grams.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  const corpusGrams = new Set();
  for (const item of devCorpus) {
    const w = String(item).toLowerCase().split(/\W+/u).filter(Boolean);
    for (let i = 0; i + 2 < w.length; i++) corpusGrams.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  }
  const leaks = [];
  for (const g of grams) {
    if (!corpusGrams.has(g)) continue;
    const tokens = g.split(' ');
    if (tokens.every((t) => whitelist.has(t))) continue;
    leaks.push(g);
  }
  return leaks.length ? { gate: 'fail', leaks } : { gate: 'pass' };
}

/**
 * G5 — per-language stability within family. Worst-language recall@1 must
 * be ≥ 0.6 × best-language's.
 */
export function checkIntrafamilyStability({ byGold, family, shape }) {
  const langs = FAMILIES[family] || [];
  const langMeans = [];
  for (const lang of langs) {
    const canonical = normalizeProbePackKey(lang);
    const { mean: m, n } = perLanguageMean({ byGold, language: canonical, shape });
    if (m != null && n > 0) langMeans.push({ lang: canonical, mean: m, n });
  }
  if (langMeans.length < 2) {
    return { gate: 'insufficient-langs', langMeans };
  }
  const best = Math.max(...langMeans.map((l) => l.mean));
  const worst = Math.min(...langMeans.map((l) => l.mean));
  if (best === 0) return { gate: 'pass', langMeans, ratio: 1 };
  const ratio = worst / best;
  return { gate: ratio >= 0.6 ? 'pass' : 'fail', langMeans, ratio };
}

// ─── main ─────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const trackFile = opts.runId
    ? path.join(TRACKS_DIR, `track-a-${opts.runId}.jsonl`)
    : pickLatestTrackA();
  if (!trackFile || !fs.existsSync(trackFile)) {
    process.stderr.write('aggregate-track-a: no Track A JSONL found (run track-a-runner.mjs first)\n');
    process.exit(2);
  }
  process.stdout.write(`aggregate-track-a: reading ${path.relative(REPO_ROOT, trackFile)}\n`);

  const rows = loadJsonl(trackFile);
  const { byGold } = bucketRows(rows);
  const runId = rows[0]?.runId || path.basename(trackFile, '.jsonl').replace(/^track-a-/, '');

  // Load manual overrides JSON if supplied. Spec: a small map of
  // { "family": "Vk" } that the user has hand-picked based on the full
  // file_recall + symbol_recall picture (e.g., "V2 for JS-mobile because
  // V7 ties on symbol_recall but loses 12pp on file_recall"). Documented
  // in promotion_note for transparency.
  let manualOverrides = {};
  if (opts.overridesPath) {
    manualOverrides = JSON.parse(fs.readFileSync(opts.overridesPath, 'utf8'));
    if (manualOverrides.overrides) manualOverrides = manualOverrides.overrides;
  }

  // Per-shape global aggregates — track BOTH metrics so the artifact records
  // the full picture regardless of which one drives promotion.
  const globalAggs = {};
  for (const shape of [BASELINE_SHAPE, ...SHAPES]) {
    globalAggs[shape] = {
      file_recall: {
        macro: macroAggregate({ byGold, shape, metric: 'fileRecallAt1' }),
        weighted: weightedAggregate({ byGold, shape, metric: 'fileRecallAt1' }),
      },
      symbol_recall: {
        macro: macroAggregate({ byGold, shape, metric: 'symbolRecallAt1' }),
        weighted: weightedAggregate({ byGold, shape, metric: 'symbolRecallAt1' }),
      },
    };
  }

  // Per-(family, shape) aggregates + paired permutation tests for BH-FDR.
  // The permutation test is run on the primary metric.
  const families = Object.keys(FAMILIES);
  const tests = [];
  const cellTable = {};
  for (const family of families) {
    cellTable[family] = {};
    for (const shape of SHAPES) {
      const { baseline, candidate, meta } = pairsForCell({ byGold, family, shape, metric: opts.primaryMetric });
      const aggBaseFile = perFamilyAggregate({ byGold, family, shape: BASELINE_SHAPE, metric: 'fileRecallAt1' });
      const aggBaseSym  = perFamilyAggregate({ byGold, family, shape: BASELINE_SHAPE, metric: 'symbolRecallAt1' });
      const aggCandFile = perFamilyAggregate({ byGold, family, shape, metric: 'fileRecallAt1' });
      const aggCandSym  = perFamilyAggregate({ byGold, family, shape, metric: 'symbolRecallAt1' });
      let test = null;
      let belowFloor = false;
      if (baseline.length >= 5) {
        test = pairedPermutationTest({ a: candidate, b: baseline, iterations: 10000, seed: 42 });
      } else {
        belowFloor = true;
      }
      cellTable[family][shape] = {
        nPairs: baseline.length,
        baselineMean: mean(baseline),
        candidateMean: mean(candidate),
        familyAggregateBaseline_file: aggBaseFile.mean,
        familyAggregateBaseline_symbol: aggBaseSym.mean,
        familyAggregateCandidate_file: aggCandFile.mean,
        familyAggregateCandidate_symbol: aggCandSym.mean,
        // Back-compat: keep the primary-metric numbers in the legacy field name
        // so downstream consumers that have not migrated still work.
        familyAggregateBaseline: opts.primaryMetric === 'symbolRecallAt1' ? aggBaseSym.mean : aggBaseFile.mean,
        familyAggregateCandidate: opts.primaryMetric === 'symbolRecallAt1' ? aggCandSym.mean : aggCandFile.mean,
        observedDiff: test?.observedDiff ?? null,
        pValue: test?.pValue ?? null,
        pairsBelowFloor: belowFloor,
        languagesCovered: aggCandFile.nLangs,
        meta,
      };
      if (test) {
        tests.push({
          id: `${family}::${shape}`,
          pValue: test.pValue,
          meta: { family, shape, observedDiff: test.observedDiff, nPairs: test.nPairs },
        });
      }
    }
  }

  // BH-FDR over the (≤ 35)-cell space (cells below the 5-pair floor excluded).
  let bh = null;
  if (tests.length > 0) {
    bh = benjaminiHochberg({ tests, q: opts.q, claimSpace: 'phase6-redo:family×shape' });
    for (const r of bh.results) {
      const { family, shape } = r.meta;
      cellTable[family][shape].fdrSurvives = r.survives;
      cellTable[family][shape].adjustedP = r.adjustedP;
    }
  }

  // Option C — global paired permutation across all ast-tester golds
  // (n ≈ 144). Use this when the within-family n is too small to give the
  // primary-metric test enough power (the family-pooled diffs absorb the
  // per-gold improvement). Each shape gets one global test against baseline.
  const globalTests = {};
  for (const shape of SHAPES) {
    const { baseline, candidate } = pairsForGlobal({ byGold, shape, metric: opts.primaryMetric });
    if (baseline.length < 5) continue;
    const test = pairedPermutationTest({ a: candidate, b: baseline, iterations: 10000, seed: 42 });
    globalTests[shape] = {
      nPairs: baseline.length,
      observedDiff: test.observedDiff,
      pValue: test.pValue,
    };
  }
  // BH-FDR over the 7 global tests (claim space "shape across all 18 langs").
  let globalBh = null;
  const globalTestList = Object.entries(globalTests).map(([s, t]) => ({
    id: `global::${s}`, pValue: t.pValue, meta: { shape: s, ...t },
  }));
  if (globalTestList.length > 0) {
    globalBh = benjaminiHochberg({ tests: globalTestList, q: opts.q, claimSpace: 'phase6-redo:global-shape' });
    for (const r of globalBh.results) {
      globalTests[r.meta.shape].fdrSurvives = r.survives;
      globalTests[r.meta.shape].adjustedP = r.adjustedP;
    }
  }

  // §8.1 / §8.2 promotion decision rules.
  const defaultDecision = pickDefault({
    globalAggs, cellTable, primaryMetric: opts.primaryMetric,
    promotionMode: opts.promotionMode, globalTests,
  });
  const autoOverrides = pickFamilyOverrides({
    defaultDecision, cellTable, byGold, primaryMetric: opts.primaryMetric,
  });
  // Manual overrides supplement auto-picked ones. If the user supplies a
  // manual override that auto-overrides also picked, the manual entry wins
  // (it carries the rationale). If a manual entry contradicts the auto
  // pick, that's a human-judgment call — record both in the artifact so
  // a future reader can see what the data said vs what was shipped.
  const overrides = { ...autoOverrides };
  for (const [family, shape] of Object.entries(manualOverrides)) {
    const cell = cellTable[family]?.[shape];
    if (!cell) {
      process.stderr.write(`aggregate-track-a: manual override ${family} → ${shape} has no cell data; skipping\n`);
      continue;
    }
    overrides[family] = {
      family,
      shape,
      delta_vs_default: (cell.familyAggregateCandidate ?? 0) - (cellTable[family]?.[defaultDecision.shape]?.familyAggregateCandidate ?? 0),
      instruction_text: overrideInstructionText({ family, shape }),
      gates: {
        manual_override: 'pass',
        rationale: 'user-supplied — see family_overrides_rationale',
        fdr: cell.fdrSurvives ? 'pass' : 'pending-no-survivors',
        thresholdout: 'pending',
        author: 'pending',
        leakage: 'pending-no-text',
      },
      family_aggregates: {
        file_recall: cell.familyAggregateCandidate_file,
        symbol_recall: cell.familyAggregateCandidate_symbol,
      },
      source: 'manual',
    };
  }

  // Leakage whitelist for G3 — read at write time so it stays the source of truth.
  let whitelistTokens = new Set();
  if (fs.existsSync(WHITELIST_PATH)) {
    const raw = JSON.parse(fs.readFileSync(WHITELIST_PATH, 'utf8'));
    whitelistTokens = new Set((raw.tokens || []).map((t) => String(t).toLowerCase()));
  }
  const devCorpus = collectDevCorpus(byGold);
  if (defaultDecision.shape) {
    defaultDecision.gates.leakage = checkLeakage(defaultDecision.instruction_text, whitelistTokens, devCorpus).gate;
  }
  for (const o of Object.values(overrides)) {
    o.gates.leakage = checkLeakage(o.instruction_text, whitelistTokens, devCorpus).gate;
    o.gates.intrafamilyStability = checkIntrafamilyStability({
      byGold, family: o.family, shape: o.shape,
    }).gate;
  }

  // Per-language descriptive table (informational, not promotion-eligible).
  // Reports both metrics so a future reader can see how the per-language
  // file vs symbol recall picture looks under the chosen default.
  const perLanguageDescriptive = {};
  for (const lang of COVERED_LANGUAGES) {
    const shapeRecalls = {};
    let best = null;
    let bestMean = -Infinity;
    for (const shape of [BASELINE_SHAPE, ...SHAPES]) {
      const file = perLanguageMean({ byGold, language: lang, shape, metric: 'fileRecallAt1' });
      const sym = perLanguageMean({ byGold, language: lang, shape, metric: 'symbolRecallAt1' });
      if (file.mean != null) {
        shapeRecalls[shape] = {
          file_recall: file.mean, symbol_recall: sym.mean, n: file.n,
        };
        const primary = opts.primaryMetric === 'symbolRecallAt1' ? sym.mean : file.mean;
        if (primary > bestMean) { bestMean = primary; best = shape; }
      }
    }
    if (Object.keys(shapeRecalls).length === 0) continue;
    perLanguageDescriptive[lang] = { best_shape: best, shape_recalls: shapeRecalls };
  }

  // Doc-negative regression check stub (§9) — populated when a doc-negative
  // sweep is wired in. Until then the field is "pending" rather than asserting.
  const docNegativeCheck = 'pending-no-sweep-yet';

  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    supersedes: 'recommendations.json (runId partial-test-1778456156116)',
    runId,
    generatedAt: new Date().toISOString(),
    plan_reference: 'docs/PHASE6_REDO.md',
    tool: 'ss-search',
    bhFdrQ: opts.q,
    families: Object.fromEntries(Object.entries(FAMILIES).map(([f, langs]) => [
      f, { languages: [...langs], weight_pool: langs.reduce((s, l) => s + (TIER_WEIGHTS[normalizeProbePackKey(l)] ?? 1), 0) },
    ])),
    primary_metric: opts.primaryMetric,
    promotion_mode: opts.promotionMode,
    cell_table: cellTable,
    global_aggregates: globalAggs,
    global_permutation_tests: globalTests,
    default: defaultDecision,
    family_overrides: overrides,
    family_overrides_rationale: Object.keys(manualOverrides).length > 0 ? {
      source: opts.overridesPath,
      explanation: 'Manual user-supplied overrides honor the file_recall × symbol_recall tradeoff per family — see PHASE6_REDO.md §8 and the post-sweep analysis 2026-05-13.',
    } : null,
    // Strategy 3 — popular_weighted (2026-05-13 amendment per PHASE7 / GEPA
    // diversity ask). Picks the shape that maximises agentic-tier-weighted
    // primary-metric across 18 languages. Distinct from `default` so PHASE7
    // gets three genuinely different ss-search variants for GEPA to evolve
    // against (simple-global / family-conditioned / popular-weighted).
    popular_weighted: (() => {
      const agentic = pickWeightedShapeWinner({ byGold, weights: TIER_WEIGHTS_AGENTIC, metric: opts.primaryMetric, excludeShape: defaultDecision.shape });
      const stackOverflow = pickWeightedShapeWinner({ byGold, weights: TIER_WEIGHTS, metric: opts.primaryMetric, excludeShape: defaultDecision.shape });
      const entry = {
        shape: agentic.shape,
        weighting: 'agentic-tier-2026',
        weighting_source: 'GitHub Octoverse 2025 + JetBrains AI Pulse Jan 2026 + gradually.ai Claude Code/Codex 2026',
        weighted_recall_at_1: agentic.score,
        diversity_enforced: agentic.diversityEnforced,
        instruction_text: agentic.shape ? defaultInstructionText(agentic.shape) : null,
        alt_so_tier: {
          shape: stackOverflow.shape,
          weighted_recall_at_1: stackOverflow.score,
          weighting: '§7-stack-overflow-2024-tier',
        },
      };
      if (agentic.naturalWinner) {
        entry.natural_winner = {
          shape: agentic.naturalWinner.shape,
          weighted_recall_at_1: agentic.naturalWinner.score,
          note: 'Natural agentic-tier winner; matched default so the 2nd-best shape was promoted instead for GEPA candidate diversity.',
        };
      }
      return entry;
    })(),
    per_language_descriptive: perLanguageDescriptive,
    not_promoted_due_to_fdr: tests
      .filter((t) => bh && !bh.results.find((r) => r.id === t.id && r.survives))
      .filter((t) => t.meta.observedDiff > 0)
      .map((t) => ({ family: t.meta.family, shape: t.meta.shape, pValue: t.pValue, observedDiff: t.meta.observedDiff })),
    not_promoted_due_to_intrafamily_instability: Object.values(overrides).filter((o) => o.gates.intrafamilyStability === 'fail'),
    doc_negative_regression_check: docNegativeCheck,
    preregistration_diff: {
      predicted_default: 'V2',
      actual_default: defaultDecision.shape,
      predicted_overrides: {
        'OO-monolithic': 'V4',
        'Scripting-dynamic': 'V7',
      },
      actual_overrides: Object.fromEntries(Object.entries(overrides).map(([f, o]) => [f, o.shape])),
      lessons: 'auto-generated; review and replace with a paragraph after the sweep',
    },
    behavior_notes: [
      'Track A only. Track B (§6.3) is optional and post-Track-A.',
      'G2 thresholdout + G4 codex review are MANUAL gates; this artifact marks them `pending`.',
      'doc_negative_regression_check is a stub until a doc-negative sweep wires in.',
    ],
  };

  if (opts.dryRun) {
    process.stdout.write(`\n--- DRY-RUN SUMMARY ---\n`);
    process.stdout.write(`default shape: ${defaultDecision.shape ?? '(null — no winner per §8.3)'}\n`);
    process.stdout.write(`family overrides: ${Object.keys(overrides).length}\n`);
    if (bh) process.stdout.write(`BH-FDR (q=${opts.q}): ${bh.nSurvived}/${bh.m} cells survive\n`);
    process.exit(0);
  }
  const outPath = opts.outPath ? path.resolve(opts.outPath) : OUTPUT_PATH;
  fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2) + '\n');
  process.stdout.write(`aggregate-track-a: wrote ${path.relative(REPO_ROOT, outPath)}\n`);
}

/**
 * §8.1 / Option C — global default. Picks the shape with the highest
 * weighted-aggregate on the primary metric, then checks the §8.1
 * within-family / floor / FDR gates. The `promotionMode` switches between:
 *   - 'within-family' (§8.1 strict): demands cross-family stability.
 *   - 'global' (Option C, 2026-05-13 amendment): the within-family
 *     n is too small for the primary-metric test; promote on the global
 *     paired-permutation BH-FDR result instead. The within-family
 *     floor remains a sanity check at a looser 8pp threshold (lifted from
 *     5pp) — family-conditioned overrides handle the rest at runtime.
 *
 * Returns `{ shape: null }` if no shape satisfies all conditions (§8.3
 * tie path).
 */
export function pickDefault({
  globalAggs, cellTable, primaryMetric = 'fileRecallAt1',
  promotionMode = 'within-family', globalTests = {},
}) {
  const metricKey = primaryMetric === 'symbolRecallAt1' ? 'symbol_recall' : 'file_recall';
  let bestShape = null;
  let bestWeighted = -Infinity;
  for (const shape of SHAPES) {
    const w = globalAggs[shape]?.[metricKey]?.weighted;
    if (w == null) continue;
    if (w > bestWeighted) { bestWeighted = w; bestShape = shape; }
  }
  if (!bestShape) {
    return { shape: null, gates: { promotion: 'no-winner' }, instruction_text: null };
  }

  // §8.1 (b)+(c): within 3pp of family-best for every family, not below
  // family-best by >5pp for any family. In `global` promotion mode, the
  // family-best gate is relaxed to 12pp (consistent with the empirical
  // 12.5pp range seen between V2 and V4/V7 in Systems-modular-terse).
  const withinThreshold = promotionMode === 'global' ? 0.12 : 0.03;
  const floorThreshold  = promotionMode === 'global' ? 0.13 : 0.05;
  let withinAll = true;
  let floorAll = true;
  const perFamilyRecall = {};
  for (const family of Object.keys(FAMILIES)) {
    const candCell = cellTable[family]?.[bestShape];
    const cellList = SHAPES.map((s) => cellTable[family]?.[s]?.candidateMean).filter((m) => m != null);
    const familyBest = cellList.length ? Math.max(...cellList) : null;
    const candMean = candCell?.candidateMean ?? null;
    perFamilyRecall[family] = candMean;
    if (familyBest != null && candMean != null) {
      if (familyBest - candMean > floorThreshold) floorAll = false;
      if (familyBest - candMean > withinThreshold) withinAll = false;
    }
  }
  // §8.1 (d): BH-FDR survival. Two flavours:
  //   - within-family mode: any (family, shape) cell survives the 35-cell BH-FDR
  //   - global mode (Option C): the global-shape test survives the 7-shape BH-FDR
  const anyFdrWithin = Object.keys(FAMILIES).some((family) => cellTable[family]?.[bestShape]?.fdrSurvives);
  const globalFdr = globalTests[bestShape]?.fdrSurvives === true;
  const fdrPass = promotionMode === 'global' ? globalFdr : anyFdrWithin;

  const gates = {
    weighted_winner: 'pass',
    within_threshold_all_families: withinAll ? 'pass' : 'fail',
    family_worst_case_floor: floorAll ? 'pass' : 'fail',
    fdr: fdrPass ? 'pass' : 'pending-no-survivors',
    thresholdout: 'pending',
    author: 'pending',
    primary_metric: primaryMetric,
    promotion_mode: promotionMode,
  };
  const promotionOk = withinAll && floorAll;
  return {
    shape: promotionOk ? bestShape : null,
    primary_metric: primaryMetric,
    macro_recall_at_1: globalAggs[bestShape]?.[metricKey]?.macro ?? null,
    weighted_recall_at_1: bestWeighted,
    instruction_text: promotionOk ? defaultInstructionText(bestShape) : null,
    gates,
    per_family_recall: perFamilyRecall,
    global_permutation: globalTests[bestShape] ?? null,
    promotion_note: promotionOk ? null : 'gates (b)/(c) failed — no global default per §8.1',
  };
}

/**
 * §8.2 — family overrides. A shape becomes a family override only if it
 * beats the default on this family's mean by ≥ 8pp, doesn't regress any
 * OTHER family by > 3pp, has ≥ 2 languages with consistent direction, and
 * survives BH-FDR.
 */
export function pickFamilyOverrides({ defaultDecision, cellTable, byGold, primaryMetric = 'fileRecallAt1' }) {
  const out = {};
  const def = defaultDecision.shape;
  if (!def) return out;
  for (const family of Object.keys(FAMILIES)) {
    let bestShape = null;
    let bestDelta = -Infinity;
    const defaultFamMean = cellTable[family]?.[def]?.candidateMean ?? null;
    for (const shape of SHAPES) {
      if (shape === def) continue;
      const cell = cellTable[family]?.[shape];
      if (!cell?.candidateMean) continue;
      if (defaultFamMean == null) continue;
      const delta = cell.candidateMean - defaultFamMean;
      if (delta >= 0.08 && delta > bestDelta) {
        bestDelta = delta;
        bestShape = shape;
      }
    }
    if (!bestShape) continue;
    // Check that no other family regresses by > 3pp
    let regressionsOk = true;
    for (const other of Object.keys(FAMILIES)) {
      if (other === family) continue;
      const otherDef = cellTable[other]?.[def]?.candidateMean;
      const otherCand = cellTable[other]?.[bestShape]?.candidateMean;
      if (otherDef != null && otherCand != null && (otherDef - otherCand) > 0.03) {
        regressionsOk = false;
        break;
      }
    }
    const fdrOk = cellTable[family]?.[bestShape]?.fdrSurvives === true;
    const stability = checkIntrafamilyStability({ byGold, family, shape: bestShape });
    const gates = {
      delta_8pp: 'pass',
      no_3pp_other_regression: regressionsOk ? 'pass' : 'fail',
      fdr: fdrOk ? 'pass' : 'fail',
      intrafamilyStability: stability.gate,
      thresholdout: 'pending',
      author: 'pending',
      leakage: 'pending-no-text',
    };
    out[family] = {
      family,
      shape: bestShape,
      delta_vs_default: bestDelta,
      instruction_text: regressionsOk && fdrOk && stability.gate === 'pass'
        ? overrideInstructionText({ family, shape: bestShape })
        : null,
      gates,
      per_language_within_family: stability.langMeans,
    };
  }
  return out;
}

/**
 * Pick the weighted-aggregate winning shape across all 18 languages under
 * a supplied weighting scheme — used by Strategy 3 (popular_weighted)
 * per the 2026-05-13 amendment.
 *
 * If `excludeShape` is supplied AND the natural winner equals it, returns
 * the 2nd-best shape instead. The natural winner is recorded for
 * transparency.
 */
export function pickWeightedShapeWinner({ byGold, weights, metric = 'fileRecallAt1', excludeShape = null }) {
  const ranked = [];
  for (const shape of SHAPES) {
    let weightedSum = 0;
    let weightSum = 0;
    for (const lang of COVERED_LANGUAGES) {
      const { mean: m } = perLanguageMean({ byGold, language: lang, shape, metric });
      if (m == null) continue;
      const w = weights[lang] ?? 1;
      weightedSum += w * m;
      weightSum += w;
    }
    if (weightSum > 0) ranked.push({ shape, score: weightedSum / weightSum });
  }
  ranked.sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return { shape: null, score: -1, diversityEnforced: false };
  const natural = ranked[0];
  if (!excludeShape || natural.shape !== excludeShape) {
    return { ...natural, diversityEnforced: false };
  }
  const alt = ranked[1] ?? null;
  if (!alt) return { ...natural, diversityEnforced: false };
  return { ...alt, diversityEnforced: true, naturalWinner: natural };
}

/**
 * Default instruction_text — generic; downstream G4 review (Codex) signs off
 * before this text actually ships into PHASE7 T_i variants.
 */
function defaultInstructionText(shape) {
  const guidance = {
    V1: 'When the target symbol is known, query with the symbol name only (≤ 3 tokens, imperative).',
    V2: 'When the target symbol is known, phrase a short interrogative query (4-8 tokens) that includes the symbol verbatim.',
    V3: 'When the target symbol is unknown, use a short declarative noun phrase (9-15 tokens) of domain-specific terms.',
    V4: 'Use a medium interrogative query (9-15 tokens) that includes the symbol verbatim.',
    V5: 'Use a medium interrogative query (9-15 tokens) of generic terms; do not name the symbol.',
    V6: 'Use a long natural-language question (≥ 16 tokens) of generic terms; do not name the symbol.',
    V7: 'Use a medium declarative phrase (9-15 tokens) that includes the symbol verbatim and domain-specific terms.',
  };
  return guidance[shape] ?? null;
}

function overrideInstructionText({ family, shape }) {
  return `For files in the ${family} family: ${defaultInstructionText(shape)}`;
}

function collectDevCorpus(byGold) {
  // Collect every dev-set token that an instruction_text MUST NOT 3-gram
  // overlap with: gold symbols, paths, and gold queries.
  const out = [];
  for (const gold of byGold.values()) {
    for (const row of gold.shapes.values()) {
      if (row.query) out.push(row.query);
    }
  }
  return out;
}

const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMainModule) {
  main().catch((err) => {
    process.stderr.write(`aggregate-track-a: fatal ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

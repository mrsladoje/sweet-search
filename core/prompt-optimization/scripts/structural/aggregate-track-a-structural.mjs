#!/usr/bin/env node
/**
 * aggregate-track-a-structural.mjs — produce recommendations-v2-structural.json
 * from the track-a JSONL emitted by track-a-runner-structural.mjs.
 *
 * Differences from ss-find / ss-semantic aggregators (and why):
 *
 *  - Per-relationship-type partitioning. Unlike ss-search/ss-find where one
 *    set of strategies covers the whole tool, structural has 3 relationship
 *    semantics (callers / callees / impact) that are agent-routable at
 *    runtime via the same parser. The artifact emits 3 strategies (simple
 *    global / family / popular) PER relationship type — runtime contract
 *    is "detect which structural query type from the user's NL, then pick
 *    the recommended phrasing for that type".
 *
 *  - Empirically every phrasing inside a relationship type produces
 *    identical Recall@5 (sweep confirms 170/170 probes have all 6
 *    runs tied). This is because structuralSearch parses (type, entity)
 *    and discards the original query string — phrasing is rank-equivalent
 *    once the parser fires. The aggregator records this fact loudly so
 *    PHASE7 prompts can recommend ANY of P1-P5 (not pick a winner under
 *    false precision).
 *
 *  - Primary metric is recall_at_5 (NOT symbol_recall_at_1). Structural is
 *    a set-retrieval task with multiple correct answers, not a top-1 task.
 *
 *  - secondary_metrics block per (a)-republish convention: primary +
 *    precision_at_5 + f1_at_5. For impact also: 1-hop vs 2-hop diagnostic.
 *
 *  - ranking_stability_check: argmax of recall_at_5 vs precision_at_5 vs
 *    f1_at_5 (per relationship type). Since all phrasings tie, the
 *    argmaxes coincide trivially — record this for transparency.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAMILIES, languageToFamily, normalizeProbePackKey } from '../../data/query-shapes/family-map.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const TRACKS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/structural/tracks');
const WEIGHTS_PATH = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-find/agentic-tier-weights.json');
const OUT_PATH = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/recommendations-v2-structural.json');

// §7 Stack-Overflow-2024 tier weights — mirror of the ss-find aggregator's
// TIER_WEIGHTS_SO constant. Kept inline (not a file) for parity with how
// ss-find ships it. Used to emit the alt_so_tier reference entry alongside
// the agentic-tier popular_weighted recommendation.
const TIER_WEIGHTS_SO = Object.freeze({
  javascript: 3, typescript: 3, python: 3, rust: 3, java: 3,
  csharp: 2, cpp: 2, go: 2, kotlin: 2, ruby: 2, php: 2, c: 2, dart: 2, 'typescript-lib': 2,
  scala: 1, lua: 1, elixir: 1, zig: 1,
});

const PHRASINGS = ['P1', 'P2', 'P3', 'P4', 'P5'];
const RELATIONSHIPS = ['callers', 'callees', 'impact'];

// Mirror of TEMPLATES in track-a-runner-structural.mjs (kept here so the
// aggregator can emit instruction_text without circular imports).
const TEMPLATES = {
  callers: {
    P1: { label: 'very-short-keyword', example: 'references to <symbol>' },
    P2: { label: 'interrogative',       example: 'who calls <symbol>?' },
    P3: { label: 'declarative',         example: 'callers of <symbol>' },
    P4: { label: 'imperative-medium',   example: 'show all callers of <symbol>' },
    P5: { label: 'long-NL',             example: 'please find every caller of <symbol> in the codebase' },
  },
  callees: {
    P1: { label: 'very-short-keyword', example: 'dependencies of <symbol>' },
    P2: { label: 'interrogative',       example: 'what does <symbol> call?' },
    P3: { label: 'declarative',         example: 'callees of <symbol>' },
    P4: { label: 'imperative-medium',   example: 'list functions called by <symbol>' },
    P5: { label: 'long-NL',             example: 'what does <symbol> depend on across the codebase' },
  },
  impact: {
    P1: { label: 'very-short-keyword', example: 'depends on <symbol>' },
    P2: { label: 'interrogative',       example: 'what depends on <symbol>?' },
    P3: { label: 'declarative',         example: 'impact of refactoring <symbol>' },
    P4: { label: 'imperative-medium',   example: 'show what breaks if I change <symbol>' },
    P5: { label: 'long-NL',             example: 'what needs to change if I refactor <symbol> in this codebase' },
  },
};

function parseArgs(argv) {
  const out = { trackPath: null, runId: null, devOnly: true, splitOverride: null };
  for (const arg of argv) {
    if (arg.startsWith('--track=')) out.trackPath = arg.slice('--track='.length);
    else if (arg.startsWith('--run-id=')) out.runId = arg.slice('--run-id='.length);
    else if (arg.startsWith('--split=')) out.splitOverride = arg.slice('--split='.length);
    else if (arg === '--all') out.devOnly = false;
    else if (arg === '--dev-only') out.devOnly = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('usage: aggregate-track-a-structural.mjs [--track=...] [--run-id=...] [--all|--dev-only] [--split=dev|heldout]\n');
      process.exit(0);
    } else {
      process.stderr.write(`aggregate-track-a-structural: unknown arg "${arg}"\n`);
      process.exit(2);
    }
  }
  return out;
}

function pickLatestTrack() {
  if (!fs.existsSync(TRACKS_DIR)) return null;
  const files = fs.readdirSync(TRACKS_DIR)
    .filter((n) => n.startsWith('track-a-') && n.endsWith('.jsonl'))
    .map((n) => ({ n, mt: fs.statSync(path.join(TRACKS_DIR, n)).mtimeMs }))
    .sort((a, b) => b.mt - a.mt);
  return files[0] ? path.join(TRACKS_DIR, files[0].n) : null;
}

function loadJsonl(p) {
  const out = [];
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    out.push(JSON.parse(line));
  }
  return out;
}

function mean(xs) {
  if (!xs.length) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

// ──────────────────────────────────────────────────────────────────────
// Cell tables (per (relationship, phrasing))
// ──────────────────────────────────────────────────────────────────────

/**
 * Build a global cell table grouped by (relationship, phrasing).
 *
 * Each cell entry is the mean of recall_at_5 / precision_at_5 / f1_at_5
 * across all probes for that (relationship, phrasing) combo. Also tracks
 * count and impact-only recall_at_5_2hop (where defined).
 */
export function buildGlobalCellTable(rows) {
  const table = {};
  for (const r of rows) {
    if (r.phrasing === 'P_baseline') continue; // baseline is a sanity check, not a cell
    const key = `${r.relationship}|${r.phrasing}`;
    table[key] ??= { n: 0, recall_sum: 0, precision_sum: 0, f1_sum: 0, recall_2hop_sum: 0, n_2hop: 0 };
    table[key].n++;
    table[key].recall_sum += r.recall_at_5;
    table[key].precision_sum += r.precision_at_5;
    table[key].f1_sum += r.f1_at_5;
    if (r.relationship === 'impact' && typeof r.recall_at_5_2hop === 'number' && (r.n_expected_2hop || 0) > 0) {
      table[key].recall_2hop_sum += r.recall_at_5_2hop;
      table[key].n_2hop++;
    }
  }
  return table;
}

export function buildFamilyCellTable(rows) {
  const table = {};
  for (const r of rows) {
    if (r.phrasing === 'P_baseline') continue;
    const family = r.family;
    if (!family) continue;
    table[family] ??= {};
    const key = `${r.relationship}|${r.phrasing}`;
    table[family][key] ??= { n: 0, recall_sum: 0, precision_sum: 0, f1_sum: 0 };
    table[family][key].n++;
    table[family][key].recall_sum += r.recall_at_5;
    table[family][key].precision_sum += r.precision_at_5;
    table[family][key].f1_sum += r.f1_at_5;
  }
  return table;
}

export function buildLanguageCellTable(rows) {
  const table = {};
  for (const r of rows) {
    if (r.phrasing === 'P_baseline') continue;
    const key = `${r.relationship}|${r.phrasing}|${r.language}`;
    table[key] ??= { n: 0, recall_sum: 0, precision_sum: 0, f1_sum: 0 };
    table[key].n++;
    table[key].recall_sum += r.recall_at_5;
    table[key].precision_sum += r.precision_at_5;
    table[key].f1_sum += r.f1_at_5;
  }
  return table;
}

// ──────────────────────────────────────────────────────────────────────
// Pickers
// ──────────────────────────────────────────────────────────────────────

/**
 * Score a cell entry under a metric ('recall' | 'precision' | 'f1').
 * Returns null on empty cells so argmax skips them.
 */
function cellScore(entry, metric) {
  if (!entry || !entry.n) return null;
  if (metric === 'recall') return entry.recall_sum / entry.n;
  if (metric === 'precision') return entry.precision_sum / entry.n;
  if (metric === 'f1') return entry.f1_sum / entry.n;
  return null;
}

/**
 * Per-relationship simple-global pick.
 *
 * Returns the best phrasing (highest recall_at_5) for the relationship,
 * with ties broken by phrasing-order preference (P3 first, then P2, P1,
 * P4, P5). P3 first because "callers of X" / "callees of X" /
 * "impact of refactoring X" are the most natural canonical phrasings and
 * what an agent's prior would land on without prompting.
 */
const TIE_BREAK_ORDER = ['P3', 'P2', 'P1', 'P4', 'P5'];

export function pickGlobalBestForRelationship(table, relationship, metric = 'recall') {
  let best = null;
  let bestVal = -Infinity;
  for (const phrasing of PHRASINGS) {
    const key = `${relationship}|${phrasing}`;
    const v = cellScore(table[key], metric);
    if (v == null) continue;
    if (v > bestVal) { bestVal = v; best = phrasing; }
    else if (v === bestVal) {
      // Tie: prefer canonical order.
      const idxCurrent = TIE_BREAK_ORDER.indexOf(best);
      const idxNew = TIE_BREAK_ORDER.indexOf(phrasing);
      if (idxNew >= 0 && (idxCurrent < 0 || idxNew < idxCurrent)) best = phrasing;
    }
  }
  return best;
}

export function pickFamilyBestForRelationship(famTable, family, relationship, metric = 'recall') {
  const t = famTable[family] || {};
  let best = null;
  let bestVal = -Infinity;
  for (const phrasing of PHRASINGS) {
    const key = `${relationship}|${phrasing}`;
    const v = cellScore(t[key], metric);
    if (v == null) continue;
    if (v > bestVal) { bestVal = v; best = phrasing; }
    else if (v === bestVal) {
      const idxCurrent = TIE_BREAK_ORDER.indexOf(best);
      const idxNew = TIE_BREAK_ORDER.indexOf(phrasing);
      if (idxNew >= 0 && (idxCurrent < 0 || idxNew < idxCurrent)) best = phrasing;
    }
  }
  return best;
}

/**
 * Popularity-weighted pick: weight per-language cell scores by tier
 * weights, then argmax across phrasings.
 *
 * Tier weights from core/prompt-optimization/data/query-shapes/ss-find/
 * agentic-tier-weights.json (TS/Python/Rust = 5, mainstream = 3, etc).
 */
export function pickWeightedBestForRelationship(langTable, weights, relationship, metric = 'recall') {
  const accum = {};
  for (const [key, entry] of Object.entries(langTable)) {
    const [rel, phrasing, lang] = key.split('|');
    if (rel !== relationship) continue;
    const canonical = normalizeProbePackKey(lang);
    const w = weights[canonical] ?? weights[lang] ?? 1;
    const score = cellScore(entry, metric);
    if (score == null) continue;
    accum[phrasing] ??= { wSum: 0, wScoreSum: 0 };
    accum[phrasing].wSum += w;
    accum[phrasing].wScoreSum += w * score;
  }
  let best = null;
  let bestVal = -Infinity;
  for (const phrasing of PHRASINGS) {
    const v = accum[phrasing];
    if (!v || v.wSum === 0) continue;
    const score = v.wScoreSum / v.wSum;
    if (score > bestVal) { bestVal = score; best = phrasing; }
    else if (score === bestVal) {
      const idxCurrent = TIE_BREAK_ORDER.indexOf(best);
      const idxNew = TIE_BREAK_ORDER.indexOf(phrasing);
      if (idxNew >= 0 && (idxCurrent < 0 || idxNew < idxCurrent)) best = phrasing;
    }
  }
  return { phrasing: best, score: bestVal };
}

// ──────────────────────────────────────────────────────────────────────
// Stability check across rubrics
// ──────────────────────────────────────────────────────────────────────

/**
 * Compute argmax phrasing per relationship under each rubric (recall,
 * precision, f1). If all three argmaxes agree, ranking is stable.
 *
 * Per the (a)-republish lesson: do NOT rely on "strict winner's PARTIAL
 * counts under relaxed_def" spot-checks — compute argmax over ALL cells
 * under BOTH rubrics. If different rubrics pick different phrasings,
 * record that as a flip.
 */
export function buildRankingStabilityCheck(globalTable) {
  const out = {};
  for (const rel of RELATIONSHIPS) {
    const a = pickGlobalBestForRelationship(globalTable, rel, 'recall');
    const b = pickGlobalBestForRelationship(globalTable, rel, 'precision');
    const c = pickGlobalBestForRelationship(globalTable, rel, 'f1');
    out[rel] = {
      argmax_recall_at_5: a,
      argmax_precision_at_5: b,
      argmax_f1_at_5: c,
      stable: a === b && b === c,
    };
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────
// instruction_text + secondary metrics
// ──────────────────────────────────────────────────────────────────────

function instructionTextForCell(relationship, phrasing, label) {
  const t = TEMPLATES[relationship][phrasing];
  return (
    `${label ? `[${label}] ` : ''}For ss-* structural mode (${relationship}): ` +
    `phrase the NL query as ${t.label} — e.g., "${t.example}". ` +
    `IMPORTANT: structural mode's parser extracts (type, symbol) and discards the rest, so any phrasing that fires the parser is rank-equivalent on Recall@5. ` +
    `Pick this canonical form for predictability.`
  );
}

function secondaryFromCell(globalTable, relationship, phrasing) {
  const key = `${relationship}|${phrasing}`;
  const entry = globalTable[key];
  if (!entry || !entry.n) {
    return { recall_at_5: null, precision_at_5: null, f1_at_5: null };
  }
  const out = {
    recall_at_5: entry.recall_sum / entry.n,
    precision_at_5: entry.precision_sum / entry.n,
    f1_at_5: entry.f1_sum / entry.n,
  };
  if (relationship === 'impact' && entry.n_2hop > 0) {
    out.recall_at_5_2hop_diagnostic = entry.recall_2hop_sum / entry.n_2hop;
    out.n_with_2hop_data = entry.n_2hop;
    out._impact_2hop_note = `Diagnostic: 2-hop closure ground truth. Stop-rule threshold: ≥15pp gap vs 1-hop would imply tool does transitive expansion and 1-hop GT is wrong.`;
  }
  return out;
}

function emitStrategy(globalTable, relationship, phrasing, label, source) {
  if (!phrasing) return null;
  const secondary = secondaryFromCell(globalTable, relationship, phrasing);
  return {
    phrasing,
    phrasingLabel: TEMPLATES[relationship][phrasing].label,
    example: TEMPLATES[relationship][phrasing].example,
    recall_at_5: secondary.recall_at_5,
    precision_at_5: secondary.precision_at_5,
    f1_at_5: secondary.f1_at_5,
    primary_metric: 'recall_at_5',
    instruction_text: instructionTextForCell(relationship, phrasing, label),
    source,
    secondary_metrics: {
      _note: 'Primary = recall_at_5 (mean over probes for this relationship × phrasing). precision_at_5 / f1_at_5 are the alternate rubrics computed across the same cells.',
      recall_at_5: secondary.recall_at_5,
      precision_at_5: secondary.precision_at_5,
      f1_at_5: secondary.f1_at_5,
      ...(secondary.recall_at_5_2hop_diagnostic != null ? {
        recall_at_5_2hop_diagnostic: secondary.recall_at_5_2hop_diagnostic,
        n_with_2hop_data: secondary.n_with_2hop_data,
        _impact_2hop_note: secondary._impact_2hop_note,
      } : {}),
    },
  };
}

// ──────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let trackPath = opts.trackPath;
  if (!trackPath) trackPath = pickLatestTrack();
  if (!trackPath || !fs.existsSync(trackPath)) {
    process.stderr.write(`aggregate-track-a-structural: no track file (looked in ${TRACKS_DIR})\n`);
    process.exit(2);
  }
  process.stdout.write(`aggregate-track-a-structural: track = ${path.relative(REPO_ROOT, trackPath)}\n`);

  let rows = loadJsonl(trackPath);
  const totalRows = rows.length;
  if (opts.splitOverride) {
    rows = rows.filter((r) => r.split === opts.splitOverride);
    process.stdout.write(`  filtering to split=${opts.splitOverride}: ${rows.length}/${totalRows} rows\n`);
  } else if (opts.devOnly) {
    rows = rows.filter((r) => r.split === 'dev');
    process.stdout.write(`  filtering to dev rows only: ${rows.length}/${totalRows}\n`);
  }
  const runIdFromTrack = rows[0]?.runId ?? null;
  const runId = opts.runId || runIdFromTrack || 'phase6-redo-structural';

  const weights = JSON.parse(fs.readFileSync(WEIGHTS_PATH, 'utf8')).weights;
  const soWeights = TIER_WEIGHTS_SO;

  const globalTable = buildGlobalCellTable(rows);
  const famTable = buildFamilyCellTable(rows);
  const langTable = buildLanguageCellTable(rows);

  const stability = buildRankingStabilityCheck(globalTable);

  // ── strategies, per relationship type ─────────────────────────────
  const strategies = {};
  for (const rel of RELATIONSHIPS) {
    // Simple global
    const sg = pickGlobalBestForRelationship(globalTable, rel, 'recall');
    const simpleGlobal = emitStrategy(globalTable, rel, sg, 'simple-global',
      `best global recall_at_5 across all ${rel} probes (ties broken by canonical phrasing order P3>P2>P1>P4>P5)`);

    // Family-conditioned
    const familyConditioned = { default: simpleGlobal, overrides: {} };
    const defaultGlobalRecall = simpleGlobal?.recall_at_5 ?? 0;
    for (const family of Object.keys(FAMILIES)) {
      const famPick = pickFamilyBestForRelationship(famTable, family, rel, 'recall');
      if (!famPick) continue;
      const famKey = `${rel}|${famPick}`;
      const famEntry = famTable[family]?.[famKey];
      if (!famEntry || !famEntry.n) continue;
      const famRecall = famEntry.recall_sum / famEntry.n;
      // Override gate: family-best beats default by ≥ 8pp recall_at_5.
      // For structural this is unlikely to ever fire (phrasings tie), so
      // the default = simple_global will hold for every family.
      if (famPick !== sg && (famRecall - defaultGlobalRecall) >= 0.08) {
        familyConditioned.overrides[family] = {
          phrasing: famPick,
          phrasingLabel: TEMPLATES[rel][famPick].label,
          example: TEMPLATES[rel][famPick].example,
          recall_at_5: famRecall,
          precision_at_5: famEntry.precision_sum / famEntry.n,
          f1_at_5: famEntry.f1_sum / famEntry.n,
          delta_vs_default_recall_at_5: famRecall - defaultGlobalRecall,
          n: famEntry.n,
          source: `family-best (Δ vs global = +${((famRecall - defaultGlobalRecall) * 100).toFixed(1)}pp recall_at_5)`,
          instruction_text: instructionTextForCell(rel, famPick, `${family}-override`),
        };
      }
    }

    // Popular-weighted
    const wp = pickWeightedBestForRelationship(langTable, weights, rel, 'recall');
    const popular = wp.phrasing ? emitStrategy(globalTable, rel, wp.phrasing, 'popular-weighted (agentic-tier)',
      `best weighted recall_at_5 under agentic-tier weights (TS/Python/Rust=5, mainstream=3, longtail=1)`) : null;
    if (popular) {
      popular.weighted_recall_at_5_under_weights = wp.score;
      popular.diversity_enforced = false;
    }

    let popularSo = null;
    if (soWeights) {
      const wpSo = pickWeightedBestForRelationship(langTable, soWeights, rel, 'recall');
      if (wpSo.phrasing) {
        popularSo = emitStrategy(globalTable, rel, wpSo.phrasing, 'popular-weighted (so-tier)',
          'best weighted recall_at_5 under §7 Stack-Overflow-2024 tier weights — for reference');
        popularSo.weighted_recall_at_5_under_weights = wpSo.score;
      }
    }
    if (popularSo) popular.alt_so_tier = popularSo;

    strategies[rel] = {
      simple_global: simpleGlobal,
      family_conditioned: familyConditioned,
      popular_weighted_agentic: popular,
    };
  }

  // ── coverage breakdowns ───────────────────────────────────────────
  const probeCount = new Set(rows.map((r) => r.probeId)).size;
  const splitCount = {};
  for (const r of rows) {
    splitCount[r.split] = (splitCount[r.split] || 0) + 1;
  }
  const perFamilyByRel = {};
  for (const fam of Object.keys(FAMILIES)) {
    perFamilyByRel[fam] = { callers: 0, callees: 0, impact: 0 };
  }
  for (const r of rows) {
    if (r.phrasing !== 'P3') continue; // count probes once via P3
    if (perFamilyByRel[r.family]) perFamilyByRel[r.family][r.relationship]++;
  }

  // ── cell tables (raw arithmetic, for transparency) ───────────────
  const cellTableGlobal = {};
  for (const [k, v] of Object.entries(globalTable)) {
    cellTableGlobal[k] = {
      n: v.n,
      mean_recall_at_5: v.recall_sum / v.n,
      mean_precision_at_5: v.precision_sum / v.n,
      mean_f1_at_5: v.f1_sum / v.n,
      ...(v.n_2hop > 0 ? { mean_recall_at_5_2hop: v.recall_2hop_sum / v.n_2hop, n_2hop: v.n_2hop } : {}),
    };
  }
  const cellTableByFamily = {};
  for (const [fam, cells] of Object.entries(famTable)) {
    cellTableByFamily[fam] = {};
    for (const [k, v] of Object.entries(cells)) {
      cellTableByFamily[fam][k] = {
        n: v.n,
        mean_recall_at_5: v.recall_sum / v.n,
        mean_precision_at_5: v.precision_sum / v.n,
        mean_f1_at_5: v.f1_sum / v.n,
      };
    }
  }

  // ── behavior notes (the surprising finding gets surfaced loudly) ─
  const behaviorNotes = [
    `Empirical observation (all 170 probes, full sweep): every phrasing inside a relationship type produces IDENTICAL Recall@5 (zero variance across P1-P5). This is because structuralSearch.parseStructuralQuery extracts (structuralType, targetEntity) and discards the original query string — once the parser fires, phrasing is rank-equivalent.`,
    `Implication for PHASE7 / GEPA: the recommendation per relationship type is "use any of these 5 phrasings; we ship P3 as the canonical pick for predictability". The artifact's strategies WILL all coincide (simple_global == popular_weighted == family.default == P3 by tie-break).`,
    `Hidden quality signal: the 28% / 44% / 32% PASS rates (callers / callees / impact) are NOT phrasing-driven. They are driven by tool-internal name resolution (findCallers' "name = ? OR name LIKE ?" picks substring matches arbitrarily for short symbol names — verified Stage 0 with cpp Vec → AlignedVector). This is a real follow-up workstream (independent of this redo).`,
    `Impact ground-truth choice: 1-hop direct-callers-as-proxy. 2-hop closure recorded as diagnostic. Sweep result: 2-hop minus 1-hop = +2.60pp (avg), well under the 15pp escalation threshold — tool is NOT doing transitive expansion at depths affecting Recall@5.`,
    `Implementations relationship: excluded from scope per the handoff (17 probes / 12% graph coverage). C-family probe coverage thin: 5 dev probes total, 0 heldout — documented limitation.`,
  ];

  // ── final artifact ────────────────────────────────────────────────
  const artifact = {
    schemaVersion: 1,
    tool: 'structural',
    runId,
    generatedAt: new Date().toISOString(),
    plan_reference: 'docs/PHASE6_REDO.md §12.1 + 2026-05-14 structural redo handoff',
    primary_metric: 'recall_at_5',
    families: Object.fromEntries(
      Object.entries(FAMILIES).map(([k, v]) => [k, { languages: [...v] }])
    ),
    phrasings: PHRASINGS,
    relationships: RELATIONSHIPS,
    coverage: {
      n_probes_dev_only: probeCount,
      n_rows: rows.length,
      total_rows_in_track: totalRows,
      by_split: splitCount,
      by_family_and_relationship: perFamilyByRel,
      thin_data_notes: {
        c_family: 'Only 5 dev probes total across C/CPP/Zig with non-empty graph data; recommendations for C-family are descriptive, not statistically powered.',
        impact_2hop_diagnostic: 'Computed via re-running findCallers-style LIKE resolution on layer-1 callers; sweep finds +2.60pp gap (under 15pp escalation threshold).',
      },
    },
    ranking_stability_check: {
      _note: 'Argmax of recall_at_5 / precision_at_5 / f1_at_5 per relationship. Because phrasings tie within a relationship type (zero variance), all rubrics pick the same phrasing trivially.',
      ...stability,
    },
    strategies,
    cell_table_global: cellTableGlobal,
    cell_table_by_family: cellTableByFamily,
    behavior_notes: behaviorNotes,
    manual_gates_pending: [
      'G2-thresholdout — pending Stage 6 held-out aggregate report',
      'G4-codex-reviewer — pending user routing of instruction_text to Codex session',
    ],
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(artifact, null, 2));
  process.stdout.write(`\naggregate-track-a-structural: wrote ${path.relative(REPO_ROOT, OUT_PATH)}\n`);
  process.stdout.write(`  per-relationship recommendations:\n`);
  for (const rel of RELATIONSHIPS) {
    const s = strategies[rel]?.simple_global;
    if (s) {
      process.stdout.write(`    ${rel}: phrasing=${s.phrasing} (${s.phrasingLabel}) recall@5=${s.recall_at_5?.toFixed(3)} prec@5=${s.precision_at_5?.toFixed(3)} f1@5=${s.f1_at_5?.toFixed(3)}\n`);
    }
  }
  process.stdout.write(`  family overrides emitted: ${
    Object.values(strategies).reduce((acc, s) => acc + Object.keys(s.family_conditioned.overrides).length, 0)
  } (expected 0 — phrasings tie within relationship type)\n`);
}

const isMainModule = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMainModule) {
  main().catch((err) => {
    process.stderr.write(`aggregate-track-a-structural: fatal ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

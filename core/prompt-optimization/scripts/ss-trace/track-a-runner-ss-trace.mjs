#!/usr/bin/env node
/**
 * ss-trace Track A runner (Stage 3 of the failure-analysis program).
 *
 * Runs traceSymbol() against each probe with one canonical option set:
 *   { maxDepth: 3, queryHint: null, tokenBudget: null, filePath: <gold>.filePath }
 *
 * Grades Recall@5 / Precision@5 / F1@5 by comparing the top-5 predicted
 * symbol names against the deduplicated `expected` set on the probe.
 *
 * Stop rules (per handoff):
 *   - DEV split only by default. --split=heldout requires explicit opt-in
 *     and emits an aggregate-only report (no per-probe stdout).
 *   - Locked baselines untouched: this runner only reads code-graph.db.
 *
 * Output: JSONL per probe to
 *   core/prompt-optimization/data/query-shapes/ss-trace/tracks/track-a-<runId>.jsonl
 *
 * Env knobs (Stage 1b ablation):
 *   SWEET_SEARCH_TRACE_NO_PPR=1  drop directional PPR contribution
 *   SWEET_SEARCH_TRACE_NO_PR=1   drop static PageRank contribution
 *
 * Usage:
 *   node core/prompt-optimization/scripts/ss-trace/track-a-runner-ss-trace.mjs --run-id=baseline-dev-2026-05-14
 *   node core/prompt-optimization/scripts/ss-trace/track-a-runner-ss-trace.mjs --run-id=heldout-2026-05-14 --split=heldout
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
process.env.SWEET_SEARCH_PROJECT_ROOT = REPO_ROOT;

const PROBES_PATH = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-trace/probes.json');
const TRACKS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-trace/tracks');

const args = parseArgs(process.argv.slice(2));
const RUN_ID = args.runId || `ss-trace-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const SPLIT = args.split || 'dev';
const MAX_DEPTH = args.maxDepth ? Number(args.maxDepth) : 3;
const QUERY_HINT = args.queryHint || null;
const TOKEN_BUDGET = args.tokenBudget ? Number(args.tokenBudget) : null;
const K = args.k ? Number(args.k) : 5;
const VERBOSE = args.verbose === true;

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[toCamel(m[1])] = m[2] === undefined ? true : m[2];
  }
  return out;
}
function toCamel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

const { traceSymbol } = await import(path.join(REPO_ROOT, 'core/search/search-trace.js'));

function predictedSymbols(result, probe) {
  if (!result.target) return [];
  if (probe.relationshipType === 'callers') {
    return (result.sections.callers.items || []).map(x => x.name).filter(Boolean);
  }
  if (probe.relationshipType === 'callees') {
    return (result.sections.callees.items || []).map(x => x.name).filter(Boolean);
  }
  // impact: collapse paths to entity-name sets (exclude target itself).
  // path format from formatPath: "name (file:line) -> name (...) -> ..."
  const names = new Set();
  for (const p of (result.sections.impact.paths || [])) {
    const m = p.path.match(/(?:^|-> )([\w$]+) \(/g) || [];
    for (const mm of m) {
      const nm = mm.replace(/^->\s*/, '').replace(/\s+\($/, '');
      if (nm && nm !== probe.symbol) names.add(nm);
    }
  }
  return [...names];
}

function dedupe(arr) { return [...new Set(arr.filter(Boolean))]; }

function gradeAtK(predicted, expectedSet, k) {
  const top = predicted.slice(0, k);
  const tp = top.filter(p => expectedSet.has(p)).length;
  const recall = expectedSet.size ? tp / expectedSet.size : 0;
  const precision = top.length ? tp / top.length : 0;
  const f1 = (recall + precision) ? (2 * recall * precision) / (recall + precision) : 0;
  return { recall, precision, f1, tp, top };
}

function classify(recall) {
  if (recall >= 0.5) return 'PASS';
  if (recall > 0) return 'PARTIAL';
  return 'FAIL';
}

function main() {
  if (!fs.existsSync(PROBES_PATH)) {
    console.error(`probes.json missing at ${PROBES_PATH}; run build-probes.mjs first`);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(PROBES_PATH, 'utf8'));
  const probes = data.probes.filter(p => p.split === SPLIT);
  if (!probes.length) {
    console.error(`no probes for split=${SPLIT}`);
    process.exit(1);
  }

  fs.mkdirSync(TRACKS_DIR, { recursive: true });
  const outPath = path.join(TRACKS_DIR, `track-a-${RUN_ID}.jsonl`);
  const fd = fs.openSync(outPath, 'w');

  const aggregates = {
    by_relationship: {},
    by_language: {},
    by_family: {},
    by_classification: { PASS: 0, PARTIAL: 0, FAIL: 0 },
  };

  for (const probe of probes) {
    const expectedSet = new Set(dedupe(probe.expected));
    const expected2hop = probe.relationshipType === 'impact'
      ? new Set([...expectedSet, ...(probe.expected_2hop_diagnostic || [])])
      : expectedSet;
    const repoRoot = path.join(REPO_ROOT, 'eval/ast-tester-probes/_repos', probe.repoKey);
    const repoDb = path.join(repoRoot, '.sweet-search/code-graph.db');
    const t0 = Date.now();
    let result;
    try {
      if (!fs.existsSync(repoDb)) throw new Error(`missing repo db: ${repoDb}`);
      result = traceSymbol(probe.symbol, {
        projectRoot: repoRoot,
        graphDbPath: repoDb,
        filePath: probe.filePath,
        maxDepth: MAX_DEPTH,
        queryHint: QUERY_HINT,
        tokenBudget: TOKEN_BUDGET,
      });
    } catch (err) {
      result = { target: null, error: String(err) };
    }
    const latencyMs = Date.now() - t0;

    const predicted = dedupe(predictedSymbols(result, probe));
    const grade = gradeAtK(predicted, expectedSet, K);
    const grade2hop = probe.relationshipType === 'impact'
      ? gradeAtK(predicted, expected2hop, K)
      : null;
    const classification = classify(grade.recall);

    const row = {
      probeId: probe.probeId,
      goldId: probe.goldId,
      relationshipType: probe.relationshipType,
      language: probe.language,
      family: probe.family,
      split: probe.split,
      symbol: probe.symbol,
      filePath: probe.filePath,
      target_found: !!result.target,
      target_resolved_path: result.target?.filePath || null,
      target_resolved_line: result.target?.startLine || null,
      ambiguous_resolution: result.target ? probe.filePath && result.target.filePath !== probe.filePath : false,
      expected_size: expectedSet.size,
      predicted_size: predicted.length,
      recall_at_k: grade.recall,
      precision_at_k: grade.precision,
      f1_at_k: grade.f1,
      recall_at_k_2hop: grade2hop?.recall ?? null,
      tp_at_k: grade.tp,
      top_k_predicted: grade.top,
      classification,
      stats: result.target ? result.stats : null,
      budgetTier: result.budgetTier || null,
      tokensUsed: result.tokensUsed || 0,
      latencyMs,
      error: result.error || null,
      options: { maxDepth: MAX_DEPTH, queryHint: QUERY_HINT, tokenBudget: TOKEN_BUDGET, k: K },
    };
    fs.writeSync(fd, JSON.stringify(row) + '\n');

    const r = probe.relationshipType, l = probe.language, fam = probe.family;
    aggregates.by_relationship[r] = aggregates.by_relationship[r] || { n: 0, sumR: 0, sumP: 0, sumF1: 0, pass: 0, partial: 0, fail: 0 };
    aggregates.by_language[l] = aggregates.by_language[l] || {};
    aggregates.by_language[l][r] = aggregates.by_language[l][r] || { n: 0, sumR: 0, fail: 0 };
    aggregates.by_family[fam] = aggregates.by_family[fam] || {};
    aggregates.by_family[fam][r] = aggregates.by_family[fam][r] || { n: 0, sumR: 0, fail: 0 };

    const a = aggregates.by_relationship[r];
    a.n++; a.sumR += grade.recall; a.sumP += grade.precision; a.sumF1 += grade.f1;
    if (classification === 'PASS') a.pass++; else if (classification === 'PARTIAL') a.partial++; else a.fail++;
    aggregates.by_classification[classification]++;
    const al = aggregates.by_language[l][r]; al.n++; al.sumR += grade.recall; if (classification === 'FAIL') al.fail++;
    const af = aggregates.by_family[fam][r]; af.n++; af.sumR += grade.recall; if (classification === 'FAIL') af.fail++;

    if (VERBOSE) {
      console.log(`${probe.probeId}\t${classification}\tR=${grade.recall.toFixed(3)} P=${grade.precision.toFixed(3)}\texpected=${expectedSet.size} predicted=${predicted.length}\t${latencyMs}ms`);
    }
  }
  fs.closeSync(fd);

  const summary = {
    runId: RUN_ID,
    split: SPLIT,
    options: { maxDepth: MAX_DEPTH, queryHint: QUERY_HINT, tokenBudget: TOKEN_BUDGET, k: K },
    env: { NO_PPR: process.env.SWEET_SEARCH_TRACE_NO_PPR === '1', NO_PR: process.env.SWEET_SEARCH_TRACE_NO_PR === '1' },
    nProbes: probes.length,
    by_relationship: Object.fromEntries(Object.entries(aggregates.by_relationship).map(([k, v]) => [k, {
      n: v.n, recall: round(v.sumR / v.n), precision: round(v.sumP / v.n), f1: round(v.sumF1 / v.n),
      pass: v.pass, partial: v.partial, fail: v.fail,
      fail_rate: round(v.fail / v.n),
    }])),
    by_language_recall: Object.fromEntries(Object.entries(aggregates.by_language).map(([lang, byRel]) => [lang, Object.fromEntries(
      Object.entries(byRel).map(([rel, v]) => [rel, { n: v.n, recall: round(v.sumR / v.n), fail: v.fail, fail_rate: round(v.fail / v.n) }])
    )])),
    by_family_recall: Object.fromEntries(Object.entries(aggregates.by_family).map(([fam, byRel]) => [fam, Object.fromEntries(
      Object.entries(byRel).map(([rel, v]) => [rel, { n: v.n, recall: round(v.sumR / v.n), fail: v.fail, fail_rate: round(v.fail / v.n) }])
    )])),
    by_classification: aggregates.by_classification,
  };
  const sumPath = path.join(TRACKS_DIR, `summary-${RUN_ID}.json`);
  fs.writeFileSync(sumPath, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${probes.length} rows to ${outPath}`);
  console.log(`Summary: ${sumPath}`);
  console.log(`\nBy relationship type:`);
  for (const [r, v] of Object.entries(summary.by_relationship)) {
    console.log(`  ${r.padEnd(8)} n=${v.n}  R@${K}=${v.recall}  P@${K}=${v.precision}  F1@${K}=${v.f1}  PASS=${v.pass} PARTIAL=${v.partial} FAIL=${v.fail}`);
  }
}

function round(x) { return Number(x.toFixed(4)); }

main();

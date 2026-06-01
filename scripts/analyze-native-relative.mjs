#!/usr/bin/env node
/**
 * Native-relative comparison: M++ (sweet-search) vs native rg+Read, per target.
 * Uses the official nativeRelativeScore (eas.mjs) for native calls/cost (correct
 * pinned prices); M++'s real cache-naive $ comes from its own results file.
 *
 *   NATIVE_FILE=...native-default-baseline.json MPP_FILE=...heldout-mpp.json LABEL=held-out \
 *     node scripts/analyze-native-relative.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeRelativeScore } from '../core/prompt-optimization/sweep/eas.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (p) => (path.isAbsolute(p) ? p : path.join(REPO, p));
const LABEL = process.env.LABEL || 'set';
const TARGETS = ['sonnet', 'gpt5_5'];
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// NATIVE_FILE / MPP_FILE may be comma-separated to merge sets (e.g. held-out + OOD).
const nativeFiles = process.env.NATIVE_FILE.split(',').map((s) => abs(s.trim()));
const mppFiles = process.env.MPP_FILE.split(',').map((s) => abs(s.trim()));
const baselineByTarget = {};
for (const f of nativeFiles) {
  const d = JSON.parse(fs.readFileSync(f, 'utf8')).nativeBaselineByTarget || {};
  for (const t of TARGETS) baselineByTarget[t] = { ...(baselineByTarget[t] || {}), ...(d[t] || {}) };
}
const mppRuns = mppFiles.flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')).runs);

const perTarget = {};
const mppCostByTP = {};
const dropped = [];
for (const t of TARGETS) {
  const rs = mppRuns.filter((r) => r.target === t);
  const byP = {};
  for (const r of rs) { (byP[r.probeId] = byP[r.probeId] || []).push(r); }
  const list = [];
  for (const [probeId, arr] of Object.entries(byP)) {
    if (!baselineByTarget?.[t]?.[probeId]) { dropped.push(`${t}.${probeId}`); continue; } // native errored/missing
    list.push({ probeId, score: mean(arr.map((r) => r.score)), calls: mean(arr.map((r) => r.callCount)) });
    mppCostByTP[`${t}|${probeId}`] = mean(arr.map((r) => r.cost || 0));
  }
  perTarget[t] = list;
}
if (dropped.length) console.log(`⚠️  dropped ${dropped.length} probe×target with no native baseline (native error?): ${dropped.slice(0, 8).join(', ')}`);

const nr = nativeRelativeScore({ perTarget, baselineByTarget });

console.log(`\n═══ NATIVE-RELATIVE: M++ (sweet-search) vs native rg+Read — ${LABEL} ═══`);
const agg = { mppCalls: [], natCalls: [], mppCost: [], natCost: [], mppAcc: [], natAcc: [] };
for (const t of TARGETS) {
  const runs = nr.breakdown[t]?.runs || [];
  if (!runs.length) continue;
  const natCalls = mean(runs.map((r) => r.nativeCalls));
  const natCost = mean(runs.map((r) => r.nativeCostUsd));
  const natAcc = mean(runs.map((r) => r.nativeScore));
  const mppCalls = mean(runs.map((r) => r.calls));
  const mppAcc = mean(runs.map((r) => r.score));
  const mppCost = mean(runs.map((r) => mppCostByTP[`${t}|${r.probeId}`] ?? 0));
  agg.mppCalls.push(...runs.map((r) => r.calls)); agg.natCalls.push(...runs.map((r) => r.nativeCalls));
  agg.mppCost.push(...runs.map((r) => mppCostByTP[`${t}|${r.probeId}`] ?? 0)); agg.natCost.push(...runs.map((r) => r.nativeCostUsd));
  agg.mppAcc.push(...runs.map((r) => r.score)); agg.natAcc.push(...runs.map((r) => r.nativeScore));
  console.log(`\n  ${t}  (n=${runs.length})`);
  console.log(`    calls:    M++ ${mppCalls.toFixed(1)}   native ${natCalls.toFixed(1)}   → M++ ${(100 * (1 - mppCalls / natCalls)).toFixed(0)}% fewer  (native ${(natCalls / mppCalls).toFixed(2)}×)`);
  console.log(`    cost/run: M++ $${mppCost.toFixed(3)}   native $${natCost.toFixed(3)}   → M++ ${(100 * (1 - mppCost / natCost)).toFixed(0)}% cheaper  (native ${(natCost / mppCost).toFixed(2)}×)`);
  console.log(`    accuracy: M++ ${mppAcc.toFixed(3)}   native ${natAcc.toFixed(3)}   (Δ ${(mppAcc - natAcc >= 0 ? '+' : '') + (mppAcc - natAcc).toFixed(3)})`);
}
console.log(`\n  ── OVERALL (both targets) ──`);
console.log(`    calls:    M++ ${mean(agg.mppCalls).toFixed(1)}  vs native ${mean(agg.natCalls).toFixed(1)}  → ${(100 * (1 - mean(agg.mppCalls) / mean(agg.natCalls))).toFixed(0)}% fewer`);
console.log(`    cost:     M++ $${mean(agg.mppCost).toFixed(3)} vs native $${mean(agg.natCost).toFixed(3)} → ${(100 * (1 - mean(agg.mppCost) / mean(agg.natCost))).toFixed(0)}% cheaper`);
console.log(`    accuracy: M++ ${mean(agg.mppAcc).toFixed(3)} vs native ${mean(agg.natAcc).toFixed(3)}`);

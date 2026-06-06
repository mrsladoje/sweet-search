#!/usr/bin/env node
/**
 * USD cell stats for the paired mpp(ss)-vs-native cells across harnesses/sets.
 * For each cell, merge all matching arm dirs' rows.json, pair by probe id (mean over
 * reps), and emit:
 *   - per-arm means (acc, content, content_noD3, USD_noC, grounding, tokens, calls, $)
 *   - RAW paired Δ (ss − native) on the usefulness metrics + the efficiency endpoints
 *     (calls, realized $) with seeded bootstrap 95% CI + two-sided bootstrap p
 *   - §5b caliper-matched Δ (length-controlled HEADLINE) on the usefulness metrics
 *   - BH-FDR (q=0.05) across the cell family, per metric
 * Reuses the canonical caliperMatchedDelta + pairedBootstrapCI from usd-metric.
 *
 * Reproducible: all bootstraps use a SEED-ed mulberry32 RNG (default 42).
 *
 *   SET=heldout-ood node scripts/usd-cell-stats.mjs     # default: 18-cell triangulation family
 *   SET=vault        node scripts/usd-cell-stats.mjs     # 9-cell sealed primary family
 *   CELLS='name|^mppRe$|^natRe$ ...' node scripts/usd-cell-stats.mjs   # explicit override
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { caliperMatchedDelta, pairedBootstrapCI } from '../core/prompt-optimization/sweep/usd-metric.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RES = path.join(REPO, 'core/prompt-optimization/data/results');
const B = 20000;
const SEED = Number(process.env.SEED || 42);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const fmt = (x, d = 3) => (x == null || Number.isNaN(x) ? 'NA' : Number(x).toFixed(d));

// seeded RNG (mulberry32) — one advancing instance, deterministic given fixed call order.
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry32(SEED);

// two-sided bootstrap p over a vector of paired deltas (mirrors pairedBootstrapCI's resampling)
function bootstrapP(vals, b = B) {
  const n = vals.length; if (!n) return 1;
  let le = 0, ge = 0;
  for (let k = 0; k < b; k++) {
    let s = 0; for (let i = 0; i < n; i++) s += vals[(rng() * n) | 0];
    const m = s / n; if (m <= 0) le++; if (m >= 0) ge++;
  }
  return Math.min(1, 2 * Math.min(le / b, ge / b));
}

// merge all rows.json in dirs whose name matches `armRe` (RegExp source string).
// codex/ba/oc arms are sharded (shard index anywhere in the name); cc arms are a single dir.
function loadArm(armRe) {
  const re = new RegExp(armRe);
  const rows = [];
  for (const d of fs.readdirSync(RES)) {
    if (!re.test(d)) continue;
    const f = path.join(RES, d, 'rows.json');
    if (!fs.existsSync(f)) continue;
    for (const r of JSON.parse(fs.readFileSync(f, 'utf8'))) rows.push(r);
  }
  return rows;
}

// collapse reps → one record per probe id (means of the numeric metrics)
function byProbe(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.id)) m.set(r.id, []);
    m.get(r.id).push(r);
  }
  const out = [];
  for (const [id, rs] of m) {
    const ok = rs.filter((r) => r.exitCode === 0 && r.score != null && !r.usdError && Number.isFinite(r.usdTokens));
    if (!ok.length) continue;
    out.push({
      probeId: id, stratum: rs[0].stratum, lang: rs[0].lang,
      score: mean(ok.map((r) => r.score)),
      content: mean(ok.map((r) => r.content)),
      content_noD3: mean(ok.map((r) => r.content_noD3)),
      USD_noC: mean(ok.map((r) => r.USD_noC)),
      grounding: mean(ok.map((r) => r.grounding)),
      calls: mean(ok.map((r) => r.calls)),
      cost: mean(ok.map((r) => r.costUsd ?? 0)),
      costR: mean(ok.map((r) => r.realizedUsd ?? r.costUsd ?? 0)), // realized (cache-aware) where captured
      total_tokens: mean(ok.map((r) => r.usdTokens)),
    });
  }
  return out;
}

function nullScan(mppRe, natRe) {
  const bad = [];
  for (const [mode, reStr] of [['mpp', mppRe], ['native', natRe]]) {
    const re = new RegExp(reStr);
    for (const d of fs.readdirSync(RES)) {
      if (!re.test(d)) continue;
      const f = path.join(RES, d, 'rows.json');
      if (!fs.existsSync(f)) continue;
      for (const r of JSON.parse(fs.readFileSync(f, 'utf8'))) {
        if (r.exitCode !== 0 || r.score == null || r.usdError || !Number.isFinite(r.usdTokens)) {
          bad.push({ id: r.id, mode, exit: r.exitCode, score: r.score, usdErr: r.usdError || null });
        }
      }
    }
  }
  return bad;
}

// held-out + OOD triangulation matrix (arm = `^base(-s\d+)?$`; codex/ba/oc arms sharded).
const FULL_MATRIX = [];
for (const set of ['heldout', 'ood']) {
  for (const re of ['low', 'high']) FULL_MATRIX.push({ name: `cdx-${set}-${re}`, mpp: `^cdx-${set}-${re}-mpp(-s\\d+)?$`, native: `^cdx-${set}-${re}-native(-s\\d+)?$` });
  for (const m of ['glm', 'gpt']) FULL_MATRIX.push({ name: `ba-${m}-${set}`, mpp: `^ba-${m}-${set}-mpp$`, native: `^ba-${m}-${set}-native$` });
  FULL_MATRIX.push({ name: `oc-glm-${set}`, mpp: `^oc-${set}-glm-mpp$`, native: `^oc-${set}-glm-native$` });
  for (const c of ['sonnet-med', 'sonnet-max', 'opus-low', 'opus-xhigh']) FULL_MATRIX.push({ name: `cc-${set}-${c}`, mpp: `^cc-${set}-${c}-mpp$`, native: `^cc-${set}-${c}-native$` });
}

// sealed/blind PRIMARY family (vault, n=60). Shard index is mid-string for ba/oc.
const VAULT_MATRIX = [
  { name: 'cdx-low', mpp: '^cdx-low-mpp-s\\d+$', native: '^cdx-low-native-s\\d+$' },
  { name: 'cdx-high', mpp: '^cdx-high-mpp-s\\d+$', native: '^cdx-high-native-s\\d+$' },
  { name: 'ba-glm', mpp: '^ba-glm-s\\d+-vault-mpp$', native: '^ba-glm-s\\d+-vault-native$' },
  { name: 'ba-gpt', mpp: '^ba-gpt-s\\d+-vault-mpp$', native: '^ba-gpt-s\\d+-vault-native$' },
  { name: 'oc-glm', mpp: '^oc-vault-glm-s\\d+-mpp$', native: '^oc-vault-glm-s\\d+-native$' },
  { name: 'cc-sonnet-med', mpp: '^cc-vault-sonnet-med-mpp$', native: '^cc-vault-sonnet-med-native$' },
  { name: 'cc-sonnet-max', mpp: '^cc-vault-sonnet-max-mpp$', native: '^cc-vault-sonnet-max-native$' },
  { name: 'cc-opus-low', mpp: '^cc-vault-opus-low-mpp$', native: '^cc-vault-opus-low-native$' },
  { name: 'cc-opus-xhigh', mpp: '^cc-vault-opus-xhigh-mpp$', native: '^cc-vault-opus-xhigh-native$' },
];

const SET = process.env.SET || 'heldout-ood';
const CELLS = process.env.CELLS
  ? process.env.CELLS.trim().split(/\s+/).map((c) => { const [name, mpp, native] = c.split('|'); return { name, mpp, native }; })
  : (SET === 'vault' ? VAULT_MATRIX : SET === 'all' ? [...VAULT_MATRIX, ...FULL_MATRIX] : FULL_MATRIX);

const results = [];
for (const { name, mpp: mppBase, native: natBase } of CELLS) {
  const ssRows = loadArm(mppBase);
  const natRows = loadArm(natBase);
  if (!ssRows.length && !natRows.length) { console.error(`! no rows for ${name}`); continue; }
  const ss = byProbe(ssRows), nat = byProbe(natRows);
  const bad = nullScan(mppBase, natBase);

  // raw paired Δ (ss − native), paired by probe id. usefulness keys + efficiency endpoints.
  const natMap = new Map(nat.map((r) => [r.probeId, r]));
  const pairKeys = ['content', 'content_noD3', 'USD_noC'];   // usefulness (caliper-eligible)
  const effKeys = ['calls', 'costR'];                        // efficiency (ss−native; negative = ss leaner/cheaper)
  const pairs = ss.filter((s) => natMap.has(s.probeId)).map((s) => ({ s, n: natMap.get(s.probeId) }));
  const raw = {};
  for (const k of [...pairKeys, ...effKeys]) {
    const d = pairs.map((p) => p.s[k] - p.n[k]);
    const [lo, hi] = pairedBootstrapCI(d, B, rng);
    raw[k] = { mean: mean(d), ci: [lo, hi], excludesZero: lo > 0 || hi < 0, p: bootstrapP(d), n: d.length };
  }
  // caliper-matched (length-controlled) Δ
  const toArm = (a) => a.map((r) => ({ probeId: r.probeId, total_tokens: r.total_tokens, metrics: { content: r.content, content_noD3: r.content_noD3, USD_noC: r.USD_noC } }));
  const caliper = caliperMatchedDelta(toArm(ss), toArm(nat), { metricKeys: pairKeys, B, rng });

  const cell = {
    cell: name,
    n: { ssProbes: ss.length, natProbes: nat.length, paired: pairs.length, bad: bad.length },
    bad,
    arm: {
      ss: { acc: mean(ss.map((r) => r.score)), content: mean(ss.map((r) => r.content)), content_noD3: mean(ss.map((r) => r.content_noD3)), USD_noC: mean(ss.map((r) => r.USD_noC)), g: mean(ss.map((r) => r.grounding)), calls: mean(ss.map((r) => r.calls)), cost: mean(ss.map((r) => r.cost)), tok: mean(ss.map((r) => r.total_tokens)) },
      native: { acc: mean(nat.map((r) => r.score)), content: mean(nat.map((r) => r.content)), content_noD3: mean(nat.map((r) => r.content_noD3)), USD_noC: mean(nat.map((r) => r.USD_noC)), g: mean(nat.map((r) => r.grounding)), calls: mean(nat.map((r) => r.calls)), cost: mean(nat.map((r) => r.cost)), tok: mean(nat.map((r) => r.total_tokens)) },
    },
    rawPairedDelta: raw,
    caliperMatchedDelta: caliper,
  };
  results.push(cell);

  // pretty print
  console.log(`\n━━━ ${cell.cell}  (paired probes=${pairs.length}${bad.length ? `, ⚠ ${bad.length} bad rows` : ''}) ━━━`);
  const a = cell.arm;
  console.log(`  acc      ss=${fmt(a.ss.acc)}  nat=${fmt(a.native.acc)}`);
  console.log(`  content  ss=${fmt(a.ss.content)}  nat=${fmt(a.native.content)}   calls ss=${fmt(a.ss.calls,1)} nat=${fmt(a.native.calls,1)}   $ ss=${fmt(a.ss.cost,3)} nat=${fmt(a.native.cost,3)}   tok ss=${Math.round(a.ss.tok)} nat=${Math.round(a.native.tok)}`);
  for (const k of pairKeys) {
    const r = raw[k];
    console.log(`  RAW Δ ${k.padEnd(13)} ${r.mean >= 0 ? '+' : ''}${fmt(r.mean)}  CI[${fmt(r.ci[0])},${fmt(r.ci[1])}]  p=${fmt(r.p,4)}  ${r.excludesZero ? 'SIG' : 'ns'}`);
  }
  if (caliper.lengthMatchable) {
    console.log(`  caliper matched pairs=${caliper.matchedPairs}  (support ss=${fmt(caliper.ssSupportFrac,2)} nat=${fmt(caliper.natSupportFrac,2)})`);
    for (const k of pairKeys) {
      const r = caliper.deltas[k];
      if (r) console.log(`  CAL Δ ${k.padEnd(13)} ${r.mean >= 0 ? '+' : ''}${fmt(r.mean)}  CI[${fmt(r.ci[0])},${fmt(r.ci[1])}]  ${r.excludesZero ? 'SIG' : 'ns'}  (n=${r.n})`);
    }
  } else {
    console.log(`  caliper: NOT length-matchable (${caliper.reason})`);
  }
  // efficiency endpoints (ss − native; negative favours ss)
  for (const k of effKeys) {
    const r = raw[k];
    console.log(`  EFF Δ ${k.padEnd(13)} ${r.mean >= 0 ? '+' : ''}${fmt(r.mean, k === 'costR' ? 4 : 2)}  CI[${fmt(r.ci[0], k === 'costR' ? 4 : 2)},${fmt(r.ci[1], k === 'costR' ? 4 : 2)}]  p=${fmt(r.p,4)}  ${r.excludesZero ? 'SIG' : 'ns'}`);
  }
}

// ─── Benjamini-Hochberg FDR across the cell family (q=0.05) ───────────────────
const Q = Number(process.env.Q || 0.05);
function bhFDR(items, q) {
  // items: [{key, p}] → sorted ascending; reject all up to largest k with p(k) ≤ (k/m)q
  const m = items.length;
  const sorted = [...items].map((x, _i) => x).sort((a, b) => a.p - b.p);
  let kMax = 0;
  for (let k = 1; k <= m; k++) if (sorted[k - 1].p <= (k / m) * q) kMax = k;
  const crit = kMax ? (kMax / m) * q : 0;
  return sorted.map((x, i) => ({ ...x, rank: i + 1, threshold: ((i + 1) / m) * q, reject: i < kMax })) ;
}

console.log(`\n\n═══════ BH-FDR across ${results.length} cells (q=${Q}, SET=${SET}, SEED=${SEED}) ═══════`);
console.log(`  PRIMARY endpoint = content_noD3 (per-response, navigability-stripped). Others are supporting.`);
console.log(`  EFFICIENCY: 'calls' is cache/tokenizer-invariant → poolable. realized $ is NOT pooled`);
console.log(`  (incommensurable price units across models) — see per-cell EFF Δ above, FDR within-model only.`);
for (const metric of ['content_noD3', 'content', 'USD_noC', 'calls']) {
  const fam = results.map((c) => ({ cell: c.cell, p: c.rawPairedDelta[metric].p, delta: c.rawPairedDelta[metric].mean, sigRaw: c.rawPairedDelta[metric].excludesZero }));
  const tested = bhFDR(fam, Q);
  const nRej = tested.filter((t) => t.reject).length;
  const nRaw = fam.filter((t) => t.sigRaw).length;
  console.log(`\n── RAW paired Δ  ${metric}  —  ${nRej}/${fam.length} survive BH-FDR (raw-SIG before correction: ${nRaw}) ──`);
  for (const t of tested) {
    console.log(`  ${t.reject ? '✓' : '·'} ${t.cell.padEnd(20)} Δ=${t.delta >= 0 ? '+' : ''}${fmt(t.delta)}  p=${fmt(t.p, 4)}  (BH thr=${fmt(t.threshold, 4)})${t.reject ? '' : '   (fails FDR)'}`);
  }
}

const outF = path.join(RES, `usd-cell-stats-${SET}.json`);
fs.writeFileSync(outF, JSON.stringify({ set: SET, q: Q, seed: SEED, cells: results }, null, 2));
console.log(`\nwrote ${path.relative(REPO, outF)}  (${results.length} cells)`);

#!/usr/bin/env node
/**
 * USD metric — §7.3 AGGREGATE report from a scored run.
 *
 * Reads core/prompt-optimization/data/metric-forge/scores/<RUN_ID>/*.json and
 * computes: per-arm means (USD / USD_noC / content / content_noD3 / purity_ratio
 * / tokens), the §5b caliper-matched paired Δ on common token support (HEADLINE),
 * the unmatched (raw) paired Δ + per-probe pairing, per-stratum breakdown,
 * no-match confident-false-positive rate, the length-control audit (common-support
 * diagnostic + matched-vs-raw), and the Layer-B validation scaffold.
 *
 *   RUN_ID=run-v1 node scripts/usd-aggregate.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { caliperMatchedDelta, pairedBootstrapCI, USD_PARAMS } from '../core/prompt-optimization/sweep/usd-metric.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO, 'core/prompt-optimization/data/metric-forge');
const RUN_ID = process.env.RUN_ID;
if (!RUN_ID) { console.error('set RUN_ID'); process.exit(1); }
const SCORE_DIR = path.join(OUT, 'scores', RUN_ID);

const rows = [];
for (const f of fs.readdirSync(SCORE_DIR)) {
  if (!f.endsWith('.json')) continue;
  const r = JSON.parse(fs.readFileSync(path.join(SCORE_DIR, f), 'utf8'));
  rows.push(r);
}
const ss = rows.filter((r) => r.arm === 'ss' && !r.error);
const nat = rows.filter((r) => r.arm === 'native' && !r.error);
const errs = rows.filter((r) => r.error);

const mean = (a, f) => (a.length ? a.reduce((s, x) => s + (f(x) ?? 0), 0) / a.length : 0);
const fmt = (x, d = 3) => (x == null || Number.isNaN(x) ? 'NA' : Number(x).toFixed(d));

// Build the metrics shape the caliper matcher expects.
const toArm = (a) => a.filter((r) => Number.isFinite(r.total_tokens)).map((r) => ({
  probeId: r.probeId, total_tokens: r.total_tokens,
  metrics: { content_noD3: r.content_noD3, content: r.content, USD: r.USD, USD_noC: r.USD_noC },
}));
const ssArm = toArm(ss);
const natArm = toArm(nat);

// §5b HEADLINE: caliper-matched paired Δ on common support.
const matched = caliperMatchedDelta(ssArm, natArm, { metricKeys: ['content_noD3', 'content', 'USD', 'USD_noC'], B: 20000 });

// RAW (same-probe) paired Δ — the un-length-controlled comparison, for contrast.
const byId = new Map();
for (const r of [...ss, ...nat]) {
  if (r.error) continue;
  if (!byId.has(r.probeId)) byId.set(r.probeId, {});
  byId.get(r.probeId)[r.arm] = r;
}
function rawPairedDelta(key) {
  const d = [];
  for (const [, pair] of byId) {
    if (pair.ss && pair.native) d.push((pair.ss[key] ?? 0) - (pair.native[key] ?? 0));
  }
  const m = d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0;
  const [lo, hi] = pairedBootstrapCI(d, 20000);
  return { mean: m, ci: [lo, hi], excludesZero: lo > 0 || hi < 0, n: d.length };
}
const rawDeltas = {
  content_noD3: rawPairedDelta('content_noD3'),
  content: rawPairedDelta('content'),
  USD: rawPairedDelta('USD'),
  USD_noC: rawPairedDelta('USD_noC'),
};

// per-stratum means
const strata = [...new Set(rows.filter((r) => !r.error).map((r) => r.stratum))];
const perStratum = {};
for (const s of strata) {
  const ssS = ss.filter((r) => r.stratum === s);
  const natS = nat.filter((r) => r.stratum === s);
  perStratum[s] = {
    n: ssS.length,
    ss: { USD: mean(ssS, (x) => x.USD), USD_noC: mean(ssS, (x) => x.USD_noC), content_noD3: mean(ssS, (x) => x.content_noD3), g: mean(ssS, (x) => x.grounding), tok: mean(ssS, (x) => x.total_tokens) },
    native: { USD: mean(natS, (x) => x.USD), USD_noC: mean(natS, (x) => x.USD_noC), content_noD3: mean(natS, (x) => x.content_noD3), g: mean(natS, (x) => x.grounding), tok: mean(natS, (x) => x.total_tokens) },
  };
}

// no-match confident-false-positive rate
const nmSs = ss.filter((r) => r.isNoMatch);
const nmNat = nat.filter((r) => r.isNoMatch);
const fpRate = (a) => (a.length ? a.filter((r) => r.programmatic?.confidentFalsePositive).length / a.length : null);

// per-criterion means (D1..D5, C) per arm — the sub-score vector
const crit = ['D1', 'D2', 'D3', 'D4', 'D5', 'signal_purity'];
const perCrit = {};
for (const c of crit) perCrit[c] = { ss: mean(ss.filter((r) => !r.isNoMatch), (x) => x[c]), native: mean(nat.filter((r) => !r.isNoMatch), (x) => x[c]) };

// per-dimension correlation (flag ρ>0.9 for v2 merge) — Pearson over the pooled non-no-match rows
function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}
const pooled = rows.filter((r) => !r.error && !r.isNoMatch);
const corrMatrix = {};
const dimKeys = ['D1', 'D2', 'D3', 'D4', 'D5', 'signal_purity', 'purity_ratio'];
for (let i = 0; i < dimKeys.length; i++) for (let j = i + 1; j < dimKeys.length; j++) {
  const a = dimKeys[i], b = dimKeys[j];
  const r = pearson(pooled.map((x) => x[a] ?? 0), pooled.map((x) => x[b] ?? 0));
  if (r != null) corrMatrix[`${a}~${b}`] = Number(r.toFixed(3));
}

// length distribution audit
const tokStats = (a) => {
  const t = a.map((r) => r.total_tokens).filter(Number.isFinite).sort((x, y) => x - y);
  if (!t.length) return null;
  const q = (p) => t[Math.min(t.length - 1, Math.floor(p * t.length))];
  return { n: t.length, min: t[0], q25: q(0.25), median: q(0.5), q75: q(0.75), max: t[t.length - 1], mean: Math.round(t.reduce((s, x) => s + x, 0) / t.length) };
};

const out = {
  runId: RUN_ID, rubricHash: rows[0]?.rubricHash, params: USD_PARAMS,
  n: { probes: byId.size, ss: ss.length, native: nat.length, errors: errs.length },
  errors: errs.map((e) => ({ probeId: e.probeId, arm: e.arm, error: e.error })),
  perArmMean: {
    ss: { USD: mean(ss, (x) => x.USD), USD_noC: mean(ss, (x) => x.USD_noC), content: mean(ss, (x) => x.content), content_noD3: mean(ss, (x) => x.content_noD3), purity_ratio: mean(ss, (x) => x.purity_ratio), g: mean(ss, (x) => x.grounding), tokens: mean(ss, (x) => x.total_tokens) },
    native: { USD: mean(nat, (x) => x.USD), USD_noC: mean(nat, (x) => x.USD_noC), content: mean(nat, (x) => x.content), content_noD3: mean(nat, (x) => x.content_noD3), purity_ratio: mean(nat, (x) => x.purity_ratio), g: mean(nat, (x) => x.grounding), tokens: mean(nat, (x) => x.total_tokens) },
  },
  tokenDistribution: { ss: tokStats(ss), native: tokStats(nat) },
  headline_caliperMatchedDelta: matched,
  rawPairedDelta_unmatched: rawDeltas,
  perCriterionMean: perCrit,
  perDimensionCorrelation: corrMatrix,
  perStratum,
  noMatch: { ss: { n: nmSs.length, confidentFalsePositiveRate: fpRate(nmSs), meanUSD: mean(nmSs, (x) => x.USD) }, native: { n: nmNat.length, confidentFalsePositiveRate: fpRate(nmNat), meanUSD: mean(nmNat, (x) => x.USD) } },
};

fs.writeFileSync(path.join(OUT, `run-aggregate-${RUN_ID}.json`), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.log(`\naggregate: ${path.join(OUT, `run-aggregate-${RUN_ID}.json`)}`);

#!/usr/bin/env node
/**
 * Analyze M++ on the sealed sets: held-out (30), OOD/8-lang (40), counter (10).
 * AGGREGATE-ONLY discipline on held-out/OOD (never per-query diagnose; report, don't tune).
 *
 * Gates:
 *   - Held-out: per-target acc + Maximin; generalization vs M++ dev reference (sonnet 0.995 / gpt 0.980).
 *   - OOD: Maximin ≥ 0.55 across both targets; per-LANGUAGE scorecard (flag any language < 0.4).
 *   - Counter: per-target acc (anti-overfit — high = did NOT chase the decoy).
 *
 *   node scripts/analyze-sealed-mpp.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RES = path.join(REPO, 'core/prompt-optimization/data/results');
const load = (f) => { try { return JSON.parse(fs.readFileSync(path.join(RES, f), 'utf8')).runs || []; } catch { return null; } };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const TARGETS = ['sonnet', 'gpt5_5'];
const DEV_REF = { sonnet: 0.995, gpt5_5: 0.980 }; // M++ dev-53 reference

function perTarget(runs, label, opts = {}) {
  console.log(`\n━━━ ${label} ━━━`);
  if (!runs) { console.log('  (results file missing)'); return; }
  const empt = runs.filter((r) => r.stillEmpty);
  if (empt.length) console.log(`  ⚠️  STILL-EMPTY: ${empt.length} — re-run those cells`);
  const accByT = {};
  for (const tg of TARGETS) {
    const rs = runs.filter((r) => r.target === tg);
    if (!rs.length) continue;
    accByT[tg] = mean(rs.map((r) => r.score));
    const ref = DEV_REF[tg];
    const drop = ref != null ? (ref - accByT[tg]) : null;
    console.log(`  ${tg.padEnd(7)} acc=${accByT[tg].toFixed(3)}  calls=${mean(rs.map((r) => r.callCount)).toFixed(2)}  $=${mean(rs.map((r) => r.cost || 0)).toFixed(4)}/run  (n=${rs.length})${drop != null ? `  Δvs-dev=${drop >= 0 ? '-' : '+'}${Math.abs(drop).toFixed(3)}${drop > 0.15 ? ' 🚩>0.15' : ''}` : ''}`);
  }
  const maximin = Math.min(...TARGETS.map((t) => accByT[t] ?? 1));
  const gate = opts.maximinGate;
  console.log(`  Maximin acc = ${maximin.toFixed(3)}${gate ? `   (gate ≥${gate}: ${maximin >= gate ? 'PASS ✅' : 'FAIL ❌'})` : ''}`);
  return { accByT, maximin };
}

console.log('═══════ M++ SEALED-SET VALIDATION (aggregate-only) ═══════');

// 1) Held-out
perTarget(load('heldout-mpp.json'), 'HELD-OUT (n=30) — generalization', {});

// 2) OOD — with per-language scorecard
const ood = load('ood-mpp.json');
const r = perTarget(ood, 'OOD / 8-language transfer (n=40)', { maximinGate: 0.55 });
if (ood) {
  // runner persists probeId but not language → join language from the frozen OOD file
  const oodArr = (() => { try { const j = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/frozen/p7-langtransfer-probes.json'), 'utf8')); return Array.isArray(j) ? j : (j.probes || []); } catch { return []; } })();
  const langById = new Map(oodArr.map((p) => [p.id, p.language || p.lang]));
  const langOf = (x) => x.language || x.lang || langById.get(x.probeId);
  console.log('  — per-language scorecard (acc/calls; flag <0.4) —');
  const langs = [...new Set(ood.map(langOf).filter(Boolean))].sort();
  for (const lang of langs) {
    const line = TARGETS.map((tg) => {
      const rs = ood.filter((x) => x.target === tg && langOf(x) === lang);
      return rs.length ? `${tg.split('5')[0].padEnd(6)}=${mean(rs.map((x) => x.score)).toFixed(2)}/c${mean(rs.map((x) => x.callCount)).toFixed(1)}` : `${tg}=–`;
    }).join('  ');
    const m = Math.min(...TARGETS.map((tg) => { const rs = ood.filter((x) => x.target === tg && langOf(x) === lang); return rs.length ? mean(rs.map((x) => x.score)) : 1; }));
    console.log(`     ${String(lang).padEnd(8)} ${line}   min=${m.toFixed(2)}${m < 0.4 ? ' 🚩WEAK-SPOT' : ''}`);
  }
}

// 3) Counter (anti-overfit)
perTarget(load('counter-mpp.json'), 'ADVERSARIAL COUNTER (n=10) — anti-overfit (high acc = resisted decoy)', {});

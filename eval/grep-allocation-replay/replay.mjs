#!/usr/bin/env node
/**
 * ss-grep allocation replay (docs/SUGGESTED_PLAN.md at 945a9664, Step 0): every pre-registered arm
 * (prereg.json) on every collected call, with the production selection, stamping and renderer
 * (replay-core.mjs). Reports per segment (all / overflow = more matching files than k / fits):
 * answer-file inclusion, lines from answer files, answer-symbol hit, declaration hit, files
 * shown, fits calls with a zero-line file; paired probe-clustered bootstrap against the
 * baseline; and the pre-registered Step 1 bar per question type.
 *
 * A collection of set "dev" (the probes that chose these rules) is EXPLORATORY: the report says
 * so. Only "dev-confirm" calls can confirm.
 *
 * Usage: node eval/grep-allocation-replay/replay.mjs [--in out/collected-dev.json]
 *          [--prereg prereg.json] [--out out/report-dev.json] [--per-query]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { DEFAULT_OUT, PERMITTED_SETS, callMetrics, mean, pairedBootstrap } from './lib.mjs';
import { callTargets, matchList, renderArm } from './replay-core.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const argValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const IN = argValue('--in', path.join(DEFAULT_OUT, 'collected-dev.json'));
const PREREG = JSON.parse(readFileSync(argValue('--prereg', path.join(HERE, 'prereg.json')), 'utf8'));
const data = JSON.parse(readFileSync(IN, 'utf8'));
const OUT = argValue('--out', path.join(DEFAULT_OUT, `report-${data.set}.json`));
const PER_QUERY = process.argv.includes('--per-query');

if (!PERMITTED_SETS.has(data.set)) {
  process.stderr.write(`refusing: collection set "${data.set}" is not a dev set\n`);
  process.exit(2);
}
if (!data.provenanceVerified) process.stderr.write('WARNING: this collection did not pass the provenance check (--allow-mismatch)\n');

const METRICS = ['inclusion', 'answerLines', 'symHit', 'declHit', 'filesShown', 'zeroLineFile'];
const arms = PREREG.arms;
const results = Object.fromEntries(arms.map(a => [a.name, []]));
const callsOut = [];
const t0 = performance.now();
for (const call of data.calls) {
  const byFile = data.greps[call.grepKey] || {};
  const matchedFiles = Object.keys(byFile);
  const gold = new Set(call.goldFiles);
  if (!matchedFiles.some(f => gold.has(f))) continue;
  const index = { spans: data.spans[call.repo] || {}, stale: new Set(data.stale[call.repo] || []) };
  const targets = callTargets(call, byFile, index.spans);
  const matches = matchList(byFile);
  const ctx = { gold, matchedFiles, targets, k: call.k };
  const segment = matchedFiles.length > call.k ? 'overflow' : 'fits';
  const questionType = call.questionType ?? call.stratum ?? 'unknown';
  for (const arm of arms) {
    const body = renderArm(call, matches, arm, index);
    results[arm.name].push({ probe: call.probe, segment, questionType, ...callMetrics(body.rows, ctx) });
  }
  if (PER_QUERY) callsOut.push({ probe: call.probe, args: call.args, segment, targets: targets.length });
}
const elapsed = performance.now() - t0;

function summarize(rows) {
  const out = { calls: rows.length, probes: new Set(rows.map(r => r.probe)).size };
  for (const m of METRICS) {
    const v = rows.map(r => r[m]).filter(x => x != null);
    out[m] = v.length ? mean(v) : null;
    out[`${m}N`] = v.length;
  }
  return out;
}

function contrast(armName, baseName, filter) {
  const a = results[armName].filter(filter);
  const b = results[baseName].filter(filter);
  const out = {};
  for (const m of ['inclusion', 'answerLines', 'symHit', 'declHit']) {
    out[m] = pairedBootstrap(a.map(r => ({ probe: r.probe, value: r[m] })), b.map(r => ({ probe: r.probe, value: r[m] })),
      PREREG.constants.bootstrap);
  }
  return out;
}

const SEGMENTS = { all: () => true, overflow: r => r.segment === 'overflow', fits: r => r.segment === 'fits' };
const report = {
  input: path.relative(process.cwd(), IN),
  set: data.set,
  exploratory: data.exploratory !== false,
  provenanceVerified: data.provenanceVerified,
  provenance: data.provenance,
  prereg: { version: PREREG.version, registeredAt: PREREG.registeredAt },
  replayMs: Math.round(elapsed),
  segments: {},
  contrasts: {},
  bars: {},
};
for (const [seg, filter] of Object.entries(SEGMENTS)) {
  report.segments[seg] = Object.fromEntries(arms.map(a => [a.name, summarize(results[a.name].filter(filter))]));
  report.contrasts[seg] = {};
  const s1 = PREREG.bars.step1;
  report.contrasts[seg][`${s1.candidate} - ${s1.baseline}`] = contrast(s1.candidate, s1.baseline, filter);
  for (const arm of arms) {
    if (arm.name === PREREG.bars.step2.baseline || !arm.lines) continue;
    report.contrasts[seg][`${arm.name} - ${PREREG.bars.step2.baseline}`] = contrast(arm.name, PREREG.bars.step2.baseline, filter);
  }
  report.contrasts[seg]['shipped - legacy'] = contrast('shipped', 'legacy', filter);
}

// Step 1 bar (pre-registered): symHit +2 points overall, no question type significantly negative,
// inclusion unchanged.
{
  const s1 = PREREG.bars.step1;
  const overall = report.contrasts.all[`${s1.candidate} - ${s1.baseline}`];
  const types = [...new Set(results[s1.candidate].map(r => r.questionType))].sort();
  const perType = Object.fromEntries(types.map(t => [t, contrast(s1.candidate, s1.baseline, r => r.questionType === t).symHit]));
  const inclusionSame = results[s1.candidate].every((r, i) => r.inclusion === results[s1.baseline][i].inclusion);
  report.bars.step1 = {
    symHitDiff: overall.symHit,
    symHitPass: overall.symHit.diff >= s1.symHitMinDiff,
    perQuestionType: perType,
    perQuestionTypePass: Object.values(perType).every(c => !(c.hi < 0)),
    inclusionUnchanged: inclusionSame,
  };
  report.bars.step1.pass = report.bars.step1.symHitPass && report.bars.step1.perQuestionTypePass && inclusionSame;
}
if (PER_QUERY) report.calls = callsOut;
writeFileSync(OUT, JSON.stringify(report, null, 2));

const pct = x => (x == null ? '   -  ' : `${(100 * x).toFixed(1).padStart(5)}%`);
const num = x => (x == null ? '  -  ' : x.toFixed(2).padStart(5));
const ci = c => `${c.diff >= 0 ? '+' : ''}${(100 * c.diff).toFixed(1)} [${(100 * c.lo).toFixed(1)}, ${(100 * c.hi).toFixed(1)}]`;
const out = [];
out.push(`${report.exploratory ? 'EXPLORATORY (dev probes that chose these rules; consistency, not confirmation)' : 'CONFIRMATION (dev-confirm)'}`
  + ` — ${IN} — prereg v${PREREG.version} — replay ${report.replayMs} ms`);
for (const seg of Object.keys(SEGMENTS)) {
  const first = report.segments[seg][arms[0].name];
  out.push(`\n== ${seg}: ${first.calls} calls, ${first.probes} probes (symHit on ${first.symHitN} calls)`);
  out.push('  arm                    inclusion  answerLines  symHit  declHit  filesShown  zeroLineFile');
  for (const a of arms) {
    const s = report.segments[seg][a.name];
    out.push(`  ${a.name.padEnd(22)} ${pct(s.inclusion)}     ${num(s.answerLines)}    ${pct(s.symHit)} ${pct(s.declHit)}    ${num(s.filesShown)}     ${pct(s.zeroLineFile)}`);
  }
  out.push('  paired contrasts (points, 95% probe-clustered CI): inclusion | symHit | answerLines');
  for (const [name, c] of Object.entries(report.contrasts[seg])) {
    out.push(`    ${name.padEnd(36)} ${ci(c.inclusion).padEnd(24)} ${ci(c.symHit).padEnd(24)} ${c.answerLines.diff >= 0 ? '+' : ''}${c.answerLines.diff.toFixed(2)}`);
  }
}
const b1 = report.bars.step1;
out.push(`\nStep 1 bar (${PREREG.bars.step1.candidate} vs ${PREREG.bars.step1.baseline}): symHit ${ci(b1.symHitDiff)} `
  + `(need >= +${100 * PREREG.bars.step1.symHitMinDiff}) ${b1.symHitPass ? 'PASS' : 'FAIL'}; question types `
  + `${b1.perQuestionTypePass ? 'PASS' : 'FAIL'}; inclusion unchanged ${b1.inclusionUnchanged ? 'PASS' : 'FAIL'}`
  + `${report.exploratory ? ' — exploratory, not a promotion decision' : ''}`);
for (const [t, c] of Object.entries(b1.perQuestionType)) out.push(`    ${t.padEnd(20)} ${ci(c)} (n=${c.n}, probes=${c.probes})`);
process.stdout.write(`${out.join('\n')}\n-> ${OUT}\n`);

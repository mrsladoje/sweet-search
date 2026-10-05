#!/usr/bin/env node
// ramp-report.mjs — aggregates of the ramp.sh levels: throughput, cache share, errors, load. No per-question value.
//
//   node core/prompt-optimization/data/final-run/ramp-report.mjs [--state ~/.ss-eval/ho1005]
//
// Throughput = ok rollouts that FINISHED inside the window / window minutes. The window starts at the
// cell's first scored rollout (after its warm-up) and ends when ramp.sh stopped the level.
// Cache share = cached input tokens / all input tokens, summed per arm (Codex: cached_input_tokens /
// input_tokens; Claude Code: cache_read / (input + cache_creation + cache_read)).
// First-request cache = mean first-request cache read of the arm's first --conc rollouts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.resolve(HERE, '../results');
const argv = process.argv.slice(2);
const STATE = argv.includes('--state') ? argv[argv.indexOf('--state') + 1] : path.join(os.homedir(), '.ss-eval/ho1005');
const RS = path.join(STATE, 'ramp');
const CELLS = ['codex-sol61-high', 'cc-opus55-medium'];
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
const rows = (f) => read(f).split('\n').filter(Boolean).map(l => JSON.parse(l));
const sum = (a) => a.reduce((x, y) => x + y, 0);

const cacheOf = (r) => {
  const u = r.usage || {};
  if ('cached_input_tokens' in u) return [u.cached_input_tokens || 0, u.input_tokens || 0];
  const rd = u.cache_read_input_tokens || 0;
  return [rd, (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + rd];
};

const levels = fs.existsSync(RS) ? fs.readdirSync(RS).map(f => /^stop-c(\d+)$/.exec(f)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b) : [];
console.log('| conc | cell | ok done in window | window min | rollouts/min | arm: cache share · first-req read · errors | load max | free GB min |');
console.log('|---|---|---|---|---|---|---|---|');
for (const c of levels) {
  const stop = Number(read(path.join(RS, `stop-c${c}`))) * 1000;
  const sys = read(path.join(RS, `sys-c${c}.log`)).split('\n').filter(Boolean).map(l => l.split(' '));
  const loadMax = sys.length ? Math.max(...sys.map(s => Number(s[2]))) : NaN;
  const freeMin = sys.length ? Math.min(...sys.map(s => Number(s[4]))) : NaN;
  for (const cell of CELLS) {
    const all = rows(path.join(RESULTS, `r282-${cell}-ho1005-ramp-c${c}`, 'runs.jsonl'));
    const ok = all.filter(r => !r.error && r.exitCode === 0 && Number.isFinite(r.startedAtMs));
    if (!all.length) { console.log(`| ${c} | ${cell} | no rows | | | | | |`); continue; }
    const t0 = Math.min(...all.filter(r => Number.isFinite(r.startedAtMs)).map(r => r.startedAtMs));
    const done = ok.filter(r => r.startedAtMs + (r.wallMs || 0) <= stop);
    const win = (stop - t0) / 60000;
    const arms = [...new Set(all.map(r => r.arm))].sort().map(a => {
      const ar = ok.filter(r => r.arm === a);
      const [cached, input] = ar.map(cacheOf).reduce(([x, y], [p, q]) => [x + p, y + q], [0, 0]);
      const first = ar.slice().sort((x, y) => x.startedAtMs - y.startedAtMs).slice(0, c).map(r => Number(r.firstRequestCacheRead)).filter(Number.isFinite);
      const errs = all.filter(r => r.arm === a && (r.error || r.exitCode !== 0)).length;
      return `${a}: ${input ? (100 * cached / input).toFixed(1) : '—'}% · ${first.length ? Math.round(sum(first) / first.length) : '—'} · ${errs}`;
    });
    console.log(`| ${c} | ${cell} | ${done.length} | ${win.toFixed(1)} | ${(done.length / win).toFixed(2)} | ${arms.join('; ')} | ${loadMax} | ${freeMin} |`);
  }
}
const logs = levels.flatMap(c => CELLS.map(cell => [c, cell, read(path.join(RS, `${cell}-c${c}.log`))]));
for (const [c, cell, txt] of logs) {
  const hits = (txt.match(/ACCOUNT FATAL|rate.?limit|429|usage limit|overloaded/gi) || []).length;
  if (hits) console.log(`c${c} ${cell}: ${hits} rate-limit / account lines in the bench log`);
}

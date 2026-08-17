// Is the C-4 argmax distinguishable from its neighbours? Apply the one-standard-error rule
// properly instead of asserting it: bootstrap the per-configuration delta OVER TASKS (the unit
// of heterogeneity), then ask how many configurations lie within 1 SE of the best.
//
// If the 1-SE set is large, the argmax is not identified and shipping it is a coin flip
// dressed as an optimum.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { costFromTurns, priceFor } from '/root/sweet-search-private/eval/task-completion-bench/harness/ideal-cost.mjs';

const RUN = 'sb-codex-20260811';
const ARM = 'sweet';
const R = `/root/sweet-search-private/eval/task-completion-bench/results/${RUN}`;
const GOLDEN = '/root/.ss-eval/golden';
const rows = JSON.parse(readFileSync(path.join(R, 'rows.json'), 'utf8'));
const goldenDirs = readdirSync(GOLDEN);
const BASE = {
  'redboltz__mqtt_cpp-466': 'f48e140ba080e6078ad4066ae6280b5d10210521',
  'dotnet__yarp-2825': '7c46ec2cc39a731b393cee033d4a2d81c8b8e492',
  'dart-lang__http-1114': '5c75da6e084145b27c046827b89d518e30c19048',
  'dashbitco__nimble_options-43': '5270554b86676476b3e63d91f54c0d340a67102c',
  'ontodev__robot-710': '691d0dd57b97309da2e05b86bc0d6bcace1ecf78',
  'codeception__codeceptjs-367': '9ed81962765b738eaa4d6bad059ce72081547190',
  'akinsho__nvim-bufferline.lua-173': '7bf463cf7c61faa9f24222bba9412230d4cc1dc7',
  'mransan__ocaml-protoc-202': 'cc163d8eb2444363b58d7b4d43c9788b8946abd6',
  'statamic__cms-9029': 'ce8e80987e29c8929364dc8387cd0f2399128202',
  'litestar-org__polyfactory-405': '63aa2729df553f49ed137e8e33c6a1a80387ca2b',
  'epiforecasts__scoringutils-229': '53436b609c29c7b72016ea645601a21a8ee3564b',
  'apple__swift-nio-http2-145': '3d0b38268ecda6ba0e7a1d5aca1c3c5a20f7c42a',
  'joshuakgoldberg__bingo-274': 'aa2363da6dae89bb322beb9916358b3865bd68e4',
  'jashkenas__underscore-2757': '4bd6f69b33179517d4ff9f6020637d6f336c5f99',
  'pytask-dev__pytask-210': '30227332d58cbe0dc8a055cafd5711eb1cd653d8',
  'rstudio-education__gradethis-161': '2e64380c0e96eff7b3e3a52b0af79cdc5c6b5ec6',
  'oceanparcels__parcels-617': '762f0215ba0cea90531b5c72c8c037b056330ab0',
  'teleporthq__teleport-code-generators-291': 'ee3baaf6246efd494d6bc406a541edf9d370eacd',
};
const goldenFor = t => { const s = BASE[t]; const h = s && goldenDirs.find(d => d.endsWith(`@${s}`)); return h ? path.join(GOLDEN, h) : null; };
function rolloutFiles(taskId, arm) {
  const home = path.join(R, 'agent-state', `${taskId}-${arm}`, 'codex-home', 'sessions');
  const out = [];
  const walk = d => { let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.jsonl')) out.push(p); } };
  walk(home); return out.sort();
}
function parseRollout(file) {
  const ev = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t[0] !== '{') continue;
    let o; try { o = JSON.parse(t); } catch { continue; }
    const p = o.payload || {}; const ty = p.type || o.type;
    if (ty === 'token_count' && p.info?.last_token_usage) {
      const u = p.info.last_token_usage;
      ev.push({ kind: 'turn', in: u.input_tokens || 0, cached: u.cached_input_tokens || 0,
        out: (u.output_tokens || 0) + (u.reasoning_output_tokens || 0) });
    } else if (ty === 'function_call' || ty === 'custom_tool_call') {
      ev.push({ kind: 'call', cmd: String(p.input ?? p.arguments ?? '') });
    }
  }
  return ev;
}
function parseSsRead(cmd) {
  if (!/\bss-read\b/.test(cmd)) return null;
  const m = /\bss-read\b([^\n|;&]*)/.exec(cmd); if (!m) return null;
  const toks = m[1].trim().split(/\s+/).filter(Boolean);
  let file = null, a = null, b = null;
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk.startsWith('-')) { if (/^--(lines|range)$/.test(tk) && toks[i + 1]) { const r = /(\d+)\s*-\s*(\d+)/.exec(toks[++i]); if (r) { a = +r[1]; b = +r[2]; } } continue; }
    const c = /^(.*?):(\d+)-(\d+)$/.exec(tk);
    if (c) { file = file || c[1]; a = +c[2]; b = +c[3]; continue; }
    if (!file) { file = tk.replace(/^['"]|['"]$/g, ''); continue; }
    if (/^\d+$/.test(tk)) { if (a == null) a = +tk; else if (b == null) b = +tk; }
  }
  return file ? { file, a, b } : null;
}
const BPT = 3.5;
function replaySpanGated(T, seq, meta, minFrac, maxLines) {
  const servedWhole = new Set(); const extraAt = new Map(), removeTurns = new Set();
  for (const s of seq) {
    if (!s.read) continue;
    const m = meta.get(s.read.file); if (!m) continue;
    const { lines, wholeTokens } = m;
    const a = s.read.a ?? 1, b = s.read.b ?? lines;
    const spanFrac = Math.min(1, Math.max(0, (b - a + 1) / Math.max(1, lines)));
    if (lines > maxLines) continue;
    if (!servedWhole.has(s.read.file)) {
      if (spanFrac >= minFrac) {
        extraAt.set(s.turnIdx, (extraAt.get(s.turnIdx) || 0) + Math.max(0, wholeTokens * (1 - spanFrac)));
        servedWhole.add(s.read.file);
      }
    } else removeTurns.add(s.turnIdx);
  }
  const resultTokens = i => (i + 1 < T.length ? Math.max(0, T[i + 1].in - T[i].in - T[i].out) : 0);
  const newTurns = []; let shift = 0;
  for (let i = 0; i < T.length; i++) {
    if (removeTurns.has(i)) { shift -= (T[i].out + resultTokens(i)); continue; }
    const nin = Math.max(0, Math.round(T[i].in + shift));
    newTurns.push({ in: nin, cached: Math.min(T[i].cached, nin), out: T[i].out });
    shift += (extraAt.get(i) || 0);
  }
  return newTurns;
}
const loaded = [];
for (const r of rows.filter(x => x.arm === ARM)) {
  const fs2 = rolloutFiles(r.taskId, r.arm); if (!fs2.length) continue;
  const gold = goldenFor(r.taskId); const price = priceFor(r.model);
  let best = null;
  for (const f of fs2) {
    const ev = parseRollout(f);
    const T = ev.filter(e => e.kind === 'turn').map(e => ({ in: e.in, cached: e.cached, out: e.out }));
    if (!T.length) continue;
    const c = costFromTurns(T, price);
    const d = Math.abs(c.idealUsd - (r.idealCostUsd ?? 0));
    if (!best || d < best.d) best = { ev, T, c, d };
  }
  if (!best) continue;
  const seq = []; let ti = -1;
  for (const e of best.ev) { if (e.kind === 'turn') ti++; else if (e.kind === 'call') seq.push({ turnIdx: Math.max(0, ti), read: parseSsRead(e.cmd) }); }
  const meta = new Map();
  for (const s of seq) {
    if (!s.read || meta.has(s.read.file)) continue;
    const rel = s.read.file.replace(/^\.?\//, '');
    let abs = gold ? path.join(gold, rel) : null;
    if (abs && !existsSync(abs)) { const alt = rel.split('/').slice(1).join('/'); if (alt && existsSync(path.join(gold, alt))) abs = path.join(gold, alt); }
    if (!abs || !existsSync(abs) || !statSync(abs).isFile()) continue;
    const txt = readFileSync(abs, 'utf8');
    const lines = txt.split('\n').length;
    meta.set(s.read.file, { lines, wholeTokens: (txt.length + lines * 5) / BPT });
  }
  loaded.push({ task: r.taskId, price, T: best.T, seq, meta, base: best.c.idealUsd });
}

const FRACS = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60];
const CAPS = [350, 400, 500, 600, 800, 1000, 1500];
const CFG = [];
for (const c of CAPS) for (const f of FRACS) CFG.push({ f, c });

// per-task {base, new} for every configuration -- the bootstrap resamples TASKS
const tasks = [...new Set(loaded.map(l => l.task))];
const perTask = new Map();      // task -> {base, byCfg:[usd]}
for (const t of tasks) perTask.set(t, { base: 0, byCfg: CFG.map(() => 0) });
for (const L of loaded) {
  const e = perTask.get(L.task);
  e.base += L.base;
  CFG.forEach((cfg, i) => { e.byCfg[i] += costFromTurns(replaySpanGated(L.T, L.seq, L.meta, cfg.f, cfg.c), L.price).idealUsd; });
}

const deltaFor = (sample, i) => {
  let b = 0, n = 0;
  for (const t of sample) { const e = perTask.get(t); b += e.base; n += e.byCfg[i]; }
  return (n / b - 1) * 100;
};
const point = CFG.map((_, i) => deltaFor(tasks, i));
const bestI = point.indexOf(Math.min(...point));

// paired bootstrap over tasks, fixed seed
let seed = 20260814;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const B = 5000;
const draws = CFG.map(() => []);
const diffToBest = CFG.map(() => []);
for (let b = 0; b < B; b++) {
  const sample = Array.from({ length: tasks.length }, () => tasks[Math.floor(rnd() * tasks.length)]);
  const ds = CFG.map((_, i) => deltaFor(sample, i));
  ds.forEach((d, i) => { draws[i].push(d); diffToBest[i].push(d - ds[bestI]); });
}
const sd = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };

console.log(`=== C-4: is the argmax identified? ===`);
console.log(`${tasks.length} tasks, ${loaded.length} rollouts, ${CFG.length} configurations, ${B} bootstrap resamples over TASKS\n`);
const seBest = sd(draws[bestI]);
console.log(`best configuration      : frac>=${CFG[bestI].f} cap<=${CFG[bestI].c}  at ${point[bestI].toFixed(2)}%`);
console.log(`its bootstrap SE        : ${seBest.toFixed(2)} percentage points`);
console.log(`one-standard-error band : ${(point[bestI] + seBest).toFixed(2)}% or better\n`);

const within1se = CFG.map((c, i) => ({ ...c, d: point[i], i })).filter(x => x.d <= point[bestI] + seBest);
console.log(`configurations inside the 1-SE band : ${within1se.length} of ${CFG.length}`);
console.log(`  frac range ${Math.min(...within1se.map(x => x.f))} .. ${Math.max(...within1se.map(x => x.f))}`);
console.log(`  cap  range ${Math.min(...within1se.map(x => x.c))} .. ${Math.max(...within1se.map(x => x.c))}`);

const shipIdx = CFG.findIndex(c => c.f === 0.40 && c.c === 400);
const altIdx = CFG.findIndex(c => c.f === 0.35 && c.c === 400);
const midIdx = CFG.findIndex(c => c.f === 0.30 && c.c === 600);
for (const [name, i] of [['argmax (0.35,400)', altIdx], ['shipped (0.40,400)', shipIdx], ['plateau interior (0.30,600)', midIdx]]) {
  if (i < 0) continue;
  const dd = diffToBest[i];
  const worse = dd.filter(x => x > 0).length / B;
  console.log(`\n${name.padEnd(30)} point ${point[i].toFixed(2)}%   vs best: mean ${(dd.reduce((a, b) => a + b, 0) / B).toFixed(3)}pp, SE ${sd(dd).toFixed(3)}pp`);
  console.log(`${''.padEnd(30)} P(this config is worse than the best-on-full-data) = ${(worse * 100).toFixed(1)}%`);
}

// how often is each configuration the argmax across bootstrap resamples?
const wins = CFG.map(() => 0);
seed = 20260814;
for (let b = 0; b < B; b++) {
  const sample = Array.from({ length: tasks.length }, () => tasks[Math.floor(rnd() * tasks.length)]);
  const ds = CFG.map((_, i) => deltaFor(sample, i));
  wins[ds.indexOf(Math.min(...ds))]++;
}
const rank = CFG.map((c, i) => ({ ...c, w: wins[i] })).sort((a, b) => b.w - a.w);
console.log(`\n=== how often is each configuration the winner across ${B} resamples? ===`);
for (const r of rank.slice(0, 10)) console.log(`  ${(r.w / B * 100).toFixed(1).padStart(5)}%   frac>=${r.f} cap<=${r.c}`);
console.log(`\nconfigurations that win at least once: ${rank.filter(r => r.w > 0).length} of ${CFG.length}`);

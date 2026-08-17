// C-4 HYPERPARAMETER PROVENANCE — is (span>=0.40, <=400 lines) an optimum or a grid edge?
//
// The original sweep was 3 x 3: minFrac {0.2,0.4,0.6} x maxLines {400,600,1500}. 400 is the
// SMALLEST cap tested, so the reported optimum sits ON the boundary of the searched region.
// That is the classic sign of a parameter that was not actually optimised.
//
// This maps the full surface, finer and wider, and then asks the only question that matters
// for shipping: is the good region a PLATEAU (the mechanism is real and the constants barely
// matter) or a SPIKE (the constants are fitted to 34 rollouts and will not transfer)?
//
// Plus leave-one-task-out: if one task moves the argmax, the constants are that task's.
// Read-only. No model.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { costFromTurns, priceFor } from '/root/sweet-search-private/eval/task-completion-bench/harness/ideal-cost.mjs';

const RUN = process.argv[2] || 'sb-codex-20260811';
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
  return { turns: newTurns, removed: removeTurns.size, injected: extraAt.size };
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

const FRACS = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60, 0.70, 0.80];
const CAPS = [100, 150, 200, 250, 300, 350, 400, 500, 600, 800, 1000, 1500, 3000];

function evalCfg(subset, minFrac, maxLines) {
  let tot = 0, base = 0, removed = 0, injected = 0;
  for (const L of subset) {
    const rp = replaySpanGated(L.T, L.seq, L.meta, minFrac, maxLines);
    tot += costFromTurns(rp.turns, L.price).idealUsd; base += L.base;
    removed += rp.removed; injected += rp.injected;
  }
  return { delta: (tot / base - 1) * 100, removed, injected };
}

console.log(`=== C-4 RESPONSE SURFACE — ${RUN} / ${ARM}, ${loaded.length} rollouts ===`);
console.log(`delta in % of the sweet arm's ideal cost. Negative = saving.`);
console.log(`The original grid searched only frac {0.20,0.40,0.60} x cap {400,600,1500}.\n`);

process.stdout.write('cap\\frac'.padEnd(9));
for (const f of FRACS) process.stdout.write(String(f.toFixed(2)).padStart(7));
console.log();
const grid = new Map();
for (const c of CAPS) {
  process.stdout.write(String(c).padEnd(9));
  for (const f of FRACS) {
    const r = evalCfg(loaded, f, c);
    grid.set(`${f}|${c}`, r.delta);
    process.stdout.write((r.delta >= 0 ? '+' : '') + r.delta.toFixed(2).padStart(6));
  }
  console.log();
}

const entries = [...grid].map(([k, v]) => ({ f: +k.split('|')[0], c: +k.split('|')[1], d: v }));
entries.sort((a, b) => a.d - b.d);
console.log(`\nBEST : frac>=${entries[0].f} cap<=${entries[0].c} at ${entries[0].d.toFixed(2)}%`);
console.log(`ORIGINAL SHIPPED CHOICE: frac>=0.40 cap<=400 at ${grid.get('0.4|400').toFixed(2)}%`);
console.log(`WORST: frac>=${entries[entries.length - 1].f} cap<=${entries[entries.length - 1].c} at ${entries[entries.length - 1].d.toFixed(2)}%`);

const negatives = entries.filter(e => e.d < 0);
console.log(`\nconfigurations that SAVE money : ${negatives.length} of ${entries.length}`);
console.log(`configurations that LOSE money : ${entries.length - negatives.length}`);
const within = entries.filter(e => e.d <= entries[0].d + 0.25);
console.log(`within 0.25pp of the best      : ${within.length}  -> ${within.length > 8 ? 'PLATEAU' : 'SPIKE'}`);
console.log(`  frac range in that region: ${Math.min(...within.map(e => e.f))} .. ${Math.max(...within.map(e => e.f))}`);
console.log(`  cap  range in that region: ${Math.min(...within.map(e => e.c))} .. ${Math.max(...within.map(e => e.c))}`);

// --- leave-one-task-out: whose constants are these? ---
console.log('\n\n=== LEAVE-ONE-TASK-OUT: is the argmax one task\'s preference? ===\n');
const tasks = [...new Set(loaded.map(l => l.task))];
const argmaxes = new Map();
for (const t of tasks) {
  const sub = loaded.filter(l => l.task !== t);
  let best = null;
  for (const c of CAPS) for (const f of FRACS) {
    const d = evalCfg(sub, f, c).delta;
    if (!best || d < best.d) best = { f, c, d };
  }
  const shipped = evalCfg(sub, 0.40, 400).delta;
  argmaxes.set(t, best);
  console.log(`  drop ${t.padEnd(42)} argmax=(${best.f}, ${best.c}) ${best.d.toFixed(2)}%   shipped(0.40,400)=${shipped.toFixed(2)}%   gap=${(shipped - best.d).toFixed(2)}pp`);
}
const distinct = new Set([...argmaxes.values()].map(v => `${v.f}|${v.c}`));
console.log(`\ndistinct argmax configurations across ${tasks.length} leave-one-out folds: ${distinct.size}`);
console.log(`  ${[...distinct].join('   ')}`);

// --- how much of the effect is the single heaviest task? ---
console.log('\n=== per-task contribution at the SHIPPED configuration (0.40, 400) ===\n');
const contrib = [];
for (const L of loaded) {
  const rp = replaySpanGated(L.T, L.seq, L.meta, 0.40, 400);
  const nu = costFromTurns(rp.turns, L.price).idealUsd;
  if (Math.abs(nu - L.base) > 1e-9) contrib.push({ task: L.task, d: nu - L.base, removed: rp.removed });
}
const totalSave = contrib.reduce((a, x) => a + x.d, 0);
for (const x of contrib.sort((a, b) => a.d - b.d)) {
  console.log(`  ${x.d >= 0 ? '+' : ''}$${x.d.toFixed(6)}  ${(x.d / totalSave * 100).toFixed(0).padStart(4)}% of net   removed=${x.removed}  ${x.task}`);
}

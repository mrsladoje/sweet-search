// GATE 2 REDO — C-4 under a VARIANT SWEEP, not a single policy.
//
// The first pass tested one mechanism ("whole file on first touch, <= N lines") across five
// thresholds. That policy pays the carrying cost on files that are read ONCE and never re-read,
// which is pure loss. Four policies are swept here, each over its own parameter:
//
//   P1 first-touch      whole file on the first read of a file <= N lines            (as specified)
//   P2 second-touch     serve the whole file only on the FIRST RE-READ; the third and later
//                       reads of that file are then removed. Single-read files cost nothing.
//   P3 span-gated       expand on first touch only when the requested span already covers >= F
//                       of the file, so the marginal injection is small
//   P4 window           expand the requested span by +/- K lines instead of to the whole file
//
// Same measured-token accounting as before: tool-result tokens of request k are
// T(k+1) - T(k) - out(k), read off the recorded turn sequence.
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

/** One rollout's replay under a policy. Returns {base, replayed}. */
function replay(T, seq, meta, policy) {
  const touches = new Map();      // file -> count so far
  const servedWhole = new Set();
  const extraAt = new Map(), removeTurns = new Set();
  for (const s of seq) {
    if (!s.read) continue;
    const m = meta.get(s.read.file); if (!m) continue;             // file not resolvable
    const { lines, wholeTokens } = m;
    const n = (touches.get(s.read.file) || 0) + 1;
    touches.set(s.read.file, n);
    const a = s.read.a ?? 1, b = s.read.b ?? lines;
    const spanFrac = Math.min(1, Math.max(0, (b - a + 1) / Math.max(1, lines)));
    const addWhole = () => {
      extraAt.set(s.turnIdx, (extraAt.get(s.turnIdx) || 0) + Math.max(0, wholeTokens * (1 - spanFrac)));
      servedWhole.add(s.read.file);
    };
    if (policy.kind === 'first') {
      if (lines > policy.maxLines) continue;
      if (!servedWhole.has(s.read.file)) addWhole(); else removeTurns.add(s.turnIdx);
    } else if (policy.kind === 'second') {
      if (lines > policy.maxLines) continue;
      if (n === 1) continue;                                       // first read served as asked
      if (!servedWhole.has(s.read.file)) addWhole(); else removeTurns.add(s.turnIdx);
    } else if (policy.kind === 'spanGated') {
      if (lines > policy.maxLines) continue;
      if (!servedWhole.has(s.read.file)) { if (spanFrac >= policy.minFrac) addWhole(); }
      else removeTurns.add(s.turnIdx);
    } else if (policy.kind === 'window') {
      // widen by +/- K lines; a later read is removed only if its span falls inside a window
      const lo = Math.max(1, a - policy.k), hi = Math.min(lines, b + policy.k);
      const prev = servedWhole.has(s.read.file) ? touches.get('__win__' + s.read.file) : null;
      if (prev && a >= prev[0] && b <= prev[1]) { removeTurns.add(s.turnIdx); continue; }
      const addTokens = wholeTokens * Math.max(0, (hi - lo + 1) / Math.max(1, lines) - spanFrac);
      extraAt.set(s.turnIdx, (extraAt.get(s.turnIdx) || 0) + addTokens);
      servedWhole.add(s.read.file);
      touches.set('__win__' + s.read.file, [lo, hi]);
    }
  }
  const resultTokens = i => (i + 1 < T.length ? Math.max(0, T[i + 1].in - T[i].in - T[i].out) : 0);
  const newTurns = []; let shift = 0;
  for (let i = 0; i < T.length; i++) {
    if (removeTurns.has(i)) { shift -= (T[i].out + resultTokens(i)); continue; }
    const nin = Math.max(0, Math.round(T[i].in + shift));
    newTurns.push({ in: nin, cached: Math.min(T[i].cached, nin), out: T[i].out });
    shift += (extraAt.get(i) || 0);
  }
  return { turns: newTurns, removed: removeTurns.size, extra: [...extraAt.values()].reduce((a, b) => a + b, 0) };
}

// preload each rollout once
const loaded = [];
for (const r of rows.filter(x => x.arm === ARM)) {
  const fs2 = rolloutFiles(r.taskId, r.arm); if (!fs2.length) continue;
  const gold = goldenFor(r.taskId);
  const price = priceFor(r.model);
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
  loaded.push({ r, price, T: best.T, seq, meta, base: best.c.idealUsd });
}

const POLICIES = [];
for (const n of [200, 300, 400, 600, 900, 1500, 1e9]) POLICIES.push({ label: `P1 first-touch <=${n === 1e9 ? 'inf' : n}`, kind: 'first', maxLines: n });
for (const n of [200, 300, 400, 600, 900, 1500, 1e9]) POLICIES.push({ label: `P2 second-touch <=${n === 1e9 ? 'inf' : n}`, kind: 'second', maxLines: n });
for (const f of [0.2, 0.4, 0.6]) for (const n of [400, 600, 1500]) POLICIES.push({ label: `P3 span>=${f} <=${n}`, kind: 'spanGated', maxLines: n, minFrac: f });
for (const k of [25, 50, 100, 200]) POLICIES.push({ label: `P4 window +/-${k}`, kind: 'window', k });

const baseTotal = loaded.reduce((a, x) => a + x.base, 0);
console.log(`=== C-4 VARIANT SWEEP — ${RUN} / ${ARM}, ${loaded.length} rollouts, baseline $${baseTotal.toFixed(6)} ===`);
console.log(`bar: replayed billed cost must fall >= 5%\n`);
const out = [];
for (const p of POLICIES) {
  let tot = 0, removed = 0, extra = 0;
  for (const L of loaded) {
    const rp = replay(L.T, L.seq, L.meta, p);
    tot += costFromTurns(rp.turns, L.price).idealUsd; removed += rp.removed; extra += rp.extra;
  }
  out.push({ label: p.label, delta: (tot / baseTotal - 1) * 100, removed, extra: Math.round(extra), total: tot });
}
out.sort((a, b) => a.delta - b.delta);
for (const o of out) {
  const flag = o.delta <= -5 ? ' <== CLEARS BAR' : '';
  console.log(`${o.label.padEnd(26)} $${o.total.toFixed(6)}  ${o.delta >= 0 ? '+' : ''}${o.delta.toFixed(2)}%   removed=${String(o.removed).padStart(2)} extraTok=${String(o.extra).padStart(6)}${flag}`);
}
console.log(`\nBEST: ${out[0].label} at ${out[0].delta.toFixed(2)}%  ->  ${out[0].delta <= -5 ? 'PASSES' : 'MISSES'} the -5% bar`);

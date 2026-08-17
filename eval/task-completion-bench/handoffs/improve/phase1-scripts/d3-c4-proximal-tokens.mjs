// DOCTRINE §10 — C-4's proximal metric, stated in the unit the doctrine names:
// CUMULATIVE BILLED INPUT TOKENS across the whole rollout, not lines fetched once.
//
// This script exists to put a number on the trap. It reports, for the same policy:
//
//   (A) NAIVE  — tokens in the read-results that the policy removes, counted ONCE.
//                This is "lines fetched once" and it is the wrong metric.
//   (B) TRUE   — cumulative billed input tokens over the replayed turn sequence, where
//                every token injected early is re-sent on every later turn and every
//                removed turn stops being re-sent.
//
// The ratio A/B is how far a naive proximal metric would have overstated C-4.
// Codex sweet arm: the harness whose per-turn token accounting is exact in the rollout log.
// Read-only, no model.
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
const CONTROL = new Set(['epiforecasts__scoringutils-229', 'oceanparcels__parcels-617',
  'ontodev__robot-710', 'redboltz__mqtt_cpp-466', 'statamic__cms-9029']);

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
const POLICY = { kind: 'spanGated', maxLines: 400, minFrac: 0.4, label: 'P3 span>=0.4 <=400' };

/** Replay. Returns billed-input-token totals under both accountings. */
function replay(T, seq, meta, policy) {
  const touches = new Map(); const servedWhole = new Set();
  const extraAt = new Map(), removeTurns = new Set();
  for (const s of seq) {
    if (!s.read) continue;
    const m = meta.get(s.read.file); if (!m) continue;
    const { lines, wholeTokens } = m;
    const n = (touches.get(s.read.file) || 0) + 1; touches.set(s.read.file, n);
    const a = s.read.a ?? 1, b = s.read.b ?? lines;
    const spanFrac = Math.min(1, Math.max(0, (b - a + 1) / Math.max(1, lines)));
    if (lines > policy.maxLines) continue;
    if (!servedWhole.has(s.read.file)) {
      if (spanFrac >= policy.minFrac) {
        extraAt.set(s.turnIdx, (extraAt.get(s.turnIdx) || 0) + Math.max(0, wholeTokens * (1 - spanFrac)));
        servedWhole.add(s.read.file);
      }
    } else removeTurns.add(s.turnIdx);
  }
  const resultTokens = i => (i + 1 < T.length ? Math.max(0, T[i + 1].in - T[i].in - T[i].out) : 0);

  // (A) NAIVE: the read-results this policy deletes, counted ONCE, minus the injection, once.
  let naiveRemovedOnce = 0;
  for (const i of removeTurns) naiveRemovedOnce += resultTokens(i);
  const naiveInjectedOnce = [...extraAt.values()].reduce((a, b) => a + b, 0);

  // (B) TRUE: cumulative billed input over the replayed sequence.
  const newTurns = []; let shift = 0;
  for (let i = 0; i < T.length; i++) {
    if (removeTurns.has(i)) { shift -= (T[i].out + resultTokens(i)); continue; }
    const nin = Math.max(0, Math.round(T[i].in + shift));
    newTurns.push({ in: nin, cached: Math.min(T[i].cached, nin), out: T[i].out });
    shift += (extraAt.get(i) || 0);
  }
  const billedBase = T.reduce((a, t) => a + t.in, 0);
  const billedNew = newTurns.reduce((a, t) => a + t.in, 0);
  return { turns: newTurns, billedBase, billedNew, naiveRemovedOnce, naiveInjectedOnce,
    removed: removeTurns.size, injectedSites: extraAt.size };
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
  loaded.push({ r, price, T: best.T, seq, meta, base: best.c.idealUsd });
}

console.log(`=== C-4 PROXIMAL METRIC — ${RUN} / ${ARM}, ${loaded.length} rollouts ===`);
console.log(`policy: ${POLICY.label}\n`);

let bBase = 0, bNew = 0, naiveRem = 0, naiveInj = 0, dBase = 0, dNew = 0;
let ctlBase = 0, ctlNew = 0, ctlDollarBase = 0, ctlDollarNew = 0, touched = 0;
const rowsOut = [];
for (const L of loaded) {
  const rp = replay(L.T, L.seq, L.meta, POLICY);
  const newUsd = costFromTurns(rp.turns, L.price).idealUsd;
  bBase += rp.billedBase; bNew += rp.billedNew;
  naiveRem += rp.naiveRemovedOnce; naiveInj += rp.naiveInjectedOnce;
  dBase += L.base; dNew += newUsd;
  if (rp.removed || rp.injectedSites) touched++;
  if (CONTROL.has(L.r.taskId)) {
    ctlBase += rp.billedBase; ctlNew += rp.billedNew;
    ctlDollarBase += L.base; ctlDollarNew += newUsd;
  }
  if (rp.removed || rp.injectedSites) {
    rowsOut.push({ task: L.r.taskId, rep: L.r.rep, removed: rp.removed, inj: rp.injectedSites,
      dBilled: rp.billedNew - rp.billedBase, dUsd: newUsd - L.base, ctl: CONTROL.has(L.r.taskId) });
  }
}

const pct = (a, b) => ((a / b - 1) * 100).toFixed(2);
console.log('--- (A) the NAIVE metric: content counted once ---');
console.log(`   read-result tokens removed, counted once : ${Math.round(naiveRem).toLocaleString()}`);
console.log(`   whole-file tokens injected, counted once : ${Math.round(naiveInj).toLocaleString()}`);
console.log(`   naive net saving                         : ${Math.round(naiveRem - naiveInj).toLocaleString()} tokens`);
console.log(`   as a share of baseline billed input      : ${(-(naiveRem - naiveInj) / bBase * 100).toFixed(2)}%`);

console.log('\n--- (B) the TRUE metric: cumulative billed input tokens ---');
console.log(`   baseline billed input : ${Math.round(bBase).toLocaleString()}`);
console.log(`   replayed billed input : ${Math.round(bNew).toLocaleString()}`);
console.log(`   delta                 : ${Math.round(bNew - bBase).toLocaleString()} tokens  (${pct(bNew, bBase)}%)`);

const naiveNet = naiveRem - naiveInj, trueNet = bBase - bNew;
console.log(`\n--- THE TRAP, quantified ---`);
console.log(`   naive says you save ${Math.round(naiveNet).toLocaleString()} tokens; the true saving is ${Math.round(trueNet).toLocaleString()}.`);
console.log(`   overstatement factor A/B = ${(naiveNet / trueNet).toFixed(2)}x`);
console.log(`   (the naive number ignores that a removed read stops being re-sent on EVERY later`);
console.log(`    turn, and that an early injection is re-sent on every later turn too.)`);

console.log(`\n--- CONVERSION ARITHMETIC: proximal tokens -> dollars ---`);
console.log(`   baseline ideal cost : $${dBase.toFixed(6)}`);
console.log(`   replayed ideal cost : $${dNew.toFixed(6)}   (${pct(dNew, dBase)}%)`);
console.log(`   implied $ per 1k billed input tokens saved : $${((dBase - dNew) / (trueNet / 1000)).toFixed(6)}`);
console.log(`   rollouts touched : ${touched} / ${loaded.length}`);

console.log(`\n--- CONTROL SET (5 tasks, sweet 2/2 both arms all harnesses) ---`);
console.log(`   control billed input  ${Math.round(ctlBase).toLocaleString()} -> ${Math.round(ctlNew).toLocaleString()}  (${pct(ctlNew, ctlBase)}%)`);
console.log(`   control ideal cost    $${ctlDollarBase.toFixed(6)} -> $${ctlDollarNew.toFixed(6)}  (${pct(ctlDollarNew, ctlDollarBase)}%)`);
console.log(`   NOTE: cost only. A replay cannot show whether the injected context costs a solve.`);

console.log(`\n--- per-rollout detail (touched only) ---`);
for (const o of rowsOut.sort((a, b) => a.dUsd - b.dUsd)) {
  console.log(`   ${o.ctl ? 'CTL ' : '    '}${o.task.padEnd(42)} r${o.rep}  removed=${o.removed} inj=${o.inj}  billed ${o.dBilled >= 0 ? '+' : ''}${Math.round(o.dBilled).toLocaleString().padStart(8)}  $${o.dUsd >= 0 ? '+' : ''}${o.dUsd.toFixed(6)}`);
}

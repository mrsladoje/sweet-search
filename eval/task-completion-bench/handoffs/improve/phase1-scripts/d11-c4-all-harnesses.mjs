// C-4 RESPONSE SURFACE ON ALL THREE HARNESSES — and the held-out test the constants never had.
//
// The constants were fitted on Codex alone. OpenCode and Claude are independent corpora that
// already exist. This replays the same span-gated policy on all three, then does the thing
// CLAUDE.md's methodology rule requires and this lever never got:
//
//   fit on one harness, report the chosen configuration on the other two WITHOUT re-tuning.
//
// Turn/call attribution is EXACT on every harness -- each tool call is mapped to the request
// that issued it by message id, not by log adjacency. Codex is additionally computed under the
// original script's adjacency convention so the two can be compared.
//
// Read-only, $0, no model.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { costFromTurns, priceFor } from '/root/sweet-search-private/eval/task-completion-bench/harness/ideal-cost.mjs';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const GOLDEN = '/root/.ss-eval/golden';
const HARNESSES = [
  ['codex', 'sb-codex-20260811'],
  ['opencode', 'sb-opencode-20260811'],
  ['claude', 'sb-claudecode-20260811'],
];
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
const walkFiles = (d, pred) => {
  const out = [];
  const rec = (dd, depth = 0) => {
    if (depth > 10) return;
    let es; try { es = readdirSync(dd, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(dd, e.name); if (e.isDirectory()) rec(p, depth + 1); else if (pred(p)) out.push(p); }
  };
  rec(d); return out.sort();
};
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
  // BENCH WRAPPER SEMANTICS (eval/agent-read-workflows/bin/_ss-helpers.mjs:523).
  // `ss-read f 100` is a SINGLE LINE, not start-to-EOF -- the wrapper sets end=start.
  // Treating it as start-to-EOF inflates the covered fraction and makes the span gate
  // look like it fires far more often than it does. 176 of 1000 recorded calls take
  // this form, so the error is material, not cosmetic.
  if (a != null && b == null) b = a;
  // `ss-read f 40 30` is read as start+count by the wrapper, not an inverted range.
  if (a != null && b != null && b < a) b = a + b - 1;
  return file ? { file, a, b } : null;
}
// a single ss-read command may chain several reads with &&
function parseAllSsReads(cmd) {
  const out = [];
  for (const part of String(cmd).split(/&&|;/)) { const r = parseSsRead(part); if (r) out.push(r); }
  return out;
}

// ---------------------------------------------------------------- loaders
function loadCodex(run, taskId, adjacency = false) {
  const files = walkFiles(path.join(RESULTS, run, 'agent-state', `${taskId}-sweet`, 'codex-home', 'sessions'), p => p.endsWith('.jsonl'));
  const cands = [];
  for (const f of files) {
    const ev = [];
    for (const line of readFileSync(f, 'utf8').split('\n')) {
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
    const T = ev.filter(e => e.kind === 'turn').map(e => ({ in: e.in, cached: e.cached, out: e.out }));
    if (!T.length) continue;
    const seq = []; let ti = -1;
    for (const e of ev) {
      if (e.kind === 'turn') { ti++; continue; }
      // EXACT: a codex function_call is logged BEFORE its own token_count, so the request that
      // issued it is ti+1. ADJACENCY: the original script attributed it to ti.
      const idx = adjacency ? Math.max(0, ti) : Math.min(T.length - 1, ti + 1);
      for (const r of parseAllSsReads(e.cmd)) seq.push({ turnIdx: idx, read: r });
    }
    cands.push({ T, seq });
  }
  return cands;
}

function loadOpencode(run, taskId) {
  const files = walkFiles(path.join(RESULTS, run, 'agent-state', `${taskId}-sweet`, 'opencode-retained'), p => p.endsWith('attempt-1.stdout.ndjson'));
  const cands = [];
  for (const f of files) {
    const steps = [], calls = [];
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let o; try { o = JSON.parse(t); } catch { continue; }
      if (o.type === 'step_finish') {
        const tk = o.part?.tokens; if (!tk) continue;
        const cr = tk.cache?.read || 0, cw = tk.cache?.write || 0;
        steps.push({ msg: o.part?.messageID, in: (tk.input || 0) + cr + cw, cached: cr,
          out: (tk.output || 0) + (tk.reasoning || 0) });
      } else if (o.type === 'tool_use' && o.part?.tool === 'bash') {
        const cmd = o.part?.state?.input?.command; if (cmd) calls.push({ msg: o.part?.messageID, cmd: String(cmd) });
      }
    }
    if (!steps.length) continue;
    const T = steps.map(s => ({ in: s.in, cached: s.cached, out: s.out }));
    const idxOf = new Map(steps.map((s, i) => [s.msg, i]));
    const seq = [];
    for (const c of calls) {
      const i = idxOf.has(c.msg) ? idxOf.get(c.msg) : null;
      if (i == null) continue;
      for (const r of parseAllSsReads(c.cmd)) seq.push({ turnIdx: i, read: r });
    }
    cands.push({ T, seq });
  }
  return cands;
}

function loadClaude(run, taskId) {
  const files = walkFiles(path.join(RESULTS, run, 'agent-state', `${taskId}-sweet`, 'claude-home', 'projects'), p => p.endsWith('.jsonl'))
    .filter(p => !p.includes('/subagents/'));
  const cands = [];
  for (const f of files) {
    const order = [], byId = new Map();
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let o; try { o = JSON.parse(t); } catch { continue; }
      const m = o.message; if (!m || m.role !== 'assistant' || !m.id) continue;
      if (!byId.has(m.id)) { byId.set(m.id, { usage: null, cmds: [] }); order.push(m.id); }
      const e = byId.get(m.id);
      if (m.usage && (m.usage.input_tokens != null)) e.usage = m.usage;
      for (const b of (m.content || [])) {
        if (b.type === 'tool_use' && b.name === 'Bash' && b.input?.command) e.cmds.push(String(b.input.command));
      }
    }
    if (!order.length) continue;
    const T = order.map(id => {
      const u = byId.get(id).usage || {};
      const cr = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
      return { in: (u.input_tokens || 0) + cr + cw, cached: cr, out: u.output_tokens || 0 };
    });
    const seq = [];
    order.forEach((id, i) => {
      for (const cmd of byId.get(id).cmds) for (const r of parseAllSsReads(cmd)) seq.push({ turnIdx: i, read: r });
    });
    cands.push({ T, seq });
  }
  return cands;
}

const BPT = 3.5;
function buildMeta(seq, gold) {
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
  return meta;
}
function replay(T, seq, meta, minFrac, maxLines) {
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

// ---------------------------------------------------------------- load all
const FRACS = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60];
const CAPS = [300, 350, 400, 500, 600, 800, 1000, 1500];
const CFG = []; for (const c of CAPS) for (const f of FRACS) CFG.push({ f, c });
const key = c => `${c.f}/${c.c}`;

const perHarness = {};
for (const [h, run] of HARNESSES) {
  const rows = JSON.parse(readFileSync(path.join(RESULTS, run, 'rows.json'), 'utf8')).filter(r => r.arm === 'sweet');
  const loaded = [];
  for (const r of rows) {
    let cands = [];
    try {
      cands = (h === 'codex' ? loadCodex(run, r.taskId) : h === 'opencode' ? loadOpencode(run, r.taskId) : loadClaude(run, r.taskId)) || [];
    } catch { cands = []; }
    cands = cands.filter(c => c.T.length);
    if (!cands.length) continue;
    let price; try { price = priceFor(r.model); } catch { continue; }
    // SELECTION RULE, same as the validated v2-c4-variants.mjs: take the transcript whose
    // replayed ideal cost is closest to the recorded row. Longest-transcript selection picks
    // up retried/aborted sessions and inflates the baseline by 7-18%.
    let d = null, bd = Infinity;
    for (const c of cands) {
      const gap = Math.abs(costFromTurns(c.T, price).idealUsd - (r.idealCostUsd ?? 0));
      if (gap < bd) { bd = gap; d = c; }
    }
    const meta = buildMeta(d.seq, goldenFor(r.taskId));
    loaded.push({ task: r.taskId, price, T: d.T, seq: d.seq, meta,
      base: costFromTurns(d.T, price).idealUsd, recorded: r.idealCostUsd });
  }
  perHarness[h] = loaded;
  const base = loaded.reduce((a, x) => a + x.base, 0);
  const rec = loaded.reduce((a, x) => a + (x.recorded || 0), 0);
  const reads = loaded.reduce((a, x) => a + x.seq.length, 0);
  const resolved = loaded.reduce((a, x) => a + x.seq.filter(s => x.meta.has(s.read.file)).length, 0);
  console.log(`${h.padEnd(9)} rollouts=${String(loaded.length).padStart(2)}  baseline $${base.toFixed(6)}  recorded $${rec.toFixed(6)}  reproduction ${(base / rec * 100).toFixed(1)}%   ss-read calls=${reads} (resolved ${resolved})`);
}

// codex convention check
{
  const rows = JSON.parse(readFileSync(path.join(RESULTS, 'sb-codex-20260811', 'rows.json'), 'utf8')).filter(r => r.arm === 'sweet');
  let b = 0, n = 0;
  for (const r of rows) {
    const cs = (loadCodex('sb-codex-20260811', r.taskId, true) || []).filter(c => c.T.length); if (!cs.length) continue;
    let price; try { price = priceFor(r.model); } catch { continue; }
    let d = null, bd = Infinity;
    for (const c of cs) { const gap = Math.abs(costFromTurns(c.T, price).idealUsd - (r.idealCostUsd ?? 0)); if (gap < bd) { bd = gap; d = c; } }
    const meta = buildMeta(d.seq, goldenFor(r.taskId));
    b += costFromTurns(d.T, price).idealUsd;
    n += costFromTurns(replay(d.T, d.seq, meta, 0.40, 400), price).idealUsd;
  }
  console.log(`\ncodex under the ORIGINAL adjacency convention at (0.40,400): ${((n / b - 1) * 100).toFixed(2)}%   [the recorded figure was -2.69%]`);
}

function surface(loaded) {
  const base = loaded.reduce((a, x) => a + x.base, 0);
  const m = new Map();
  for (const c of CFG) {
    let tot = 0;
    for (const L of loaded) tot += costFromTurns(replay(L.T, L.seq, L.meta, c.f, c.c), L.price).idealUsd;
    m.set(key(c), (tot / base - 1) * 100);
  }
  return m;
}
const S = {};
for (const [h] of HARNESSES) S[h] = surface(perHarness[h]);

console.log('\n\n=== PER-HARNESS SURFACE, exact attribution (delta %, negative = saving) ===');
for (const [h] of HARNESSES) {
  console.log(`\n-- ${h} --`);
  process.stdout.write('cap\\frac'.padEnd(9));
  for (const f of FRACS) process.stdout.write(f.toFixed(2).padStart(7));
  console.log();
  for (const c of CAPS) {
    process.stdout.write(String(c).padEnd(9));
    for (const f of FRACS) { const v = S[h].get(`${f}/${c}`); process.stdout.write((v >= 0 ? '+' : '') + v.toFixed(2).padStart(6)); }
    console.log();
  }
  const arr = [...S[h]].sort((a, b) => a[1] - b[1]);
  console.log(`   best ${arr[0][0]} at ${arr[0][1].toFixed(2)}%   |   saves on ${[...S[h].values()].filter(v => v < 0).length}/${CFG.length} configs`);
}

// ---------------------------------------------------------------- held-out
console.log('\n\n=== HELD-OUT TEST: fit on one harness, report on the other two, no re-tuning ===\n');
for (const [h] of HARNESSES) {
  const arr = [...S[h]].sort((a, b) => a[1] - b[1]);
  const chosen = arr[0][0];
  const others = HARNESSES.map(x => x[0]).filter(x => x !== h);
  const oth = others.map(o => {
    const v = S[o].get(chosen);
    const bestO = Math.min(...S[o].values());
    return `${o} ${v.toFixed(2)}% (best there ${bestO.toFixed(2)}%, gap ${(v - bestO).toFixed(2)}pp)`;
  });
  console.log(`  fit on ${h.padEnd(9)} -> ${chosen.padEnd(10)} ${arr[0][1].toFixed(2)}%   held out: ${oth.join('   ')}`);
}

// ---------------------------------------------------------------- one default
console.log('\n\n=== ONE DEFAULT FOR ALL THREE: rank every configuration by its WORST harness ===\n');
const scored = CFG.map(c => {
  const v = HARNESSES.map(([h]) => S[h].get(key(c)));
  return { c, v, worst: Math.max(...v), mean: v.reduce((a, b) => a + b, 0) / v.length,
    allSave: v.every(x => x < 0) };
});
scored.sort((a, b) => a.worst - b.worst);
console.log(`  ${'config'.padEnd(11)} ${'codex'.padStart(8)} ${'opencode'.padStart(9)} ${'claude'.padStart(8)}  ${'worst'.padStart(7)} ${'mean'.padStart(7)}  all3save`);
for (const s of scored.slice(0, 14)) {
  console.log(`  ${key(s.c).padEnd(11)} ${s.v.map(x => (x >= 0 ? '+' : '') + x.toFixed(2)).map(x => x.padStart(8)).join(' ')}  ${s.worst.toFixed(2).padStart(7)} ${s.mean.toFixed(2).padStart(7)}  ${s.allSave ? 'YES' : 'no'}`);
}
console.log(`\n  configurations that save on ALL THREE harnesses: ${scored.filter(s => s.allSave).length} of ${CFG.length}`);
const robust = scored.filter(s => s.allSave);
if (robust.length) {
  console.log(`  minimax choice (best worst-case): ${key(robust[0].c)}  worst harness ${robust[0].worst.toFixed(2)}%`);
  const byMean = [...robust].sort((a, b) => a.mean - b.mean);
  console.log(`  best mean among all-save      : ${key(byMean[0].c)}  mean ${byMean[0].mean.toFixed(2)}%  worst ${byMean[0].worst.toFixed(2)}%`);
  const fs = [...new Set(robust.map(r => r.c.f))].sort((a, b) => a - b);
  const cs = [...new Set(robust.map(r => r.c.c))].sort((a, b) => a - b);
  console.log(`  the all-three-save region: frac ${fs[0]}..${fs[fs.length - 1]}   cap ${cs[0]}..${cs[cs.length - 1]}`);
}

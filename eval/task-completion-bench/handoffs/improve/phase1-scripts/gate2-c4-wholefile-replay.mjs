// GATE 2 — C-4 "whole-file-on-first-touch for bounded small files", token-level replay.
//
// Bar (SLATE-A-UBER §5 C-4): "replay every nibble group at token level. Count later calls as
// removed only when their content was subsequently used and already present in the whole-file
// response. Include the cost of carrying extra lines through all later requests.
// Kill if replayed billed cost does not fall >=5% on Codex."
//
// This runs the OPTIMISTIC bound first: EVERY later read of an already-whole-file-served file
// is deleted, whether or not its content was later used. If the optimistic bound misses 5%,
// the strict gate cannot pass and the candidate is dead without further work.
//
// Token accounting uses MEASURED context growth, not an estimator:
//   tool-result tokens of turn k  =  T(k+1) - T(k) - out(k)
// The only estimated quantity is the SIZE OF THE EXTRA LINES the policy adds, which is
// computed from the real file bytes with a bytes/token constant calibrated on this corpus.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { costFromTurns, priceFor } from '/root/sweet-search-private/eval/task-completion-bench/harness/ideal-cost.mjs';

const RUN = process.argv[2] || 'sb-codex-20260811';
const ARM = process.argv[3] || 'sweet';
const MAXLINES = +(process.argv[4] || 600);
const R = `/root/sweet-search-private/eval/task-completion-bench/results/${RUN}`;
const GOLDEN = '/root/.ss-eval/golden';
const rows = JSON.parse(readFileSync(path.join(R, 'rows.json'), 'utf8'));
const goldenDirs = readdirSync(GOLDEN);

// task -> base commit, read from select/.cache tasks file (metadata fields only, never gold)
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
function goldenFor(taskId) {
  const sha = BASE[taskId];
  if (sha) { const hit = goldenDirs.find(d => d.endsWith(`@${sha}`)); if (hit) return path.join(GOLDEN, hit); }
  const repo = taskId.replace(/-\d+$/, '').toLowerCase();
  const hits = goldenDirs.filter(d => d.toLowerCase().startsWith(`${repo}@`));
  return hits.length === 1 ? path.join(GOLDEN, hits[0]) : null;
}

function rolloutFiles(taskId, arm) {
  const home = path.join(R, 'agent-state', `${taskId}-${arm}`, 'codex-home', 'sessions');
  const out = [];
  const walk = d => { let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.jsonl')) out.push(p); } };
  walk(home);
  return out.sort();
}

/** Ordered stream: {kind:'turn'|'call', ...}. Codex emits token_count after each response. */
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
      const cmd = p.input ?? p.arguments ?? '';
      ev.push({ kind: 'call', cmd: typeof cmd === 'string' ? cmd : JSON.stringify(cmd) });
    } else if (ty === 'function_call_output' || ty === 'custom_tool_call_output') {
      const s = typeof p.output === 'string' ? p.output : JSON.stringify(p.output);
      ev.push({ kind: 'out', bytes: s.length });
    }
  }
  return ev;
}

/** ss-read invocations: file path and optional line range. Returns null for non-reads. */
function parseSsRead(cmd) {
  if (!/\bss-read\b/.test(cmd)) return null;
  // ss-read <path>[:a-b] ... | ss-read --lines a-b <path> | ss-read <path> a b
  const m = /\bss-read\b([^\n|;&]*)/.exec(cmd);
  if (!m) return null;
  const argstr = m[1];
  const toks = argstr.trim().split(/\s+/).filter(Boolean);
  let file = null, a = null, b = null;
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk.startsWith('-')) {
      if (/^--(lines|range)$/.test(tk) && toks[i + 1]) {
        const r = /(\d+)\s*-\s*(\d+)/.exec(toks[++i]); if (r) { a = +r[1]; b = +r[2]; }
      }
      continue;
    }
    const colon = /^(.*?):(\d+)-(\d+)$/.exec(tk);
    if (colon) { file = file || colon[1]; a = +colon[2]; b = +colon[3]; continue; }
    if (!file) { file = tk.replace(/^['"]|['"]$/g, ''); continue; }
    if (/^\d+$/.test(tk)) { if (a == null) a = +tk; else if (b == null) b = +tk; }
  }
  return file ? { file, a, b } : null;
}

const BYTES_PER_TOKEN = 3.5;   // harness-wide estimator (DEGENERATION_DEFAULTS)
const results = [];
let missingGolden = new Set(), parsedReads = 0, unresolvedFiles = 0;

for (const r of rows.filter(x => x.arm === ARM)) {
  const files = rolloutFiles(r.taskId, r.arm);
  if (!files.length) { results.push({ ...r, skip: 'no-rollout' }); continue; }
  const gold = goldenFor(r.taskId);
  if (!gold) missingGolden.add(r.taskId);
  const price = priceFor(r.model);
  // pick the rollout whose replayed baseline cost matches the recorded row
  let best = null;
  for (const f of files) {
    const ev = parseRollout(f);
    const turns = ev.filter(e => e.kind === 'turn').map(e => ({ in: e.in, cached: e.cached, out: e.out }));
    if (!turns.length) continue;
    const c = costFromTurns(turns, price);
    const d = Math.abs(c.idealUsd - (r.idealCostUsd ?? 0));
    if (!best || d < best.d) best = { f, ev, turns, c, d };
  }
  if (!best) { results.push({ ...r, skip: 'no-turns' }); continue; }

  // Align: walk the stream, attach each call to the turn index it belongs to.
  const seq = [];      // [{turnIdx, read|null}]
  let turnIdx = -1;
  for (const e of best.ev) {
    if (e.kind === 'turn') turnIdx++;
    else if (e.kind === 'call') seq.push({ turnIdx: Math.max(0, turnIdx), read: parseSsRead(e.cmd), cmd: e.cmd });
  }
  const T = best.turns;
  // measured tool-result tokens of the turn that issued call at index k
  const resultTokens = i => (i + 1 < T.length ? Math.max(0, T[i + 1].in - T[i].in - T[i].out) : 0);

  // whole-file policy simulation
  const served = new Map();       // file -> {lines, wholeServed:boolean}
  const extraAt = new Map();      // turnIdx -> extra tokens added by whole-file expansion
  const removeTurns = new Set();  // turn indices whose read becomes redundant
  const groups = new Map();
  for (const s of seq) {
    if (!s.read) continue;
    parsedReads++;
    const rel = s.read.file.replace(/^\.?\//, '');
    let abs = path.join(gold || '', rel);
    if (gold && !existsSync(abs)) {                     // try trimming a leading repo dir
      const alt = rel.split('/').slice(1).join('/');
      if (alt && existsSync(path.join(gold, alt))) abs = path.join(gold, alt);
    }
    let lines = null, bytes = null;
    if (gold && existsSync(abs) && statSync(abs).isFile()) {
      const txt = readFileSync(abs, 'utf8');
      lines = txt.split('\n').length; bytes = txt.length;
    } else { unresolvedFiles++; continue; }
    if (!groups.has(s.read.file)) groups.set(s.read.file, []);
    groups.get(s.read.file).push(s);
    if (lines > MAXLINES) continue;                       // policy applies to small files only
    if (!served.has(s.read.file)) {
      // first touch: whole file. extra = whole-file render minus the span actually served
      const a = s.read.a ?? 1, b = s.read.b ?? lines;
      const spanFrac = Math.min(1, Math.max(0, (b - a + 1) / Math.max(1, lines)));
      const wholeTokens = (bytes + lines * 5) / BYTES_PER_TOKEN;   // +gutter "NNNN\t"
      const servedTokens = wholeTokens * spanFrac;
      extraAt.set(s.turnIdx, (extraAt.get(s.turnIdx) || 0) + Math.max(0, wholeTokens - servedTokens));
      served.set(s.read.file, true);
    } else {
      removeTurns.add(s.turnIdx);                          // OPTIMISTIC: later read deleted
    }
  }

  // rebuild the turn sequence under the policy
  const newTurns = [];
  let shift = 0;                       // running context delta carried forward
  for (let i = 0; i < T.length; i++) {
    const extra = extraAt.get(i) || 0;
    if (removeTurns.has(i)) {
      // this request never happens: drop its output tokens and its tool result from context
      shift -= (T[i].out + resultTokens(i));
      continue;
    }
    const nin = Math.max(0, Math.round(T[i].in + shift));
    newTurns.push({ in: nin, cached: Math.min(T[i].cached, nin), out: T[i].out });
    shift += extra;                     // extra lines enter context after this turn's request
  }
  const nc = costFromTurns(newTurns, price);
  results.push({ taskId: r.taskId, arm: r.arm, rep: r.rep, model: r.model,
    baseIdeal: best.c.idealUsd, newIdeal: nc.idealUsd,
    baseTurns: T.length, newTurns: newTurns.length,
    reads: seq.filter(s => s.read).length,
    removed: removeTurns.size, extraTokens: [...extraAt.values()].reduce((a, b) => a + b, 0),
    nibbleFiles: [...groups.entries()].filter(([, v]) => v.length > 1).length,
    recorded: r.idealCostUsd, reproDrift: best.d / Math.max(1e-9, r.idealCostUsd ?? 1) });
}

const ok = results.filter(x => !x.skip);
const sum = f => ok.reduce((a, x) => a + (x[f] || 0), 0);
console.log(`\n=== C-4 optimistic replay: ${RUN} / ${ARM} (whole file when <= ${MAXLINES} lines) ===`);
console.log(`rollouts ${ok.length} | ss-read calls parsed ${parsedReads} | files not found in golden ${unresolvedFiles}`);
if (missingGolden.size) console.log(`no unique golden checkout for: ${[...missingGolden].join(', ')}`);
const worstDrift = Math.max(...ok.map(x => x.reproDrift || 0));
console.log(`baseline reproduction: worst drift vs recorded idealCost = ${(worstDrift * 100).toFixed(2)}%`);
console.log(`nibble files (read 2+ times): ${sum('nibbleFiles')} | later reads deleted: ${sum('removed')}`);
console.log(`extra tokens injected by whole-file: ${Math.round(sum('extraTokens'))}`);
console.log(`\nbaseline ideal $${sum('baseIdeal').toFixed(6)}  ->  replayed ideal $${sum('newIdeal').toFixed(6)}`);
const delta = (sum('newIdeal') / sum('baseIdeal') - 1) * 100;
console.log(`DELTA = ${delta.toFixed(2)}%   (gate needs <= -5.00%)`);
console.log('\nper-task (only rows where the policy fired):');
for (const x of ok.filter(x => x.removed || x.extraTokens > 0).sort((a, b) => (a.newIdeal - a.baseIdeal) - (b.newIdeal - b.baseIdeal))) {
  console.log(`  ${x.taskId.padEnd(44)} r${x.rep} reads=${String(x.reads).padStart(2)} nibbleFiles=${x.nibbleFiles} removed=${x.removed} extra=${Math.round(x.extraTokens)}tok  $${x.baseIdeal.toFixed(6)} -> $${x.newIdeal.toFixed(6)} (${((x.newIdeal / x.baseIdeal - 1) * 100).toFixed(1)}%)`);
}

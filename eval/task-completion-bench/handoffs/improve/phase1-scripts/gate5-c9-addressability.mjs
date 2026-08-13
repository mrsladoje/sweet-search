// GATE 5 — C-9 addressability + cost of the POST-C-1 residual.
// Bar: ">=90% of the observed failed edits unambiguously addressable by symbol + operation,
// and intended sub-symbol edits must not require brittle textual anchors"; plus C-9 only
// earns a build "if C-1 leaves material residual cost".
//
// For each sweet edit failure: (a) does the named file resolve in the base checkout by a
// unique path-suffix match? (b) is the intended edit a WHOLE symbol or a SUB-SYMBOL fragment?
// (c) what did the wasted round trip cost, priced by the settled `pages`-tax rule (charge the
// turn that issued the rejected call)?
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { costFromTurns, priceFor } from '/root/sweet-search-private/eval/task-completion-bench/harness/ideal-cost.mjs';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUN = process.argv[2] || 'screen-v3-20260812';
const GOLDEN = '/root/.ss-eval/golden';
const root = path.join(RESULTS, RUN, 'agent-state');
const rows = JSON.parse(readFileSync(path.join(RESULTS, RUN, 'rows.json'), 'utf8'));
const goldenDirs = readdirSync(GOLDEN);
const BASE = {
  'redboltz__mqtt_cpp-466': 'f48e140ba080e6078ad4066ae6280b5d10210521',
  'dart-lang__http-1114': '5c75da6e084145b27c046827b89d518e30c19048',
  'dashbitco__nimble_options-43': '5270554b86676476b3e63d91f54c0d340a67102c',
  'ontodev__robot-710': '691d0dd57b97309da2e05b86bc0d6bcace1ecf78',
  'codeception__codeceptjs-367': '9ed81962765b738eaa4d6bad059ce72081547190',
  'akinsho__nvim-bufferline.lua-173': '7bf463cf7c61faa9f24222bba9412230d4cc1dc7',
  'mransan__ocaml-protoc-202': 'cc163d8eb2444363b58d7b4d43c9788b8946abd6',
  'statamic__cms-9029': 'ce8e80987e29c8929364dc8387cd0f2399128202',
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

function allFiles(rootDir) {
  const out = [];
  const walk = (d, depth = 0) => { if (depth > 12) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = path.join(d, e.name); if (e.isDirectory()) walk(p, depth + 1); else out.push(p.slice(rootDir.length + 1)); } };
  walk(rootDir);
  return out;
}
const fileCache = new Map();
function resolveSuffix(taskId, wanted) {
  const g = goldenFor(taskId); if (!g) return { status: 'no-golden' };
  if (!fileCache.has(taskId)) fileCache.set(taskId, allFiles(g));
  const rel = String(wanted || '').replace(/^\/+/, '');
  const parts = rel.split('/').filter(Boolean);
  for (let k = parts.length; k >= 1; k--) {
    const suffix = parts.slice(parts.length - k).join('/');
    const hits = fileCache.get(taskId).filter(f => f === suffix || f.endsWith('/' + suffix));
    if (hits.length === 1) return { status: 'unique', path: hits[0], depth: k };
    if (hits.length > 1) return { status: 'ambiguous', n: hits.length, depth: k };
  }
  return { status: 'absent' };
}

// Whole-symbol vs sub-symbol: does old_string START at a declaration keyword at column 0-ish
// AND look self-contained (balanced braces/parens, or a complete def block)?
const DECL = /^\s*(export\s+)?(async\s+)?(def|class|function|fn|func|const|let|var|public|private|protected|static|impl|struct|enum|trait|module|defmodule|defp?|sub|proc|type|interface|val|object)\b/;
function symbolShape(oldStr) {
  const s = String(oldStr || '');
  if (!s.trim()) return 'empty';
  const first = s.split('\n').find(l => l.trim()) || '';
  const bal = t => { let n = 0; for (const c of s) { if (c === t[0]) n++; else if (c === t[1]) n--; } return n; };
  const balanced = bal('{}') === 0 && bal('()') === 0 && bal('[]') === 0;
  if (DECL.test(first) && balanced) return 'whole-symbol';
  if (DECL.test(first)) return 'symbol-prefix-unbalanced';
  return 'sub-symbol';
}

function transcripts(r) {
  const out = [];
  const walk = (d, depth = 0) => { if (depth > 9) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1); else if (e.name.endsWith('.jsonl')) out.push(p); } };
  walk(r);
  return out.filter(p => p.includes('/claude-home/projects/') && !p.includes('/subagents/'));
}

const findings = [];
for (const f of transcripts(root)) {
  const cell = f.slice(root.length + 1).split('/')[0];
  const arm = cell.endsWith('-native') ? 'native' : 'sweet';
  const task = cell.replace(/-(native|sweet)$/, '');
  const row = rows.find(r => r.taskId === task && r.arm === arm);
  const price = priceFor(row?.model || 'openai/gpt-5.6-luna');
  // request sequence with per-request cost, and which request issued each tool_use
  const order = [], byId = new Map(), callToReq = new Map();
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t[0] !== '{') continue;
    let e; try { e = JSON.parse(t); } catch { continue; }
    const m = e.message; if (!m) continue;
    if (m.role === 'assistant' && m.id) {
      if (!byId.has(m.id)) { byId.set(m.id, { id: m.id, usage: m.usage || {}, calls: [] }); order.push(m.id); }
      for (const b of (m.content || [])) if (b.type === 'tool_use') {
        byId.get(m.id).calls.push(b); callToReq.set(b.id, m.id);
      }
    }
  }
  const turns = order.map(id => { const u = byId.get(id).usage;
    const cr = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
    return { in: (u.input_tokens || 0) + cr + cw, cached: cr, cacheWrite: cw, out: u.output_tokens || 0 }; });
  const perReq = turns.map((t, i) => costFromTurns([t], price).idealUsd);
  const idxOf = new Map(order.map((id, i) => [id, i]));

  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t[0] !== '{') continue;
    let e; try { e = JSON.parse(t); } catch { continue; }
    for (const b of (e.message?.content || [])) {
      if (b.type !== 'tool_result') continue;
      const txt = typeof b.content === 'string' ? b.content
        : Array.isArray(b.content) ? b.content.map(x => x?.text || '').join('') : '';
      if (!b.is_error && !/^Error|error:/i.test(txt)) continue;
      const reqId = callToReq.get(b.tool_use_id);
      const call = reqId ? byId.get(reqId).calls.find(c => c.id === b.tool_use_id) : null;
      if (!call || !/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(call.name)) continue;
      const i = idxOf.get(reqId);
      const cls = /String to replace not found/i.test(txt) ? 'anchor-not-found'
        : /File does not exist/i.test(txt) ? 'wrong-path'
        : /exactly the same/i.test(txt) ? 'no-op-edit'
        : /could not be parsed as JSON/i.test(txt) ? 'oversized-payload'
        : /Found \d+ matches|not unique/i.test(txt) ? 'anchor-ambiguous' : 'other';
      findings.push({ task, arm, cls, tool: call.name,
        file: call.input?.file_path || '', resolve: resolveSuffix(task, call.input?.file_path || ''),
        shape: symbolShape(call.input?.old_string), costUsd: perReq[i] ?? 0 });
    }
  }
}

const armTotal = a => rows.filter(r => r.arm === a).reduce((s, r) => s + (r.idealCostMainOnlyUsd ?? r.idealCostUsd ?? 0), 0);
console.log(`=== C-9 post-C-1 residual, ${RUN} ===`);
for (const arm of ['sweet', 'native']) {
  const fs2 = findings.filter(f => f.arm === arm);
  const cost = fs2.reduce((s, f) => s + f.costUsd, 0);
  console.log(`\n-- ${arm}: ${fs2.length} edit failures, wasted round trips $${cost.toFixed(6)} = ${(cost / armTotal(arm) * 100).toFixed(2)}% of arm total ($${armTotal(arm).toFixed(6)})`);
  const g = new Map(); for (const f of fs2) g.set(f.cls, (g.get(f.cls) || 0) + 1);
  console.log('   classes:', [...g].map(([k, v]) => `${k}=${v}`).join(' '));
  for (const f of fs2) {
    console.log(`   ${f.cls.padEnd(18)} ${f.shape.padEnd(24)} resolve=${f.resolve.status}${f.resolve.path ? `(${f.resolve.path})` : ''} $${f.costUsd.toFixed(6)}  ${f.task}  ${f.file}`);
  }
}
// addressability verdict, sweet arm (the sweet-only lever's own population)
const sweet = findings.filter(f => f.arm === 'sweet');
const addressable = sweet.filter(f => (f.cls === 'wrong-path' ? f.resolve.status === 'unique' : f.shape === 'whole-symbol'));
console.log(`\nSWEET addressability by symbol+operation: ${addressable.length}/${sweet.length} = ${(addressable.length / Math.max(1, sweet.length) * 100).toFixed(0)}%   (bar: >=90%)`);

// DOCTRINE §10 (C-9) — split the post-fix `stale-address` residual into causes that
// symbol addressing can actually fix, and causes it cannot.
//
// "String to replace not found" is not one failure. Against the base tree it is three:
//
//   WHITESPACE-MISMATCH  the quoted text IS in the file once whitespace is normalised.
//                        C-9 fixes this outright -- naming a symbol never quotes text.
//   SELF-INVALIDATED     the text is absent from base, and the rollout had already made a
//                        SUCCESSFUL edit to this same file. The agent invalidated its own
//                        anchor. C-9 fixes this: a symbol re-resolves after an edit.
//   PHANTOM              absent from base, and no prior successful edit to that file. The
//                        agent quoted text that never existed. C-9 CANNOT fix this -- a
//                        wrong symbol name fails exactly the same way.
//
// PHANTOM is the share of C-9's prize that is really a model-behaviour problem.
// Read-only. No model.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const GOLDEN = '/root/.ss-eval/golden';
const RUNS = ['sb-claudecode-20260811', 'screen-v3-20260812'];
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

const norm = s => s.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();

const transcripts = root => {
  const out = [];
  const walk = (d, depth = 0) => {
    if (depth > 9) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1); else if (e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(root);
  return out.filter(p => p.includes('/claude-home/projects/') && !p.includes('/subagents/'));
};

const resolveInGolden = (gold, filePath) => {
  if (!gold) return null;
  const rel = filePath.replace(/^\/root\/\.ss-eval\/runs\/[^/]+\//, '').replace(/^\.?\//, '');
  const cands = [rel, rel.split('/').slice(1).join('/')];
  for (const c of cands) {
    if (!c) continue;
    const abs = path.join(gold, c);
    if (existsSync(abs) && statSync(abs).isFile()) return abs;
  }
  return null;
};

const out = [];
for (const RUN of RUNS) {
  const root = path.join(RESULTS, RUN, 'agent-state');
  if (!existsSync(root)) continue;
  for (const f of transcripts(root)) {
    const cell = f.slice(root.length + 1).split('/')[0];
    const arm = cell.endsWith('-native') ? 'native' : 'sweet';
    const task = cell.replace(/-(native|sweet)$/, '');
    const gold = goldenFor(task);
    const byId = new Map();
    const editedOk = new Set();     // files with >=1 SUCCESSFUL prior edit in this rollout
    const pending = [];
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let e; try { e = JSON.parse(t); } catch { continue; }
      for (const b of (e.message?.content || [])) {
        if (b.type === 'tool_use') byId.set(b.id, { name: b.name, input: b.input });
        if (b.type === 'tool_result') {
          const call = byId.get(b.tool_use_id); if (!call) continue;
          if (!/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(call.name)) continue;
          const txt = typeof b.content === 'string' ? b.content
            : Array.isArray(b.content) ? b.content.map(x => x?.text || '').join('') : '';
          const isErr = b.is_error || /^Error|error:/i.test(txt);
          const fp = String(call.input?.file_path || '');
          if (!isErr) { editedOk.add(fp); continue; }
          if (!/String to replace not found|not found in file|File has been modified/i.test(txt)) continue;
          const oldStr = String(call.input?.old_string ?? call.input?.edits?.[0]?.old_string ?? '');
          pending.push({ run: RUN, task, arm, fp, oldStr, txt: txt.slice(0, 90).replace(/\n/g, ' '),
            modified: /File has been modified/i.test(txt), priorOk: editedOk.has(fp) });
        }
      }
    }
    for (const p of pending) {
      const abs = resolveInGolden(gold, p.fp);
      let verdict, why;
      if (p.modified) { verdict = 'SELF-INVALIDATED'; why = 'harness reported the file changed since read'; }
      else if (!abs) { verdict = 'UNRESOLVABLE'; why = 'base file not found in golden tree'; }
      else {
        const src = readFileSync(abs, 'utf8');
        if (src.includes(p.oldStr)) { verdict = 'SELF-INVALIDATED'; why = 'exact text IS in base, so the rollout changed it'; }
        else if (norm(src).includes(norm(p.oldStr)) && p.oldStr.trim()) { verdict = 'WHITESPACE-MISMATCH'; why = 'present in base once whitespace is normalised'; }
        else if (p.priorOk) { verdict = 'SELF-INVALIDATED'; why = 'absent from base, but this rollout already edited this file successfully'; }
        else { verdict = 'PHANTOM'; why = 'absent from base, and no prior successful edit to this file'; }
      }
      out.push({ ...p, verdict, why });
    }
  }
}

console.log('=== C-9 POST-FIX `stale-address` RESIDUAL, SPLIT BY WHAT SYMBOL ADDRESSING CAN DO ===\n');
console.log(`population: ${out.length} anchor-not-found / file-modified failures across both post-fix claude runs\n`);

const FIXABLE = new Set(['WHITESPACE-MISMATCH', 'SELF-INVALIDATED']);
const tab = new Map();
for (const o of out) {
  const k = `${o.verdict}|${o.arm}`;
  tab.set(k, (tab.get(k) || 0) + 1);
}
const verdicts = ['WHITESPACE-MISMATCH', 'SELF-INVALIDATED', 'PHANTOM', 'UNRESOLVABLE'];
console.log(`  ${'verdict'.padEnd(22)} native  sweet   total   C-9 fixes it?`);
for (const v of verdicts) {
  const n = tab.get(`${v}|native`) || 0, s = tab.get(`${v}|sweet`) || 0;
  if (!n && !s) continue;
  console.log(`  ${v.padEnd(22)} ${String(n).padStart(5)}  ${String(s).padStart(5)}  ${String(n + s).padStart(5)}   ${FIXABLE.has(v) ? 'yes' : v === 'PHANTOM' ? 'NO — model behaviour' : 'unknown'}`);
}

const sweet = out.filter(o => o.arm === 'sweet');
const sweetFix = sweet.filter(o => FIXABLE.has(o.verdict));
const sweetPhantom = sweet.filter(o => o.verdict === 'PHANTOM');
console.log(`\n--- the number that decides C-9's prize ---`);
console.log(`  sweet-arm anchor failures            : ${sweet.length}`);
console.log(`  symbol addressing could fix          : ${sweetFix.length}  (${(sweetFix.length / Math.max(1, sweet.length) * 100).toFixed(0)}%)`);
console.log(`  PHANTOM — quoting text that is not there anywhere : ${sweetPhantom.length}  (${(sweetPhantom.length / Math.max(1, sweet.length) * 100).toFixed(0)}%)`);
console.log(`\n  A phantom anchor and a phantom symbol name fail identically. That share of the`);
console.log(`  prize is NOT recoverable by C-9, at any coverage.`);

console.log('\n--- per-task concentration (sweet arm) ---');
const byTask = new Map();
for (const o of sweet) {
  const k = `${o.task}`;
  if (!byTask.has(k)) byTask.set(k, { total: 0, phantom: 0 });
  byTask.get(k).total++;
  if (o.verdict === 'PHANTOM') byTask.get(k).phantom++;
}
for (const [k, v] of [...byTask].sort((a, b) => b[1].total - a[1].total)) {
  console.log(`  ${String(v.total).padStart(3)} failures (${v.phantom} phantom)  ${k}`);
}

console.log('\n--- audit trail ---');
for (const o of out) {
  console.log(`  ${o.arm.padEnd(6)} ${o.verdict.padEnd(20)} ${o.task.padEnd(38)} ${o.fp.split('/').slice(-1)[0].padEnd(26)} ${o.why}`);
}

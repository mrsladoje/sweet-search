// DOCTRINE §4 — conversion arithmetic for the lever the C-9 re-census surfaced:
// a WHITESPACE-TOLERANT edit matcher.
//
// 23 of 41 post-C-1 anchor failures quote text that IS in the file once whitespace is
// normalised. Symbol addressing (C-9, weeks) fixes those; so does making the matcher
// whitespace-tolerant (days). This prices that class on the settled rule:
//
//   charge the turn that ISSUED the rejected call, at its MARGINAL contribution --
//   fresh input at the new-token rate, the re-sent prefix at the cache rate.
//   (costFromTurns([oneTurn]) charges the whole context at the fresh rate and roughly
//   doubles the answer; that defect is corrected in SLATE-A-CLOSE-RESULTS.md 2.2.)
//
// Read-only. No model.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { priceFor } from '/root/sweet-search-private/eval/task-completion-bench/harness/ideal-cost.mjs';

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
const CONTROL = new Set(['epiforecasts__scoringutils-229', 'oceanparcels__parcels-617',
  'ontodev__robot-710', 'redboltz__mqtt_cpp-466', 'statamic__cms-9029']);

const transcripts = root => {
  const out = [];
  const walk = (d, depth = 0) => {
    if (depth > 9) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1); else if (e.name.endsWith('.jsonl')) out.push(p); }
  };
  walk(root);
  return out.filter(p => p.includes('/claude-home/projects/') && !p.includes('/subagents/'));
};
const resolveInGolden = (gold, fp) => {
  if (!gold) return null;
  const rel = fp.replace(/^\/root\/\.ss-eval\/runs\/[^/]+\//, '').replace(/^\.?\//, '');
  for (const c of [rel, rel.split('/').slice(1).join('/')]) {
    if (!c) continue;
    const abs = path.join(gold, c);
    if (existsSync(abs) && statSync(abs).isFile()) return abs;
  }
  return null;
};

const all = [];
const armTotals = {};
for (const RUN of RUNS) {
  const root = path.join(RESULTS, RUN, 'agent-state');
  if (!existsSync(root)) continue;
  const rows = JSON.parse(readFileSync(path.join(RESULTS, RUN, 'rows.json'), 'utf8'));
  const col = r => r.idealCostMainOnlyUsd ?? r.idealCostUsd ?? 0;
  armTotals[RUN] = {
    sweet: rows.filter(r => r.arm === 'sweet').reduce((s, r) => s + col(r), 0),
    native: rows.filter(r => r.arm === 'native').reduce((s, r) => s + col(r), 0),
  };
  for (const f of transcripts(root)) {
    const cell = f.slice(root.length + 1).split('/')[0];
    const arm = cell.endsWith('-native') ? 'native' : 'sweet';
    const task = cell.replace(/-(native|sweet)$/, '');
    const row = rows.find(r => r.taskId === task && r.arm === arm);
    let price; try { price = priceFor(row?.model || 'openai/gpt-5.6-luna'); } catch { continue; }
    const gold = goldenFor(task);

    // request sequence, marginal cost per request
    const order = [], byId = new Map(), callToReq = new Map();
    const lines = readFileSync(f, 'utf8').split('\n');
    for (const line of lines) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let e; try { e = JSON.parse(t); } catch { continue; }
      const m = e.message; if (!m) continue;
      if (m.role === 'assistant' && m.id) {
        if (!byId.has(m.id)) { byId.set(m.id, { usage: m.usage || {}, calls: [] }); order.push(m.id); }
        if (m.usage && Object.keys(m.usage).length) byId.get(m.id).usage = m.usage;
        for (const b of (m.content || [])) if (b.type === 'tool_use') {
          byId.get(m.id).calls.push(b); callToReq.set(b.id, m.id);
        }
      }
    }
    const turns = order.map(id => {
      const u = byId.get(id).usage;
      const cr = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
      return { in: (u.input_tokens || 0) + cr + cw, out: u.output_tokens || 0 };
    });
    // MARGINAL cost of request i: fresh input at price.in, re-sent prefix at price.cache
    const marginal = [];
    let prevIn = 0;
    for (const t of turns) {
      const newIn = Math.max(0, t.in - prevIn), resent = t.in - newIn;
      marginal.push((newIn * price.in + resent * price.cache + t.out * price.out) / 1e6);
      prevIn = t.in;
    }
    const idxOf = new Map(order.map((id, i) => [id, i]));

    const editedOk = new Set();
    for (const line of lines) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let e; try { e = JSON.parse(t); } catch { continue; }
      for (const b of (e.message?.content || [])) {
        if (b.type !== 'tool_result') continue;
        const reqId = callToReq.get(b.tool_use_id); if (!reqId) continue;
        const call = byId.get(reqId).calls.find(c => c.id === b.tool_use_id);
        if (!call || !/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(call.name)) continue;
        const txt = typeof b.content === 'string' ? b.content
          : Array.isArray(b.content) ? b.content.map(x => x?.text || '').join('') : '';
        const isErr = b.is_error || /^Error|error:/i.test(txt);
        const fp = String(call.input?.file_path || '');
        if (!isErr) { editedOk.add(fp); continue; }
        if (!/String to replace not found|not found in file|File has been modified/i.test(txt)) continue;
        const oldStr = String(call.input?.old_string ?? call.input?.edits?.[0]?.old_string ?? '');
        const abs = resolveInGolden(gold, fp);
        let cls;
        if (/File has been modified/i.test(txt)) cls = 'SELF-INVALIDATED';
        else if (!abs) cls = 'UNRESOLVABLE';
        else {
          const src = readFileSync(abs, 'utf8');
          if (src.includes(oldStr)) cls = 'SELF-INVALIDATED';
          else if (oldStr.trim() && norm(src).includes(norm(oldStr))) cls = 'WHITESPACE-MISMATCH';
          else if (editedOk.has(fp)) cls = 'SELF-INVALIDATED';
          else cls = 'PHANTOM';
        }
        all.push({ run: RUN, task, arm, cls, usd: marginal[idxOf.get(reqId)] ?? 0,
          control: CONTROL.has(task) });
      }
    }
  }
}

console.log('=== CONVERSION ARITHMETIC — whitespace-tolerant matcher vs C-9 symbol addressing ===\n');
console.log('proximal event : one rejected edit whose anchor IS in the file modulo whitespace');
console.log('unit cost      : marginal cost of the request that issued it\n');

for (const RUN of RUNS) {
  const sub = all.filter(a => a.run === RUN);
  console.log(`-- ${RUN} --`);
  for (const arm of ['sweet', 'native']) {
    const a = sub.filter(x => x.arm === arm);
    const tot = armTotals[RUN][arm];
    const grp = new Map();
    for (const x of a) {
      if (!grp.has(x.cls)) grp.set(x.cls, { n: 0, usd: 0 });
      grp.get(x.cls).n++; grp.get(x.cls).usd += x.usd;
    }
    const ws = grp.get('WHITESPACE-MISMATCH') || { n: 0, usd: 0 };
    const si = grp.get('SELF-INVALIDATED') || { n: 0, usd: 0 };
    const ph = grp.get('PHANTOM') || { n: 0, usd: 0 };
    console.log(`   ${arm.padEnd(6)} arm total $${tot.toFixed(6)}`);
    console.log(`      WHITESPACE-MISMATCH ${String(ws.n).padStart(2)}  $${ws.usd.toFixed(6)}  = ${(ws.usd / tot * 100).toFixed(2)}% of arm   <- the cheap lever`);
    console.log(`      SELF-INVALIDATED    ${String(si.n).padStart(2)}  $${si.usd.toFixed(6)}  = ${(si.usd / tot * 100).toFixed(2)}% of arm`);
    console.log(`      PHANTOM             ${String(ph.n).padStart(2)}  $${ph.usd.toFixed(6)}  = ${(ph.usd / tot * 100).toFixed(2)}% of arm   <- C-9 cannot fix`);
  }
  console.log('');
}

console.log('=== POOLED OVER BOTH CLAUDE RUNS, SWEET ARM ===\n');
const sw = all.filter(a => a.arm === 'sweet');
const swTot = RUNS.reduce((s, r) => s + (armTotals[r]?.sweet || 0), 0);
const g = c => { const a = sw.filter(x => x.cls === c); return { n: a.length, usd: a.reduce((s, x) => s + x.usd, 0) }; };
const WS = g('WHITESPACE-MISMATCH'), SI = g('SELF-INVALIDATED'), PH = g('PHANTOM');
console.log(`sweet Claude spend, both runs        : $${swTot.toFixed(6)}`);
console.log(`whitespace-tolerant matcher recovers : ${WS.n} events, $${WS.usd.toFixed(6)} = ${(WS.usd / swTot * 100).toFixed(2)}%`);
console.log(`  + self-invalidated (C-9 also)      : ${SI.n} events, $${SI.usd.toFixed(6)} = ${(SI.usd / swTot * 100).toFixed(2)}%`);
console.log(`  = full symbol-addressing prize     : ${WS.n + SI.n} events, $${(WS.usd + SI.usd).toFixed(6)} = ${((WS.usd + SI.usd) / swTot * 100).toFixed(2)}%`);
console.log(`  unrecoverable (phantom)            : ${PH.n} events, $${PH.usd.toFixed(6)} = ${(PH.usd / swTot * 100).toFixed(2)}%`);
console.log(`\nshare of the symbol-addressing prize the CHEAP lever already captures: ${(WS.usd / Math.max(1e-12, WS.usd + SI.usd) * 100).toFixed(0)}%`);

console.log('\n=== CONTROL SET — does either lever touch a reliably-solving task? ===');
const ctl = all.filter(a => a.control);
console.log(`  failures on the 5 control tasks: ${ctl.length}` + (ctl.length ? '' : '  (none — the control set is untouched by this lever)'));
for (const c of ctl) console.log(`    ${c.arm} ${c.cls} ${c.task} $${c.usd.toFixed(6)}`);

console.log('\n=== CONCENTRATION WARNING (doctrine §1: heterogeneity, not rep noise) ===');
const byTask = new Map();
for (const x of sw) { if (!byTask.has(x.task)) byTask.set(x.task, { n: 0, usd: 0 }); const t = byTask.get(x.task); t.n++; t.usd += x.usd; }
const swUsd = sw.reduce((s, x) => s + x.usd, 0);
for (const [k, v] of [...byTask].sort((a, b) => b[1].usd - a[1].usd)) {
  console.log(`  ${String(v.n).padStart(2)} events  $${v.usd.toFixed(6)}  ${(v.usd / swUsd * 100).toFixed(0).padStart(3)}% of the prize   ${k}`);
}

// GATE 4 REDO — C-3 under a VARIANT SWEEP.
// The first pass fixed the reset point at the first edit and treated EVERY cell with a
// diagnosis and an apply phase as "exposed". The bar says ">=15% net saving on EXPOSED cells",
// which is a subset the mechanism gets to choose. Both are swept here:
//
//   reset point : first edit | last retrieval call | after a fraction of the turns
//   exposure    : all | only rollouts whose pre-reset context exceeds a threshold
//   handoff     : 100 .. 2000 tokens
//
// A lever is allowed to fire selectively. If it saves >=15% on a subset it can IDENTIFY at
// runtime (context size is knowable; task identity is not), that subset is a real result.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { costFromTurns, priceFor } from '/root/sweet-search-private/eval/task-completion-bench/harness/ideal-cost.mjs';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUNS = { codex: 'sb-codex-20260811', opencode: 'sb-opencode-20260811', claude: 'sb-claudecode-20260811' };

function rolloutTurns(harness, run, taskId, arm, rep) {
  const state = path.join(RESULTS, run, 'agent-state', `${taskId}-${arm}`);
  const files = [];
  const walk = d => { let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p);
      else if (/\.(jsonl|ndjson)$/.test(e.name)) files.push(p); } };
  walk(state);
  const out = [];
  for (const f of files) {
    if (f.includes('/subagents/')) continue;
    if (harness === 'claude') {
      const slug = f.split('/claude-home/projects/')[1]?.split('/')[0] || '';
      const m = /--r(\d+)--\d+$/.exec(slug); if (m && +m[1] !== rep) continue;
    }
    const turns = [];
    if (harness === 'codex') {
      let edit = false, retr = false;
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim(); if (!t || t[0] !== '{') continue;
        let o; try { o = JSON.parse(t); } catch { continue; }
        const p = o.payload || {}; const ty = p.type || o.type;
        if (ty === 'token_count' && p.info?.last_token_usage) {
          const u = p.info.last_token_usage;
          turns.push({ in: u.input_tokens || 0, cached: u.cached_input_tokens || 0,
            out: (u.output_tokens || 0) + (u.reasoning_output_tokens || 0), edit, retr });
          edit = false; retr = false;
        } else if (ty === 'function_call' || ty === 'custom_tool_call') {
          const cmd = String(p.input ?? p.arguments ?? '');
          if (/\*\*\* (Begin Patch|Update File|Add File)|apply_patch/.test(cmd)) edit = true;
          if (/\bss-(read|search|grep|find|semantic)\b|\bgrep\b|\brg\b|sed -n/.test(cmd)) retr = true;
        }
      }
    } else if (harness === 'claude') {
      const byId = new Map(), order = [];
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim(); if (!t || t[0] !== '{') continue;
        let e; try { e = JSON.parse(t); } catch { continue; }
        const m = e.message; if (!m || m.role !== 'assistant' || !m.id) continue;
        if (!byId.has(m.id)) { byId.set(m.id, { usage: null, best: -1, edit: false, retr: false }); order.push(m.id); }
        const r = byId.get(m.id), u = m.usage || {};
        const tot = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
        if (tot > r.best) { r.best = tot; r.usage = u; }
        for (const b of (m.content || [])) if (b.type === 'tool_use') {
          if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(b.name)) r.edit = true;
          if (/^(Read|Grep|Glob|Bash)$/.test(b.name)) r.retr = true;
        }
      }
      for (const id of order) { const r = byId.get(id), u = r.usage || {};
        const cr = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
        const inn = (u.input_tokens || 0) + cr + cw;
        if (!inn && !(u.output_tokens || 0)) continue;
        turns.push({ in: inn, cached: cr, cacheWrite: cw, out: u.output_tokens || 0, edit: r.edit, retr: r.retr }); }
    } else {
      const seen = new Set(); let edit = false, retr = false;
      const find = (o, d = 0) => { if (!o || typeof o !== 'object' || d > 6) return null;
        if (o.tokens && (o.tokens.input != null || o.tokens.output != null)) return o.tokens;
        for (const v of Object.values(o)) { const r = find(v, d + 1); if (r) return r; } return null; };
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim(); if (!t || t[0] !== '{') continue;
        let o; try { o = JSON.parse(t); } catch { continue; }
        const blob = JSON.stringify(o);
        if (/"tool":"(edit|write|patch|multiedit|apply_patch)"/i.test(blob)) edit = true;
        if (/"tool":"(read|grep|glob|bash|list)"/i.test(blob)) retr = true;
        const u = find(o); if (!u) continue;
        const k = `${o.part?.id || ''}|${u.total}|${u.output}`; if (seen.has(k)) continue; seen.add(k);
        const cr = u.cache?.read || 0, cw = u.cache?.write || 0;
        const inn = (u.input || 0) + cr + cw, outp = (u.output || 0) + (u.reasoning || 0);
        if (!inn && !outp) continue;
        turns.push({ in: inn, cached: cr, cacheWrite: cw, out: outp, edit, retr });
        edit = false; retr = false;
      }
    }
    if (turns.length) out.push(turns);
  }
  return out;
}

function resetIndex(T, mode) {
  if (mode === 'firstEdit') return T.findIndex(t => t.edit);
  if (mode === 'lastRetrieval') { let k = -1; for (let i = 0; i < T.length; i++) if (t2(T, i)) k = i; return k < 0 ? -1 : Math.min(k + 1, T.length - 1); }
  if (mode.startsWith('frac')) { const f = +mode.slice(4); return Math.max(1, Math.round(T.length * f)); }
  return -1;
}
// last retrieval BEFORE the first edit; falls back to the last retrieval anywhere
function t2(T, i) {
  const e = T.findIndex(x => x.edit);
  return T[i].retr && (e < 0 || i < e);
}

const loaded = [];
for (const [harness, run] of Object.entries(RUNS)) {
  const rows = JSON.parse(readFileSync(path.join(RESULTS, run, 'rows.json'), 'utf8')).filter(r => r.arm === 'sweet');
  for (const r of rows) {
    const sets = rolloutTurns(harness, run, r.taskId, r.arm, r.rep); if (!sets.length) continue;
    const price = priceFor(r.model);
    const rec = r.idealCostMainOnlyUsd ?? r.idealCostUsd ?? 0;
    let T = sets[0], bd = Infinity;
    for (const s of sets) { const d = Math.abs(costFromTurns(s, price).idealUsd - rec); if (d < bd) { bd = d; T = s; } }
    loaded.push({ harness, task: r.taskId, rep: r.rep, price, T, base: costFromTurns(T, price).idealUsd });
  }
}

function run(mode, handoff, minCtx) {
  const per = { codex: { b: 0, n: 0, cells: 0 }, opencode: { b: 0, n: 0, cells: 0 }, claude: { b: 0, n: 0, cells: 0 } };
  for (const L of loaded) {
    const T = L.T, k = resetIndex(T, mode);
    if (k < 1 || k >= T.length - 1) continue;
    if (T[k].in < minCtx) continue;                       // exposure filter: pre-reset context size
    const start = T[0].in + handoff;
    const applyReset = []; let prev = null;
    for (const t of T.slice(k)) {
      const inc = prev == null ? 0 : Math.max(0, t.in - prev); prev = t.in;
      const nin = applyReset.length ? applyReset[applyReset.length - 1].in + inc : start;
      applyReset.push({ in: nin, cached: Math.max(0, nin - inc), out: t.out });
    }
    const nc = costFromTurns(T.slice(0, k), L.price).idealUsd + costFromTurns(applyReset, L.price).idealUsd;
    const p = per[L.harness]; p.b += L.base; p.n += nc; p.cells++;
  }
  return per;
}

console.log('=== C-3 VARIANT SWEEP (sweet arm). bar: >= -15% on exposed cells ===\n');
const modes = ['firstEdit', 'lastRetrieval', 'frac0.3', 'frac0.5', 'frac0.7'];
const handoffs = [100, 500, 900, 2000];
const ctxs = [0, 20000, 40000, 60000, 100000];
const best = { d: 999 };
const rowsOut = [];
for (const m of modes) for (const h of handoffs) for (const c of ctxs) {
  const per = run(m, h, c);
  for (const [hn, p] of Object.entries(per)) {
    if (!p.cells) continue;
    const d = (p.n / p.b - 1) * 100;
    rowsOut.push({ m, h, c, hn, cells: p.cells, d });
    if (d < best.d) Object.assign(best, { d, m, h, c, hn, cells: p.cells });
  }
}
rowsOut.sort((a, b) => a.d - b.d);
console.log('best 20 of', rowsOut.length, 'configurations:');
console.log('reset-point     handoff  minCtx   harness    cells   delta');
for (const r of rowsOut.slice(0, 20)) {
  console.log(`${r.m.padEnd(15)} ${String(r.h).padStart(7)} ${String(r.c).padStart(7)}   ${r.hn.padEnd(9)} ${String(r.cells).padStart(5)}   ${r.d >= 0 ? '+' : ''}${r.d.toFixed(2)}%${r.d <= -15 ? '  <== CLEARS BAR' : ''}`);
}
console.log(`\nBEST OVERALL: ${best.m} handoff=${best.h} minCtx=${best.c} on ${best.hn} over ${best.cells} cells = ${best.d.toFixed(2)}%  -> ${best.d <= -15 ? 'PASSES' : 'MISSES'} the -15% bar`);
const allHarness = rowsOut.filter(r => r.c === 0 && r.h === 500);
console.log('\nsanity, minCtx=0 handoff=500, every reset point:');
for (const r of allHarness.sort((a, b) => a.m < b.m ? -1 : 1)) console.log(`  ${r.m.padEnd(15)} ${r.hn.padEnd(9)} cells=${String(r.cells).padStart(3)} ${r.d >= 0 ? '+' : ''}${r.d.toFixed(2)}%`);

// ---------------------------------------------------------------------------
// DOSE-RESPONSE. Selecting the best of 148 configurations on 3 cells is exactly
// the degree of freedom the pre-registration exists to remove. The honest test is
// whether the saving grows MONOTONICALLY with carried context, on every harness.
// ---------------------------------------------------------------------------
console.log('\n=== dose-response: reset=firstEdit, handoff=500, exposure by pre-reset context ===');
console.log('minCtx    codex(cells)        opencode(cells)     claude(cells)');
for (const c of [0, 10000, 20000, 30000, 40000, 50000, 60000, 80000, 100000, 150000]) {
  const per = run('firstEdit', 500, c);
  const f = h => { const p = per[h]; return p.cells ? `${((p.n / p.b - 1) * 100).toFixed(2)}% (${p.cells})`.padEnd(20) : 'n/a'.padEnd(20); };
  console.log(String(c).padStart(7) + '   ' + f('codex') + f('opencode') + f('claude'));
}
console.log('\nwhich cells survive minCtx=40000 (reset=firstEdit)?');
for (const L of loaded) {
  const k = resetIndex(L.T, 'firstEdit');
  if (k < 1 || k >= L.T.length - 1) continue;
  if (L.T[k].in < 40000) continue;
  const start = L.T[0].in + 500;
  const ap = []; let prev = null;
  for (const t of L.T.slice(k)) { const inc = prev == null ? 0 : Math.max(0, t.in - prev); prev = t.in;
    const nin = ap.length ? ap[ap.length - 1].in + inc : start; ap.push({ in: nin, cached: Math.max(0, nin - inc), out: t.out }); }
  const nc = costFromTurns(L.T.slice(0, k), L.price).idealUsd + costFromTurns(ap, L.price).idealUsd;
  console.log(`  ${L.harness.padEnd(9)} ${L.task.padEnd(44)} r${L.rep}  preResetCtx=${L.T[k].in}  turns=${L.T.length} k=${k}  $${L.base.toFixed(6)} -> $${nc.toFixed(6)} (${((nc / L.base - 1) * 100).toFixed(1)}%)`);
}

// ---------------------------------------------------------------------------
// The saving concentrates in long rollouts. Are those rollouts the ones that SOLVE?
// The bar's own second clause ("zero causal errors on solved controls") exists to stop a
// lever being credited for cutting the cost of failures. Split the exposed set by outcome.
// ---------------------------------------------------------------------------
const resolvedOf = new Map();
for (const [harness, run] of Object.entries(RUNS))
  for (const r of JSON.parse(readFileSync(path.join(RESULTS, run, 'rows.json'), 'utf8')))
    resolvedOf.set(`${harness}|${r.taskId}|${r.arm}|${r.rep}`, !!r.resolved);

console.log('\n=== does the saving survive on SOLVED rollouts? (reset=firstEdit, handoff=500) ===');
console.log('minCtx   group      cells   baseline      replayed      delta');
for (const c of [0, 20000, 30000, 40000]) {
  for (const grp of ['solved', 'unsolved']) {
    let b = 0, n = 0, cells = 0;
    for (const L of loaded) {
      const k = resetIndex(L.T, 'firstEdit');
      if (k < 1 || k >= L.T.length - 1) continue;
      if (L.T[k].in < c) continue;
      const res = resolvedOf.get(`${L.harness}|${L.task}|sweet|${L.rep}`);
      if ((grp === 'solved') !== !!res) continue;
      const start = L.T[0].in + 500;
      const ap = []; let prev = null;
      for (const t of L.T.slice(k)) { const inc = prev == null ? 0 : Math.max(0, t.in - prev); prev = t.in;
        const nin = ap.length ? ap[ap.length - 1].in + inc : start; ap.push({ in: nin, cached: Math.max(0, nin - inc), out: t.out }); }
      const nc = costFromTurns(L.T.slice(0, k), L.price).idealUsd + costFromTurns(ap, L.price).idealUsd;
      b += L.base; n += nc; cells++;
    }
    if (!cells) { console.log(`${String(c).padStart(6)}   ${grp.padEnd(10)} ${String(cells).padStart(5)}   —`); continue; }
    console.log(`${String(c).padStart(6)}   ${grp.padEnd(10)} ${String(cells).padStart(5)}   $${b.toFixed(6)}    $${n.toFixed(6)}    ${((n / b - 1) * 100) >= 0 ? '+' : ''}${((n / b - 1) * 100).toFixed(2)}%`);
  }
}
console.log('\nexposed cells at minCtx=30000, with outcome:');
for (const L of loaded) {
  const k = resetIndex(L.T, 'firstEdit');
  if (k < 1 || k >= L.T.length - 1 || L.T[k].in < 30000) continue;
  const res = resolvedOf.get(`${L.harness}|${L.task}|sweet|${L.rep}`);
  const start = L.T[0].in + 500;
  const ap = []; let prev = null;
  for (const t of L.T.slice(k)) { const inc = prev == null ? 0 : Math.max(0, t.in - prev); prev = t.in;
    const nin = ap.length ? ap[ap.length - 1].in + inc : start; ap.push({ in: nin, cached: Math.max(0, nin - inc), out: t.out }); }
  const nc = costFromTurns(L.T.slice(0, k), L.price).idealUsd + costFromTurns(ap, L.price).idealUsd;
  console.log(`  ${res ? 'SOLVED  ' : 'unsolved'} ${L.harness.padEnd(9)} ${L.task.padEnd(44)} r${L.rep} ctx=${String(L.T[k].in).padStart(6)} ${((nc / L.base - 1) * 100).toFixed(1)}%`);
}

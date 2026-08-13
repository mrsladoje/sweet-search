// GATE 4 — C-3 "Ephemeral causal coprocessor with context reset".
// Bar (SLATE-A-UBER §5 C-3): "reprice all retained sidechains with the exact runner function,
// mark the earliest correct causal handoff, and simulate a context reset using recorded turns.
// Require >=15% net saving on exposed cells and zero causal errors on solved controls."
//
// Simulation. The handoff point k = the request that issued the FIRST edit. Requests 1..k-1
// are the diagnosis phase; k..N are apply/prove. Under C-3 the diagnosis runs in its own
// context (priced in full, same model — pricing it on a cheaper backbone would be a model
// swap available to both arms, i.e. no differential) and the apply phase starts a FRESH
// session carrying only (system prompt + handoff object). Each context is priced as its own
// growing prefix, exactly as sidechains are.
//
// Cheap-specialist sensitivity is reported separately and never used for the verdict.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { costFromTurns, priceFor } from '/root/sweet-search-private/eval/task-completion-bench/harness/ideal-cost.mjs';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUNS = { codex: 'sb-codex-20260811', opencode: 'sb-opencode-20260811', claude: 'sb-claudecode-20260811' };
const HANDOFF_TOKENS = +(process.argv[2] || 900);   // size of the diagnosis object
const ARM = process.argv[3] || 'sweet';

/** Ordered (turn, hadEdit) for one rollout, by harness. */
function rolloutTurns(harness, run, taskId, arm, rep) {
  const state = path.join(RESULTS, run, 'agent-state', `${taskId}-${arm}`);
  const files = [];
  const walk = d => { let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.jsonl') || e.name.endsWith('.ndjson')) files.push(p); } };
  if (harness === 'codex') walk(path.join(state, 'codex-home', 'sessions'));
  else if (harness === 'claude') walk(path.join(state, 'claude-home', 'projects'));
  else walk(path.join(state, 'opencode-retained'));
  const out = [];
  for (const f of files) {
    if (f.includes('/subagents/')) continue;
    if (harness === 'claude') {
      const slug = f.split('/claude-home/projects/')[1]?.split('/')[0] || '';
      const m = /--r(\d+)--\d+$/.exec(slug); if (m && +m[1] !== rep) continue;
    }
    const turns = [], byId = new Map(), order = [];
    if (harness === 'codex') {
      let cur = null;
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim(); if (!t || t[0] !== '{') continue;
        let o; try { o = JSON.parse(t); } catch { continue; }
        const p = o.payload || {}; const ty = p.type || o.type;
        if (ty === 'token_count' && p.info?.last_token_usage) {
          const u = p.info.last_token_usage;
          turns.push({ in: u.input_tokens || 0, cached: u.cached_input_tokens || 0,
            out: (u.output_tokens || 0) + (u.reasoning_output_tokens || 0), edit: !!cur });
          cur = null;
        } else if (ty === 'function_call' || ty === 'custom_tool_call') {
          const cmd = String(p.input ?? p.arguments ?? '');
          if (/apply_patch|\bpatch\b|<<'?PATCH'?/.test(cmd)) cur = true;
        }
      }
    } else if (harness === 'claude') {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim(); if (!t || t[0] !== '{') continue;
        let e; try { e = JSON.parse(t); } catch { continue; }
        const m = e.message; if (!m || m.role !== 'assistant' || !m.id) continue;
        if (!byId.has(m.id)) { byId.set(m.id, { usage: null, best: -1, edit: false }); order.push(m.id); }
        const r = byId.get(m.id), u = m.usage || {};
        const tot = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
        if (tot > r.best) { r.best = tot; r.usage = u; }
        for (const b of (m.content || [])) if (b.type === 'tool_use' && /^(Edit|MultiEdit|Write|NotebookEdit)$/.test(b.name)) r.edit = true;
      }
      for (const id of order) {
        const r = byId.get(id), u = r.usage || {};
        const cr = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
        const inn = (u.input_tokens || 0) + cr + cw;
        if (!inn && !(u.output_tokens || 0)) continue;
        turns.push({ in: inn, cached: cr, cacheWrite: cw, out: u.output_tokens || 0, edit: r.edit });
      }
    } else {
      // opencode ndjson: find any nested `tokens` object with input/output/cache, deduped by
      // the message part it belongs to; `step_finish` carries the served request's usage.
      let pendingEdit = false;
      const seenPart = new Set();
      const findTokens = (o, depth = 0) => {
        if (!o || typeof o !== 'object' || depth > 6) return null;
        if (o.tokens && typeof o.tokens === 'object'
            && (o.tokens.input != null || o.tokens.output != null)) return o.tokens;
        for (const v of Object.values(o)) { const r = findTokens(v, depth + 1); if (r) return r; }
        return null;
      };
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim(); if (!t || t[0] !== '{') continue;
        let o; try { o = JSON.parse(t); } catch { continue; }
        const blob = JSON.stringify(o);
        if (/"tool":"(edit|write|patch|multiedit|apply_patch)"/i.test(blob)) pendingEdit = true;
        const u = findTokens(o);
        if (!u) continue;
        const key = `${o.part?.id || o.messageID || ''}|${u.total}|${u.output}`;
        if (seenPart.has(key)) continue;
        seenPart.add(key);
        const cr = u.cache?.read || 0, cw = u.cache?.write || 0;
        const inp = (u.input || 0) + cr + cw;
        const outp = (u.output || 0) + (u.reasoning || 0);
        if (!inp && !outp) continue;
        turns.push({ in: inp, cached: cr, cacheWrite: cw, out: outp, edit: pendingEdit });
        pendingEdit = false;
      }
    }
    if (turns.length) out.push({ file: f, turns });
  }
  return out;
}

const results = [];
for (const [harness, run] of Object.entries(RUNS)) {
  const rows = JSON.parse(readFileSync(path.join(RESULTS, run, 'rows.json'), 'utf8')).filter(r => r.arm === ARM);
  for (const r of rows) {
    const cands = rolloutTurns(harness, run, r.taskId, r.arm, r.rep);
    if (!cands.length) { results.push({ harness, task: r.taskId, rep: r.rep, skip: 'no-turns' }); continue; }
    const price = priceFor(r.model);
    let best = null;
    for (const c of cands) {
      const base = costFromTurns(c.turns, price);
      const d = Math.abs(base.idealUsd - (r.idealCostMainOnlyUsd ?? r.idealCostUsd ?? 0));
      if (!best || d < best.d) best = { ...c, base, d };
    }
    const T = best.turns;
    const k = T.findIndex(t => t.edit);
    const recorded = r.idealCostMainOnlyUsd ?? r.idealCostUsd ?? 0;
    if (k < 1 || k >= T.length - 1) {
      results.push({ harness, task: r.taskId, rep: r.rep, recorded, baseIdeal: best.base.idealUsd,
        newIdeal: best.base.idealUsd, k, note: k < 1 ? 'no-diagnosis-phase' : 'no-apply-phase',
        drift: best.d / Math.max(1e-9, recorded), resolved: !!r.resolved });
      continue;
    }
    const diag = T.slice(0, k);
    const apply = T.slice(k);
    // fresh session: context starts at (system+prompt of turn 1) + handoff object, then grows
    // by the SAME per-request increments the recorded apply phase showed.
    const basePrefix = T[0].in;
    const start = basePrefix + HANDOFF_TOKENS;
    const applyReset = [];
    let prev = null;
    for (const t of apply) {
      const inc = prev == null ? 0 : Math.max(0, t.in - prev);
      prev = t.in;
      const nin = applyReset.length ? applyReset[applyReset.length - 1].in + inc : start;
      applyReset.push({ in: nin, cached: Math.max(0, nin - inc), out: t.out });
    }
    const cDiag = costFromTurns(diag, price);
    const cApply = costFromTurns(applyReset, price);
    results.push({ harness, task: r.taskId, rep: r.rep, recorded,
      baseIdeal: best.base.idealUsd, newIdeal: cDiag.idealUsd + cApply.idealUsd,
      turns: T.length, k, drift: best.d / Math.max(1e-9, recorded), resolved: !!r.resolved });
  }
}

console.log(`=== C-3 context-reset replay (arm=${ARM}, handoff=${HANDOFF_TOKENS} tokens) ===`);
for (const h of Object.keys(RUNS)) {
  const rs = results.filter(x => x.harness === h && !x.skip);
  const exposed = rs.filter(x => !x.note);
  const b = rs.reduce((a, x) => a + x.baseIdeal, 0), n = rs.reduce((a, x) => a + x.newIdeal, 0);
  const be = exposed.reduce((a, x) => a + x.baseIdeal, 0), ne = exposed.reduce((a, x) => a + x.newIdeal, 0);
  const worst = Math.max(...rs.map(x => x.drift || 0));
  console.log(`${h.padEnd(9)} rollouts ${rs.length} (exposed ${exposed.length}) | baseline repro worst drift ${(worst * 100).toFixed(1)}%`);
  console.log(`          ALL      $${b.toFixed(6)} -> $${n.toFixed(6)}  = ${((n / b - 1) * 100).toFixed(2)}%`);
  console.log(`          EXPOSED  $${be.toFixed(6)} -> $${ne.toFixed(6)}  = ${((ne / be - 1) * 100).toFixed(2)}%   (gate needs <= -15.00%)`);
}
const skipped = results.filter(x => x.skip);
if (skipped.length) console.log(`\nno turn data: ${skipped.length} rollouts (${[...new Set(skipped.map(s => s.harness))].join(',')})`);
const noted = results.filter(x => x.note);
if (noted.length) { const g = new Map(); for (const x of noted) g.set(`${x.harness}/${x.note}`, (g.get(`${x.harness}/${x.note}`) || 0) + 1);
  console.log('unexposed rollouts:', [...g].map(([k, v]) => `${k}=${v}`).join(' ')); }

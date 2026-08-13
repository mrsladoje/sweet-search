// GATE 10 (cont.) — R-1 break-even. Best case, a turn-0 dossier REMOVES the early
// query-issuing requests; it always ADDS its own tokens to every later request.
// Compute: (a) what removing the first 1 or 2 requests saves, (b) the carrying cost of a
// dossier of D tokens, (c) the break-even D.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { costFromTurns, priceFor } from '/root/sweet-search-private/eval/task-completion-bench/harness/ideal-cost.mjs';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUNS = { codex: 'sb-codex-20260811', opencode: 'sb-opencode-20260811', claude: 'sb-claudecode-20260811' };

function turnsFor(harness, run, taskId, arm, rep) {
  const state = path.join(RESULTS, run, 'agent-state', `${taskId}-${arm}`);
  const files = [];
  const walk = d => { let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p);
      else if (/\.(jsonl|ndjson)$/.test(e.name)) files.push(p); } };
  walk(state);
  const sets = [];
  for (const f of files) {
    if (f.includes('/subagents/')) continue;
    if (harness === 'claude') {
      const slug = f.split('/claude-home/projects/')[1]?.split('/')[0] || '';
      const m = /--r(\d+)--\d+$/.exec(slug); if (m && +m[1] !== rep) continue;
    }
    const turns = [];
    if (harness === 'codex') {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim(); if (!t || t[0] !== '{') continue;
        let o; try { o = JSON.parse(t); } catch { continue; }
        const p = o.payload || {}; if ((p.type || o.type) !== 'token_count') continue;
        const u = p.info?.last_token_usage; if (!u) continue;
        turns.push({ in: u.input_tokens || 0, cached: u.cached_input_tokens || 0,
          out: (u.output_tokens || 0) + (u.reasoning_output_tokens || 0) });
      }
    } else if (harness === 'claude') {
      const byId = new Map(), order = [];
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim(); if (!t || t[0] !== '{') continue;
        let e; try { e = JSON.parse(t); } catch { continue; }
        const m = e.message; if (!m || m.role !== 'assistant' || !m.id) continue;
        if (!byId.has(m.id)) { byId.set(m.id, { usage: null, best: -1 }); order.push(m.id); }
        const r = byId.get(m.id), u = m.usage || {};
        const tot = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
        if (tot > r.best) { r.best = tot; r.usage = u; }
      }
      for (const id of order) { const u = byId.get(id).usage || {};
        const cr = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
        const inn = (u.input_tokens || 0) + cr + cw;
        if (!inn && !(u.output_tokens || 0)) continue;
        turns.push({ in: inn, cached: cr, cacheWrite: cw, out: u.output_tokens || 0 }); }
    } else {
      const seen = new Set();
      const find = (o, d = 0) => { if (!o || typeof o !== 'object' || d > 6) return null;
        if (o.tokens && (o.tokens.input != null || o.tokens.output != null)) return o.tokens;
        for (const v of Object.values(o)) { const r = find(v, d + 1); if (r) return r; } return null; };
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim(); if (!t || t[0] !== '{') continue;
        let o; try { o = JSON.parse(t); } catch { continue; }
        const u = find(o); if (!u) continue;
        const k = `${o.part?.id || ''}|${u.total}|${u.output}`; if (seen.has(k)) continue; seen.add(k);
        const cr = u.cache?.read || 0, cw = u.cache?.write || 0;
        const inn = (u.input || 0) + cr + cw, outp = (u.output || 0) + (u.reasoning || 0);
        if (!inn && !outp) continue;
        turns.push({ in: inn, cached: cr, cacheWrite: cw, out: outp });
      }
    }
    if (turns.length) sets.push(turns);
  }
  return sets;
}

const DOSSIER = [500, 1000, 2000, 4000];
console.log('=== R-1 break-even: dossier tokens carried vs early requests removed (sweet arm) ===\n');
for (const [harness, run] of Object.entries(RUNS)) {
  const rows = JSON.parse(readFileSync(path.join(RESULTS, run, 'rows.json'), 'utf8')).filter(r => r.arm === 'sweet');
  let base = 0; const saveK = { 1: 0, 2: 0 }; const carry = Object.fromEntries(DOSSIER.map(d => [d, 0]));
  let n = 0;
  for (const r of rows) {
    const price = priceFor(r.model);
    const sets = turnsFor(harness, run, r.taskId, r.arm, r.rep);
    if (!sets.length) continue;
    const rec = r.idealCostMainOnlyUsd ?? r.idealCostUsd ?? 0;
    let T = sets[0], bd = Infinity;
    for (const s of sets) { const d = Math.abs(costFromTurns(s, price).idealUsd - rec); if (d < bd) { bd = d; T = s; } }
    n++;
    const b = costFromTurns(T, price).idealUsd; base += b;
    for (const k of [1, 2]) {
      if (T.length <= k + 1) continue;
      // remove the first k requests; the context of later requests drops by what those
      // requests added (their output + the tool results they pulled in)
      const drop = T[k].in - T[0].in;
      const rest = T.slice(k).map(t => ({ ...t, in: Math.max(T[0].in, t.in - drop), cached: Math.max(0, (t.cached || 0) - drop) }));
      saveK[k] += b - costFromTurns(rest, price).idealUsd;
    }
    for (const D of DOSSIER) {
      const withD = T.map((t, i) => ({ ...t, in: t.in + D, cached: i === 0 ? (t.cached || 0) : (t.cached || 0) + D }));
      carry[D] += costFromTurns(withD, price).idealUsd - b;
    }
  }
  console.log(`${harness}: ${n} sweet rollouts, baseline ideal $${base.toFixed(6)}`);
  console.log(`   MAX saving from deleting the first request : $${saveK[1].toFixed(6)} (${(saveK[1] / base * 100).toFixed(2)}%)`);
  console.log(`   MAX saving from deleting the first TWO     : $${saveK[2].toFixed(6)} (${(saveK[2] / base * 100).toFixed(2)}%)`);
  for (const D of DOSSIER) {
    const net2 = saveK[2] - carry[D];
    console.log(`   dossier ${String(D).padStart(4)} tok: carry cost $${carry[D].toFixed(6)} (${(carry[D] / base * 100).toFixed(2)}%)  ->  NET vs 2 removed requests ${net2 >= 0 ? '-' : '+'}${Math.abs(net2 / base * 100).toFixed(2)}%`);
  }
  console.log('');
}

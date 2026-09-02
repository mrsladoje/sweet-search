#!/usr/bin/env node
// subagent-extras.mjs — three checks the census does not cover (runs on the evidence box, read-only).
//   node subagent-extras.mjs <runId>
// 1. Failed-`pages` Read waste INSIDE subagents, both arms: requests whose every tool_use is a Read
//    rejected with "Invalid pages parameter", and the ideal cost of those requests (imputed turns).
// 2. First user record of every subagent: does it carry a <system-reminder> / CLAUDE.md / rules block?
//    (Claude Code delivers CLAUDE.md as a user message; if the guide reached the subagent through that
//    channel it would be visible here.)
// 3. Circular-confirmation check: for every sweet subagent, does any ss-* tool result contain a line the
//    PARENT had already written with Edit (new_string) before delegating? Reports counts only, no code.
import fs from 'node:fs';
import path from 'node:path';
import { costFromTurns, priceFor } from '/root/sweet-search-private/eval/task-completion-bench/harness/ideal-cost.mjs';
const ROOT = '/root/sweet-search-private/eval/task-completion-bench/results';
const runId = process.argv[2] || 'fp-claudecode-tab-20260826';
const rows = JSON.parse(fs.readFileSync(path.join(ROOT, runId, 'rows.json'), 'utf8'));
let price; try { price = priceFor(rows[0].model); } catch { price = { in: 0.10, cache: 0.01, out: 0.60 }; }
const walk = (d, out = []) => { let e = []; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return out; } for (const x of e) { const p = path.join(d, x.name); x.isDirectory() ? walk(p, out) : out.push(p); } return out; };
const jl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
function parse(file) {
  const recs = jl(file); const order = []; const byId = new Map(); const results = new Map(); let firstUser = null; const edits = [];
  for (const r of recs) {
    const m = r.message;
    if (m && m.role === 'user') { if (!firstUser) firstUser = r; if (Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_result' && !results.has(b.tool_use_id)) { const c = b.content; results.set(b.tool_use_id, { text: typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.text || '').join('\n') : JSON.stringify(c ?? ''), isError: !!b.is_error }); } }
    if (!m || m.role !== 'assistant' || !m.id) continue;
    let g = byId.get(m.id); if (!g) { g = { blocks: [], ids: new Set(), usage: null, best: -1, ts: r.timestamp }; byId.set(m.id, g); order.push(m.id); }
    for (const b of (m.content || [])) { if (b.type === 'tool_use' && b.id) { if (g.ids.has(b.id)) continue; g.ids.add(b.id); if (b.name === 'Edit') edits.push({ ts: r.timestamp, new_string: String(b.input?.new_string || ''), file: b.input?.file_path }); } g.blocks.push(b); }
    const u = m.usage; if (!u) continue; const cached = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0; const inp = (u.input_tokens || 0) + cached + cw, out = u.output_tokens || 0;
    if (inp + out > g.best) { g.best = inp + out; g.usage = { in: inp, cached, cacheWrite: cw, out }; }
  }
  const requests = order.map(id => byId.get(id));
  // impute zero-usage
  const T = requests.map(r => r.usage && (r.usage.in || r.usage.out) ? { ...r.usage } : null); const outs = T.filter(Boolean).map(t => t.out).sort((a, b) => a - b); const medOut = outs.length ? outs[Math.floor(outs.length / 2)] : 0;
  for (let i = 0; i < T.length; i++) if (!T[i]) { let p = i - 1; while (p >= 0 && !T[p]) p--; let n = i + 1; while (n < T.length && !T[n]) n++; const pin = p >= 0 ? T[p].in : null, nin = n < T.length ? T[n].in : null; const inp = pin != null && nin != null ? Math.round((pin + nin) / 2) : (pin ?? nin ?? 0); T[i] = { in: inp, cached: Math.max(0, inp - 500), cacheWrite: 0, out: medOut }; }
  return { requests, turns: T, results, firstUser, edits };
}
function perRequestCost(T) { let prev = 0; return T.map(t => { const newIn = Math.max(0, t.in - prev); const c = (newIn * price.in + (t.in - newIn) * price.cache + t.out * price.out) / 1e6; prev = t.in; return c; }); }

const out = { runId, arms: {} };
const state = path.join(ROOT, runId, 'agent-state');
for (const cell of fs.readdirSync(state).sort()) {
  const mm = cell.match(/^(.*)-(native|sweet)$/); if (!mm) continue; const [, task, arm] = mm;
  const A = out.arms[arm] ??= { subagents: 0, subRequests: 0, pagesWasteRequests: 0, pagesWasteCostUsd: 0, pagesFailedReads: 0, subIdealCostUsd: 0, firstUserHasSystemReminder: 0, firstUserHasClaudeMd: 0, firstUserHasGuide: 0, firstUserKinds: {}, circular: [], mainPagesFailedReads: 0, mainRequests: 0 };
  const all = walk(path.join(state, cell)).filter(f => f.endsWith('.jsonl') && f.includes('/claude-home/projects/'));
  for (const mf of all.filter(f => !f.includes('/subagents/'))) {
    const sid = path.basename(mf, '.jsonl'); const M = parse(mf); A.mainRequests += M.requests.length;
    for (const [id, r] of M.results) if (/Invalid pages parameter/.test(r.text)) A.mainPagesFailedReads++;
    for (const sf of all.filter(f => f.includes(`/${sid}/subagents/`))) {
      const S = parse(sf); A.subagents++; A.subRequests += S.requests.length;
      const costs = perRequestCost(S.turns); A.subIdealCostUsd += costs.reduce((a, b) => a + b, 0);
      S.requests.forEach((rq, i) => {
        const tus = rq.blocks.filter(b => b.type === 'tool_use'); if (!tus.length) return;
        const allPagesFail = tus.every(b => b.name === 'Read' && /Invalid pages parameter/.test(S.results.get(b.id)?.text || ''));
        for (const b of tus) if (b.name === 'Read' && /Invalid pages parameter/.test(S.results.get(b.id)?.text || '')) A.pagesFailedReads++;
        if (allPagesFail) { A.pagesWasteRequests++; A.pagesWasteCostUsd += costs[i]; }
      });
      // first user record shape
      const fu = S.firstUser; const c = fu?.message?.content; const txt = typeof c === 'string' ? c : JSON.stringify(c ?? '');
      const kind = typeof c === 'string' ? 'string' : Array.isArray(c) ? 'array:' + c.map(b => b.type).join('+') : typeof c; A.firstUserKinds[kind] = (A.firstUserKinds[kind] || 0) + 1;
      if (/<system-reminder>/.test(txt)) A.firstUserHasSystemReminder++;
      if (/CLAUDE\.md|claudeMd|# Sweet-search|run_tests/.test(txt)) A.firstUserHasClaudeMd++;
      if (/Open with the cheapest tool|code search tool guide/.test(txt)) A.firstUserHasGuide++;
      // circular confirmation: parent Edit new_string lines (>= 24 chars, before the subagent's first record) found in subagent ss-* results
      if (arm === 'sweet') {
        const subStart = fu?.timestamp || '';
        const priorEdits = M.edits.filter(e => e.ts && e.ts < subStart);
        const lines = [...new Set(priorEdits.flatMap(e => e.new_string.split('\n').map(s => s.trim()).filter(s => s.length >= 24)))];
        let hits = 0, ssResults = 0;
        for (const rq of S.requests) for (const b of rq.blocks) if (b.type === 'tool_use' && b.name === 'Bash' && /ss-(search|grep|find|read|semantic|trace)/.test(String(b.input?.command || ''))) {
          ssResults++; const t = S.results.get(b.id)?.text || ''; if (lines.some(l => t.includes(l))) hits++;
        }
        if (priorEdits.length) A.circular.push({ task, agent: path.basename(sf, '.jsonl'), priorEdits: priorEdits.length, editLines: lines.length, ssResults, ssResultsEchoingParentEdit: hits });
      }
    }
  }
}
for (const a of Object.values(out.arms)) a.pagesWasteCostUsd = +a.pagesWasteCostUsd.toFixed(6), a.subIdealCostUsd = +a.subIdealCostUsd.toFixed(6);
console.log(JSON.stringify(out, null, 1));

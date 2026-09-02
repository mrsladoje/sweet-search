// synth-statesum2.mjs — does a <state_summary> block occupy its own request (a text-only turn) or
// ride inside a turn that also issues a tool call? Prices the standalone ones. Read-only.
import fs from 'node:fs';
import * as P from '/tmp/fp-inv/e4-claude-code/parse.mjs';
const BASE = P.ROOT + '/results';
const SS = /<state_summary>/;
const out = {};
// codex sweet TAB
{
  const S = out['codex-sweet-TAB'] = { rollouts: 0, turns: 0, cellUsd: 0, ssTurns: 0, standalone: 0, standaloneUsd: 0, shared: 0, textOnlyTurns: 0, textOnlyUsd: 0 };
  const rows = JSON.parse(fs.readFileSync(`${BASE}/fp-codex-tab-20260826/rows.json`, 'utf8')).filter(r => r.arm === 'sweet');
  for (const r of rows) {
    const cell = `${BASE}/fp-codex-tab-20260826/agent-state/${r.taskId}-sweet/codex-home/sessions`;
    let best = null;
    for (const x of P.walk(cell).filter(x => x.endsWith('.jsonl'))) { const head = fs.readFileSync(x, 'utf8').slice(0, 4000); if (head.includes(`/runs/r${r.rep}-`)) { const sz = fs.statSync(x).size; if (!best || sz > best.sz) best = { x, sz }; } }
    if (!best) continue;
    S.rollouts++;
    let hasSS = false, hasCall = false, hasMsg = false;
    for (const d of P.jl(best.x)) {
      if (d.type === 'event_msg' && d.payload?.type === 'agent_message') { hasMsg = true; if (SS.test(String(d.payload.message || ''))) hasSS = true; }
      if (d.type === 'response_item' && d.payload?.type === 'function_call') hasCall = true;
      if (d.type === 'event_msg' && d.payload?.type === 'token_count') {
        const u = d.payload.info?.last_token_usage; if (!u) continue;
        S.turns++;
        const usd = ((u.input_tokens - (u.cached_input_tokens || 0)) * 0.10 + (u.cached_input_tokens || 0) * 0.01 + ((u.output_tokens || 0) + (u.reasoning_output_tokens || 0)) * 0.60) / 1e6;
        S.cellUsd += usd;
        if (hasSS) { S.ssTurns++; if (hasCall) S.shared++; else { S.standalone++; S.standaloneUsd += usd; } }
        if (hasMsg && !hasCall) { S.textOnlyTurns++; S.textOnlyUsd += usd; }
        hasSS = false; hasCall = false; hasMsg = false;
      }
    }
  }
}
// claude-code sweet TAB
{
  const S = out['claude-sweet-TAB'] = { rollouts: 0, turns: 0, cellUsd: 0, ssTurns: 0, standalone: 0, standaloneUsd: 0, shared: 0, textOnlyTurns: 0, textOnlyUsd: 0 };
  const rows = JSON.parse(fs.readFileSync(`${BASE}/${P.RUNS.TAB}/rows.json`, 'utf8')).filter(r => r.arm === 'sweet');
  for (const task of [...new Set(rows.map(r => r.taskId))]) {
    const ts = P.transcriptsOf(P.RUNS.TAB, task, 'sweet');
    const byRep = new Map(); for (const t of ts) { const x = byRep.get(t.rep); if (!x || t.size > x.size) byRep.set(t.rep, t); }
    for (const [, t] of byRep) {
      S.rollouts++;
      const msgs = new Map(); // id -> {hasSS, hasCall, hasText, usage}
      for (const d of P.jl(t.file)) {
        const m = d.message; if (!m || m.role !== 'assistant') continue;
        const id = d.requestId || m.id; if (!id) continue;
        const e = msgs.get(id) || { hasSS: false, hasCall: false, hasText: false, usage: null }; msgs.set(id, e);
        for (const b of (Array.isArray(m.content) ? m.content : [])) {
          if (b.type === 'tool_use') e.hasCall = true;
          if (b.type === 'text') { e.hasText = true; if (SS.test(String(b.text || ''))) e.hasSS = true; }
        }
        if (m.usage && !e.usage) e.usage = m.usage;
      }
      for (const e of msgs.values()) {
        if (!e.usage) continue;
        const u = e.usage; S.turns++;
        const usd = (((u.input_tokens || 0) + (u.cache_creation_input_tokens || 0)) * 0.10 + (u.cache_read_input_tokens || 0) * 0.01 + (u.output_tokens || 0) * 0.60) / 1e6;
        S.cellUsd += usd;
        if (e.hasSS) { S.ssTurns++; if (e.hasCall) S.shared++; else { S.standalone++; S.standaloneUsd += usd; } }
        if (e.hasText && !e.hasCall) { S.textOnlyTurns++; S.textOnlyUsd += usd; }
      }
    }
  }
}
for (const S of Object.values(out)) {
  S.perRollout = { turns: +(S.turns / S.rollouts).toFixed(2), ssTurns: +(S.ssTurns / S.rollouts).toFixed(2), standaloneSsTurns: +(S.standalone / S.rollouts).toFixed(2), textOnlyTurns: +(S.textOnlyTurns / S.rollouts).toFixed(2) };
  S.standaloneUsdPerRollout = +(S.standaloneUsd / S.rollouts).toFixed(6);
  S.standaloneShareOfCell = +(S.standaloneUsd / S.cellUsd).toFixed(4);
  S.textOnlyUsdPerRollout = +(S.textOnlyUsd / S.rollouts).toFixed(6);
  S.textOnlyShareOfCell = +(S.textOnlyUsd / S.cellUsd).toFixed(4);
  S.cellUsd = +S.cellUsd.toFixed(5); S.standaloneUsd = +S.standaloneUsd.toFixed(5); S.textOnlyUsd = +S.textOnlyUsd.toFixed(5);
}
console.log(JSON.stringify(out, null, 1));

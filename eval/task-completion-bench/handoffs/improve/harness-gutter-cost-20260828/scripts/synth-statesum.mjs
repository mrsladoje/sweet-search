// synth-statesum.mjs — how much assistant output is the guide-mandated <state_summary> block?
// codex (fp-codex-tab sweet + native) and claude-code (fp-claudecode-tab sweet + native). Read-only.
import fs from 'node:fs';
import path from 'node:path';
import * as P from '/tmp/fp-inv/e4-claude-code/parse.mjs';

const BASE = P.ROOT + '/results';
const jl = P.jl;
const SS = /<state_summary>([\s\S]*?)<\/state_summary>/g;
const tally = (S, text) => {
  S.assistantChars += text.length;
  let m; while ((m = SS.exec(text))) { S.blocks++; S.stateChars += m[0].length; }
};
const fin = (S) => {
  const r = S.rollouts || 1;
  S.perRollout = { assistantChars: Math.round(S.assistantChars / r), stateChars: Math.round(S.stateChars / r), blocks: +(S.blocks / r).toFixed(2) };
  S.stateShareOfAssistantText = +(S.stateChars / Math.max(1, S.assistantChars)).toFixed(3);
  // rough token proxy: 4 chars/token; price: $0.60/M once + $0.01/M × ~15 re-sends
  const tok = S.stateChars / 4 / r;
  S.approx = { stateTokensPerRollout: Math.round(tok), usdOutput: +(tok * 0.60 / 1e6).toFixed(6), usdWithResidency15: +(tok * (0.60 + 0.15) / 1e6).toFixed(6) };
};

const out = {};
// codex
for (const arm of ['sweet', 'native']) {
  const S = out[`codex-${arm}`] = { rollouts: 0, assistantChars: 0, stateChars: 0, blocks: 0 };
  const rows = JSON.parse(fs.readFileSync(`${BASE}/fp-codex-tab-20260826/rows.json`, 'utf8')).filter(r => r.arm === arm);
  for (const r of rows) {
    let f = r.rolloutFile;
    if (f && !f.startsWith('/')) f = path.join(P.ROOT, f);
    if (!f || !fs.existsSync(f)) {
      // fallback: largest file in the cell whose cwd matches the rep
      const cell = `${BASE}/fp-codex-tab-20260826/agent-state/${r.taskId}-${arm}/codex-home/sessions`;
      const cands = P.walk(cell).filter(x => x.endsWith('.jsonl'));
      let best = null;
      for (const x of cands) { const head = fs.readFileSync(x, 'utf8').slice(0, 4000); if (head.includes(`/runs/r${r.rep}-`)) { const sz = fs.statSync(x).size; if (!best || sz > best.sz) best = { x, sz }; } }
      if (!best) continue; f = best.x;
    }
    S.rollouts++;
    for (const d of jl(f)) if (d.type === 'event_msg' && d.payload?.type === 'agent_message') tally(S, String(d.payload.message || ''));
  }
  fin(S);
}
// claude-code
for (const arm of ['sweet', 'native']) {
  const S = out[`claude-${arm}`] = { rollouts: 0, assistantChars: 0, stateChars: 0, blocks: 0 };
  const rows = JSON.parse(fs.readFileSync(`${BASE}/${P.RUNS.TAB}/rows.json`, 'utf8')).filter(r => r.arm === arm);
  for (const task of [...new Set(rows.map(r => r.taskId))]) {
    const ts = P.transcriptsOf(P.RUNS.TAB, task, arm);
    const byRep = new Map();
    for (const t of ts) { const x = byRep.get(t.rep); if (!x || t.size > x.size) byRep.set(t.rep, t); }
    for (const [, t] of byRep) {
      S.rollouts++;
      const { events } = P.parseTranscript(t.file);
      for (const e of events) if (e.k === 'text' && e.role === 'assistant') tally(S, e.text);
    }
  }
  fin(S);
}
console.log(JSON.stringify(out, null, 1));

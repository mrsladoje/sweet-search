// synth-codex-wasted.mjs — price the request that follows a wasted ss-* call on codex.
// Record order in a codex rollout: function_call -> function_call_output -> token_count(request j that
// EMITTED the call). The output is ingested by request j+1, so the wasted call is charged token_count[j+1].
// Read-only over fp-codex-{tab,none,pipe}-20260826 sweet arm.
import fs from 'node:fs';
import path from 'node:path';
import * as P from '/tmp/fp-inv/e4-claude-code/parse.mjs';
const BASE = P.ROOT + '/results';
const RUNS = { TAB: 'fp-codex-tab-20260826', NONE: 'fp-codex-none-20260826', PIPE: 'fp-codex-pipe-20260826' };
const usd = (u) => (((u.input_tokens || 0) - (u.cached_input_tokens || 0)) * 0.10 + (u.cached_input_tokens || 0) * 0.01 + ((u.output_tokens || 0) + (u.reasoning_output_tokens || 0)) * 0.60) / 1e6;
const CLS = {
  crash: /\[ss-\*\] crash:/,
  usage: /(\[ss\] unrecognised option|\[ss\] \d+ argument\(s\) not consumed|^Usage: ss-)/m,
  enoent: /\[ss-read\] error: stat failed: ENOENT/,
  grepZero: /^# ss-grep: 0 total match/m,
};
const SSREAD = /ss-read\s+(?:--force\s+)?([^\s;&|'"`-][^\s;&|'"`]*)/g;
const SCOPE = /--in\s+([^\s;&|'"`]+)/;
const out = {};
for (const [form, runId] of Object.entries(RUNS)) {
  const rows = JSON.parse(fs.readFileSync(`${BASE}/${runId}/rows.json`, 'utf8')).filter(r => r.arm === 'sweet');
  const S = out[form] = { rollouts: 0, requests: 0, cellUsd: 0, wasted: { crash: 0, usage: 0, enoent: 0, scopedNoMatch: 0 }, wastedUsd: { crash: 0, usage: 0, enoent: 0, scopedNoMatch: 0 }, forceRetry: 0, forceRetryUsd: 0, rolloutsWithWaste: 0 };
  for (const r of rows) {
    let f = r.rolloutFile; if (f && !f.startsWith('/')) f = path.join(P.ROOT, f);
    if (!f || !fs.existsSync(f)) {
      const cell = `${BASE}/${runId}/agent-state/${r.taskId}-sweet/codex-home/sessions`;
      let best = null;
      for (const x of P.walk(cell).filter(x => x.endsWith('.jsonl'))) { const head = fs.readFileSync(x, 'utf8').slice(0, 4000); if (head.includes(`/runs/r${r.rep}-`)) { const sz = fs.statSync(x).size; if (!best || sz > best.sz) best = { x, sz }; } }
      if (!best) continue; f = best.x;
    }
    S.rollouts++;
    const recs = P.jl(f);
    const turns = []; const calls = []; const outputs = new Map();
    let turnIdx = 0;
    for (const d of recs) {
      if (d.type === 'event_msg' && d.payload?.type === 'token_count' && d.payload.info?.last_token_usage) { turns.push(d.payload.info.last_token_usage); turnIdx++; continue; }
      if (d.type === 'response_item' && d.payload?.type === 'function_call') {
        let cmd = ''; try { const a = JSON.parse(d.payload.arguments || '{}'); cmd = String(a.cmd || a.command || ''); } catch { cmd = String(d.payload.arguments || ''); }
        calls.push({ id: d.payload.call_id, cmd, req: turnIdx });
      }
      if (d.type === 'response_item' && d.payload?.type === 'function_call_output') outputs.set(d.payload.call_id, String(d.payload.output || ''));
    }
    S.requests += turns.length; S.cellUsd += turns.reduce((a, u) => a + usd(u), 0);
    const readSoFar = new Set(); let any = false;
    for (const k of calls) {
      const res = outputs.get(k.id) || ''; const cmd = k.cmd;
      if (!/ss-(read|grep|search|find|semantic|trace)/.test(cmd)) continue;
      let cls = null;
      if (CLS.crash.test(res)) cls = 'crash';
      else if (CLS.usage.test(res)) cls = 'usage';
      else if (CLS.enoent.test(res)) cls = 'enoent';
      else if (CLS.grepZero.test(res)) { const m = cmd.match(SCOPE); if (m && [...readSoFar].some(p => p === m[1] || p.startsWith(m[1].replace(/\/$/, '') + '/') || p.endsWith('/' + m[1]))) cls = 'scopedNoMatch'; }
      const nxt = turns[k.req + 1];
      if (/ss-read\s+--force/.test(cmd)) { S.forceRetry++; if (nxt) S.forceRetryUsd += usd(nxt); }
      let m; SSREAD.lastIndex = 0; while ((m = SSREAD.exec(cmd))) if (!CLS.enoent.test(res)) readSoFar.add(m[1]);
      if (!cls) continue;
      any = true; S.wasted[cls]++; if (nxt) S.wastedUsd[cls] += usd(nxt);
    }
    if (any) S.rolloutsWithWaste++;
  }
  const w = Object.values(S.wastedUsd).reduce((a, b) => a + b, 0);
  S.meanRequestUsd = +(S.cellUsd / S.requests).toFixed(6);
  S.cellUsdPerRollout = +(S.cellUsd / S.rollouts).toFixed(6);
  S.wastedCallsPerRollout = +(Object.values(S.wasted).reduce((a, b) => a + b, 0) / S.rollouts).toFixed(2);
  S.wastedUsdPerRollout = +(w / S.rollouts).toFixed(6);
  S.wastedShareOfCell = +(w / S.cellUsd).toFixed(4);
  S.forceRetryUsdPerRollout = +(S.forceRetryUsd / S.rollouts).toFixed(6);
  for (const k of Object.keys(S.wastedUsd)) S.wastedUsd[k] = +S.wastedUsd[k].toFixed(5);
  S.cellUsd = +S.cellUsd.toFixed(5); S.forceRetryUsd = +S.forceRetryUsd.toFixed(5);
}
console.log(JSON.stringify(out, null, 1));

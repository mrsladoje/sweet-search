// synth-cc-wasted.mjs — price the requests that follow a wasted ss-* call on claude-code.
// A wasted call = crash, usage error, ss-read ENOENT, or a scoped (no matches) on a path the same
// rollout had already read through ss-read. The request after the call ingests its result and
// produces the next output; that request's ideal price is the cost of the wasted call.
// Read-only over fp-claudecode-{tab,none,pipe}-20260826 sweet arm (+ native Read census incl. subagents).
import fs from 'node:fs';
import * as P from '/tmp/fp-inv/e4-claude-code/parse.mjs';

const BASE = P.ROOT + '/results';
const PR = { in: 0.10, cache: 0.01, out: 0.60 };
const priceUsage = (u) => ((u.input_tokens || 0) + (u.cache_creation_input_tokens || 0)) * PR.in / 1e6
  + (u.cache_read_input_tokens || 0) * PR.cache / 1e6 + (u.output_tokens || 0) * PR.out / 1e6;

// parse with request index attached to each tool_use block
function parseIdx(file) {
  const seen = new Set(); const seenUsage = new Set();
  const calls = new Map(); const usage = [];
  for (const d of P.jl(file)) {
    const m = d.message; if (!m) continue;
    const rid = d.requestId || m.id;
    const blocks = Array.isArray(m.content) ? m.content : [];
    for (const b of blocks) {
      if (b.type === 'tool_use') {
        if (seen.has(`tu:${b.id}`)) continue; seen.add(`tu:${b.id}`);
        calls.set(b.id, { id: b.id, name: b.name, input: b.input || {}, reqIdx: usage.length, result: '' });
      } else if (b.type === 'tool_result') {
        if (seen.has(`tr:${b.tool_use_id}`)) continue; seen.add(`tr:${b.tool_use_id}`);
        const c = b.content;
        const txt = typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.text || '').join('\n') : '';
        if (calls.has(b.tool_use_id)) calls.get(b.tool_use_id).result = txt;
      }
    }
    if (m.usage && rid && !seenUsage.has(rid)) { seenUsage.add(rid); usage.push(m.usage); }
  }
  return { calls: [...calls.values()], usage };
}
const ssReadPaths = (cmd) => { const o = []; const re = /ss-read\s+(?:--force\s+)?([^\s;&|'"`-][^\s;&|'"`]*)/g; let m; while ((m = re.exec(String(cmd || '')))) o.push(m[1]); return o; };
const inScope = (cmd) => { const m = String(cmd || '').match(/--in\s+([^\s;&|'"`]+)/); return m ? m[1] : null; };

const CLS = {
  crash: /\[ss-\*\] crash:/,
  usage: /(\[ss\] unrecognised option|\[ss\] \d+ argument\(s\) not consumed|^Usage: ss-)/m,
  enoent: /\[ss-read\] error: stat failed: ENOENT/,
  noMatches: /^\(no matches\)$/m,
};
const out = {};
for (const form of ['TAB', 'NONE', 'PIPE']) {
  const runId = P.RUNS[form];
  const rows = JSON.parse(fs.readFileSync(`${BASE}/${runId}/rows.json`, 'utf8')).filter(r => r.arm === 'sweet');
  const S = out[form] = { rollouts: 0, requests: 0, cellIdealUsd: 0, wasted: { crash: 0, usage: 0, enoent: 0, scopedNoMatch: 0 }, wastedUsd: { crash: 0, usage: 0, enoent: 0, scopedNoMatch: 0 }, rolloutsWithWaste: 0, meanRequestUsd: 0 };
  for (const task of [...new Set(rows.map(r => r.taskId))]) {
    const ts = P.transcriptsOf(runId, task, 'sweet');
    const byRep = new Map(); for (const t of ts) { const x = byRep.get(t.rep); if (!x || t.size > x.size) byRep.set(t.rep, t); }
    for (const [, t] of byRep) {
      S.rollouts++;
      const { calls, usage } = parseIdx(t.file);
      S.requests += usage.length;
      S.cellIdealUsd += usage.reduce((a, u) => a + priceUsage(u), 0);
      const readSoFar = new Set(); let any = false;
      for (const k of calls) {
        if (k.name !== 'Bash') continue;
        const cmd = k.input.command || ''; const res = k.result || '';
        let cls = null;
        if (CLS.crash.test(res)) cls = 'crash';
        else if (CLS.usage.test(res)) cls = 'usage';
        else if (CLS.enoent.test(res)) cls = 'enoent';
        else if (CLS.noMatches.test(res)) { const sc = inScope(cmd); if (sc && [...readSoFar].some(p => p === sc || p.endsWith('/' + sc) || sc.endsWith('/' + p))) cls = 'scopedNoMatch'; }
        for (const p of ssReadPaths(cmd)) if (!CLS.enoent.test(res)) readSoFar.add(p);
        if (!cls) continue;
        any = true; S.wasted[cls]++;
        const nxt = usage[k.reqIdx + 1]; if (nxt) S.wastedUsd[cls] += priceUsage(nxt);
      }
      if (any) S.rolloutsWithWaste++;
    }
  }
  S.meanRequestUsd = +(S.cellIdealUsd / S.requests).toFixed(6);
  S.cellIdealUsdPerRollout = +(S.cellIdealUsd / S.rollouts).toFixed(6);
  S.wastedCallsPerRollout = +(Object.values(S.wasted).reduce((a, b) => a + b, 0) / S.rollouts).toFixed(2);
  const wUsd = Object.values(S.wastedUsd).reduce((a, b) => a + b, 0);
  S.wastedUsdPerRollout = +(wUsd / S.rollouts).toFixed(6);
  S.wastedShareOfCell = +(wUsd / S.cellIdealUsd).toFixed(4);
  for (const k of Object.keys(S.wastedUsd)) S.wastedUsd[k] = +S.wastedUsd[k].toFixed(5);
  S.cellIdealUsd = +S.cellIdealUsd.toFixed(5);
}
// native Read census including subagents (reconcile with E1's 18.9/rollout)
{
  const rows = JSON.parse(fs.readFileSync(`${BASE}/${P.RUNS.TAB}/rows.json`, 'utf8')).filter(r => r.arm === 'native');
  let main = 0, sub = 0, n = 0;
  for (const task of [...new Set(rows.map(r => r.taskId))]) {
    const ts = P.transcriptsOf(P.RUNS.TAB, task, 'native');
    const byRep = new Map(); for (const t of ts) { const x = byRep.get(t.rep); if (!x || t.size > x.size) byRep.set(t.rep, t); }
    for (const [, t] of byRep) {
      n++;
      main += P.parseTranscript(t.file).calls.filter(c => c.name === 'Read').length;
      for (const s of t.sub) sub += P.parseTranscript(s).calls.filter(c => c.name === 'Read').length;
    }
  }
  out.nativeReadCensus = { rollouts: n, mainReadsPerRollout: +(main / n).toFixed(2), subagentReadsPerRollout: +(sub / n).toFixed(2), totalPerRollout: +((main + sub) / n).toFixed(2) };
}
console.log(JSON.stringify(out, null, 1));

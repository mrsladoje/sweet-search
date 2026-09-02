import fs from 'node:fs';
import path from 'node:path';
import { load, cellRows, mean, bootCI } from './e2-cells.mjs';
const d = load(); const R = d.rollouts;
const M = (rs, f) => mean(rs.map(f));
console.log('### paired inclusive-cost delta with a bootstrap CI over tasks, epoch C');
for (const h of ['codex', 'opencode', 'claude-code']) {
  const sw = cellRows(R, { epoch: 'C', harness: h, form: 'tab' }), na = cellRows(R, { epoch: 'C', harness: h, form: 'native' });
  const ts = [...new Set(na.map(r => r.taskId))];
  const ds = ts.map(t => M(sw.filter(r => r.taskId === t), r => r.totalUsd) - M(na.filter(r => r.taskId === t), r => r.totalUsd));
  const base = M(na, r => r.totalUsd); const [lo, hi] = bootCI(ds);
  console.log(`${h}\tpaired d$ ${mean(ds).toFixed(6)}\t${(mean(ds) / base * 100).toFixed(1)}%\tCI [${(lo / base * 100).toFixed(1)}%, ${(hi / base * 100).toFixed(1)}%]\ttasks ${ds.length}`);
}
console.log('\n### delegated (sub-agent) requests that carry NO usage record — the lower-bound gap');
function noUsage(file) {
  let t; try { t = fs.readFileSync(file, 'utf8'); } catch { return [0, 0]; }
  const ids = new Map();
  for (const l of t.split('\n')) {
    const s = l.trim(); if (!s || s[0] !== '{') continue;
    let e; try { e = JSON.parse(s); } catch { continue; }
    const m = e.message; if (!m || m.role !== 'assistant' || !m.id) continue;
    const u = m.usage;
    const has = !!u && ((u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0)) > 0;
    ids.set(m.id, (ids.get(m.id) || false) || has);
  }
  let n = 0, z = 0; for (const v of ids.values()) { n++; if (!v) z++; }
  return [n, z];
}
for (const run of ['fp-claudecode-tab-20260826', 'fp-claudecode-none-20260826', 'fp-claudecode-pipe-20260826', 'rb-claudecode-20260824', 'sb-claudecode-20260811']) {
  const base = `/root/sweet-search-private/eval/task-completion-bench/results/${run}/agent-state`;
  const acc = {};
  let cells; try { cells = fs.readdirSync(base); } catch { continue; }
  for (const cell of cells) {
    const arm = cell.endsWith('-native') ? 'native' : 'sweet';
    const stack = [path.join(base, cell, 'claude-home', 'projects')];
    while (stack.length) {
      const dd = stack.pop(); let es; try { es = fs.readdirSync(dd, { withFileTypes: true }); } catch { continue; }
      for (const e of es) {
        const p = path.join(dd, e.name);
        if (e.isDirectory()) { stack.push(p); continue; }
        if (!e.name.endsWith('.jsonl') || !dd.includes('subagents')) continue;
        const [n, z] = noUsage(p);
        acc[arm] = acc[arm] || { files: 0, requests: 0, noUsage: 0 };
        acc[arm].files++; acc[arm].requests += n; acc[arm].noUsage += z;
      }
    }
  }
  console.log(run, JSON.stringify(acc));
}
console.log('\n### epoch A -> C component change, paired (sweet minus native), per harness');
console.log(['harness', 'component', 'A', 'B', 'C', 'A->C change'].join('\t'));
const comp = [['ingestUsd', 'INGEST $'], ['residentUsd', 'RESIDENT $'], ['outputUsd', 'OUTPUT $'],
  ['sidechainUsd', 'sidechain $'], ['turns', 'turns'], ['ctxIntegral', 'context integral'],
  ['toolBytes', 'tool bytes'], ['tokNewIn', 'new input tokens'], ['tokOut', 'output tokens'], ['calls', 'tool calls']];
for (const h of ['codex', 'opencode', 'claude-code']) {
  const vals = {};
  for (const [e, f] of [['A', 'pipe'], ['B', 'tab'], ['C', 'tab']]) {
    const sw = cellRows(R, { epoch: e, harness: h, form: f }), na = cellRows(R, { epoch: e, harness: h, form: 'native' });
    const ts = [...new Set(na.map(r => r.taskId))].filter(t => sw.some(r => r.taskId === t));
    vals[e] = {};
    for (const [k] of comp) vals[e][k] = mean(ts.map(t => M(sw.filter(r => r.taskId === t), r => r[k] || 0) - M(na.filter(r => r.taskId === t), r => r[k] || 0)));
  }
  for (const [k, label] of comp) {
    const f = v => (Math.abs(v) < 0.01 ? v.toFixed(6) : v.toFixed(1));
    console.log([h, label, f(vals.A[k]), f(vals.B[k]), f(vals.C[k]), f(vals.C[k] - vals.A[k])].join('\t'));
  }
}

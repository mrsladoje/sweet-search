// e2-convention.mjs — reproduce the FRESH-POOL "3 dearest transcripts per cell" claude-code
// reconstruction and compare it with the row-matched one.
import fs from 'node:fs';
import path from 'node:path';
const R = '/root/sweet-search-private/eval/task-completion-bench/results';
const P = { in: 0.10, cache: 0.01, out: 0.60 };
function turnsOf(file) {
  const turns = []; let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return turns; }
  const order = [], byId = new Map();
  for (const l of text.split('\n')) {
    const s = l.trim(); if (!s || s[0] !== '{') continue;
    let e; try { e = JSON.parse(s); } catch { continue; }
    const m = e.message; if (!m || m.role !== 'assistant' || !m.id) continue;
    if (!byId.has(m.id)) { byId.set(m.id, null); order.push(m.id); }
    const u = m.usage; if (!u) continue;
    const cached = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
    const IN = (u.input_tokens || 0) + cached + cw, out = u.output_tokens || 0;
    const cur = byId.get(m.id);
    if (!cur || IN + out > cur.in + cur.out) byId.set(m.id, { in: IN, cached, cacheWrite: cw, out });
  }
  for (const id of order) { const u = byId.get(id); if (u && (u.in || u.out)) turns.push(u); }
  return turns;
}
const cost = ts => ts.reduce((a, t) => a + ((t.in - t.cached - t.cacheWrite) * P.in + t.cacheWrite * P.in * 1.25
  + t.cached * P.cache + t.out * P.out) / 1e6, 0);
for (const [run, arm] of [['fp-claudecode-tab-20260826', 'native'], ['fp-claudecode-tab-20260826', 'sweet'],
  ['fp-claudecode-none-20260826', 'sweet'], ['fp-claudecode-pipe-20260826', 'sweet'],
  ['rb-claudecode-20260824', 'native'], ['rb-claudecode-20260824', 'sweet']]) {
  const base = path.join(R, run, 'agent-state');
  let all3 = 0, allAll = 0, n = 0, cells = 0;
  for (const cell of fs.readdirSync(base)) {
    if (!cell.endsWith(`-${arm}`)) continue;
    const proj = path.join(base, cell, 'claude-home', 'projects');
    let dirs; try { dirs = fs.readdirSync(proj); } catch { continue; }
    const costs = [];
    for (const dd of dirs) for (const f of fs.readdirSync(path.join(proj, dd)))
      if (f.endsWith('.jsonl')) costs.push(cost(turnsOf(path.join(proj, dd, f))));
    costs.sort((a, b) => b - a);
    all3 += costs.slice(0, 3).reduce((a, b) => a + b, 0);
    allAll += costs.reduce((a, b) => a + b, 0);
    n += Math.min(3, costs.length); cells++;
  }
  console.log(`${run}\t${arm}\tcells ${cells}\t3-dearest main $${all3.toFixed(6)}\tevery-transcript main $${allAll.toFixed(6)}`);
}

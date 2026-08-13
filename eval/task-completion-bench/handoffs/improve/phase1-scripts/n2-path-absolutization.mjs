// NEW CANDIDATE — "absolute paths in agent-format output".
// Found in the gate-5 census, absent from every slate. Sweet's edit failures include a
// wrong-path class where the agent writes the run directory with `--` in place of `__`:
//   /root/.ss-eval/runs/pytask-dev__pytask-210__sweet__r0--51/src/_pytask/traceback.py
//                                                        ^^ the real directory has __
// The mechanism is specific and sweet-only. Claude Code's Edit tool REQUIRES an absolute path.
// Native's Read tool hands the model an absolute path it can copy. Sweet's ss-* tools emit
// REPO-RELATIVE paths, so the model must absolutize by hand, and it mistypes the long run
// directory. If that is what is happening, the fix is to emit the absolute path in agent format.
//
// Measured here: the tax, the arm split, and the falsifiable prediction that sweet's wrong-path
// failures use paths the model CONSTRUCTED rather than paths a tool ever printed.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { costFromTurns, priceFor } from '/root/sweet-search-private/eval/task-completion-bench/harness/ideal-cost.mjs';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUNS = { claude: 'sb-claudecode-20260811', screen: 'screen-v3-20260812' };

const out = [];
for (const [h, run] of Object.entries(RUNS)) {
  const root = path.join(RESULTS, run, 'agent-state');
  if (!existsSync(root)) continue;
  const rows = JSON.parse(readFileSync(path.join(RESULTS, run, 'rows.json'), 'utf8'));
  const walk = (d, acc = [], depth = 0) => { if (depth > 10) return acc;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return acc; }
    for (const e of es) { const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, acc, depth + 1); else if (e.name.endsWith('.jsonl')) acc.push(p); } return acc; };
  for (const f of walk(root)) {
    if (!f.includes('/claude-home/projects/') || f.includes('/subagents/')) continue;
    const cell = f.slice(root.length + 1).split('/')[0];
    const arm = cell.endsWith('-native') ? 'native' : 'sweet';
    const task = cell.replace(/-(native|sweet)$/, '');
    const row = rows.find(r => r.taskId === task && r.arm === arm);
    const price = priceFor(row?.model || 'openai/gpt-5.6-luna');

    // per-request cost, tool calls, and every absolute path a TOOL RESULT ever printed
    const order = [], byId = new Map(), callReq = new Map();
    const printedPaths = new Set();
    const lines = readFileSync(f, 'utf8').split('\n');
    for (const line of lines) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let e; try { e = JSON.parse(t); } catch { continue; }
      const m = e.message; if (!m) continue;
      if (m.role === 'assistant' && m.id) {
        if (!byId.has(m.id)) { byId.set(m.id, { usage: null, best: -1 }); order.push(m.id); }
        const r = byId.get(m.id), u = m.usage || {};
        const tot = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
        if (tot > r.best) { r.best = tot; r.usage = u; }
        for (const b of (m.content || [])) if (b.type === 'tool_use') callReq.set(b.id, { req: m.id, name: b.name, input: b.input });
      }
      for (const b of (m.content || [])) {
        if (b.type !== 'tool_result') continue;
        const txt = typeof b.content === 'string' ? b.content
          : Array.isArray(b.content) ? b.content.map(x => x?.text || '').join('') : '';
        for (const mm of txt.matchAll(/\/root\/\.ss-eval\/runs\/[^\s"'`)\]:,]+/g)) printedPaths.add(mm[0]);
      }
    }
    const turns = order.map(id => { const u = byId.get(id).usage || {};
      const cr = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
      return { in: (u.input_tokens || 0) + cr + cw, cached: cr, cacheWrite: cw, out: u.output_tokens || 0 }; });
    const perReq = turns.map(t => costFromTurns([t], price).idealUsd);
    const idx = new Map(order.map((id, i) => [id, i]));

    for (const line of lines) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let e; try { e = JSON.parse(t); } catch { continue; }
      for (const b of (e.message?.content || [])) {
        if (b.type !== 'tool_result') continue;
        const txt = typeof b.content === 'string' ? b.content
          : Array.isArray(b.content) ? b.content.map(x => x?.text || '').join('') : '';
        if (!/File does not exist/i.test(txt)) continue;
        const c = callReq.get(b.tool_use_id); if (!c) continue;
        const fp = String(c.input?.file_path || c.input?.path || '');
        const isAbs = fp.startsWith('/');
        const wasPrinted = [...printedPaths].some(p => p === fp || fp.startsWith(p));
        // the run-directory segment the model wrote, and whether it is well-formed
        const seg = (/\/root\/\.ss-eval\/runs\/([^/]+)/.exec(fp) || [])[1] || '';
        const malformed = /--\d+$|--(native|sweet)|--r\d+/.test(seg);
        out.push({ h, task, arm, tool: c.name, fp, isAbs, wasPrinted, seg, malformed,
          cost: perReq[idx.get(c.req)] ?? 0 });
      }
    }
  }
}

console.log('=== wrong-path tool failures, both Claude runs ===\n');
for (const arm of ['sweet', 'native']) {
  const rs = out.filter(x => x.arm === arm);
  const mal = rs.filter(x => x.malformed);
  const printed = rs.filter(x => x.wasPrinted);
  const cost = rs.reduce((a, x) => a + x.cost, 0);
  const malCost = mal.reduce((a, x) => a + x.cost, 0);
  console.log(`${arm}: ${rs.length} failures | absolute ${rs.filter(x => x.isAbs).length} | path a tool had PRINTED ${printed.length} | run-dir segment MALFORMED ${mal.length}`);
  console.log(`   wasted round trips $${cost.toFixed(6)}  (malformed-segment share $${malCost.toFixed(6)})`);
  for (const x of rs) {
    console.log(`   ${x.malformed ? 'MALFORMED' : 'ok-segment'} ${x.wasPrinted ? 'copied  ' : 'invented'} ${x.h.padEnd(7)} ${x.task.padEnd(40)} $${x.cost.toFixed(6)}  ${x.seg}`);
  }
  console.log('');
}

console.log('=== the falsifiable prediction ===');
const sweet = out.filter(x => x.arm === 'sweet'), nat = out.filter(x => x.arm === 'native');
const p = (rs) => rs.length ? `${rs.filter(x => x.wasPrinted).length}/${rs.length}` : '0/0';
console.log(`If sweet must ABSOLUTIZE BY HAND while native COPIES a printed path, then sweet's failing`);
console.log(`paths should rarely be ones a tool printed, and native's should not be malformed at all.`);
console.log(`  sweet failing paths that a tool had printed : ${p(sweet)}`);
console.log(`  native failing paths that a tool had printed: ${p(nat)}`);
console.log(`  sweet malformed run-dir segments : ${sweet.filter(x => x.malformed).length}/${sweet.length}`);
console.log(`  native malformed run-dir segments: ${nat.filter(x => x.malformed).length}/${nat.length}`);

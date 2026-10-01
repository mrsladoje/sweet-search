#!/usr/bin/env node
/**
 * analyze-claude — forensics tables for the two Claude Code cells, from the normalised traces.
 *   node core/prompt-optimization/data/final-tuning/trace/analyze-claude.mjs <cell> [--section a|b|c|d|e|all]
 * Reads only core/prompt-optimization/data/results/final-tuning-trace/<cell>.trace.jsonl (and the
 * session stores for the cost-state cross-check). Prints markdown tables; no side effects.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const cell = process.argv[2];
const section = (process.argv.includes('--section') ? process.argv[process.argv.indexOf('--section') + 1] : 'all');
const PRICES = { 'cc-opus55-medium': { in: 4, cache: 0.2, out: 20 }, 'cc-sonnet55-high': { in: 2, cache: 0.2, out: 10 } };
const P = PRICES[cell]; // = ideal-cost.mjs MODEL_PRICES for claude-opus-5-5 / claude-sonnet-5-5, i.e. what the runner used
const all = fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/results/final-tuning-trace', `${cell}.trace.jsonl`), 'utf8')
  .split('\n').filter(Boolean).map(JSON.parse);
const roll = all.filter(r => r.type === 'rollout');
const req = all.filter(r => r.type !== 'rollout');
const ARMS = ['native', 'sweet'];
const sum = (a, f = x => x) => a.reduce((s, x) => s + f(x), 0);
const mean = (a) => (a.length ? sum(a) / a.length : NaN);
const median = (a) => { const b = [...a].sort((x, y) => x - y); const n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : NaN; };
const f0 = (x) => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : '-');
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '-');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '-');
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '-');
const f4 = (x) => (Number.isFinite(x) ? x.toFixed(4) : '-');
const usd = (x) => `$${x.toFixed(4)}`;
const pc = (x) => `${(100 * x).toFixed(1)}%`;
const arm = (a) => ({ rolls: roll.filter(r => r.arm === a), reqs: req.filter(r => r.arm === a) });
const H = (t) => console.log(`\n### ${t}\n`);
const table = (head, rows) => { console.log(`| ${head.join(' | ')} |`); console.log(`|${head.map(() => '---').join('|')}|`); for (const r of rows) console.log(`| ${r.join(' | ')} |`); };

// cost components (runner basis: write 1.25x)
const comp = (rs) => ({
  unc: sum(rs, r => r.tok.inUncached) * P.in / 1e6,
  cr: sum(rs, r => r.tok.cacheRead) * P.cache / 1e6,
  cw: sum(rs, r => r.tok.cacheWrite) * P.in * 1.25 / 1e6,
  out: sum(rs, r => r.tok.out) * P.out / 1e6,
  cw1h2x: sum(rs, r => r.tok.cacheWrite1h ?? 0) * P.in * 2 / 1e6 + sum(rs, r => r.tok.cacheWrite5m ?? 0) * P.in * 1.25 / 1e6,
});

if (section === 'a' || section === 'all') {
  H(`a1. Per request position, main thread (${cell}); sidechain requests: ${req.filter(r => r.thread !== 'main').length}`);
  const pos = [0, 1, 2, 3, 4, '5+'];
  const rows = [];
  for (const p of pos) for (const a of ARMS) {
    const rs = arm(a).reqs.filter(r => r.thread === 'main' && (p === '5+' ? r.req >= 5 : r.req === p));
    if (!rs.length) { rows.push([String(p), a, '0', '-', '-', '-', '-', '-']); continue; }
    rows.push([String(p), a, String(rs.length), f0(mean(rs.map(r => r.tok.inUncached))), f0(mean(rs.map(r => r.tok.cacheRead))), f0(mean(rs.map(r => r.tok.cacheWrite))), f0(mean(rs.map(r => r.tok.out))), pc(sum(rs, r => r.tok.cacheRead) / sum(rs, r => r.tok.inTotal))]);
  }
  table(['req', 'arm', 'n', 'inUncached', 'cacheRead', 'cacheWrite', 'out', 'hit ratio (cr/in)'], rows);

  H('a2. Cost split, all rollouts (runner basis: cache write 1.25x; "TTL-aware" = 1h writes at 2x)');
  const rows2 = [];
  for (const a of ARMS) {
    const c = comp(arm(a).reqs); const tot = c.unc + c.cr + c.cw + c.out; const n = arm(a).rolls.length;
    rows2.push([a, usd(tot), usd(c.unc), usd(c.cr), usd(c.cw), usd(c.out), usd(tot - c.cw + c.cw1h2x), usd(tot / n)]);
  }
  table(['arm', 'total', 'uncached-in', 'cache-read', 'cache-write', 'output', 'total TTL-aware (1h write 2x)', 'per rollout'], rows2);
  const cn = comp(arm('native').reqs), cs = comp(arm('sweet').reqs);
  const tn = cn.unc + cn.cr + cn.cw + cn.out, ts = cs.unc + cs.cr + cs.cw + cs.out;
  console.log(`\nsweet vs native: runner basis ${pc(ts / tn - 1)}; TTL-aware ${pc((ts - cs.cw + cs.cw1h2x) / (tn - cn.cw + cn.cw1h2x) - 1)}`);
  const nn = (a) => sum(arm(a).reqs, r => r.tok.inTotal) * P.in / 1e6 + sum(arm(a).reqs, r => r.tok.out) * P.out / 1e6;
  console.log(`naive no-cache basis (inTotal x in + out x out): native ${usd(nn('native'))} sweet ${usd(nn('sweet'))} -> ${pc(nn('sweet') / nn('native') - 1)}`);
  console.log(`\nShare of each arm's cost by component: `);
  for (const a of ARMS) { const c = comp(arm(a).reqs); const t = c.unc + c.cr + c.cw + c.out; console.log(`  ${a}: uncached ${pc(c.unc / t)}, read ${pc(c.cr / t)}, write ${pc(c.cw / t)}, output ${pc(c.out / t)}`); }
  console.log('\nTokens by class (all rollouts):');
  table(['arm', 'inUncached', 'cacheRead', 'cacheWrite', 'inTotal', 'out', 'write share of inTotal'], ARMS.map(a => { const r = arm(a).reqs; return [a, f0(sum(r, x => x.tok.inUncached)), f0(sum(r, x => x.tok.cacheRead)), f0(sum(r, x => x.tok.cacheWrite)), f0(sum(r, x => x.tok.inTotal)), f0(sum(r, x => x.tok.out)), pc(sum(r, x => x.tok.cacheWrite) / sum(r, x => x.tok.inTotal))]; }));
  console.log('\nCache TTL split of writes (1h vs 5m tokens):');
  table(['arm', 'cacheWrite 1h', 'cacheWrite 5m', 'unknown'], ARMS.map(a => { const r = arm(a).reqs; return [a, f0(sum(r, x => x.tok.cacheWrite1h ?? 0)), f0(sum(r, x => x.tok.cacheWrite5m ?? 0)), f0(sum(r, x => x.tok.cacheWrite - (x.tok.cacheWrite1h ?? 0) - (x.tok.cacheWrite5m ?? 0)))]; }));

  H('a3. Claude Code own ledger (cost-state.totalCostUSD) vs TTL-aware and runner basis, per arm');
  const rows3 = [];
  for (const a of ARMS) {
    let cs_ = 0, n = 0;
    for (const r of arm(a).rolls) {
      const line = fs.readFileSync(r.sessionFile, 'utf8').split('\n').filter(l => l.includes('"cost-state"')).pop();
      if (line) { cs_ += JSON.parse(line).totalCostUSD; n++; }
    }
    const c = comp(arm(a).reqs); const tot = c.unc + c.cr + c.cw + c.out;
    rows3.push([a, String(n), usd(cs_), usd(tot - c.cw + c.cw1h2x), usd(tot)]);
  }
  table(['arm', 'rollouts', 'cost-state total (Claude Code)', 'TTL-aware recompute', 'runner basis'], rows3);

  H('a4. Fixed prefix (system + tools + reminders), tokens, req 0 minus question text/4');
  const rows4 = [];
  for (const a of ARMS) {
    const r = arm(a).rolls; const pf = r.map(x => x.prefixTokens);
    const first = r[0];
    rows4.push([a, f0(mean(pf)), f0(median(pf)), f0(Math.min(...pf)), f0(Math.max(...pf)), f0(mean(r.map(x => x.req0.cacheRead))), f0(mean(r.map(x => x.req0.cacheWrite))), pc(r.filter(x => x.req0.cacheRead > 0).length / r.length), pc(r.filter(x => x.req0.cacheWrite > 0).length / r.length), f0(first?.ctx.systemPromptChars), f0(first?.ctx.instructionFiles.reduce((s, f) => s + f.chars, 0))]);
  }
  table(['arm', 'prefix mean', 'median', 'min', 'max', 'req0 cacheRead mean', 'req0 cacheWrite mean', 'req0 cr>0', 'req0 cw>0', 'system prompt chars', 'rules-file chars'], rows4);

  H('a5. Prefix stability: req-0 (cacheRead, cacheWrite) within one repo, first rollout vs later; and cross-repo');
  const rows5 = [];
  for (const a of ARMS) {
    const byCwd = new Map();
    for (const r of arm(a).rolls.sort((x, y) => (x.tsStart < y.tsStart ? -1 : 1))) { const k = r.cwd; if (!byCwd.has(k)) byCwd.set(k, []); byCwd.get(k).push(r); }
    const firsts = [], laters = [];
    for (const v of byCwd.values()) { v.forEach((r, i) => (i === 0 ? firsts : laters).push(r)); }
    const tot = (x) => x.req0.inTotal - Math.ceil(x.firstUserChars / 4);
    rows5.push([a, String(byCwd.size), 'first-in-repo', String(firsts.length), f0(mean(firsts.map(x => x.req0.cacheRead))), f0(mean(firsts.map(x => x.req0.cacheWrite))), f0(mean(firsts.map(tot)))]);
    rows5.push([a, '', 'later-in-repo', String(laters.length), f0(mean(laters.map(x => x.req0.cacheRead))), f0(mean(laters.map(x => x.req0.cacheWrite))), f0(mean(laters.map(tot)))]);
    // within-repo spread of req0 cacheRead for later rollouts (byte stability)
    const warmCr = arm(a).rolls.filter(x => x.req0.cacheRead >= 0.9 * median(arm(a).rolls.map(y => y.req0.cacheRead)));
    const byCwdW = new Map(); for (const x of warmCr) { if (!byCwdW.has(x.cwd)) byCwdW.set(x.cwd, []); byCwdW.get(x.cwd).push(x.req0.cacheRead); }
    const spread = Math.max(...[...byCwdW.values()].map(v => Math.max(...v) - Math.min(...v)));
    const prefSpread = Math.max(...arm(a).rolls.map(x => x.prefixTokens)) - Math.min(...arm(a).rolls.map(x => x.prefixTokens));
    console.log(`${a}: warm rollouts: max within-repo spread of req-0 cacheRead = ${spread} tokens; spread of prefix estimate across ALL rollouts = ${prefSpread} tokens`);
    const cold = arm(a).rolls.filter(x => x.req0.cacheRead === 0).length;
    console.log(`${a}: rollouts whose req 0 read NOTHING from cache (cold start): ${cold}`);
  }
  table(['arm', 'repos', 'rollout', 'n', 'req0 cacheRead', 'req0 cacheWrite', 'prefix est'], rows5);
}

if (section === 'b' || section === 'all') {
  H('b. Turns, calls, sidechains');
  const rows = [];
  for (const a of ARMS) {
    const r = arm(a).rolls;
    const turns = r.map(x => x.requests), calls = r.map(x => x.calls);
    const cpt = r.map(x => x.calls / x.requests);
    rows.push([a, String(r.length), f2(mean(turns)), f1(median(turns)), f2(mean(calls)), f1(median(calls)), f2(mean(cpt)), f2(sum(calls) / sum(turns)), String(sum(r, x => x.sidechains)), usd(0)]);
  }
  table(['arm', 'rollouts', 'turns mean', 'turns median', 'calls mean', 'calls median', 'calls/turn mean(per rollout)', 'calls/turn pooled', 'sidechains', 'sidechain $'], rows);
  console.log('\nTurn-count distribution (share of rollouts):');
  const dist = {};
  for (const a of ARMS) for (const x of arm(a).rolls) { const k = Math.min(x.requests, 8); (dist[k] = dist[k] || { native: 0, sweet: 0 })[a]++; }
  table(['turns', 'native', 'sweet'], Object.keys(dist).sort((x, y) => x - y).map(k => [k === '8' ? '8+' : k, String(dist[k].native), String(dist[k].sweet)]));
  console.log('\nTool mix (calls; Bash split by first word):');
  for (const a of ARMS) {
    const m = {};
    for (const r of arm(a).reqs) for (const c of r.calls) { const k = c.tool === 'Bash' ? `Bash:${c.sub}` : c.tool; m[k] = (m[k] || 0) + 1; }
    console.log(`  ${a}: ` + Object.entries(m).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(', '));
  }
  console.log('\nPer-tool result size (tokens est = chars/4):');
  const trows = [];
  for (const a of ARMS) {
    const m = {};
    for (const r of arm(a).reqs) for (const c of r.calls) { const k = c.tool === 'Bash' ? `Bash:${c.sub}` : c.tool; (m[k] = m[k] || []).push(c.resultTokensEst); }
    const tot = sum(Object.values(m).flat());
    for (const [k, v] of Object.entries(m).sort((x, y) => sum(y[1]) - sum(x[1]))) trows.push([a, k, String(v.length), f0(mean(v)), f0(median(v)), pc(sum(v) / tot)]);
  }
  table(['arm', 'tool', 'calls', 'result tok mean', 'median', '% of result tokens'], trows);
  console.log('\nCalls per request distribution (parallel calls):');
  for (const a of ARMS) { const d = {}; for (const r of arm(a).reqs) { const k = r.calls.length; d[k] = (d[k] || 0) + 1; } console.log(`  ${a}: ` + Object.entries(d).map(([k, v]) => `${k} calls: ${v}`).join(', ')); }
  console.log('\nPer-request result size (tool output tokens est) and later-request cost driver:');
  table(['arm', 'calls', 'result tokens/call mean', 'median', 'result tokens per rollout mean', 'isError calls'], ARMS.map(a => { const c = arm(a).reqs.flatMap(r => r.calls); return [a, String(c.length), f0(mean(c.map(x => x.resultTokensEst))), f0(median(c.map(x => x.resultTokensEst))), f0(sum(c, x => x.resultTokensEst) / arm(a).rolls.length), String(c.filter(x => x.isError).length)]; }));
}

if (section === 'c' || section === 'all') {
  H('c. Output tokens, visible text, tool-use tokens, thinking');
  const rows = [];
  for (const a of ARMS) {
    const r = arm(a).reqs, n = arm(a).rolls.length;
    const out = sum(r, x => x.tok.out);
    const textTok = sum(r, x => x.textOutChars) / 4;
    const argTok = sum(r, x => sum(x.calls, c => c.argChars)) / 4;
    const callCount = sum(r, x => x.calls.length);
    const toolTok = argTok + callCount * 12; // ~12 tokens of tool_use envelope (name, id, braces) per call: a labelled guess
    const repThink = sum(r, x => x.tok.reasoning ?? 0);
    const estThink = out - textTok - toolTok;
    rows.push([a, f1(out / n), f1(out / r.length), f1(textTok / n), f1(toolTok / n), f1(estThink / n), f1(repThink / n), pc(repThink / out), String(sum(r, x => x.thinkingChars)), String(r.filter(x => x.tok.reasoning > 0).length)]);
  }
  table(['arm', 'out tok / question', 'out tok / turn', 'visible text tok/q (chars/4)', 'tool_use tok/q (args/4 + 12/call)', 'thinking ESTIMATE tok/q (out - text - tool_use)', 'API-reported thinking_tokens /q', 'reported thinking share of out', 'readable thinking chars', 'requests with thinking_tokens>0'], rows);
  console.log('\nBy request position (out tokens):');
  table(['req', 'arm', 'n', 'out mean', 'text tok', 'tool tok', 'est thinking', 'reported thinking'], [0, 1, 2, '3+'].flatMap(p => ARMS.map(a => { const r = arm(a).reqs.filter(x => (p === '3+' ? x.req >= 3 : x.req === p)); const tt = mean(r.map(x => x.textOutChars / 4)); const tl = mean(r.map(x => sum(x.calls, c => c.argChars) / 4 + x.calls.length * 12)); const o = mean(r.map(x => x.tok.out)); return [String(p), a, String(r.length), f0(o), f0(tt), f0(tl), f0(o - tt - tl), f0(mean(r.map(x => x.tok.reasoning ?? 0)))]; })));
  // Calibration: requests WITHOUT a thinking block give the non-thinking cost of text and of tool_use blocks.
  console.log('\nThinking calibration (requests with no thinking block => out = visible text + tool_use envelope):');
  const cal = (rs, xf) => { // OLS out = a + b*x
    const n = rs.length, xs = rs.map(xf), ys = rs.map(r => r.tok.out); const mx = mean(xs), my = mean(ys);
    const b = sum(xs.map((x, i) => (x - mx) * (ys[i] - my))) / sum(xs, x => (x - mx) ** 2); return { a: my - b * mx, b, n };
  };
  const calRows = []; const models = {};
  for (const a of ARMS) {
    const nt = arm(a).reqs.filter(r => r.thinkingBlocks === 0);
    const tx = nt.filter(r => r.calls.length === 0 && r.textOutChars > 0);
    const tl = nt.filter(r => r.calls.length > 0 && r.textOutChars === 0);
    models[a] = { tx: cal(tx, r => r.textOutChars), tl: cal(tl, r => sum(r.calls, c => c.argChars)) };
    calRows.push([a, String(tx.length), `${f1(models[a].tx.a)} + ${f3(models[a].tx.b)} x chars`, String(tl.length), `${f1(models[a].tl.a)} + ${f3(models[a].tl.b)} x argChars`]);
  }
  table(['arm', 'text-only requests (n)', 'out tokens fit', 'tool-only requests (n)', 'out tokens fit'], calRows);
  const rows3 = [];
  for (const a of ARMS) {
    const M = models[a]; const rs = arm(a).reqs, n = arm(a).rolls.length;
    let thinkEst = 0, thinkReqs = 0, rep = 0, noThinkResid = 0;
    for (const r of rs) {
      const pred = (r.textOutChars ? M.tx.a + M.tx.b * r.textOutChars : 0) + (r.calls.length ? M.tl.a + M.tl.b * sum(r.calls, c => c.argChars) : 0);
      if (r.thinkingBlocks > 0) { thinkEst += Math.max(0, r.tok.out - pred); thinkReqs++; rep += r.tok.reasoning ?? 0; } else noThinkResid += r.tok.out - pred;
    }
    rows3.push([a, String(thinkReqs), pc(thinkReqs / rs.length), f1(thinkEst / n), f1(rep / n), pc(thinkEst / sum(rs, r => r.tok.out)), f1(noThinkResid / n)]);
  }
  table(['arm', 'requests with a thinking block', 'share of requests', 'thinking ESTIMATE tok/question (calibrated)', 'API thinking_tokens /question', 'estimate share of out', 'residual on non-thinking requests tok/q (sanity, ~0)'], rows3);
  console.log('\nOutput tokens per question, calibrated split (text + tool_use + thinking = out):');
  table(['arm', 'out / question', 'visible text', 'tool_use (args + envelope)', 'thinking (estimate)', 'out / turn', 'final-answer request out (mean)', 'non-final requests out (mean)'], ARMS.map(a => {
    const M = models[a]; const rs = arm(a).reqs, n = arm(a).rolls.length;
    const textT = sum(rs, r => (r.textOutChars ? M.tx.a + M.tx.b * r.textOutChars : 0)), toolT = sum(rs, r => (r.calls.length ? M.tl.a + M.tl.b * sum(r.calls, c => c.argChars) : 0));
    const fin = rs.filter(r => r.calls.length === 0), non = rs.filter(r => r.calls.length > 0);
    return [a, f1(sum(rs, r => r.tok.out) / n), f1(textT / n), f1(toolT / n), f1((sum(rs, r => r.tok.out) - textT - toolT) / n), f1(mean(rs.map(r => r.tok.out))), f1(mean(fin.map(r => r.tok.out))), f1(mean(non.map(r => r.tok.out)))];
  }));
  console.log('\nBlock presence: thinking blocks exist in the transcript but carry no readable text (thinkingChars is 0 everywhere => encrypted/redacted); the only count is usage.output_tokens_details.thinking_tokens.');
}

if (section === 'd' || section === 'all') {
  H('d. Decomposition of the sweet - native cost gap (runner basis, all 130 pairs)');
  const dec = (rs) => { const c = comp(rs); return { unc: c.unc, cr: c.cr, cw: c.cw, out: c.out, tot: c.unc + c.cr + c.cw + c.out }; };
  const split = (a) => {
    const r = arm(a).reqs;
    return { r0: dec(r.filter(x => x.req === 0)), rl: dec(r.filter(x => x.req > 0)), all: dec(r) };
  };
  const N = split('native'), S = split('sweet');
  const rows = [];
  const add = (label, n, s) => rows.push([label, usd(n), usd(s), usd(s - n), pc((s - n) / N.all.tot)]);
  add('req 0 cache write', N.r0.cw, S.r0.cw);
  add('req 0 cache read', N.r0.cr, S.r0.cr);
  add('req 0 uncached in', N.r0.unc, S.r0.unc);
  add('req 0 output', N.r0.out, S.r0.out);
  add('req 1+ cache write (tool results + replies)', N.rl.cw, S.rl.cw);
  add('req 1+ cache read', N.rl.cr, S.rl.cr);
  add('req 1+ uncached in', N.rl.unc, S.rl.unc);
  add('req 1+ output', N.rl.out, S.rl.out);
  add('TOTAL', N.all.tot, S.all.tot);
  table(['component', 'native', 'sweet', 'sweet - native', '% of native total'], rows);

  // req-0 cache-write gap split by what req 0 could read: warm (repo system prompt cached), first touch of a repo
  // (only the global tools prefix cached), cold (nothing cached). Level = median req-0 write of warm rollouts.
  console.log('\nReq-0 cache-write gap, split by req-0 cache state (tokens x write price; runner basis):');
  const W = P.in * 1.25 / 1e6;
  const medCr = Object.fromEntries(ARMS.map(a => [a, median(arm(a).rolls.map(x => x.req0.cacheRead))]));
  const klass = (r) => (r.req0.cacheRead === 0 ? 'cold' : r.req0.cacheRead < 0.9 * medCr[r.arm] ? 'first-touch' : 'warm');
  const info = (a) => {
    const rs = arm(a).rolls; const warm = rs.filter(r => klass(r) === 'warm');
    const level = median(warm.map(r => r.req0.cacheWrite));
    const o = { level, n: rs.length };
    for (const k of ['warm', 'first-touch', 'cold']) { const g = rs.filter(r => klass(r) === k); o[k] = { n: g.length, cw: mean(g.map(r => r.req0.cacheWrite)), cr: mean(g.map(r => r.req0.cacheRead)), excess: sum(g, r => r.req0.cacheWrite - level) * W }; }
    return o;
  };
  const In = info('native'), Is = info('sweet');
  table(['class', 'native n', 'native req0 read / write', 'sweet n', 'sweet req0 read / write'], ['warm', 'first-touch', 'cold'].map(k => [k, String(In[k].n), `${f0(In[k].cr)} / ${f0(In[k].cw)}`, String(Is[k].n), `${f0(Is[k].cr)} / ${f0(Is[k].cw)}`]));
  const prefixDelta = (Is.level - In.level) * In.n * W;
  table(['part of the req-0 write gap', '$'], [
    [`prefix delta: warm-level write ${f0(In.level)} -> ${f0(Is.level)} tokens, all ${In.n} rollouts`, usd(prefixDelta)],
    ['first-touch-in-repo excess (sweet - native)', usd(Is['first-touch'].excess - In['first-touch'].excess)],
    ['cold-start excess (sweet - native)', usd(Is.cold.excess - In.cold.excess)],
    ['warm-rollout deviation from level (sweet - native)', usd(Is.warm.excess - In.warm.excess)],
    ['sum = req-0 write gap', usd(prefixDelta + (Is['first-touch'].excess - In['first-touch'].excess) + (Is.cold.excess - In.cold.excess) + (Is.warm.excess - In.warm.excess))],
    ['measured req-0 write gap', usd(S.r0.cw - N.r0.cw)],
  ]);
}

if (section === 'e' || section === 'all') {
  H('e. Useful-content (USD judge `content`) mechanism');
  const rows = [];
  for (const a of ARMS) {
    const r = arm(a).rolls;
    rows.push([a, f3(mean(r.map(x => x.content ?? 0))), f3(mean(r.filter(x => x.score === 1).map(x => x.content ?? 0))), f1(mean(r.map(x => x.rawLenRebuilt))), pc(r.filter(x => x.rawLenRebuilt === 0).length / r.length), pc(r.filter(x => (x.content ?? 0) === 0).length / r.length), f3(mean(r.map(x => x.score ?? 0)))]);
  }
  table(['arm', 'content mean', 'content mean, correct only', 'rawResponse chars mean', 'rollouts with EMPTY rawResponse', 'rollouts with content=0', 'accuracy'], rows);
  console.log('\nWhich call outputs reach rawResponse (runner rule: sweet = ss + nativeRead only; native = all):');
  const rows2 = [];
  for (const a of ARMS) {
    const c = arm(a).reqs.flatMap(r => r.calls);
    const byKind = {};
    for (const x of c) { const k = x.runnerKind; const o = (byKind[k] = byKind[k] || { n: 0, chars: 0, inRaw: 0, inRawChars: 0 }); o.n++; o.chars += x.resultChars; if (x.inRawResponse) { o.inRaw++; o.inRawChars += x.resultChars; } }
    for (const [k, o] of Object.entries(byKind)) rows2.push([a, k, String(o.n), f0(o.chars), String(o.inRaw), f0(o.inRawChars)]);
    const tot = sum(c, x => x.resultChars), kept = sum(c.filter(x => x.inRawResponse), x => x.resultChars);
    rows2.push([a, 'ALL', String(c.length), f0(tot), String(c.filter(x => x.inRawResponse).length), `${f0(kept)} (${pc(kept / tot)})`]);
  }
  table(['arm', 'runner kind', 'calls', 'result chars', 'calls in rawResponse', 'chars in rawResponse'], rows2);
  console.log('\nWithin the sweet arm: content by whether ANY call output was dropped from rawResponse');
  const sw = arm('sweet').rolls; const reqsBy = new Map(); for (const r of arm('sweet').reqs) { const k = r.id; reqsBy.set(k, [...(reqsBy.get(k) || []), ...r.calls]); }
  const grp = { 'all outputs kept': [], 'some output dropped': [], 'no calls': [] };
  for (const r of sw) { const c = reqsBy.get(r.id) || []; if (!c.length) grp['no calls'].push(r); else if (c.some(x => !x.inRawResponse && x.resultChars > 0)) grp['some output dropped'].push(r); else grp['all outputs kept'].push(r); }
  table(['sweet group', 'rollouts', 'content mean', 'rawResponse chars mean', 'accuracy'], Object.entries(grp).map(([k, v]) => [k, String(v.length), f3(mean(v.map(x => x.content ?? 0))), f0(mean(v.map(x => x.rawLenRebuilt))), f3(mean(v.map(x => x.score ?? 0)))]));
  console.log('\nTool used as the FIRST call (sweet arm): ' );
  const first = {}; for (const r of sw) { const c = (reqsBy.get(r.id) || [])[0]; const k = c ? (c.tool === 'Bash' ? `Bash:${c.sub}` : c.tool) : 'none'; first[k] = (first[k] || 0) + 1; }
  console.log('  ' + Object.entries(first).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(', '));
  console.log('\nsweet rollouts with zero ss-* calls: ' + sw.filter(r => !(reqsBy.get(r.id) || []).some(c => c.tool.startsWith('ss-'))).length + ' / ' + sw.length);
}

if (section === 'e2' || section === 'all') {
  H('e2. Content by the FORMAT of the code the rollout read (natural experiment)');
  console.log('gutter = line-number prefix on every code line (ss-read with SS_READ_GUTTER=tab; Claude Code Read tool); plain = sed -n / cat / head / tail (no line numbers).');
  const callsBy = new Map(); for (const r of req) { const k = r.arm + '|' + r.id; callsBy.set(k, [...(callsBy.get(k) || []), ...r.calls]); }
  const isG = (c) => c.tool === 'ss-read' || c.tool === 'Read';
  const isP = (c) => c.tool === 'Bash' && ['sed', 'cat', 'head', 'tail', 'nl'].includes(c.sub);
  const groups = {};
  for (const r of roll) {
    const cs = callsBy.get(r.arm + '|' + r.id) || [];
    const g = cs.some(isG), p = cs.some(isP);
    const k = g && p ? 'both' : g ? 'gutter only' : p ? 'plain only' : 'no code-body read';
    (groups[`${r.arm}|${k}`] = groups[`${r.arm}|${k}`] || []).push(r);
  }
  const rows = Object.entries(groups).sort().map(([k, a]) => { const [ar, f] = k.split('|'); return [ar, f, String(a.length), f3(mean(a.map(x => x.content))), f3(mean(a.map(x => x.contentNoD3))), f3(mean(a.map(x => 5 * x.content - 4 * x.contentNoD3))), f3(mean(a.map(x => x.grounding))), f3(mean(a.map(x => x.score ?? 0)))]; });
  table(['arm', 'code read in rollout', 'n', 'content', 'D1,D2,D4,D5 mean', 'D3 (navigability)', 'grounding floor', 'accuracy'], rows);
  console.log('\nFormat sample (first 3 lines of one result): ');
  const ex = (pred) => { const c = req.flatMap(r => r.calls.map(x => ({ ...x, arm: r.arm }))).find(pred); return c ? JSON.stringify(c.resultText.split('\n').slice(0, 3)) : '-'; };
  console.log('  ss-read :', ex(c => c.tool === 'ss-read' && c.resultText.length > 100));
  console.log('  Read    :', ex(c => c.tool === 'Read' && c.resultText.length > 100));
  console.log('  sed -n  :', ex(c => c.sub === 'sed' && c.resultText.length > 100));
}

if (section === 'f' || section === 'all') {
  H('f. Cost attribution to tool results (runner basis). Result tokens = next request cacheWrite - this request out (what was appended), split over the request\'s calls by result chars; each token is written once (1.25x) and read in every later request');
  const Wp = P.in * 1.25 / 1e6, Rp = P.cache / 1e6, Op = P.out / 1e6;
  const tot = {}; const buckets = {};
  for (const a of ARMS) {
    const m = {}; let outCost = 0, resCost = 0, allCost = 0;
    const byRoll = new Map(); for (const r of arm(a).reqs) { if (!byRoll.has(r.id)) byRoll.set(r.id, []); byRoll.get(r.id).push(r); }
    for (const rs of byRoll.values()) {
      rs.sort((x, y) => x.req - y.req); const N = rs.length;
      for (let i = 0; i < N; i++) {
        const r = rs[i]; allCost += r.costUsd; outCost += r.tok.out * Op;
        if (!r.calls.length || i + 1 >= N) continue;
        const appended = Math.max(0, rs[i + 1].tok.cacheWrite + rs[i + 1].tok.inUncached - r.tok.out);
        const chars = sum(r.calls, c => c.resultChars) || 1; const laterReads = N - 2 - i; // requests after i+1
        for (const c of r.calls) {
          const k = c.tool === 'Bash' ? `Bash:${c.sub}` : c.tool; const tk = appended * c.resultChars / chars;
          const cost = tk * Wp + tk * Rp * Math.max(0, laterReads);
          const o = (m[k] = m[k] || { n: 0, tk: 0, cost: 0 }); o.n++; o.tk += tk; o.cost += cost; resCost += cost;
        }
      }
    }
    tot[a] = { m, allCost, outCost, resCost, nCalls: sum(Object.values(m), o => o.n) };
  }
  const rows = [];
  for (const a of ARMS) {
    const { m, allCost, nCalls } = tot[a];
    for (const [k, o] of Object.entries(m).sort((x, y) => y[1].cost - x[1].cost).slice(0, 7)) rows.push([a, k, String(o.n), pc(o.n / nCalls), f0(o.tk / o.n), usd(o.cost), pc(o.cost / allCost)]);
  }
  table(['arm', 'tool', 'calls', '% of calls', 'result tokens / call (derived)', 'result cost (write + later reads)', '% of arm cost'], rows);
  table(['arm', 'all tool results', 'output (args + text + thinking)', 'everything else (prefix, reminders, question, unattributed)', 'arm total'], ARMS.map(a => { const t = tot[a]; return [a, `${usd(t.resCost)} (${pc(t.resCost / t.allCost)})`, `${usd(t.outCost)} (${pc(t.outCost / t.allCost)})`, `${usd(t.allCost - t.resCost - t.outCost)} (${pc(1 - (t.resCost + t.outCost) / t.allCost)})`, usd(t.allCost)]; }));
}

if (section === 'g' || section === 'all') {
  H('g. Paired sweet - native per question (n=130), stratified bootstrap by set (B=20000, seed 42, as the runner)');
  const mulberry32 = (seed) => { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const per = (a) => { const m = new Map(); for (const r of roll.filter(x => x.arm === a)) m.set(r.id, { set: r.set, reqs: req.filter(q => q.arm === a && q.id === r.id), roll: r }); return m; };
  const N = per('native'), S = per('sweet');
  const cw2 = (r) => (r.tok.cacheWrite1h ?? 0) * P.in * 2 / 1e6 + (r.tok.cacheWrite5m ?? 0) * P.in * 1.25 / 1e6;
  const metrics = {
    'cost $ (runner basis, write 1.25x)': (x) => sum(x.reqs, r => r.costUsd),
    'cost $ (1h write 2x, Claude Code ledger)': (x) => sum(x.reqs, r => r.costUsd - r.tok.cacheWrite * P.in * 1.25 / 1e6 + cw2(r)),
    'req-0 cache-write $ (1.25x)': (x) => sum(x.reqs.filter(r => r.req === 0), r => r.tok.cacheWrite * P.in * 1.25 / 1e6),
    'req-1+ cache-write $ (1.25x)': (x) => sum(x.reqs.filter(r => r.req > 0), r => r.tok.cacheWrite * P.in * 1.25 / 1e6),
    'cache-read $': (x) => sum(x.reqs, r => r.tok.cacheRead * P.cache / 1e6),
    'output $': (x) => sum(x.reqs, r => r.tok.out * P.out / 1e6),
    'turns': (x) => x.reqs.length, 'calls': (x) => x.roll.calls,
    'naive no-cache $': (x) => sum(x.reqs, r => r.tok.inTotal * P.in / 1e6 + r.tok.out * P.out / 1e6),
  };
  const rows = [];
  for (const [name, f] of Object.entries(metrics)) {
    const ids = [...N.keys()]; const d = ids.map(id => ({ set: N.get(id).set, d: f(S.get(id)) - f(N.get(id)) }));
    const by = new Map(); for (const x of d) { if (!by.has(x.set)) by.set(x.set, []); by.get(x.set).push(x.d); }
    const rnd = mulberry32(42); const ms = [];
    for (let b = 0; b < 20000; b++) { let s = 0, n = 0; for (const ds of by.values()) for (let j = 0; j < ds.length; j++) { s += ds[Math.floor(rnd() * ds.length)]; n++; } ms.push(s / n); }
    ms.sort((x, y) => x - y);
    const nat = mean(ids.map(id => f(N.get(id)))), swt = mean(ids.map(id => f(S.get(id))));
    const lo = ms[Math.floor(0.025 * 20000)], hi = ms[Math.floor(0.975 * 20000)];
    rows.push([name, f4(nat), f4(swt), f4(swt - nat), pc(swt / nat - 1), `[${f4(lo)}, ${f4(hi)}]${lo > 0 || hi < 0 ? ' *' : ''}`]);
  }
  table(['metric (per question)', 'native', 'sweet', 'delta', 'rel', '95% CI of delta'], rows);
  console.log('\nBy set (runner-basis cost, sum over questions):');
  table(['set', 'n', 'native $', 'sweet $', 'rel'], ['vault', 'heldout', 'ood'].map(st => { const ids = [...N.keys()].filter(id => N.get(id).set === st); const a = sum(ids, id => sum(N.get(id).reqs, r => r.costUsd)), b = sum(ids, id => sum(S.get(id).reqs, r => r.costUsd)); return [st, String(ids.length), usd(a), usd(b), pc(b / a - 1)]; }));
}

if (section === 'sbs') {
  // compact side-by-side (native / sweet) tables for the forensics note
  const pair = (f) => ARMS.map(f).join(' / ');
  console.log(`\n#### ${cell}: per request position, main thread, mean tokens (native / sweet)\n`);
  table(['req', 'n', 'inUncached', 'cacheRead', 'cacheWrite', 'out', 'hit ratio'], [0, 1, 2, 3, 4, '5+'].map(p => {
    const g = (a) => arm(a).reqs.filter(r => r.thread === 'main' && (p === '5+' ? r.req >= 5 : r.req === p));
    return [String(p), pair(a => g(a).length), pair(a => f0(mean(g(a).map(r => r.tok.inUncached)))), pair(a => f0(mean(g(a).map(r => r.tok.cacheRead)))), pair(a => f0(mean(g(a).map(r => r.tok.cacheWrite)))), pair(a => f0(mean(g(a).map(r => r.tok.out)))), pair(a => pc(sum(g(a), r => r.tok.cacheRead) / sum(g(a), r => r.tok.inTotal)))];
  }));
  console.log(`\n#### ${cell}: dollars (native / sweet), 130 rollouts each\n`);
  const C = Object.fromEntries(ARMS.map(a => [a, comp(arm(a).reqs)]));
  const T = (a) => C[a].unc + C[a].cr + C[a].cw + C[a].out;
  table(['bucket', 'native', 'sweet', 'sweet - native', 'share of native / sweet'], [
    ['uncached input', usd(C.native.unc), usd(C.sweet.unc), usd(C.sweet.unc - C.native.unc), pair(a => pc(C[a].unc / T(a)))],
    ['cache read', usd(C.native.cr), usd(C.sweet.cr), usd(C.sweet.cr - C.native.cr), pair(a => pc(C[a].cr / T(a)))],
    ['cache write (1.25x)', usd(C.native.cw), usd(C.sweet.cw), usd(C.sweet.cw - C.native.cw), pair(a => pc(C[a].cw / T(a)))],
    ['output', usd(C.native.out), usd(C.sweet.out), usd(C.sweet.out - C.native.out), pair(a => pc(C[a].out / T(a)))],
    ['TOTAL runner basis', usd(T('native')), usd(T('sweet')), usd(T('sweet') - T('native')), pc(T('sweet') / T('native') - 1)],
    ['TOTAL, 1h write at 2x', usd(T('native') - C.native.cw + C.native.cw1h2x), usd(T('sweet') - C.sweet.cw + C.sweet.cw1h2x), usd(T('sweet') - C.sweet.cw + C.sweet.cw1h2x - (T('native') - C.native.cw + C.native.cw1h2x)), pc((T('sweet') - C.sweet.cw + C.sweet.cw1h2x) / (T('native') - C.native.cw + C.native.cw1h2x) - 1)],
  ]);
}

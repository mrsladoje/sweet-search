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
const PRICES = { 'cc-opus55-medium': { in: 4, cache: 0.2, out: 20 }, 'cc-sonnet55-high': { in: 3, cache: 0.3, out: 15 } };
const P = PRICES[cell];
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
    let maxSpread = 0; for (const v of byCwd.values()) { const cr = v.slice(1).map(x => x.req0.cacheRead); if (cr.length) maxSpread = Math.max(maxSpread, Math.max(...cr) - Math.min(...cr)); }
    console.log(`${a}: max within-repo spread of req-0 cacheRead among non-first rollouts = ${maxSpread} tokens`);
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
  const klass = (r) => (r.req0.cacheRead === 0 ? 'cold' : r.req0.cacheRead < 11000 && r.req0.cacheRead > 9000 && r.req0.cacheRead < median(arm(r.arm).rolls.map(x => x.req0.cacheRead)) ? 'first-touch' : 'warm');
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

#!/usr/bin/env node
/**
 * analyze-opencode-forensics — tables for opencode-FORENSICS.md, computed from the normalised traces.
 *   node core/prompt-optimization/data/final-tuning/trace/analyze-opencode-forensics.mjs [cell ...]   (default: both cells)
 * Reads  core/prompt-optimization/data/results/final-tuning-trace/<cell>.trace.jsonl   (normalize-opencode.mjs output)
 * Prints markdown tables to stdout; no network, no writes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../..');
const H = path.join(WT, 'eval/task-completion-bench/harness');
const { priceFor } = await import(path.join(H, 'ideal-cost.mjs'));
const CELLS = { 'oc-dsflash41': { price: 'deepseek/deepseek-flash', gran: 64 }, 'oc-sol61-high': { price: 'openai/gpt-6.1-sol', gran: 128 } };
const cells = process.argv.slice(2).filter(a => CELLS[a]); if (!cells.length) cells.push(...Object.keys(CELLS));

const sum = a => a.reduce((x, y) => x + y, 0);
const mean = a => (a.length ? sum(a) / a.length : NaN);
const med = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const f0 = x => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : '-');
const f1 = x => (Number.isFinite(x) ? x.toFixed(1) : '-');
const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : '-');
const f3 = x => (Number.isFinite(x) ? x.toFixed(3) : '-');
const usd = x => (Number.isFinite(x) ? `${x < 0 ? '-' : ''}$${Math.abs(x).toFixed(4)}` : '-');
const usd5 = x => (Number.isFinite(x) ? `${x < 0 ? '-' : ''}$${Math.abs(x).toFixed(5)}` : '-');
const pc = x => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '-');
const sgn = x => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(1)}%` : '-');
const table = (head, rows, left = 1) => [`| ${head.join(' | ')} |`, `|${head.map((_, i) => (i < left ? '---' : '---:')).join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');

function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// stratified (by set) paired bootstrap of the mean paired difference, same recipe as retrieval-bench-282.mjs (B=20000, seed 42)
function bootCI(pairs, B = 20000, seed = 42) {
  const by = new Map(); for (const p of pairs) { if (!by.has(p.set)) by.set(p.set, []); by.get(p.set).push(p.d); }
  const rnd = mulberry32(seed); const ms = [];
  for (let b = 0; b < B; b++) { let s = 0, n = 0; for (const ds of by.values()) for (let j = 0; j < ds.length; j++) { s += ds[Math.floor(rnd() * ds.length)]; n++; } ms.push(s / n); }
  ms.sort((x, y) => x - y); return [ms[Math.floor(0.025 * B)], ms[Math.floor(0.975 * B)]];
}

for (const cell of cells) {
  const { price: pk, gran } = CELLS[cell]; const P = priceFor(pk);
  const L = fs.readFileSync(path.join(WT, 'core/prompt-optimization/data/results/final-tuning-trace', `${cell}.trace.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const reqs = L.filter(r => r.type !== 'rollout'); const rolls = L.filter(r => r.type === 'rollout');
  const A = { native: {}, sweet: {} };
  for (const arm of ['native', 'sweet']) {
    const rs = rolls.filter(r => r.arm === arm);
    const byId = new Map(); for (const r of reqs.filter(x => x.arm === arm)) { if (!byId.has(r.id)) byId.set(r.id, []); byId.get(r.id).push(r); }
    for (const v of byId.values()) v.sort((a, b) => a.req - b.req);
    A[arm] = { rolls: rs, byId, reqs: reqs.filter(x => x.arm === arm) };
  }
  console.log(`\n\n# ${cell}  (price: in $${P.in}/M, cache-read $${P.cache}/M, out $${P.out}/M; cache granularity ~${gran} tokens)\n`);

  // ---------- T0 headline ----------
  const tot = arm => sum(A[arm].rolls.map(r => r.costUsdSum));
  console.log(`## T0 total cost (trace sum = runner costRealizedUsd, 130 questions per arm)\n`);
  console.log(table(['arm', 'total $ (130 questions)', '$ / question', 'naive $/question (no cache, runner)'], ['native', 'sweet'].map(a => [a, usd(tot(a)), usd5(tot(a) / 130), usd5(mean(A[a].rolls.map(r => r.costNaiveRunnerUsd)))])));
  console.log(`\nsweet vs native: realised ${sgn(((tot('sweet') / tot('native')) - 1) * 100)}; naive ${sgn(((mean(A.sweet.rolls.map(r => r.costNaiveRunnerUsd)) / mean(A.native.rolls.map(r => r.costNaiveRunnerUsd))) - 1) * 100)}`);
  {
    const nat = new Map(A.native.rolls.map(r => [r.id, r])); const pr = A.sweet.rolls.map(r => ({ set: r.set, d: r.costUsdSum - nat.get(r.id).costUsdSum }));
    const [lo, hi] = bootCI(pr);
    console.log(`paired sweet - native $/question: mean ${usd5(mean(pr.map(x => x.d)))}, 95% CI [${usd5(lo)}, ${usd5(hi)}] (stratified by set, B=20000, seed 42)`);
  }

  // ---------- T1 cache per request position ----------
  console.log(`\n## T1 per request position (mean tokens per request; hit = sum cacheRead / sum inTotal)\n`);
  const buckets = [[0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5+']];
  const rowsT1 = [];
  for (const [bi, bl] of buckets) for (const arm of ['native', 'sweet']) {
    const rs = A[arm].reqs.filter(r => (bi === 5 ? r.req >= 5 : r.req === bi));
    if (!rs.length) continue;
    rowsT1.push([bl, arm, rs.length, f0(mean(rs.map(r => r.tok.inUncached))), f0(mean(rs.map(r => r.tok.cacheRead))), f0(mean(rs.map(r => r.tok.cacheWrite))), f0(mean(rs.map(r => r.tok.out))), f0(mean(rs.map(r => r.tok.reasoning || 0))), f0(mean(rs.map(r => r.tok.inTotal))), pc(sum(rs.map(r => r.tok.cacheRead)) / sum(rs.map(r => r.tok.inTotal))), usd5(mean(rs.map(r => r.costUsd)))]);
  }
  console.log(table(['req', 'arm', 'n', 'inUncached', 'cacheRead', 'cacheWrite', 'out(incl. reasoning)', 'reasoning', 'inTotal', 'hit', '$/req'], rowsT1, 2));

  // ---------- T2 prefix ----------
  console.log(`\n## T2 fixed prefix and first request\n`);
  const rowsT2 = ['native', 'sweet'].map(arm => {
    const rs = A[arm].rolls; const r0 = rs.map(r => r.req0CacheRead);
    const modes = {}; for (const v of r0) modes[v] = (modes[v] || 0) + 1;
    return [arm, f0(mean(rs.map(r => r.prefixTokens))), `${f0(Math.min(...rs.map(r => r.prefixTokens)))}-${f0(Math.max(...rs.map(r => r.prefixTokens)))}`, f0(mean(rs.map(r => r.req0InTotal))), f0(mean(r0)), pc(r0.filter(x => x > 0).length / r0.length), Object.entries(modes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}x${v}`).join(' '), pc(sum(r0) / sum(rs.map(r => r.req0InTotal)))];
  });
  console.log(table(['arm', 'prefix tokens (mean)', 'prefix min-max', 'req0 inTotal', 'req0 cacheRead (mean)', 'req0 hit>0', 'req0 cacheRead values (count)', 'req0 cache ratio'], rowsT2));

  // ---------- T3 within-rollout stability ----------
  console.log(`\n## T3 prefix reuse inside a rollout (request n vs context of request n-1)\n`);
  const rowsT3 = [];
  const det = {};
  for (const arm of ['native', 'sweet']) {
    const items = [];
    for (const v of A[arm].byId.values()) for (let n = 1; n < v.length; n++) {
      const prev = v[n - 1].tok.inTotal, cur = v[n].tok;
      items.push({ prev, cr: cur.cacheRead, unc: cur.inUncached, inTot: cur.inTotal, newTok: cur.inTotal - prev, deficit: prev - cur.cacheRead, gapMs: (v[n].t0 ?? 0) - (v[n - 1].t1 ?? 0), prevOut: v[n - 1].tok.out });
    }
    det[arm] = items;
    const br = items.filter(i => i.deficit > 2 * gran);
    rowsT3.push([arm, items.length, pc(sum(items.map(i => i.cr)) / sum(items.map(i => i.prev))), f0(mean(items.map(i => i.deficit))), f0(median(items.map(i => i.deficit))), `${br.length} (${pc(br.length / items.length)})`, f0(mean(br.map(i => i.deficit))), f0(mean(items.map(i => i.newTok))), f0(mean(items.map(i => i.unc))), f1(median(items.map(i => i.gapMs / 1000)))]);
  }
  function median(a) { return med(a); }
  console.log(table(['arm', 'requests n>=1', 'cacheRead(n) / inTotal(n-1)', 'mean deficit tok', 'median deficit', `breaks (deficit > ${2 * gran})`, 'mean deficit of breaks', 'mean new tok since n-1', 'mean inUncached', 'median gap s (t1(n-1)->t0(n))'], rowsT3));
  console.log(`\n(deficit = inTotal(n-1) - cacheRead(n), signed. Positive = earlier context re-billed as uncached input; negative = the provider also cached part of the previous response. Exact identity for n>=1: inUncached(n) = new(n) + deficit(n), with new(n) = inTotal(n) - inTotal(n-1).)`);

  // ---------- T4 cost split ----------
  console.log(`\n## T4 where the dollars go (total over 130 questions per arm)\n`);
  const split = arm => {
    const rs = A[arm].reqs;
    const b = { unc: sum(rs.map(r => r.tok.inUncached)) * P.in / 1e6, cr: sum(rs.map(r => r.tok.cacheRead)) * P.cache / 1e6, cw: sum(rs.map(r => r.tok.cacheWrite)) * P.in * 1.25 / 1e6, outv: sum(rs.map(r => r.tok.outVisible)) * P.out / 1e6, reas: sum(rs.map(r => r.tok.reasoning || 0)) * P.out / 1e6 };
    b.total = b.unc + b.cr + b.cw + b.outv + b.reas; return b;
  };
  const S = { native: split('native'), sweet: split('sweet') };
  const rowsT4 = [['uncached input', 'unc'], ['cache read', 'cr'], ['cache write', 'cw'], ['output (visible text + tool args)', 'outv'], ['reasoning', 'reas'], ['TOTAL', 'total']].map(([lab, k]) => [lab, usd(S.native[k]), pc(S.native[k] / S.native.total), usd(S.sweet[k]), pc(S.sweet[k] / S.sweet.total), usd(S.sweet[k] - S.native[k]), k === 'total' ? sgn(((S.sweet.total / S.native.total) - 1) * 100) : `${f0(((S.sweet[k] - S.native[k]) / (S.sweet.total - S.native.total)) * 100)}% of gap`]);
  console.log(table(['bucket', 'native $', 'native share', 'sweet $', 'sweet share', 'sweet - native $', 'relative'], rowsT4));
  const tokPerQ = k => ['native', 'sweet'].map(a => f0(sum(A[a].reqs.map(r => r.tok[k])) / 130));
  console.log(`\nTokens per question (native | sweet): inUncached ${tokPerQ('inUncached').join(' | ')}; cacheRead ${tokPerQ('cacheRead').join(' | ')}; inTotal ${tokPerQ('inTotal').join(' | ')}; out(incl reasoning) ${tokPerQ('out').join(' | ')}`);

  // uncached-input decomposition
  console.log(`\n### T4b uncached input split: first request vs later requests (new content vs cache deficit)\n`);
  const unc = arm => {
    const r0 = A[arm].reqs.filter(r => r.req === 0); const u0 = sum(r0.map(r => r.tok.inUncached));
    const nw = sum(det[arm].map(i => i.newTok)); const df = sum(det[arm].map(i => i.deficit));
    return { u0, nw, df, sumNew: nw };
  };
  const U = { native: unc('native'), sweet: unc('sweet') };
  console.log(table(['component (tokens per question)', 'native', 'sweet', 'native $ (130 q)', 'sweet $ (130 q)'], [
    ['req 0 uncached (prefix + question not cached across rollouts)', f0(U.native.u0 / 130), f0(U.sweet.u0 / 130), usd(U.native.u0 * P.in / 1e6), usd(U.sweet.u0 * P.in / 1e6)],
    ['req >=1 new tokens since the previous request (its assistant output + tool results)', f0(U.native.nw / 130), f0(U.sweet.nw / 130), usd(U.native.nw * P.in / 1e6), usd(U.sweet.nw * P.in / 1e6)],
    ['req >=1 cache deficit, signed (+ earlier context re-billed; - provider also cached part of the previous response)', f0(U.native.df / 130), f0(U.sweet.df / 130), usd(U.native.df * P.in / 1e6), usd(U.sweet.df * P.in / 1e6)],
    ['sum = inUncached', f0((U.native.u0 + U.native.nw + U.native.df) / 130), f0((U.sweet.u0 + U.sweet.nw + U.sweet.df) / 130), usd((U.native.u0 + U.native.nw + U.native.df) * P.in / 1e6), usd((U.sweet.u0 + U.sweet.nw + U.sweet.df) * P.in / 1e6)],
  ]));
  console.log(`\n(check: measured inUncached per question native ${f0(sum(A.native.reqs.map(r => r.tok.inUncached)) / 130)}, sweet ${f0(sum(A.sweet.reqs.map(r => r.tok.inUncached)) / 130)})`);

  // ---------- T4d prefix vs rest ----------
  console.log(`\n### T4d fixed prefix vs everything else (prefix = system prompt + tool definitions + rules, measured in the first-request table)\n`);
  const pre = arm => {
    let cp = 0, p0unc = 0, pRead = 0;
    for (const r of A[arm].rolls) {
      const v = A[arm].byId.get(r.id); const Pf = r.prefixTokens; const cr0 = Math.min(v[0].tok.cacheRead, Pf);
      const first = ((Pf - cr0) * P.in + cr0 * P.cache) / 1e6;
      const later = sum(v.slice(1).map(rq => Math.min(Pf, rq.tok.inTotal))) * P.cache / 1e6;     // assumes the prefix is re-read from cache after request 0 (approximation: ignores provider misses)
      cp += first + later; p0unc += first; pRead += later;
    }
    return { cp, p0unc, pRead };
  };
  const PR = { native: pre('native'), sweet: pre('sweet') };
  console.log(table(['arm', 'total $', 'prefix $ (approx.)', 'prefix share', 'of which request 0 (mostly uncached)', 'of which re-reads in requests >=1', 'everything else $'], ['native', 'sweet'].map(a => [a, usd(tot(a)), usd(PR[a].cp), pc(PR[a].cp / tot(a)), usd(PR[a].p0unc), usd(PR[a].pRead), usd(tot(a) - PR[a].cp)])));
  console.log(`\nsweet - native: prefix ${usd(PR.sweet.cp - PR.native.cp)}, everything else ${usd((tot('sweet') - PR.sweet.cp) - (tot('native') - PR.native.cp))}, total ${usd(tot('sweet') - tot('native'))}.`);

  // ---------- counterfactual: first-request cache repaired ----------
  console.log(`\n### T4c counterfactual: sweet first request cached like native\n`);
  const natR0 = A.native.rolls.map(r => r.req0CacheRead);
  const swR = A.sweet.rolls;
  const cfCost = (rule) => {
    let total = 0;
    for (const r of swR) {
      const v = A.sweet.byId.get(r.id); let c = 0;
      for (const rq of v) {
        if (rq.req === 0) {
          const cr = rule(r, rq); const unc = rq.tok.inTotal - cr;
          c += (unc * P.in + cr * P.cache + rq.tok.out * P.out) / 1e6;
        } else c += rq.costUsd;
      }
      total += c;
    }
    return total;
  };
  const ruleFull = (r, rq) => Math.max(rq.tok.cacheRead, Math.floor(r.prefixTokens / gran) * gran);                       // whole prefix cached (upper bound of saving)
  const ruleRepo = (r, rq) => (rq.tok.cacheRead > 0 && cell === 'oc-dsflash41' && rq.tok.cacheRead >= 2048 ? Math.max(rq.tok.cacheRead, Math.floor(r.prefixTokens / gran) * gran) : rq.tok.cacheRead);   // DeepSeek: rollouts that already hit the head get the full prefix (native's pattern)
  // Sol (OpenAI cache is a per-request lottery): native reaches ABOVE the shared head in a fraction of its head hits;
  // give every sweet head-hit rollout that same probability of hitting its whole prefix (expected value, deterministic).
  const natHits = natR0.filter(x => x > 0); const natHead = Math.min(...natHits);
  const pUp = natHits.filter(x => x > natHead).length / natHits.length;
  const ruleLottery = (r, rq) => (rq.tok.cacheRead > 0 && cell === 'oc-sol61-high' ? rq.tok.cacheRead + pUp * Math.max(0, Math.floor(r.prefixTokens / gran) * gran - rq.tok.cacheRead) : rq.tok.cacheRead);
  const cfF = cfCost(ruleFull), cfR = cfCost(ruleRepo), cfL = cfCost(ruleLottery);
  const nTot = tot('native'), sTot = tot('sweet');
  console.log(table(['scenario', 'sweet total $', 'vs native'], [
    ['observed', usd(sTot), sgn((sTot / nTot - 1) * 100)],
    ['every sweet request 0 caches its whole prefix (floor to granularity)  [upper bound on the fix]', usd(cfF), sgn((cfF / nTot - 1) * 100)],
    ...(cell === 'oc-dsflash41' ? [['only rollouts that already hit the head cache (native pattern: all but the first rollout per repo)', usd(cfR), sgn((cfR / nTot - 1) * 100)]] : []),
    ...(cell === 'oc-sol61-high' ? [[`sweet head-hit rollouts get native's chance (${pc(pUp)} of native head hits went above the head) to hit the whole prefix (expected value)`, usd(cfL), sgn((cfL / nTot - 1) * 100)]] : []),
    ['native (reference)', usd(nTot), '0.0%'],
  ]));

  // ---------- T5 turns and calls ----------
  console.log(`\n## T5 turns (requests), calls, calls per turn, per question\n`);
  const pairs = (f) => { const ids = A.native.rolls.map(r => r.id); const nat = new Map(A.native.rolls.map(r => [r.id, r])); const sw = new Map(A.sweet.rolls.map(r => [r.id, r])); return ids.map(id => ({ set: sw.get(id).set, d: f(sw.get(id)) - f(nat.get(id)) })); };
  const metric = [['turns (requests)', r => r.turns], ['tool calls', r => r.calls], ['calls per turn', r => r.calls / r.turns]];
  const rowsT5 = [];
  for (const [lab, f] of metric) {
    const n = A.native.rolls.map(f), s = A.sweet.rolls.map(f);
    const d = pairs(f); const [lo, hi] = bootCI(d);
    rowsT5.push([lab, f2(mean(n)), f1(med(n)), f1(q(n, 0.9)), f2(mean(s)), f1(med(s)), f1(q(s, 0.9)), `${mean(d.map(x => x.d)) >= 0 ? '+' : ''}${f2(mean(d.map(x => x.d)))} [${f2(lo)}, ${f2(hi)}]${lo > 0 || hi < 0 ? ' *' : ''}`]);
  }
  console.log(table(['metric', 'native mean', 'native median', 'native p90', 'sweet mean', 'sweet median', 'sweet p90', 'paired sweet-native mean [95% CI, stratified boot B=20000 seed 42]'], rowsT5));
  const parStat = arm => { const rs = A[arm].reqs; return { pooled: sum(rs.map(r => r.calls.length)) / rs.length, par: rs.filter(r => r.calls.length >= 2).length / rs.length, zero: rs.filter(r => r.calls.length === 0).length / rs.length, cpTnonfinal: sum(rs.map(r => r.calls.length)) / rs.filter(r => r.calls.length > 0).length }; };
  const ps = { native: parStat('native'), sweet: parStat('sweet') };
  console.log(`\nPooled calls per request: native ${f2(ps.native.pooled)}, sweet ${f2(ps.sweet.pooled)}. Calls per tool-using request: native ${f2(ps.native.cpTnonfinal)}, sweet ${f2(ps.sweet.cpTnonfinal)}. Requests with >=2 parallel calls: native ${pc(ps.native.par)}, sweet ${pc(ps.sweet.par)}. Requests with 0 calls (final answer): native ${pc(ps.native.zero)}, sweet ${pc(ps.sweet.zero)}.`);
  const resTok = arm => { const cs = A[arm].reqs.flatMap(r => r.calls); return { perCall: mean(cs.map(c => c.resultTokensEst)), med: med(cs.map(c => c.resultTokensEst)), p90: q(cs.map(c => c.resultTokensEst), 0.9), perQ: sum(cs.map(c => c.resultTokensEst)) / 130, argPerCall: mean(cs.map(c => c.argChars)) }; };
  const RT = { native: resTok('native'), sweet: resTok('sweet') };
  console.log(`\nResult size (chars/4 estimate): tokens per call native mean ${f0(RT.native.perCall)} (median ${f0(RT.native.med)}, p90 ${f0(RT.native.p90)}), sweet mean ${f0(RT.sweet.perCall)} (median ${f0(RT.sweet.med)}, p90 ${f0(RT.sweet.p90)}); result tokens per question native ${f0(RT.native.perQ)}, sweet ${f0(RT.sweet.perQ)}. Mean argument chars per call native ${f0(RT.native.argPerCall)}, sweet ${f0(RT.sweet.argPerCall)}.`);

  // tools mix
  const mix = arm => { const m = {}; for (const r of A[arm].reqs) for (const c of r.calls) { const k = c.tool + (c.tool === 'bash' && c.sub ? `/${c.sub}` : ''); m[k] = (m[k] || 0) + 1; } return m; };
  const mx = { native: mix('native'), sweet: mix('sweet') };
  const keys = [...new Set([...Object.keys(mx.native), ...Object.keys(mx.sweet)])].sort((a, b) => ((mx.native[b] || 0) + (mx.sweet[b] || 0)) - ((mx.native[a] || 0) + (mx.sweet[a] || 0)));
  console.log(`\nTool mix (calls per question): ` + keys.slice(0, 12).map(k => `${k} ${f2((mx.native[k] || 0) / 130)}|${f2((mx.sweet[k] || 0) / 130)}`).join('; ') + '  (native|sweet)');

  // ---------- T6 reasoning / output ----------
  console.log(`\n## T6 output and reasoning tokens (provider-reported COUNTS from step-finish: tokens.output, tokens.reasoning)\n`);
  const rowsT6 = [];
  for (const arm of ['native', 'sweet']) {
    const rs = A[arm].rolls;
    const perQ = f => rs.map(r => sum(A[arm].byId.get(r.id).map(f)));
    const rq = A[arm].reqs;
    rowsT6.push([arm, f0(mean(perQ(r => r.tok.out))), f0(mean(perQ(r => r.tok.reasoning || 0))), f0(mean(perQ(r => r.tok.outVisible))), f0(med(perQ(r => r.tok.reasoning || 0))), f1(mean(rq.map(r => r.tok.out))), f1(mean(rq.map(r => r.tok.reasoning || 0))), pc(sum(rq.map(r => r.tok.reasoning || 0)) / sum(rq.map(r => r.tok.out))), f0(mean(perQ(r => r.thinkingChars))), f0(mean(perQ(r => r.textOutChars)))]);
  }
  console.log(table(['arm', 'out tok / q (incl. reasoning)', 'reasoning tok / q', 'visible out tok / q', 'median reasoning tok / q', 'out tok / turn', 'reasoning tok / turn', 'reasoning share of out', 'reasoning text chars / q', 'answer+text chars / q'], rowsT6));
  // reasoning per turn by position and by what the previous request's calls were (after which tool)
  const afterTool = arm => { const m = {}; for (const v of A[arm].byId.values()) for (let n = 1; n < v.length; n++) { const prevTools = [...new Set(v[n - 1].calls.map(c => c.tool))]; const key = prevTools.length === 1 ? prevTools[0] : prevTools.length ? 'mixed' : 'none'; (m[key] ||= []).push(v[n].tok.reasoning || 0); } return m; };
  const at = { native: afterTool('native'), sweet: afterTool('sweet') };
  const akeys = [...new Set([...Object.keys(at.native), ...Object.keys(at.sweet)])];
  console.log(`\nReasoning tokens of request n by the tool used in request n-1 (mean and n); native | sweet:\n`);
  console.log(table(['previous request used', 'native mean reasoning', 'native n', 'sweet mean reasoning', 'sweet n'], akeys.map(k => [k, f0(mean(at.native[k] || [])), (at.native[k] || []).length, f0(mean(at.sweet[k] || [])), (at.sweet[k] || []).length])));
  const first = arm => A[arm].reqs.filter(r => r.req === 0).map(r => r.tok.reasoning || 0);
  console.log(`\nReasoning in request 0 (before any tool result): native mean ${f0(mean(first('native')))}, sweet mean ${f0(mean(first('sweet')))}.`);
  if (cell === 'oc-dsflash41') {
    const cp = arm => { const rs = A[arm].reqs.filter(r => (r.tok.reasoning || 0) > 0 && r.reasoningText); return mean(rs.map(r => r.reasoningText.length / r.tok.reasoning)); };
    console.log(`DeepSeek raw reasoning text: mean chars per reported reasoning token native ${f2(cp('native'))}, sweet ${f2(cp('sweet'))} (text is the full raw reasoning; the token number is provider-reported).`);
  }
  console.log(`Requests with reasoning>0: native ${pc(A.native.reqs.filter(r => r.tok.reasoning > 0).length / A.native.reqs.length)}, sweet ${pc(A.sweet.reqs.filter(r => r.tok.reasoning > 0).length / A.sweet.reqs.length)}.`);

  // ---------- by set ----------
  console.log(`\n## T7 by set (mean $/question; turns; calls)\n`);
  const rowsT7 = [];
  for (const set of ['vault', 'heldout', 'ood']) {
    const row = [set];
    for (const arm of ['native', 'sweet']) { const rs = A[arm].rolls.filter(r => r.set === set); row.push(usd(mean(rs.map(r => r.costUsdSum))), f2(mean(rs.map(r => r.turns))), f2(mean(rs.map(r => r.calls)))); }
    const n = A.native.rolls.filter(r => r.set === set), s = A.sweet.rolls.filter(r => r.set === set);
    row.push(sgn((mean(s.map(r => r.costUsdSum)) / mean(n.map(r => r.costUsdSum)) - 1) * 100), n.length);
    rowsT7.push(row);
  }
  console.log(table(['set', 'native $/q', 'native turns', 'native calls', 'sweet $/q', 'sweet turns', 'sweet calls', 'sweet vs native $', 'n'], rowsT7));
}

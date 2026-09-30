#!/usr/bin/env node
/**
 * analyze-codex.mjs — numbers for codex-FORENSICS.md, from the normalised trace.
 *   node core/prompt-optimization/data/final-tuning/trace/analyze-codex.mjs [cell]   (default codex-sol61-high)
 * Reads <worktree>/core/prompt-optimization/data/results/final-tuning-trace/<cell>.trace.jsonl only.
 * Prints markdown tables (sweet and native side by side) to stdout.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../..');
const CELL = process.argv[2] || 'codex-sol61-high';
const { priceFor, costFromTurns } = await import(path.join(WT, 'eval/task-completion-bench/harness/ideal-cost.mjs'));
const P = priceFor('openai/gpt-6.1-sol');
const L = fs.readFileSync(path.join(WT, 'core/prompt-optimization/data/results/final-tuning-trace', `${CELL}.trace.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const reqs = L.filter((r) => !r.type); const rolls = L.filter((r) => r.type === 'rollout');
const ARMS = ['sweet', 'native'];
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : NaN);
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const pctile = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const f = (x, d = 0) => (Number.isFinite(x) ? x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : 'n/a');
const usd = (x, d = 4) => `$${x.toFixed(d)}`;
const pc = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const by = (arr, key) => { const m = {}; for (const x of arr) (m[key(x)] ||= []).push(x); return m; };
const R = Object.fromEntries(ARMS.map((a) => [a, reqs.filter((r) => r.arm === a)]));
const RO = Object.fromEntries(ARMS.map((a) => [a, rolls.filter((r) => r.arm === a)]));
const reqsOf = (r) => reqs.filter((q) => q.arm === r.arm && q.id === r.id).sort((a, b) => a.req - b.req);
const chain = {}; for (const r of rolls) chain[`${r.arm}.${r.id}`] = reqsOf(r);

function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function bootCI(pairs, B = 20000, seed = 42) { // stratified paired bootstrap (within set), as scripts/retrieval-bench-282.mjs
  const bySet = {}; for (const p of pairs) (bySet[p.set] ||= []).push(p.d);
  const rnd = mulberry32(seed); const ms = [];
  for (let b = 0; b < B; b++) { let s = 0, n = 0; for (const ds of Object.values(bySet)) for (let j = 0; j < ds.length; j++) { s += ds[Math.floor(rnd() * ds.length)]; n++; } ms.push(s / n); }
  ms.sort((x, y) => x - y); return [ms[Math.floor(0.025 * B)], ms[Math.floor(0.975 * B)]];
}
const paired = (fn) => { // sweet - native per id
  const n = new Map(RO.native.map((r) => [r.id, r])); const pairs = [];
  for (const s of RO.sweet) { const t = n.get(s.id); if (t) pairs.push({ set: s.set, d: fn(s) - fn(t) }); }
  const d = mean(pairs.map((p) => p.d)); const [lo, hi] = bootCI(pairs); return { d, lo, hi };
};

const out = [];
const H = (t) => out.push(`\n### ${t}\n`);
const T = (head, rows) => out.push(table(head, rows));

// ─── 0. headline ──────────────────────────────────────────────────────────────────────────────
H('0. Headline (per rollout, n = 130 per arm)');
const cstat = (arm) => { const c = RO[arm].map((r) => r.costUsdSum); return { mean: mean(c), med: median(c), sum: sum(c) }; };
const naive = (arm) => sum(RO[arm].map((r) => sum(chain[`${arm}.${r.id}`].map((q) => (q.tok.inTotal * P.in + q.tok.out * P.out) / 1e6))));
const ideal = (arm) => RO[arm].map((r) => costFromTurns(chain[`${arm}.${r.id}`].map((q) => ({ in: q.tok.inTotal, cached: q.tok.cacheRead, out: q.tok.out })), P).idealUsd);
T(['metric', 'sweet', 'native', 'sweet vs native'], [
  ['billed $ (realized, sum)', usd(cstat('sweet').sum, 3), usd(cstat('native').sum, 3), pc(cstat('sweet').sum / cstat('native').sum - 1)],
  ['billed $ per question, mean', usd(cstat('sweet').mean), usd(cstat('native').mean), pc(cstat('sweet').mean / cstat('native').mean - 1)],
  ['billed $ per question, median', usd(cstat('sweet').med), usd(cstat('native').med), pc(cstat('sweet').med / cstat('native').med - 1)],
  ['naive $ (no cache discount, sum)', usd(naive('sweet'), 3), usd(naive('native'), 3), pc(naive('sweet') / naive('native') - 1)],
  ['ideal-cache $ (every re-sent token at cache price, sum)', usd(sum(ideal('sweet')), 3), usd(sum(ideal('native')), 3), pc(sum(ideal('sweet')) / sum(ideal('native')) - 1)],
]);
{
  const pr = paired((r) => r.costUsdSum); out.push(`\nPaired billed-$ difference per question (sweet - native): ${usd(pr.d, 5)}, 95% CI [${usd(pr.lo, 5)}, ${usd(pr.hi, 5)}] (stratified paired bootstrap by set, B=20000, seed=42).`);
  const idealBy = (arm) => new Map(RO[arm].map((r, i) => [r.id, ideal(arm)[i]]));
  const iS = idealBy('sweet'), iN = idealBy('native'); const pairs = RO.sweet.map((r) => ({ set: r.set, d: iS.get(r.id) - iN.get(r.id) }));
  const [lo, hi] = bootCI(pairs); out.push(`Paired ideal-cache-$ difference per question: ${usd(mean(pairs.map((p) => p.d)), 5)}, 95% CI [${usd(lo, 5)}, ${usd(hi, 5)}].`);
}

// ─── A. cache by request position ─────────────────────────────────────────────────────────────
H('A1. Tokens and cache hit by request position (mean per request)');
const posKey = (q) => (q.req >= 5 ? '5+' : String(q.req));
const rows = [];
for (const pos of ['0', '1', '2', '3', '4', '5+']) {
  const row = [pos];
  for (const arm of ARMS) {
    const a = R[arm].filter((q) => posKey(q) === pos);
    row.push(a.length, f(mean(a.map((q) => q.tok.inTotal))), f(mean(a.map((q) => q.tok.inUncached))), f(mean(a.map((q) => q.tok.cacheRead))), f(mean(a.map((q) => q.tok.out)), 1), pc(sum(a.map((q) => q.tok.cacheRead)) / sum(a.map((q) => q.tok.inTotal))), pc(a.filter((q) => q.tok.cacheRead === 0).length / a.length, 0), usd(mean(a.map((q) => q.costUsd))));
  }
  rows.push(row);
}
T(['req', 'S n', 'S inTotal', 'S inUncached', 'S cacheRead', 'S out', 'S hit ratio', 'S zero-hit', 'S $/req', 'N n', 'N inTotal', 'N inUncached', 'N cacheRead', 'N out', 'N hit ratio', 'N zero-hit', 'N $/req'], rows);
out.push('\nS = sweet, N = native. hit ratio = sum(cacheRead) / sum(inTotal). zero-hit = share of requests with cacheRead = 0.');
{
  const all = ARMS.map((arm) => { const a = R[arm]; return [arm, a.length, f(mean(a.map((q) => q.tok.inTotal))), f(mean(a.map((q) => q.tok.inUncached))), f(mean(a.map((q) => q.tok.cacheRead))), f(mean(a.map((q) => q.tok.out)), 1), pc(sum(a.map((q) => q.tok.cacheRead)) / sum(a.map((q) => q.tok.inTotal))), pc(a.filter((q) => q.tok.cacheRead === 0).length / a.length, 0)]; });
  out.push('\nAll requests:\n'); T(['arm', 'requests', 'inTotal', 'inUncached', 'cacheRead', 'out', 'hit ratio', 'zero-hit'], all);
}

// ─── A2. how much of the previous context was reused ──────────────────────────────────────────
H('A2. Reuse of the previous request context (requests n >= 1)');
const reuse = (arm) => {
  const rs = []; for (const r of RO[arm]) { const c = chain[`${arm}.${r.id}`]; for (let i = 1; i < c.length; i++) rs.push({ prevIn: c[i - 1].tok.inTotal, q: c[i], i, dt: c[i].x.dtMs }); }
  return rs;
};
const reuseRows = [];
const reuseStats = {};
for (const arm of ARMS) {
  const rs = reuse(arm);
  const cov = rs.map((x) => Math.min(1, x.q.tok.cacheRead / x.prevIn));
  const floorMiss = rs.map((x) => x.prevIn - Math.floor(x.prevIn / 128) * 128); // unavoidable 128-token block remainder
  const missedOld = rs.map((x) => Math.max(0, x.prevIn - x.q.tok.cacheRead));
  const newTok = rs.map((x) => Math.max(0, x.q.tok.inTotal - x.prevIn));
  reuseStats[arm] = { n: rs.length, missedOldSum: sum(missedOld), newSum: sum(newTok), floorSum: sum(floorMiss), rs };
  reuseRows.push([arm, rs.length, f(mean(rs.map((x) => x.prevIn))), f(mean(rs.map((x) => x.q.tok.cacheRead))), pc(sum(rs.map((x) => Math.min(x.prevIn, x.q.tok.cacheRead))) / sum(rs.map((x) => x.prevIn))), pc(rs.filter((x) => x.q.tok.cacheRead >= 0.9 * x.prevIn).length / rs.length, 0), pc(rs.filter((x) => x.q.tok.cacheRead === 0).length / rs.length, 0), pc(rs.filter((x) => x.q.tok.cacheRead > 0 && x.q.tok.cacheRead < 0.9 * x.prevIn).length / rs.length, 0), f(mean(missedOld)), f(mean(floorMiss)), f(mean(newTok))]);
}
T(['arm', 'requests n>=1', 'mean prev input', 'mean cacheRead', 'prev context read from cache', '>=90% reused', 'zero reuse', 'partial reuse', 'mean prev context NOT cached (tok)', 'of which 128-block remainder (tok)', 'mean new tokens (tok)'], reuseRows);

// ─── A3. req 0 and the fixed prefix ───────────────────────────────────────────────────────────
H('A3. Request 0 and the fixed prefix');
const prefRows = [];
for (const arm of ARMS) {
  const r0 = R[arm].filter((q) => q.req === 0);
  const pf = RO[arm].map((r) => r.prefixTokens);
  const cv = by(r0, (q) => q.tok.cacheRead);
  prefRows.push([arm, r0.length, f(mean(r0.map((q) => q.tok.inTotal))), `${f(Math.min(...r0.map((q) => q.tok.inTotal)))}-${f(Math.max(...r0.map((q) => q.tok.inTotal)))}`, f(mean(pf)), f(mean(r0.map((q) => q.tok.cacheRead))), pc(r0.filter((q) => q.tok.cacheRead > 0).length / r0.length, 0), pc(sum(r0.map((q) => q.tok.cacheRead)) / sum(r0.map((q) => q.tok.inTotal)), 1), Object.entries(cv).sort((a, b) => b[1].length - a[1].length).slice(0, 5).map(([k, v]) => `${k}:${v.length}`).join(', ')]);
}
T(['arm', 'rollouts', 'req0 inTotal mean', 'req0 inTotal range', 'prefix tokens (mean)', 'req0 cacheRead mean', 'req0 with cacheRead > 0', 'req0 hit ratio', 'req0 cacheRead values (value:count, top 5)'], prefRows);
{
  const d = mean(RO.sweet.map((r) => r.prefixTokens)) - mean(RO.native.map((r) => r.prefixTokens));
  out.push(`\nPrefix difference sweet - native: ${f(d)} tokens. Cost of the prefix per rollout: one full read at cache price = ${usd(mean(RO.sweet.map((r) => r.prefixTokens)) * P.cache / 1e6)} (sweet) vs ${usd(mean(RO.native.map((r) => r.prefixTokens)) * P.cache / 1e6)} (native) per request; at full input price ${usd(mean(RO.sweet.map((r) => r.prefixTokens)) * P.in / 1e6)} vs ${usd(mean(RO.native.map((r) => r.prefixTokens)) * P.in / 1e6)}.`);
}
// req0 cache state vs same-cwd recency
out.push('\nRequest-0 cache hit vs whether the previous rollout of the SAME arm used the same repo (runs are grouped by repo):');
{
  const rowsR0 = [];
  for (const arm of ARMS) {
    const r0 = R[arm].filter((q) => q.req === 0).sort((a, b) => Date.parse(a.x.ts) - Date.parse(b.x.ts));
    const cwdOf = (q) => rolls.find((r) => r.arm === arm && r.id === q.id).file; // path contains the rollout date only; use repo via lang+set
    const repoKey = (q) => `${q.lang}`;
    const cls = { same: [], diff: [] };
    r0.forEach((q, i) => { const prev = r0.slice(Math.max(0, i - 3), i); (prev.some((p) => repoKey(p) === repoKey(q)) ? cls.same : cls.diff).push(q); });
    for (const [k, v] of Object.entries(cls)) rowsR0.push([arm, k === 'same' ? 'repo seen in previous 3 rollouts' : 'repo not seen in previous 3 rollouts', v.length, f(mean(v.map((q) => q.tok.cacheRead))), pc(v.filter((q) => q.tok.cacheRead > 0).length / Math.max(1, v.length), 0), pc(v.filter((q) => q.tok.cacheRead > 14000).length / Math.max(1, v.length), 0)]);
  }
  T(['arm', 'class', 'n', 'req0 cacheRead mean', 'req0 cacheRead > 0', 'req0 cacheRead > 14,000 (env block + more cached)'], rowsR0);
}

// ─── A4. $ split ──────────────────────────────────────────────────────────────────────────────
H('A4. Where the billed dollars go (sum over 130 rollouts per arm)');
const split = (arm) => ({ unc: sum(R[arm].map((q) => q.tok.inUncached * P.in / 1e6)), cr: sum(R[arm].map((q) => q.tok.cacheRead * P.cache / 1e6)), out: sum(R[arm].map((q) => q.tok.out * P.out / 1e6)) });
const sp = { sweet: split('sweet'), native: split('native') };
const tot = (s) => s.unc + s.cr + s.out;
T(['bucket', 'sweet $', 'sweet share', 'native $', 'native share', 'sweet - native $', 'as % of native total'], [
  ['uncached input (full price)', usd(sp.sweet.unc, 3), pc(sp.sweet.unc / tot(sp.sweet)), usd(sp.native.unc, 3), pc(sp.native.unc / tot(sp.native)), usd(sp.sweet.unc - sp.native.unc, 3), pc((sp.sweet.unc - sp.native.unc) / tot(sp.native))],
  ['cache read', usd(sp.sweet.cr, 3), pc(sp.sweet.cr / tot(sp.sweet)), usd(sp.native.cr, 3), pc(sp.native.cr / tot(sp.native)), usd(sp.sweet.cr - sp.native.cr, 3), pc((sp.sweet.cr - sp.native.cr) / tot(sp.native))],
  ['output (incl. reasoning)', usd(sp.sweet.out, 3), pc(sp.sweet.out / tot(sp.sweet)), usd(sp.native.out, 3), pc(sp.native.out / tot(sp.native)), usd(sp.sweet.out - sp.native.out, 3), pc((sp.sweet.out - sp.native.out) / tot(sp.native))],
  ['total', usd(tot(sp.sweet), 3), '100%', usd(tot(sp.native), 3), '100%', usd(tot(sp.sweet) - tot(sp.native), 3), pc((tot(sp.sweet) - tot(sp.native)) / tot(sp.native))],
]);
out.push('');
T(['token bucket (sum)', 'sweet', 'native', 'sweet - native', 'sweet vs native'], [
  ['input tokens total', f(sum(R.sweet.map((q) => q.tok.inTotal))), f(sum(R.native.map((q) => q.tok.inTotal))), f(sum(R.sweet.map((q) => q.tok.inTotal)) - sum(R.native.map((q) => q.tok.inTotal))), pc(sum(R.sweet.map((q) => q.tok.inTotal)) / sum(R.native.map((q) => q.tok.inTotal)) - 1)],
  ['uncached input tokens', f(sum(R.sweet.map((q) => q.tok.inUncached))), f(sum(R.native.map((q) => q.tok.inUncached))), f(sum(R.sweet.map((q) => q.tok.inUncached)) - sum(R.native.map((q) => q.tok.inUncached))), pc(sum(R.sweet.map((q) => q.tok.inUncached)) / sum(R.native.map((q) => q.tok.inUncached)) - 1)],
  ['cache-read tokens', f(sum(R.sweet.map((q) => q.tok.cacheRead))), f(sum(R.native.map((q) => q.tok.cacheRead))), f(sum(R.sweet.map((q) => q.tok.cacheRead)) - sum(R.native.map((q) => q.tok.cacheRead))), pc(sum(R.sweet.map((q) => q.tok.cacheRead)) / sum(R.native.map((q) => q.tok.cacheRead)) - 1)],
  ['output tokens', f(sum(R.sweet.map((q) => q.tok.out))), f(sum(R.native.map((q) => q.tok.out))), f(sum(R.sweet.map((q) => q.tok.out)) - sum(R.native.map((q) => q.tok.out))), pc(sum(R.sweet.map((q) => q.tok.out)) / sum(R.native.map((q) => q.tok.out)) - 1)],
  ['requests', f(R.sweet.length), f(R.native.length), f(R.sweet.length - R.native.length), pc(R.sweet.length / R.native.length - 1)],
]);

// uncached decomposition
H('A5. Why uncached input tokens exist (sum over 130 rollouts; tokens billed at full input price)');
const decomp = (arm) => {
  let prefixMiss = 0, userMsg = 0, missedOld = 0, newTok = 0, unc = 0, below = 0;
  for (const r of RO[arm]) {
    const c = chain[`${arm}.${r.id}`];
    c.forEach((q, i) => {
      unc += q.tok.inUncached;
      if (i === 0) { prefixMiss += Math.max(0, r.prefixTokens - q.tok.cacheRead); userMsg += q.tok.inTotal - r.prefixTokens - Math.max(0, Math.min(0, r.prefixTokens - q.tok.cacheRead)); }
      else { const prev = c[i - 1].tok.inTotal; missedOld += Math.max(0, prev - q.tok.cacheRead); newTok += Math.max(0, q.tok.inTotal - prev); below += Math.max(0, q.tok.cacheRead - prev); }
    });
  }
  return { unc, prefixMiss, userMsg, missedOld, newTok, below };
};
const D = { sweet: decomp('sweet'), native: decomp('native') };
const PR = P.in - P.cache;
T(['component', 'sweet tokens', 'native tokens', 'sweet - native', 'sweet excess $ vs cache price', 'native excess $ vs cache price'], [
  ['request 0: fixed prefix not read from cache', f(D.sweet.prefixMiss), f(D.native.prefixMiss), f(D.sweet.prefixMiss - D.native.prefixMiss), usd(D.sweet.prefixMiss * PR / 1e6, 3), usd(D.native.prefixMiss * PR / 1e6, 3)],
  ['request 0: user message (frame + question, unavoidable)', f(D.sweet.userMsg), f(D.native.userMsg), f(D.sweet.userMsg - D.native.userMsg), '-', '-'],
  ['requests n>=1: previous context NOT read from cache (cache miss)', f(D.sweet.missedOld), f(D.native.missedOld), f(D.sweet.missedOld - D.native.missedOld), usd(D.sweet.missedOld * PR / 1e6, 3), usd(D.native.missedOld * PR / 1e6, 3)],
  ['requests n>=1: new tokens (tool results + model output re-sent, unavoidable)', f(D.sweet.newTok), f(D.native.newTok), f(D.sweet.newTok - D.native.newTok), '-', '-'],
  ['sum of the four = uncached tokens (check: equals table A4 up to rounding of the prefix estimate)', f(D.sweet.prefixMiss + D.sweet.userMsg + D.sweet.missedOld + D.sweet.newTok), f(D.native.prefixMiss + D.native.userMsg + D.native.missedOld + D.native.newTok), '', '', ''],
  ['actual uncached tokens', f(D.sweet.unc), f(D.native.unc), f(D.sweet.unc - D.native.unc), '', ''],
]);
out.push('\nNote: "new tokens" for n>=1 is inTotal(n) - inTotal(n-1). It holds the previous response output (text, reasoning carried over, call) plus the tool result. If cacheRead(n) exceeds inTotal(n-1) the surplus is ignored here.');

// ─── B. turns and calls ───────────────────────────────────────────────────────────────────────
H('B. Turns (requests) and calls per question');
const tc = (arm, fn) => RO[arm].map(fn);
const bt = [];
for (const [name, fn] of [['turns (requests) per question', (r) => r.turns], ['calls per question', (r) => r.calls], ['calls per turn (calls / turns)', (r) => r.calls / r.turns], ['turns that emit >= 1 call, per question', (r) => chain[`${r.arm}.${r.id}`].filter((q) => q.calls.length > 0).length], ['calls per call-emitting turn', (r) => { const c = chain[`${r.arm}.${r.id}`].filter((q) => q.calls.length > 0); return c.length ? sum(c.map((q) => q.calls.length)) / c.length : 0; }]]) {
  const p = paired(fn);
  bt.push([name, f(mean(tc('sweet', fn)), 2), f(median(tc('sweet', fn)), 2), f(mean(tc('native', fn)), 2), f(median(tc('native', fn)), 2), `${f(p.d, 2)} [${f(p.lo, 2)}, ${f(p.hi, 2)}]`]);
}
T(['metric', 'sweet mean', 'sweet median', 'native mean', 'native median', 'paired diff S-N [95% CI]'], bt);
out.push('\nTurn count distribution (share of rollouts):\n');
{
  const keys = [1, 2, 3, 4, 5, 6, 7, '8+'];
  T(['turns', ...ARMS.map((a) => `${a} rollouts`)], keys.map((k) => [k, ...ARMS.map((a) => pc(RO[a].filter((r) => (k === '8+' ? r.turns >= 8 : r.turns === k)).length / RO[a].length, 0))]));
}
out.push('\nTool use (calls):\n');
{
  const tk = (arm) => { const m = {}; for (const q of R[arm]) for (const c of q.calls) { const k = c.tool === 'exec_command' ? `exec_command/${c.sub}` : c.tool; m[k] = (m[k] || 0) + 1; } return m; };
  const ts = tk('sweet'), tn = tk('native'); const keys = [...new Set([...Object.keys(ts), ...Object.keys(tn)])].sort();
  T(['tool', 'sweet calls', 'native calls'], keys.map((k) => [k, ts[k] || 0, tn[k] || 0]));
  const chainShare = (arm) => pc(R[arm].flatMap((q) => q.calls).filter((c) => c.chain).length / R[arm].flatMap((q) => q.calls).length, 0);
  out.push(`\nCalls that chain several shell commands with ; or &&: sweet ${chainShare('sweet')}, native ${chainShare('native')} of calls.`);
  const par = (arm) => pc(R[arm].filter((q) => q.calls.length > 1 || q.calls.some((c) => c.cellCalls > 1)).length / R[arm].filter((q) => q.calls.length).length, 0);
  out.push(`Share of call-emitting turns with more than one call: sweet ${pc(R.sweet.filter((q) => q.calls.length > 1).length / R.sweet.filter((q) => q.calls.length).length, 0)}, native ${pc(R.native.filter((q) => q.calls.length > 1).length / R.native.filter((q) => q.calls.length).length, 0)}.`);
}

// ─── C. reasoning / output ────────────────────────────────────────────────────────────────────
H('C. Output and reasoning tokens (reasoning is already inside output)');
const cr = [];
for (const [name, fn] of [['output tokens per question', (r) => sum(chain[`${r.arm}.${r.id}`].map((q) => q.tok.out))], ['  of which reasoning tokens per question', (r) => sum(chain[`${r.arm}.${r.id}`].map((q) => q.tok.reasoning || 0))], ['  of which visible-text + tool-call tokens (output - reasoning)', (r) => sum(chain[`${r.arm}.${r.id}`].map((q) => q.tok.out - (q.tok.reasoning || 0)))], ['output tokens per turn', (r) => sum(chain[`${r.arm}.${r.id}`].map((q) => q.tok.out)) / r.turns], ['reasoning tokens per turn', (r) => sum(chain[`${r.arm}.${r.id}`].map((q) => q.tok.reasoning || 0)) / r.turns]]) {
  const p = paired(fn);
  cr.push([name, f(mean(RO.sweet.map(fn)), 1), f(median(RO.sweet.map(fn)), 1), f(mean(RO.native.map(fn)), 1), f(median(RO.native.map(fn)), 1), `${f(p.d, 1)} [${f(p.lo, 1)}, ${f(p.hi, 1)}]`]);
}
T(['metric', 'sweet mean', 'sweet median', 'native mean', 'native median', 'paired diff S-N [95% CI]'], cr);
out.push('\nPer-request output and reasoning:\n');
{
  const rr = ARMS.map((arm) => { const a = R[arm]; const rz = a.filter((q) => (q.tok.reasoning || 0) > 0); return [arm, a.length, f(mean(a.map((q) => q.tok.out)), 1), f(median(a.map((q) => q.tok.out)), 0), f(pctile(a.map((q) => q.tok.out), 0.9), 0), pc(rz.length / a.length, 1), f(mean(rz.map((q) => q.tok.reasoning)), 1), pc(sum(a.map((q) => q.tok.reasoning || 0)) / sum(a.map((q) => q.tok.out)), 1), pc(a.filter((q) => q.x.reasoningItems > 0).length / a.length, 1)]; });
  T(['arm', 'requests', 'mean out', 'median out', 'p90 out', 'requests with reasoning > 0', 'mean reasoning when > 0', 'reasoning share of output', 'requests with a reasoning item'], rr);
  const last = ARMS.map((arm) => { const a = R[arm].filter((q) => q.x.final); const nl = R[arm].filter((q) => !q.x.final); return [arm, f(mean(a.map((q) => q.tok.out)), 1), f(mean(nl.map((q) => q.tok.out)), 1), f(mean(a.map((q) => q.textOutChars)), 0), f(mean(nl.map((q) => q.textOutChars)), 0)]; });
  out.push('\nFinal-answer request versus search requests:\n');
  T(['arm', 'mean out tok, final request', 'mean out tok, other requests', 'mean text chars, final', 'mean text chars, other'], last);
  out.push('\nOutput tokens by request position (mean):\n');
  T(['req', 'sweet', 'native'], ['0', '1', '2', '3', '4', '5+'].map((pos) => [pos, ...ARMS.map((arm) => f(mean(R[arm].filter((q) => posKey(q) === pos).map((q) => q.tok.out)), 1))]));
  // reasoning by what the previous request's call was
  out.push('\nOutput tokens in request n, grouped by the tool of the PREVIOUS request (what the model just read):\n');
  const prevTool = (arm) => { const m = {}; for (const r of RO[arm]) { const c = chain[`${arm}.${r.id}`]; for (let i = 1; i < c.length; i++) { const t = c[i - 1].calls.length ? (c[i - 1].calls[0].tool === 'exec_command' ? `exec_command/${c[i - 1].calls[0].sub}` : c[i - 1].calls[0].tool) : '(none)'; (m[t] ||= []).push(c[i]); } } return m; };
  const pS = prevTool('sweet'), pN = prevTool('native'); const keys = [...new Set([...Object.keys(pS), ...Object.keys(pN)])].sort();
  T(['previous tool', 'sweet n', 'sweet mean out', 'sweet mean reasoning', 'native n', 'native mean out', 'native mean reasoning'], keys.map((k) => [k, (pS[k] || []).length, f(mean((pS[k] || []).map((q) => q.tok.out)), 1), f(mean((pS[k] || []).map((q) => q.tok.reasoning || 0)), 1), (pN[k] || []).length, f(mean((pN[k] || []).map((q) => q.tok.out)), 1), f(mean((pN[k] || []).map((q) => q.tok.reasoning || 0)), 1)]));
}

// ─── D. result sizes ──────────────────────────────────────────────────────────────────────────
H('D. Tool result size (feeds "new tokens" in A5)');
{
  const cs = (arm) => R[arm].flatMap((q) => q.calls);
  const rowsD = ARMS.map((arm) => { const c = cs(arm); const v = c.map((x) => x.resultTokensEst); return [arm, c.length, f(mean(v)), f(median(v)), f(pctile(v, 0.9)), f(sum(v)), f(mean(RO[arm].map((r) => sum(chain[`${arm}.${r.id}`].flatMap((q) => q.calls).map((x) => x.resultTokensEst)))))]; });
  T(['arm', 'calls', 'result tokens/call mean (chars/4)', 'median', 'p90', 'total result tokens', 'result tokens per question'], rowsD);
  const ctx = ARMS.map((arm) => { const g = []; for (const r of RO[arm]) { const c = chain[`${arm}.${r.id}`]; for (let i = 1; i < c.length; i++) g.push(c[i].x.ctxGrowth); } return [arm, f(mean(g)), f(median(g)), f(pctile(g, 0.9)), f(mean(RO[arm].map((r) => { const c = chain[`${arm}.${r.id}`]; return c[c.length - 1].tok.inTotal - c[0].tok.inTotal; })))]; });
  out.push('\nMeasured context growth between consecutive requests (inTotal(n) - inTotal(n-1)), tokens:\n');
  T(['arm', 'mean', 'median', 'p90', 'mean total growth per question (last - first request)'], ctx);
  const vis = ARMS.map((arm) => { const c = cs(arm).filter((x) => x.visibleChars != null); return [arm, c.length, f(sum(c.map((x) => x.resultChars))), f(sum(c.map((x) => x.visibleChars))), pc(sum(c.map((x) => x.visibleChars)) / sum(c.map((x) => x.resultChars)))]; });
  out.push('\nModel-visible output chars versus raw command output chars (the exec wrapper truncates some results):\n');
  T(['arm', 'calls with a visible-size reading', 'raw result chars', 'visible chars', 'visible / raw'], vis);
}

// ─── E. timing of the cache misses ────────────────────────────────────────────────────────────
H('E. Cache miss versus time since the previous request (requests n >= 1)');
{
  const edges = [[0, 3000], [3000, 6000], [6000, 10000], [10000, 20000], [20000, 1e9]];
  const rowsE = edges.map(([lo, hi]) => { const row = [`${lo / 1000}-${hi >= 1e9 ? 'inf' : hi / 1000} s`]; for (const arm of ARMS) { const a = reuseStats[arm].rs.filter((x) => x.dt >= lo && x.dt < hi); row.push(a.length, pc(a.filter((x) => x.q.tok.cacheRead === 0).length / Math.max(1, a.length), 0), pc(sum(a.map((x) => Math.min(x.prevIn, x.q.tok.cacheRead))) / Math.max(1, sum(a.map((x) => x.prevIn))), 0)); } return row; });
  T(['gap', 'S n', 'S zero-hit', 'S prev ctx reused', 'N n', 'N zero-hit', 'N prev ctx reused'], rowsE);
}

// ─── F. cost attribution counterfactuals ──────────────────────────────────────────────────────
H('F. Counterfactuals (per-question mean, billed $)');
{
  const real = (arm) => mean(RO[arm].map((r) => r.costUsdSum));
  const idl = (arm) => mean(ideal(arm));
  // perfect-caching counterfactual: re-sent previous context at cache price, req0 prefix at cache price, everything else at full input price
  const perfect = (arm) => mean(RO[arm].map((r) => { const c = chain[`${arm}.${r.id}`]; let t = 0; c.forEach((q, i) => { const cached = i === 0 ? Math.min(r.prefixTokens, q.tok.inTotal) : Math.min(c[i - 1].tok.inTotal, q.tok.inTotal); t += ((q.tok.inTotal - cached) * P.in + cached * P.cache + q.tok.out * P.out) / 1e6; }); return t; }));
  const flat = (arm) => mean(RO[arm].map((r) => { const c = chain[`${arm}.${r.id}`]; let t = 0; c.forEach((q, i) => { const cached = i === 0 ? r.prefixTokens : c[i - 1].tok.inTotal; t += ((q.tok.inTotal - Math.min(cached, q.tok.inTotal)) * P.in + Math.min(cached, q.tok.inTotal) * P.cache + q.tok.out * P.out) / 1e6; }); return t; }));
  void flat;
  T(['per question', 'sweet', 'native', 'sweet vs native'], [
    ['billed (actual cache)', usd(real('sweet')), usd(real('native')), pc(real('sweet') / real('native') - 1)],
    ['ideal-cache (req 0 fully uncached, re-sent context at cache price)', usd(idl('sweet')), usd(idl('native')), pc(idl('sweet') / idl('native') - 1)],
    ['perfect cache incl. request-0 prefix read from cache', usd(perfect('sweet')), usd(perfect('native')), pc(perfect('sweet') / perfect('native') - 1)],
    ['cache-miss excess = billed - perfect', usd(real('sweet') - perfect('sweet')), usd(real('native') - perfect('native')), ''],
  ]);
}
console.log(out.join('\n'));

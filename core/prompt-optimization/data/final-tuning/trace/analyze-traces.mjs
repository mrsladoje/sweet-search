#!/usr/bin/env node
/**
 * Common r282 trace analyser (FINAL_TUNING.md §2.3–2.8), all cells, both arms.
 *   node core/prompt-optimization/data/final-tuning/trace/analyze-traces.mjs [cell …] [--set vault|heldout|ood] [--ids train|validation]
 * Input: core/prompt-optimization/data/results/final-tuning-trace/<cell>.trace.jsonl (SCHEMA.md).
 * Output: markdown tables on stdout (+ JSON summary to results/final-tuning-trace/analysis.json).
 *
 * COST ATTRIBUTION (reconciles to Σ request cost by construction):
 *   Each request's input is modelled as the ordered context [prefix][question][out_0 ctx][results_0]
 *   [out_1 ctx][results_1]…; segment sizes are scaled so that they sum to the request's real inTotal
 *   (growth of inTotal between requests k and k+1 = assistant context of k + results of k). The
 *   provider caches a PREFIX, so the first `cacheRead` tokens are priced at the cache-read price and
 *   the rest at the write price (Anthropic, 1.25×in) / the input price (others). Output tokens of a
 *   request are split into tool-call args (argChars/4), visible text, and the rest = reasoning.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../..');
const TRACE_DIR = path.join(WT, 'core/prompt-optimization/data/results/final-tuning-trace');
const PRICES = {
  'oc-dsflash41': { in: 0.15, cache: 0.003, out: 0.6, write: 0.15 },
  'oc-sol61-high': { in: 2, cache: 0.1, out: 10, write: 2 },
  'codex-sol61-high': { in: 2, cache: 0.1, out: 10, write: 2 },
  'cc-sonnet55-high': { in: 2, cache: 0.2, out: 10, write: 2.5 },
  'cc-opus55-medium': { in: 4, cache: 0.2, out: 20, write: 5 },
};
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const SET = flag('--set');
const IDSPLIT = flag('--ids');
const CELLS = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const cells = CELLS.length ? CELLS : Object.keys(PRICES).filter(c => fs.existsSync(path.join(TRACE_DIR, `${c}.trace.jsonl`)));
const splitIds = IDSPLIT ? new Set(JSON.parse(fs.readFileSync(path.join(HERE, '../r282-split.json'), 'utf8'))[IDSPLIT]) : null;

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const q = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const pct = (x, t) => (t ? (100 * x / t).toFixed(1) : '—');
function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function bootCI(pairs, B = 20000, seed = 42) {
  const bySet = new Map(); for (const p of pairs) { if (!bySet.has(p.set)) bySet.set(p.set, []); bySet.get(p.set).push(p.d); }
  const rnd = mulberry32(seed); const ms = [];
  for (let b = 0; b < B; b++) { let s = 0, n = 0; for (const ds of bySet.values()) for (let j = 0; j < ds.length; j++) { s += ds[Math.floor(rnd() * ds.length)]; n++; } ms.push(s / n); }
  ms.sort((x, y) => x - y); return [ms[Math.floor(0.025 * B)], ms[Math.floor(0.975 * B)]];
}
const toolKey = c => (c.tool && /^ss-/.test(c.tool) ? c.tool : c.sub && c.sub !== 'shell' ? `${c.tool}:${c.sub}` : c.tool || '?');
const isSS = c => /^ss-/.test(c.tool || '');
const isNativeShellRead = c => /^(cat|sed|head|tail|nl|less|awk)$/.test(c.sub || '');
const isRead = c => /^(read|Read|ss-read)$/.test(c.tool || '') || isNativeShellRead(c);

// Paths mentioned in a text: tokens that look like relative file paths with an extension.
const PATH_RE = /(?:^|[\s`'"(\[:=])((?:[\w.@-]+\/)*[\w.@-]+\.[A-Za-z0-9]{1,6})(?::(\d+)(?:-(\d+))?)?/g;
function pathsIn(text) {
  const out = new Set(); if (!text) return out; let m;
  PATH_RE.lastIndex = 0;
  while ((m = PATH_RE.exec(text))) { const p = m[1].replace(/^\.\//, ''); if (!/^\d+\.\d+$/.test(p) && !/^(e\.g|i\.e)\./.test(p)) out.add(p); }
  return out;
}
const baseOf = p => p.split('/').pop();
function refersTo(argText, paths) {
  if (!argText || !paths.size) return false;
  const argPaths = pathsIn(argText);
  for (const a of argPaths) for (const p of paths) if (a === p || a.endsWith('/' + p) || p.endsWith('/' + a) || (baseOf(a) === baseOf(p) && baseOf(a).length > 4)) return true;
  return false;
}

// ss-search result parsing: rank blocks and metadata classes.
function parseSsSearch(text) {
  const ranks = [];
  const lines = (text || '').split('\n');
  const cls = { header: 0, rankHeader: 0, imports: 0, codeGutter: 0, code: 0, summary: 0, related: 0, sameFile: 0, continuation: 0, trailer: 0, other: 0 };
  let inFence = false, fenceKind = null, cur = null, section = null;
  for (const line of lines) {
    const n = line.length + 1;
    if (/^```/.test(line)) { inFence = !inFence; fenceKind = inFence ? (section === 'imports' ? 'imports' : 'code') : null; cls[section === 'imports' ? 'imports' : 'code'] += n; if (!inFence) section = null; continue; }
    if (inFence) {
      if (fenceKind === 'imports') { cls.imports += n; continue; }
      const g = line.match(/^(\s*\d+[:\t|]\s?)/);
      if (g) { cls.codeGutter += g[1].length; cls.code += n - g[1].length; } else cls.code += n;
      if (cur) cur.codeChars += n;
      continue;
    }
    let m;
    if ((m = line.match(/^## #(\d+) (\S+?):(\d+)-(\d+)(?: \[([^:\]]+): ([^\]]+)\])? \(([^)]*)\)/))) {
      cur = { rank: +m[1], file: m[2], start: +m[3], end: +m[4], kind: m[5] || null, symbol: m[6] || null, presentation: (m[7] || '').split(' ')[0], codeChars: 0, chars: 0 };
      ranks.push(cur); cls.rankHeader += n; section = null; continue;
    }
    if (/^### imports/.test(line)) { section = 'imports'; cls.imports += n; continue; }
    if (/^### related/.test(line)) { section = 'related'; cls.related += n; continue; }
    if (/^# ss-search:|^# confidence=|^# variant-sentinel/.test(line)) { cls.header += n; continue; }
    if (/^route=|^shown-full:/.test(line)) { cls.trailer += n; continue; }
    if (/^# continues at|^continues/.test(line)) { cls.continuation += n; continue; }
    if (/^same file:|^# same file/i.test(line)) { cls.sameFile += n; continue; }
    if (section === 'related' && /^- /.test(line)) { cls.related += n; continue; }
    if (cur && cur.presentation === 'summary' && line.trim()) { cls.summary += n; continue; }
    cls.other += n;
  }
  return { ranks, cls };
}

function loadCell(cell) {
  const f = path.join(TRACE_DIR, `${cell}.trace.jsonl`);
  const recs = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const rollouts = new Map();
  for (const r of recs) {
    const key = `${r.arm}|${r.id}`;
    if (!rollouts.has(key)) rollouts.set(key, { arm: r.arm, id: r.id, set: r.set, reqs: [], summary: null });
    const ro = rollouts.get(key);
    if (r.type === 'rollout') ro.summary = r; else ro.reqs.push(r);
    if (r.set) ro.set = r.set;
  }
  for (const ro of rollouts.values()) ro.reqs.sort((a, b) => (a.thread || 'main').localeCompare(b.thread || 'main') || a.req - b.req);
  return [...rollouts.values()].filter(ro => (!SET || ro.set === SET) && (!splitIds || splitIds.has(ro.id)));
}

// ── attribution for one thread (ordered requests) ──
function attributeThread(reqs, P, anthropic, buckets, perCall) {
  const segs = []; // {bucket, tokens, callRef?}
  const add = (bucket, cost) => { buckets[bucket] = (buckets[bucket] || 0) + cost; };
  for (let k = 0; k < reqs.length; k++) {
    const r = reqs[k], t = r.tok || {};
    const inTotal = t.inTotal ?? ((t.inUncached || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0));
    if (k === 0) {
      const qTok = Math.min(inTotal, 400); // frame + question ≈ 250–400 tokens
      segs.push({ bucket: 'prefix', tokens: Math.max(0, inTotal - qTok) }, { bucket: 'question', tokens: qTok });
    } else {
      const prevIn = segs.reduce((s, x) => s + x.tokens, 0);
      const growth = Math.max(0, inTotal - prevIn);
      const prev = reqs[k - 1];
      const resEst = (prev.calls || []).map(c => ({ c, tok: Math.ceil((c.resultChars || 0) / 4) }));
      const argEst = (prev.calls || []).map(c => ({ c, tok: Math.ceil((c.argChars || 0) / 4) }));
      const textEst = Math.ceil((prev.textOutChars || 0) / 4);
      const want = resEst.reduce((s, x) => s + x.tok, 0) + argEst.reduce((s, x) => s + x.tok, 0) + textEst;
      const scale = want > 0 ? growth / want : 0;
      for (const x of argEst) segs.push({ bucket: `args:${toolKey(x.c)}`, tokens: x.tok * scale, call: x.c });
      if (textEst) segs.push({ bucket: 'assistantText', tokens: textEst * scale });
      for (const x of resEst) segs.push({ bucket: `result:${toolKey(x.c)}`, tokens: x.tok * scale, call: x.c });
      if (want === 0 && growth > 0) segs.push({ bucket: 'harnessOverhead', tokens: growth });
      // context shrink (compaction / dropped thinking): scale the whole context down
      const tot = segs.reduce((s, x) => s + x.tokens, 0);
      if (tot > inTotal && tot > 0) { const f = inTotal / tot; for (const s of segs) s.tokens *= f; }
    }
    // price this request's input: cached prefix first
    let cached = t.cacheRead || 0;
    const freshPrice = anthropic ? P.write : P.in;
    // Anthropic: uncached-but-not-written tokens are billed at P.in; split fresh part into write + uncached proportionally
    const fresh = Math.max(0, inTotal - cached);
    const freshCostPerTok = fresh > 0 ? (((t.cacheWrite || 0) * (anthropic ? P.write : P.in) + (t.inUncached || 0) * P.in) / fresh) : freshPrice;
    for (const s of segs) {
      const c = Math.min(cached, s.tokens); cached -= c;
      const cost = (c * P.cache + (s.tokens - c) * freshCostPerTok) / 1e6;
      add(s.bucket.startsWith('result:') ? s.bucket : s.bucket.startsWith('args:') ? s.bucket.replace('args:', 'argsCtx:') : s.bucket, cost);
      if (s.call) { perCall.set(s.call, (perCall.get(s.call) || 0) + cost); }
    }
    // output
    const outTok = t.out || 0;
    const argTok = (r.calls || []).reduce((s, c) => s + Math.ceil((c.argChars || 0) / 4), 0);
    const textTok = Math.ceil((r.textOutChars || 0) / 4);
    const reasoningTok = t.reasoning != null ? t.reasoning : Math.max(0, outTok - argTok - textTok);
    const scaleOut = argTok + textTok + reasoningTok > 0 ? outTok / (argTok + textTok + reasoningTok) : 0;
    for (const c of r.calls || []) { const cost = Math.ceil((c.argChars || 0) / 4) * scaleOut * P.out / 1e6; add(`argsOut:${toolKey(c)}`, cost); perCall.set(c, (perCall.get(c) || 0) + cost); }
    add(k === reqs.length - 1 && !(r.calls || []).length ? 'finalAnswerOut' : 'textOut', textTok * scaleOut * P.out / 1e6);
    add('reasoningOut', reasoningTok * scaleOut * P.out / 1e6);
  }
}

function analyzeCell(cell) {
  const P = PRICES[cell]; const anthropic = cell.startsWith('cc-');
  const ros = loadCell(cell);
  const out = { cell, arms: {} };
  for (const arm of ['native', 'sweet']) {
    const rs = ros.filter(r => r.arm === arm);
    const buckets = {}; const perCall = new Map();
    const tools = {}; let totalCost = 0, totalCalls = 0, totalTurns = 0, totalResTok = 0;
    const perQ = [];
    const follow = {}; const rankUse = {}; const meta = { header: 0, rankHeader: 0, imports: 0, codeGutter: 0, code: 0, summary: 0, related: 0, sameFile: 0, continuation: 0, trailer: 0, other: 0 };
    const reasonAfter = {};
    for (const ro of rs) {
      const threads = new Map(); for (const r of ro.reqs) { const th = r.thread || 'main'; if (!threads.has(th)) threads.set(th, []); threads.get(th).push(r); }
      for (const reqs of threads.values()) attributeThread(reqs, P, anthropic, buckets, perCall);
      const cost = ro.reqs.reduce((s, r) => s + (r.costUsd || 0), 0); totalCost += cost;
      const calls = ro.reqs.flatMap(r => r.calls || []);
      totalCalls += calls.length; totalTurns += ro.reqs.length;
      perQ.push({ id: ro.id, set: ro.set, cost, calls: calls.length, turns: ro.reqs.length });
      const turnsUsing = new Set();
      for (const r of ro.reqs) for (const c of r.calls || []) { const k = toolKey(c); tools[k] ??= { calls: 0, turns: 0, resTok: [], cost: 0 }; tools[k].calls++; tools[k].resTok.push(Math.ceil((c.resultChars || 0) / 4)); totalResTok += Math.ceil((c.resultChars || 0) / 4); turnsUsing.add(`${r.thread}|${r.req}|${k}`); }
      for (const s of turnsUsing) tools[s.split('|')[2]].turns++;
      // follow-up after each call (main thread)
      const main = ro.reqs.filter(r => (r.thread || 'main') === 'main');
      const answer = ro.summary?.answer || '';
      for (let k = 0; k < main.length; k++) {
        const next = main.slice(k + 1).find(r => (r.calls || []).length);
        for (const c of main[k].calls || []) {
          const key = toolKey(c); follow[key] ??= { n: 0, drill: 0, sufficient: 0, retry: 0, switch: 0, fallback: 0, ignored: 0 };
          const f = follow[key]; f.n++;
          const resPaths = pathsIn(c.resultText || '');
          if (!next) { f.sufficient++; continue; }
          const nc = next.calls;
          if (nc.some(x => refersTo(x.argText, resPaths))) { f.drill++; continue; }
          if (nc.some(x => toolKey(x) === key)) { f.retry++; continue; }
          if (isSS(c) && nc.some(x => isSS(x))) { f.switch++; continue; }
          if (isSS(c) && nc.some(x => !isSS(x))) { f.fallback++; continue; }
          if (!isSS(c) && nc.some(x => /grep|rg|glob|find|Grep|Glob|search/i.test(toolKey(x)))) { f.retry++; continue; }
          f.ignored++;
        }
        // reasoning after tool: reasoning of request k attributed to the tools whose results it first reads (calls of k-1)
        if (k > 0) {
          const rtok = main[k].tok?.reasoning ?? null;
          const kinds = [...new Set((main[k - 1].calls || []).map(toolKey))];
          if (rtok != null && kinds.length) for (const kk of kinds) { reasonAfter[kk] ??= { n: 0, tok: 0 }; reasonAfter[kk].n++; reasonAfter[kk].tok += rtok / kinds.length; }
        }
      }
      // ss-search rank usage + metadata
      const allLater = (idx) => main.slice(idx + 1).flatMap(r => r.calls || []).map(x => x.argText || '').join('\n');
      main.forEach((r, idx) => {
        for (const c of r.calls || []) {
          if (c.tool !== 'ss-search') continue;
          const { ranks, cls } = parseSsSearch(c.resultText);
          for (const k2 of Object.keys(cls)) meta[k2] += cls[k2];
          const later = allLater(idx);
          for (const rk of ranks) {
            const key = `${rk.rank <= 5 ? rk.rank : '6+'}|${rk.presentation}`;
            rankUse[key] ??= { n: 0, readLater: 0, inAnswer: 0, used: 0, codeChars: 0 };
            const u = rankUse[key]; u.n++; u.codeChars += rk.codeChars;
            const read = refersTo(later, new Set([rk.file]));
            const cited = answer.includes(baseOf(rk.file)) && (!rk.symbol || answer.includes(rk.symbol.split(/[.:]/).pop()) || answer.includes(rk.file));
            if (read) u.readLater++; if (cited) u.inAnswer++; if (read || cited) u.used++;
          }
        }
      });
    }
    for (const [c, cost] of perCall) { const k = toolKey(c); if (tools[k]) tools[k].cost += cost; }
    const bucketTotal = Object.values(buckets).reduce((s, x) => s + x, 0);
    out.arms[arm] = { n: rs.length, totalCost, bucketTotal, buckets, tools, totalCalls, totalTurns, totalResTok, perQ, follow, rankUse, meta, reasonAfter };
  }
  return out;
}

function render(res) {
  const L = [];
  const { cell } = res;
  L.push(`\n## ${cell}${SET ? ` (set=${SET})` : ''}${IDSPLIT ? ` (ids=${IDSPLIT})` : ''}\n`);
  const a = res.arms;
  L.push(`Reconciliation: Σ attributed buckets vs Σ request cost — native ${pct(a.native.bucketTotal, a.native.totalCost)}%, sweet ${pct(a.sweet.bucketTotal, a.sweet.totalCost)}%.\n`);
  // turns vs calls
  L.push('| Arm | n | cost/q $ | turns/q | calls/q | calls/turn |', '|---|---|---|---|---|---|');
  for (const arm of ['native', 'sweet']) { const x = a[arm]; L.push(`| ${arm} | ${x.n} | ${(x.totalCost / x.n).toFixed(5)} | ${(x.totalTurns / x.n).toFixed(2)} | ${(x.totalCalls / x.n).toFixed(2)} | ${(x.totalCalls / Math.max(1, x.totalTurns)).toFixed(2)} |`); }
  const nat = new Map(a.native.perQ.map(p => [p.id, p])); const pairs = a.sweet.perQ.filter(p => nat.has(p.id));
  for (const m of ['turns', 'calls', 'cost']) { const ds = pairs.map(p => ({ set: p.set, d: p[m] - nat.get(p.id)[m] })); const [lo, hi] = bootCI(ds); L.push(`\nPaired sweet − native ${m}: Δ ${mean(ds.map(x => x.d)).toFixed(m === 'cost' ? 5 : 2)} [${lo.toFixed(m === 'cost' ? 5 : 2)}, ${hi.toFixed(m === 'cost' ? 5 : 2)}] (n=${ds.length})`); }
  // buckets
  L.push('\n### Cost buckets (% of arm cost)\n', '| Bucket | native % | sweet % | native $/q | sweet $/q |', '|---|---|---|---|---|');
  const group = (b) => b.startsWith('result:') ? `results: ${b.slice(7)}` : b.startsWith('argsCtx:') || b.startsWith('argsOut:') ? `call args: ${b.split(':').slice(1).join(':')}` : b;
  const agg = { native: {}, sweet: {} };
  for (const arm of ['native', 'sweet']) for (const [b, v] of Object.entries(a[arm].buckets)) { const g = group(b); agg[arm][g] = (agg[arm][g] || 0) + v; }
  const keys = [...new Set([...Object.keys(agg.native), ...Object.keys(agg.sweet)])].sort((x, y) => ((agg.sweet[y] || 0) + (agg.native[y] || 0)) - ((agg.sweet[x] || 0) + (agg.native[x] || 0)));
  for (const k of keys) { if (((agg.native[k] || 0) + (agg.sweet[k] || 0)) / (a.native.totalCost + a.sweet.totalCost) < 0.003) continue; L.push(`| ${k} | ${pct(agg.native[k] || 0, a.native.bucketTotal)} | ${pct(agg.sweet[k] || 0, a.sweet.bucketTotal)} | ${((agg.native[k] || 0) / a.native.n).toFixed(5)} | ${((agg.sweet[k] || 0) / a.sweet.n).toFixed(5)} |`); }
  // per-tool share
  for (const arm of ['native', 'sweet']) {
    const x = a[arm];
    L.push(`\n### Per-tool share — ${arm}\n`, '| Tool | calls | % calls | % turns using | result tok median | p90 | % result tok | % cost (result+args) | follow: drill / sufficient / retry / switch / fallback / ignored (%) |', '|---|---|---|---|---|---|---|---|---|');
    const ts = Object.entries(x.tools).sort((p, q2) => q2[1].calls - p[1].calls);
    for (const [k, t] of ts) {
      if (t.calls < 2) continue;
      const f = x.follow[k] || { n: 0 };
      const fp = f.n ? ['drill', 'sufficient', 'retry', 'switch', 'fallback', 'ignored'].map(z => pct(f[z], f.n)).join(' / ') : '—';
      L.push(`| ${k} | ${t.calls} | ${pct(t.calls, x.totalCalls)} | ${pct(t.turns, x.totalTurns)} | ${q(t.resTok, 0.5)} | ${q(t.resTok, 0.9)} | ${pct(t.resTok.reduce((s, y) => s + y, 0), x.totalResTok)} | ${pct(t.cost, x.totalCost)} | ${fp} |`);
    }
    const ra = Object.entries(x.reasonAfter).filter(([, v]) => v.n >= 3).sort((p, q2) => q2[1].n - p[1].n);
    if (ra.length) { L.push(`\nReasoning tokens in the request after a tool result (${arm}): ` + ra.map(([k, v]) => `${k} ${(v.tok / v.n).toFixed(0)} (n=${v.n})`).join('; ')); }
  }
  // rank usage
  const ru = a.sweet.rankUse; const rk = Object.keys(ru).sort();
  if (rk.length) {
    L.push('\n### ss-search rank usage (sweet)\n', '| Rank | presentation | n | read later % | cited in answer % | used % | code chars/rank |', '|---|---|---|---|---|---|---|');
    for (const k of rk) { const u = ru[k]; const [r, p] = k.split('|'); L.push(`| ${r} | ${p} | ${u.n} | ${pct(u.readLater, u.n)} | ${pct(u.inAnswer, u.n)} | ${pct(u.used, u.n)} | ${(u.codeChars / u.n).toFixed(0)} |`); }
    const m = a.sweet.meta; const tot = Object.values(m).reduce((s, v) => s + v, 0);
    L.push('\n### ss-search output composition (chars, sweet)\n', '| Part | % |', '|---|---|', ...Object.entries(m).sort((p, q2) => q2[1] - p[1]).map(([k2, v]) => `| ${k2} | ${pct(v, tot)} |`));
  }
  return L.join('\n');
}

const results = cells.map(analyzeCell);
console.log(`# r282 trace analysis — common tables${SET ? ` (set=${SET})` : ''}${IDSPLIT ? ` (ids=${IDSPLIT})` : ''}\n\nGenerated by trace/analyze-traces.mjs. Cost attribution: see the file header. Follow-up labels: rule-based (path overlap between a result and the next request's calls).`);
for (const r of results) console.log(render(r));
fs.writeFileSync(path.join(TRACE_DIR, `analysis${SET ? '-' + SET : ''}${IDSPLIT ? '-' + IDSPLIT : ''}.json`), JSON.stringify(results.map(r => ({ cell: r.cell, arms: Object.fromEntries(Object.entries(r.arms).map(([k, v]) => [k, { ...v, perQ: undefined }])) })), null, 1));

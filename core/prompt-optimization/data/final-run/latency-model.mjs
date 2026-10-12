#!/usr/bin/env node
// latency-model.mjs — agent time from tokens and turns, free of bench concurrency.
//
//   node core/prompt-optimization/data/final-run/latency-model.mjs --tag ho1005 --heldout \
//     [--cells cc-opus55-medium,...] [--state ~/.ss-eval/r282] [--out latency.json] [--boot 10000]
//
// Why: the bench ran 6–10 rollouts at once, so measured wall time (and above all tool time) carries
// machine contention that production does not have. Tokens and turns do not depend on concurrency.
//
// Per rollout, from the RAW traces (the rows do not store turns or per-turn usage):
//   Claude Code  <state>/<cell>-<tag>-r<rep>/claude-home-<arm>/projects/<slug>/<session>.jsonl
//                (row ↔ session by arm home, repo slug and start time; turns = distinct message.id)
//   Codex        <state>/.../codex-home/sessions/**/rollout-*.jsonl
//                (row ↔ rollout by exact final token totals; turns = token_count events)
//   opencode     <state>/.../oc-data-<arm>/opencode.db (row.sessionID; turns = step-finish parts,
//                child sessions of `task` subagents added as sequential turns — an upper bound)
// Fields: turns; prefill = uncached input + cache write; cache read; decode = output + reasoning;
// tool time = union of tool-call intervals (subagent `task` calls replaced by the child's own tools);
// measured LLM time = session span − tool time; overhead = wall − session span.
//
// Model, per cell, ONE set of coefficients for both arms (non-negative least squares over rollouts):
//   LLM s ≈ β_turn·turns + β_pre·prefill + β_read·cacheRead + β_dec·decode
// The fit uses the measured LLM time: provider-side latency, which local contention barely touches.
// With β fixed, the sweet − native difference in modelled LLM time comes from tokens and turns only.
// Tool time is NOT modelled (no serial run): the report gives the bench-measured tool time
// (contended, an upper bound) and the BREAK-EVEN — the mean sweet tool time per call at which
// sweet and native take equally long.
//
// Unit = question (mean over reps); intervals = 95% question-clustered bootstrap, stratified by tier,
// B = 10000, seed 42 (as analyze.mjs). --heldout: aggregates only, no per-question value anywhere.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i !== -1 ? argv[i + 1] : d; };
const RESULTS = path.resolve(flag('--results', path.join(HERE, '../results')));
const STATE = path.resolve(flag('--state', path.join(os.homedir(), '.ss-eval/r282')));
const TAG = flag('--tag', 'ho1005');
const CELLS = String(flag('--cells', 'cc-sonnet55-high,cc-opus55-medium,cc-opus55-high,codex-sol61-high,oc-sol61-high')).split(',').filter(Boolean);
const OUT = flag('--out', null);
const B = Number(flag('--boot', 10000));
const HELDOUT = argv.includes('--heldout');
const ARMS = ['sweet', 'native'];

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const ms = (t) => (typeof t === 'number' ? t : Date.parse(t));
function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const walkFiles = (d, test, out = []) => { let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return out; } for (const e of es) { const f = path.join(d, e.name); if (e.isDirectory()) walkFiles(f, test, out); else if (test(e.name)) out.push(f); } return out; };
const repoOf = (id) => `r3-${id.replace(/^r3h?b?-/, '').replace(/-\d+$/, '')}`;

// Total time covered by a set of [start, end] intervals (parallel calls count once).
function unionMs(iv) {
  const s = iv.filter(([a, b]) => fin(a) && fin(b) && b >= a).sort((x, y) => x[0] - y[0]);
  let tot = 0, cs = -Infinity, ce = -Infinity;
  for (const [a, b] of s) { if (a > ce) { if (ce > cs) tot += ce - cs; cs = a; ce = b; } else ce = Math.max(ce, b); }
  if (ce > cs) tot += ce - cs;
  return tot;
}
const emptyTok = () => ({ turns: 0, prefill: 0, cacheRead: 0, decode: 0, reasoning: 0 });
const addTok = (t, u) => { t.turns++; t.prefill += u.prefill; t.cacheRead += u.cacheRead; t.decode += u.decode; t.reasoning += u.reasoning ?? 0; };

// ─── Claude Code ────────────────────────────────────────────────────────────────────────────────
function parseClaudeSession(file) {
  const recs = readJsonl(file).filter(r => r.isSidechain !== true);
  const msgs = new Map(); const callAt = new Map(); const iv = []; let start = null, end = null, sidechain = false;
  for (const r of recs) {
    const t = r.timestamp ? ms(r.timestamp) : null;
    if (r.type === 'user' && start == null && t != null) start = t;
    const m = r.message || {};
    if (r.type === 'assistant' && m.id) {
      const u = m.usage || {};
      const prev = msgs.get(m.id);
      if (!prev || (u.output_tokens ?? 0) >= (prev.u.output_tokens ?? 0)) msgs.set(m.id, { u, t: Math.max(t ?? 0, prev?.t ?? 0) });
      else prev.t = Math.max(prev.t, t ?? 0);
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b.type === 'tool_use') { callAt.set(b.id, t); if (b.name === 'Task' || b.name === 'Agent') sidechain = true; }
      }
      if (t != null) end = Math.max(end ?? 0, t);
    }
    if (r.type === 'user' && Array.isArray(m.content)) for (const b of m.content) {
      if (b.type === 'tool_result' && callAt.has(b.tool_use_id)) iv.push([callAt.get(b.tool_use_id), t]);
    }
  }
  const tok = emptyTok();
  for (const { u } of msgs.values()) addTok(tok, {
    prefill: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0), cacheRead: u.cache_read_input_tokens || 0,
    decode: u.output_tokens || 0, reasoning: u.output_tokens_details?.thinking_tokens || 0,
  });
  return { start, end, tok, toolMs: unionMs(iv), calls: callAt.size, sidechain };
}
function claudeIndex(stateDir, arm) {
  const out = [];
  for (const f of walkFiles(path.join(stateDir, `claude-home-${arm}`, 'projects'), n => n.endsWith('.jsonl'))) {
    if (f.includes('warmup')) continue;
    const s = parseClaudeSession(f);
    if (s.start != null) out.push({ ...s, slug: path.basename(path.dirname(f)), used: false });
  }
  return out;
}
function matchClaude(index, row) {
  const repo = repoOf(row.id);
  const out = row.usage?.output_tokens;
  const c = index.filter(s => !s.used && s.slug.endsWith(`--${repo}`) && s.start >= row.startedAtMs - 2000 && s.start <= row.startedAtMs + row.wallMs);
  if (!c.length) return null;
  c.sort((a, b) => (Number(b.tok.decode === out) - Number(a.tok.decode === out)) || (a.start - b.start));
  c[0].used = true;
  return { ...c[0], how: c[0].tok.decode === out ? 'tokens+time' : 'time' };
}

// ─── Codex ──────────────────────────────────────────────────────────────────────────────────────
function parseCodexRollout(file) {
  const tok = emptyTok(); const callAt = new Map(); const iv = [];
  let start = null, end = null, last = null, total = null, cwd = null;
  for (const r of readJsonl(file)) {
    const t = r.timestamp ? ms(r.timestamp) : null; const p = r.payload || {};
    if (r.type === 'session_meta') cwd = p.cwd;
    if (p.type === 'task_started' && start == null) start = t;
    if (p.type === 'task_complete') end = t;
    if (r.type === 'response_item' && p.call_id) {
      if (/_call$/.test(p.type)) callAt.set(p.call_id, t);
      else if (/_call_output$/.test(p.type) && callAt.has(p.call_id)) iv.push([callAt.get(p.call_id), t]);
    }
    if (p.type === 'token_count' && p.info?.last_token_usage) {
      const key = JSON.stringify(p.info.total_token_usage);
      if (key === last) continue; last = key; total = p.info.total_token_usage;
      const u = p.info.last_token_usage;
      addTok(tok, { prefill: (u.input_tokens || 0) - (u.cached_input_tokens || 0), cacheRead: u.cached_input_tokens || 0, decode: u.output_tokens || 0, reasoning: u.reasoning_output_tokens || 0 });
    }
    if (t != null && r.type === 'response_item') end = Math.max(end ?? 0, t);
  }
  return { start, end, tok, toolMs: unionMs(iv), calls: callAt.size, total, cwd };
}
function codexIndex(stateDir) {
  return walkFiles(path.join(stateDir, 'codex-home', 'sessions'), n => n.startsWith('rollout-') && n.endsWith('.jsonl'))
    .map(f => ({ ...parseCodexRollout(f), used: false })).filter(s => s.start != null);
}
function matchCodex(index, row) {
  const u = row.usage || {};
  const same = (s) => s.total && s.total.input_tokens === u.input_tokens && s.total.cached_input_tokens === u.cached_input_tokens && s.total.output_tokens === u.output_tokens;
  const inWin = (s) => s.start >= row.startedAtMs - 2000 && s.start <= row.startedAtMs + row.wallMs;
  const c = index.filter(s => !s.used && same(s) && inWin(s) && String(s.cwd).endsWith(repoOf(row.id)));
  if (!c.length) return null;
  c.sort((a, b) => a.start - b.start); c[0].used = true;
  return { ...c[0], how: 'tokens+time' };
}

// ─── opencode ───────────────────────────────────────────────────────────────────────────────────
const dbCache = new Map();
function ocDb(f) { if (!dbCache.has(f)) dbCache.set(f, new DatabaseSync(f, { readOnly: true })); return dbCache.get(f); }
function ocSession(db, sid, depth = 0) {
  const parts = db.prepare('select time_created as t, time_updated as u, data from part where session_id = ? order by time_created, id').all(sid).map(p => ({ t: p.t, u: p.u, d: JSON.parse(p.data) }));
  const tok = emptyTok(); const iv = [], ivUpper = [], spans = []; let calls = 0, subagents = 0, overlaps = 0;
  for (const { d, t, u } of parts) {
    if (d.type === 'step-finish' && d.tokens) {
      const k = d.tokens;
      addTok(tok, { prefill: (k.input || 0) + (k.cache?.write || 0), cacheRead: k.cache?.read || 0, decode: (k.output || 0) + (k.reasoning || 0), reasoning: k.reasoning || 0 });
    }
    if (d.type === 'tool') {
      calls++;
      if (d.tool === 'task') { subagents++; continue; }   // the child session supplies its own turns and tools
      // opencode stamps state.time only around the result (a few ms), so it is a LOWER bound; the part's
      // own created → updated window also holds the time the model spends writing the command (UPPER bound).
      const st = d.state?.time; if (st) iv.push([st.start, st.end]);
      ivUpper.push([t, u]);
    }
  }
  // A `task` subagent blocks the main session, so its turns add up in sequence. Overlapping children
  // (parallel subagents) would make that sum an over-count: they are counted and reported.
  if (depth < 3) for (const ch of db.prepare('select id from session where parent_id = ?').all(sid)) {
    const c = ocSession(db, ch.id, depth + 1);
    for (const k of Object.keys(tok)) tok[k] += c.tok[k];
    iv.push(...c.iv); ivUpper.push(...c.ivUpper); calls += c.calls; subagents += c.subagents; overlaps += c.overlaps;
    if (spans.some(([a, b]) => c.start < b && a < c.end)) overlaps++;
    spans.push([c.start, c.end]);
  }
  const start = parts.length ? parts[0].t : null;
  const end = parts.filter(p => p.d.type === 'step-finish').reduce((m, p) => Math.max(m, p.t), start ?? 0);
  return { start, end, tok, iv, ivUpper, calls, subagents, overlaps };
}
function matchOpencode(stateDir, row) {
  if (!row.sessionID) return null;
  const f = path.join(stateDir, `oc-data-${row.arm}`, 'opencode.db');
  if (!fs.existsSync(f)) return null;
  const s = ocSession(ocDb(f), row.sessionID);
  if (s.start == null) return null;
  return { ...s, toolMs: unionMs(s.iv), toolUpperMs: unionMs(s.ivUpper), how: 'sessionID' };
}

// ─── rows ───────────────────────────────────────────────────────────────────────────────────────
function loadCell(cell) {
  const dirs = fs.readdirSync(RESULTS).filter(d => new RegExp(`^r282-${cell}-${TAG}-r\\d+$`).test(d)).sort();
  const rows = []; const match = { matched: 0, missing: 0, how: {}, parallelSubagents: 0 };
  for (const d of dirs) {
    const rep = Number(/-r(\d+)$/.exec(d)[1]);
    const stateDir = path.join(STATE, d.replace(/^r282-/, ''));
    const best = new Map();
    for (const r of readJsonl(path.join(RESULTS, d, 'runs.jsonl'))) {
      if (r.warmup === true || r.id === '__warmup__' || !ARMS.includes(r.arm)) continue;
      const k = `${r.arm}|${r.id}`; const ok = !r.error && r.exitCode === 0;
      if (ok) best.set(k, r); else if (!best.has(k)) best.set(k, null);
    }
    const ok = [...best.values()].filter(Boolean).sort((a, b) => a.startedAtMs - b.startedAtMs);
    const harness = ok[0]?.harness;
    const idx = harness === 'cc' ? Object.fromEntries(ARMS.map(a => [a, claudeIndex(stateDir, a)])) : harness === 'codex' ? codexIndex(stateDir) : null;
    for (const r of ok) {
      const tr = harness === 'cc' ? matchClaude(idx[r.arm], r) : harness === 'codex' ? matchCodex(idx, r) : matchOpencode(stateDir, r);
      if (!tr) { match.missing++; continue; }
      match.matched++; match.how[tr.how] = (match.how[tr.how] || 0) + 1; match.parallelSubagents += tr.overlaps || 0;
      const spanMs = Math.max(0, tr.end - tr.start);
      rows.push({
        id: r.id, tier: r.set, arm: r.arm, rep, ...tr.tok, calls: r.calls ?? tr.calls,
        toolS: tr.toolMs / 1000, toolUpperS: (tr.toolUpperMs ?? tr.toolMs) / 1000, llmS: Math.max(0, spanMs - tr.toolMs) / 1000,
        overheadS: Math.max(0, r.wallMs - spanMs) / 1000, wallS: r.wallMs / 1000,
        subagent: !!(tr.sidechain || tr.subagents),
      });
    }
  }
  return { dirs, rows, match };
}

// ─── non-negative least squares (tiny: 4 columns), no intercept ─────────────────────────────────
function solve(A, b) { // Gauss-Jordan
  const n = A.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]]; if (Math.abs(M[c][c]) < 1e-12) return null;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function nnls(X, y) {
  const p = X[0].length; let active = [...Array(p).keys()]; let beta = Array(p).fill(0);
  for (let it = 0; it < p && active.length; it++) {
    const A = active.map(i => active.map(j => X.reduce((s, x) => s + x[i] * x[j], 0)));
    const b = active.map(i => X.reduce((s, x, k) => s + x[i] * y[k], 0));
    const sol = solve(A, b); if (!sol) break;
    beta = Array(p).fill(0); active.forEach((i, k) => { beta[i] = sol[k]; });
    const neg = active.filter(i => beta[i] < 0);
    if (!neg.length) break;
    active = active.filter(i => beta[i] > 0); beta = beta.map(v => Math.max(0, v));
  }
  const pred = X.map(x => x.reduce((s, v, i) => s + v * beta[i], 0));
  const my = mean(y); const ssr = y.reduce((s, v, i) => s + (v - pred[i]) ** 2, 0); const sst = y.reduce((s, v) => s + (v - my) ** 2, 0);
  return { beta, r2: 1 - ssr / sst };
}
const FEATS = ['turns', 'prefill', 'cacheRead', 'decode'];

// ─── per-question contrast (as analyze.mjs) ─────────────────────────────────────────────────────
function perQuestion(rows, metrics) {
  const q = new Map();
  for (const r of rows) { if (!q.has(r.id)) q.set(r.id, { tier: r.tier, arms: {} }); (q.get(r.id).arms[r.arm] ||= []).push(r); }
  for (const e of q.values()) for (const [a, rs] of Object.entries(e.arms)) e.arms[a] = Object.fromEntries(metrics.map(m => [m, mean(rs.map(r => r[m]).filter(fin))]));
  return q;
}
function contrast(q, m, seed = 42) {
  const items = [...q.values()].filter(e => fin(e.arms.sweet?.[m]) && fin(e.arms.native?.[m])).map(e => ({ tier: e.tier, x: e.arms.sweet[m], y: e.arms.native[m] }));
  if (!items.length) return null;
  const stat = (its) => { const mx = mean(its.map(i => i.x)), my = mean(its.map(i => i.y)); return { diff: mx - my, rel: my ? mx / my - 1 : NaN, mx, my }; };
  const byTier = new Map(); for (const i of items) { if (!byTier.has(i.tier)) byTier.set(i.tier, []); byTier.get(i.tier).push(i); }
  const rnd = mulberry32(seed); const diffs = [], rels = [];
  for (let k = 0; k < B; k++) { const s = []; for (const g of byTier.values()) for (let j = 0; j < g.length; j++) s.push(g[Math.floor(rnd() * g.length)]); const st = stat(s); diffs.push(st.diff); rels.push(st.rel); }
  const ci = (v) => { const w = v.filter(fin).sort((x, y) => x - y); return [w[Math.floor(0.025 * w.length)], w[Math.min(w.length - 1, Math.floor(0.975 * w.length))]]; };
  return { n: items.length, ...stat(items), diffCI: ci(diffs), relCI: ci(rels) };
}

const pct = (v) => (fin(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%` : '—');
const f1 = (v, d = 1) => (fin(v) ? v.toFixed(d) : '—');
const report = { tag: TAG, generatedAt: new Date().toISOString(), boot: B, heldout: HELDOUT, cells: {} };
console.log(`# Agent time from tokens and turns (${TAG})\n`);
console.log('Unit = question (mean over reps). 95% question-clustered bootstrap, stratified by tier. `*` = interval excludes 0.');
console.log('Modelled LLM time uses ONE coefficient set per cell for both arms, so its sweet − native difference comes from tokens and turns only.\n');

for (const cell of CELLS) {
  const { dirs, rows, match } = loadCell(cell);
  if (!rows.length) { console.log(`## ${cell}\n\nno rows (${dirs.length} dirs)\n`); continue; }
  const fit = nnls(rows.map(r => FEATS.map(f => r[f])), rows.map(r => r.llmS));
  for (const r of rows) {
    r.modelLlmS = FEATS.reduce((s, f, i) => s + fit.beta[i] * r[f], 0);
    FEATS.forEach((f, i) => { r[`part_${f}`] = fit.beta[i] * r[f]; });
    r.toolPerCallS = r.calls ? r.toolS / r.calls : NaN;
    r.toolUpperPerCallS = r.calls ? r.toolUpperS / r.calls : NaN;
    r.modelLlmNoSubS = r.subagent ? NaN : r.modelLlmS;
  }
  const isOc = rows.some(r => r.toolUpperS !== r.toolS);
  const M = ['turns', 'calls', 'prefill', 'cacheRead', 'decode', 'reasoning', 'llmS', 'modelLlmS', 'modelLlmNoSubS', 'toolS', 'toolUpperS', 'toolPerCallS', 'toolUpperPerCallS', 'overheadS', 'wallS', ...FEATS.map(f => `part_${f}`)];
  const q = perQuestion(rows, M);
  const armMean = (a, m) => mean([...q.values()].map(e => e.arms[a]?.[m]).filter(fin));
  const [bt, bp, br, bd] = fit.beta;
  const out = { dirs, match, fit: { beta: Object.fromEntries(FEATS.map((f, i) => [f, fit.beta[i]])), r2: fit.r2 }, means: {}, contrasts: {} };
  console.log(`## ${cell}\n`);
  console.log(`traces matched ${match.matched}, missing ${match.missing} (${Object.entries(match.how).map(([k, v]) => `${k} ${v}`).join(', ')}); rollouts with subagents: sweet ${rows.filter(r => r.arm === 'sweet' && r.subagent).length}, native ${rows.filter(r => r.arm === 'native' && r.subagent).length} (parallel subagent pairs ${match.parallelSubagents})`);
  console.log(`fit (R² ${f1(fit.r2, 2)}): ${f1(bt, 2)} s per turn · ${f1(bp * 1e6, 1)} ms per 1k prefill tokens · ${f1(br * 1e6, 2)} ms per 1k cache-read tokens · decode ${bd > 0 ? f1(1 / bd, 0) : '—'} tokens/s\n`);
  console.log('| metric | sweet | native | sweet − native | 95% CI | rel [95% CI] |');
  console.log('|---|---|---|---|---|---|');
  const LABEL = { turns: 'turns (model requests)', calls: 'tool calls', prefill: 'prefill tokens (uncached + cache write)', cacheRead: 'cache-read tokens', decode: 'decode tokens (output + reasoning)', reasoning: 'of which reasoning', llmS: 'LLM time, measured (s)', modelLlmS: 'LLM time, modelled from tokens + turns (s)', part_turns: '  · from turns (s)', part_prefill: '  · from prefill (s)', part_cacheRead: '  · from cache read (s)', part_decode: '  · from decode (s)', toolS: `tool time, bench-measured, contended${isOc ? ', lower bound' : ''} (s)`, toolPerCallS: `tool time per call, bench${isOc ? ', lower bound' : ''} (s)`, toolUpperS: 'tool time, upper bound incl. writing the command (s)', toolUpperPerCallS: 'tool time per call, upper bound (s)', modelLlmNoSubS: 'LLM time, modelled, rollouts without subagents (s)', overheadS: 'harness start/stop (s)', wallS: 'wall time, bench (s)' };
  const anySub = rows.some(r => r.subagent);
  for (const m of ['turns', 'calls', 'prefill', 'cacheRead', 'decode', 'reasoning', 'modelLlmS', 'part_turns', 'part_prefill', 'part_cacheRead', 'part_decode', ...(anySub ? ['modelLlmNoSubS'] : []), 'llmS', 'toolS', 'toolPerCallS', ...(isOc ? ['toolUpperS', 'toolUpperPerCallS'] : []), 'overheadS', 'wallS']) {
    const c = contrast(q, m); out.means[m] = { sweet: armMean('sweet', m), native: armMean('native', m) }; out.contrasts[m] = c;
    const d = /S$|^part_/.test(m) ? 2 : (m === 'turns' || m === 'calls') ? 1 : 0;
    const sig = c && (c.diffCI[0] > 0 || c.diffCI[1] < 0) ? ' *' : '';
    console.log(`| ${LABEL[m]} | ${f1(out.means[m].sweet, d)} | ${f1(out.means[m].native, d)} | ${c ? f1(c.diff, d) + sig : '—'} | ${c ? `[${f1(c.diffCI[0], d)}, ${f1(c.diffCI[1], d)}]` : '—'} | ${c ? `${pct(c.rel)} [${pct(c.relCI[0])}, ${pct(c.relCI[1])}]` : '—'} |`);
  }
  // Break-even: sweet's mean tool time per call at which modelled LLM + tools are equal for both arms.
  // Native tool time is the bench-measured value (contended → generous to native's total, strict for sweet).
  const be = (armMean('native', 'modelLlmS') + armMean('native', 'toolS') - armMean('sweet', 'modelLlmS')) / armMean('sweet', 'calls');
  out.breakEvenSweetToolPerCallS = be;
  const benchPerCall = isOc ? `${f1(armMean('sweet', 'toolPerCallS'), 2)}–${f1(armMean('sweet', 'toolUpperPerCallS'), 2)}` : f1(armMean('sweet', 'toolPerCallS'), 2);
  console.log(be > 0
    ? `\nbreak-even: sweet stays faster while its mean tool time per call is below ${f1(be, 2)} s (bench-measured, contended: ${benchPerCall} s).\n`
    : `\nbreak-even: none — sweet's modelled LLM time alone exceeds native's LLM + tool time, so sweet is slower on this cell at any tool speed (bench-measured sweet tool time per call: ${benchPerCall} s).\n`);
  report.cells[cell] = out;
}
if (HELDOUT) console.log('Held-out: aggregates only (no per-question value).');
if (OUT) { fs.writeFileSync(OUT, `${JSON.stringify(report, null, 1)}\n`); console.log(`wrote ${OUT}`); }

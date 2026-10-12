// latency-lib.mjs — shared parts of the token + turn latency model (latency-model.mjs for the
// retrieval bench, eval/task-completion-bench/stats/task-latency-model.mjs for the task bench).
//
// Trace parsers return, per rollout: start/end of the session, token kinds summed over model
// turns (turns, prefill = uncached input + cache write, cacheRead, decode = output + reasoning,
// reasoning), tool-call intervals tagged with a tool kind, and the tool-call count.
// Tool kinds: ss, nativeGrep, nativeRead, edit, test, bash (the task-bench classifier), plus
// subagent and poll (Codex write_stdin: waiting on a running command).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const { classifyShellCommand, KIND_PRIORITY } = await import(path.join(REPO, 'eval/task-completion-bench/harness/shell-command-kind.mjs'));

export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
export const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const ms = (t) => (typeof t === 'number' ? t : Date.parse(t));
function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
export const walkFiles = (d, test, out = []) => { let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return out; } for (const e of es) { const f = path.join(d, e.name); if (e.isDirectory()) walkFiles(f, test, out); else if (test(e.name)) out.push(f); } return out; };

// Total time covered by [start, end, kind?] intervals (parallel calls count once).
export function unionMs(iv) {
  const s = iv.filter(([a, b]) => fin(a) && fin(b) && b >= a).sort((x, y) => x[0] - y[0]);
  let tot = 0, cs = -Infinity, ce = -Infinity;
  for (const [a, b] of s) { if (a > ce) { if (ce > cs) tot += ce - cs; cs = a; ce = b; } else ce = Math.max(ce, b); }
  if (ce > cs) tot += ce - cs;
  return tot;
}
export const TOOL_KINDS = ['ss', 'nativeGrep', 'nativeRead', 'edit', 'test', 'bash', 'poll'];
// Per kind: time covered by that kind's intervals, and its call count.
function byKind(iv) {
  const out = {};
  for (const k of new Set(iv.map(x => x[2]))) { const ks = iv.filter(x => x[2] === k); out[k] = { ms: unionMs(ks), calls: ks.length }; }
  return out;
}
const emptyTok = () => ({ turns: 0, prefill: 0, cacheRead: 0, decode: 0, reasoning: 0 });
const addTok = (t, u) => { t.turns++; t.prefill += u.prefill; t.cacheRead += u.cacheRead; t.decode += u.decode; t.reasoning += u.reasoning ?? 0; };
const shellKind = (cmds) => {
  const ks = cmds.map(c => classifyShellCommand(c).kind);
  return KIND_PRIORITY.find(k => ks.includes(k)) || 'bash';
};

// ─── Claude Code ────────────────────────────────────────────────────────────────────────────────
function claudeToolKind(b) {
  const n = b.name || '';
  if (n === 'Task' || n === 'Agent') return 'subagent';
  if (n === 'Grep' || n === 'Glob' || n === 'LS') return 'nativeGrep';
  if (n === 'Read' || n === 'NotebookRead') return 'nativeRead';
  if (n === 'Edit' || n === 'MultiEdit' || n === 'Write' || n === 'NotebookEdit') return 'edit';
  if (n === 'Bash') return shellKind([String(b.input?.command || '')]);
  if (n === 'BashOutput') return 'poll';
  return 'bash';
}
export function parseClaudeSession(file) {
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
        if (b.type === 'tool_use') { const k = claudeToolKind(b); callAt.set(b.id, [t, k]); if (k === 'subagent') sidechain = true; }
      }
      if (t != null) end = Math.max(end ?? 0, t);
    }
    if (r.type === 'user' && Array.isArray(m.content)) for (const b of m.content) {
      if (b.type === 'tool_result' && callAt.has(b.tool_use_id)) { const [t0, k] = callAt.get(b.tool_use_id); iv.push([t0, t, k]); }
    }
  }
  const tok = emptyTok();
  for (const { u } of msgs.values()) addTok(tok, {
    prefill: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0), cacheRead: u.cache_read_input_tokens || 0,
    decode: u.output_tokens || 0, reasoning: u.output_tokens_details?.thinking_tokens || 0,
  });
  return { start, end, tok, toolMs: unionMs(iv), kinds: byKind(iv), calls: callAt.size, sidechain };
}

// ─── Codex ──────────────────────────────────────────────────────────────────────────────────────
// Codex 0.159 sends shell work through a code-mode `exec` tool whose input is a JS snippet calling
// tools.exec_command({cmd: "..."}) and/or tools.write_stdin (a poll of a running command).
// Stock Codex also waits on a running exec cell with separate `wait` / `sleep` calls (poll).
function codexToolKind(p) {
  const text = String(p.input ?? p.arguments ?? '');
  if (p.name === 'wait' || p.name === 'sleep' || p.name === 'write_stdin') return 'poll';
  if (/spawn_agent|followup_task/.test(text)) return 'subagent';
  const cmds = [...text.matchAll(/cmd\s*["']?\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map(m => { try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; } });
  const ks = cmds.map(c => classifyShellCommand(c).kind);
  if (p.name === 'apply_patch' || /apply_patch/.test(text)) ks.push('edit');
  if (ks.length) return KIND_PRIORITY.find(k => ks.includes(k)) || 'bash';
  if (/write_stdin/.test(text)) return 'poll';
  return 'bash';
}
export function parseCodexRollout(file) {
  const tok = emptyTok(); const callAt = new Map(); const iv = [];
  let start = null, end = null, last = null, total = null, cwd = null;
  for (const r of readJsonl(file)) {
    const t = r.timestamp ? ms(r.timestamp) : null; const p = r.payload || {};
    if (r.type === 'session_meta') cwd = p.cwd;
    if (p.type === 'task_started' && start == null) start = t;
    if (p.type === 'task_complete') end = t;
    if (r.type === 'response_item' && p.call_id) {
      if (/_call$/.test(p.type)) callAt.set(p.call_id, [t, codexToolKind(p)]);
      else if (/_call_output$/.test(p.type) && callAt.has(p.call_id)) { const [t0, k] = callAt.get(p.call_id); iv.push([t0, t, k]); }
    }
    if (p.type === 'token_count' && p.info?.last_token_usage) {
      const key = JSON.stringify(p.info.total_token_usage);
      if (key === last) continue; last = key; total = p.info.total_token_usage;
      const u = p.info.last_token_usage;
      addTok(tok, { prefill: (u.input_tokens || 0) - (u.cached_input_tokens || 0), cacheRead: u.cached_input_tokens || 0, decode: u.output_tokens || 0, reasoning: u.reasoning_output_tokens || 0 });
    }
    if (t != null && r.type === 'response_item') end = Math.max(end ?? 0, t);
  }
  return { start, end, tok, toolMs: unionMs(iv), kinds: byKind(iv), calls: callAt.size, total, cwd };
}

// ─── opencode ───────────────────────────────────────────────────────────────────────────────────
function ocToolKind(d) {
  const n = d.tool || '';
  if (n === 'task') return 'subagent';
  if (n === 'grep' || n === 'glob' || n === 'list') return 'nativeGrep';
  if (n === 'read') return 'nativeRead';
  if (n === 'edit' || n === 'write' || n === 'patch' || n === 'multiedit' || n === 'apply_patch') return 'edit';
  if (n === 'bash') return shellKind([String(d.state?.input?.command || '')]);
  return 'bash';
}
const dbCache = new Map();
// A copied WAL database may not open read-only; then open a private copy (never the source).
export function ocDb(f, scratch) {
  if (dbCache.has(f)) return dbCache.get(f);
  let db;
  try { db = new DatabaseSync(f, { readOnly: true }); db.prepare('select count(*) from part').get(); }
  catch {
    const d = fs.mkdtempSync(path.join(scratch, 'ocdb-'));
    for (const s of ['', '-wal', '-shm']) if (fs.existsSync(f + s)) fs.copyFileSync(f + s, path.join(d, 'opencode.db' + s));
    db = new DatabaseSync(path.join(d, 'opencode.db'));
  }
  dbCache.set(f, db); return db;
}
export function ocSession(db, sid, depth = 0) {
  const parts = db.prepare('select time_created as t, time_updated as u, data from part where session_id = ? order by time_created, id').all(sid).map(p => ({ t: p.t, u: p.u, d: JSON.parse(p.data) }));
  const tok = emptyTok(); const iv = [], ivUpper = [], spans = []; let calls = 0, subagents = 0, overlaps = 0;
  for (const { d, t, u } of parts) {
    if (d.type === 'step-finish' && d.tokens) {
      const k = d.tokens;
      addTok(tok, { prefill: (k.input || 0) + (k.cache?.write || 0), cacheRead: k.cache?.read || 0, decode: (k.output || 0) + (k.reasoning || 0), reasoning: k.reasoning || 0 });
    }
    if (d.type === 'tool') {
      calls++;
      const kind = ocToolKind(d);
      if (kind === 'subagent') { subagents++; continue; }   // the child session supplies its own turns and tools
      // opencode stamps state.time only around the result (a few ms), so it is a LOWER bound; the part's
      // own created → updated window also holds the time the model spends writing the command (UPPER bound).
      const st = d.state?.time; if (st) iv.push([st.start, st.end, kind]);
      ivUpper.push([t, u, kind]);
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
// Finished opencode trace → the common rollout shape.
export function ocTrace(s) {
  return { ...s, toolMs: unionMs(s.iv), toolUpperMs: unionMs(s.ivUpper), kinds: byKind(s.iv), kindsUpper: byKind(s.ivUpper) };
}

// Common per-rollout record from a matched trace and its result row.
// ocBound 'upper' (task bench): opencode tool time = the part's created → updated window, because its
// state.time misses long commands (tests, builds); measured LLM time is then a lower bound.
export function rolloutRecord({ id, tier, arm, rep, wallMs, calls }, tr, { ocBound = 'lower' } = {}) {
  const spanMs = Math.max(0, tr.end - tr.start);
  const upper = ocBound === 'upper' && tr.toolUpperMs != null;
  const toolMs = upper ? tr.toolUpperMs : tr.toolMs;
  const kinds = upper ? tr.kindsUpper : tr.kinds;
  const rec = {
    id, tier, arm, rep, ...tr.tok, calls: calls ?? tr.calls,
    toolS: toolMs / 1000, toolUpperS: (upper ? toolMs : (tr.toolUpperMs ?? tr.toolMs)) / 1000,
    llmS: Math.max(0, spanMs - toolMs) / 1000, overheadS: Math.max(0, wallMs - spanMs) / 1000, wallS: wallMs / 1000,
    subagent: !!(tr.sidechain || tr.subagents),
  };
  for (const k of TOOL_KINDS) {
    rec[`t_${k}`] = (kinds?.[k]?.ms ?? 0) / 1000; rec[`n_${k}`] = kinds?.[k]?.calls ?? 0;
    rec[`tu_${k}`] = ((upper ? kinds : (tr.kindsUpper ?? tr.kinds))?.[k]?.ms ?? 0) / 1000;
  }
  return rec;
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
export function nnls(X, y) {
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
export const FEATS = ['turns', 'prefill', 'cacheRead', 'decode'];

// ─── per-unit contrast (as analyze.mjs) ─────────────────────────────────────────────────────────
function perUnit(rows, metrics) {
  const q = new Map();
  for (const r of rows) { if (!q.has(r.id)) q.set(r.id, { tier: r.tier, arms: {} }); (q.get(r.id).arms[r.arm] ||= []).push(r); }
  for (const e of q.values()) for (const [a, rs] of Object.entries(e.arms)) e.arms[a] = Object.fromEntries(metrics.map(m => [m, mean(rs.map(r => r[m]).filter(fin))]));
  return q;
}
function contrast(q, m, B, seed = 42) {
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
const KIND_LABEL = { ss: 'sweet search (ss-*)', nativeGrep: 'native search (grep/rg/find/Glob)', nativeRead: 'native read (cat/Read)', edit: 'edit', test: 'tests and builds', bash: 'other shell', poll: 'wait on a running command (mostly tests/builds)' };

/**
 * Fit, contrasts and the printed table of one cell. `byKindRows` adds tool time per kind (task bench).
 * Break-even: the sweet tool time per call (over `breakEvenKinds`, or every call) at which sweet and
 * native take equally long, other tool time held at its bench value for both arms.
 */
export function analyzeCell({ name, rows, match, B, byKindRows = false, breakEvenKinds = null, log = console.log }) {
  const fit = nnls(rows.map(r => FEATS.map(f => r[f])), rows.map(r => r.llmS));
  const beKinds = breakEvenKinds || null;
  for (const r of rows) {
    r.modelLlmS = FEATS.reduce((s, f, i) => s + fit.beta[i] * r[f], 0);
    FEATS.forEach((f, i) => { r[`part_${f}`] = fit.beta[i] * r[f]; });
    r.toolPerCallS = r.calls ? r.toolS / r.calls : NaN;
    r.toolUpperPerCallS = r.calls ? r.toolUpperS / r.calls : NaN;
    r.modelLlmNoSubS = r.subagent ? NaN : r.modelLlmS;
    if (beKinds) {
      r.beCalls = beKinds.reduce((s, k) => s + r[`n_${k}`], 0);
      r.beToolS = beKinds.reduce((s, k) => s + r[`t_${k}`], 0);
      r.beToolUpperS = beKinds.reduce((s, k) => s + r[`tu_${k}`], 0);
      r.beToolPerCallS = r.beCalls ? r.beToolS / r.beCalls : NaN;
      r.beToolUpperPerCallS = r.beCalls ? r.beToolUpperS / r.beCalls : NaN;
    }
  }
  const isOc = rows.some(r => r.toolUpperS !== r.toolS);
  const kindMetrics = byKindRows ? TOOL_KINDS.filter(k => rows.some(r => r[`n_${k}`] > 0)).flatMap(k => [`n_${k}`, `t_${k}`, ...(isOc ? [`tu_${k}`] : [])]) : [];
  const M = ['turns', 'calls', 'prefill', 'cacheRead', 'decode', 'reasoning', 'llmS', 'modelLlmS', 'modelLlmNoSubS', 'toolS', 'toolUpperS', 'toolPerCallS', 'toolUpperPerCallS', 'overheadS', 'wallS', ...FEATS.map(f => `part_${f}`), ...kindMetrics, ...(beKinds ? ['beCalls', 'beToolS', 'beToolUpperS', 'beToolPerCallS', 'beToolUpperPerCallS'] : [])];
  const q = perUnit(rows, M);
  const armMean = (a, m) => mean([...q.values()].map(e => e.arms[a]?.[m]).filter(fin));
  const [bt, bp, br, bd] = fit.beta;
  const out = { match, fit: { beta: Object.fromEntries(FEATS.map((f, i) => [f, fit.beta[i]])), r2: fit.r2 }, means: {}, contrasts: {} };
  log(`## ${name}\n`);
  log(`traces matched ${match.matched}, missing ${match.missing} (${Object.entries(match.how).map(([k, v]) => `${k} ${v}`).join(', ')}); rollouts with subagents: sweet ${rows.filter(r => r.arm === 'sweet' && r.subagent).length}, native ${rows.filter(r => r.arm === 'native' && r.subagent).length} (parallel subagent pairs ${match.parallelSubagents})`);
  log(`fit (R² ${f1(fit.r2, 2)}): ${f1(bt, 2)} s per turn · ${f1(bp * 1e6, 1)} ms per 1k prefill tokens · ${f1(br * 1e6, 2)} ms per 1k cache-read tokens · decode ${bd > 0 ? f1(1 / bd, 0) : '—'} tokens/s\n`);
  log('| metric | sweet | native | sweet − native | 95% CI | rel [95% CI] |');
  log('|---|---|---|---|---|---|');
  const LABEL = { turns: 'turns (model requests)', calls: 'tool calls', prefill: 'prefill tokens (uncached + cache write)', cacheRead: 'cache-read tokens', decode: 'decode tokens (output + reasoning)', reasoning: 'of which reasoning', llmS: 'LLM time, measured (s)', modelLlmS: 'LLM time, modelled from tokens + turns (s)', part_turns: '  · from turns (s)', part_prefill: '  · from prefill (s)', part_cacheRead: '  · from cache read (s)', part_decode: '  · from decode (s)', toolS: `tool time, bench-measured, contended${isOc ? ', lower bound' : ''} (s)`, toolPerCallS: `tool time per call, bench${isOc ? ', lower bound' : ''} (s)`, toolUpperS: 'tool time, upper bound incl. writing the command (s)', toolUpperPerCallS: 'tool time per call, upper bound (s)', modelLlmNoSubS: 'LLM time, modelled, rollouts without subagents (s)', overheadS: 'harness start/stop (s)', wallS: 'wall time, bench (s)' };
  for (const k of TOOL_KINDS) { LABEL[`n_${k}`] = `  calls: ${KIND_LABEL[k]}`; LABEL[`t_${k}`] = `  time: ${KIND_LABEL[k]}${isOc ? ', lower bound' : ''} (s)`; LABEL[`tu_${k}`] = `  time: ${KIND_LABEL[k]}, upper bound (s)`; }
  const anySub = rows.some(r => r.subagent);
  const order = ['turns', 'calls', 'prefill', 'cacheRead', 'decode', 'reasoning', 'modelLlmS', 'part_turns', 'part_prefill', 'part_cacheRead', 'part_decode', ...(anySub ? ['modelLlmNoSubS'] : []), 'llmS', 'toolS', 'toolPerCallS', ...(isOc ? ['toolUpperS', 'toolUpperPerCallS'] : []), ...kindMetrics, 'overheadS', 'wallS'];
  for (const m of order) {
    const c = contrast(q, m, B); out.means[m] = { sweet: armMean('sweet', m), native: armMean('native', m) }; out.contrasts[m] = c;
    const d = /S$|^part_|^tu?_/.test(m) ? 2 : (m === 'turns' || m === 'calls' || m.startsWith('n_')) ? 1 : 0;
    const sig = c && (c.diffCI[0] > 0 || c.diffCI[1] < 0) ? ' *' : '';
    log(`| ${LABEL[m]} | ${f1(out.means[m].sweet, d)} | ${f1(out.means[m].native, d)} | ${c ? f1(c.diff, d) + sig : '—'} | ${c ? `[${f1(c.diffCI[0], d)}, ${f1(c.diffCI[1], d)}]` : '—'} | ${c ? `${pct(c.rel)} [${pct(c.relCI[0])}, ${pct(c.relCI[1])}]` : '—'} |`);
  }
  // Break-even: sweet's mean tool time per call (over the break-even kinds) at which modelled LLM + tools
  // are equal for both arms. Native tool time is the bench-measured value (contended → generous to native).
  const nativeTotal = armMean('native', 'modelLlmS') + armMean('native', 'toolS');
  const sweetFixed = armMean('sweet', 'modelLlmS') + (beKinds ? armMean('sweet', 'toolS') - armMean('sweet', 'beToolS') : 0);
  const be = (nativeTotal - sweetFixed) / armMean('sweet', beKinds ? 'beCalls' : 'calls');
  out.breakEvenSweetToolPerCallS = be;
  const perCall = (lo, hi) => (isOc ? `${f1(armMean('sweet', lo), 2)}–${f1(armMean('sweet', hi), 2)}` : f1(armMean('sweet', lo), 2));
  const benchPerCall = beKinds ? perCall('beToolPerCallS', 'beToolUpperPerCallS') : perCall('toolPerCallS', 'toolUpperPerCallS');
  const scope = beKinds ? ` (search + read calls: ${beKinds.join(', ')}; other tool time at its bench value)` : '';
  log(be > 0
    ? `\nbreak-even${scope}: sweet stays faster while its mean tool time per call is below ${f1(be, 2)} s (bench-measured, contended: ${benchPerCall} s).\n`
    : beKinds
      ? `\nbreak-even${scope}: none — sweet's other time alone exceeds native's total, so sweet is slower on this cell at any search speed (bench-measured sweet time per call: ${benchPerCall} s).\n`
      : `\nbreak-even: none — sweet's modelled LLM time alone exceeds native's LLM + tool time, so sweet is slower on this cell at any tool speed (bench-measured sweet tool time per call: ${benchPerCall} s).\n`);
  return out;
}

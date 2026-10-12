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
import { fileURLToPath } from 'node:url';
import { readJsonl, walkFiles, parseClaudeSession, parseCodexRollout, ocDb, ocSession, ocTrace, rolloutRecord, analyzeCell } from './latency-lib.mjs';

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

const repoOf = (id) => `r3-${id.replace(/^r3h?b?-/, '').replace(/-\d+$/, '')}`;

// ─── Claude Code ────────────────────────────────────────────────────────────────────────────────
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
function matchOpencode(stateDir, row) {
  if (!row.sessionID) return null;
  const f = path.join(stateDir, `oc-data-${row.arm}`, 'opencode.db');
  if (!fs.existsSync(f)) return null;
  const s = ocSession(ocDb(f, os.tmpdir()), row.sessionID);
  if (s.start == null) return null;
  return { ...ocTrace(s), how: 'sessionID' };
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
      rows.push(rolloutRecord({ id: r.id, tier: r.set, arm: r.arm, rep, wallMs: r.wallMs, calls: r.calls }, tr));
    }
  }
  return { dirs, rows, match };
}

const report = { tag: TAG, generatedAt: new Date().toISOString(), boot: B, heldout: HELDOUT, cells: {} };
console.log(`# Agent time from tokens and turns (${TAG})\n`);
console.log('Unit = question (mean over reps). 95% question-clustered bootstrap, stratified by tier. `*` = interval excludes 0.');
console.log('Modelled LLM time uses ONE coefficient set per cell for both arms, so its sweet − native difference comes from tokens and turns only.\n');

for (const cell of CELLS) {
  const { dirs, rows, match } = loadCell(cell);
  if (!rows.length) { console.log(`## ${cell}\n\nno rows (${dirs.length} dirs)\n`); continue; }
  report.cells[cell] = { dirs, ...analyzeCell({ name: cell, rows, match, B }) };
}
if (HELDOUT) console.log('Held-out: aggregates only (no per-question value).');
if (OUT) { fs.writeFileSync(OUT, `${JSON.stringify(report, null, 1)}\n`); console.log(`wrote ${OUT}`); }

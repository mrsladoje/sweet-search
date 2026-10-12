#!/usr/bin/env node
// task-latency-model.mjs — agent time from tokens and turns for the HO2-290 task bench
// (held-out-2, 200 tasks, 2.9.0), free of bench concurrency. Same model as the retrieval bench
// (core/prompt-optimization/data/final-run/latency-model.mjs, shared code in latency-lib.mjs).
//
//   node eval/task-completion-bench/stats/task-latency-model.mjs [--legs cc-opus55-medium,...] \
//     [--box ~/.ss-eval/ho2-290-latency] [--vm ~/.ss-eval/ho2-290-vm-backup] [--out f.json] [--boot 10000]
//
// Inputs (read only):
//   --box  trace copy of the box result dirs (rows + agent-state transcripts / rollouts / session DBs):
//          the three Claude Code legs and the 18 Sol tasks re-run on the box (box18).
//   --vm   the Mac VM backup: Sol legs (Codex, opencode), live/results/<run>/, quarantine list,
//          box-pull/ho2-sol18-ids.txt.
// Final row per (task, arm) = the published union (bench-meta-1008, recover-codex-cost.py):
//   Claude legs: rows-costrecovered.json where present; Sonnet = a0 + 1036-a1 + 1931-a1, later wins.
//   Sol legs: VM rows minus quarantine minus box18 tasks (later run dir wins), then the box18 rows.
//   Grading does not matter here: every final rollout counts, solved or not.
// Row ↔ trace: agent-state/<task>-<arm>/ of ANY run dir of the leg (a later attempt can reuse it):
//   Claude Code by start time (session start inside the row's window, latest wins), Codex by exact
//   final token totals, opencode by sessionID.
// opencode tool time = each tool part's created → updated window (its state.time misses long tests and
// builds), so for opencode the measured LLM time is a lower bound (command writing counts as tool time).
// Unit = task (one rollout per arm). 95% task-level bootstrap, B = 10000, seed 42. HELD-OUT:
// aggregates only, no per-task value anywhere.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const L = await import(path.join(REPO, 'core/prompt-optimization/data/final-run/latency-lib.mjs'));

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i !== -1 ? argv[i + 1] : d; };
const BOX = path.resolve(flag('--box', path.join(os.homedir(), '.ss-eval/ho2-290-latency')));
const VM = path.resolve(flag('--vm', path.join(os.homedir(), '.ss-eval/ho2-290-vm-backup')));
const LEGS = String(flag('--legs', 'cc-sonnet55-high,cc-opus55-medium,cc-opus55-high,codex-sol61-high,oc-sol61-high')).split(',').filter(Boolean);
const OUT = flag('--out', null);
const B = Number(flag('--boot', 10000));
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'task-latency-'));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const dirsOf = (root, re) => (fs.existsSync(root) ? fs.readdirSync(root).filter(d => re.test(d)).sort().map(d => path.join(root, d)) : []);
const rowsOf = (d) => readJson(fs.existsSync(path.join(d, 'rows-costrecovered.json')) ? path.join(d, 'rows-costrecovered.json') : path.join(d, 'rows.json'));

// ─── final rows per leg ─────────────────────────────────────────────────────────────────────────
function finalRows(leg) {
  const fin = new Map(); const put = (d, r) => fin.set(`${r.taskId}|${r.arm}`, { ...r, _dir: d });
  let dirs;
  if (leg.startsWith('cc-')) {
    dirs = dirsOf(BOX, new RegExp(`^ho2-290-${leg}-\\d{8}`));
    // Sonnet: a0 (stopped attempt) first, then the resumed runs in time order — later wins.
    dirs.sort((a, b) => (a.endsWith('-a0') ? -1 : b.endsWith('-a0') ? 1 : a.localeCompare(b)));
    for (const d of dirs) for (const r of rowsOf(d)) put(d, r);
  } else {
    const quar = new Set();
    for (const l of fs.readFileSync(path.join(VM, 'live/state/ho2-vm-quarantine.tsv'), 'utf8').split('\n')) {
      if (!l.trim() || l.startsWith('#')) continue; const [d, t, a] = l.split('\t'); quar.add(`${d}|${t}|${a}`);
    }
    const box18 = new Set(fs.readFileSync(path.join(VM, 'box-pull/ho2-sol18-ids.txt'), 'utf8').split(/\s+/).filter(Boolean));
    const vmDirs = dirsOf(path.join(VM, 'live/results'), new RegExp(`^ho2-290-${leg}-vm-`));
    for (const d of vmDirs) {
      if (!fs.existsSync(path.join(d, 'rows.json'))) continue;
      for (const r of readJson(path.join(d, 'rows.json'))) if (!quar.has(`${path.basename(d)}|${r.taskId}|${r.arm}`) && !box18.has(r.taskId)) put(d, r);
    }
    // box18: Codex final = 0707-a1 (0700-a1 was a 4-row start); opencode = 0700-a1 then 0958-a2.
    const boxDirs = leg.startsWith('codex') ? dirsOf(BOX, new RegExp(`^ho2-290-${leg}-box18-20261008-0707`)) : dirsOf(BOX, new RegExp(`^ho2-290-${leg}-box18-`));
    for (const d of boxDirs) for (const r of rowsOf(d)) put(d, r);
    dirs = [...vmDirs, ...boxDirs];
  }
  return { dirs, rows: [...fin.values()] };
}

// ─── traces ─────────────────────────────────────────────────────────────────────────────────────
function stateDirs(dirs, r) { return dirs.map(d => path.join(d, 'agent-state', `${r.taskId}-${r.arm}`)).filter(d => fs.existsSync(d)); }
function traceFor(leg, dirs, r) {
  const sds = stateDirs(dirs, r);
  if (leg.startsWith('cc-')) {
    const c = sds.flatMap(sd => L.walkFiles(path.join(sd, 'claude-home', 'projects'), n => n.endsWith('.jsonl')))
      .map(f => L.parseClaudeSession(f)).filter(s => s.start != null && s.start >= r.startedAtMs - 2000 && s.start <= r.startedAtMs + r.wallMs);
    if (!c.length) return null;
    c.sort((a, b) => b.start - a.start);   // a start retry inside the window: the later session is the final one
    return { ...c[0], how: c.length > 1 ? 'time (latest of several)' : 'time' };
  }
  if (leg.startsWith('codex')) {
    const u = r.usage || {};
    const c = sds.flatMap(sd => L.walkFiles(path.join(sd, 'codex-home', 'sessions'), n => n.startsWith('rollout-') && n.endsWith('.jsonl'))).map(f => L.parseCodexRollout(f)).filter(s => s.start != null);
    const same = c.filter(s => s.total && s.total.input_tokens === u.input_tokens && s.total.cached_input_tokens === u.cached_input_tokens && s.total.output_tokens === u.output_tokens);
    if (same.length) return { ...same.sort((a, b) => b.start - a.start)[0], how: 'tokens' };
    // usage lost in the stream (the 4 recovered-cost rows): the rollout in the row's window
    const win = c.filter(s => s.start >= r.startedAtMs - 2000 && s.start <= r.startedAtMs + r.wallMs).sort((a, b) => b.start - a.start);
    return win.length ? { ...win[0], how: 'time (usage lost)' } : null;
  }
  for (const sd of sds) {
    const f = path.join(sd, 'opencode-data', 'opencode.db');
    if (!fs.existsSync(f) || !r.sessionID) continue;
    const s = L.ocSession(L.ocDb(f, SCRATCH), r.sessionID);
    if (s.start != null) return { ...L.ocTrace(s), how: 'sessionID' };
  }
  return null;
}

const report = { generatedAt: new Date().toISOString(), boot: B, heldout: true, legs: {} };
console.log('# Task bench (HO2-290, held-out-2, 200 tasks) — agent time from tokens and turns\n');
console.log('Unit = task (one rollout per arm). 95% task-level bootstrap. `*` = interval excludes 0.');
console.log('Modelled LLM time uses ONE coefficient set per leg for both arms, so its sweet − native difference comes from tokens and turns only.');
console.log('Tool time is bench-measured under concurrency (and Rosetta on the VM Sol legs): tests, builds and searches all ran contended.\n');
for (const leg of LEGS) {
  const { dirs, rows: fr } = finalRows(leg);
  const match = { matched: 0, missing: 0, how: {}, parallelSubagents: 0 };
  const rows = [];
  for (const r of fr) {
    const tr = traceFor(leg, dirs, r);
    if (!tr) { match.missing++; continue; }
    match.matched++; match.how[tr.how] = (match.how[tr.how] || 0) + 1; match.parallelSubagents += tr.overlaps || 0;
    rows.push(L.rolloutRecord({ id: r.taskId, tier: 'all', arm: r.arm, rep: 0, wallMs: r.wallMs, calls: r.calls }, tr, { ocBound: 'upper' }));
  }
  const tasks = new Set(fr.map(r => r.taskId)).size;
  if (!rows.length) { console.log(`## ${leg}\n\nno rows\n`); continue; }
  console.log(`final rows ${fr.length} (${tasks} tasks) from ${dirs.length} run dirs`);
  report.legs[leg] = { finalRows: fr.length, tasks, ...L.analyzeCell({ name: leg, rows, match, B, byKindRows: true, breakEvenKinds: ['ss', 'nativeGrep', 'nativeRead'] }) };
}
console.log('Held-out: aggregates only (no per-task value).');
fs.rmSync(SCRATCH, { recursive: true, force: true });
if (OUT) { fs.writeFileSync(OUT, `${JSON.stringify(report, null, 1)}\n`); console.log(`wrote ${OUT}`); }

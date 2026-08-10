#!/usr/bin/env node
// $0 GATE for the FAILED-TASK THRASH portfolio (T1 novelty-stall / T3 no-progress / T2 failed-edit).
//
// Reads raw codex rollouts (one JSON event per line) + the run's rows.json, reconstructs a
// PROGRESS TIMELINE per trajectory, and prices the "recoverable tail" — the spend that happens
// after a trajectory demonstrably stopped making progress.
//
// Design rule (non-negotiable, from the handoff): NEVER trigger on an absolute call/turn count.
// Absolute counts are difficulty-confounded (a hard task legitimately makes many calls). Trigger
// only on a PROGRESS signal, which is difficulty-agnostic: a hard task still makes progress, a
// doomed one stops.
//
// Progress signals, per turn:
//   newFile     — a repo file path appears that this trajectory has never surfaced before
//   diffChange  — an apply_patch actually mutated the working tree this turn
//   testChange  — the run_tests verdict differs from the previously observed verdict
//
// Cost model: per-request ideal (cache-normalized) cost from token_count.last_token_usage, the
// same basis as poll-census.mjs. For append-only codex trajectories this equals the break-priced
// column by construction (no prefix-cache breaks — nothing is ever evicted or reordered).
//
// Luna rates: input $0.10/M (new), cached $0.01/M, output $0.60/M. input_tokens INCLUDES cached.
import fs from 'fs';
import path from 'path';

const IN = 0.10e-6, CA = 0.01e-6, OUT = 0.60e-6;

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const RAW_ROOT = opt('--raw', null);
const ROWS = opt('--rows', null);
const MODE = opt('--mode', 'summary');       // summary | timeline | sweep
const ONLY = opt('--only', null);            // substring filter on task id
if (!RAW_ROOT || !ROWS) {
  console.error('usage: thrash-census.mjs --raw <agent-state-dir> --rows <rows.json> [--mode summary|timeline|sweep] [--only <task-substr>]');
  process.exit(2);
}

// ---------------------------------------------------------------- path extraction
// Repo-relative source paths, language-agnostic. Must survive 13 languages, so we key on
// "has a directory separator OR a known-ish extension", then reject obvious non-paths.
const EXT = /\.(ml|mli|py|pyi|js|mjs|cjs|ts|tsx|jsx|go|rs|c|h|cc|cpp|hpp|hxx|java|rb|php|cs|swift|kt|kts|scala|ex|exs|erl|hrl|lua|vim|el|clj|cljs|hs|pl|pm|r|R|dart|proto|json|ya?ml|toml|ini|cfg|md|txt|sh|bash|zsh|sql|css|scss|less|html?|xml|gradle|bzl|bazel|cmake|mk|rake|gemspec|cabal|nix|tf|ps1|bat|feature|snap|lock)$/i;
const PATH_RE = /(?:^|[\s"'`(\[<|,;=])((?:\.{0,2}\/)?(?:[A-Za-z0-9_@.+-]+\/)*[A-Za-z0-9_@.+-]+\.[A-Za-z0-9_+-]{1,9})(?=$|[\s"'`)\]>:,;|]|:\d)/gm;

function extractPaths(text) {
  const out = new Set();
  if (!text) return out;
  let m;
  PATH_RE.lastIndex = 0;
  while ((m = PATH_RE.exec(text)) !== null) {
    let p = m[1];
    if (/^https?:/.test(p) || p.includes('://')) continue;
    if (/^\d+\.\d+$/.test(p)) continue;                 // version-ish "1.2"
    if (!EXT.test(p) && !p.includes('/')) continue;     // bare "foo.bar" with unknown ext
    if (!EXT.test(p) && p.split('/').length < 2) continue;
    p = p.replace(/^\.\//, '');
    // strip absolute jail prefixes so the same file is one identity across arms
    p = p.replace(/^\/?root\/\.ss-eval\/runs\/[^/]+\//, '');
    p = p.replace(/^\/?workspace\//, '');
    if (p.startsWith('/')) continue;                     // remaining absolutes = system paths
    if (p.split('/').some(s => s === 'node_modules' || s === '.git')) continue;
    out.add(p);
  }
  return out;
}

// ---------------------------------------------------------------- rollout parsing
function textOfOutput(payloadOutput) {
  if (typeof payloadOutput === 'string') return payloadOutput;
  if (Array.isArray(payloadOutput)) return payloadOutput.map(x => (x && x.text) || '').join('\n');
  if (payloadOutput && typeof payloadOutput === 'object') return JSON.stringify(payloadOutput);
  return '';
}

// Pull every shell command out of one exec snippet (a turn may batch several exec_command calls).
function commandsOf(input) {
  const s = typeof input === 'string' ? input : JSON.stringify(input || '');
  const cmds = [];
  const re = /cmd:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(s)) !== null) cmds.push(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
  return { cmds, isWriteStdin: /write_stdin/.test(s), raw: s };
}

const SEARCH_TOOL = /^\s*(ss-search|ss-grep|ss-semantic|ss-find)\b/;
const NATIVE_SEARCH = /^\s*(rg|grep|ag|ack|find)\b/;

function classifyCmd(cmd) {
  if (/(^|[^\w])run_tests([^\w]|$)/.test(cmd)) return 'run_tests';
  if (SEARCH_TOOL.test(cmd)) return 'ss_search';
  if (NATIVE_SEARCH.test(cmd)) return 'native_search';
  if (/^\s*(ss-read|cat|sed|head|tail|less|nl)\b/.test(cmd)) return 'read';
  if (/apply_patch/.test(cmd)) return 'patch';
  return 'other';
}

function parseRollout(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\n/);
  const events = [];
  for (const l of lines) {
    if (!l.startsWith('{')) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (j && j.payload) events.push(j.payload);
  }

  const turns = [];
  let pending = null;          // {cmds, isWriteStdin, outText, patched}
  let workdir = null;

  for (const p of events) {
    if (p.type === 'custom_tool_call' && p.name === 'exec') {
      const c = commandsOf(p.input);
      if (!workdir) {
        const w = c.raw.match(/workdir"?\s*:\s*"([^"]+)"/);
        if (w) workdir = w[1];
      }
      pending = { ...c, outText: '', patched: false };
    } else if (p.type === 'function_call' && p.name === 'wait') {
      pending = { cmds: [], isWriteStdin: true, raw: '', outText: '', patched: false };
    } else if (p.type === 'custom_tool_call_output') {
      if (pending) pending.outText += textOfOutput(p.output);
    } else if (p.type === 'patch_apply_end') {
      // a patch actually landed on the working tree this turn
      const ok = p.success !== false;
      if (pending) pending.patched = pending.patched || ok;
      else turns.length && (turns[turns.length - 1].diffChange = turns[turns.length - 1].diffChange || ok);
    } else if (p.type === 'token_count' && p.info && p.info.last_token_usage) {
      const u = p.info.last_token_usage;
      const inTok = u.input_tokens || 0, ca = u.cached_input_tokens || 0;
      const o = (u.output_tokens || 0) + (u.reasoning_output_tokens || 0);
      const cost = Math.max(0, inTok - ca) * IN + ca * CA + o * OUT;
      const c = pending || { cmds: [], isWriteStdin: false, outText: '', patched: false };
      const kinds = c.cmds.map(classifyCmd);
      turns.push({
        idx: turns.length,
        cost,
        cmds: c.cmds,
        kinds,
        // a turn only counts as a pure poll when it carried NO real command; batched snippets
        // that both exec and write_stdin are real work, not polling
        isPoll: !!c.isWriteStdin && c.cmds.length === 0,
        outText: c.outText,
        diffChange: !!c.patched,
      });
      pending = null;
    }
  }
  return { turns, workdir };
}

// ---------------------------------------------------------------- progress timeline
function buildTimeline(rollout) {
  const seen = new Set();
  let lastVerdict = null;
  for (const t of rollout.turns) {
    // files surfaced by the OUTPUT plus files named as read/patch targets in the COMMAND
    const fromOut = extractPaths(t.outText);
    const fromCmd = new Set();
    for (const c of t.cmds) for (const p of extractPaths(' ' + c)) fromCmd.add(p);
    const surfaced = new Set([...fromOut, ...fromCmd]);
    const fresh = [...surfaced].filter(p => !seen.has(p));
    for (const p of surfaced) seen.add(p);

    // test-status change
    const vm = [...t.outText.matchAll(/\[run_tests verdict\] status=(PASS|FAIL|INFRA)/g)];
    let testChange = false, verdict = null;
    if (vm.length) {
      verdict = vm[vm.length - 1][1];
      if (verdict !== lastVerdict) testChange = true;
      lastVerdict = verdict;
    }

    t.newFiles = fresh;
    t.newFileCount = fresh.length;
    t.verdict = verdict;
    t.testChange = testChange;
    t.isSearch = t.kinds.some(k => k === 'ss_search' || k === 'native_search');
    t.isSsSearch = t.kinds.some(k => k === 'ss_search');
    t.isRunTests = t.kinds.some(k => k === 'run_tests');
    t.progress = t.newFileCount > 0 || t.diffChange || t.testChange;
  }
  return rollout;
}

// ---------------------------------------------------------------- triggers
// Each returns the turn index AFTER which the trigger has fired (savings = turns strictly after).
// null = never fires.

// T1: N consecutive ss-* SEARCH calls that surface zero new files.
// v1 (strict): any intervening turn that itself makes progress resets the streak.
function fireT1(turns, N) {
  let streak = 0;
  for (const t of turns) {
    if (!t.isSsSearch) { if (t.diffChange || t.testChange || t.newFileCount > 0) streak = 0; continue; }
    if (t.newFileCount === 0) { streak++; if (streak >= N) return t.idx; }
    else streak = 0;
  }
  return null;
}

// T1-v2 (consecutive AMONG SEARCHES): intervening reads do not reset. This is the more literal
// reading of "N consecutive ss-* searches surface zero new files" and is strictly easier to fire.
function fireT1v2(turns, N) {
  let streak = 0;
  for (const t of turns) {
    if (t.diffChange || t.testChange) { streak = 0; continue; }
    if (!t.isSsSearch) continue;
    if (t.newFileCount === 0) { streak++; if (streak >= N) return t.idx; }
    else streak = 0;
  }
  return null;
}

// T1-v3 (LOW-novelty, not zero): a search counts as stalled when it surfaces <= M new files.
// Relaxing "zero" is the obvious rescue if the strict form never fires. M is folded into the
// param as N*10+M so the sweep can print one column.
function fireT1v3(turns, packed) {
  const N = Math.floor(packed / 10), M = packed % 10;
  let streak = 0;
  for (const t of turns) {
    if (t.diffChange || t.testChange) { streak = 0; continue; }
    if (!t.isSsSearch) continue;
    if (t.newFileCount <= M) { streak++; if (streak >= N) return t.idx; }
    else streak = 0;
  }
  return null;
}

// T3: X consecutive turns with NO progress of any kind (polls excluded — they are not agent work).
function fireT3(turns, X) {
  let streak = 0;
  for (const t of turns) {
    if (t.isPoll) continue;
    if (t.progress) streak = 0;
    else { streak++; if (streak >= X) return t.idx; }
  }
  return null;
}

// T3-GUARDED: same no-progress counter, but it cannot ARM until the trajectory has both written
// at least one patch AND seen at least one run_tests verdict. Rationale: every T3 false positive
// above fired during the initial exploration phase (gradethis fires at turn 4-7, solving patch at
// 15-17). Guarding makes early exploration structurally unreachable by the trigger.
function fireT3Guarded(turns, X) {
  let streak = 0, sawPatch = false, sawTest = false;
  for (const t of turns) {
    if (t.isPoll) continue;
    if (t.diffChange) sawPatch = true;
    if (t.verdict) sawTest = true;
    if (!(sawPatch && sawTest)) { continue; }
    if (t.progress) streak = 0;
    else { streak++; if (streak >= X) return t.idx; }
  }
  return null;
}

// T1-GUARDED: low-novelty search stall, but only after the first patch exists (so it can never
// cut the opening retrieval tour that legitimately precedes the first edit).
function fireT1Guarded(turns, packed) {
  const N = Math.floor(packed / 10), M = packed % 10;
  let streak = 0, sawPatch = false;
  for (const t of turns) {
    if (t.diffChange) { sawPatch = true; streak = 0; continue; }
    if (t.testChange) { streak = 0; continue; }
    if (!sawPatch || !t.isSsSearch) continue;
    if (t.newFileCount <= M) { streak++; if (streak >= N) return t.idx; }
    else streak = 0;
  }
  return null;
}

// T3-DIFFONLY: the only progress definition whose ORACLE ceiling exceeds the 15% bar (22.4%).
// Progress = a working-tree edit, full stop; reading and testing do not count. Tested to close
// the last door: it is the sole family that could clear the bar on ceiling alone.
function fireT3DiffOnly(turns, X) {
  let streak = 0;
  for (const t of turns) {
    if (t.isPoll) continue;
    if (t.diffChange) streak = 0;
    else { streak++; if (streak >= X) return t.idx; }
  }
  return null;
}

// T2: K run_tests FAILs with no new file touched (no diff change, no new file) between them.
function fireT2(turns, K) {
  let fails = 0, touchedSince = false;
  for (const t of turns) {
    if (t.diffChange || t.newFileCount > 0) touchedSince = true;
    if (t.isRunTests && t.verdict === 'FAIL') {
      if (fails === 0) { fails = 1; touchedSince = false; continue; }
      if (!touchedSince) { fails++; if (fails >= K) return t.idx; }
      else { fails = 1; }
      touchedSince = false;
    }
  }
  return null;
}

// ---------------------------------------------------------------- load + join
const rows = JSON.parse(fs.readFileSync(ROWS, 'utf8'));
function localRollout(rolloutFile) {
  // map the box path .../agent-state/<cell>/codex-home/... onto the local mirror
  const m = rolloutFile.match(/agent-state\/(.+)$/);
  if (!m) return null;
  const p = path.join(RAW_ROOT, m[1]);
  return fs.existsSync(p) ? p : null;
}

const trajectories = [];
for (const r of rows) {
  if (ONLY && !r.taskId.includes(ONLY)) continue;
  const f = localRollout(r.rolloutFile || '');
  if (!f) { console.error('[warn] missing rollout for', r.taskId, r.arm, 'r' + r.rep); continue; }
  const roll = buildTimeline(parseRollout(f));
  const turns = roll.turns;
  const total = turns.reduce((a, t) => a + t.cost, 0);
  const lastProgress = (() => { let i = -1; for (const t of turns) if (t.progress) i = t.idx; return i; })();
  const lastPatch = (() => { let i = -1; for (const t of turns) if (t.diffChange) i = t.idx; return i; })();
  trajectories.push({
    key: `${r.taskId}-${r.arm}-r${r.rep}`,
    taskId: r.taskId, arm: r.arm, rep: r.rep,
    resolved: !!r.resolved,
    turns, total, lastProgress, lastPatch,
    tailAfterProgress: turns.filter(t => t.idx > lastProgress).reduce((a, t) => a + t.cost, 0),
  });
}

const money = v => '$' + v.toFixed(5);
const pct = (a, b) => b > 0 ? (100 * a / b).toFixed(1) + '%' : '—';

// task-level solve status (a task counts as FAILED only if every rollout failed)
const taskSolved = {};
for (const t of trajectories) {
  taskSolved[t.taskId] = taskSolved[t.taskId] || { n: 0, s: 0 };
  taskSolved[t.taskId].n++; taskSolved[t.taskId].s += t.resolved ? 1 : 0;
}
const isFailedTask = id => taskSolved[id] && taskSolved[id].s === 0;

if (MODE === 'spend') {
  // Where does failed-task spend actually go, given it is NOT a doomed tail? Attribute every turn
  // to what the model did in it, and split by phase relative to the first working-tree edit.
  const cat = t => t.isPoll ? 'poll'
    : t.isRunTests ? 'run_tests'
    : t.diffChange ? 'edit'
    : t.isSsSearch ? 'ss_search'
    : t.kinds.includes('native_search') ? 'native_search'
    : t.kinds.includes('read') ? 'read'
    : t.cmds.length === 0 ? 'model_message'
    : 'other_shell';
  for (const scopeName of ['FAILED tasks', 'SOLVED tasks']) {
    const want = scopeName.startsWith('FAILED');
    const set = trajectories.filter(t => want ? isFailedTask(t.taskId) : !isFailedTask(t.taskId));
    const agg = {}, phase = { explore: 0, repair: 0 };
    let total = 0;
    for (const tr of set) {
      const firstPatch = (() => { for (const t of tr.turns) if (t.diffChange) return t.idx; return Infinity; })();
      for (const t of tr.turns) {
        const c = cat(t);
        agg[c] = agg[c] || { n: 0, cost: 0 };
        agg[c].n++; agg[c].cost += t.cost; total += t.cost;
        phase[t.idx < firstPatch ? 'explore' : 'repair'] += t.cost;
      }
    }
    console.log(`\n=== SPEND DECOMPOSITION — ${scopeName} (n=${set.length} trajectories, ${money(total)}) ===`);
    console.log('category'.padEnd(16), 'turns'.padStart(6), 'ideal'.padStart(11), 'share'.padStart(8), ' $/turn');
    for (const [k, v] of Object.entries(agg).sort((a, b) => b[1].cost - a[1].cost)) {
      console.log(k.padEnd(16), String(v.n).padStart(6), money(v.cost).padStart(11), pct(v.cost, total).padStart(8),
        '  ' + money(v.cost / v.n));
    }
    console.log('phase split: before first edit (explore) ' + money(phase.explore) + ' (' + pct(phase.explore, total) + ')' +
      '  |  first edit onward (repair) ' + money(phase.repair) + ' (' + pct(phase.repair, total) + ')');
  }
  process.exit(0);
}

if (MODE === 'timeline') {
  for (const tr of trajectories) {
    console.log(`\n=== ${tr.key}  resolved=${tr.resolved}  turns=${tr.turns.length}  ideal=${money(tr.total)} ===`);
    console.log('turn  cost      kind                 new  diff test  cmd');
    for (const t of tr.turns) {
      const kind = t.isPoll ? 'poll' : (t.kinds.join('+') || 'msg');
      console.log(
        String(t.idx).padStart(4),
        money(t.cost).padEnd(9),
        kind.padEnd(20),
        String(t.newFileCount).padStart(3),
        (t.diffChange ? ' YES' : '  . ').padStart(5),
        (t.testChange ? (t.verdict || '') : '.').padEnd(5),
        (t.cmds[0] || '').slice(0, 70)
      );
    }
    console.log(`lastProgress=turn ${tr.lastProgress}  lastPatch=turn ${tr.lastPatch}  tailAfterLastProgress=${money(tr.tailAfterProgress)} (${pct(tr.tailAfterProgress, tr.total)})`);
  }
  process.exit(0);
}

// ---------------------------------------------------------------- summary: the recoverable ceiling
const failedSpend = trajectories.filter(t => isFailedTask(t.taskId)).reduce((a, t) => a + t.total, 0);
const allSpend = trajectories.reduce((a, t) => a + t.total, 0);
const failedTail = trajectories.filter(t => isFailedTask(t.taskId)).reduce((a, t) => a + t.tailAfterProgress, 0);

console.log('=== THRASH CENSUS ===');
console.log('trajectories:', trajectories.length, ' total ideal', money(allSpend));
console.log('failed-task spend:', money(failedSpend), `(${pct(failedSpend, allSpend)} of all)`);
console.log('ORACLE ceiling — spend after the LAST progress event on failed tasks:',
  money(failedTail), `(${pct(failedTail, failedSpend)} of failed spend)`);
console.log('  (this is the theoretical max any no-progress trigger can recover; a real trigger needs');
console.log('   confirmation turns and so recovers less)');

// --- ROBUSTNESS: recompute the ceiling under stricter progress definitions. If the tail stays
// small even when file-novelty is ignored entirely, the "no long doomed tail" conclusion does not
// depend on the path-extraction heuristic (the one soft part of this instrument).
const DEFS = [
  ['newFile | diff | test  (default)', t => t.newFileCount > 0 || t.diffChange || t.testChange],
  ['diff | test only       (ignores file novelty)', t => t.diffChange || t.testChange],
  ['diff only              (harshest)', t => t.diffChange],
];
console.log('\n=== ROBUSTNESS: oracle ceiling under stricter progress definitions (failed tasks) ===');
console.log('progress definition'.padEnd(48), 'tail'.padEnd(10), '% of failed spend');
for (const [name, pred] of DEFS) {
  let tail = 0;
  for (const tr of trajectories.filter(x => isFailedTask(x.taskId))) {
    let last = -1;
    for (const t of tr.turns) if (pred(t)) last = t.idx;
    tail += tr.turns.filter(t => t.idx > last).reduce((a, t) => a + t.cost, 0);
  }
  console.log(name.padEnd(48), money(tail).padEnd(10), pct(tail, failedSpend));
}

// --- Trajectory-length reality check: is there even a tail to cut?
const failedTraj = trajectories.filter(x => isFailedTask(x.taskId));
const turnsArr = failedTraj.map(t => t.turns.length).sort((a, b) => a - b);
const gapArr = failedTraj.map(t => t.turns.length - 1 - t.lastProgress).sort((a, b) => a - b);
const med = a => a.length ? a[Math.floor(a.length / 2)] : 0;
console.log('\n=== trajectory shape (failed tasks, n=' + failedTraj.length + ') ===');
console.log('turns  min/median/max:', turnsArr[0] + '/' + med(turnsArr) + '/' + turnsArr[turnsArr.length - 1]);
console.log('turns AFTER last progress  min/median/max:', gapArr[0] + '/' + med(gapArr) + '/' + gapArr[gapArr.length - 1]);
const exitH = {};
for (const r of rows) { const k = r.exitReason || '(none)'; exitH[k] = (exitH[k] || 0) + 1; }
console.log('exitReason across all', rows.length, 'rollouts:',
  Object.entries(exitH).map(([k, v]) => `${k}=${v}`).join(' '));

console.log('\n=== per-trajectory tail (failed tasks, top 15 by tail) ===');
console.log('key'.padEnd(50), 'turns', 'ideal'.padEnd(10), 'lastProg', 'tail'.padEnd(10), 'tail%');
for (const t of trajectories.filter(x => isFailedTask(x.taskId)).sort((a, b) => b.tailAfterProgress - a.tailAfterProgress).slice(0, 15)) {
  console.log(t.key.padEnd(50), String(t.turns.length).padStart(5), money(t.total).padEnd(10),
    String(t.lastProgress).padStart(8), money(t.tailAfterProgress).padEnd(10), pct(t.tailAfterProgress, t.total));
}

// ---------------------------------------------------------------- threshold sweep
function evaluate(fire, param, label, scope) {
  let tail = 0, scopeSpend = 0, fires = 0, fp = 0, fpDetail = [], solvedN = 0;
  for (const tr of trajectories) {
    const inScope = scope(tr);
    const f = fire(tr.turns, param);
    if (inScope) {
      scopeSpend += tr.total;
      if (f !== null) { fires++; tail += tr.turns.filter(t => t.idx > f).reduce((a, t) => a + t.cost, 0); }
    }
    // FP veto is measured on EVERY solved trajectory in the arm the lever touches, in or out of scope
    if (tr.resolved && (scope.armOnly ? scope.armOnly(tr) : true)) {
      solvedN++;
      if (f !== null && f < tr.lastPatch) { fp++; fpDetail.push(`${tr.key}(fire@${f} < solvingPatch@${tr.lastPatch})`); }
    }
  }
  return { label, param, tail, scopeSpend, fires, fp, solvedN, fpDetail, pctTail: scopeSpend > 0 ? 100 * tail / scopeSpend : 0 };
}

const failedScope = tr => isFailedTask(tr.taskId);
const failedSweetScope = tr => isFailedTask(tr.taskId) && tr.arm === 'sweet';
failedSweetScope.armOnly = tr => tr.arm === 'sweet';

console.log('\n=== THRESHOLD SWEEP (bar: tail >= 15% of in-scope failed spend AND FP = 0) ===');
console.log('lever  param  fires  recoverableTail  tail%ofFailedSpend  FP/solved');
const results = [];
for (const N of [2, 3, 4, 5]) results.push(evaluate(fireT1, N, 'T1v1 strict zero-novelty', failedSweetScope));
for (const N of [2, 3, 4]) results.push(evaluate(fireT1v2, N, 'T1v2 consec-among-searches', failedSweetScope));
for (const p of [21, 31, 22, 32]) results.push(evaluate(fireT1v3, p, `T1v3 low-novelty N=${Math.floor(p / 10)},M<=${p % 10}`, failedSweetScope));
for (const X of [3, 4, 5, 6, 8]) results.push(evaluate(fireT3, X, 'T3 no-progress (both arms)', failedScope));
for (const X of [2, 3, 4, 5]) results.push(evaluate(fireT3Guarded, X, 'T3g guarded no-progress', failedScope));
for (const p of [21, 22, 12]) results.push(evaluate(fireT1Guarded, p, `T1g guarded N=${Math.floor(p / 10)},M<=${p % 10}`, failedSweetScope));
for (const X of [4, 6, 8, 10, 12]) results.push(evaluate(fireT3DiffOnly, X, 'T3d diff-only progress', failedScope));
for (const K of [2, 3, 4]) results.push(evaluate(fireT2, K, 'T2 failed-edit streak', failedScope));
for (const r of results) {
  console.log(
    r.label.padEnd(28), String(r.param).padStart(3), String(r.fires).padStart(6),
    money(r.tail).padStart(11), pct(r.tail, r.scopeSpend).padStart(10),
    `   ${r.fp}/${r.solvedN}`, r.fp > 0 ? '  <-- VETO: ' + r.fpDetail.slice(0, 3).join(' ') : ''
  );
}

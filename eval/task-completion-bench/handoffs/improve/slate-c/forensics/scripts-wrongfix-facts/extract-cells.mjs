#!/usr/bin/env node
// extract-cells.mjs — gather, for a fixed task list, the issue text (problem_statement ONLY),
// gold-free task metadata (counts, not names), and every recorded patch per
// harness × arm × rep from the fresh-pool TAB runs (+ the opencode repair pass).
// Runs on the evidence box. Reads only. Writes one JSON to the scratch path given as argv[2].
//
//   node extract-cells.mjs <results-root> <out.json>
//
// Deliberately NOT exported: patch (gold), test_patch, FAIL_TO_PASS / PASS_TO_PASS names.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2];
const OUT = process.argv[3];
const TASKS = [
  'bfgroup__b2-259', 'fastify__fastify-cors-285', 'gitbookio__markup-it-56',
  'hotmeteor__spectator-181', 'protofire__solhint-224', 'devlooped__moq-1262',
  'accenture__sfmc-devtools-1974', 'awslabs__aws-embedded-metrics-node-21',
  'aio-libs__aiohttp-8038', 'celestiaorg__nmt-192',
];
const RUNS = {
  codex: ['fp-codex-tab-20260826'],
  opencode: ['fp-opencode-tab-20260826', 'rp-oc-tab-20260827'],
  'claude-code': ['fp-claudecode-tab-20260826'],
};

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function patchesFor(runDir, arm, rep) {
  const p = rep === 0 ? path.join(runDir, arm, 'patches.json') : path.join(runDir, arm, `rep-${rep}`, 'patches.json');
  if (!fs.existsSync(p)) return null;
  const arr = readJson(p);
  const m = new Map();
  for (const e of arr) m.set(e.instance_id, e.patch || '');
  return m;
}
function hunkCount(patch) { return (patch.match(/^@@/mg) || []).length; }
function filesTouched(patch) {
  const out = [];
  for (const m of patch.matchAll(/^diff --git a\/(.+?) b\/(.+)$/mg)) out.push(m[2]);
  return out;
}

const result = { tasks: {}, cells: [] };
// Issue text + counts from the codex run's task file (all runs share the task file).
const taskFile = readJson(path.join(ROOT, 'fp-codex-tab-20260826', 'sweet', 'tasks.json'));
for (const t of (Array.isArray(taskFile) ? taskFile : Object.values(taskFile))) {
  if (!TASKS.includes(t.instance_id)) continue;
  result.tasks[t.instance_id] = {
    repo: t.repo, base_commit: t.base_commit, language: t.language, workdir: t.workdir,
    problem_statement: t.problem_statement,
    n_fail_to_pass: Array.isArray(t.FAIL_TO_PASS) ? t.FAIL_TO_PASS.length : (typeof t.FAIL_TO_PASS === 'string' ? JSON.parse(t.FAIL_TO_PASS).length : null),
    n_pass_to_pass: Array.isArray(t.PASS_TO_PASS) ? t.PASS_TO_PASS.length : (typeof t.PASS_TO_PASS === 'string' ? JSON.parse(t.PASS_TO_PASS).length : null),
    gold_files_touched_count: filesTouched(t.patch || '').length,
    gold_hunks: hunkCount(t.patch || ''),
    gold_added_lines: (t.patch || '').split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length,
    gold_removed_lines: (t.patch || '').split('\n').filter(l => l.startsWith('-') && !l.startsWith('---')).length,
  };
}

for (const [harness, runs] of Object.entries(RUNS)) {
  for (const run of runs) {
    const runDir = path.join(ROOT, run);
    if (!fs.existsSync(path.join(runDir, 'rows.json'))) { console.error('missing', run); continue; }
    const rows = readJson(path.join(runDir, 'rows.json'));
    const cache = {};
    for (const r of rows) {
      if (!TASKS.includes(r.taskId)) continue;
      const key = `${r.arm}:${r.rep}`;
      if (!(key in cache)) cache[key] = patchesFor(runDir, r.arm, r.rep);
      const pm = cache[key];
      const patch = pm ? (pm.get(r.taskId) ?? null) : null;
      result.cells.push({
        harness, run, taskId: r.taskId, arm: r.arm, rep: r.rep,
        resolved: r.resolved, f2pFrac: r.f2pFrac, gradeable: r.gradeable, resolveStatus: r.resolveStatus,
        calls: r.calls, ss: r.ss, patchHunks: r.patchHunks, patchFiles: r.patchFiles,
        exitReason: r.exitReason, stepsToFirstEdit: r.stepsToFirstEdit,
        costRealizedUsd: r.costRealizedUsd, idealCostUsd: r.idealCostUsd,
        rolloutFile: r.rolloutFile || null, turnsFile: r.turnsFile || null,
        goldSimilarity: r.goldSimilarity ?? null,
        patch, patchHunksRecount: patch == null ? null : hunkCount(patch), patchFilesList: patch == null ? null : filesTouched(patch),
        finalAssistantText: (r.finalAssistantText || '').slice(0, 1500),
      });
    }
  }
}
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
console.log('tasks', Object.keys(result.tasks).length, 'cells', result.cells.length, '->', OUT);

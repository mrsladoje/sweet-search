#!/usr/bin/env node
/**
 * P1 mechanical smoke: drive the edit+test loop on the isolated flask checkout,
 * both arms, on a trivial explore+edit task. Validates loop mechanics,
 * ss-* usage in the sweet arm, prediction-patch capture, telemetry, escape=0.
 * NOT a graded result.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { runTask } from './api-task-runner.mjs';

const CHECKOUT = '/tmp/ss-eval/smoke';
const SS_BIN = '/Users/admin/Projects/sweet-search-private/eval/agent-read-workflows/bin';
const MPP = '/Users/admin/Projects/sweet-search-private/core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md';
const MODEL = process.env.SMOKE_MODEL || 'deepseek-v4-flash';

function git(args) { return execSync(`git -C ${CHECKOUT} ${args}`, { encoding: 'utf8' }); }
function ensureRepo() {
  // Fresh repo that EXCLUDES .sweet-search/ from tracking, so the ss-* index
  // churn never enters the base commit or the prediction diff.
  execSync(`rm -rf ${CHECKOUT}/.git`);
  git('init -q');
  execSync(`printf '.sweet-search/\\n' > ${CHECKOUT}/.git/info/exclude`);
  git('add -A');
  execSync(`git -C ${CHECKOUT} -c user.email=a@b.c -c user.name=smoke commit -q -m base`);
}
function reset() { try { git('checkout -- .'); git('clean -fdq'); } catch { /* */ } }

const task = {
  id: 'smoke-flask-001',
  repoCheckout: CHECKOUT,
  mppPath: MPP,
  problem_statement: 'Locate the function `find_app_by_string` (it loads a Flask app from a string). Add a single comment line `# task-bench smoke marker` on the line immediately above its `def`. Make no other change.',
};

ensureRepo();
const mppText = readFileSync(MPP, 'utf8');
const results = [];
for (const arm of ['native', 'sweet']) {
  reset();
  const r = await runTask(task, { arm, model: MODEL, maxToolCalls: 12, ssBinDir: SS_BIN, mppText });
  results.push(r);
  console.log(`\n========== arm=${arm} model=${MODEL} ==========`);
  console.log(`exitReason=${r.exitReason} calls=${r.calls} ss=${r.ss} nativeGrep=${r.nativeGrep} edits=${r.toolCounts.edit} stepsToFirstEdit=${r.stepsToFirstEdit}`);
  console.log(`escape=${r.escape} leak=${r.leak} patchFiles=${r.patchFiles} patchHunks=${r.patchHunks} wallMs=${r.wallMs}`);
  if (r.escapeExamples?.length) console.log(`escapeExamples: ${JSON.stringify(r.escapeExamples)}`);
  console.log(`costNaive=$${r.costNaiveUsd} costRealized=$${r.costRealizedUsd} tokens(prompt/compl/reason)=${r.usage.prompt}/${r.usage.completion}/${r.usage.reasoning}`);
  console.log(`trajectory: ${r.trajectory.map(t => t.kind).join(' → ') || '(none)'}`);
  console.log(`--- prediction patch (first 600 chars) ---\n${r.finalPatch.slice(0, 600) || '(empty)'}`);
}
reset();
console.log('\n=== SMOKE SUMMARY ===');
for (const r of results) console.log(`${r.arm}: edited=${r.patchHunks > 0} ss-used=${r.ss > 0} escape=${r.escape} leak=${r.leak} calls=${r.calls}`);

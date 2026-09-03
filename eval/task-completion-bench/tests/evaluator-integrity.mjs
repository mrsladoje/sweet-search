import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEvaluatorRuntime } from '../harness/evaluator-runtime.mjs';
import { mergeEvaluationReportFile, mergeTaskRecordFile } from '../harness/result-retention.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const parserPath = path.resolve(here, '../harness/cargo_log_parser.py');
const wrapperPath = path.resolve(here, '../harness/sr-eval.py');
const python = process.env.VENV_PY || 'python3';

const logs = [
  'test same_ok ... ok\ntest same_fail ... FAILED',
  'test backwards_range ... "../testdata/full-dump.dmp"\nok',
  'test noisy ... prefix\nstdout one\nstdout two\nok',
  'test split_fail ... diagnostic\nFAILED',
  'test first ... output\ntest second ... output\nok\nFAILED',
  'test first ... output\ntest second ... output\nok\nFAILED\ntest recovered ... output\nok',
  'test pending ... output\ntest explicit ... ok\nok',
  'ok\nFAILED',
  'test dropped ... output\nrunning 1 test\nok',
  'test skipped ... ignored\nok',
  'test truncated ... output',
  // Glued status (gleam-3458): concurrent stdout `Locked!` welded onto the token.
  'test dependencies::provided_local_to_manifest ... okLocked!',
  'test glued_fail ... FAILEDLocked!',
  'test standalone_glued ... output\nokLocked!',
  // A lowercase continuation is a word, never a status: `okay` stays pending output.
  'test okay_noise ... okay\nok',
];
const parseScript = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("cargo_log_parser", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
json.dump([module.parse_log_cargo(log) for log in json.load(sys.stdin)], sys.stdout)
`;
const parsed = JSON.parse(execFileSync(python, ['-c', parseScript, parserPath], {
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  input: JSON.stringify(logs), encoding: 'utf8',
}));
assert.deepEqual(parsed[0], { same_ok: 'PASSED', same_fail: 'FAILED' });
assert.deepEqual(parsed[1], { backwards_range: 'PASSED' });
assert.deepEqual(parsed[2], { noisy: 'PASSED' });
assert.deepEqual(parsed[3], { split_fail: 'FAILED' });
assert.deepEqual(parsed[4], {});
assert.deepEqual(parsed[5], { recovered: 'PASSED' });
assert.deepEqual(parsed[6], { explicit: 'PASSED', pending: 'PASSED' });
assert.deepEqual(parsed[7], {});
assert.deepEqual(parsed[8], {});
assert.deepEqual(parsed[9], {});
assert.deepEqual(parsed[10], {});
assert.deepEqual(parsed[11], { 'dependencies::provided_local_to_manifest': 'PASSED' });
assert.deepEqual(parsed[12], { glued_fail: 'FAILED' });
assert.deepEqual(parsed[13], { standalone_glued: 'PASSED' });
assert.deepEqual(parsed[14], { okay_noise: 'PASSED' });

const dir = mkdtempSync(path.join(tmpdir(), 'evaluator-integrity-'));
try {
  const fakeEval = path.join(dir, 'fake-eval');
  mkdirSync(path.join(fakeEval, 'lib/agent'), { recursive: true });
  mkdirSync(path.join(fakeEval, 'scripts'), { recursive: true });
  writeFileSync(path.join(fakeEval, 'lib/agent/__init__.py'), '');
  writeFileSync(path.join(fakeEval, 'lib/agent/log_parsers.py'),
    'def old(log): return {"old": "FAILED"}\nNAME_TO_PARSER = {"parse_log_cargo": old}\n');
  writeFileSync(path.join(fakeEval, 'scripts/eval.py'), [
    'import json',
    'from agent import log_parsers',
    'print(json.dumps(log_parsers.NAME_TO_PARSER["parse_log_cargo"]("test wrapped ... output\\nok")))',
    '',
  ].join('\n'));
  const wrapped = execFileSync(python, [wrapperPath], {
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', SR_EVAL_DIR: fakeEval,
      SS_SR_EVAL_SCRIPT: path.join(fakeEval, 'scripts/eval.py') },
    encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(wrapped), { wrapped: 'PASSED' });

  // With no explicit override, the wrapper must execute the repository-owned
  // evaluator and expose its machine-checkable evidence contract.
  const contract = JSON.parse(execFileSync(python, [wrapperPath, '--print-contract'], {
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', SR_EVAL_DIR: fakeEval,
      SS_SR_EVAL_SCRIPT: '' },
    encoding: 'utf8',
  }));
  assert.equal(contract.version, 1);
  assert.match(contract.n_test_results, /required/);
  assert.equal(contract.empty_agent_patch, 'grade-baseline');

  const patchesPath = path.join(dir, 'patches.json');
  const reportPath = path.join(dir, 'report.json');
  const records = Array.from({ length: 10 }, (_, i) => ({
    instance_id: `task-${i + 1}`,
    patch: `diff --git a/file-${i + 1} b/file-${i + 1}\n+payload ${i + 1}\n`,
  }));
  const items = records.map(({ instance_id }, i) => ({
    instance_id, from_fail_to_pass: [`f2p-${i + 1}`], failed_from_pass_to_pass: [],
    passed_match: true, exit_code: 0, log_path: `logs/${instance_id}.txt`, error: '',
  }));
  for (const [start, end] of [[0, 6], [6, 10]]) {
    mergeTaskRecordFile(patchesPath, records.slice(start, end));
    mergeEvaluationReportFile(reportPath, {
      max_workers: 2, total: end - start, all_ok: true, items: items.slice(start, end),
    });
  }

  const retainedPatches = JSON.parse(readFileSync(patchesPath, 'utf8'));
  const retainedReport = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(retainedPatches.length, 10);
  assert.equal(retainedReport.items.length, 10);
  assert.equal(retainedReport.total, 10);
  assert.equal(retainedReport.all_ok, true);
  assert.deepEqual(retainedPatches.map(x => x.instance_id), records.map(x => x.instance_id));
  assert.deepEqual(retainedReport.items.map(x => x.instance_id), records.map(x => x.instance_id));
  assert.equal(retainedPatches[4].patch, records[4].patch);

  mergeTaskRecordFile(patchesPath, [{ ...records[4], patch: 'replacement\n' }]);
  mergeEvaluationReportFile(reportPath, { max_workers: 1, items: [{
    ...items[4], passed_match: false, error: 'synthetic evaluator error', future_field: 7,
  }] });
  const updatedPatches = JSON.parse(readFileSync(patchesPath, 'utf8'));
  const updatedReport = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(updatedPatches.length, 10);
  assert.equal(updatedPatches[4].patch, 'replacement\n');
  assert.equal(updatedReport.total, 10);
  assert.equal(updatedReport.all_ok, false);
  assert.equal(updatedReport.items[4].future_field, 7);
  assert.equal(updatedReport.max_workers, 2);
  assert.equal(readdirSync(dir).some(name => name.includes('.tmp-')), false);

  writeFileSync(path.join(fakeEval, 'scripts/eval.py'), [
    'import argparse, json',
    'from pathlib import Path',
    'parser = argparse.ArgumentParser()',
    'parser.add_argument("--json", required=True)',
    'parser.add_argument("--patches", required=True)',
    'parser.add_argument("--max-workers", type=int, required=True)',
    'parser.add_argument("--report-json", required=True)',
    'parser.add_argument("--network")',
    // The real grader MUST pass this: without it eval.py reverts the image author's
    // working-tree SDK/TFM shims and the suite cannot even start (the 12 yarp rows).
    // required=True here so dropping the flag again fails this test instead of shipping.
    'parser.add_argument("--reapply-install-seds", action="store_true", required=True)',
    'args = parser.parse_args()',
    'tasks = json.loads(Path(args.json).read_text())',
    'patches = {row["instance_id"] for row in json.loads(Path(args.patches).read_text())}',
    'Path("logs").mkdir(exist_ok=True)',
    'items = []',
    'for task in tasks:',
    '    instance_id = task["instance_id"]',
    '    assert instance_id in patches',
    '    log_path = Path("logs") / f"{instance_id}_log.txt"',
    // task-9 stands for a build/SDK outage: eval.py raises nothing, the report item looks
    // ordinary, and the only signal that no test ran is n_test_results == 0.
    '    blind = instance_id == "task-9"',
    '    log_path.write_text("no test ran\\n" if blind else "synthetic green log\\n")',
    '    item = {"instance_id": instance_id, "from_fail_to_pass": [] if blind else ["target"], "failed_from_pass_to_pass": [], "passed_match": not blind, "exit_code": 1 if blind else 0, "log_path": str(log_path), "error": ""}',
    '    if instance_id != "task-10": item["n_test_results"] = 0 if blind else 42',
    '    items.append(item)',
    'payload = {"max_workers": args.max_workers, "total": len(items), "all_ok": True, "items": items}',
    'Path(args.report_json).write_text(json.dumps(payload))',
    '',
  ].join('\n'));
  const taskSpecs = records.map(({ instance_id }) => ({ instance_id, FAIL_TO_PASS: ['target'], PASS_TO_PASS: [] }));
  const runtime = createEvaluatorRuntime({
    benchDir: dir, dataset: 'unused', defaultTestTimeoutSec: 1, dockerHost: 'unused',
    dockerNetArgs: () => '', imageNameFor: () => 'unused', netLockdown: true,
    shellQuote: value => value, srEvalDir: fakeEval, srEvalRunner: wrapperPath,
    srMode: true, taskById: new Map(taskSpecs.map(task => [task.instance_id, task])),
    taskOverrides: { tasks: {} }, venvPython: python,
  });
  const previousBatch = process.env.GRADE_BATCH;
  const previousGc = process.env.NO_IMAGE_GC;
  const previousEvalScript = process.env.SS_SR_EVAL_SCRIPT;
  process.env.GRADE_BATCH = '6';
  process.env.NO_IMAGE_GC = '1';
  process.env.SS_SR_EVAL_SCRIPT = path.join(fakeEval, 'scripts/eval.py');
  let grade, emptyGrade, mixedGrade;
  try {
    grade = runtime.gradeArm('sweet', records.map(record => ({
      instance_id: record.instance_id, model_patch: record.patch,
    })), 'synthetic-ten', 0);
    emptyGrade = runtime.gradeArm('native', records.slice(0, 2).map(record => ({
      instance_id: record.instance_id, model_patch: '',
    })), 'synthetic-empty', 0);
    mixedGrade = runtime.gradeArm('sweet', [
      { instance_id: records[0].instance_id, model_patch: '' },
      { instance_id: records[1].instance_id, model_patch: records[1].patch },
    ], 'synthetic-mixed', 0);
  } finally {
    if (previousBatch === undefined) delete process.env.GRADE_BATCH;
    else process.env.GRADE_BATCH = previousBatch;
    if (previousGc === undefined) delete process.env.NO_IMAGE_GC;
    else process.env.NO_IMAGE_GC = previousGc;
    if (previousEvalScript === undefined) delete process.env.SS_SR_EVAL_SCRIPT;
    else process.env.SS_SR_EVAL_SCRIPT = previousEvalScript;
  }
  const integratedDir = path.join(dir, 'results/synthetic-ten/sweet');
  // D-1 tripwire: task-9 explicitly reports zero tests and task-10 simulates an
  // external evaluator that omits the evidence-count contract. Neither may score.
  assert.equal(grade.resolved_ids.length, 8);
  assert.equal(grade.resolved_ids.includes('task-9'), false);
  assert.equal(grade.resolved_ids.includes('task-10'), false);
  assert.deepEqual(grade.no_test_evidence_ids, ['task-9', 'task-10']);
  assert.equal(grade.score['task-9'].status, 'NO-TEST-EVIDENCE');
  assert.equal(grade.score['task-9'].f2pFrac, null);
  assert.equal(grade.score['task-10'].status, 'NO-TEST-EVIDENCE');
  assert.equal(grade.score['task-10'].evidenceReason, 'missing-n_test_results-contract');
  assert.equal(grade.score['task-1'].nTestResults, 42);
  assert.equal(JSON.parse(readFileSync(path.join(integratedDir, 'report.json'), 'utf8')).items.length, 10);
  assert.equal(JSON.parse(readFileSync(path.join(integratedDir, 'patches.json'), 'utf8')).length, 10);
  assert.equal(JSON.parse(readFileSync(path.join(integratedDir, 'tasks.json'), 'utf8')).length, 10);
  assert.equal(readFileSync(path.join(integratedDir, 'logs/task-1_log.txt'), 'utf8'), 'synthetic green log\n');
  assert.equal(readdirSync(integratedDir).some(name => name.startsWith('.grade-')), false);

  // Empty patches are still graded: they are baseline predictions, not rows that
  // can be stamped gradeable without a log. Exercise all-empty and mixed batches.
  assert.equal(emptyGrade.resolved_ids.length, 2);
  assert.deepEqual(emptyGrade.no_test_evidence_ids, []);
  const emptyPatches = JSON.parse(readFileSync(path.join(dir,
    'results/synthetic-empty/native/patches.json'), 'utf8'));
  assert.equal(emptyPatches.length, 2);
  assert.equal(emptyPatches.every(item => item.patch === ''), true);

  assert.equal(mixedGrade.resolved_ids.length, 2);
  assert.deepEqual(mixedGrade.no_test_evidence_ids, []);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// THE GRADER IS INSIDE THE LEDGER FINGERPRINT (2026-08-12)
//
// D-1 was not "someone forgot a flag". It was that gold validation and rollout
// grading could diverge SILENTLY, because nothing tied a gold verdict to the
// grader that produced it. Fixing the flag left that class open, and it
// recurred: the 2026-08-12 review changed empty-patch handling and evidence
// gating, and every gold verdict still read as fresh.
//
// These assertions close the class. If a future change edits the grader without
// invalidating gold, this test fails before the run does.
{
  const { RT_HARNESS_FINGERPRINT, taskConfigHash } = await import('../harness/env-ledger.mjs');
  const graderNames = (RT_HARNESS_FINGERPRINT.grader || []).map(s => s.name);
  for (const required of ['evaluator-runtime.mjs', 'sr-eval.py', 'upstream-patches/eval.py', 'cargo_log_parser.py']) {
    assert.ok(graderNames.includes(required),
      `grader source ${required} must be inside the ledger fingerprint`);
  }
  assert.ok(RT_HARNESS_FINGERPRINT.version >= 3,
    'adding the grader must bump the fingerprint version so the change is explicit');
  assert.ok((RT_HARNESS_FINGERPRINT.grader || []).every(s => /^[0-9a-f]{64}$/.test(s.sha256)),
    'every grader source is hashed by content, not merely named');

  // The property that matters: a changed grader must change every task's hash.
  const spec = { instance_id: 'acme__widget-1', image_name: 'registry/acme:1',
    install_config: { test_cmd: 'pytest -q' } };
  const before = taskConfigHash(spec);
  const mutated = {
    ...RT_HARNESS_FINGERPRINT,
    grader: [{ name: 'upstream-patches/eval.py', sha256: 'f'.repeat(64) }],
  };
  const after = taskConfigHash(spec, { rtHarness: mutated });
  assert.notEqual(before, after,
    'a grader edit MUST invalidate gold verdicts — otherwise D-1 can recur silently');
}

console.log('evaluator-integrity: parser, ten-task retention, and grader-fingerprint assertions passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { packageSearchBatchResults } from '../../../core/search/search-batch.js';
import {
  EQUIVALENCE_SEED,
  assertCohortManifest,
  evaluateBudget,
  evaluateBudgetSweep,
  evaluateTaskPacking,
  pairedBootstrapLowerBound,
  selectDevCohort,
} from '../stats/ss-batch-equivalence.mjs';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
}

const span = (file, startLine, endLine, rank, text) => ({
  file, startLine, endLine, rank, text,
});

function packingCase(id = 'task-1') {
  return {
    id,
    repo: 'synthetic',
    query: {
      query_id: id,
      relevant_files: ['target.js'],
      relevant_chunks: ['target.js:10-20'],
    },
    rawResults: [
      { id: 'search', tool: 'search', status: 'ok', spans: [
        span('noise-a.js', 1, 5, 1, 'a'.repeat(3100)),
        span('target.js', 10, 20, 2, 'TARGET'),
      ] },
      { id: 'pattern', tool: 'find', status: 'ok', spans: [
        span('noise-a.js', 1, 5, 1, 'a'.repeat(3100)),
        span('noise-b.js', 1, 5, 2, 'b'.repeat(3100)),
      ] },
    ],
  };
}

test('selects a deterministic repo-stratified DEV cohort and freezes its hash', () => {
  const rows = {
    alpha: [
      { query_id: 'a1', repo: 'alpha', split: 'dev' },
      { query_id: 'a2', repo: 'alpha', split: 'test' },
      { query_id: 'a3', repo: 'alpha', split: 'dev' },
      { query_id: 'a4', repo: 'alpha', split: 'dev' },
    ],
    beta: [
      { query_id: 'b1', repo: 'beta', split: 'dev' },
      { query_id: 'b2', repo: 'beta', split: 'dev' },
    ],
  };
  const first = selectDevCohort(rows, { perRepo: 2, seed: EQUIVALENCE_SEED });
  const second = selectDevCohort({ beta: [...rows.beta].reverse(), alpha: [...rows.alpha].reverse() }, {
    perRepo: 2, seed: EQUIVALENCE_SEED,
  });
  assert.deepEqual(first.ids, second.ids);
  assert.deepEqual(first.perRepo, { alpha: 2, beta: 2 });
  assert.equal(first.n, 4);
  assert.equal(first.sha256, '06277a9d53e83e4fd44dbed4471b94ee3dd322938ae77b319cab5904f151fc3c');
  assert.ok(first.rows.every((row) => row.split === 'dev'));
  assert.equal(assertCohortManifest(first, first.sha256), first.sha256);
  assert.throws(() => assertCohortManifest(first), /required before retrieval/);
  assert.throws(() => assertCohortManifest({ ...first, ids: [...first.ids].reverse() }, first.sha256),
    /does not match/);
});

test('paired one-sided bootstrap is deterministic and detects a material tail loss', () => {
  const flat = pairedBootstrapLowerBound(Array(8).fill(-0.005), {
    seed: EQUIVALENCE_SEED, iterations: 500,
  });
  assert.equal(flat, -0.005);
  const deltas = [-0.2, 0, 0, 0, 0, 0, 0, 0];
  const first = pairedBootstrapLowerBound(deltas, { seed: EQUIVALENCE_SEED, iterations: 2000 });
  const second = pairedBootstrapLowerBound(deltas, { seed: EQUIVALENCE_SEED, iterations: 2000 });
  assert.equal(first, second);
  assert.ok(first < -0.01);
});

test('a sufficient budget passes and a recall-starving budget fails closed', () => {
  const task = packingCase();
  const low = evaluateBudget([task], 6000, { bootstrapIterations: 500 });
  const high = evaluateBudget([task], 8000, { bootstrapIterations: 500 });
  assert.equal(low.pass, false);
  assert.ok(low.failureReasons.some((reason) => reason.includes('recall')));
  assert.equal(high.pass, true);
  assert.deepEqual(high.failureReasons, []);
});

test('model-facing renderer metadata is counted and can fail the token gate', () => {
  const task = packingCase('metadata-overhead');
  task.rawResults = [
    { id: 'search', tool: 'search', status: 'ok', spans: [span('target.js', 10, 20, 1, 'x'.repeat(500))] },
    { id: 'pattern', tool: 'find', status: 'ok', spans: [span('target.js', 10, 20, 1, 'x'.repeat(500))] },
  ];
  const packed = packageSearchBatchResults(task.rawResults, { maxChars: 6000 });
  const result = evaluateBudget([task], 6000, { bootstrapIterations: 100 });
  const outputOnlyChars = packed.operations.reduce((sum, operation) => sum + operation.output.length, 0);
  assert.equal(packed.operations.flatMap((operation) => operation.meta.omittedSpans).length, 1);
  assert.ok(outputOnlyChars < result.chars.serialP95);
  assert.equal(result.recall.span.delta, 0);
  assert.equal(result.relevantSpanAccounting.unaccounted, 0);
  assert.ok(result.tokens.packedP95 > result.tokens.serialP95);
  assert.ok(result.failureReasons.includes('p95 packed tokens exceed serial union'));
  assert.equal(result.pass, false);
});

test('every relevant serial span must be emitted or carry an explicit omission', () => {
  const task = packingCase();
  const packed = packageSearchBatchResults(task.rawResults, { maxChars: 6000 });
  const accounted = evaluateTaskPacking(task, packed);
  assert.equal(accounted.relevantSerialSpanCount, 1);
  assert.equal(accounted.unaccountedRelevantSerialSpans, 0);

  const silent = structuredClone(packed);
  const operation = silent.operations.find(({ id }) => id === 'search');
  operation.meta.spans = operation.meta.spans.filter(({ file }) => file !== 'target.js');
  operation.meta.omittedSpans = operation.meta.omittedSpans.filter(({ file }) => file !== 'target.js');
  assert.equal(evaluateTaskPacking(task, silent).unaccountedRelevantSerialSpans, 1);
  operation.meta.omittedSpans.push({
    file: 'target.js', startLine: 10, endLine: 20, rank: 2, reason: 'budget',
  });
  assert.equal(evaluateTaskPacking(task, silent).unaccountedRelevantSerialSpans, 0);
});

test('the sweep selects the smallest passing shared budget', () => {
  const report = evaluateBudgetSweep([packingCase()], {
    budgets: [6000, 8000, 10000], bootstrapIterations: 500,
  });
  assert.equal(report.verdict, 'PASS');
  assert.equal(report.selectedBudget, 8000);
  assert.deepEqual(report.budgets.map(({ budget, pass }) => [budget, pass]), [
    [6000, false], [8000, true], [10000, true],
  ]);
});

test('no passing budget produces a fail-closed verdict', () => {
  const task = packingCase();
  task.query.relevant_chunks = ['missing.js:1-2'];
  task.query.relevant_files = ['target.js'];
  const report = evaluateBudgetSweep([task], { budgets: [6000], bootstrapIterations: 500 });
  assert.equal(report.verdict, 'FAIL');
  assert.equal(report.selectedBudget, null);
});

console.log(`1..${passed}`);

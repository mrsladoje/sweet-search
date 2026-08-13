// Regression coverage for item-6 publication semantics. Standalone, zero spend:
// `node tests/analyze-degeneration.mjs`.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ANALYZER = fileURLToPath(new URL('../harness/analyze-run.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'sweet-search-analyze-degeneration-'));
let ok = true;
const assert = (condition, name, detail = '') => {
  console.log(`${condition ? '  ✓' : '  ✗'} ${name}${condition ? '' : `  ${detail}`}`);
  if (!condition) ok = false;
};

function row(taskId, arm, rep, costRealizedUsd, degenerate = false) {
  return {
    taskId, arm, rep, costRealizedUsd,
    idealCostUsd: costRealizedUsd == null ? null : costRealizedUsd * 1.1,
    breakPricedCostUsd: costRealizedUsd == null ? null : costRealizedUsd * 1.2,
    contextRewrites: 0, calls: 1,
    resolved: true, gradeable: true, noTestEvidence: false,
    degenerate,
    degenerationInstrumentationComplete: true,
    degeneration: {
      degenerate,
      reasons: degenerate ? ['output-visibility-mismatch'] : [],
      billedVsRetainedRatio: degenerate ? 8 : 1,
      instrumentation: { complete: true, mainOutput: 'result-aggregate', sidechainTranscripts: 0 },
    },
  };
}

const rows = [
  row('task-a', 'native', 0, 0.01),
  row('task-a', 'sweet', 0, 0.02, true),
  row('task-a', 'native', 1, 0.03),
  row('task-a', 'sweet', 1, 0.04),
  row('task-b', 'native', 0, 0.05),
  row('task-b', 'sweet', 0, 0.06),
  row('task-b', 'native', 1, 0.07),
  row('task-b', 'sweet', 1, 0.08),
];

function analyze(name, fixture) {
  const file = join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(fixture));
  return execFileSync(process.execPath, [ANALYZER, file, '--boot', '100'], { encoding: 'utf8' });
}

try {
  console.log('\ncoherent raw, flagged, and paired sensitivity views:');
  const output = analyze('complete', rows);
  assert((output.match(/SOLE COST HEADLINE/g) || []).length === 1,
    'raw untrimmed cost is the only headline');
  assert(output.includes('native: 4 row(s), $0.160000 raw realized')
    && output.includes('sweet: 4 row(s), $0.200000 raw realized'),
  'headline sums every row rather than task-cell means');
  assert(output.includes('sweet: 1 flag(s); $0.020000 raw row-level realized cost associated with flags'),
    'flagged dollars use the same explicit row-level realized estimand');
  assert(output.includes('MATCHED-PAIR SENSITIVITY: remove 1 taskId×rep pair(s), both arms (2 rows)'),
    'a one-arm flag removes the matched task×rep row from both arms');
  assert(output.includes('native: 3 row(s), $0.150000 raw realized')
    && output.includes('sweet: 3 row(s), $0.180000 raw realized'),
  'matched sensitivity retains equal row denominators');
  assert(output.includes('WHOLE-TASK SENSITIVITY: remove 1 flagged task(s), all arms and reps (4 rows)'),
    'whole-task sensitivity removes every arm and rep for the flagged task');
  assert(!output.includes('EXCLUDED VIEW') && !output.includes('zero head-to-head differential'),
    'output does not present rowwise exclusion or claim zero differential');
  assert(output.includes('BOTH-SOLVED (descriptive post-treatment stratum; not a causal estimate)')
    && !output.includes('clean cost comparison'),
  'both-solved cost is labeled as a descriptive post-treatment stratum');

  console.log('\nmixed instrumentation fails closed:');
  const mixed = structuredClone(rows);
  delete mixed[0].degeneration;
  const mixedOutput = analyze('mixed', mixed);
  assert(mixedOutput.includes('DIAGNOSTIC INSTRUMENTATION INCOMPLETE: 1/8'),
    'one missing structured flag is reported');
  assert(!mixedOutput.includes('MATCHED-PAIR SENSITIVITY'),
    'no diagnostic exclusion sensitivity runs on partial instrumentation');

  const incompleteInstrumentation = structuredClone(rows);
  incompleteInstrumentation[0].degenerationInstrumentationComplete = false;
  incompleteInstrumentation[0].degeneration.instrumentation.complete = false;
  const incompleteInstrumentationOutput = analyze('incomplete-instrumentation', incompleteInstrumentation);
  assert(incompleteInstrumentationOutput.includes('DIAGNOSTIC INSTRUMENTATION INCOMPLETE: 1/8'),
    'an explicit incomplete-instrumentation row fails closed');
  assert(!incompleteInstrumentationOutput.includes('MATCHED-PAIR SENSITIVITY'),
    'explicitly incomplete sidechain/main accounting cannot drive exclusions');

  const inconsistentInstrumentation = structuredClone(rows);
  inconsistentInstrumentation[0].degenerationInstrumentationComplete = true;
  inconsistentInstrumentation[0].degeneration.instrumentation.complete = false;
  const inconsistentOutput = analyze('inconsistent-instrumentation', inconsistentInstrumentation);
  assert(inconsistentOutput.includes('DIAGNOSTIC INSTRUMENTATION INCOMPLETE: 1/8'),
    'top-level and structured completeness must both attest true');

  console.log('\nunavailable costs and incomplete pairs fail visibly:');
  const missingCost = structuredClone(rows);
  missingCost[1].costRealizedUsd = null;
  const missingCostOutput = analyze('missing-cost', missingCost);
  assert(missingCostOutput.includes('task-a/sweet/r0  realized cost unavailable'),
    'a missing flagged cost is named as unavailable, never rendered as zero');
  assert(missingCostOutput.includes('sweet: unavailable (1/4 row(s) missing realized cost)'),
    'raw total fails closed when any row cost is missing');

  const incompletePair = rows.filter(r => !(r.taskId === 'task-a' && r.arm === 'native' && r.rep === 0));
  const incompleteOutput = analyze('incomplete-pair', incompletePair);
  assert(incompleteOutput.includes('DIAGNOSTIC SENSITIVITIES NOT RUN: taskId×rep pairing is incomplete or duplicated'),
    'pair removal fails closed when the source rows are not arm-balanced');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(ok ? '\nALL PASS' : '\nFAIL');
process.exit(ok ? 0 : 1);

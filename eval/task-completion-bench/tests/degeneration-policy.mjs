// Unit tests for the degenerate-rollout collection policy state machine
// (degeneration-policy.mjs). Standalone: `node tests/degeneration-policy.mjs` — exit 1 on fail.
//
// The rule under test was pre-registered in RESULTS-2026-08-13.md §9.3 BEFORE the run
// that would be judged by it. These assertions are what stop it drifting afterwards —
// in particular the one property that makes the rule honest: a second degenerate
// attempt is KEPT, never excluded, because dropping rollouts after seeing which arm
// drew them is exactly the freedom the rule removes.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { degenerationVerdict } from '../harness/degeneration-policy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.resolve(HERE, '..');

let ok = true;
const eq = (got, want, name) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log((pass ? '  ✓ ' : '  ✗ ') + name + (pass ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
  if (!pass) ok = false;
};
const assert = (c, name) => { console.log((c ? '  ✓ ' : '  ✗ ') + name); if (!c) ok = false; };

console.log('degenerationVerdict state machine:');
eq(degenerationVerdict([]),
  { done: false, needRerun: false, reran: false, degenerateAfterRetry: false, degenerateEver: false },
  'no attempt → not done, no rerun');
eq(degenerationVerdict([false]),
  { done: true, needRerun: false, reran: false, degenerateAfterRetry: false, degenerateEver: false },
  'clean first run → accept, done');
eq(degenerationVerdict([true]),
  { done: false, needRerun: true, reran: false, degenerateAfterRetry: false, degenerateEver: true },
  'degenerate first → re-run mandated');
eq(degenerationVerdict([true, false]),
  { done: true, needRerun: false, reran: true, degenerateAfterRetry: false, degenerateEver: true },
  'clean re-run → the retry replaces the blow-up');
eq(degenerationVerdict([true, true]),
  { done: true, needRerun: false, reran: true, degenerateAfterRetry: true, degenerateEver: true },
  'degenerate twice → KEPT and flagged');

console.log('\nthe two properties the rule exists to guarantee:');
{
  // 1. Never exclude. This is the deliberate difference from shim-policy, which does
  //    exclude on a second tamper. Compare the two shapes so a later edit that
  //    "harmonises" them has to delete an assertion that says why they differ.
  const twice = degenerationVerdict([true, true]);
  assert(!('excluded' in twice), 'the verdict has no excluded field at all — exclusion is not an outcome');
  assert(twice.done === true, 'a twice-degenerate rollout is still accepted into the scored set');

  // 2. Bounded at two attempts. An unbounded retry on a decoder that reliably blows up
  //    on one task would burn the run's budget on that task alone.
  for (const flags of [[true, true, true], [true, false, true]]) {
    const v = degenerationVerdict(flags);
    assert(v.needRerun === false, `never re-runs a third time (${JSON.stringify(flags)})`);
  }
}

console.log('\nwiring — the policy is actually applied by the collection loop:');
{
  const pilot = readFileSync(path.join(BENCH, 'harness/run-pilot.mjs'), 'utf8');
  assert(/import \{ degenerationVerdict \} from '\.\/degeneration-policy\.mjs'/.test(pilot),
    'run-pilot imports the policy');
  assert(/degenerationVerdict\(degenFlags\)/.test(pilot), 'run-pilot evaluates it per attempt');
  assert(/d\.needRerun/.test(pilot), 'run-pilot acts on needRerun');
  // The retry costs money; a run whose retries were free would under-report spend.
  assert(/degenFlags\.push[\s\S]{0,400}?attemptCost \+=|attemptCost \+=[\s\S]{0,400}?degenFlags\.push/.test(pilot),
    'the re-run attempt accrues cost');
  assert(/degenReran|degenerateAfterRetry/.test(pilot), 'the outcome is stamped on the row');
}

console.log(ok ? '\ndegeneration-policy: all assertions passed' : '\ndegeneration-policy: FAILURES');
process.exit(ok ? 0 : 1);

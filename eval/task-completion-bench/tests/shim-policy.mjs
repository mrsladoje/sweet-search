// Unit tests for the shimTampered collection policy state machine (shim-policy.mjs).
// Standalone (no test runner): `node tests/shim-policy.mjs` — exit 1 on fail.
import { shimVerdict } from '../harness/shim-policy.mjs';

let ok = true;
const eq = (got, want, name) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log((pass ? '  ✓ ' : '  ✗ ') + name + (pass ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
  if (!pass) ok = false;
};

console.log('shimVerdict state machine:');
// no attempt yet
eq(shimVerdict([]), { done: false, needRerun: false, reran: false, excluded: false, tamperedEver: false }, 'no attempt → not done, no rerun');
// clean first run → accept
eq(shimVerdict([false]), { done: true, needRerun: false, reran: false, excluded: false, tamperedEver: false }, 'clean first run → accept, done');
// tampered first run → mandate exactly one re-run, not yet done, not yet excluded
eq(shimVerdict([true]), { done: false, needRerun: true, reran: false, excluded: false, tamperedEver: true }, 'tampered first → re-run mandated');
// re-run clean → accept the re-run, done, not excluded, reran=true
eq(shimVerdict([true, false]), { done: true, needRerun: false, reran: true, excluded: false, tamperedEver: true }, 're-run clean → accept re-run');
// re-run tampered too → EXCLUDE (counted in report), reran=true
eq(shimVerdict([true, true]), { done: true, needRerun: false, reran: true, excluded: true, tamperedEver: true }, 're-run tampered → EXCLUDED');

console.log('\ninvariants:');
// never mandate a THIRD attempt: once two attempts exist, needRerun is always false
for (const seq of [[false], [true, false], [true, true]]) {
  const v = shimVerdict(seq);
  eq(v.needRerun, false, `seq ${JSON.stringify(seq)}: never needs a rerun once decided`);
}
// excluded implies the run is invalid: it can only be true after a re-run
eq(shimVerdict([true, true]).excluded && shimVerdict([true, true]).reran, true, 'excluded ⇒ a re-run happened');
// a single clean run is never excluded and never reran
eq(shimVerdict([false]).excluded || shimVerdict([false]).reran, false, 'clean single run: neither excluded nor reran');

console.log(ok ? '\nALL PASS' : '\nFAILED');
process.exit(ok ? 0 : 1);

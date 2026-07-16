// shimTampered collection policy (2026-07-09) — pure state machine, unit-tested.
//
// DETECTION lives in codex-task-runner (sha256 snapshot of the run_tests shim
// files, re-hashed after the agent loop → row.shimTampered). This module is the
// POLICY the collection loop applies on top of that signal:
//
//   A tampered run's PASS/FAIL signal is untrusted, so the run is INVALID and is
//   automatically re-run ONCE. If the re-run is ALSO tampered, the run is EXCLUDED
//   from both arms' scored sets (its prediction never enters grading) and counted
//   in the report. A clean re-run is accepted in place of the tampered first run.
//
// We never attempt more than two runs (one original + one mandated re-run): a
// second tamper is treated as adversarial/persistent and excluded rather than
// retried unboundedly.
//
// `tamperFlags` is the ORDERED list of per-attempt tamper booleans:
//   []           → no attempt yet
//   [false]      → clean first run: accept, done
//   [true]       → first run tampered: re-run mandated (not yet done)
//   [true,false] → re-run clean: accept the re-run, done
//   [true,true]  → re-run also tampered: EXCLUDE from scored sets, count in report
export function shimVerdict(tamperFlags) {
  const n = tamperFlags.length;
  if (n === 0) return { done: false, needRerun: false, reran: false, excluded: false, tamperedEver: false };
  if (n === 1) {
    if (tamperFlags[0]) return { done: false, needRerun: true, reran: false, excluded: false, tamperedEver: true };
    return { done: true, needRerun: false, reran: false, excluded: false, tamperedEver: false };
  }
  // n >= 2: the re-run has happened; never re-run again.
  return { done: true, needRerun: false, reran: true, excluded: !!tamperFlags[1], tamperedEver: tamperFlags.some(Boolean) };
}

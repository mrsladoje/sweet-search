// Degenerate-rollout collection policy — the rule pre-registered in
// RESULTS-2026-08-13.md §9.3, made executable.
//
// DETECTION lives in degeneration.mjs (`classifyRollout`), which is arm-blind: it
// never sees which arm produced the rollout. This module is the POLICY the collection
// loop applies on top of that signal:
//
//   A degenerate rollout is RE-RUN once and the retry replaces it.
//
// Three decisions, all settled in §9.3 and none of them re-opened here:
//
//   Why not price them. A decoding blow-up is a malfunction of the decoder, not a
//   property of the retrieval tool under test. Pricing them makes the scoreboard a
//   lottery on which arm draws blow-ups — worth up to 15.6 points on the 2026-08-13
//   run, on a 4-to-1 native-to-sweet split.
//
//   Why not exclude them. Dropping rollouts after seeing which arm they landed on is
//   the researcher degree of freedom the whole section exists to remove, and it
//   discards a rollout that may have been a solve. So a second degenerate attempt is
//   KEPT and flagged — never excluded. This is the one place this policy deliberately
//   differs from shim-policy.mjs, which does exclude on a second tamper: shim tampering
//   is adversarial and its PASS/FAIL is untrusted, whereas a degenerate rollout is a
//   real, gradeable attempt that merely cost a silly amount.
//
//   Why retry. Arm-blind, cheap (5 in 64 ≈ 8% more rollouts on the run that motivated
//   it), and it yields a complete sample rather than a censored one.
//
// Bounded at two attempts (one original + one mandated re-run), like shim-policy.
//
// `degenFlags` is the ORDERED list of per-attempt degeneracy booleans:
//   []            → no attempt yet
//   [false]       → clean first run: accept, done
//   [true]        → first run degenerate: re-run mandated (not yet done)
//   [true,false]  → re-run clean: accept the re-run, done
//   [true,true]   → re-run degenerate too: ACCEPT it anyway, flagged, never excluded
export function degenerationVerdict(degenFlags) {
  const n = degenFlags.length;
  if (n === 0) return { done: false, needRerun: false, reran: false, degenerateAfterRetry: false, degenerateEver: false };
  if (n === 1) {
    if (degenFlags[0]) return { done: false, needRerun: true, reran: false, degenerateAfterRetry: false, degenerateEver: true };
    return { done: true, needRerun: false, reran: false, degenerateAfterRetry: false, degenerateEver: false };
  }
  // n >= 2: the re-run has happened; never re-run again, and never exclude.
  return {
    done: true,
    needRerun: false,
    reran: true,
    degenerateAfterRetry: !!degenFlags[1],
    degenerateEver: degenFlags.some(Boolean),
  };
}

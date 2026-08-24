# D2 (`rt-inflight` / terminal `run_tests` verdict) — deployment attempted, reverted, blocked

**Date:** 2026-08-24. **Spend: ~`$0.02`** (3 smoke rollouts).
**State: reverted and verified healthy. The evidence box is unchanged from before the attempt.**

---

## 0. Verdict

**D2 is not merely "committed but not deployed". As written it breaks `run_tests` for every
harness under the production isolation policy, and the break is silent from the agent's side
— the agent simply never receives a verdict.**

| | verdict lines in trace | traces |
|---|---:|---:|
| clause screen, **before** the deploy | **78** | 78 |
| smoke, **after** the deploy | **0** | 2 |
| smoke, **after** the revert | **1** | 1 |

The failing rollouts recorded the new telemetry faithfully, which is the one good outcome:
`rtLaunched=2, rtVerdicts=0, rtNoVerdict=2, rtEndedUnverified=true`. D2's own instrumentation
detected D2's own breakage. Without it this would have looked like two agents that chose not
to run tests.

## 1. What was deployed and why it looked safe

Before the attempt the box harness differed from `main` in four files and was missing
`rt-inflight.mjs`. Every one of those four was verified to be a strict subset of `main`:
`opencode-task-runner.mjs` had exactly **1** box-only line, the pre-D2 form of a line `main`
rewrote; `codex-task-runner.mjs` had 33, all pre-D2 forms of rewritten lines; nothing was
box-unique. Backups were taken first. Preflight after the deploy was **green, 4/4 gold-FULL**.

**Preflight passing is what made this dangerous.** The env ledger validates that a gold grade
transfers under the current config; it does not execute the agent's `run_tests` shim. A live
rollout was needed and it is the only thing that caught this.

## 2. The failure

```
ERR_MODULE_NOT_FOUND: Cannot find module
  '/root/sweet-search-private/eval/task-completion-bench/harness/rt-inflight.mjs'
  imported from /tmp/sweet-search-runner-<x>/bin/_run_tests.mjs
```

The file was present on the host at that exact path, mode 644, at the time of the run.

**Why this reaches every harness, not just codex.** `agent-runner-shared.mjs` imports the shim
machinery **from `codex-task-runner.mjs`** (its line 28). Deploying the codex runner therefore
changes the `run_tests` shim for opencode and claude-code as well. The breakage was found on
an *opencode* smoke.

**The relevant shape.** The shim has two variants. The **broker requester** imports only
`node:fs` and hands the work to a broker process started outside the sandbox; the **direct**
variant imports `rt-shim-runtime.mjs` from the harness directory by absolute path. D2 adds a
second absolute-path import, `rt-inflight.mjs`, to the direct variant — explicitly to get
"the same two properties as the broker requester, without a second process".

## 3. What is established, and what is not

**Established:** the deploy broke it, the revert fixed it, and the mechanism is the newly
added absolute-path import in the direct shim variant.

**Also measured, and unreconciled:** a jail started with the production policy cannot read the
harness directory at all — a probe from inside reports `ls | wc -l` of **0**, and all five
`rt-*.mjs` modules as *not readable*, including `rt-shim-runtime.mjs`, which the working shim
imports the same way. So the simple story ("the new import is in a masked directory") does not
by itself explain why the *old* import works.

**That probe called `startJail` without the `extraBinds` and injected-file set a real
opencode rollout passes, so it may over-report blocking.** The discrepancy is not resolved
here and **must not be written up as a root cause until it is reproduced properly.**

## 4. Recommended fix direction, for whoever takes this

1. Reproduce locally against the real rollout path — the same `setupRunner` call opencode
   makes, isolation on — and settle why `rt-shim-runtime.mjs` resolves inside the jail while
   `rt-inflight.mjs` does not.
2. Prefer removing the dependency over widening the jail: the direct shim needs four constants
   and five small functions. **Inlining them into the generated shim text** — the way that shim
   already inlines everything else — removes the import entirely and is immune to whatever the
   real cause turns out to be.
3. Whatever the fix, the acceptance test is not preflight. It is **verdict lines per trace on a
   live rollout, isolation on, for each of the three harnesses.**

## 5. Consequences to carry forward

- **D2 remains undeployed.** Any codex evidence gathered before it is deployed still carries the
  yield-before-completion defect it was written to fix.
- **`rt-inflight.mjs` is not in `RT_HARNESS_FINGERPRINT`.** Its presence or absence therefore
  does not stale a ledger, so two runs on either side of this change compare as ledger-identical.
  Given that the change can silently zero out every test verdict, that gap is worth closing —
  but closing it invalidates every existing green ledger, so it is a deliberate decision, not a
  cleanup.
- **The box harness is again divergent from `main`** (4 files behind, `rt-inflight.mjs` absent).
  That is now a *deliberate* state rather than an unexplained one, and it is the only state in
  which the box runs. Backups of the pre-attempt files are at
  `/root/harness-backup-pre-D2-20260824/`.

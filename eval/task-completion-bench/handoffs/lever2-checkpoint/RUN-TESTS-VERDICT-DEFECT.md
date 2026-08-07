# run_tests verdict defect — verification pass (no fix built yet)

Date: 2026-08-07. Spend: **$0** (no model calls; box docker only).
Follows `RESULT-CHECKPOINT-ON-GREEN.md`. Data: DEV-RET Luna runs, both arms. `HO2` untouched.

Scope of this document: **verify before fixing.** Nothing in the harness was changed. The
"after" numbers below come from applying the proposed rule offline to the recorded outputs.

---

## Summary

There is not one defect. There are **three**, with different mechanisms, different directions
and different fix costs. One earlier claim needed correcting downward, and one new root cause
came with a proven repair.

| # | defect | direction | measured | status |
|---|---|---|---|---|
| 1 | a green summary line is counted as a failure signature | **false RED** | 48/330 calls (15%), symmetric 24 native / 24 sweet | root-caused |
| 2 | lowercase failure vocabulary is invisible to the extractor | **false GREEN** | ≥1/330 calls (lower bound) | root-caused, proven in-container |
| 3 | the suite cannot run at all | neither | 3 tasks, 3 different causes | one has a **proven repair** |

**Correction to the earlier headline.** `RESULT-CHECKPOINT-ON-GREEN.md` §5 reported "31% print
`status=FAIL` while `verdict=PASS`". That 31% (102/330) is real and directly observed, but it is
the *disagreement* rate, not the *mislabel* rate. Decomposed, only 48 of those 102 are provably
wrong; the other 54 have a non-zero exit with a genuine pre-existing error, where `status=FAIL`
is defensible and `verdict=PASS` is correct. **The provable mislabel rate is 15%, not 31%.**

---

## 1. Is it agent-facing, or only in logs?

**Agent-facing.** The footer is appended to the string `runTestsWithLevers` returns, the shim
writes that to stdout, and it arrives as the tool result. Confirmed against the exact
`custom_tool_call_output` bytes in the raw rollouts — this is what the model read, directly
under a banner instructing it to trust the verdict.

Verbatim, `oceanparcels__parcels-617` (defect 1):

```
XFAIL tests/test_kernel_language.py::test_print[jit] - py.test FD capturing does not work …
======================== 54 passed, 1 xfailed in 3.87s =========================
[run_tests verdict] status=FAIL scope=full exit=0
[run_tests baseline-diff] verdict=PASS introduced_failures=0 pre_existing_failures=1 trustworthy=yes … pre_existing_signatures=XFAIL%20tests%2Ftest_kernel_language.py%3A%3Atest_print%5B
```

54 passed, 1 expected-failure, exit 0 — and the agent is told `status=FAIL`, with the xfail line
recorded as its "pre-existing failure signature".

`rstudio-education__gradethis-161` is the same shape with `[ FAIL 0 | WARN 2 | SKIP 2 | PASS 498 ]`
as the signature: a line whose content is *zero failures* is what marks the suite failed.

---

## 2. Three root causes

### Defect 1 — false RED (extractor false positive)

Two shipped regexes in `harness/rt-condense-lib.mjs`:

- `FAILURE_INDICATOR_RE` contains `FAIL\b` with **no leading word boundary**, so `XFAIL` matches.
- `FAILURE_NEGATIVE_RE` guards `0 fail`, `failures?: 0`, `failed: 0` — but not the
  count-after-label orderings `FAIL 0`, `Failed : 0`, nor `0 tests failed`.

Then `classifySuiteResult` (`rt-shim-runtime.mjs`) sets `status = 'FAIL'` whenever
`sigs.size > 0`, even at exit 0; the `baselineOnly` branch rescues `verdict` to PASS. Hence two
adjacent lines that contradict each other.

Truth table against the shipped regexes:

| output line | truth | counted as a failure? | |
|---|---|---|---|
| `[ FAIL 0 \| WARN 2 \| SKIP 2 \| PASS 498 ]` | green | **yes** | wrong |
| `XFAIL tests/…::test_print[jit] - …` | green | **yes** | wrong |
| `100% tests passed, 0 tests failed out of 25` | green | **yes** | wrong |
| `FAILED tests/test_x.py::test_y - AssertionError` | red | yes | ok |
| `--- FAIL: TestThing (0.00s)` | red | yes | ok |

Decomposition of all 102 `status=FAIL`/`verdict=PASS` calls:

| bucket | calls | native | sweet | tasks |
|---|---|---|---|---|
| exit 0, only zero-failure artifacts — **proven mislabel** | **48** | 24 | 24 | redboltz, gradethis, parcels |
| exit ≠ 0 with a genuine pre-existing error — defensible | 54 | 27 | 27 | mransan, scoringutils, teleport |

`mransan__ocaml-protoc-202` was initially mis-bucketed here as "suite never ran". It does run —
the container reaches `Google unittest .... OK` — and one dune target fails on `Library "yojson"
not found`, which is genuinely absent from that task's `opam install` list. Pre-existing, present
in the baseline, so `verdict=PASS` is correct. Not a defect.

### Defect 2 — false GREEN (extractor false negative), proven in-container

Running the reconstructed `akinsho__nvim-bufferline.lua-173` intermediate patch — the state the
real evaluator scored as failing all 8 Offset pass-to-pass tests:

```
TRUE process exit code: 0
extractFailureSignatures -> 0 signature(s)
lines mentioning "fail" (any case): 15   …of which the harness counts as failures: 0
  "Fail\t||\tOffset tests: should add the offset to the correct side"   (x8)
  "Failed : \t8"
  "Tests Failed. Exit: 1"
```

Two compounding causes, either of which alone would have been caught by the other:

1. **Vocabulary.** `FAILURE_INDICATOR_RE` requires uppercase `FAIL`/`FAILED`. plenary/busted
   prints `Fail`, `Failed :`, `Tests Failed.` — none match. Same gap makes qunit-cli's
   `1561 tests of 1562 passed, 1 failed.` invisible, which is why `jashkenas__underscore-2757`
   has an untrustworthy baseline (exit 1 with zero extracted signatures).
2. **Exit-code masking.** That task's `test_cmd` is `for test_file in tests/*_spec.lua; do nvim
   … done`. A shell `for` loop exits with the *last* iteration's status, so a failing earlier
   file is discarded. This is the task's own command, not harness code.

Corpus detection is **1/330 and is a lower bound**: the in-container condenser keeps 40 promoted
failure lines plus a 45-line tail, so failure vocabulary outside that window is not in the
retained bytes at all.

### Defect 3 — the suite never runs (three different causes, one repairable)

**`dotnet__yarp-2825` — `git reset --hard HEAD` reverts install-time mutations. PROVEN, with a
proven repair.** The shipped image has three tracked files dirty, mutated by the install seds at
build time:

```
tracked files dirty in the image: M TFMs.props, M global.json, M src/Application/Yarp.Application.csproj
A: exactly what the shim does (git reset, no install steps)  -> SDK not found … EXIT=145
B: same, but with the four install seds re-applied first      -> Build succeeded … EXIT=0
```

`runSuite` opens every invocation with `git reset --hard HEAD`, which reverts them, so
`dotnet test` demands SDK `10.0.100-preview.3.25201.16` against an installed `8.0.416`. The
grader does not hit this because `sr-eval` runs with `--reapply-install-seds`. The harness
already computes exactly the needed list — `installSedCmds(spec)` in `harness/env-ledger.mjs`,
used for the config hash — the shim simply never applies it.

**`litestar-org__polyfactory-405` — not repairable in the shim.** Its `test_cmd` names
`docs/examples/configuration/test_example_8.py`, a file *created by `test_patch`*. At the base
commit pytest exits 4 with `collected 0 items`. The agent's suite can never run on this task;
that is a property of the task, not of the harness.

**`jashkenas__underscore-2757` — a real pre-existing failure the extractor cannot parse.** Base
output ends `1561 tests of 1562 passed, 1 failed.` → exit 1 with zero extracted signatures →
`getBaseline` marks the baseline untrustworthy → every call reports `trustworthy=no` with no
introduced-versus-pre-existing labelling. Fixing defect 2's vocabulary also fixes this.

---

## 3. Circularity in the exposure census — quantified

The census in `RESULT-CHECKPOINT-ON-GREEN.md` reads footer lines this defect corrupts. Precisely
how much:

- **Defect 1 does not bias it.** The census keys on `verdict`, `trustworthy` and
  `introduced_failures`, never on `status`. Defect 1 corrupts `status` only.
- **Defect 2 can bias it**, by making a falsely-green final state mask a trigger. Detected
  false-greens are 1/330 calls, so the masking bound is small — but it is a lower bound.
- **Defect 3 is the real precision limit.** 18 of 134 rollouts (yarp, polyfactory, underscore —
  6 each) never had a single trustworthy baseline, so they could not have produced a verified
  checkpoint at all; 6 more retained no footer.

Over the **110 rollouts that could have triggered**, the corrected one-sided 95% upper bound on
the trigger rate is **2.69%** (previously quoted 2.49% over 119). The no-go verdict is unchanged
and its precision improves once defect 3 is fixed, because those 18 rollouts become measurable.

---

## 4. Arm symmetry and fingerprint blast radius

**Arm-symmetric.** The shim is byte-identical in both arms; the measured false-red rate is
**6.0% native versus 6.2% sweet** (rate over all calls, both directions counted separately). This
is a shared correctness defect, not an A/B confound, so fixing it should not move the comparison
directly.

**Blast radius is maximal.** `taskConfigHash` (`harness/env-ledger.mjs`) includes
`rtHarness = RT_HARNESS_FINGERPRINT`, which hashes the bytes of exactly four files:

```
rt-condense-lib.mjs, rt-shim-runtime.mjs, rt-dedup.mjs, rt-progress-controller.mjs
```

Defects 1 and 2 live in `rt-condense-lib.mjs`. The yarp repair lives in `rt-shim-runtime.mjs`.
**Any of these fixes invalidates every ledger row for every task** — a full `env-ledger-sweep`,
not a smoke-task re-sweep, before any run's numbers are trusted (green-ledger invariant).

---

## 5. Proposed fix order — NOT built

1. **yarp-class (`rt-shim-runtime.mjs`).** Re-apply `installSedCmds(spec)` after
   `git reset --hard HEAD` in `runSuite`. Smallest change, proven repair, restores an entire task
   from "no feedback at all" to a working suite. Needs the sed list threaded into the shim config.
2. **Defect 1 (`rt-condense-lib.mjs`).** Require a leading word boundary on the FAIL tokens (kills
   `XFAIL`) and extend `FAILURE_NEGATIVE_RE` to the zero-count orderings (`FAIL 0`, `Failed : 0`,
   `0 tests failed`, `N% tests passed`). Low risk: it only ever *removes* signatures, and every
   removal is a line that reports zero failures. Projected effect: 48/330 calls (15%) go from
   `status=FAIL` to `status=PASS`, agreeing with the `verdict` line they already contradict.
3. **Defect 2 — the risky one; measure before adopting.** Making the vocabulary case-insensitive
   would also match test *names* containing "fail" (`✔ should fail gracefully`), which would
   manufacture false reds. Before adopting, count new matches across all retained outputs and
   inspect them. The exit-code-masking half cannot be fixed in the harness at all — it is the
   task's own `test_cmd`; the options are a task override or accepting it.
4. **Then** one full ledger re-sweep, then re-run `stats/checkpoint-exposure-census.mjs` on the
   corrected footers to retire the circularity caveat in §3.

Do not bundle 1–3 into a single fingerprint change: each has a different risk profile, and a
combined change makes a regression un-attributable.

---

## 6. Reproduction

All $0, from retained data plus a handful of container runs:

```bash
# corpus census, both arms, over the exact bytes the model received
node /root/verdict-defect-census.mjs luna-rotate18-run1 luna-poll-longyield-v1 \
  luna-poll-longyield-rot luna-poll-screen18 luna-smoke1

# decomposition of the status/verdict disagreement population
node /root/verdict-decompose.mjs <same runs>

# defect 2, in-container, against the reconstructed intermediate patch
node /root/classb-probe.mjs akinsho__nvim-bufferline.lua-173 \
  /root/.ckpt-recon/akinsho__nvim-bufferline.lua-173-sweet-r0-call2.json

# defect 3, the git-reset mechanism and its repair
node /root/never-ran-probe.mjs dotnet__yarp-2825 mransan__ocaml-protoc-202
```

These four scripts live on the box under `/root`. They are diagnostics for a defect that is
about to be fixed, not durable bench tooling, so they are deliberately not added to `stats/`
until the fix lands and the measurement becomes a regression test.

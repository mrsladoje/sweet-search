# c15 — mechanism verification (adversarial)

**Candidate:** "Admission flag for tasks whose test runner is unverifiable inside the jail (accenture ran `run_tests = INFRA` in every cell)". Family: benchmark validity, not a lever. Merged from R12.

## Verdict

**Refuted on mechanism; the observable survives in a corrected form.** The traces confirm that `accenture__sfmc-devtools-1974` never gave any agent a trustworthy `run_tests` verdict: 0 of 104 calls across 44 rollouts in all twelve fresh-pool runs `[M]`. But the cause the candidate names is wrong. The jail did not block a dependency install. The test suite ran to completion offline on every call, with mocha exit codes 233 and 234 (mocha exits with its failure count) `[M]`, and the grader's own logs show the same 233–234 failures `[M]`. The `INFRA` label is a false positive of the shim's network heuristic: `INFRA_ERROR_RE` in `harness/rt-condense-lib.mjs:46-47` contains the bare alternative `Could not resolve`, and the project under test prints an application log line "Could not resolve ID of asset …: structuredClone is not defined" `[M]` `[C]`. The real environment defect is a Node runtime without `structuredClone` (131 `ReferenceError` failures in the grader log) `[M]`, which the grader tolerates because its pass-to-pass set is defined on the gold run. So G18 (the jail) does not cause this item; a shim regex does. G20 (preflight) indeed does not check the shim's classification of the clean tree; that half of the register check stands. The candidate's own `$0` falsifier, run here, also fires its kill condition: systematic `INFRA` is confined to this one task in this one pool. A wider census, however, shows the real class is larger than `INFRA`: three more fresh-pool tasks (`devlooped__moq-1262`, `hotmeteor__spectator-181`, `mathnet__mathnet-numerics-1072`) never produced `trustworthy=yes` in some or all TAB cells `[M]`. The synthesis should re-book c15 as two shared-vehicle bench fixes with zero head-to-head differential: (1) tighten the shim's infra regex; (2) admit a task only if the shim's clean-baseline run is classified trustworthy. Neither trades solves for cost; neither is a sweet-versus-native lever.

Confidence that the stated mechanism is wrong: 0.9.

## 1. What the candidate claims against what the traces show

| Claim | Status | Evidence |
|---|---|---|
| `run_tests` returned `status=INFRA` in every accenture cell of every harness | **Confirmed with one correction.** 100 of 104 calls were `INFRA`; 4 calls (in 4 sweet rollouts) were `status=FAIL scope=targeted exit=7`, also `trustworthy=no`. No call in any of 44 rollouts was trustworthy. | tally below `[M]` |
| The test runner "needs network to install dependencies; under the jail run_tests returns INFRA" | **Refuted.** The suite ran offline to completion (`exit=233`/`234` = mocha failure count). The grader, same image, same lockdown, shows 14–15 passing / 233–234 failing. No `ENOTFOUND`, `EAI_AGAIN`, `Cannot find module`, or `npm ERR` in the grading logs (0 hits). | §3 `[M]` |
| The trailer "NETWORK UNAVAILABLE … dependency downloads cannot work" proves a network failure | **Refuted.** The banner is printed by `RT_CONDENSE` when the output matches `Could not resolve|Temporary failure in name resolution|Network is unreachable`. The matching lines are application log lines "Could not resolve ID of asset …: structuredClone is not defined". | §3 `[C]` `[M]` |
| G18 (jail egress) causes it | **Refuted.** The jail is not on the causal path; the shim regex is. | §3 |
| G20 (preflight) does not detect it | **Confirmed.** The env ledger records accenture as `grade FULL, f2pTot 1, p2pFails 0` on the base image with no warm and no override. Preflight checks gold grading, not the shim's classification of the clean tree. | §4 `[M]` |
| No other fresh-pool TAB task has an INFRA verdict | **Confirmed and extended** to all 12 fresh-pool and repair runs, `fixval-codex`, `fixval-opencode`, `rb-codex`, `rb-opencode`. One transient INFRA (different class) in `rb-claudecode` on `dart-lang__http-1114`. | §5 `[M]` |
| "9/18 accenture solves were blind" | **Denominator wrong.** The fresh-pool TAB cells hold 17 accenture rows, not 18 (opencode sweet rep 2 was deleted by the concurrency race, register G14); 9 of 17 resolved. With the repair pass: 10 of 20. Across all 12 runs: 21 of 44. "Blind" is correct: 0 trustworthy verdicts. | §2 `[M]` |
| All 6 blanket-guard losers have `f2pFrac=1, ranTests=true, rtNoVerdict=0` | **Confirmed.** codex sweet rep0; codex native rep0, rep1, rep2; opencode native rep1; claude-code sweet rep1. All six final messages mention `run_tests`. | §2 `[M]` |
| "opencode native 5 + sweet 4 (fp) + 5 (rp)" | **These are file counts, not rollouts.** Opencode stores each verdict twice in the retained ndjson and again in `opencode.db`. Rollouts: native 3, sweet 2 (fp TAB), sweet 3 (rp). | §2 `[M]` |
| Not a lever; zero differential | **Confirmed.** Shared shim and shared admission. | §6 |

## 2. Re-derived numbers (denominators stated)

Source: `rows.json` of the 12 runs `fp-{codex,opencode,claudecode}-{tab,none,pipe}-20260826` and `rp-oc-{tab,none,pipe}-20260827`, plus a strict-pattern tally over `agent-state/` (`/tmp/wf-slatec/c15-mechanism/tally.mjs`, subagent files excluded, pattern `\[run_tests verdict\] status=(PASS|FAIL|INFRA) scope=\w+ exit=-?\d+`).

- Accenture rollouts with rows: **44** (codex 12, opencode 20 including 9 repair rows, claude-code 12). `[M]`
- `run_tests` launches (sum of `rtLaunched`): **104**; verdicts returned: 104; `rtNoVerdict`: 0. `[M]`
- Verdict statuses, de-duplicated against `rtLaunched`: **100 `INFRA scope=full`** (exit 233 or 234), **4 `FAIL scope=targeted exit=7`**. `[M]` Raw grep counts before de-duplication were 154 + 24 INFRA lines and 6 FAIL lines, because opencode and claude-code transcripts store each tool result twice.
- Lines `trustworthy=yes` in any accenture transcript across the 12 runs: **0**. `[M]` Every baseline-diff footer reads `verdict=INFRA|FAIL introduced_failures=0 pre_existing_failures=0 trustworthy=no`.
- The 4 targeted FAIL calls sit in: `fp-codex-tab` sweet rollout `rollout-2026-08-26T22-30-34-01a04032-…` (rep 1, `rtLaunched=3`); `fp-codex-none` sweet `rollout-2026-08-27T02-45-10-01a0411b-…`; `fp-opencode-pipe` sweet session `1787776376589-3060190-63c2bf43`; `rp-oc-none` sweet session `1787862505152-1854659-9b2a5622`. All four are sweet-arm rollouts; all four verdicts were `trustworthy=no`. `[M]`
- Row-to-transcript match by `rtLaunched`: codex sweet rows 2/3/2 and native 2/3/3 match the per-file verdict counts 2/3/2 and 2/3/3 exactly; opencode and claude-code match after halving the duplicated lines. `[M]`
- Fresh-pool TAB cells (`fp-*-tab`): accenture rows 17, resolved 9 (codex sweet 1/3, native 0/3; opencode sweet 1/2, native 2/3; claude-code sweet 2/3, native 3/3). Adding `rp-oc-tab` (sweet 1/3): 20 rows, 10 resolved. `[M]`
- Blanket-guard losers (unresolved with `f2pFrac=1`) in the TAB cells: 6, as listed above; the other 4 TAB losers have `f2pFrac=0`. `[M]`
- Grader outcome class: unresolved `f2pFrac=1` rollouts show 14 passing / 16 pending / 234 failing; the resolved sweet rep 2 shows 15 passing / 233 failing. `[M]` So the recorded difference between a solve and a blanket-guard loss on this task is one previously-passing visible test that the guard breaks. `[I]` A trustworthy baseline diff would have printed `introduced_failures=1` for that class; the false INFRA zeroed it.

## 3. The actual mechanism

1. The agent's `run_tests` runs the task's suite in the task image under `--network none` (`agent-runner-shared.mjs:77`) `[C]`. The suite completes: verdict lines carry `exit=233` and `exit=234` `[M]`, mocha's convention of exiting with the number of failures.
2. The grader, same image, records the same failure mass: 234 failing on the base-like patches, 233 on the solved one, with 131 lines of `ReferenceError: structuredClone is not defined` and 3 lines of `Could not resolve ID of asset <n>: structuredClone is not defined` `[M]` (`fp-codex-tab-20260826/native/logs/accenture__sfmc-devtools-1974_log.txt`, lines 1529, 1541, 1565). Gold grades FULL because the fail-to-pass set has one test and the pass-to-pass set is whatever passes under gold `[M]` (`results/heldout-ledger-final.jsonl`: `f2pTot 1, p2pFails 0, image docker.io/swerebenchv2/accenture-sfmc-devtools:1974-775a1b0, overridden false`).
3. The shim classifies the run: `extractFailureSignatures` sets `infra = INFRA_ERROR_RE.test(text)` (`rt-condense-lib.mjs:183`) with `INFRA_ERROR_RE = /(NETWORK UNAVAILABLE|no response from test broker|\[run_tests exit=|Could not resolve|Temporary failure in name resolution|Network is unreachable|Cannot connect to the Docker daemon|docker: Error)/` (`rt-condense-lib.mjs:46-47`) `[C]`. The bare `Could not resolve` matches the application log line. `classifySuiteResult` then forces `status=INFRA` (`rt-shim-runtime.mjs:187`), `diffFailureSets` returns null on `current.infra` (`rt-condense-lib.mjs:209`), and `trustworthy` becomes `no` (`rt-shim-runtime.mjs:191`) `[C]`.
4. The clean baseline is poisoned the same way: `getBaseline` marks the baseline `ok:false` when `sig.infra` is true (`rt-shim-runtime.mjs:125-127`) `[C]`. That is why even the 4 targeted `FAIL` verdicts were `trustworthy=no`.
5. The in-container condenser (`RT_CONDENSE`, `rt-shim-runtime.mjs:45-47`) prints the banner "NETWORK UNAVAILABLE in the test container (bench lockdown): dependency downloads cannot work; do not retry or debug the harness." on the same loose pattern `[C]`. The agent is told, wrongly, that the environment is broken and not to investigate. In the sampled claude-code result (`fp-claudecode-tab … r0-2/06410609-…jsonl`, first two `run_tests` results, 95 lines each) the agent saw that banner, about 40 promoted failure lines, a 45-line tail, `status=INFRA scope=full exit=233`, and a zeroed baseline diff `[M]`.

The agent therefore had partial signal (which tests fail) but no verdict and no introduced-versus-pre-existing labeling. The candidate's consequence ("per-task resolution on accenture measures design luck") stands; its cause does not.

## 4. Preflight

`prep-warm.mjs` exists for tasks whose test-time dependency fetch dies under lockdown and gates gold FULL under `--network none` on a warmed image `[C]`. Accenture needed no warm: the ledger shows gold FULL on the base image, `overridden:false`, and `harness/task-overrides.json` on the box has no accenture entry `[M]`. Preflight (green ledger) checks that gold grades; it never runs the shim's clean-baseline classification. So a task can be gold-valid for the grader and permanently untrustworthy for the agent. This half of the candidate's register check is correct.

## 5. The `$0` falsifier, executed

Files containing `status=INFRA` per task-arm directory, all 18 runs listed in the brief (`grep -rl -a`, `/private/tmp/…/scratchpad/infra-census-files.txt`) `[M]`:

- All 12 `fp-*` and `rp-oc-*` runs: accenture only (native and sweet where present; TAB, NONE, PIPE alike).
- `fixval-codex-20260828`, `fixval-opencode-20260828`: none. `fixval-claude-code-20260828`: **no `agent-state` directory; not checkable by this method.**
- `rb-codex-20260825`, `rb-opencode-20260824`: none.
- `rb-claudecode-20260824`: one file, `dart-lang__http-1114-sweet/…/r0-1/50f8586f-…jsonl`, with 2 INFRA lines among PASS verdicts; the body starts `[run_tests exit=1]` followed by a JSON blob, the broker's docker-level failure marker `[M]`. Different class: transient broker error in one rollout of a different pool, with trustworthy PASS verdicts on the other calls of the same rollout.
- The `NETWORK UNAVAILABLE` banner appears in accenture directories only, across the same 17 checkable runs `[M]`.

The candidate's pre-registered kill condition ("drop as an admission item if INFRA is confined to this one task in this one pool") is therefore **met** for the INFRA-specific admission flag.

A wider census (files with `trustworthy=yes` versus `trustworthy=no`, per task-arm directory, subagents and `.db` excluded) over the four TAB/repair runs `[M]`:

| task | codex TAB | opencode TAB | claude-code TAB | rp-oc-tab |
|---|---|---|---|---|
| accenture__sfmc-devtools-1974 | never trustworthy, both arms | never, both arms | never, both arms | never (sweet) |
| devlooped__moq-1262 | never (sweet); native had trustworthy calls | never, both arms | never (native); sweet had some | never (sweet) |
| hotmeteor__spectator-181 | never, both arms | never, both arms | never, both arms | — |
| mathnet__mathnet-numerics-1072 | never, both arms | never, both arms | never, both arms | never (sweet) |

Status distributions in `fp-codex-tab` `[M]`: spectator 20 `FAIL scope=full exit=2`, 6 `FAIL scope=targeted exit=0`, 5 `FAIL targeted exit=1`, 3 `PASS targeted exit=0`, all 34 `trustworthy=no`; mathnet 18 `FAIL scope=full exit=141` (SIGPIPE) + 1 `exit=1`, all 19 `trustworthy=no`, yet all 6 rows resolved; moq 53 `FAIL exit=1` with 46 `trustworthy=no` and 7 `trustworthy=yes` (native arm only in this run). A control task (`absinthe-graphql__absinthe-998` native) shows 7 of 7 `trustworthy=yes`. So 4 of 22 fresh-pool tasks (18%) never gave the agent a trustworthy verdict in at least one whole TAB cell, through at least three distinct shim-side causes: false INFRA (accenture), unparseable or SIGPIPE-cut runner output (spectator, mathnet), and a flaky per-rollout baseline (moq). Two of the four (moq, spectator) are the brief's dead-everywhere tasks. I did not open these tasks further; the per-cause attribution beyond accenture is `[I]` from the exit codes and footers.

## 6. Ceiling, differential, and solves

- Head-to-head differential: **zero** by construction. The shim and admission are shared vehicles (brief rule 6). The candidate says so; confirmed.
- Solve veto: nothing runs at rollout time; no solve is traded. Removing accenture from the fresh-pool TAB runs moves native from 125/198 to 120/189 and sweet (raw `fp-*-tab` rows, before the repair pass) from 115/195 to 111/187 `[M]`; the ±6 verdict does not change. Codex without accenture: native 41/63, sweet 38/63; opencode native 39/63, sweet 35/61; claude-code native 40/63, sweet 38/63 `[M]`.
- Value: benchmark validity only. The solved accenture cells cannot be read as evidence for computed facts (c05) or anything else; 21 of 44 rollouts resolved without any trustworthy verdict.

## 7. Corrections the synthesis must adopt

1. Replace the mechanism: "the shim's `INFRA_ERROR_RE` (`rt-condense-lib.mjs:46-47`) matches the bare phrase `Could not resolve` inside the project's own log line ('Could not resolve ID of asset …: structuredClone is not defined'); the suite ran offline to completion (mocha exit 233/234), identical to the grader." Drop "test runner needs network to install dependencies" and "G18 causes it".
2. Replace "INFRA on every call" with "no trustworthy verdict on any of 104 calls in 44 rollouts; 100 INFRA (scope=full) and 4 targeted FAIL, all `trustworthy=no`".
3. Replace "9/18 solves were blind" with "9 of 17 fresh-pool TAB rows; 10 of 20 with the repair pass; 21 of 44 across all twelve runs".
4. Replace the opencode file counts (5/4/5) with rollout counts (native 3, sweet 2 fp-TAB, sweet 3 rp).
5. Re-title the item: "Tasks whose shim verdict is never trustworthy for the agent while the grader still grades" — 4 of 22 fresh-pool tasks, not 1.
6. Re-specify the fix as two shared bench fixes with zero differential: (a) tighten `INFRA_ERROR_RE` and the `RT_CONDENSE` banner pattern to anchored network-error forms (for example `Could not resolve host`, `Could not resolve '…'` from package managers) or require the absence of a completed runner summary; (b) at admission, run the shim's clean-baseline classification once in the jailed image and refuse or label tasks where it is not `trustworthy=yes`. The candidate's "run run_tests once at admission" would have caught accenture but would miss spectator, mathnet and moq unless it checks `trustworthy`, not `status`.
7. Register: file under G (measurement), next to G13 (the earlier verdict-label defect, 31% mislabels) as a second shim-classification defect, and next to G20 with the note "gold-valid for the grader, never trustworthy for the agent".
8. Kill condition outcome: the INFRA-specific admission flag is killed by its own pre-registered condition (confined to one task in one pool). The corrected `trustworthy`-based item survives.

## 8. What I could not finish

- `fixval-claude-code-20260828` has no `agent-state` directory on the box; its INFRA/trustworthy status is unverified.
- I did not run the shim's baseline on accenture to prove that a trustworthy classification would have printed `introduced_failures=1` for the blanket-guard patches; that inference (`[I]`) rests on the grader's 14-versus-15 passing counts and the shim's asymmetric diff logic.
- I did not attribute the moq, spectator and mathnet untrustworthy verdicts to exact code paths beyond exit codes and footers; the "three distinct causes" reading is `[I]`.
- The Node version inside the accenture image was not read; "runtime without `structuredClone`" is inferred from 131 `ReferenceError: structuredClone is not defined` lines `[M]` in the grader log `[I]`.

## 9. Evidence checked

Box (read-only), `/root/sweet-search-private/eval/task-completion-bench/results/`:
- `rows.json` of `fp-codex-tab-20260826`, `fp-codex-none-20260826`, `fp-codex-pipe-20260826`, `fp-opencode-tab-20260826`, `fp-opencode-none-20260826`, `fp-opencode-pipe-20260826`, `fp-claudecode-tab-20260826`, `fp-claudecode-none-20260826`, `fp-claudecode-pipe-20260826`, `rp-oc-tab-20260827`, `rp-oc-none-20260827`, `rp-oc-pipe-20260827`, `rb-claudecode-20260824` (fields `rtLaunched, rtVerdicts, rtNoVerdict, resolved, f2pFrac, gradeable, calls, costRealizedUsd, finalAssistantText`).
- Transcripts: `fp-codex-tab-20260826/agent-state/accenture__sfmc-devtools-1974-{native,sweet}/codex-home/sessions/2026/08/26/rollout-2026-08-26T22-{28-06,30-34,32-13,33-59,36-07,38-01}-*.jsonl`; `fp-opencode-tab-20260826/agent-state/accenture…-{native,sweet}/opencode-retained/session-1787754{243277,354348,473387}-…, session-17877539{72750}-…, session-1787754104890-…/attempt-1.stdout.ndjson`; `fp-claudecode-tab-20260826/agent-state/accenture…-sweet/claude-home/projects/-root--ss-eval-runs-r0-2/06410609-3d01-4f09-b69d-7e396d378a1b.jsonl` (two `run_tests` results read line-filtered) and the native sessions `1a3f1af2-…`, `a06b0e98-…`, `3c0fb1f3-…`; the NONE/PIPE and `rp-oc-*` accenture transcripts listed in `/private/tmp/…/scratchpad/verdict-tally.txt`; `rb-claudecode-20260824/agent-state/dart-lang__http-1114-sweet/…/r0-1/50f8586f-0fdf-4af9-98a6-780e474446d6.jsonl`.
- Grading logs (outcome class only, no test names copied): `fp-codex-tab-20260826/{native,sweet}/logs/accenture__sfmc-devtools-1974_log.txt`, `sweet/rep-{1,2}/logs/…`, `native/rep-{1,2}/logs/…`.
- Ledgers: `results/heldout-ledger-final.jsonl`, `results/heldout-ledger/ledger.jsonl`, `results/heldout-ledger-v3/ledger.jsonl`; `harness/task-overrides.json` (no accenture entry).
- Census: `grep -rl -a "status=INFRA"` and `"NETWORK UNAVAILABLE in the test container"` over `agent-state/` of all 18 runs; `trustworthy=yes|no` file census over the four TAB/repair runs.

Local repo (`[C]`): `eval/task-completion-bench/harness/rt-condense-lib.mjs` (lines 43-47, 180-193, 206-228), `rt-shim-runtime.mjs` (lines 36-50, 99, 117-131, 181-191, 225-260), `rt-dedup.mjs` (131-150), `rt-inflight.mjs` (170-189), `agent-runner-shared.mjs` (72-77), `run-pilot.mjs` (191, 207), `prep-warm.mjs` (1-30, 180-240), `dep-materialise.mjs` (1-60).

Scripts (scratch): `/tmp/wf-slatec/c15-mechanism/tally.mjs`, `/tmp/wf-slatec/c15-mechanism/rt-output.mjs` on the box; local copies and outputs under `/private/tmp/claude-501/-Users-admin-Projects-sweet-search-private/559eb8e8-f3c9-4891-b1d6-5f3d431e9f3f/scratchpad/` (`infra-census-files.txt`, `accenture-per-file.txt`, `verdict-tally.txt`).

Candidate source: `handoffs/improve/slate-c/candidates/resolution-computed-facts.md` §3.7, §E, §7 and the limits list; `register/DEAD-LEVER-REGISTER.md` rows G13, G18, G20; `verify/c05-mechanism.md` lines 7, 40, 64, 131, 244 (repeats the INFRA census as file counts; inherits the same mechanism error).

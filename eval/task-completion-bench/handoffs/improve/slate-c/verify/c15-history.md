# c15 — adversarial verification, HISTORY lens (2026-09-02)

**Verdict: REFUTED as a new item.** The class "a task the agent cannot verify while the grader
still grades it" is already recorded, already measured with a denominator, and already carries a
**shipped admission flag**. The flag is `excludeFromAgentRuns` in `harness/task-overrides.json`,
applied by `run-pilot.mjs` at task load. Its code comment states the candidate's class word for
word. The class was measured on 2026-08-03 across 326 `run_tests` calls, and its two known
instances were both disposed of by the two remedies c15 proposes (label at admission; drop from
agent runs). Separately, the candidate's stated **cause is wrong**: `accenture` does not fail
because its runner needs the network to install dependencies. Its suite runs, and it fails on a
missing Node built-in. The `INFRA` label is a substring false positive. What survives is one
useful fact and one register gap, both small: `accenture` is an unflagged third instance, and the
canonical register has no row for `task-overrides.json`. That is a to-do under a shipped
mechanism, not a new validity item.

Confidence that c15 is not new: **0.86**.

---

## 1. The recorded killing facts

### 1.1 A shipped admission flag for this exact class (`[C]`, decisive)

`eval/task-completion-bench/harness/run-pilot.mjs:215–226` `[C]`:

> Agent-phase exclusions: tasks whose test_cmd cannot execute against the BASE commit (it names a
> path that only test_patch creates), so run_tests returns the same error for every possible patch
> and **the agent gets no feedback at all**. The **GRADER is unaffected** — it applies test_patch
> first — so these stay gold-valid in the ledger and remain gradeable; they are simply not runnable
> as agent tasks.

That sentence is c15's class, written into product-adjacent bench code. The flag is
`excludeFromAgentRuns: true`, read at `run-pilot.mjs:219` `[C]`, and the excluded task is dropped
from the run's task list before the gate warnings and the name-lock census.

One task carries it today: `litestar-org__polyfactory-405`, with a recorded `_why` field dated
**2026-08-07** `[C]` (`harness/task-overrides.json:643`). Its reason text says the agent's
`run_tests` "gets no test feedback at all, which makes every turn-economy measurement on this task
meaningless", and that "The GRADER is unaffected … this is an agent-phase exclusion only."

c15's `register_check` says "no row records a task unverifiable for the agent while gradeable for
the grader. New validity item." That is **false against the code** `[C]`.

### 1.2 The class was measured with a denominator on 2026-08-03 (`[M]`, carried)

`TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md:904–908` `[M]`:

> across 326 `run_tests` calls, 31% print `status=FAIL` while the next line says `verdict=PASS`,
> and 18% have an untrustworthy baseline. **9/18 tasks never emit `status=PASS`**;
> `dotnet__yarp-2825` (exit 145) and `litestar-org__polyfactory-405` (exit 4) are **fully
> non-discriminative between empty, gold and broken patches**.

This is register row **G13**. It gives the class a metric ("non-discriminative between empty, gold
and broken patches"), a rate (9 of 18 tasks emit no passing status), and two named instances. Both
instances were then disposed of:

- `dotnet__yarp-2825` → hard blocklist (`harness/task-blocklist.json`, register **G8** + **G11**) `[C]`.
- `litestar-org__polyfactory-405` → `excludeFromAgentRuns` (§1.1) `[C]`.

The 2026-08-07 verdict repair (commit `2b80ee3`) then removed the `trustworthy=no` category on that
cohort entirely and moved trustworthy-baseline coverage 83% → 88% `[M carried,
TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md §26]`.

### 1.3 The offline-unrunnable class has a shipped repair vocabulary since 2026-07-07 (`[C]`)

`harness/task-overrides.json` `_doc` `[C]` — "Per-task harness overrides — bench-hygiene repairs for
env-broken tasks (2026-07-07)". Fields:

| field | documented meaning |
|---|---|
| `network: 'bridge'` | "exempts this task's containers from the egress lockdown (default under lockdown is `--network none`)" |
| `excludeP2P` | "P2P test names structurally unrunnable in ANY offline container (live network calls by design)" |
| `excludeF2P` | "F2P test names structurally unrunnable offline; removed from BOTH the pass numerator and denominator" |
| `testCmd`, `image`, `dockerRunArgs`, `testTimeoutSec` | image and command repairs |
| `excludeFromAgentRuns` | drop the task from agent runs, keep it gradeable |

**126 tasks carry an override today** `[M count over `harness/task-overrides.json`]`. The overrides
are applied by mutating the in-memory spec "so the agent-phase run_tests … AND grading … all see
the same repaired task" `[C]`, and `excludeP2P` / `excludeF2P` / `netLockdown` are inputs to
`taskConfigHash` in `harness/env-ledger.mjs:207+` `[C]`, so a change to them stales the gold
ledger. The memory note `project_harness_hygiene_2026_07_07.md` records the whole workstream as
SHIPPED at commit `a70f4d5`.

So the exact remedy c15 proposes ("flag or label such tasks at admission") exists, is
fingerprinted, and has a kill switch (`NO_TASK_OVERRIDES=1`).

### 1.4 Agent-versus-grader environment divergence is a solved, generalised defect (`[C]`)

`harness/rt-shim-runtime.mjs:64–76` `[C]` records an earlier instance of c15's exact asymmetry and
its general fix:

> the reset left `dotnet test` unable to load and every call returned exit 145 on a suite the
> grader runs green. The grader re-applies those steps via `eval.py --reapply-install-seds`;
> re-applying them here keeps the agent and the grader on ONE environment.

`harness/env-ledger.mjs:26–44` `[C]` records the mirror-image divergence (D-1): the gold sweep
passed `--reapply-install-seds` and the rollout grader did not, so "12 rows were published as
gradeable failures with zero tests executed". The response was not a new per-task flag. It was a
**fingerprint rule** that hashes the grader's own bytes, so the divergence "is impossible rather
than merely discouraged".

Two independent precedents, both closed, both generalised.

---

## 2. The candidate's own `$0` falsifier, run

c15's falsifier: "Extend the `INFRA` grep to `fp-*-none/pipe`, `fixval-*`, `rb-*` runs."
c15's kill condition: "Drop as an admission item if `INFRA` is confined to this one task in this
one pool."

I ran it, and widened it to the Epoch-A runs as well.

**Script** `[M]`: `/tmp/wf-slatec/c15-history/infra-census.sh` on the box (read-only over
`results/`; scratch under `/tmp/wf-slatec/c15-history/`). It greps `status=INFRA` under each run's
`agent-state/`, drops `/subagents/` paths, and reduces file paths to `<task>-<arm>` cells.

| run group | runs | cells scanned | cells with `INFRA` | distinct tasks |
|---|---:|---:|---:|---:|
| `fp-*-tab-20260826` (3) | 3 | 132 | 6 | 1 |
| `fp-*-none/pipe-20260826` (6) | 6 | 132 | 6 | 1 |
| `rp-oc-*-20260827` (3) | 3 | 33 | 3 | 1 |
| `fixval-*-20260828` (2 with agent-state) | 2 | 24 | 0 | 0 |
| `rb-*-2026082x` (3) | 3 | 78 | 1 | 1 |
| `sb-*-20260811` (3) | 3 | 102 | 0 | 0 |
| **total** | **20** | **501** | **16** | **2** |

`fixval-claude-code-20260828` retains no `agent-state/` directory `[M]`.

Result `[M]`:

- `accenture__sfmc-devtools-1974` carries `INFRA` in **every** fresh-pool and repair cell, all
  three harnesses, both arms, all three gutter forms — 15 cells.
- `dart-lang__http-1114` sweet in `rb-claudecode-20260824` is the only other hit — **1 cell**, and
  it is **transient**: that one transcript holds 2 `status=INFRA` against 4 `status=PASS` `[M]`.

**Reading.** As a *task property*, `INFRA` is confined to one task, so c15 meets its own kill
condition in substance. On the strict letter ("confined to this one task"), a second task appears
once, so the letter is not met. I report both, and the substance decides: a task that answers
`PASS` four times out of six is verifiable.

The `dart` cell also refutes the proposed detector. c15 says "Run `run_tests` once in the jailed
image at admission and label such tasks." A single probe that happened to land on one of `dart`'s
two transient `INFRA` calls would have labelled a verifiable task as unverifiable `[M]`.

---

## 3. The candidate's stated cause is wrong

c15's mechanism sentence: "a task whose test runner needs network to install dependencies".

**What the retained output actually shows** `[M]`, from
`results/fp-claudecode-tab-20260826/agent-state/accenture__sfmc-devtools-1974-sweet/claude-home/projects/-root--ss-eval-runs-r0-2/06410609-3d01-4f09-b69d-7e396d378a1b.jsonl`:

1. The suite **runs**. The condensed result carries 86 promoted failure lines and a 45-line tail
   holding numbered failures with real stack traces (36 numbered failure headers counted in that
   one cell) `[M]`.
2. The failure cause is `ReferenceError: structuredClone is not defined` — a missing Node built-in
   in the image. That string appears 272–2,670 times per accenture cell `[M grep over agent-state]`.
   It is a Node-version problem, not a download failure.
3. The verdict footer reads `status=INFRA scope=full exit=233` `[M]`. Exit 233 is not a network
   exit code.
4. `INFRA` is produced by a substring detector. `harness/rt-shim-runtime.mjs:46–47` `[C]` prints the
   "NETWORK UNAVAILABLE" banner when the raw suite output matches
   `Could not resolve|Temporary failure in name resolution|Network is unreachable`.
   `harness/rt-condense-lib.mjs:46–47` `[C]` then matches `NETWORK UNAVAILABLE` in the condensed
   text and sets `infra = true`; `rt-shim-runtime.mjs:187–190` `[C]` turns that into
   `status=INFRA`, `verdict=INFRA`, `trustworthy=no`, and suppresses baseline labelling.
5. The repository's **own source** prints a matching string. Every retained "Could not resolve" hit
   in accenture transcripts is the application log line `- Could not resolve ID of ${type} ${id}`
   from the repository's own `lib/` code `[M grep with 90-character context, 2–53 hits per cell]`.
   The raw `/tmp/__rt_out` is not retained, so that this same line fires the banner is `[I]`, not
   proven — but no network-failure string appears anywhere in the retained output, and the visible
   failure cause is not a download.

**Consequence.** A detector built on c15's stated cause would look for network-blocked dependency
installs. The measured condition is a suite that executes and a classifier that mislabels it. That
is register row **G13**'s defect family (verdict labelling), not a new admission family.

---

## 4. "The agent had no verification signal" is too strong

| claim | measurement |
|---|---|
| "the agent has no verification signal" | The agent receives up to 40 promoted failure lines plus a 45-line tail with named failing contexts on every call `[C RT_CONDENSE]`, and 36 numbered failures were visible in one claude cell `[M]`. It lacks a trustworthy PASS/FAIL summary and baseline labelling, not output. |
| "`run_tests` = INFRA on every call" | One codex sweet call returned `status=FAIL scope=targeted exit=7` — a real, non-`INFRA` verdict `[M rollout-2026-08-26T22-30-34-01a04032-4f6f-7b12-b5e5-190431514aaf.jsonl]`. Targeted scope escapes the classifier. Agents used it once in 133 scope-bearing verdict lines across the six TAB cells `[M`, an upper bound: claude writes ~2.46 records per request and codex echoes commands]`. |
| "9/18 accenture solves were blind" | The TAB denominator is **17**, not 18: `fp-opencode-tab-20260826` holds 5 accenture rows, not 6, because of the preflight race that deleted 18 sweet rollouts (register **G14**). Solves are **9 of 17** `[M rows.json]`. |
| "per-task resolution on accenture measures design luck" | accenture resolves in **21 of 44** rollouts across the 12 fresh-pool and repair runs (48%) `[M rows.json]`, and `f2pFrac` varies between 0 and 1 across reps. The task discriminates at the grader. |

---

## 5. Nearest register rows, and whether c15 escapes them

| register row | why it covers c15 | does c15 escape? |
|---|---|---|
| **G13** `run_tests` verdict-label defect | Same instrument, same failure mode: a status label that does not describe what the suite did. G13's own text enumerates tasks that never emit a passing status and names two as non-discriminative. | **No.** accenture is a further instance of G13, produced by the `INFRA` branch rather than the false-red branch the 2026-08-07 repair closed. |
| **G11** task-admission blocklist (SHIPPED) + `excludeFromAgentRuns` | The admission-side response to a task the agent cannot verify already exists and has been used twice. | **No.** c15 proposes to build what is deployed. |
| **G20** task preflight gates | c15 is right that G20 does not detect this. But G20 is **deliberately** metadata-only and outcome-blind, "so it is pre-registration compatible" `[C PLAN.md §6 row P6]`. It rejects on `FAIL_TO_PASS ≥ 100` or `PASS_TO_PASS == 0`. | **Partly.** "G20 does not detect it" is true and is a design choice, not an oversight. It does not make the class unrecorded. |
| **G3a/G3b** vacuity pre-screen | Precedent that an execution-derived admission screen is acceptable, and that its detector is a text marker that has already produced one measured false negative. | **No.** It shows the shape is allowed and shows the same fragility c15's one-shot probe would inherit. |
| **G8** dotnet grading-oracle task | Precedent: a task whose tests could not execute in the harness, found, then permanently blocklisted. | Partly — in G8 the grader also failed. c15's asymmetry (grader fine, agent not) is covered instead by `run-pilot.mjs`'s comment and by the yarp install-sed fix in §1.4. |
| **H2** offline egress blind spot in the jail | Same jail, same class of offline surprise; response was an offline flag that fails fast. | **No.** |

**Missing register row.** The canonical register has **no row** for `harness/task-overrides.json`
(126 tasks, `network`/`excludeP2P`/`excludeF2P`/`excludeFromAgentRuns`) `[M grep of
register/DEAD-LEVER-REGISTER.md — 0 hits for `task-overrides`, `excludeFromAgentRuns`,
`excludeP2P`]`. That omission is why c15 could believe the class was unrecorded. Adding the row is
the real deliverable here.

---

## 6. What genuinely survives

Three things, all small, none of them a new lever or a new validity item:

1. **`accenture__sfmc-devtools-1974` is an unflagged instance** of a class that already has a
   shipped flag. Nobody in the 2026-08-28 panel or in `FRESH-POOL-RESULTS.md` noticed it `[M grep
   of `handoffs/improve/` — `accenture` appears with `INFRA` only in slate-c files]`. Its
   disposition is a decision for the owner: leave it, or add an override.
2. **The `INFRA` detector is over-broad.** It fires on a substring that a repository's own log text
   can contain, and it then discards baseline labelling for a suite that ran. A `$0` narrowing —
   require the trigger string near a package-manager or resolver context, or gate the banner on a
   zero-test-executed condition — belongs under G13, and it is arm-symmetric.
3. **The register needs a `task-overrides.json` row.** Without it the next session will re-propose
   this again.

None of these change the head-to-head. `INFRA` is present in both arms of every accenture cell
`[M]`, so the differential is zero, as c15 itself concedes.

---

## 7. Corrections the synthesis must adopt

1. Delete "no row records a task unverifiable for the agent while gradeable for the grader. New
   validity item." It is refuted by `run-pilot.mjs:215–226` and by
   `task-overrides.json` `litestar-org__polyfactory-405._why` `[C]`.
2. Replace the mechanism sentence. `accenture`'s suite executes; it fails on a missing Node
   built-in (`structuredClone`), and the `INFRA` label is a substring false positive of
   `rt-shim-runtime.mjs` `RT_CONDENSE` plus `rt-condense-lib.mjs` `INFRA_ERROR_RE` `[M/C]`. Drop
   "needs network to install dependencies".
3. "9/18 accenture solves were blind" → **9 of 17** TAB solves `[M]`; the missing rollout is the
   G14 preflight-race deletion. Add that accenture resolves 21 of 44 across all 12 fresh-pool and
   repair runs `[M]`.
4. "no other fresh-pool TAB task has an INFRA verdict" is right, but state the wider census:
   16 of 501 cells over 20 runs, 2 distinct tasks, and the second (`dart-lang__http-1114` sweet in
   `rb-claudecode-20260824`) is transient at 2 `INFRA` against 4 `PASS` `[M]`.
5. Drop "the agent has no verification signal". Say instead: the agent sees the suite's failure
   lines but is told the result is untrustworthy, and one targeted call did return
   `status=FAIL scope=targeted exit=7` `[M]`.
6. Re-file the item as a **to-do under G13 and `task-overrides.json`**, verdict **DEAD as a new
   item**, with a one-line disposition question for the owner about `accenture`.
7. Add a register row: `task-overrides.json` — SHIPPED 2026-07-07 (`a70f4d5`), 126 tasks,
   per-task `network` / `excludeP2P` / `excludeF2P` / `testCmd` / `image` / `dockerRunArgs` /
   `excludeFromAgentRuns`; inputs to `taskConfigHash`; kill switches `NO_TASK_OVERRIDES=1` and
   `SS_BENCH_ALLOW_NET=1`.
8. Correct the downstream text in `candidates/DEDUP.md` c04 and `resolution-computed-facts.md`
   §"D" that reads "The container blocks dependency installs (accenture INFRA in every cell)". The
   premise is wrong here for the same reason, and `c06-history.md` already refuted the `moq`
   half by measurement (210 `run_tests` verdicts, 0 `INFRA`).

---

## 8. What I could not finish

- The raw suite output (`/tmp/__rt_out`) is not retained, so the exact line that fires the network
  banner is `[I]`, not proven. What is proven is that no network-failure string survives into the
  condensed output, that the visible failure cause is a missing Node built-in, and that the
  repository's own source prints a string matching the banner grep.
- Verdict-line counts are upper bounds. Claude writes about 2.46 records per request and codex and
  opencode echo commands into the transcript, so `status=` occurrences over-count calls.
- I did not open `accenture` grading logs and did not open HO2 per task.
- I scanned the 20 runs named in §2 only. Older runs (`bd-*`, `cf-*`, `codex-full200-*`, and the
  rest) were not censused for `INFRA`.
- I did not price the narrowing of the `INFRA` detector, and I did not check whether narrowing it
  would change any recorded verdict. Both are `$0` and out of this task's scope.

## 9. Evidence opened

Local: `slate-c/BRIEF.md`; `slate-c/DEAD-LEVER-REGISTER-DRAFT.md`;
`slate-c/register/DEAD-LEVER-REGISTER.md` §9, §11, §12;
`slate-c/candidates/resolution-computed-facts.md` §3.7, §E, §7;
`slate-c/candidates/DEDUP.md` c04/c15; `slate-c/verify/c05-history.md`; `slate-c/verify/c06-history.md`;
`TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md` §25–26; `PLAN.md` §6 row P6;
`harness/run-pilot.mjs`; `harness/task-overrides.json`; `harness/task-blocklist.json`;
`harness/rt-shim-runtime.mjs`; `harness/rt-condense-lib.mjs`; `harness/env-ledger.mjs`;
memory `project_harness_hygiene_2026_07_07.md`.

Box (read-only): `results/{fp,rp,fixval,rb,sb}-*` `agent-state/` and `rows.json`;
`results/heldout-ledger/ledger.jsonl`; `results/heldout-ledger-v3/ledger.jsonl`.
Scratch: `/tmp/wf-slatec/c15-history/infra-census.sh`, `/tmp/wf-slatec/c15-history/acc-counts.sh`.

# c06 — runtime execution-path certificate: REFUTED on differential and on measurability

**Verdict: refuted. Confidence 0.90.** Lens: differential and measurability.

The lever cannot be built sweet-only in the environment that produced every measured number,
and its solve ceiling is below the pre-registered bar on all three harnesses before any
build cost is paid. Three independent findings each kill it on their own.

1. **The execution surface it needs does not exist for the task that carries its ceiling.**
   The bench agent runs inside a jail on every measured rollout (`isolated=true`, 132/132
   codex rows, 129/129 opencode rows, 132/132 claude-code rows, 36/36 fixval codex rows
   `[M]`). The jail is a mount namespace over the box host, so the agent sees the host's
   toolchain. The host has `node v20.20.2` and **no .NET at all** (`which dotnet` → absent,
   `which mono` → absent, no `/usr/share/dotnet` or `/usr/lib/dotnet`) `[M]`. `moq-1262` is a
   C# task. A sweet-only tool therefore has no way to execute any C# on the measured box.
2. **The only route into the test container is a shared, parameter-free channel, and
   parameterising it re-opens a closed contamination vector.** Under the jail "there is no
   docker socket and no docker client, so every harness now goes through the host-side
   broker: run_tests takes no arguments, so the agent cannot pass docker args at all"
   `[C harness/agent-runner-shared.mjs:8-15]`. The same comment records why: direct container
   reach "IS escape vector V5 — the task images carry the fix commit, and the forensics
   caught `git show <fix-sha>` and `docker cp` of an image tree being used to write the gold
   patch". Any probe that runs a command of its choosing inside the test container must
   extend that broker. Extending the broker reaches **both arms** (brief rule 6, zero
   head-to-head differential) and re-opens the exact channel through which reference-patch
   content leaked (brief rule 10).
3. **The ceiling is below the bar on every harness by construction.** See §2.

---

## 1. What the candidate gets right

- **Admissible class, not a banned re-render.** A runtime call path is a fact that exists in
  no file in the corpus. It changes which content reaches the model, not how existing lines
  are rendered. It is not `B7` "render the same lines smaller".
- **Flags are correct.** `new_tool: true` and `needs_user_decision: true` match owner rule 11.
- **No HO2 use, no ranking-signal change.** Nothing here touches retrieval scoring, so the
  `_isAgentFormat` gate in the repo `CLAUDE.md` does not apply.
- **The counts it cites are real.** 13 of 16 losing `moq` cells changed one comparison path
  and 18 of 18 `markup-it` cells ran a parse-only reproduction `[M forensics/wrongfix-facts.md
  §2.3, §2.6]`.
- **The JS half has a sweet-only surface.** `node` is on the host, and agents already execute
  JavaScript in the jail: `markup-it` codex cells show `./node_modules/.bin/mocha` (2 sweet,
  3 native) and `node -e` (2 native) `[M grep over fp-codex-tab-20260826/agent-state]`.

## 2. Measurability: the ceiling cannot clear the bar

The pre-registered superiority bar is **per harness**: "A superiority claim requires ≥ +6
rollouts of 75" `[FRESH-ROTATION-PREREGISTRATION.md §3]`, amended to 22 tasks × 3 reps = 66
per cell. It is not a pooled bar across harnesses.

Measured solve state in the production TAB runs `[M rows.json, script
/tmp/wf-slatec/c06-meas/count.mjs on the box]`:

| task | codex sweet | opencode sweet | claude-code sweet | codex native |
|---|---|---|---|---|
| `devlooped__moq-1262` | 1/3 solved (rep 2) | 0/3 | 0/3 | 1/3 (rep 1) |
| `gitbookio__markup-it-56` | 0/3 | 0/3 | 0/3 | 0/3 |

Sweet losing rollouts reachable by the lever: `moq` 2 (codex) + 3 (opencode) + 3
(claude-code) = 8 of 198. `markup-it` adds 9 more, but the candidate itself states its
runtime fact is "necessary but not sufficient" and worth **0 solves alone**, because the
deciding fact for that task is not derivable from the runtime.

**Per-harness ceiling at a 100% flip of every reachable cell: +2/66 codex, +3/66 opencode,
+3/66 claude-code.** The bar is +6/66. The ceiling is 33% of the bar on codex and 50% on the
other two. At the rate the candidate itself proposes (the hint ladder's runtime fact,
`codeception` 2/4 = 50%) it is +1, +1.5, +1.5 `[I]`.

The candidate's "+8 sweet cells … the only face that could reach the ±6 bar" silently pools
three harnesses. Pooling is not the pre-registered test, and the pooled figure still needs a
second task that does not exist in this pool.

**One task carries 100% of the ceiling.** That is the failure mode that parked `F3`
(state-space checker: passes, but its shape fires on 1 file in 152,270).

## 3. Cost: the lever moves the wrong way, and the move is certain

Measured price of one request `[M rows.json: mean `costRealizedUsd` ÷ mean `idealTurns`,
script /tmp/wf-slatec/c06-meas/price.mjs]`:

| harness | sweet mean $/rollout | mean requests | $/request | one request as % of a rollout |
|---|---:|---:|---:|---:|
| codex | 0.012330 | 19.61 | 0.000629 | 5.1% |
| opencode | 0.009201 | 18.98 | 0.000485 | 5.3% |
| claude-code | 0.015127 (excl. sidechain) | 21.56 | 0.000702 | 4.6% |

The candidate wants the probe to fire wherever a runnable snippet exists — 11 of 22 tasks by
its own heuristic. One probe request on the rollouts of 11 of 22 tasks (33 of 66) raises the
arm's mean cost by about **+2.6% on each harness** `[I from the table]`, before the trace
output's own tokens, which are then re-sent 15–20× per rollout `[BRIEF §1.1]`, and before any
extra work the fact provokes.

The programme's goal is to close a gap of +0.3% (codex), +3.3% (opencode), −3.9%
(claude-code). A sure +2.6% moves two of three harnesses further from parity in exchange for
a solve gain that cannot be detected.

For completeness, the cost side is not detectable either: the arm-mean cost standard error at
n=66 is 8.8% (codex sweet), 10.6% (opencode sweet), 9.9% (claude-code sweet) `[M script
/tmp/wf-slatec/c06-meas/sem.mjs]`. So the lever is a certain expense inside the noise band
paired with an undetectable benefit.

## 4. The `$0` falsifier is mis-aimed and cannot fire on the failure that matters

As written: "Check whether the `moq` and `markup-it` goldens build and execute their
reproduction offline in the bench container image. Kill if fewer than half of the C#/JS tasks
with a fenced reproduction can execute it offline."

Four defects.

1. **Half of it is already answered by recorded data.** Every `moq` and `markup-it` rollout
   has `ranTests=true` and `rtNoVerdict=0` (one exception: codex sweet rep 2, `rtNoVerdict=1`)
   `[M rows.json]`, and `accenture` is the only fresh-pool task with an `INFRA` verdict
   `[M candidates/resolution-computed-facts.md §3.7]`. Both goldens' own suites therefore build
   and run offline. The question that was open — whether a **new** snippet compiles without a
   package restore — is a different question and the falsifier does not name it.
2. **It measures the wrong surface.** The lever dies in the jail, not in the container. The
   check must ask whether a sweet-only process can execute anything at all for the task's
   language: `node` yes, `dotnet` no `[M]`.
3. **The kill condition passes while the lever is dead.** The pool has 22 tasks: 3 C#
   (`asynkron__protoactor-dotnet-1909`, `devlooped__moq-1262`, `mathnet__mathnet-numerics-1072`)
   and 8 JS/TS `[M from `preds-native.jsonl` patch extensions]`. At most 11 tasks are in scope,
   8 of them JS/TS with a working host runtime. "Fewer than half" would report 8 of 11 = pass,
   while the one task carrying the ceiling has no execution surface. A kill condition that
   passes on a dead lever is not a gate.
4. **It is not runnable at $0 today.** The box holds 3 docker images and none is a fresh-pool
   golden `[M docker images on 167.233.69.121]`, confirming the recorded "goldens evaporate"
   defect. Even the corrected check needs a multi-gigabyte image re-materialisation first.

## 5. Register: the nearest row is not the one cited

The candidate's register check names F5, E10, F6. It omits the closest row, **F13 / research
lever L7**: "Reproduce, then diagnose at runtime, then fix **[SHARED unless built as a tool]**"
`[harness-gutter-cost-20260828/07-research-resolution-levers.md:485-495]`. That row already
carries this candidate's disposition and its counter-evidence:

- "If re-opened at all, it must be an `ss-*` runtime service that returns a diagnosis, **which
  is L2 wearing different clothes**." L2 is register **E10**, DEAD live: re-derivations 0 →
  1.33 per rollout, calls 6.8 → 12.5, **cost +79%**.
- "SWE-Doctor's own preliminary study says naive reproduction-test guidance is neutral to
  negative" `[W https://arxiv.org/abs/2607.00990, abstract-only]`.

c06 is genuinely a different *face* (which implementation runs, not a verdict, no context
reset), so it is not a duplicate. But the synthesis must carry L7's disposition sentence and
E10's +79% cost result, not only F5's.

## 6. Evidence-tagging correction

The candidate tags its central premise `[M wrongfix-facts]`. The source itself disagrees:
"The `moq` consumer-dispatch claim (§2.6) is read from the base code and the two winners'
diffs `[C][I]`; it was **not confirmed with a runtime trace** ($0 rule: no rollouts, and no
.NET build was run on the box)" `[forensics/wrongfix-facts.md §7]`. What is measured is which
code each losing cell changed; that a runtime trace would print the discriminating path is
inferred. No one has ever run the trace this lever is built on.

Two further measured facts bear on the premise. 18 of 18 `moq` cells already had the deciding
site in their transcripts and the report's own conclusion is "evidence present, choice not
forced" `[M §2.6]`. And no cell in any harness ever invoked an ad-hoc .NET build: 0 hits for
`dotnet build|run|new|add|restore`, `csc`, `dotnet script` across all 18 `moq` cells in the
three TAB runs `[M grep over agent-state]`.

## 7. A solve risk the candidate does not list

The authoritative patch is the working-tree diff: "Authoritative patch from `git diff` (counts
edits even if not visible as tool calls)" `[C harness/agent-runner-shared.mjs:260]`. Because
no .NET profiler is available, the only offline C# tracing route is source instrumentation.
A tracer that writes instrumentation into the repository and fails to revert it cleanly puts
its own lines into the graded patch. That is a solve-losing failure, not the "one wasted
request" the candidate lists.

## 8. Corrections the synthesis must adopt

1. Ceiling is per harness: **+2/66 codex, +3/66 opencode, +3/66 claude-code** at a 100% flip,
   against a **+6/66** bar. Delete "the only face that could reach the ±6 bar".
2. `markup-it` contributes **0**; the whole ceiling rests on **one** task.
3. Retag: counts `[M]`, the "non-deciding path" causal claim `[C][I]`, never trace-confirmed.
4. Replace the falsifier with the two checks in §4.2 and give it a real number: kill unless the
   tasks with a sweet-only execution surface cover **≥6 unsolved sweet rollouts on a single
   harness**. On this pool that is already false: `dotnet` absent → the C# tasks contribute 0,
   and the JS tasks' runtime fact is conceded to be worth 0 solves.
5. State the vehicle honestly in three parts: the wrapper and rendering are sweet-only; the
   test-container channel is **shared and parameter-free by design**; installing a .NET
   toolchain on the host would be a **shared** environment change that also voids
   cross-run comparability.
6. Add the patch-pollution solve risk (§7) and the +2.6% expected cost (§3).
7. Cite F13 / L7 as the nearest register row and carry E10's +79%.

## 9. What I could not finish

- I did not test whether an ad-hoc C# snippet compiles offline inside the `moq` image, because
  no fresh-pool golden image is on the box and pulling one is not a $0 step.
- I did not measure how large a tracer's output would be, so the re-send component of §3 is an
  order of magnitude, not a figure.
- I read no grading logs; loss classes here are taken from the wrongfix report's abstract
  descriptions only.
- The claude-code $/request uses `costRealizedUsd`, which excludes sidechain spend
  (`costSidechainUsd` is 0 in these rows; repricing is a separate step). With the brief's
  sidechain-inclusive $0.020727 and 24.58 total turns the figure is $0.000843/request, i.e.
  4.1% of a rollout — the conclusion does not change.

## 10. Evidence opened

- `handoffs/improve/slate-c/BRIEF.md`, `DEAD-LEVER-REGISTER-DRAFT.md`
- `handoffs/improve/slate-c/candidates/resolution-computed-facts.md` §3.5–3.8, §6-D, §7, §8
- `handoffs/improve/slate-c/forensics/wrongfix-facts.md` §2.3, §2.6, §5, §7
- `handoffs/improve/W0-P6-GATE-RESULTS.md` §0–2
- `handoffs/improve/FRESH-ROTATION-PREREGISTRATION.md` §3
- `handoffs/improve/harness-gutter-cost-20260828/07-research-resolution-levers.md:475-500`
- `eval/task-completion-bench/harness/agent-runner-shared.mjs:1-25, 72-80, 125-170, 260`
- Box, read-only: `results/fp-{codex,opencode,claudecode}-{tab,none,pipe}-20260826/rows.json`,
  `results/rp-oc-*-20260827/rows.json`, `results/fixval-codex-20260828/rows.json`,
  `results/fp-codex-tab-20260826/{preds-native.jsonl,agent-state/devlooped__moq-1262-*,
  agent-state/gitbookio__markup-it-56-*}`
- Box scratch (mine): `/tmp/wf-slatec/c06-meas/{count,moqrows,price,sem,iso,pool2,cc}.mjs`
- Box environment: `which dotnet` (absent), `which mono` (absent), `node -v` (v20.20.2),
  `docker images` (3, none a fresh-pool golden)

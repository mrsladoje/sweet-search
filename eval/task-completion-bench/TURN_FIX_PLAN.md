# TURN_FIX_PLAN — run-ready turn-economics program (revision 2, 2026-07-31)

This is the execution contract for reducing model turns and cost without buying the reduction by
losing task completion or retrieval quality. It supersedes the first synthesis of the three reviews
(Claude Fable 5, GPT-5.6 Sol / Codex, and Kimi K3 Max). The companion
`EDIT_THRASHING.md` owns completion-tail control; this document owns structured call packing,
experiment sequencing, and the final comparison.

**Current status:** ready to implement and preflight; not authorization to spend or to touch the new
frozen held-out set. Every paid stage still requires its stated gate and explicit launch approval.

## 0. Dataset policy — explicit reclassification

As of 2026-07-31, the former held-out-200 set is **retired and reclassified as development data**:

| handle | artifact | permitted use |
|---|---|---|
| `DEV-RET` | retired 200 (`select/tasks_heldout.jsonl` and its retained trajectories) | unrestricted inspection, replay, threshold fitting, task selection, and live development experiments |
| `DEV-OLD` | original dev corpus (`select/tasks_multilingual.jsonl`) | unrestricted development use; report separately because it has been iterated on heavily |
| `HO2` | new frozen set (`select/tasks_heldout2.jsonl`) | aggregate-only milestone evaluation after the complete treatment is frozen; never tune from its tasks or trajectories |

This deliberately removes unnecessary discipline around `DEV-RET`: use all of its trajectories and
failure cases. Two qualifications still matter:

1. Its historical run used the pre-offline frame and contains refused-fetch and control-contamination
   behavior. It is excellent behavioral development data, but its historical cost and solve totals
   are **not a current baseline**.
2. Any result selected, fitted, or debugged on `DEV-RET`/`DEV-OLD` is a development result. Only
   `HO2` can support the final untouched-set claim.

Task lists used by a stage must be materialized before the run, hashed, and recorded. Tail-enriched
development samples must report both stratum results and a population-weighted estimate.

## 1. Corrected problem statement and established evidence

Operation-level accounting of the retired run (`TURN-ECONOMY-2026-07-30.md:350-364`):

| arm | turns | envelopes | operations | ops/envelope | envelopes/turn | operations/turn |
|---|---:|---:|---:|---:|---:|---:|
| native | 5,003 | 9,248 | 9,419 | 1.02 | 1.848 | 1.883 |
| sweet | 5,908 | 7,009 | 10,193 | 1.45 | 1.186 | 1.725 |
| sweet vs native | +18.1% | — | +8.2% | — | −35.8% | **−8.4%** |

Consequences:

- About 77% of the motivating envelope-density gap was packaging. The useful density headroom is
  real but bounded: matching native's 1.883 operations/turn would reduce Sweet from 5,908 to about
  5,414 turns, an **8.4% perfect-density ceiling** before second-order behavioral effects.
- Sweet also performed 8.2% more retrieval/test operations. Packing cannot remove that part.
- The greedy opportunity classes (797 collapsible turns, 551 adjacent search→read candidates, 292
  edit→test candidates, and 38 adjacent single-`ss` turns) overlap and are not an additive partition.
  Never subtract them as if they were disjoint.
- The 551 search→read candidates must be classified: some reads had arguments known before search
  and are client-packable; truly result-dependent reads require a later turn or server-side fusion.
- Eight retired tasks contributed +$16.70, 107.2% of the historical cost gap. Tail control is the
  larger lever; structured packing is the repeatable secondary lever.

The Stage-1 timing hypothesis is closed. Re-analysis of the retained read-only trajectories gives
approximately 92% of control retrieval before first edit versus 75% for the variant, and 10 versus
30 post-edit retrieval operations. The variant did **more**, not less, repair-phase retrieval. The
packing prompt did not starve repair; it was inert on packing and coincided with completion thrash.

The identifier-warning incidence is also re-derived from the retained stores: the warning appeared
in **8 of 14** Stage-1 rollouts. In variant `thelounge`, all six `run_tests` invocations were piped
through `tail`, preserving the false warning while losing leading authority/baseline context. The
harness repair is Phase 0 in `EDIT_THRASHING.md`.

## 2. Non-negotiable success contract

The program optimizes two separate quantities and may not trade one away silently:

1. **Completion:** solve rate and treatment-only solve losses.
2. **Economics:** turns, input re-sends, and realized cost per assigned task.

The final candidate advances to `HO2` only if the fresh development confirmation satisfies all of
the following:

- one-sided 95% lower confidence bound for paired solve-rate difference is above **−5 percentage
  points**;
- every treatment-only loss has a dev trajectory adjudication; no recurring treatment-caused
  failure mode remains open;
- the untrimmed assigned-task cost ratio, `sum(treatment cost) / sum(control cost)`, is at most
  **0.85**, and its one-sided 95% paired-bootstrap upper confidence bound is below 1.00;
- total executed-operation ratio upper bound is at most 1.05. A retrieval-operation ratio below
  0.85 triggers a retrieval-equivalence audit; reducing redundant test executions is allowed when
  final canonical validation and completion gates pass;
- context tokens per model turn ratio upper bound is at most 1.10;
- retrieval target recall and useful-evidence coverage pass §4.2; and
- no dependency-order violation, guessed argument, hidden operation failure, or non-boolean grader
  result is admitted.

An economically positive result that misses the 15% point target may be retained as an incremental
product improvement, but it does not support the intended “beat native by a wide margin” claim.

Cost per assigned task and solve rate are co-primary. Cost per correct solve is secondary because it
can obscure which tasks were dropped. Always also report both-solved cost, treatment-only/control-
only solve counts, p50/p75/p90 turns, and the top-tail contribution.

## 3. Surface and arm rules

| surface | examples | rule |
|---|---|---|
| **Product** | MCP tools, `search_batch`, CLI mirror, result format, server-side span fusion | Sweet only; this is the retrieval-product treatment |
| **Harness** | warning repair, telemetry, checkpoint retention, countdown, quota, syntax gate | byte-identical policy and numeric budget on native and Sweet in headline comparisons |
| **Prompt/tool description** | dependency guard, phase-scoped width, batch-tool description | minimal and versioned; do not change frozen production M± until a mechanism wins |

Harness symmetry means the same implementation, trigger definitions, numeric turn/test budgets,
and footer text. A pooled development baseline determines shared numeric budgets; do not give each
search arm a different cap.

## 4. Product mechanism

### 4.1 First test the structured surface that already exists

`mcp/server.js` already registers structured `search`, `trace`, and batched `read` tools. Before
building another interface, prove against pinned OpenCode 1.18.4 that:

- MCP/custom tools load in the jailed run and appear in the model's tool schema;
- two or three independent MCP calls emitted in one assistant message remain one model turn;
- results retain per-call identity, status, and errors;
- schema plus resident-description tokens do not erase the saved re-send cost; and
- result JSON is no wider than equivalent CLI output after normalization.

If existing MCP parallel calls meet the mechanism gates in §7, they are the preferred minimal
change. Do not build `ss-batch` merely because it was proposed.

### 4.2 If needed, build one typed `search_batch` primitive

If MCP adoption remains serial, add a structured batch tool and a CLI mirror only where production
clients require it. The public request is typed and boundary-validated:

```text
search_batch({
  operations: [
    { id: "imports", tool: "grep", args: { pattern: "...", in: "..." } },
    { id: "caller",  tool: "trace", args: { symbol: "..." } }
  ]
})
```

Contract:

- exactly 2–3 independent, read-only operations;
- allowlisted operations only: search, grep, find, read, semantic, trace;
- sanitize and validate every file path and argument before dispatch;
- execute siblings concurrently where the underlying adapters are concurrency-safe;
- preserve labeled per-operation `ok | no_match | error | truncated` status and never let one
  failure suppress a sibling;
- deduplicate overlapping file spans after retrieval, not before ranking;
- provide a non-zero per-operation output floor, a shared maximum, and explicit truncation metadata;
- count and emit the declared operation count directly; and
- reject placeholders or references to another operation's unavailable result.

There is **no hard-coded 1.5× output budget**. Determine the smallest shared budget that passes the
offline retrieval-equivalence gate below. “Fewer turns” is not a win if one operation is starved.

Offline equivalence gate on development retrieval queries:

- compare the batch result with the union of the same serial operations;
- target-file and target-function Recall@k lose at most 1 percentage point, with the predeclared
  paired interval meeting that margin;
- every serially surfaced task-relevant span is either present or explicitly reported truncated;
- p95 result tokens do not exceed the serial union; and
- result tokens per operation and duplicate-span rate improve or remain flat.

### 4.3 Classify natural batching opportunities honestly

Use two denominators:

1. **Synthetic capability set:** prompts with two or three explicitly independent probes and traps
   containing a dependent call. Eligibility is known by construction.
2. **Natural development trajectories:** an opportunity is eligible only when all arguments were
   knowable before the message. If a later argument contains a path/symbol learned from a prior
   result, it is dependent. Report uncertain cases separately; do not force them into the denominator.

The ≥90% compliance gate applies only to the synthetic capability set. Natural opportunity capture
is reported with its denominator and uncertainty; it is not assigned an invented 90% target.

### 4.4 Server-side collapse of dependent search→read

For genuinely dependent pairs, test an explicit `include_top_span`/sufficiency mode rather than a
hidden unconditional auto-read. It may return the top hit's complete owning symbol when calibrated
sufficiency is high. It must retain ordinary compact output when uncertain and pass the same recall
and width gates. First replay all 551 retired candidates against the current Sweet version to measure
how many are already eliminated by shipped within-file affordances.

### 4.5 Prompt residue only after a structural winner

If a reminder remains necessary:

- orientation: at most three independent retrieval calls in one message or one `search_batch`;
- refinement: at most two;
- after first edit: default one, unless a genuinely independent diagnostic set exists;
- a call needing another result goes later; and
- no “never run an unplanned probe” prohibition.

W&D used a user message inserted before every model call. A memory-file paragraph, an `ss` trailer,
and a `run_tests` footer are not equivalent. The preferred implementation candidate is a
benchmark-local OpenCode plugin, loaded only through the generated per-run config. The transport
code and controller/countdown payload must be byte-identical in both arms. A packing-nudge payload
is either generic and symmetric, or an explicitly labeled product-treatment cell; it cannot be
quietly mixed into the headline controller contrast. On the current V2 API, the plugin registers
`ctx.session.hook("request")` and appends exactly one
ephemeral user-role reminder to the mutable request messages immediately before model dispatch. It
must log session ID, model-step index, reminder hash, remaining budget, and whether the immediately
preceding observation was an environment result. `tool.execute.after` does not qualify: it is not a
model-request injection point.

This V2 plugin surface is beta and is **not assumed to exist in pinned OpenCode 1.18.4**. Before a
paid call, an isolated request-capture fixture must prove all of the following on the exact pinned
binary and dependency versions:

- the explicitly configured plugin is the one loaded, with no ambient project/global plugin;
- the reminder is present exactly once in every eligible outbound model request;
- it is not cumulatively duplicated in persisted conversation history;
- hook records reconcile with OpenCode model-step records; and
- coverage is at least 99% of eligible post-observation decisions in each arm.

Hash and retain the plugin, generated config, request-capture evidence, and coverage report. If the
request hook is unavailable or any invariant fails, the per-turn arm is **NO-GO**; test the
structural tool without claiming a per-turn treatment. Do not silently patch or upgrade OpenCode as
part of that arm.

## 5. Phase 0 — correctness fixes and maximal $0 development replay

Complete before any fresh model run:

1. Apply and test `EDIT_THRASHING.md` Phase 0 warning/footer fix.
2. Add a meter fixture asserting that `stats/probe-count.mjs` reports the exact rollout sample
   count as well as the expected per-arm operations; sample-count drift blocks a stage.
3. Make the operation splitter the canonical retrieval-and-test counter and add explicit counts for
   retrieval envelopes, test envelopes, edit envelopes, and model turns.
4. Unify stats CLI inputs so all stages accept explicit result paths plus an expected-pair count.
5. Reproduce the Stage-1 timing, warning incidence, and `thelounge` sequence from retained DBs and
   record the exact classifier alongside the numbers.
6. Replay all `DEV-RET`, `DEV-OLD`, and Stage-1 trajectories for:
   - eligible independent-call opportunities;
   - result-dependent search→read pairs;
   - result tokens per operation;
   - edit/test cycle state and checkpoint candidates; and
   - candidate p50/p75 turn and test-run budgets, stratified by pre-frame/post-frame era.

Canonical retained inputs are the retired run handle
`heldout200-grok45-opencode-p7fs-{c1,c2rest}-20260726` and Stage-1 handles
`te-s1-{control,variant}-20260731` under the results directory recorded in
`TURN-ECONOMY-HANDOFF.md`. Open DB/WAL copies read-only; never operate on the retained originals.

`DEV-RET` may be used fully, including per-task inspection and threshold fitting. Use task-level
five-fold cross-validation for controller thresholds so a rule is not scored only on the same tasks
that selected it. Keep pre-frame and post-frame estimates separate.

Phase-0 exit gate:

- focused harness/stats tests green;
- exact task/arm admissions reject `resolved:null`;
- no warning can replace authority or render after the final three-line footer;
- replay report contains denominators, classifier version, and fold assignment; and
- proposed thresholds are derived from development data only (`HO2` untouched).

## 6. Phase 1 — fresh post-fix development baseline

This phase now precedes every natural-task mechanism experiment.

1. Re-sweep goldens after the harness config hash changes.
2. Before selection, define the historical tail as the top 20% of `DEV-RET` by
   `max(nativeTurns, sweetTurns)` in the retired run. This is a symmetric pre-treatment task
   characteristic for all new experiments. If one historical arm is invalid, use the valid arm; if
   both are invalid, place the task in an `unknown` stratum and allocate it explicitly rather than
   silently dropping it.
3. From `DEV-RET`, materialize and hash with fixed seed `20260731`:
   - `DISCOVERY-20`: 10 tail plus 10 non-tail tasks, with proportional language allocation by
     largest remainder inside each stratum; and
   - `CONFIRM-60`: 12 tail plus 48 non-tail tasks, disjoint from discovery, preserving the 20/80
     population ratio and proportional language allocation by largest remainder.
   Within a stratum/language cell, seeded order determines selection and replacement order. Replace
   a failed golden only before any arm outcome, with the next task from the same cell; if exhausted,
   follow a prewritten largest-remainder fallback and record it.
4. Exclude no task because a proposed treatment historically did badly on it. Selection rules and
   weights are frozen before new outcomes.
5. Run the status-quo native and Sweet surfaces on `DISCOVERY-20` under the repaired offline frame.
   This supplies the provisional pooled turn/test distributions and current variance.
6. Calculate prospective sample size for paired cost and solve non-inferiority before confirmation.
   `CONFIRM-60` is the minimum solve-safety cohort, not an automatic maximum; expand from remaining
   `DEV-RET` tasks if the predeclared calculation requires it. Expansion preserves the frozen 20/80
   tail ratio, language allocation, and seeded order. Materialize the full `CONFIRM-N` before any
   confirmation outcome; do not repeatedly peek and stop when significance appears. If the required
   `N` exceeds the eligible remainder of `DEV-RET`, stop and redesign the development study—do not
   borrow tasks from `HO2`.

Use a shared pooled p50/p75 for symmetric harness budgets. Choose the upper bootstrap confidence
limit for the provisional p75 when a small baseline makes the quantile uncertain.

## 7. Phase 2 — packing mechanism screen

Run sequentially so each result answers one question:

### Phase 2A. No-model and synthetic checks

- MCP loading/schema preflight;
- batch fixtures and retrieval-equivalence replay;
- exactly 12 synthetic scenarios, paired across surfaces: four with two independent calls, four
  with three independent calls, and four dependency traps whose later arguments are unknowable;
- ≥90% eligible packing (therefore 8/8 on this screen), zero dependency-trap violations, zero
  hidden sibling errors; and
- operations upper ratio ≤1.05, result tokens ≤ serial union.

### Phase 2B. Natural-task adoption on `DISCOVERY-20`

Compare status-quo Sweet against the best structured candidate. Do not vary the prompt and tool
surface in the same contrast. If a per-turn reminder is tested, use a separate cell.

Advance only if:

- operations/retrieval-envelope and operations/model-turn improve in the intended direction;
- total operations upper ratio ≤1.05;
- context/turn upper ratio ≤1.10;
- retrieval-equivalence and completion tripwires pass; and
- any treatment-only solve loss is explained on dev and does not reveal a recurring mechanism.

This is a mechanism/adoption screen, not a solve-parity claim. A small n can show whether calls were
packed; it cannot establish non-inferiority.

## 8. Phase 3 — completion-tail intervention screen

Execute the companion plan in independent components:

1. telemetry/checkpoint retention with no behavioral footer;
2. advisory progress footer;
3. true per-turn countdown plus dynamic p50→p75 extension;
4. test quota only if baseline data justifies a separate experiment; and
5. combined controller only after its components pass independently.

Every component is arm-symmetric. Do not label a bundle “the controller” until its exact enabled
flags, thresholds, reminder text, and checkpoint behavior are frozen.

After individual screens, run a `DISCOVERY-20` 2×2:

| factor | levels |
|---|---|
| search surface | native / winning Sweet structured surface |
| controller | OFF / winning symmetric controller ON |

This estimates interaction. The headline candidates are native+controller and Sweet+controller;
the OFF cells diagnose how much each structural change contributed.

## 9. Phase 4 — fresh development confirmation

Freeze code, schemas, prompts, thresholds, task list, and config hashes. Run the two headline arms
(native+controller and Sweet+controller) on `CONFIRM-60`, expanding only according to the
predeclared sample-size rule. Do not change the treatment after seeing confirmation outcomes; a
change returns to Phase 2/3 discovery.

Statistics, fixed before the first confirmation outcome:

- solve: paired risk difference with a one-sided 95% non-inferiority interval (margin −5pp), plus
  treatment-only and control-only loss counts;
- primary cost: untrimmed ratio of summed assigned-task costs, with a task-paired percentile
  bootstrap (50,000 resamples, seed `20260731`) and a one-sided 95% upper bound. This retains, rather
  than trims away, the expensive tails the intervention is designed to remove;
- turns/operations/context: corresponding untrimmed ratios of sums and paired-bootstrap intervals;
  paired task log-ratios, medians, and geometric means are secondary distribution diagnostics;
- tails: p75/p90 and top-five contribution, reported separately rather than deleted;
- enriched discovery results: stratum-specific and population-weighted; and
- strict admission: exact pairs only, boolean `resolved` only, no aggregate rows or infra failures
  silently scored as losses.

With zero treatment-only losses, 60 tasks put the one-sided 95% upper bound on the gross loss rate
below approximately 5%. If losses occur, use the predeclared paired interval and expand if required;
do not claim that 12–20 pairs prove completion retention.

## 10. Phase 5 — new frozen held-out milestone

Only after Phase 4 passes:

- write and hash the final preregistration;
- run only the two frozen headline arms on `HO2`;
- inspect aggregate metrics only until the verdict is recorded;
- apply the same solve, cost, width, operation, and integrity gates; and
- never tune the treatment from `HO2`. A failure returns to development with a principle-level
  change and a future untouched set, not per-query repair of `HO2`.

## 11. Implementation and preflight ledger

Before any paid stage, report:

- exact commit/worktree diff and hashes for harness, prompt, MCP schemas, native binary, stats code,
  task list, request-hook plugin, and generated config;
- enabled feature flags for each arm;
- OpenCode/model/provider versions and tool-schema dump;
- operation-counter fixtures, batch fixtures, warning/footer fixtures, and controller replay tests;
- result-retention paths for raw stream, OpenCode DB/WAL, per-turn usage, controller cycles, and all
  checkpoint patches;
- green ledger count under the exact config hash;
- one run-pilot process, intended in-process concurrency, box process/disk state, and `escape=0`;
- `PREFLIGHT_ONLY=1` output; and
- projected spend plus the stage-specific kill rule.

No paid stage starts merely because implementation tests pass.

## 12. Explicit non-goals and stop rules

- No more AGENTS.md-only packing A/Bs.
- No width above three and no `&&` between independent probes.
- No unconditional server-side auto-read and no arbitrary 1.5× result budget.
- No cost comparison treating the pre-frame retired run as current.
- No claim that tool-result trailers are per-turn injection.
- No monolithic controller experiment before component screens.
- No solve-parity claim from a 3–20 task smoke.
- No tuning on `HO2`; `DEV-RET` and `DEV-OLD` are intentionally available for that work.
- No asymmetric harness policy in the native-versus-Sweet headline comparison.
- No automatic commit, push, or paid launch without explicit user authorization.

## 13. External-evidence transfer ledger

| source | verified result used here | inference explicitly not made |
|---|---|---|
| [W&D](https://arxiv.org/abs/2602.07359) | structured parallel calls reduce turns; authors chose per-call user injection; moderate/descending width won in their deep-research setup | no claim that width 3 is universal or that an AGENTS.md/trailer treatment reproduces it |
| [FuseSearch](https://arxiv.org/abs/2601.19568) | trained adaptive parallel localization can reduce turns/tokens while retaining localization quality | no direct end-to-end Grok effect-size transfer |
| [More with Less](https://arxiv.org/abs/2510.16786) | p75 and dynamic turn budgets reduced cost in its TRAE-agent study | no claim of flat solve for every model and no claim that its retrospective no-reminder table isolates reminder causality |
| [Coherence Collapse](https://arxiv.org/abs/2603.24631) | correct mid-trajectory patches can be destroyed and checkpoint recovery can help | no claim that our online checkpoint score identifies a gold patch |
| [To Run or Not to Run](https://arxiv.org/abs/2606.26978) | execution value and cost are concentrated and agent-dependent | no quota selected from its different OpenCode/Qwen configuration |
| [EET](https://arxiv.org/abs/2601.05777) | experience-driven early termination can reduce unproductive cost | no validation of our deterministic trigger or its threshold |
| [OpenCode V2 plugin docs](https://opencode.ai/v2/docs/build/plugins) | the beta `ctx.session.hook("request")` surface exposes mutable request messages immediately before model dispatch | no assumption that this surface exists or is compatible in pinned OpenCode 1.18.4 |

Paper effects motivate mechanisms and bounds; only local dev measurements set thresholds, expected
effect sizes, or sample sizes.

## 14. Expected prize, stated honestly

Packing alone has an approximately 8.4% first-order turn ceiling on the retired accounting and a
smaller prompt-reachable effect. It is worth engineering because structured batching is durable and
repeatable, not because it can independently create a huge margin. The wide-margin hypothesis is
the stack:

1. remove false harness-induced repair work;
2. prevent or recover completion-tail corruption;
3. retain Sweet's retrieval advantage and compact evidence;
4. close the remaining packing-density gap structurally; and
5. keep operations and per-turn context width bounded.

Only the fresh development confirmation and then `HO2` may establish that the stack beats native.

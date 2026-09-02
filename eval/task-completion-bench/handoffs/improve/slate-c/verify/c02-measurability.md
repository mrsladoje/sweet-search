# c02 adversarial verify — differential and measurability lens

Verifier: workflow agent `c02-measurability`. Date 2026-09-02. Cost: $0 (trace reading, code
reading, arithmetic on existing runs). Tags: `[M]` measured (script or command named), `[C]` read
from code, `[W]` web with URL, `[I]` inferred.

## 0. Verdict

**Refuted, on measurability, not on rules.** The candidate breaks no hard rule in the brief. Its
vehicle is genuinely sweet-only, it changes which requests happen rather than re-rendering the
same lines, and the opencode plugin hooks it names really exist in the deployed binary. It fails
on three counts instead.

1. **The load-bearing rate is contradicted by the only within-arm observation of it.** Inside the
   opencode sweet arm the model reached for opencode's own `read`, `grep` or `glob` in 41 requests.
   It emitted two or more of them in **0 of those 41** requests, and in **0 of the 36** that fall
   before the first edit, against native's 64.2% in the same phase `[M]`. The candidate's ceiling
   assumes the model would batch a structured `ss-*` tool the way it batches native `read`. The
   only free evidence about that assumption points the other way.
2. **The effect the candidate honestly expects is smaller than this bench's noise.** Three opencode
   sweet cells that differ only in the read gutter — a change the register already closed as worth
   $0.0003 to $0.0004 per rollout — span $0.008584 to $0.009265 per rollout, a 7.93% spread `[M]`.
   The paired 95% confidence interval on any pair of them is ±9.0 to ±10.2 percentage points `[M]`.
   The candidate's honest expectation is a swing of about 6.5 percentage points. It needs **82 to
   106 tasks at three reps** to be seen at 80% power, against the 22 tasks in the pool `[M]`.
3. **The $0 falsifier cannot kill the candidate on its own main claim.** The falsifier scores
   mapping coverage: does an `ss-grep` result contain the files a native `grep` matched. That is a
   correctness screen. The claim that decides the lever is the parallel-emission rate, and no
   replay can produce it.

A fourth point matters for the whole programme, not only for this candidate. **The +3.31% opencode
cost gap that motivates c02 is not itself a measured effect.** Its paired 95% confidence interval
is **[−9.25%, +15.88%]** of native `[M]`. The target is inside the noise the lever would be judged
against.

The candidate should not die. It should be **re-scoped and re-priced**, and its live pre-test moved
in front of the build. Section 6 lists the corrections the synthesis must adopt.

---

## 1. What I verified as true

Every claim below I opened myself. None of it is taken on trust from the candidate.

| candidate claim | status | evidence |
|---|---|---|
| The shipped MCP server registers 8 tools and no `grep`, no `find` | **TRUE** | `[C]` `mcp/server.js` lines 170, 198, 226, 244, 268, 290, 314, 333 register `search`, `trace`, `index`, `health`, `repo-map`, `vocab-prewarm`, `read`, `read-semantic`; `grep -c registerTool mcp/server.js` = 8 |
| OpenCode 1.18.4 exposes `tool.execute.before` and `tool.execute.after` | **TRUE** | `[C]` `/root/.config/opencode/node_modules/@opencode-ai/plugin/dist/index.d.ts` lines 235-241 and 249-258; `package.json` version 1.18.4. `[M]` the deployed binary `/usr/lib/node_modules/opencode-ai/bin/opencode.exe` contains `tool.execute.before` 5 times, `tool.execute.after` 4 times, `.opencode/tool` once (`grep -a -c -F`) |
| `tool.execute.after` can replace a built-in tool's output | **TRUE** | `[C]` its second argument is `{title: string, output: string, metadata: any}` and is mutable |
| 106 native structured calls sit after the first edit and must fall through | **TRUE, exact** | `[M]` my script over `forensics/scripts-opencode-calls-per-request/data/requests.json`: native post-first-edit `read` 62 + `grep` 39 + `glob` 5 = **106** of 975 = **10.9%** |
| Bench preflight rejects ambient plugins | **TRUE for vehicle (a)** | `[C]` `eval/task-completion-bench/harness/opencode-task-runner.mjs` lines 69-77 throw when `resolved.plugin.length !== 0` |
| The MCP guide variant is longer | **TRUE** | `[C]` `wc -w`: `sweet-search-system-prompt.md` 1,016 words, `sweet-search-system-prompt-mcp.md` 1,257 words, +23.7% |
| The vehicle `ss init --opencode` exists today | **FALSE, build cost** | `[C]` `scripts/inject-agent-instructions.js` writes `AGENTS.md`, `GEMINI.md`, a Cursor rule and the MCP variant only. There is no opencode plugin or custom-tool writer and no `--opencode` flag. |
| `ss-grep` has no include-glob, while every native opencode `grep` uses one | **TRUE** | `[C]` `eval/agent-read-workflows/bin/ss-grep` usage line: `ss-grep <regex> [-i|--ignore-case] [-k N]`. `[M]` `forensics/native-capability-gaps.md` line 111: opencode 240/240 native greps carry a type filter |

So the mechanism is buildable and the surface gap is real. The problem is what the numbers say next.

---

## 2. The ceiling's driver rate is contradicted inside the sweet arm

Script: `/private/tmp/.../scratchpad/an.py` and `an2.py`, over
`eval/task-completion-bench/handoffs/improve/slate-c/forensics/scripts-opencode-calls-per-request/data/requests.json`
(66 canonical sweet rows = 33 from `fp-opencode-tab-20260826` plus 33 from `rp-oc-tab-20260827`;
66 native rows from `fp-opencode-tab-20260826`).

| population | requests carrying a native `read`/`grep`/`glob`/`list` | of those, two or more of that family | rate |
|---|---:|---:|---:|
| native, all | 412 | 225 | 54.6% `[M]` |
| native, before the first edit | 327 | 210 | **64.2%** `[M]` |
| sweet, all | 41 | **0** | **0.0%** `[M]` |
| sweet, before the first edit | 36 | **0** | **0.0%** `[M]` |

Only 2 of those 41 sweet requests carried two or more calls of any kind `[M]`.

What this costs the candidate. If a structured tool made the model batch at native's rate, then 23
of the 36 pre-edit sweet requests should have been multi-call. Zero were. Under a rate of 54.6% the
chance of seeing 0 of 41 is 8.7 × 10⁻¹⁵ `[M]`. The 95% one-sided upper bound on the sweet arm's
structured parallel rate from 0 of 41 is **7.05%** `[M]`; from 0 of 36 it is 8.0% `[M]`. That
bound sits at the Bash rate (12.5%), not at the native structured rate (54.6%).

The honest caveat, which the synthesis must carry. These 41 requests fall in 7 tasks and 14
rollouts `[M]`. The sibling forensics calls them fallbacks after an `ss-*` miss, and a fallback is
a single known target, so the sample is biased toward single calls. But **15 of the 41 are preceded
by another structured request** (10 by a single `read`, 5 by a single `glob`) `[M]`. In those the
model was already inside the structured family, already reading serially, and still did not batch.
That is the exact pattern vehicle (a) claims to remove.

This is the one place the candidate's causal premise could be checked for free, and the candidate
does not cite it. The sibling forensics does cite it and reads it softly ("says the habit was not
carried over, not that it is impossible"). Under an adversarial reading it is a failed pre-test.

Supporting evidence from the candidate's own citations, pointing the same way:

- `[M SP-4, research/structured-vs-shell-parallelism.md §0.4]` on claude-code the same `Bash` tool
  moves from a 3.5% companion rate in a main thread to 41.3% inside a subagent. Tool identity is
  held constant and the rate moves 12-fold. The candidate quotes this to kill the claude-code
  branch and then keeps a −4% claude-code claim anyway. Those two statements cannot both stand.
- `[M research §0.4]` claude-code's `Read` description says nothing about parallel calls and
  batches 35.1%; its `Bash` description tells the model to batch and it batches 13.5%. Description
  text is not the driver.
- `[W, quoted in research §6.1]` Anthropic's own guidance names task shape, not tool shape:
  batching degrades "in coding and computer-use loops where the next independent calls are implied
  by the task rather than explicitly requested".

The research report's own §7.2 condition 1 says this condition is "currently contradicted" and
"falsifier already run and failed for claude-code". It leaves the opencode version of that test
open. Section 2 above is that test, at n=41, and it does not pass.

---

## 3. The claimed ceiling is stale, and the honest number is not reproducible

The candidate's headline ceiling is "−10.1% to −12.7% at native density". It comes from the
pre-edit estimator in `candidates/cost-structural.md` §3.3: 649 sweet pre-edit `ss-*` envelopes
re-emitted at native's pre-edit width of 2.657 gives 3.87 fewer requests per rollout, worth
−$0.001178 = −12.7% of the $0.009265 sweet cell `[M+I, that report]`.

The sibling forensics, written in the same workflow, rejects that class of estimator by name
(`forensics/opencode-calls-per-request.md` §6.3): "Both global-rate forms are the wrong estimator.
They apply native's exploration width to edits, test runs, todo updates and the final message,
which are 49% of sweet's requests". Its corrected table `[M]`:

| estimator | saving on the sweet cell | head-to-head result if realised in full |
|---|---:|---:|
| envelope level, all requests (reproduces 2026-08-28) | −18.4% | — (the report calls it over-counted) |
| dependency-respecting, native-style speculative reads (B3) | **−11.1%** (prefix only −8.4%) | **about −8% against native** `[M]` |
| dependency-strict, a search never merges with the reads after it | **−4.5%** (prefix only −3.4%) | **about −1.3% against native** `[M]` |
| the observed pattern: consecutive single `ss-read` requests | −2.2% to −2.8% | — |

So the candidate's floor (−10.1%) is above the sibling's dependency-respecting maximum (−11.1% is
the ceiling of that estimator, not its expectation), and its own honest-expectation figure of
"−3.2%" appears nowhere in the evidence base. I could not reproduce −3.2% from any estimator in
either report. It is tagged `[I]` in the candidate, and it should be replaced.

The candidate also presents its ceiling as "parity (−3.2%) **plus** byte advantage up to −8%". In
the source the −8% is not additive. It **is** the fully realised head-to-head outcome of the
−11.1% estimator `[M forensics §6.3]`. The candidate adds a term that the source already contains.

One counter-term nobody has priced. The −11.1% estimator "assumes native-style speculative reads
alongside searches" `[M forensics §6]`. Native performs 9.03 structured reads per rollout against
sweet's 6.64, 36% more `[M candidates/.../census.txt section B]`. If sweet adopts native's request
width it plausibly adopts native's speculative read volume, which adds ingested tokens. The bound
is small but real: native's ingest is $0.003049 per rollout against sweet's $0.002872, so full
convergence costs at most **+1.9% of the sweet cell** `[I from BRIEF §1.1 shares]`. That eats
roughly a sixth of the claimed prize and is not in the arithmetic.

---

## 4. Measurability: the number the bench can and cannot see

This is the core of my lens. All figures from `/tmp/wf-slatec/c02-measurability/noise2.py` on the
evidence box, over `rows.json` of `fp-opencode-{tab,none,pipe}-20260826` and
`rp-oc-{tab,none,pipe}-20260827`, canonical cells (22 tasks × 3 reps = 66 rollouts each), paired by
task on the mean of three reps. Results tree untouched; scratch under `/tmp/wf-slatec/c02-measurability/`.

### 4.1 Cell means and solves `[M]`

| cell | $ per rollout | solves |
|---|---:|---:|
| opencode native | 0.008968 | 41/66 |
| opencode sweet TAB (production form) | 0.009265 | 41/66 |
| opencode sweet NONE | 0.008584 | 39/66 |
| opencode sweet PIPE | 0.008764 | 38/66 |

The three sweet cells differ only in the read gutter delimiter. The register closed that as a cost
lever at $0.0003 to $0.0004 per rollout, and the fresh pool found all three forms within 3 solves
with Fisher p ≥ 0.72. Yet their measured mean costs span **7.93%**.

### 4.2 Paired confidence intervals `[M]`

| comparison | delta | paired SD | 95% CI half-width |
|---|---:|---:|---:|
| sweet TAB vs native (the headline) | +3.31% | $0.002697 | **±12.57 pp** |
| sweet TAB vs sweet NONE | +7.93% | $0.001919 | ±9.34 pp |
| sweet TAB vs sweet PIPE | +5.72% | $0.001887 | ±9.00 pp |
| sweet NONE vs sweet PIPE | −2.05% | $0.002143 | ±10.22 pp |

Two readings follow.

**The target is inside the noise.** The +3.31% opencode penalty has a 95% interval of
**[−9.25%, +15.88%]** of native `[M]`. The bench cannot presently distinguish "sweet is 3% dearer"
from "sweet is 9% cheaper" on opencode. A lever aimed at closing a gap that is not measured must
say so.

**The honest expectation is not detectable at this pool size.** Using the three sweet-versus-sweet
paired standard deviations as the noise model for a sweet-side A/B, the number of tasks needed at
80% power and a 95% two-sided test `[M]`:

| effect to detect | delta per rollout | tasks needed (three noise models) | pool has |
|---|---:|---:|---:|
| full ceiling, −12.7% of the sweet cell | $0.001177 | 21, 20, 26 | 22 |
| dependency-respecting −11.1% | $0.001028 | 27, 26, 34 | 22 |
| candidate mid-ceiling −10.1% | $0.000936 | 33, 32, 41 | 22 |
| honest expectation, a 6.5 pp swing to parity | $0.000583 | **85, 82, 106** | 22 |
| dependency-strict −4.5% | $0.000417 | 166, 161, 207 | 22 |
| observed serial-read pattern −2.8% | $0.000259 | 429, 415, 535 | 22 |

Only the top of the ceiling is measurable on the current pool, and only if realised in full.
Section 2 says it will not be realised in full. Everything the sibling forensics calls honest needs
between 3.7× and 24× the pool.

### 4.3 Solves

The pre-registered bar is ±6 of 66. Four opencode cells on the same 22 tasks read 41, 41, 39, 38
`[M]`. Three solves of drift is already background. The candidate's own solve risks — a stale index
for the 106 post-edit calls, `-k` caps against ripgrep's full listing, ranked order replacing raw
match order, two known false-negative bugs — could remove two to five solves and stay invisible.
"Solve is the veto" and the veto cannot fire at this resolution. This is the sharpest reason to
run a coverage screen and a live emission pre-test before any cost run.

Related measured fact, bounding one of those risks: on opencode the sweet arm made 18 post-edit
lexical `ss-*` calls in 66 rollouts, 6 of them searching for text the agent had itself just added,
and 2 of those 6 returned zero `[M candidates/scripts-index-time-and-capabilities/data/census.txt
section E]`. The freshness hazard is real but its population on opencode today is about 2.5% of the
712 `ss-*` envelopes `[I]`. Under vehicle (a) the exposed population becomes the 106 intercepted
post-edit native calls, which is 1.6 per rollout `[M]`.

---

## 5. Differential, admissibility and rules

| test | result |
|---|---|
| Sweet-only, or zero differential? | **Sweet-only.** The plugin file, the custom-tool files and the MCP server all ship only in the sweet arm. The bench runs the preflight per task and per arm from that arm's `rundir` `[C opencode-task-runner.mjs` lines 234-246`]`, so an arm-conditional gate is possible. No shared FRAME, shim or harness setting is touched. Brief rule 6 is satisfied. |
| Does it change which lines or which requests happen? | **Yes, requests.** It merges retrieval requests. It is not the banned same-information compaction class. Brief rule 7 is satisfied. |
| HO2 opened per task? | No. All evidence is `fp-*` and `rp-*` DEV pools. |
| Task identity, gold or hidden tests as runtime inputs? | No. |
| Ranking-signal format gate? | Not violated, but **a build obligation the candidate omits**. Vehicle (b) and vehicle (c) are new call sites into the engine. The repo `CLAUDE.md` requires `format: options.format` to be plumbed through new call sites, or format-gated boosts and demotions silently switch off. The shipped MCP `search` tool already defaults `format='agent'` `[C mcp/server.js:181]`; new `grep` and `find` schemas must do the same. |
| Owner decisions taken without a flag? | No. It flags the 2026-07-31 Bash/CLI-only decision and the 2026-08-14 no-new-tools rule, and sets `needs_user_decision`. Brief rules 11 and 12 are satisfied. |

Two differential details the candidate states wrongly.

1. **Vehicle (b) needs no preflight change.** `validateMainOpencodePreflight` inspects only
   `resolved.plugin` `[C lines 74-75]`. Custom tools are discovered from `.opencode/tool/*.{js,ts}`
   by the tool registry, not from the resolved config `[C tool/registry.ts` lines 178-198, read by
   the sibling forensics`]`. The candidate says both (a) and (b) need it.
2. **The run ledger would record a false zero.** The runner writes `pluginCount: 0` as a literal
   `[C opencode-task-runner.mjs:253]`. Under vehicle (a) every `rows.json` would claim no plugin
   while a plugin is loaded. The green-ledger invariant requires this be fixed before any run.

A third detail is a measurement-integrity problem, not a rule break, and it is the one I would
raise loudest to the owner. Under vehicle (a) the sweet arm's calls are named `read`, `grep` and
`glob`. The opencode runner classifies those names as `nativeGrep` and `nativeRead`
`[C opencode-task-runner.mjs:121]`. So the sweet arm would report `ss: 0` and look, in the ledger,
exactly like the native arm. The treatment could not be verified from `rows.json`, and every census
script keyed on `ss`/`nativeGrep` would misclassify the run. Vehicle (b) does not have this problem
because a custom tool carries its own name.

---

## 6. Corrections the synthesis must adopt

1. **Replace the ceiling.** Delete "−10.1% to −12.7% at native density". Write: *ceiling on the
   sweet cell −4.5% (dependency-strict) to −11.1% (native-style speculative reads); realised in
   full that is −1.3% to −8.0% against native; the observed serial-read pattern alone is −2.2% to
   −2.8%* `[M forensics/opencode-calls-per-request.md §6]`.
2. **Delete the "−3.2% honest expectation" and the additive "plus byte advantage up to −8%".** The
   −3.2% is not reproducible from any estimator in the evidence base. The −8% is not additive; it
   is the fully realised outcome of the −11.1% estimator.
3. **Add the failed within-arm pre-test to the evidence field, not only the supporting rates.**
   "0 of 41 sweet requests carrying opencode's own structured read tools were multi-call, 0 of 36
   before the first edit, against native's 64.2% in the same phase; 95% upper bound on the sweet
   structured parallel rate 7.05%; sample is 7 tasks and 14 rollouts and is biased toward
   fallbacks, but 15 of the 41 follow another structured request" `[M]`.
4. **Add the unpriced counter-term.** Converging on native's read volume costs at most +1.9% of the
   sweet cell `[I]`.
5. **Drop the claude-code −4% branch, or state it as zero.** The candidate's own SP-4 citation
   (3.5% → 41.3% with the tool held constant) removes its causal basis, and the MCP surface is
   missing the tools that are 38.0% of claude-code `ss-*` operations.
6. **Restate the codex branch as "zero and structurally so"**, and record the reason: the run's
   model string did not match the bundled catalogue slug, so codex built requests without the
   parallel affordance for both arms `[M research §0.1]`. It is a harness-version fact that can
   change, not a permanent law.
7. **Add a pre-registered live emission pre-test in front of the build, and make it the gate.**
   Ten rollouts on 3 tasks with a stub structured `ss-search`/`ss-read` custom tool in
   `.opencode/tool/`, carrying `read.txt`'s parallel sentence verbatim. Kill condition with a
   number: *if fewer than 25% of the structured `ss-*`-bearing requests carry two or more calls,
   the lever is dead*. That is the midpoint between the observed Bash rate (12.5%) and the level
   the ceiling needs. This costs a few dollars, not the 3 to 5 days of build the candidate front-loads.
8. **Size the cost run, or do not promise a cost result.** Detecting the honest expectation needs
   82 to 106 tasks at three reps `[M]`. Detecting the full ceiling needs 20 to 26 tasks, so the
   existing 22-task pool can only see the best case. Say which of the two the run is buying.
9. **Fix the two vehicle statements**: (b) needs no preflight change; (a) needs the preflight
   change **and** a `pluginCount` fix **and** a tool-name classifier fix, or the sweet arm becomes
   indistinguishable from native in the ledger.
10. **Add the format-gate obligation** for vehicles (b) and (c): new call sites must plumb
    `format: 'agent'` explicitly, or format-gated ranking signals switch off and the retrieval
    benchmarks move.
11. **Add the `-k` term to the falsifier.** Every opencode native `grep` carries an include glob
    (240 of 240) `[M]` and `ss-grep` has none `[C]`. The proposed post-filter needs `-k` raised,
    which enlarges the payload. The falsifier must record, for each mapped call, the `-k` value
    that reaches full coverage, and the extra bytes it returns. Without that the coverage screen
    can pass while the cost ceiling quietly shrinks.
12. **State plainly that the $0 falsifier cannot decide the lever.** It screens correctness. The
    emission rate decides the lever, and only a live run produces it. Present the falsifier as a
    prerequisite, not as the gate.
13. **Say that the motivating gap is not itself significant.** +3.31% on opencode has a 95%
    interval of [−9.25%, +15.88%] `[M]`.

---

## 7. What I could not finish

- I did not price the cached-prefix cost of adding structured tool schemas. The sibling report also
  left this open. It is order 2.6% to 4.5% of the sweet cell by analogy with the 1,457-token guide
  `[I]`, which is a quarter to a half of the realistic prize, but I did not measure a schema.
- I did not verify the "1,014 of 3,273" `ss-grep` plus `ss-find` share. It lives in another agent's
  box script (`/tmp/wf-slatec/real-user-product/census.py`) that I did not re-run. I verified the
  claim it supports — the MCP surface has no `grep` and no `find` — directly from `mcp/server.js`.
- I did not run an opencode plugin or a custom tool. The hook signatures are read from the
  installed `@opencode-ai/plugin` 1.18.4 type definitions and confirmed as strings in the deployed
  binary. Whether `tool.execute.before` can cancel the built-in tool's execution is **not**
  established: its output object exposes only `args` `[C]`, so the built-in appears to run first
  and the plugin then rewrites the result. If that is right, vehicle (a) pays the native tool's
  work on every call, which does not change token cost but does change latency and freshness.
- I did not open grading logs, and no hidden test name or gold patch content appears here. All file
  paths quoted are from the agents' own commands.
- I did not re-derive the gutter question. I used the three gutter cells only as a noise model.

## Appendix: paths, runs and scripts

- Report: `eval/task-completion-bench/handoffs/improve/slate-c/verify/c02-measurability.md`
- Runs read (read-only): `fp-opencode-{tab,none,pipe}-20260826`, `rp-oc-{tab,none,pipe}-20260827`
  under `/root/sweet-search-private/eval/task-completion-bench/results/`
- Box scratch: `/tmp/wf-slatec/c02-measurability/{noise.py,noise2.py}`
- Local scripts: scratchpad `an.py` (parallel rates, headline pairing), `an2.py` (composition of
  the 41 requests), `an3.py` (the 106 post-edit native structured calls)
- Local data read: `slate-c/forensics/scripts-opencode-calls-per-request/data/requests.json`,
  `slate-c/candidates/scripts-index-time-and-capabilities/data/census.txt`
- Code read: `mcp/server.js`; `eval/task-completion-bench/harness/opencode-task-runner.mjs`;
  `eval/agent-read-workflows/bin/ss-grep`; `scripts/inject-agent-instructions.js`;
  `/root/.config/opencode/node_modules/@opencode-ai/plugin/dist/index.d.ts` (1.18.4)
- Rollout named in the candidate and confirmed present in the sibling evidence:
  `rp-oc-tab-20260827/agent-state/devlooped__moq-1262-sweet` rep 2, requests 16-20, against
  `fp-opencode-tab-20260826/agent-state/aio-libs__aiohttp-8038-native` style wide read requests
  `[M forensics/opencode-calls-per-request.md §5]`

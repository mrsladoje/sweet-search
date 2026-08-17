# SLATE A RESIDUE — results

**Run:** 2026-08-17. **Authorised:** ~`$15` of model rollouts.
**Spent on model rollouts: `$0.00` metered.** Every paid decision was taken on the ChatGPT-Max
subscription harness (`codex`), which is flat-rate, or at `$0` from recorded artifacts. The
itemised ledger is §8.

**Method:** the `/microsmoke` skill, invoked; the six-step protocol from
`HANDOFF-EVIDENCE-DOCTRINE.md` §3.1, filled in before each run rather than after.

`SLATE-A-UBER.md` and `SLATE-B-UBER.md` are untouched.

---

## 0. What changed, in one page

**The largest result was not on the work list.** Two of the five tasks in the programme's fixed
control set — `redboltz__mqtt_cpp-466` and `statamic__cms-9029` — **pass with no patch at all.**
Their FAIL_TO_PASS tests already succeed on the base tree. It surfaced when a broken cell submitted
empty patches and the grader resolved them anyway; it was then confirmed on purpose, four times
over, at `$0`. **§7 is the section to read first.**

| item | verdict | rests on |
|---|---|---|
| **the control set** | **2 of 5 tasks are vacuous** | a deliberate null arm, `$0`, four independent confirmations |
| **C-3 context reset** | **DEAD**, and now for a reason that survives the handoff's §0 | a `$0` response surface + a LIVE A/B whose metric moved the wrong way |
| **R-1 turn-0 dossier** | **DEAD** — kill confirmed on live evidence this time | C-4's live A/B measured R-1's own metric; R-1's own cells did not run (§2.4) |
| **D-4 `pages` adapter** | **not fixable** on the documented surface; already mitigated as far as it goes | §3 |
| **C-6 round 3** | **FAIL** — 3 of 5 tasks; the capability does not survive | a blinded session, leak-swept first; §3.E's screen NOT run |
| **Phase 4** | specified: **~465 tasks** for a 5% cost effect | a power analysis on our own variance, §5 |
| **G.1 golden provenance** | fixed, 24 tests green | §6.1 |
| **G.2 D-6 row telemetry** | fixed, tests green — **but D-6 itself was never committed** | §6.2 |

**Nothing new ships**, and the portfolio is smaller than the last document said: C-4's replay-based win was **inverted by its own live A/B**, so on current evidence Slate A ships **nothing** (§9.8).
The lasting output of this session is four findings about the *instrument*, not the product: a
control set that is 40% vacuous, goldens that could not be verified after they were built, a
run_tests fix recorded as shipped that was never committed, and — found when it stopped the last two
cells — a subscription credential the harness silently lets decay (§9.4).

**Two cells did not run.** C-3's deletion-versus-summary control (§1.6) and R-1's own treatment
cells (§2.4) were lost to two `codex exec resume` argv defects and then to that credential expiring.
Neither verdict depends on them, and both are reported as **unobtained rather than as nulls** —
every one of those rollouts made zero or partial model calls, and reading them as results would have
manufactured findings.

**Three corrections to the handoff's own premises**, all established by measurement:

1. **§3.A's pricing-column hypothesis is false for C-3.** The handoff suspects gate4 killed C-3 on
   `idealCostUsd` when it should have used `breakPricedCostUsd`. Measured: on this simulation the
   two columns are **identical to six decimal places** on all three harnesses. gate4 used the right
   number. The reason is structural and is in §1.3.
2. **§3.G.1's failure mechanism is not what the code does.** `golden-build.mjs` uses `execSync`,
   which throws on a non-zero exit, and `git checkout <unreachable-sha>` exits 128 — verified
   directly. A failed checkout aborts the build; it does not silently capture the default branch.
   The real exposure is different and larger, and it is repaired in §6.1.
3. **D-6 is not in effect anywhere.** `SLATE-A-CLOSE-RESULTS.md` §6 records D-6 as "Fixed, with a
   regression test". `rt-inflight.mjs`, its test, and the `codex-task-runner.mjs` rewiring are
   **not in `HEAD`** (`git cat-file` reports the path absent) and **not on the evidence box**. They
   exist only in one dirty working tree. Every codex run to date, including this session's, ran
   without them. §6.2.

---

## 1. C-3 — context reset, re-opened live

### 1.0 The protocol block, filled in BEFORE the run

This is genuine pre-registration, not the retrospective version §9.8 of the close-out had to admit
to. The metric and the kill line were fixed by the handoff (§3.A) before any cell existed; the
scoring script that implements them,
[`d17-c3-live-rederivation.mjs`](./phase1-scripts/d17-c3-live-rederivation.mjs), was written and
committed to the plan before the treatment cells ran.

```
LEVER:            C-3 ephemeral causal coprocessor with context reset
MECHANISM:        after the agent has localised the problem, a fresh session receives a typed
                  handoff instead of the accumulated diagnosis context, so the apply phase stops
                  re-sending context it no longer needs
CENSUS:           re-derivation fires 60 times across 94 scored post-C-1 rollouts  ->  tier 20-50
PROXIMAL METRIC:  count of retrieval calls at/after the diagnosis-apply boundary whose target was
                  ALREADY retrieved before it
DIRECTION:        must go DOWN
EXPECTED EFFECT:  a handoff that carries the diagnosis forward should remove most of the 0.64
                  re-derivations per rollout the baseline shows
KILL LINE:        any control task below 2/2, OR the count fails to fall on any variation,
                  OR v5 (append, no deletion) matches the best reset variation
CONVERSION:       0.64 removed retrievals/rollout x ~1 call round-trip = the entire upside;
                  set against a fresh session re-paying its base prefix at full input rate
CONTROL SET:      epiforecasts__scoringutils-229, redboltz__mqtt_cpp-466, statamic__cms-9029
                  (the three control-set tasks with a green ledger under the current config)
```

### 1.1 Gate 0, at `$0`: the census, and the ceiling it puts on the mechanism

[`d13-c3-rederivation-census.mjs`](./phase1-scripts/d13-c3-rederivation-census.mjs). Boundary is
the first edit call — the same cut gate4's replay used. "Re-derived" is a retrieval at or after it
whose target was already retrieved before it. **Builds are reported separately and never pooled**
(§1.5 #9).

| build | cells | scored rollouts | pre-boundary retrieval | post-boundary | re-derived |
|---|---|---|---|---|---|
| **post-C-1** | screen-v3 + the three c4b OFF cells | 94 | 969 | 173 | **60 (34.7%)** |
| pre-C-1 | the three sb-* baselines | 162 | 1,579 | 231 | 79 (34.2%) |

Two independent builds and three harnesses agree that **about a third of post-boundary retrieval is
re-derivation**. That reproducibility is what makes the next number trustworthy.

**The number that decides the lever is not the ratio, it is the base.** Post-boundary retrieval is
only 173 calls across 94 rollouts — **1.8 per rollout** — against 969 before the boundary. The
apply phase barely retrieves at all. So:

> **A perfect handoff can remove at most 0.64 retrieval calls per rollout.** That is the entire
> upside of the mechanism, measured, and it is roughly 3% of a ~20-call rollout.

Meanwhile 57–62% of all tool calls happen **before** the boundary, so the reset deletes the larger
half of the context and the apply phase must live without it.

### 1.2 Gate 0b, at `$0`: the response surface, not one point

gate4 evaluated **one** shape. §5 of the handoff is explicit that a mechanism must be swept, so
[`d15-c3-surface.mjs`](./phase1-scripts/d15-c3-surface.mjs) sweeps both axes on `breakPricedUsd`.

**The term that decides the lever, and that gate4 never printed:**

| harness | base prefix a fresh session re-pays at FULL input rate | diagnosis context the reset deletes | ratio |
|---|---|---|---|
| codex | 14,734 tok | 9,715 tok | **0.66×** |
| opencode | 8,395 tok | 11,315 tok | 1.35× |
| claudecode | 19,230 tok | 10,153 tok | **0.53×** |

**On two of three harnesses the reset deletes less context than it re-pays.** The second session
must re-send the system prompt, the instruction file and the issue at the full input rate — ten
times the cache-read rate on Luna — and on codex and claude that prefix is larger than the whole
diagnosis it discards. No handoff size and no trigger rule can fix an inequality of that shape.

**V4, handoff size** (reset on every exposed rollout):

| handoff tokens | codex | opencode | claudecode |
|---|---|---|---|
| 0 | +7.81% | −3.04% | +1.62% |
| 300 | +8.36% | −2.33% | +2.10% |
| 900 | +9.47% | −0.91% | +3.06% |
| 2000 | +11.50% | +1.69% | +4.81% |
| 4000 | +15.19% | +6.42% | +8.01% |

**V3, trigger threshold** — reset only when the diagnosis context exceeds N tokens. This is the
tail-lever shape, and it is the only one that turns the sign negative:

| N | codex (fires) | opencode (fires) | claudecode (fires) |
|---|---|---|---|
| 0 | +9.47% (34/34) | −0.91% (32/32) | +3.06% (33/33) |
| 5,000 | +7.02% (28/34) | −2.06% (28/32) | +0.68% (27/33) |
| 10,000 | +1.18% (12/34) | −3.63% (15/32) | −3.07% (14/33) |
| 20,000 | −0.97% (4/34) | −1.25% (3/32) | −3.64% (2/33) |
| 40,000 | 0.00% (0/34) | 0.00% (0/32) | 0.00% (0/33) |

**And the oracle — the upper bound no policy can reach**, choosing per rollout with hindsight
whether to reset and at what handoff size:

| harness | oracle | rollouts where resetting helps at all |
|---|---|---|
| codex | **−1.41%** | 5/34 |
| opencode | **−4.78%** | 16/32 |
| claudecode | **−5.86%** | 4/33 |
| claudecode (post-C-1) | **−3.08%** | 5/31 |

**A hindsight-perfect C-3 buys between 1.4% and 5.9%.** The instrument cannot resolve anything
under about 10% (`HANDOFF-EVIDENCE-DOCTRINE.md` §0). So **the cost axis of C-3 is undecidable by
construction** — not because we cannot afford the run, but because the best possible version of the
lever sits below the noise floor. That is a doctrine §6 finding, reached at `$0`.

### 1.3 The pricing-column question, settled

§3.A suspects the original gate read `idealCostUsd` where it needed `breakPricedCostUsd`, and says
"this single line is why C-3's replay may have been wrong in the direction that matters".

[`d14-c3-reset-repricing.mjs`](./phase1-scripts/d14-c3-reset-repricing.mjs) prints all three
columns. **`idealUsd` and `breakPricedUsd` agree to six decimal places on every harness and every
scope.**

| harness / scope | idealUsd | breakPricedUsd | realFromTurns |
|---|---|---|---|
| codex, all exposed | +9.47% | **+9.47%** | −14.56% |
| opencode, all exposed | −0.91% | **−0.91%** | −13.83% |
| claude, all exposed | +3.06% | **+3.06%** | −12.34% |
| claude, post-C-1 | +6.29% | **+6.29%** | −11.44% |

**Why they agree, and why the concern was still the right one to raise.** `breakPricedUsd` differs
from `idealUsd` only when a context *shrinks in place*. gate4 does not model the reset that way: it
prices the reset as **two separate append-only contexts**, and `costFromTurns` already charges the
second context's opening prefix at full input rate on its first turn. That is the correct
break-priced treatment, arrived at structurally rather than deliberately. So gate4 was right on the
column, and the general rule at `ideal-cost.mjs:62` is unaffected — it still binds on any lever that
edits a live context, and current provider documentation confirms the underlying semantics:
removing, summarising or reordering earlier messages invalidates everything cached after the change
([OpenAI prompt-caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)).

**The trap in that table is `realFromTurns`, which is the only column showing a saving.** It is
comparing a recorded trajectory's real cache behaviour against a simulated one that assumes near
perfect caching. It is apples to oranges and must not be read. Anyone re-opening C-3 on a −12%
figure has read that column.

### 1.4 The LIVE A/B — and the metric moved the wrong way

Three cells, `ARMS=sweet`, `REPS=2`, `CONCURRENCY=3`, matched `MAX_TOOL_CALLS=60`, one build, run
sequentially (never two `run-pilot` processes at once). Harness `codex` on the ChatGPT-Max
subscription, so the model spend is `$0`.

**Gate 0 first — `/microsmoke`'s one rule.** A single-task probe proved the treatment fires before
any cell was bought: phase 1 wrote a 1,696-character handoff to `.c3-handoff.md`, phase 2 ran 5
calls in a fresh session, and the cost merged across 2 prompt-cache contexts. Across the six
treatment rollouts the trigger fired **6/6 with no fallbacks**, so the cell is readable rather than
an accidental A/A.

| | `off` (baseline) | `v1` (context RESET) |
|---|---|---|
| solve | 6/6 | 6/6 |
| **re-derivations per rollout — THE METRIC** | **0.00** | **1.33** |
| re-derivation as a share of post-boundary retrieval | n/a (there is none) | **66.7%** |
| retrieval calls, diagnosis / apply | 22 / **0** | 37 / **12** |
| tool calls per rollout | 6.8 | **12.5** |
| breakPriced cost (read, never judged) | $0.032669 | $0.058646 |

**The pre-registered direction was DOWN. It went UP, 0.00 → 1.33 per rollout. That is the kill
line, hit on the metric the handoff chose in advance.**

**The mechanism, which is the part worth keeping.** In the baseline the apply phase issues **zero**
retrieval calls on these tasks — the agent already holds what it needs. After a reset it issues
twelve, and **two thirds of them re-fetch something phase 1 had already fetched**. The typed handoff
did not prevent it: it was present, well-formed and 1.7–3.0 KB every time, and the agent went and
looked anyway. Total tool calls nearly doubled.

This is the handoff's §0 mechanism running in the other direction. §0 says an agent handed *more* context
does more work. C-3 hands it *less*, and the agent also does more work — because now it has to
rebuild what it lost. Both are the same fact: **the trajectory is not fixed, so a replay that holds
it fixed mis-prices a context change whichever way the change goes.**

**How badly the replay under-called it.** The `$0` surface predicted +3% to +9.5% on codex. Live
cost was **+79%**. Same sign, order-of-magnitude wrong size. So the handoff's §0 rule should be sharpened:
*a fixed-trajectory replay gets the direction of a context change right about as often as not, and
never gets the size right.*

Cost is reported and not judged, exactly as pre-registered. At n=3 tasks it cannot carry a verdict;
it is here because it agrees with the metric, not because it decides anything.

### 1.5 v5, the control that isolates deletion — the first attempt was INERT

The v5 cell (append the identical handoff, delete nothing, via `codex exec resume`) **failed on
every rollout**: `exit=codex_error`, zero patch hunks, zero tests run.

**Two independent argv defects, found one after the other.**

1. **`codex exec resume` takes a different option set from `codex exec`** — no `-C`, no
   `--sandbox`; 0.146.1 accepts only
   `-c/-m/--json/--last/--dangerously-bypass-*/--skip-git-repo-check/-i/-o`. The runner passed the
   `codex exec` argv verbatim. Fixed — and the second attempt (`c3ab-v5b`) failed too, with
   `phase2Calls: 0` on all six rollouts and the handoff written every time.
2. **The signature is `resume [OPTIONS] [SESSION_ID] [PROMPT]`.** With `--last` and a *single*
   positional, codex binds that positional to **SESSION_ID**, so the entire handoff was parsed as a
   session identifier. Fixed by passing the session id explicitly: codex names each rollout file
   `rollout-<timestamp>-<uuid>.jsonl`, and phase 1's own file yields it unambiguously — which is
   also more robust than "most recent" when rollouts run concurrently.

**Both failures are recorded rather than quietly re-run, because of what they look like.** Six
rollouts, zero edits, zero solves reads exactly like "the treatment destroyed the agent". It is an
inert cell, and under `/microsmoke` an inert cell is **not a negative result** — it is a measurement
that did not happen. Reporting either run as a C-3 result would have manufactured a dramatic and
entirely false finding. The runner now refuses to spawn a malformed resume at all and marks the row
`inert`, so a third occurrence is visible in the data rather than in a wall of `codex_error`.

**The verdict does not depend on v5.** The kill line was hit by v1 on the pre-registered metric;
v5's job was only to say whether deletion or the summary causes the re-derivation. §1.6 has what
happened to the third attempt.

### 1.6 The third v5 attempt never ran — the box's codex subscription auth expired mid-session

The corrected cell (`c3ab-v5c`) was queued behind the R-1 cells and **never executed**, because the
evidence box lost its ChatGPT-subscription authentication partway through the R-1 run. §9.4 has the
diagnosis; it is an infrastructure failure, not a treatment failure, and it needs an interactive
`codex login` that this session cannot perform.

**So the deletion-versus-summary isolate is NOT OBTAINED.** What C-3 has is: a three-harness `$0`
response surface bounding the whole lever below the instrument's resolution, and one live cell whose
pre-registered metric moved the wrong way by a factor that is not close to the boundary. That is
enough to kill it and is reported as such. It is not enough to say *why* — whether the agent
re-derives because the context was deleted, or would have re-derived anyway once told to work from
a summary. **A successor who wants that answer needs only the v5 cell; the code is written, fixed
and tested, and it is one working token away.**

**The first failure also produced the most consequential finding of this session, by accident: those
empty patches were graded, and two of the three tasks came back RESOLVED. That is §7.**

---

## 2. R-1 — turn-0 dossier, re-checked

### 2.0 The protocol block, filled in before the run

```
LEVER:            R-1 turn-0 orientation dossier
MECHANISM:        orienting the agent before it starts removes the early retrieval calls it
                  would otherwise spend finding the file it is going to edit
CENSUS:           every rollout has an orientation phase; the mechanism fires on all 204
PROXIMAL METRIC:  number of retrieval calls before the FIRST EDIT
DIRECTION:        must go DOWN
KILL LINE:        first-edit call count does not fall, OR total billed input rises on every
                  variation
CONVERSION:       (calls removed) x (per-call round trip) - (dossier carried on every turn)
CONTROL SET:      as C-3
```

### 2.1 The decisive evidence was already bought, and it is live

R-1 was killed on a fixed-trajectory replay (`+0.41%` to `+1.82%`), which the handoff's §0 discredits. But
**C-4's live A/B is the same mechanism** — deliver more context earlier so the agent retrieves less
later — and it measured **R-1's exact pre-registered metric** on the same corpus, the same three
harnesses and the same backbone.

From [`d12-trace-behaviour-ab.mjs`](./phase1-scripts/d12-trace-behaviour-ab.mjs) on the `c4b-*`
cells, Layer 5:

| harness | calls to first edit, more-context ON vs OFF | direction | cost on the same runs |
|---|---|---|---|
| codex | 7.9 vs 8.5 | **down 7%** | **+4.78%** |
| opencode | 11.4 vs 13.5 | **down 16%** | **+19.79%** |
| claudecode | 11.7 vs 11.9 | **down 2%** | **+11.72%** |

**R-1's proximal metric moved in R-1's favour on all three harnesses, and cost moved against on all
three.** That is the whole R-1 question answered with an experiment that has already been paid for:
*even a fully successful R-1 does not imply a cost win.* The conversion arithmetic — the doctrine's
§4 step — is where the lever dies, not the metric.

The claude leg shows why, and it is the handoff's §0 mechanism in detail: with more context delivered
earlier, re-reads went **0.73 → 1.13** per rollout, read→read chains **0.80 → 1.53**, failed edits
**12.7% → 15.2%**, and total calls **20.5 → 23.6**. The agent did not spend the saved orientation
calls on nothing; it spent them on more work.

### 2.2 The dossier cannot hit its target reliably anyway

[`gate10-r1-top5.mjs`](./phase1-scripts/gate10-r1-top5.mjs) puts an upper bound on targeting, using
each rollout's own first retrieval call as the best possible dossier:

- **solved rollouts: top-1 23%, top-5 66%, top-10 69%, absent 31%.**
- per harness, top-5 on solved: codex 53%, opencode 71%, claude 64%, screen 80%.

**A third of the time the file that eventually gets edited is not in the dossier at all**, so a
third of the carrying cost buys nothing. And [`gate10-r1-localization-timing.mjs`](./phase1-scripts/gate10-r1-localization-timing.mjs)
shows the agent already locates that file within the first **two** calls on 51–57% of rollouts, so
the window the dossier is competing for is small to begin with.

`gate10-r1-breakeven.mjs` prints a *maximum* saving of 8–13% from deleting the first two requests,
against a carrying cost of 1.1–3.6% for a 500–1000-token dossier. **Read as a net win, that table is
a trap**: it credits the dossier with removing both early requests on **every** rollout, when the
targeting bound above says it can do so on at most two thirds, and it charges nothing for the extra
work the live C-4 result shows added context provokes.

### 2.3 Verdict

**R-1 stays DEAD, and the kill is now supported by a live experiment rather than a replay.** This is
a stronger position than the one the handoff expected: it predicted the recorded loss "probably
understates the damage", and the live sibling measurement shows exactly that — metric down on all
three harnesses, cost up on all three.

**What was NOT done, and it matters:** R-1 itself was not measured live. The argument is by
mechanism identity with C-4, which is a strong analogy and not a measurement. §2.4 says how close
it came.

### 2.4 The live R-1 cells: baseline ran, treatments were killed by an auth failure

R-1 was implemented as a live treatment in the codex runner — `SS_R1=map` (repo map: top-level
entries, file counts, dominant extensions) and `SS_R1=map5` (the map plus the top 5 files retrieval
returns for the issue text) — delivered in the turn-0 user message, which is the cheapest possible
placement and therefore the one that flatters the lever most.

| cell | rollouts | outcome |
|---|---|---|
| `r1ab-off` (baseline) | 6 | **ran clean** — 6/6 resolved, 8.2 tool calls per rollout |
| `r1ab-map` | 6 | **0 tool calls on every rollout** — the box's codex auth had expired |
| `r1ab-map5` | 0 | never started |

**A baseline without treatments is not an A/B, and it is reported as nothing rather than as a
null.** The `r1ab-map` cell is inert for an infrastructure reason (§9.4), and reading a treatment
cell that made zero model calls as "R-1 did not help" would be exactly the accidental-A/A the
`/microsmoke` skill exists to prevent.

**Two deliberately generous assumptions were baked into the design and must travel with any future
result:** the retrieval that builds the top-5 list runs off-clock and is charged to nobody, and the
dossier sits where prompt caching is cheapest. A real deployment pays for both. If R-1 loses under
assumptions that favourable, it loses by more in production.

**The verdict in §2.3 does not rest on these cells** — it rests on C-4's live measurement of R-1's
own metric, which is already bought and is three-harness. The direct cell would have made it
first-hand rather than by analogy.

---

## 3. D-4 — the `pages` adapter: not fixable on the documented surface

**The handoff asks for "a fix, or a costed statement of why it cannot be fixed, with the research
you did". This is the costed statement.** All four candidate routes were checked; three are closed
by the product's documented surface and the fourth is already implemented.

*(A delegated `claude-code-guide` research pass was launched, as §4 of the handoff suggests. It went
idle without reporting and did not answer two direct requests for its findings, so **none of it is
in this section.** Every citation below is from a source I read directly — the official settings and
hooks pages, the issue tracker, and the strings in the installed 2.1.218 binary. Nothing here is
second-hand, and nothing here is waiting on that agent.)*

### 3.1 What the parameter actually is — read out of the shipped binary

`pages` is a **PDF-only** parameter. The Read tool's own description, extracted from the installed
Claude Code 2.1.218 binary, says:

> Reads PDFs via the `pages` parameter (e.g. "1-5", max 20 pages/request; required for PDFs over
> 10 pages).

and the rejection path is the tool's own `Invalid pages parameter: "` message. So the 110 failures
are the model reaching for a documented parameter that has no meaning on a source file, and
supplying `""` as its way of saying "no range". **The description is the cause, and the harness
cannot change the description** — which is what the rest of this section establishes.

### 3.2 Route 1 — per-tool schema or description override: **DOES NOT EXIST**

The official settings reference lists no key that overrides a built-in tool's input schema or
description, and **no `disabledTools` key**
([Claude Code settings](https://code.claude.com/docs/en/settings)). The only tool-shaped surface is
`permissions.allow` / `permissions.deny`, which glob-match on operation patterns such as
`Read(./.env)` — an allow/deny decision, never a parameter constraint. Disabling a built-in tool to
substitute an MCP one is an **open feature request**
([issue #66073](https://github.com/anthropics/claude-code/issues/66073)), not a capability.

**DOCUMENTED as absent.**

### 3.3 Route 2 — a hook that rewrites the input before validation: **ALREADY SETTLED, AND NO**

The runner's own note (`claude-code-task-runner.mjs:59-78`) settles this with a complete
correlation across all 32 native sessions of `screen-v3`:

| | Read calls | needed normalizing | rejected |
|---|---|---|---|
| hook ran | 189 | 0 | 0 |
| hook did **not** run | 110 | 110 | 110 |

Complete separation. Validation happens upstream of the `PreToolUse` stage, so the normalizer can
never see the calls it exists to repair.

The docs do **not** state validation ordering either way — searched, and NOT DOCUMENTED. What the
issue tracker adds is that `PreToolUse` *can* rewrite input via `updatedInput` when it fires
([#30770](https://github.com/anthropics/claude-code/issues/30770),
[#15897](https://github.com/anthropics/claude-code/issues/15897), both reporting bugs in that path),
and that `PreToolUse` silently not firing is a known class
([#6305](https://github.com/anthropics/claude-code/issues/6305)). Neither changes the measured
result: for these 110 calls the hook stage is never reached.

**MEASURED, and consistent with the documented hook model.**

### 3.4 Route 3 — a newer Claude Code: **UNTESTED, and the only route still open**

The box runs **2.1.218**; the current published version is **2.1.233** — fifteen patch releases
ahead. No release note was found describing a change to `pages` validation or to empty-string
parameter handling, and the issue the runner cites,
[#36654](https://github.com/anthropics/claude-code/issues/36654), is about the Read tool's
line-number prefix causing short-wrapped Edit replacements — a **different** defect in the same
tool, still open. Sibling issues on Read's formatting exist
([#20223](https://github.com/anthropics/claude-code/issues/20223), token overhead from line-number
formatting; [#6910](https://github.com/anthropics/claude-code/issues/6910), truncation), but none on
`pages` validation.

**Concrete cheap test, not run here:** install 2.1.233 into a scratch version directory, run a
**single** native claude-code cell on two tasks, and count `Invalid pages parameter` in the
transcript. That is roughly `$0.10–0.20` of OpenRouter spend and about fifteen minutes. It was not
run because upgrading the CLI mid-session would have changed the agent under test while a live A/B
was in flight, and because it belongs with a claude-code cohort rather than on its own.

### 3.5 Route 4 — quantify and disclose: **ALREADY IMPLEMENTED, and it is the answer**

The prompt-level mitigation already exists and is already arm-symmetric: `READ_PAGES_TOOL_NOTE` is
appended to `--append-system-prompt` for **both** arms and tells the model that `pages` is PDF-only
and must never be an empty string. It recovers **189 of 299** Read calls (63%). The residual 110 is
what the handoff describes — the number *after* the only working lever is applied.

Residual shape, from the runner's note: 110 rejections over 32 sessions, **3.4 per session**,
front-loaded (median = the 2nd Read call), and **not self-limiting** — only 10 of 32 sessions stop
sending an invalid value after the first rejection; 22 keep sending it.

### 3.6 Verdict, and the one thing that should change

**D-4 cannot be fixed at the harness level on the currently documented surface.** It stands as a
disclosed bracket on the **native** arm, exactly as the run-directory tax does, and — as §3.C of the
handoff insists — **it must never be booked as a sweet win**: it inflates native's cost, so removing
it would *shrink* sweet's measured advantage.

**One concrete change is warranted now:** `installClaudeReadPagesNormalizer` and
`claude-read-pages-hook.mjs` are **provably inert**. Keeping installed code whose stated purpose is
a repair that has never once occurred invites the next session to "fix" it — the runner's comment
block exists precisely to prevent that, and it is doing the job of code that should not be there.
Either delete the hook and keep the comment as the record, or leave it and treat the comment as
load-bearing documentation. **This session left it in place**, because removing it changes the
claude-code harness and no claude-code cell was run to confirm the removal is inert in practice.

---

## 4. C-6 — round 3, and the conversion screen it gates

Full artefacts: [`blinded/round3/ROUND-3-RESULTS.md`](../blinded/round3/ROUND-3-RESULTS.md) and the
lock file beside it.

### 4.1 The leak check, before anything was handed over

Run against the sealed answer key: five task identifiers, five repository names, and every new
source module path the accepted solutions add (`no-classic-components.js`, `AttributeCompletor.php`,
`Diff.java`, `Issue.java`, `Patch.java`, `Source.java`) — 27 distinct terms.

| channel | result |
|---|---|
| `MEMORY.md` (auto-loads before any brief can be read) | **clean** |
| all 225 individual memory files | **clean** |
| project `CLAUDE.md` | **clean** |
| global `~/.claude/CLAUDE.md` | **clean** |
| `.claude/settings*.json` + all 162 skill files | **clean** |
| persistent agent stores in the repo (`.agentic-qe`, `.swarm`, pattern DBs — 70 files) | **clean** |
| hook scripts | **clean** |
| the brief itself | names the five **repositories** (necessary — the session must know which tasks) and **no** module, symbol or label |

The session was started fresh, with the brief and nothing else, and does not inherit this session's
context — which matters, because this session had already opened the sealed labels.

**The fourth channel the handoff told me to assume exists, was found — by the blinded session, not
by me.** `handoffs/improve/evidence-pack.json` names a slate task. The picker's "discussed in a
prose document" rule scans `.md` and `.txt` only, so JSON artefacts with free-text fields sit
outside it. The session found it with a filename-only sweep **before locking**, did not open it, and
confirmed afterwards that the entry is a harness environment note with no bearing on the fix.
**Benign this time; the class is real.** `harness/task-overrides.json` is the same class.

### 4.2 The score

**Lock hash verified independently by me**, not taken on trust:
`b7b5ff263deeca79e7ac98d8e125c8cdf5f23ef807333b96d1410a84774a5918`, and the lock file's mtime
(10:40:33) precedes the results document (10:47:02), so the derive-then-reveal order holds.

| requirement (`NARROWED-CLAIM.md` §3) | result |
|---|---|
| 1. every new source module asserted, correct owning package | **FAIL** — 5 of 6; `Source.java` missed |
| 2. no missing export / overload / enumeration / predicate obligation | PASS |
| 3. no new source module asserted where the solution adds none | PASS — 2 of 2 refusals correct |
| 4. **zero high-confidence false positives across the slate** | **FAIL** — 3 |
| 5. all of 1–4 on all five tasks | **FAIL** — 3 of 5 |

**VERDICT: FAIL.** Per task: PASS · PASS · FAIL · FAIL · PASS.

Requirement 4 — the one added by the narrowing, to convert "no high-confidence node has ever been
wrong" from a happy accident into something scored — **failed on first contact.** Requirement 1
failed independently, so the verdict does not rest on how strictly false positives are counted; the
session reports both a strict and a lenient reading and the bar fails under both.

### 4.3 §3.E, the conversion screen: **NOT RUN**

The handoff is unconditional — "Do not run this if round 3 fails. Say the capability does not
survive." Round 3 failed. **The capability does not survive.** The `$1.25` is unspent.

**But the blinded session made an argument worth passing on rather than burying.** The conversion
question — *does handing an agent a correct obligation graph change its patch?* — **does not need
the derivation gate to pass first.** It can be run with two or three **hand-built** graphs, which
removes derivation from the experiment entirely. If a known-correct graph does not move the patch,
the derivation capability was never worth buying at any accuracy, and the whole line closes for a
fraction of round 4's cost. That is a cheaper and better-ordered experiment than the one §3.E
specifies, and it is a decision for the project owner rather than something to slip in here.

### 4.4 What should be preserved, and what must not be smuggled

**C-6 is dead as claimed.** Two sub-capabilities have not failed and should not be thrown away with
the verdict: new-module recall is **9 of 10** across rounds 2 and 3, and correct refusal is **4 of
4**. If some downstream use needs only "which package does this touch, and does it add a module at
all", that narrower question has better evidence than the claim just tested. **It is not what C-6
claimed and it must not be reported as a partial pass.**

**Round 4 is not recommended**, by the session and by the pre-commitment in `NARROWED-CLAIM.md` §5.
The two failure modes — forward-only derivation missing a type that already exists in the tree, and
confidence attaching to a whole node rather than to each clause inside it — are artefact-design
defects with known cheap repairs. Applying them and re-running on the last three new-module tasks
would be **tuning to the observed failure**, which is exactly what the freeze-then-draw order exists
to prevent. A repaired artefact is a new claim and needs its own pre-registration and its own pool.

### 4.5 A useful side effect for §6.1

The session verified all five goldens **by content**: "no golden showed post-fix content — every one
of the five was confirmed pre-fix by the absence of the thing its issue asks for." That is an
independent content-level check on five goldens, obtained for free, and it is the only positive
evidence in this document that any golden is what its directory name says. It also found two more
stray non-repository artefacts inside goldens (a `.sweet-search` index directory, alongside the
already-known `.vault-manifest.sha256`), and a second golden for one slate repository at a different
commit — a session globbing by repository name rather than by `<repo>@<sha>` would silently read the
wrong tree.

## 5. Phase 4 — the specification

The handoff asks for a **specification, not a corpus**, and gives a second reason for it beyond the
original one: the handoff's §0 shows this corpus cannot validate a replay-derived prediction, so a live-validated
task set is the only instrument that can settle anything.

### 5.1 The power analysis, computed on our own heterogeneity

Published guidance does not answer this question. The closest current work — *How Many Tasks Are
Enough for Agent Benchmark Decisions?* ([arXiv:2607.12338](https://arxiv.org/html/2607.12338v1)) —
reports what **fraction of an existing benchmark** suffices to order two systems (SWE-bench
Verified needs 90% of its tasks at a 0-point threshold; SWE-bench Lite has no sufficient budget by
95%), and supplies **no effect-size-to-N formula**. So the number was computed from our own
recorded paired variance instead, which is the correct source anyway: the spread that sizes Phase 4
is our task heterogeneity, not another benchmark's.

Script: [`phase1-scripts/d16-phase4-power.mjs`](./phase1-scripts/d16-phase4-power.mjs). Quantity is
the per-task paired `log(sweet/native)` ratio on `breakPricedCostUsd` — the scale a percentage cost
effect is actually expressed on, and the one that stops a single tail task from dominating a mean
of dollar differences. Degenerate rows excluded (§1.5 #8).

| harness | paired tasks | sd of paired log-ratio | widest single task |
|---|---|---|---|
| codex | 17 | 0.2805 | `oceanparcels__parcels-617` at −47% |
| opencode | 17 | 0.4956 | `mransan__ocaml-protoc-202` at −88% |
| claudecode | 11 | 0.3541 | `pytask-dev__pytask-210` at −62% |
| **pooled** | **45** | **0.3948** | |

**Tasks required, two-sided α = 0.05:**

| cost effect | n @ 80% power | n @ 90% power |
|---|---|---|
| 2% | 2,998 | 4,013 |
| **5%** | **465** | **623** |
| 10% | 111 | 148 |
| 15% | 47 | 62 |
| 20% | 25 | 33 |

**The headline number: detecting a 5% cost effect at 80% power needs about 465 tasks.** The current
paired corpus is 16–17. That is a factor of roughly 29, and it is the honest reason every small
lever in this programme has been undecidable on cost.

**One task can be worth hundreds.** Removing the single widest task cuts the requirement by 12% on
codex, 37% on claudecode, and **71% on opencode** — where 5% goes from 733 tasks to 63. That is the
whole argument for §5.2's stratification, and it is stronger than any argument from principle.

### 5.2 Strata and target counts

Stratify on the axis that drives the variance, which the table above shows is **cost scale**, not
language.

| stratum | definition | target n | why |
|---|---|---|---|
| S1 short | baseline rollout under 8k billed input tokens | 120 | cheap, high-n, carries the cost estimate |
| S2 medium | 8k–40k | 160 | the mode of the current corpus |
| S3 long | over 40k | 80 | where context-mass levers (C-3, C-4) can fire at all |
| S4 new-module | accepted solution authors a new source module | 60 | C-6's addressable class; currently **8%** of eligible tasks |
| S5 dependency-contract | issue turns on an external dependency's contract | 40 | C-5's class; census was 1-in-18, i.e. undecidable today |
| **total** | | **460** | matches the 5%-at-80% requirement |

Report **per stratum and pooled**, never pooled alone: §2.1 of `SLATE-A-CLOSE-RESULTS.md` already
records that C-4's sign flips by harness, and cost strata will do the same.

**Winsorise the paired log-ratio at the 5th/95th percentile for the headline, and publish the
un-winsorised number beside it.** Not trimming: trimming discards a real task. The +257% task is
real and belongs in the corpus; it just must not be allowed to set the confidence interval alone.

### 5.3 Solve is the binding constraint, and it is worse than cost

McNemar counts only **discordant** pairs — tasks where the two arms disagree. Everything else
carries no information about a solve difference.

| harness | discordant pairs | rate | tasks needed to call an 80/20 split of flips |
|---|---|---|---|
| codex | 2/17 | 11.8% | ~170 |
| opencode | 0/17 | 0.0% | unbounded at this rate |
| claudecode | 1/11 | 9.1% | ~220 |

**A corpus sized for a 5% cost effect (460) is roughly the right size for solve too, but only
because discordance is around 10%.** If a lever's solve effect is concentrated in a stratum, the
stratum's own discordance rate governs — S4 at n=60 cannot settle a solve claim by itself, and the
spec must say so rather than imply coverage it does not have.

### 5.4 Preflight gate every task must pass

Every candidate task must clear all of these **before** it enters the corpus, and the check must be
recorded per task, not asserted in prose:

1. **gold-FULL under the current config** — `env-ledger-sweep.mjs`, `f2pFrac === 1`, `p2pFails === 0`.
2. **Golden provenance stamped** — §6.1's `assertBaseCommit` passed and the stamp written. A task
   whose base tree cannot be proven is not a task.
3. **Base tree obtainable** and its history strippable (the `noBaseTree` exclusion).
4. **Non-empty issue text** and a non-empty accepted patch.
5. **Not in any prose document, results directory, or prior round** — the leak classes §4.1 lists.
6. **Runs to a terminal test verdict** under the run_tests shim, with §6.2's telemetry recording it.
7. **Repo not already burned** by an earlier round or another programme.

### 5.5 Seed and split policy

- Stratified random draw, **fixed published seed**, seed recorded in the spec before the draw.
- **60/40 dev / held-out**, stratified within each stratum, per `CLAUDE.md`'s benchmark rule.
- Held-out is **aggregate-only, at milestones only**, never inspected per query.
- **HO2 stays frozen and is not touched by any of this.**

### 5.6 Design lesson from current work, for whoever re-opens C-3

The strongest published result in this area is *Self-Compacting Language Model Agents*
([arXiv:2606.23525](https://arxiv.org/abs/2606.23525), 22 June 2026, Johns Hopkins / Apple). It
pairs a compaction tool the model itself invokes with a rubric saying **when to fire — a sub-task
has resolved, or the trajectory is converging — and when to suppress: mid-derivation, or when
stuck.** It reports up to 18.1 points on math and 5–9 on agentic search at 30–70% lower cost per
question, across six benchmarks and seven models.

**C-3's V1 shape fires exactly where that rubric says to suppress.** "Reset at the first edit" is
mid-derivation by definition: the agent has just decided what to change and has not yet proven it.
Our V3 sweep found the same thing empirically from the other direction — the sign only turns
negative when the trigger waits for a large accumulated context. The literature and our own surface
agree that the trigger must be **adaptive and model-invoked**, not a fixed structural point, and
that is the shape a future attempt should take. It is also a different lever from the one Slate A
specified, so it belongs in a new proposal rather than a revival of this one.

### 5.7 The constraint that has to be in the spec

**The development pool has three new-module tasks left, and round 3 spends all three.** So S4
cannot be filled from the existing pool at all — it needs fresh acquisition. Any Phase 4 plan that
assumes S4 can be drawn from what we have is wrong on arithmetic, and C-6 is the candidate that
depends on S4.


---

## 6. The two correctness items

### 6.1 Golden provenance — the stated bug is not the code, and the real one is worse

**What the handoff says.** `golden-build.mjs` does not check that `git checkout <base_commit>`
succeeded; when the commit is unreachable the checkout fails, the script proceeds, and the
fresh-init captures the repository's **default branch** — a post-fix tree under a directory named
for the base commit. A blinded gate handed that tree reads the answer out of its own working
directory.

**What the code does.** `sh()` is `execSync`, which throws on a non-zero exit, and
`git checkout <unreachable-sha>` exits 128. Verified directly rather than argued: `execSync` throws.
So a failed checkout **aborts** the build. The described silent path does not exist.

**The exposure that does exist, and it is larger.**

1. **Nothing records what was built, and the build then destroys the evidence.** The fresh-init runs
   `rm -rf .git && git init`, so afterwards `git rev-parse HEAD` returns a synthetic SHA that is the
   same shape for every task. A finished golden cannot be checked against its base commit by anyone,
   ever. That — not a swallowed exit code — is why "every golden built before 2026-08-13 is
   unverified" is true.
2. **A cache hit is decided by the DIRECTORY NAME.** Both builders return early when
   `<golden>/.sweet-search/codebase.db` and `<golden>/.git` exist. The key is
   `<repo>@<base_commit>`, so *any* directory under the right name is served as that task's base
   tree whatever is inside it. Composed with the recorded facts that the box's golden cache is not
   durable and gets rebuilt and restored, that is the live risk.

**The repair** — new module
[`harness/golden-provenance.mjs`](../../harness/golden-provenance.mjs), wired into **both**
builders (`golden-build.mjs` and `run-pilot.mjs`'s `prepareGolden`, which are deliberate copies of
each other):

- `assertBaseCommit(gdir, base)` runs **after the checkout and before the fresh-init** — the only
  window in which the answer is knowable — and throws with the commit it wanted.
- A stamp is written to `<GOLDEN_DIR>/.provenance/<key>.json` recording repo, base commit, the
  upstream tree hash, and the post-fresh-init tree hash. **The stamp is outside the golden tree on
  purpose**: the golden is copied wholesale into every rollout's working directory, so a file placed
  inside it would appear to the agent as an untracked file and could reach the graded patch. A test
  asserts `git status --porcelain` on the golden stays empty.
- The cache-hit path classifies before serving: `verified` / `unstamped` / `mismatch` / `treeDrift`.
  **`mismatch` and `treeDrift` are fatal and refuse to serve.** `unstamped` is loud but not fatal —
  it is *unknown*, not *known-wrong*, and saying otherwise would be its own kind of false precision.

**Two tree hashes, because they are not the same tree.** The upstream commit's tree and the
fresh-init commit's tree differ legitimately: `git add -A` on the re-initialised repository
re-applies `.gitignore` to files the upstream repository tracked in spite of it, and drops submodule
gitlinks. Only the post-fresh-init hash is comparable later. Conflating them would have made the
drift check fire on every golden — caught before shipping, not after.

**The sweep** — [`harness/golden-verify-sweep.mjs`](../../harness/golden-verify-sweep.mjs). Offline
mode classifies; `--deep` re-clones at the base commit, replays the byte-identical fresh-init, and
compares tree hashes, which settles an unstamped golden definitively.

**Run on the box, against the rotation task file:**

```
457 goldens present on the box; 18 belong to tasks_full_luna_rotate20.json
verified 0   unstamped 18   mismatch 0   treeDrift 0
```

**All 18 are unstamped.** That is the handoff's claim, now measured rather than asserted. None is
*known* wrong. `--deep` would settle them but needs the network-lockdown-off window, and running it
during a live A/B would have changed egress state mid-experiment — see §9.

**Tests:** [`tests/golden-provenance.mjs`](../../tests/golden-provenance.mjs), 24 assertions, green.
It builds real git repositories with a `base` commit and a post-fix default branch, constructs the
exact trap tree the handoff describes, and asserts the classifier catches it.

### 6.2 D-6 row telemetry — built, and a bigger finding underneath it

**Built.** `runTestsTelemetry()` in `harness/rt-inflight.mjs`, wired into all three CLI runners.
Four row columns: `rtLaunched`, `rtVerdicts`, `rtNoVerdict`, and `rtEndedUnverified` — true when the
rollout's **last** `run_tests` call carried no verdict, which is the shape of the original defect. A
mid-rollout unresolved launch that a later call attaches to and resolves is deliberately *not*
counted, because the fix is supposed to make exactly that case benign.

**One detail that would have made the telemetry lie.** It is fed the runner's **tool calls**, not
its trajectory. `buildTrajectory` truncates every result to 600 characters and the verdict footer is
the *last* line a completed run writes — so a long passing suite read off the trajectory would be
counted as "no verdict". A test asserts both readings on the same input and shows they disagree.
Measuring a fix's own telemetry through a lossy channel is the shape of error this whole handoff is
about.

**The bigger finding: D-6 is not in effect anywhere.**

`SLATE-A-CLOSE-RESULTS.md` §6 reports D-6 as "**Fixed, with a regression test**". It is not shipped:

- `git cat-file -e HEAD:eval/task-completion-bench/harness/rt-inflight.mjs` → **path absent from
  HEAD**. Same for `tests/rt-inflight.mjs`. Neither appears in any commit.
- `HEAD`'s `codex-task-runner.mjs` contains **zero** references to `RT_INFLIGHT_PATH`.
- The evidence box has **no** `rt-inflight.mjs`, and its `codex-task-runner.mjs` was byte-identical
  to `HEAD` before this session touched it.

So the running banner and the attach-do-not-relaunch behaviour have never executed on any rollout,
including this session's. The work exists only in one dirty working tree. **Nothing is broken by its
absence** — the box is self-consistent, because the runner that would import the module does not
reference it. But the close-out's claim that it is fixed is not true of anything that has run.

**This session did NOT deploy it**, deliberately. Shipping it would have changed the `run_tests`
shim between cells of a live A/B whose baseline had already run — the "never pool runs across a
shipped fix" trap (§1.5 #9). The telemetry is unit-tested locally and left undeployed, and the
deploy script carries a `WITH_D6=1` switch and a comment saying why it is off.

---

## 7. A benchmark-validity defect, found by accident

**Two of the five tasks in the programme's fixed control set pass with NO PATCH AT ALL.**

### 7.1 How it surfaced

§1.5's broken v5 cell submitted six empty patches. The grader was run on them anyway, and came back
with **`redboltz__mqtt_cpp-466` resolved and `statamic__cms-9029` resolved**, both reps,
`patchHunks=0`, `preds` `patchLen=0`, `predOk=false`. `epiforecasts__scoringutils-229` correctly
came back unresolved, so the grader was discriminating, not blanket-passing.

### 7.2 Confirmed deliberately, on the whole control set

A **null arm** was then run on purpose: `AGENT_TIMEOUT_MS=1000`, so the agent is killed after one
second and every prediction is necessarily empty. `$0.000` model spend, 0 tool calls on three of
five.

| control-set task | tool calls | patch hunks | **RESOLVED with an empty patch?** |
|---|---|---|---|
| `redboltz__mqtt_cpp-466` | 4 | 0 | **YES** |
| `statamic__cms-9029` | 4 | 0 | **YES** |
| `oceanparcels__parcels-617` | 0 | 0 | no |
| `epiforecasts__scoringutils-229` | 0 | 0 | no |
| `ontodev__robot-710` | 0 | 0 | no |

**2 of 5.** Three independent observations per affected task (v5 rep0, v5 rep1, the null arm), all
agreeing.

### 7.3 What it means

1. **Their FAIL_TO_PASS tests already pass on the base tree.** They are not tasks. Nothing an agent
   does can fail them and nothing it does earns them.
2. **The control set is 60% real.** `HANDOFF-SLATE-A-RESIDUE` §2.2 defines it as the five tasks that
   "resolve 2/2 in both arms on all three harnesses". Non-inferiority against `mqtt_cpp-466` and
   `cms-9029` proves nothing: they **cannot** break.
3. **The selection rule caused this.** Choosing tasks that always resolve, in both arms, on every
   harness, is close to a filter *for* tasks that resolve for free — a task with no failing test is
   guaranteed to satisfy it. The control set did not happen to contain two vacuous tasks; its
   definition selected for them.
4. **The environment ledger cannot catch it, and the gap is one line from a guard that already
   exists.** `env-ledger-sweep.mjs` certifies `gold-FULL`: the *gold patch* makes FAIL_TO_PASS pass
   (`gradeFromReportItem`, `f2pFrac === 1 && p2pFails.length === 0`). It never runs the base tree,
   so it never checks the complementary half — that the **base FAILS**. Both control tasks are
   `gold-valid`, `f2pFrac: 1`, `p2pFails: 0` in `results/c4-ledger-20260814/ledger.jsonl`, and both
   are free.

   The same *category* of defect is already guarded one branch earlier: `env-ledger.mjs:161-166`
   refuses to grade FULL when `f2pTot === 0`, with the comment *"An empty requirement set is a free
   pass"*. So the design already rejects one way of getting a task for nothing — a requirement set
   with no tests in it. It does not yet reject the other — a requirement set whose tests already
   pass. The proposed check is the missing sibling of a guard the authors wrote themselves.
5. **Solve rates that include them are inflated in BOTH arms.** The effect is arm-universal, so a
   head-to-head *delta* is largely protected; an absolute "resolved N of M" is not. Every such
   figure computed over a task set containing these two is overstated by however many of them it
   contains.

### 7.4 What this costs this session's own results

Said plainly rather than buried: **my C-3 control set was `scoringutils-229` + `mqtt_cpp-466` +
`cms-9029`, and two of those three are free.** So "solve 6/6 → 6/6" really means *2/2 held on the
one real task, plus four passes that could not have moved.* The C-3 kill does not depend on it —
C-3 died on the pre-registered proximal metric, which is measured per tool call and is unaffected —
but the **non-inferiority claim is much weaker than the 6/6 makes it look**, and anyone reading only
the table would not know that.

### 7.5 The fix, and what is still open

The missing gate is one line of policy: **a task is admissible only if the base tree FAILS its
FAIL_TO_PASS set.** That is a `$0` check — the null arm above *is* the check — and it should join
the Phase 4 preflight gate as §5.4 item 8, and be swept over the existing corpora.

### 7.6 How widespread is it? Bounded, and the answer is the interesting part

The null arm was then run over the **whole 17-task rotation** (`tasks_full_luna_rotate20.json`),
`$0.000`, one rep each.

| | |
|---|---|
| rollouts | 17 |
| usable (patch really was empty) | **14** |
| inconclusive (the 1s kill overran and the agent landed edits — see §9.3) | 3 |
| **resolved with an empty patch** | **2 of 14 = 14%** |

The two are the same two: `redboltz__mqtt_cpp-466` and `statamic__cms-9029`. The three inconclusive
tasks (`nimble_options-43`, `bingo-274`, `pytask-210`) all graded unresolved anyway, so none of them
is a hidden third.

**So the corpus is not broadly broken — and that makes the control-set number worse, not better.**

> Free tasks are **14% of the rotation** but **40% of the control set**.

That is not bad luck. A control set defined as "resolves 2/2 in both arms on all three harnesses"
is close to a filter *for* tasks that cannot fail, so it concentrates them — 2.9× here. **The
instrument built to detect a broken solve is disproportionately made of tasks whose solve cannot
break.** Any future control set has to be built from tasks that a null arm FAILS, and that check is
free.

---

## 8. Spend, itemised against the `$15` authorisation

**Metered model spend: `$0.00`. Authorised: ~`$15`. Used: none of it.**

Everything ran on `HARNESS=codex PROVIDER=openai CODEX_SUBSCRIPTION=1` — the ChatGPT-Max
subscription, which is flat-rate — or at `$0` from artifacts that already existed. No OpenRouter
request was made, so no metered request was made.

| # | cell | rollouts | metered | token-derived cost (breakPriced, for reference only) |
|---|---|---|---|---|
| 1 | `c3-probe-v1` — Gate 0 exposure probe | 1 | $0 | $0.007665 |
| 2 | `c3ab-off` — C-3 baseline | 6 | $0 | $0.032669 |
| 3 | `c3ab-v1` — C-3 context reset | 6 | $0 | $0.058646 |
| 4 | `c3ab-v5` — **INERT**, `resume` argv defect #1 | 6 | $0 | $0.036397 |
| 5 | `nullarm-controlset` — empty-patch grading | 5 | $0 | $0.006245 |
| 6 | `nullarm-rotate18` — validity sweep | 17 | $0 | $0.049638 |
| 7 | `c3ab-v5b` — **INERT**, `resume` argv defect #2 | 6 | $0 | $0.036416 |
| 8 | `r1ab-off` — R-1 baseline, ran clean | 6 | $0 | $0.037330 |
| 9 | `r1ab-map` — **INERT**, box auth expired (§9.4) | 6 | $0 | $0.000000 |
| — | `r1ab-map5`, `c3ab-v5c` — never started | 0 | $0 | — |
| | **total** | **69** | **$0** | **$0.265006** if it had been metered |

**The token-derived column is NOT a bill.** It is `breakPricedCostUsd` recovered from the rollout
transcripts at OpenRouter's `gpt-5.6-luna` rates, which is what the A/B is read on. Nobody was
charged it.

**Two costs that are real and are not in that table**, stated because omitting them is how the
sidechain defect happened in the first place:

- **This session's own model usage**, including two subagents (the Claude Code research agent and
  the blinded round-3 session). That is assistant spend, not benchmark spend, and this harness does
  not meter it.
- **Docker and wall clock** on the evidence box: roughly 2.5 hours of the machine, ~65 graded
  rollouts, and the per-task image GC that goes with them.

**Why the authorisation went unused, said plainly:** the two paid questions (§3.A and §3.B) turned
out to be answerable on the flat-rate harness and on evidence already bought, and C-6's `$1.25`
screen was correctly gated off by a failing round 3. That is a good outcome, not a shortfall — but
it also means **nothing here is cross-harness**. Every live number in this document is codex-only.
§9 lists what that costs.

**Nineteen of those 69 rollouts produced no usable measurement** — 12 to two `codex exec resume`
argv defects and 6 to the box's expired subscription token, with one further cell never started.
They cost `$0` and about forty minutes of wall clock, and every one of them is reported above as an
inert cell rather than as a result. That ratio is the honest price of running treatments that
nobody had run before; the alternative — quietly re-running until something looked like a number —
is how the three earlier failures in this programme happened.

---

## 9. What was not done, and where a number is softer than it looks

Listed because a partial result reported as clean is worse than an unrun one — it looks like
evidence and cannot be told apart later.

### 9.1 Every live number here is codex-only

The three-cell C-3 A/B, the R-1 cells and the null arms all ran on `codex`. Nothing was run on
`opencode` or `claude-code`. That is a direct consequence of using the flat-rate subscription to
avoid spending the authorisation, and it is a real limit:

- **C-4's live A/B inverted by different amounts on each harness** (+4.78 / +19.79 / +11.72%), and
  **C-9 was kept on one harness and dead on the others.** Harness is a first-order effect in this
  programme, and a single-harness result is a single-harness result.
- The `$0` surface in §1.2 *is* three-harness, and it is the part of the C-3 verdict that
  generalises. The live +79% is codex's number alone.
- **codex is the harness where C-3 looked WORST on the surface** (base prefix 0.66× the deleted
  context). opencode is the one harness where the surface was negative. So the live cell was run
  where the lever was already least likely to win. That is a real selection concern and it is the
  single biggest reason to treat the live cost number as directional rather than decisive. The
  *proximal metric* result — re-derivation up, not down — does not depend on it.

### 9.2 The C-3 control-set result is much weaker than "6/6 → 6/6" looks

Two of the three control tasks pass with an empty patch (§7). So the non-inferiority check had
**one** informative task, not three. C-3 did not die on solve, so this does not change the verdict —
but nobody should quote the 6/6.

### 9.3 `AGENT_TIMEOUT_MS` does not kill promptly, and it made 3 of 17 null rollouts unusable

`AGENT_TIMEOUT_MS=1000` was supposed to kill the agent after one second. Observed wall times were
**40–90 seconds**, and three rollouts landed patch hunks. Killing `nsenter` does not immediately
stop the process inside the namespace, so the agent keeps working past the deadline.

Consequence: **the null arm is valid only on rollouts that actually produced `patchHunks === 0`** —
14 of 17. The three that overran are reported as inconclusive rather than counted, and all three
graded unresolved anyway, so none is a hidden third free task. The control-set run in §7.2 had
`hunks = 0` on all five, so that result is unaffected.

This is also a harness finding in its own right: a timeout that overruns by 40–90× is worth knowing
about wherever `AGENT_TIMEOUT_MS` is used as a real bound.

### 9.4 The box's codex subscription auth expired mid-session, and the harness cannot survive it

**Symptom.** Partway through the R-1 run every rollout began returning zero tool calls and
`exit=codex_error`, carrying:

> `Your access token could not be refreshed because your refresh token was already used. Please log
> out and sign in again.`

**Diagnosis.** `/root/.codex/auth.json` is dated **2026-08-06 12:47** and its `id_token` expired
**2026-08-06T13:47:08Z** — eleven days before this session. The refresh token beside it is
single-use and has already been spent.

**Why it survived that long, and why it broke here.** `codex-task-runner.mjs` seeds the master
`~/.codex/auth.json` into a **per-rollout** `codex-home`, and never writes anything back. So each
rollout refreshes in its own private copy, uses the fresh access token, and throws the rotated
refresh token away when the rollout directory is torn down. The master file is therefore *never*
updated and every rollout re-presents the same aging credential. That works while the provider still
honours it and fails the moment it does not — and `CONCURRENCY=3` makes it fail faster, because
three rollouts race to redeem the same one-time refresh token and at most one can win.

**Blast radius, checked rather than assumed.** `grep -c "refresh token"` is **0** in every earlier
log — the probe, the three C-3 cells, both null arms, and the `r1ab-off` baseline. The first
occurrence is in the R-1 `map` cell. **No result reported in this document is contaminated by it**,
and the two cells that were killed are reported as unobtained rather than as nulls.

**What it costs and what fixes it.** It blocks all further live work on the box until someone runs
an interactive `codex login`, which this session cannot do. The durable fix is for the runner to
copy the refreshed `auth.json` **back** to the master after a rollout, or to refresh once up front
and seed the result — otherwise the box's subscription auth decays silently and the failure surfaces
as "the treatment produced zero tool calls", which is indistinguishable at a glance from a treatment
that destroyed the agent.

### 9.5 Golden provenance is repaired going forward, not backward

All 18 goldens for the rotation task file are **unstamped**. The sweep classifies them honestly and
`--deep` would settle them, but `--deep` needs the network-lockdown-off window, and running it
during a live A/B would have changed egress state mid-experiment. **Nothing in §6.1 proves any
existing golden is correct**; it proves the machinery to check them now exists and that none is
detectably wrong. The only positive evidence that any golden is what its name says is the blinded
session's content check on five of them (§4.5).

### 9.6 A false-positive tamper detection was observed and not chased

Rollouts in the null-arm sweep tripped `SHIM-TAMPERED` on `_rt_ipc/res-<id>` — the run_tests
broker's own IPC response file being classified as an unexpected state-directory entry. The policy
then re-ran them, at real wall-clock cost. It is arm-universal and does not bias an A/B, but it is
spurious work and an unexplained `shimTampered` in any row that carries it.

### 9.7 D-6 telemetry is written and tested but NOT deployed

Deliberately — see §6.2. It has never run against a real rollout, so its four columns are absent
from every row in this session's results. The tests exercise the logic, not the wiring.

### 9.8 No joint replay

`HANDOFF-EVIDENCE-DOCTRINE.md` §7 requires one joint replay of everything actually built, once, at
the end. Nothing shipped from this session that changes agent behaviour — C-3 and R-1 are both dead
and their runner code is flag-gated OFF by default — so there is nothing to replay jointly.

**But "the portfolio is C-4 alone" is now stale, and nobody has written down what replaced it.**
`SLATE-A-CLOSE-RESULTS.md` §9.7 made C-4 the sole survivor on a replay that reproduced every
harness's recorded cost to 100.0% and predicted −1.60 / −2.08 / −4.72%. That lever was then built,
deployed and run live, and measured **+4.78 / +19.79 / +11.72%** — a loss on all three harnesses,
+41.3% on claude-code excluding the never-solving task (`HANDOFF-SLATE-A-RESIDUE` §0). The handoff
uses that inversion as its opening lesson but never re-files C-4's verdict.

**So on the evidence as it stands, Slate A's portfolio is EMPTY, not "C-4 alone".** C-1 is shipped
and holding (0 of 184 corrupted anchors), but it is a correctness repair, not a cost lever. Someone
has to make that call explicitly rather than let a superseded sentence stand as the record — it is
the last open decision in Slate A.

### 9.9 Two sections of this document were written to the wrong directory for a while

Two `cat >>` appends ran without a `cd` and landed in `harness/SLATE-A-RESIDUE-RESULTS.md` instead
of this file. A later reordering script correctly reported both sections as absent; **I first read
that as the script having dropped them, and said so here, which was wrong** — nothing was ever
deleted. Both were re-written into this document, the stray file was removed, and the two copies
were compared before it was.

Recorded rather than quietly fixed, because the near-miss is instructive in both directions: a
shell append with no working directory is silent when it goes astray, and my first explanation of
the symptom blamed the wrong component. The check that settled it was `ls` on both paths, which is
the same discipline §7 needed — look at the artifact, do not infer it from the symptom.

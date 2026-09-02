# c11 — adversarial verify, DIFFERENTIAL and MEASURABILITY lens

**Verdict: REFUTED as a slate lever. Confidence 0.86.** The mechanism is real and I
reproduced every mechanism number independently. The lever fails on measurability. Its `$0`
falsifier cannot fail for a correct implementation, so it tests nothing. Its solve effect is
capped at 3 rollouts of 66 against a pre-registered bar of 6. Its measured addressable solve
population is **0 of 66**. Its cost effect is 12.4 times smaller than the standard error of
the cell mean it would have to move. And the change makes the sweet arm **dearer** on the one
harness where sweet currently reads cheaper, while native keeps a free subsidy 5.1 times
larger. c11 is a genuine product-correctness fix. It belongs in the E2 hygiene package, not
in a paid slate. I do **not** refute it on the differential axis, on the banned-compaction
axis, or on any hard rule.

Scripts: `/tmp/wf-slatec/c11-measurability/` on the evidence box (`c11_pop.py`,
`c11_solves.py`, `c11_x.py`, `c11_ctx.py`, `c11_esc.py`, `c11_thr.py`, `c11_free.py`).
Nothing was written under `results/`.

---

## 1. What I confirmed (the candidate is right about these)

| claim | my measurement | verdict |
|---|---|---|
| threshold about 30,000 characters | largest inline `ss-*` result **28,896** chars; smallest persisted result **30,208** bytes `[M c11_thr.py]` | CONFIRMED |
| stub form | `<persisted-output>Output too large (N). Full output saved to: <path>. Preview (first 2KB): ...` `[M c11_thr.py]` | CONFIRMED |
| nobody reads the file back | **0** tool inputs referencing `tool-results/` across 5 claude-code runs, both arms `[M c11_thr.py]` | CONFIRMED |
| persisted counts native/sweet 34/16, 0/12, 0/4, 26/2 | exactly reproduced `[M c11_pop.py]` | CONFIRMED |
| vehicle is sweet-only | `core/search/output-policy.js` `detectAgentEnv()` reads `CLAUDECODE` `[C]`; `_ss-helpers.mjs` renders only `ss-*` output; native's `grep`/`find` dumps are untouched | CONFIRMED — differential is **not** zero |
| the wrappers are a product surface | `package.json` `files` ships `eval/agent-read-workflows/bin/ss-{search,read,grep,find,semantic,trace}` and `_ss-helpers.mjs` `[C]` | CONFIRMED |
| build cost small | `_ss-helpers.mjs` already carries token budgets and a truncation affordance (lines 336, 425–426, 501, 666) `[C]` | CONFIRMED |
| replay is mechanically possible at `$0` | goldens exist on the box for all five affected repos, 454 of 457 carry a `.sweet-search` index `[M]` | CONFIRMED |

**Admissibility:** the bounding half delivers about **6,460 more real tokens** per event in
place of a 540-token stub. That changes *which lines* reach the model. It is **not** the
banned same-information compaction class (register B7). I clear it on that axis.

**Rule check:** no HO2 access; no gold, hidden test, or task identity as a runtime input; the
change touches rendering, not ranking, so the `_isAgentFormat` gate does not apply; `new_tool`
is correctly `false`; no owner decision is reopened. **No hard violation.**

---

## 2. Why it is refuted

### 2.1 The `$0` falsifier cannot fail for a correct implementation

The falsifier reads: replay the over-threshold `ss-*` invocations against the proposed
renderer, check every one lands under the threshold and the first 2,000 characters carry
header, verdict, top address and narrowing command.

Any renderer with a hard byte ceiling passes part (a) by construction. Part (b) is a template
check on four fields the renderer itself emits. The only way to score below 12 of 16 is to
implement the byte cap incorrectly. **That is a unit test, not a falsifier.** The lever's real
hypothesis — a bounded addressable result stops escalation and stops a size failure being read
as absence — is a claim about agent behaviour. No `$0` replay can test it. The register trap
is explicit: a fixed-trajectory replay gets the direction of a context change right about as
often as not, and never the size (C-4: replay −2.8%, live +4.8/+19.8/+11.7%).

### 2.2 The solve effect is structurally below the detection bar

`[M c11_pop.py]` In the production TAB form, `fp-claudecode-tab-20260826`, `ss-*` deletions
occur in **3 of 66 sweet rollouts**:

| task | rep | where | events | resolved | calls | cost |
|---|---|---|---|---|---|---|
| `aws-actions__configure-aws-credentials-42` | 1 | main | 1 | **True** | 23 | $0.011523 |
| `bfgroup__b2-259` | 0 | subagent | 2 | False | 224 | **null** |
| `devlooped__moq-1262` | 0 | main | 1 | False | 53 | $0.043536 |

The pre-registered bar is ±6 rollouts of 66. A lever that flipped **every** affected rollout
moves at most 3. **The maximum possible effect is half the bar.** No affordable run can
confirm this lever, whatever its true efficacy.

### 2.3 The measured addressable solve population is 0 of 66

`[M c11_solves.py, c11_x.py]`

- `aws-actions__configure-aws-credentials-42` **already resolves**: 3/3 sweet and 3/3 native
  in TAB, 3/3 sweet in NONE and PIPE, 3/3 both arms on codex, 3/3 native and 2/2 sweet on
  opencode. The deletion cost it nothing.
- `bfgroup__b2-259` is 0/3 in **both arms** in TAB, 0/3 sweet in NONE and PIPE, **0/3 both
  arms on codex**, **0/3 both arms on opencode**, and still 0/3 both arms after the shipped
  index fix (`fixval-claude-code-20260828`).
- `devlooped__moq-1262` is 0/3 both arms in TAB, 0/3 sweet in NONE and PIPE, **0/3 both arms
  on opencode**, 1/3 both arms on codex.

Codex and opencode have **no 30,000-character deletion rule** — opencode's largest untruncated
`ss-*` result is 26,208 characters and its ceiling is far higher; codex cuts the middle and
keeps both ends. A failure that reproduces identically on harnesses where the mechanism is
absent is not caused by the mechanism. **Addressable solves: 0 of 66.**

### 2.4 The cost effect is 12.4× below the standard error

`[M c11_price.py]` `fp-claudecode-tab-20260826`, sweet arm, n=66 rows of which 57 carry a
cost (9 null):

- mean cost per rollout **$0.015127**, median $0.010115
- **standard deviation $0.011230**, **standard error of the mean $0.001487**
- mean break-priced cost $0.013898; mean `idealTurns` 21.6, giving **$0.00070 per request**,
  which confirms the candidate's own per-request price `[I]`

The claimed effect is +$0.000118 per rollout. That is **12.4 times smaller than the standard
error of the cell mean**, and 8 to 40 times below the brief's stated ±$0.001–0.005 per-rollout
interval. Worse: **1 of the 3 affected rollouts carries `costRealizedUsd = null`**
(`bfgroup__b2-259` rep 0, `sidechainAccountingComplete = false`, 89 sidechain turns), so a
third of the affected population has no readable cost at all.

### 2.5 The differential runs the wrong way on the slate's headline axis

`[M c11_free.py]` Tokens the deletion rule removes free of charge in `fp-claudecode-tab-20260826`,
66 rollouts per arm:

| arm | events | deleted characters | deleted tokens | **deleted tokens per rollout** |
|---|---:|---:|---:|---:|
| native | 34 | 4,240,711 | ~1,060,177 | **16,063** |
| sweet (all) | 16 | 824,157 | ~206,039 | **3,122** |
| sweet, `ss-*` only | 4 | 166,581 | ~41,645 | **631** |

The harness's deletion rule is today a **5.1× larger free subsidy to native than to sweet**.
c11 hands back about 391 of sweet's 631 free `ss-*` tokens per rollout while native keeps its
16,063. The candidate states the sign against its own interest, which is honest, but it does
not state the size of the asymmetry it is walking into. On the axis the slate exists to move —
sweet at most as expensive as native — this is a step backwards.

### 2.6 The escalation offset is overstated by 2.3 to 4.1 times

`[M c11_esc.py]` Requests from each deletion to the next useful result, over all 17 true
events: **median 1, mean 1.71** (upper bound; two events had no later large result and were
capped at 2). Restricted to the production TAB form: **mean 2.0**. The candidate claims "4 to
7 further `ss-*` requests".

`[M c11_ctx.py]` The two production main-thread cases show why. On
`aws-actions__configure-aws-credentials-42` rep 1 the agent answered the deletion with one
narrower call (`ss-grep "getInput" --in dist/index.js -k 20`, 84 bytes) and then finished and
**solved**. On `devlooped__moq-1262` rep 0 the agent answered the deletion of a four-command
envelope by **splitting it into a smaller envelope** (7,469 bytes) and continued productively.
The agent already does the narrowing the candidate wants the renderer to advertise.

Redo the arithmetic at the measured rate. Added: 6,460 tokens × $0.301 per million resident =
**+$0.00194 per event**. Avoided at the production rate: 2.0 requests × $0.00070 =
**$0.00140 per event**. Net **+$0.00054 per event**, +$0.000033 per rollout, **+0.22%**. At
the all-events rate of 1.71 requests the net is +$0.00074 per event, +0.30%. Either way the
lever is **net dearer even under its own model** — the "+0.6%" headline assumes zero offset,
and it uses the brief's $0.020727 denominator; against this cell's measured mean of $0.015127
the gross figure is **+0.78%**.

### 2.7 The falsifier measures the wrong unit for the envelope cases

`[C]` Each `ss-*` is a bash script that runs `node "$DIR/_ss-helpers.mjs" <verb> "$@"` in its
own process. Invocations chained with `&&` in one Bash call share no state. claude-code
measures the **Bash tool result**, which is the concatenation of all of them.

`[M c11_esc.py]` **2 of the 17 events are `&&` envelopes**:
- `fp-claudecode-tab-20260826` `devlooped__moq-1262` sweet rep 0 main — four `ss-*` commands
  (`ss-search … -k 8 && ss-read src/Moq/MatcherFactory.cs 1 300 && ss-read src/Moq/Match.cs
  1 220 && ss-read …`), 30.6 KB.
- `rb-claudecode-20260824` `apple__swift-nio-http2-145` sweet rep 2 main — two commands
  (`ss-read … 680 735 && ss-trace receivePushPromise callers --in …`), 38.6 KB.

A per-invocation byte ceiling passes the falsifier on both while the Bash result still crosses
30,000 characters. **The falsifier as written can return a false PASS on 2 of its own cases.**

### 2.8 The population count is wrong, and its provenance is mixed

`[M c11_esc.py]` **17 true events, not 16 and not 18.** One counted event is a native
`grep -RInE` result of 80 KB, misclassified because the command line contains
`command -v ss-find || true; command -v ss-grep || true; …` — `fp-claudecode-none-20260826`,
`bfgroup__b2-113`, sweet, rep 1, subagent.

`[M]` **13 of the 17 (76%) sit on the two `bfgroup/b2` tasks.** Their deleted queries are
`ss-find ".jam" --regex "jam$|\.jam"`, `ss-read src/build/targets.py`, `ss-read
src/tools/builtin.py` — exactly the `.jam` indexing and git-tracked `src/build/` re-admission
paths that the **already-shipped** index fix (36b802e, fb9f936) targets. Pooling them into a
population violates the brief's "never pool runs across a shipped fix". Only **4 events** come
from the production TAB form, and the count across three runs of the same 22 tasks × 3 reps
swings 2 → 4 → 10, a 5× spread that is trajectory noise, not a stable rate.

The flagship exhibit — the `bfgroup__b2-259` `r2-38` subagent widening `-k` from 200 to 500
and then reporting "`ss-*` searches find only tests, no configure module" — is confounded. It
is in the **NONE** gutter form, not production; in a subagent; on a task that is 0/3 in both
arms on three harnesses; and the thing it could not find was genuinely not in the index at the
time. **After the index fix, `bfgroup__b2-259` is still 0/3 in both arms**
(`fixval-claude-code-20260828`) `[M]`. A bounded result would have delivered 28,000 characters
of the same absence.

### 2.9 The second kill condition cannot be evaluated at `$0`

"Post-fix population under 3 events per 198 sweet rollouts" needs a post-fix claude-code run
with transcripts. `[M]` The only post-index-fix claude-code run,
`fixval-claude-code-20260828`, has **no `agent-state` directory** — transcripts were not
retained. And 3 events per 198 rollouts is itself far below anything the ±6-of-66 bar can
resolve, so meeting the condition would not make the lever measurable.

### 2.10 Its own register check names its exit

The candidate says that below the population bar this is "E2-class hygiene". The measured
production-form population — 4 events, 3 rollouts, 0 addressable solves, cost 12× below the
standard error — is already below that bar. **By its own rule it is hygiene.**

---

## 3. One dependency the candidate does not flag

`[C]` `ss-search` prints `budget=${response.tokenBudget} used=${response.tokensUsed}` and
`ss-find` the same, computed inside the packer rather than over the bytes written. The sibling
seed measured the ratio of rendered tokens to declared `used` at 1.46 to 2.86, with a header
reading `budget=8000 used=1726` on a 33,200-character result. **c11 cannot state an honest
byte bound until that accounting is fixed.** It is not independently shippable as specified.

---

## 4. Corrections the synthesis must adopt

1. Population is **17 true `ss-*` deletion events** across four claude-code runs, not 16 or 18.
   One of the 18 is a native `grep -RInE` misattributed via `command -v ss-find`
   (`fp-claudecode-none-20260826`, `bfgroup__b2-113`, sweet, rep 1, subagent).
2. Production TAB form: **4 events in 3 of 66 sweet rollouts (4.5%)**. Quote this, not the
   pooled 16-across-198, which mixes two non-production gutter forms and a separate pool.
3. **Addressable solves: 0 of 66.** One affected rollout already resolved; the other two are on
   tasks that are 0/3 in both arms on harnesses with no deletion rule.
4. Recovery is **median 1, mean 1.71 requests** over all events and **mean 2.0** in the
   production form. Delete "4 to 7".
5. Net cost per event is **+$0.00054 to +$0.00074 (dearer)**, i.e. **+0.22% to +0.30%** per
   claude-code sweet rollout, not "+0.6% against a saving". The gross figure against this
   cell's measured mean of $0.015127 is +0.78%.
6. State the free-deletion asymmetry: **native 16,063 deleted tokens per rollout vs sweet
   3,122 (`ss-*` share 631)**, a 5.1× larger free subsidy to native. c11 reduces sweet's share
   of it.
7. The falsifier's unit must be the **Bash tool result**, not the `ss-*` invocation, and it
   must list the 2 `&&`-envelope events as expected **failures** of a per-invocation cap.
8. Replace the kill condition with one a run can reach: **the lever is inadmissible to a paid
   slate unless the production-form event population reaches ≥6 affected rollouts per 66**, and
   the addressable population must exclude rollouts already resolved and tasks that are 0/N in
   both arms on codex and opencode. On the recorded corpus it reaches 3 and 0.
9. Drop the `bfgroup__b2-259` "false absence" exhibit as support: it is confounded with the
   shipped `.jam` and `src/build/` index fix, and the task is still 0/3 in both arms after it.
10. Reclassify as **E2-class hygiene plus a real-user product-correctness fix**, sibling to
    register row D6. Real Claude Code users hit the same deletion on `ss-read` of a large file
    and get a stub with a path nobody opens. That framing needs no paid run and is honest.
11. Note the dependency on the rendered-size accounting fix; c11 is not independently
    shippable as specified.

**Revised ceiling to publish:** claude-code cost **+0.22% to +0.30% dearer** (gross +0.78%
before the recovery offset); codex 0.0%; opencode 0.0%. Solves: **0 measured addressable of
66**, maximum detectable movement 3 of 66 against a ±6 bar. Not a slate lever.

---

## 5. What I could not finish

- I could not price the post-index-fix population. `fixval-claude-code-20260828` kept no
  `agent-state`, so no post-fix claude-code transcript exists to count events in.
- I did not run the renderer replay itself. The goldens and indexes are present, so it is
  feasible at `$0`, but a passing replay would not change the verdict: the falsifier cannot
  fail for a correct implementation, and the population is below the detection bar either way.
- I did not open HO2, any grading log, or any hidden-test expectation. Every resolution figure
  here comes from the `resolved` and `f2pFrac` fields of `rows.json`.

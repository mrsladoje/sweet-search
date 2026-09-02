# c06 — adversarial verify, HISTORY lens

**Verdict: REFUTED. Confidence 0.90.**

Three recorded killing facts apply to this mechanism, and each one is sufficient on its own.
First, the parent row `F5` was gated on 2026-08-24 and the gate wrote a scope decision that
excludes exactly what c06 proposes. The gate says "One process, one language … **No
multi-language runner fleet, no corpus, no analyzer**", and "**Book `$0` of saving and `0`
extra solves until a live pilot shows otherwise. The ceiling the slate attaches to P6 is not
supported by this gate**" `[C W0-P6-GATE-RESULTS.md §4]`. c06's own build-cost line reads
"per-language tracers plus a reproduction driver". That is the fleet the gate refused, and
c06's headline is the ceiling the gate refused. Second, the 2026-08-28 research pass already
dispositioned this precise mechanism: "Do not re-open as a prompt. If re-opened at all, it
must be an `ss-*` runtime service that returns a diagnosis, **which is L2 wearing different
clothes**" `[C 07-research-resolution-levers.md L7]`. L2 is C-3, which is register row `E10`,
**DEAD live** at **+79% cost** against a `$0`-surface prediction of +3% to +9.5%
`[M register E10 / PHASE-1-RESULTS.md §4]`. c06 says "tracer cost unknown", which is the same
unpriced hole that overshot by 8 to 26 times the last time this vehicle class was measured
live. Third, the execution half is `P3`/`F2`'s `ss-witness` — "issue-derived executable
behavior … from the issue, base source, and public behavior" `[C SLATE-B-UBER.md §P3 item 2]`
— and `F2` is **DEAD**, blinded 1 of 8 against a bar of 3 `[M register F2]`.

**A separate feasibility block is decisive and is not on the register yet.** The reproduction
cannot run in the agent's workspace, and a sweet-side tracer cannot enter the test container.
`[M]` **0 of 22 fresh-pool goldens carry installed dependencies.** `[M]` **42 "Cannot find
module" errors appear across 5 of the 6 `markup-it` cells, 14 of them naming `immutable`**,
which is the first `require` of the file the candidate wants traced. `[M]` **0 `dotnet`
invocations appear in all 18 `moq` cells**, and the box has no system .NET at all. The
container route is closed by an escape fix, not by an accident: the jail masks the docker
socket, the docker client and every container layer store, because "**task images carry the
full git history of the repo including the fix commit**" and the layer store exposes the task
specification with `patch`, `test_patch`, FAIL_TO_PASS and PASS_TO_PASS `[C agent-jail.mjs
§V5, §V5b]`.

**One correction the synthesis must adopt: the candidate's own `$0` falsifier is aimed at the
wrong object, and running it as written would have let c06 survive.** `[M]` The container
executes C# offline in **every** `moq` cell — **210 `run_tests` verdicts, 0 of them INFRA** —
and executes JavaScript in every `markup-it` cell. The candidate's guess that "a .NET restore
is likely INFRA" is **refuted by measurement**. The blocker is reachability, not the image.

Two parts of c06 survive and neither is a lever. The `moq` fact class is a real new forensics
entry. The "no cell ever ran the round trip" observation is a measurement item.

---

## 1. What I opened

| item | path or command |
|---|---|
| brief | `slate-c/BRIEF.md`, whole file |
| draft register | `slate-c/DEAD-LEVER-REGISTER-DRAFT.md`, whole file |
| canonical register | `slate-c/register/DEAD-LEVER-REGISTER.md` — §0, §0.1, §0.2, §0.3, §6 (F1–F20), §7, §8, rows B12, E5, E9, E10, E13, G19, H1, H2 |
| candidate, merged form | `slate-c/candidates/DEDUP.md` lines 125–139, 283, 314 |
| candidate, source form | `slate-c/candidates/resolution-computed-facts.md` §3.6, §3.7, §3.8, §4, §5, §D, §7, §8 |
| upstream forensics | `slate-c/forensics/wrongfix-facts.md` §2.3, §2.6 |
| F5 primary source | `handoffs/improve/W0-P6-GATE-RESULTS.md`, whole file (141 lines) |
| ladder primary source | `handoffs/improve/HINT-LADDER-RESULTS.md` §"CodeceptJS: adding the one runtime fact", §"Fifth", §recommendations |
| L7 disposition | `handoffs/improve/harness-gutter-cost-20260828/07-research-resolution-levers.md` §3.1, L2, L7, L8 |
| P3 specification | `handoffs/improve/SLATE-B-UBER.md` §P3, §P6 |
| harness code | `harness/run-pilot.mjs`, `harness/evaluator-runtime.mjs`, `harness/agent-runner-shared.mjs`, `harness/rt-shim-runtime.mjs`, `harness/rt-condense-lib.mjs`, `harness/agent-jail.mjs`, `harness/dep-materialise.mjs`, `harness/codex-task-runner.mjs` |
| evidence box | `root@167.233.69.121`, read-only; scratch `/tmp/wf-slatec/c06-history/` |

I did not open HO2 task lists or any `ho2-*` run. I read grading-adjacent material only to
classify recorded outcomes, and I name no hidden test and no reference-patch content.

---

## 2. History kill 1 — F5's gate already refused this build and this ceiling

`F5` is the row c06 names as its parent. The register keeps it PARKED with two conditions
attached `[C register §6 row F5]`. The gate document behind that row is explicit.

Quoting the disposition `[C W0-P6-GATE-RESULTS.md §4]`:

- "**One process, one language.** A node process that loads the public factory in the repo
  under test … **No multi-language runner fleet, no corpus, no analyzer.**"
- "**Book `$0` of saving and `0` extra solves until a live pilot shows otherwise.** The ceiling
  the slate attaches to P6 … is **not** supported by this gate."
- "**Before any paid pilot, price rejection.** Measure solves lost, not only tasks won."

c06 asks for the opposite of the first bullet. Its own field reads
`"build_cost":"Large."` and the source form says "Large: per-language tracers". Its headline
is a ceiling of "+8 sweet at 100% flip", which is the second bullet's forbidden move.

The hint ladder repeats the same scope ruling in its own words `[C HINT-LADDER-RESULTS.md
recommendation 4]`: "The whole CodeceptJS gap is one runtime property. That is a small local
process that loads a module and reports its enumerable keys, **not the language-runner fleet
P6 sketched**."

**Does c06's evidence post-date the killing fact?** Partly, and it does not escape. The
`moq` and `markup-it` forensics are dated 2026-09-02, after the 2026-08-24 gate. They supply a
new **target**. They say nothing about the gate's three refusals, which are about **build
scope**, **unearned ceilings** and **unpriced rejection**. New forensics about which fact is
missing on one task does not lift a scope decision.

---

## 3. History kill 2 — the 08-28 research already routed this mechanism into a dead row

`07-research-resolution-levers.md` L7 is "Reproduce, then diagnose at runtime, then fix".
That is c06's mechanism in one line. Its disposition `[C L7]`:

> "Do not re-open as a prompt. If re-opened at all, it must be an `ss-*` runtime service that
> returns a diagnosis, **which is L2 wearing different clothes**."

L2 is "Exploration handed to a cheap specialist that returns paths, line ranges and a cause",
marked "This is C-3 in `SLATE-A-UBER.md` §5" `[C L2]`. C-3 is register row **E10**, and E10 is
**DEAD** with this recorded fact `[M register E10]`:

> "Re-opened live 2026-08-17: the pre-registered metric, re-derivations per rollout, moved the
> **wrong** way, 0.00 → 1.33; calls 6.8 → 12.5; live cost **+79%** against a `$0`-surface
> prediction of +3% to +9.5%."

c06 dismisses E10 in one clause — "E10 DEAD (context reset) — this resets nothing". That
dismissal is on the wrong axis. E10 did not die of context reset. It died of **live cost**,
and of a `$0` estimate that was wrong by 8 to 26 times. c06 carries the identical hole,
written in its own text as "Tracer cost unknown" and "Per-rollout tracer cost unknown".

L7 also carries the field's own counter-evidence `[W, cited in §3.1 of the same document]`:
one disciplined study moved evidence quality by 7.4 points and repair success by nothing, and
the reproduction paper's own preliminary study says naive reproduction guidance is "neutral to
negative". The register books L7 itself as **F13, SHIPPED as shared correctness, "never claim
as a sweet win"** `[M register F13]`.

---

## 4. History kill 3 — the execution half is P3, which is dead

`SLATE-B-UBER.md` §P3 item 2 defines `ss-witness` as "**issue-derived executable behavior.**
Generate a small repo-native witness from the issue, base source, and public behavior — without
hidden-test or gold-patch knowledge" `[C]`. The same section prices the build: "A general
multi-language witness compiler and test-output parser **likely costs months**" `[C]`.

Register row `F2` records the outcome: **DEAD**, "Blinded run after de-contamination: **FAIL,
1 of 8** against a pre-registered bar of 3" `[M register F2]`.

c06 distinguishes itself from `F6` (the forge) by saying "F6 executes for a verdict, this for
a fact". That distinction is real and I accept it for the **output**. It does not touch the
**substrate**. The unbuilt thing in P3, in P6 and in c06 is the same: a multi-language runner
that loads the repository under test and executes issue-derived code. Three separate gates
have now declined to fund it. c06 is the fourth request.

---

## 5. Feasibility — measured, and it blocks both delivery routes

c06 says the tracer runs "inside the test container". There are only two places code can run:
the agent's workspace, and the graded container. I measured both.

### 5.1 The workspace cannot run either reproduction `[M]`

`[M]` Command: `python3` over
`results/fp-codex-tab-20260826/sweet/tasks.json` cross-referenced against
`/root/.ss-eval/golden/` on the box. **22 of 22 fresh-pool goldens matched a golden directory.
1 carries any dependency-shaped directory, and that one is a repository-tracked `vendor/`
holding a README and an empty submodule directory** (`aio-libs__aiohttp`, `git ls-files vendor`
returns 1 path). Effectively **0 of 22 goldens carry installed dependencies**.

`[M]` The two named targets specifically:
`GitbookIO__markup-it@e06072d…` has **no `node_modules`**;
`devlooped__moq@6c7e7a1…` has **no restored package tree**.

`[M]` Toolchains on the box: `dotnet` **MISSING** from `PATH`; no `/usr/share/dotnet`; no
`/usr/lib/dotnet`. A private copy exists at `/root/.dotnet/dotnet`.
`[C]` The jail masks `$HOME` wholesale and whitelists back exactly three paths — `.gitconfig`,
`.local/bin`, `.cache/sweet-search` `[agent-jail.mjs §1 and §4]`. `/root/.dotnet` is not one of
them. **The agent has no .NET at all.**

`[M]` The recorded rollouts prove this, not just the layout. Counts of the string
"Cannot find module" under
`results/<run>/agent-state/gitbookio__markup-it-56-<arm>/`:

| run | arm | "Cannot find module" | of which `immutable` |
|---|---|---:|---:|
| `fp-codex-tab-20260826` | native | 6 | 2 |
| `fp-codex-tab-20260826` | sweet | 4 | 0 |
| `fp-opencode-tab-20260826` | native | 0 | 0 |
| `fp-opencode-tab-20260826` | sweet | 10 | 2 |
| `fp-claudecode-tab-20260826` | native | 10 | 8 |
| `fp-claudecode-tab-20260826` | sweet | 12 | 2 |
| **total** | | **42** | **14** |

Exhibit rollouts `[M]`:
`fp-codex-tab-20260826/agent-state/gitbookio__markup-it-56-native/codex-home/sessions/2026/08/27/rollout-2026-08-27T00-56-10-01a040b7-9cb6-7491-ad22-848580e78a62.jsonl`
and `…/rollout-2026-08-27T00-58-19-01a040b9-9421-72e3-a44a-fdac13c86083.jsonl`.
`[M]` `src/markdown/inlines/html.js` line 1 is `const { List } = require('immutable');`, and
the package declares 23 runtime dependencies. Loading that file without `node_modules` is
impossible. **This is also the true cause of the forensics finding c06 cites**: the 18 of 18
cells that "ran a node evaluation" ran a standalone re-implementation, because the repository's
own module could not be loaded.

`[M]` Counts over `results/<run>/agent-state/devlooped__moq-1262-<arm>/`, all six cells:
**0 occurrences of `dotnet build`, `dotnet test` or `dotnet run`; 0 occurrences of `mono` or
`csc`.** No agent attempted it, and none could have.

`[C]` The benchmark frame states the constraint to **both** arms:
"Your shell does NOT have the repository's dependencies installed, so running the test
runner/build directly … will fail with dependency/build errors" `[codex-task-runner.mjs:110,
byte-identical across the three harnesses per agent-runner-shared.mjs]`.

`[C]` A dependency-materialisation path exists and is **off**: `SS_DEPS=1` in
`run-pilot.mjs:596`, with the comment "OFF by default so the standing baseline stays
byte-identical; when on it runs for **BOTH** arms, because a corpus only sweet can reach is a
manufactured differential". `[C]` Its recipes cover **python and node only** — there is no .NET
recipe — so even switching it on delivers nothing to `moq`, which is 100% of c06's solve
ceiling. Switching it on is also arm-symmetric, so it cannot make a differential.

### 5.2 The container cannot be reached, by design `[C]`

`[C agent-runner-shared.mjs` header, lines 8–15]:

> "That direct reach IS escape vector V5 — the task images carry the fix commit, and the
> forensics caught `git show <fix-sha>` and `docker cp` of an image tree being used to write
> the gold patch. **Under the jail there is no docker socket and no docker client**, so every
> harness now goes through the host-side broker."

`[C agent-jail.mjs §2]` masks `/var/run/docker.sock`, `/run/docker.sock`, `/usr/bin/docker`,
`/usr/local/bin/docker`, `/usr/bin/ctr`, `/usr/bin/nerdctl`, and then §V5b masks
`/var/lib/docker`, `/var/lib/containerd`, `/var/lib/containers`, `/var/lib/podman`,
`/var/lib/buildkit`, `/run/containerd`, `/var/lib/nerdctl`, because "containerd unpacks every
image layer as plain files on the host … the whole task spec is just readable as files",
including `patch`, `test_patch`, FAIL_TO_PASS and PASS_TO_PASS.

`[C rt-shim-runtime.mjs buildSuiteScript]` The in-container script is fixed and has four steps:
`git reset --hard HEAD`; host-supplied fixes filtered to `sed -i` "so a malformed spec cannot
smuggle an arbitrary command into the container"; `git apply /patch/agent.diff`; run the
canonical test command.
`[C rt-condense-lib.mjs sanitizeTestPattern / applyTestPattern]` The only agent-supplied input
is a test-name pattern stripped to `[A-Za-z0-9_.:*/\- ]` and appended as a runner filter flag.
`[C rt-shim-runtime.mjs runTestsWithLevers]` The tree that travels is
`git diff HEAD -- . ':(exclude).sweet-search'`, so untracked files never arrive.

**Consequence.** A sweet-side tracer can only enter the container through a new bench-harness
verb that mounts and executes agent-side code inside the image. That verb re-opens V5 and
V5b. It also collides with BRIEF rule 10, because the image filesystem holds the gold patch
and the hidden tests. And a verb added to the shared harness reaches both arms, which is BRIEF
rule 6, zero differential.

**The one route that does exist is already on the register.** An agent can add a test file the
canonical suite discovers, which then executes inside the container. That is `F12`,
issue-derived acceptance — **PARKED, shared, zero differential** `[M register F12]`.

### 5.3 Correction — the candidate's falsifier would have passed

c06's `$0` falsifier: "check whether the `moq` and `markup-it` goldens build and execute their
reproduction offline in the bench container image". Its kill condition: "fewer than half of
the C#/JS tasks with a fenced reproduction can execute it offline in the container".

`[M]` I ran it. Counts of `[run_tests verdict] status=<S>` under
`results/<run>/agent-state/<task>-<arm>/`:

| task | run | native | sweet |
|---|---|---|---|
| `devlooped__moq-1262` | `fp-codex-tab-20260826` | 24 FAIL, 0 INFRA | 29 FAIL, 0 INFRA |
| `devlooped__moq-1262` | `fp-opencode-tab-20260826` | 36 FAIL, 0 INFRA | 64 FAIL, 0 INFRA |
| `devlooped__moq-1262` | `fp-claudecode-tab-20260826` | 31 FAIL, 0 INFRA | 26 FAIL, 0 INFRA |
| `gitbookio__markup-it-56` | `fp-codex-tab-20260826` | 9 PASS, 2 FAIL | 6 PASS, 1 FAIL |
| `gitbookio__markup-it-56` | `fp-opencode-tab-20260826` | 12 PASS | 12 PASS, 8 FAIL |
| `gitbookio__markup-it-56` | `fp-claudecode-tab-20260826` | 15 PASS | 17 PASS, 2 FAIL |

**`moq` totals 210 non-INFRA C# suite executions and 0 INFRA.** `[M]` Its recorded install
recipe is `dotnet-install.sh -c 6.0` then `dotnet build`, baked at image build time, and its
test command is `dotnet test --framework net6.0`. `[M]` `markup-it` installs
`npm install --legacy-peer-deps` at image build time and tests with a local `mocha`.
`[C]` Both run under `--network none` when the lockdown is on, which is the default.
`[M]` `accenture__sfmc-devtools-1974` is the only fresh-pool task with INFRA verdicts, which
reproduces `resolution-computed-facts.md` §3.7.

So the sentence "the container blocks dependency installs … so a .NET restore is likely INFRA"
is **wrong**. The container installs nothing at run time; the image is prepared. The falsifier
as written **passes**, and a synthesis that runs it would wrongly conclude c06 survives. The
correct falsifier is a **reachability** one, and §5.2 answers it at `$0`: there is no route.

---

## 6. Ceiling — smaller than claimed, and it is parity, not a win

`[M]` `rows.json` over the three `fp-*-tab-20260826` runs:

| task | cells | resolved | which |
|---|---:|---:|---|
| `devlooped__moq-1262` | 18 | 2 | codex native rep 1; codex sweet rep 2 |
| `gitbookio__markup-it-56` | 18 | 0 | — |

`[M]` `rp-oc-tab-20260827` adds 3 more `moq` sweet cells, all unresolved. So sweet's losing
`moq` cells number **8** on the fresh pool and **11** including the opencode repair pass.
c06's "8 sweet" is the fresh-pool figure and is correct.

`[I]` What a **100% flip** of those 8 buys, against `BRIEF.md` §1:

| harness | native | sweet today | sweet + moq flip | result |
|---|---:|---:|---:|---|
| codex | 41/66 | 39/66 | 41/66 | parity |
| opencode | 41/66 | 41/66 | 44/66 | +3 |
| claude-code | 43/66 | 40/66 | 43/66 | parity |

A perfect flip reaches **parity on two of three harnesses and +3 on one**. It does not clear
the ±6 bar on any single harness. At the ladder's runtime-fact rate of 2 of 4 it is about +4
across all three and clears nothing `[I]`.

Two further reductions:
- `[M]` `markup-it` contributes **0 solves**. c06's own source says the crash fact alone would
  not have flipped the two cells that touched the serializer, because they kept the wrong
  receiver `[C wrongfix-facts.md §2.3]`.
- `[M]` **Native won one of `moq`'s two solves** (codex native rep 1). The task is not a
  native blind spot, which weakens "why native cannot match".

`[C]` And c06 is not the only route to its own fact. `wrongfix-facts.md` §2.6 records the same
fact as "**or computable argument provenance** through the partial evaluator (harder)". That
static route lives in c05's family, needs no runtime, and needs no new escape surface.

The whole ceiling is therefore **one task on one pool**. That is exactly `F9`'s open problem
restated — "each checker generalizes to about one file in 152,270" `[M register F9]` — not an
escape from it.

---

## 7. Where the candidate is right

State these plainly so the synthesis does not over-correct.

1. `[M]` The `moq` fact class is genuinely new to the record. `wrongfix-facts.md` §2.6 marks it
   "**new** as a fact class", and I found no earlier row that names "which implementation is on
   the deciding path".
2. `[M]` The two named tasks are dead in every cell, so there is real headroom in principle:
   `moq` 16 of 18 lost, `markup-it` 18 of 18 lost.
3. `[M]` c06 is right that the fact is **descriptive**, so `F2`'s over-specification failure
   mode — a witness that rejected 11 solved rollouts — does not apply directly.
4. `[M]` c06 is right that `F5`'s "0 of 12 cells ever resolved" weakness is absent here,
   because `moq` has two recorded solves against which a certificate could be tested.
5. `[M]` The candidate is honest in its own text: "this is not a capability native lacks, only
   one it does not exercise". Keep that sentence in any summary.

None of this rescues it. The scope refusal, the pricing refusal, the dead execution substrate
and the two blocked delivery routes all stand independently.

---

## 8. Corrections the synthesis must adopt

1. **Delete** "Container blocks dependency installs (accenture INFRA), so .NET restore is
   likely INFRA — untested." **Replace with**: `[M]` the container executes the C# suite in all
   18 `moq` cells (210 verdicts, 0 INFRA) and the JS suite in all 18 `markup-it` cells;
   `accenture` is the only INFRA task in the pool.
2. **Replace the falsifier.** The written one passes and proves nothing. The correct `$0`
   falsifier is: "name the code path by which sweet-side code executes in the graded
   environment." `[C]` It is already answered: none exists, and the routes were masked as
   escape vectors V5 and V5b.
3. **State the ceiling as one task, and as parity.** A 100% flip of all 8 `moq` sweet cells
   gives codex parity, opencode +3, claude-code parity. It does not clear ±6 on any harness.
   Do not carry "+8" without that translation.
4. **Add the two register rows c06 omits**: `F13`/L7 (reproduce-then-diagnose, SHARED, "never
   claim as a sweet win") and `F12` (issue-derived acceptance, the only real in-container
   execution route, shared, zero differential).
5. **Re-state the E10 objection correctly.** E10 died of live cost +79% against a `$0`
   prediction of +3% to +9.5%, not of "context reset". c06's "tracer cost unknown" is that
   same hole.
6. **Correct the sweet-loser denominator**: 8 on the fresh pool, 11 including
   `rp-oc-tab-20260827`.
7. **Note the static alternative.** `wrongfix-facts.md` §2.6 offers "computable argument
   provenance" for the same `moq` fact. If the fact is worth anything, price the static route
   first, because it needs no runtime and no new escape surface.
8. **Flag the rule-10 hazard explicitly.** Any in-container execution verb puts sweet-authored
   code on a filesystem that holds the gold patch and the hidden tests.

---

## 9. Register rows this candidate matches

| row | verdict | why it applies |
|---|---|---|
| `F5` runtime public-surface probe (P6) | PARKED, with a scope decision | Same vehicle class. The gate refused a multi-language fleet and refused the ceiling. c06 asks for both. |
| `F13` reproduce-then-diagnose (L7) | SHIPPED as shared, never a sweet win | L7's own disposition routes any `ss-*` runtime-diagnosis service into L2. |
| `E10` ephemeral coprocessor (C-3 = L2) | DEAD live, +79% cost | The one live pricing of a sweet-only runtime service in this program. c06's cost is unknown. |
| `F2` executable issue witnesses (P3) | DEAD, blinded 1 of 8 | Same multi-language execution substrate, priced at "months". |
| `F9` delivered computed certificate | OPEN, generalization problem | c06's solve ceiling is one task, which is F9's pattern, not an escape from it. |
| `F12` issue-derived acceptance | PARKED, shared | The only in-container execution route an agent actually has. |
| `H2` jail egress and escape audit | SHIPPED, two items pending | c06's delivery route is the vector this row closed. |

---

## 10. What I could not finish

- `[M gap]` I could not launch the `moq` or `markup-it` images to time a tracer inside them.
  Neither image is on the box today — `docker images` lists 3 images and neither target is
  among them — and pulling multi-gigabyte images needs network and disk that this task does not
  authorise. My "the container executes offline" finding comes from **recorded** `run_tests`
  verdicts, not from a fresh container launch.
- `[M gap]` I did not price the tracer. c06 leaves it unknown, and no `$0` method reaches it.
- `[M gap]` I checked workspace runnability only for the two tasks c06 names, plus the
  dependency-directory census across all 22. I did not test whether any other fresh-pool
  repository could load its own source with no dependencies.
- `[M gap]` I did not verify the "16 of 22 issues carry fenced code, 11 runnable by heuristic"
  census. It is not load-bearing for this verdict.
- `[C gap]` I did not read `SLATE-A-UBER.md` §5 C-3 directly; I took E10's numbers from the
  canonical register row and from L2's cross-reference.

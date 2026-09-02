# Resolution via delivered computed facts — what recurs, how `ss-*` can surface it blind, and what it is worth

**Lens:** resolution-computed-facts · **Date:** 2026-09-02 · **Spend:** `$0` (static analysis over goldens, replay
over recorded patches, arithmetic; no rollouts) · **Box scratch:** `/tmp/wf-slatec/resolution-computed-facts/`
(read-only against `results/` and `/root/.ss-eval/golden/`) · **Scripts and summaries:**
`scripts-resolution-computed-facts/` next to this file.

## 0. Verdict

One computable fact class recurs on this pool and can be delivered without task identity, and its honest
ceiling is below the benchmark's own bar. The class is **argument provenance along the call graph**. It has
three faces. Only the cheapest face is static and language-generic: *what each caller passes* (the
`accenture` shape). I built that face as a prototype and ran it blind on the base tree. It names the
possibly-empty caller from `(file, method)` alone, flags 2 of 9 call sites, and fires on exactly the 15
`accenture` cells that edited the shared method and on no other cell of 390 `[M]`. The other two faces need
either Jam indirect-rule resolution (`b2-259`, 12 cells) or a runtime execution trace (`moq-1262`, 16 cells).
Neither is a regex job, so the static face reaches **6 losing cells on one task**, of which **2 are sweet cells**
(codex `c:s0`, claude-code `cc:s1`). At the hint ladder's best rate that is +1 solve on codex and +1 on
claude-code; at its realistic rate it is about +1 in total, against a pre-registered bar of ±6 `[I]`.

Two things raise the value of this class above its cell count. First, `accenture` is the only fresh-pool task
whose `run_tests` returned `status=INFRA` in **every cell of every harness** (network lockdown blocks dependency
installs) `[M]`, so the visible sibling test that pins the empty-selection path never reached any agent, and a
computed fact was the only channel left. Second, the delivery problem is now separable from the computation
problem: the agents call `ss-trace` about 0.2–0.6 times per rollout `[M]`, so an agent-invoked face reaches few
rollouts, while a sweet-installed post-edit hook (claude-code `PostToolUse additionalContext`, codex
`PostToolUse`, opencode `tool.execute.after`, all present in the pinned binaries per the harness-changelogs
report `[C]`) can trigger the computation on the agent's own edit with no task identity.

Two other candidates from the lens are negative results worth booking. The **definition-coherence face**
(sibling-literal closure, the `dashbitco`/`aiohttp` class) is **dead at `$0` in the form I could build**: it fires
on 1 of 390 fresh-pool cells (an irrelevant hit) and finds nothing on 0 of 12 recorded `dashbitco` patches, its
own positive control `[M]`. The **observation-site face** (`awslabs`) does surface the accessor the tests
observe, but its strict form fires on 1 of 10 test call sites `[M]` and its ceiling is one sweet cell. Two
correctness defects fell out of the graph census: the code graph holds **zero** entities for JavaScript private
methods (34 definitions in `accenture`, so `ss-trace '#runMethod'` returns `not_found`) and **zero** call edges
for Elixir (2,651 entities in `absinthe`) `[M]`.

## 1. Inputs, denominators, and what was read

- Register: `slate-c/register/DEAD-LEVER-REGISTER.md` (123 rows) read in full; `BRIEF.md` and the draft read
  in full; `forensics/wrongfix-facts.md` read in full and used as the classification of record; `HINT-LADDER-RESULTS.md`,
  `W0-P3/P4/P6-GATE-RESULTS.md`, `P2-RESIDUE-GATE-RESULTS.md`, `CLAUSE-SCREEN-RESULTS.md` read in full for the
  over-specification pricing.
- Cells: `fp-codex-tab-20260826`, `fp-opencode-tab-20260826` (sweet rows of the 11 repaired tasks in
  `/root/fresh-run/repair-tasks.txt` dropped), `rp-oc-tab-20260827`, `fp-claudecode-tab-20260826`. Patches from
  `<run>/<arm>/patches.json` and `<run>/<arm>/rep-N/patches.json`, joined to `rows.json` by `(taskId, arm, rep)`.
  Result: **390 cells** with a patch entry and a row `[M]` (codex 66+66; opencode 60 native + 66 sweet; claude 66+66).
- Base trees: `/root/.ss-eval/golden/<repo>@<base_commit>`; all 22 fresh-pool goldens present `[M]`
  (`data/tasks-safe.tsv`: instance id, language, repo, short sha; no gold fields exported).
- `tasks.json` was read for `instance_id`, `repo`, `base_commit`, `language`, `problem_statement` only. Gold patch,
  test patch and test lists were never read. Grading logs were not opened. HO2 untouched.

## 2. Which computations recur, and which are computable

The wrongfix report's 136 losing cells `[M]` sort into four computable classes and one runtime class. This
table adds what a blind computation over the base tree can and cannot do for each.

| class (wrongfix-facts §3) | tasks (losing cells) | static and language-generic? | what the prototype found `[M]` |
|---|---|---|---|
| argument provenance — **caller range** | accenture (6) | **yes**: call sites + argument expressions + possibly-empty flag | names `fixKeys:1642` and `replaceCbReference:1568` from the base tree alone; 2 of 9 sites flagged; fires on 15/18 accenture cells and 0/372 others |
| argument provenance — **call-site binding** | b2-259 (12) | **no**: the `check` rule is registered through `indirect.make` (configure.jam:605, 622) and invoked through `indirect.call $(i) $(context)` (property.jam:135) `[M]`; binding needs Jam indirect-rule resolution | not reachable by regex; the graph has 0 call edges from `.jam` |
| argument provenance — **consumer dispatch** | moq (16) | **no**: which `Equals` runs for `It.Is(...)` needs a runtime trace or an evaluator model | `Equals` has 65 call sites and 45 argument shapes in the graph-free scan; a static list is noise here |
| definition coherence | aiohttp (7); dashbitco (rotate20) | **not in the form tried**: literal provenance and same-line sibling closure | aiohttp: `keep-alive` 12 sites, `Connection` 40 sites, none is `should_close`; dashbitco control 0/12 |
| observation-site projection | awslabs (3) | **partly**: test call sites of the symbol and the accessor asserted after the call | `putDimensions`: 3 callers, 10 test call sites; strict form names `getDimensions` on 1 of 10 |
| sibling / family outlier | markup-it (necessary, not sufficient) | P2 died on this mechanism (98 false residues per resolved rollout) | not built; ceiling 0 on this pool because the merge shape is hidden-test-only |
| hidden-test-only | fastify, spectator, solhint, markup-it merge (72) | no computation applies | — |

State-space closure (the `apple` class, register F3) does not appear on this pool, which is consistent with its
one-file-in-152,270 prevalence.

## 3. Measurements

### 3.1 The caller-range face on `accenture`, run blind `[M]`

`binding_face.py <golden>/lib/index.js '#runMethod'` — input is only the file and the method name.

```
method #runMethod  defLine 1670  params [methodName, businessUnit, selectedTypes, keys]
callSites 9
 738  refresh              -
1425  (schedule)           -        (caller name approximate: header regex)
1437  publish              -
1448  validate             -
1460  execute              -
1472  pause                -
1484  stop                 -
1568  replaceCbReference   FLAGGED  selectedTypes <- "selectedTypesArr || selectedTypesObj"  (selectedTypesArr <- [], .push)
1642  fixKeys              FLAGGED  selectedTypes <- "selectedTypesArr || selectedTypesObj"  (selectedTypesArr <- [], .push, <- .filter)
```

The wrongfix report's `$0` kill conditions for this seed were "cannot name the empty-list caller from the base
tree alone" and "flags more than ~5 possibly-empty callees per task". Neither fires: the caller is named, and
the face flags 2 sites on this method and **0 possibly-empty arguments on any edited function of the other 21
tasks** (§3.2). The second flag (`replaceCbReference`) is a true possibly-empty site, not noise.

### 3.2 Trigger-conditioned census over 390 recorded patches `[M]`

`census_edited_functions.py` finds the base-tree function(s) each patch edits (brace/indent heuristics for JS,
TS, Python, C#, Go, Java, PHP, Elixir, Jam), then computes what each face would print for that function.
Denominator per cell is the number of cells with a patch entry and a row. "Fires" means at least one edited,
non-ambiguous function (defined once, name ≥ 4 chars) meets the condition.

| harness | arm | resolved | n | edited fn found | ≥2 call sites | single call site | possibly-empty arg | tests observe an accessor |
|---|---|---|---:|---:|---:|---:|---:|---:|
| codex | native | yes | 41 | 97.6% | 53.7% | 22.0% | 0.0% | 31.7% |
| codex | native | no | 25 | 64.0% | 24.0% | 16.0% | 12.0% | 12.0% |
| codex | sweet | yes | 39 | 100% | 53.8% | 17.9% | 2.6% | 28.2% |
| codex | sweet | no | 27 | 77.8% | 22.2% | 11.1% | 3.7% | 25.9% |
| opencode | native | yes | 35 | 100% | 48.6% | 22.9% | 5.7% | 31.4% |
| opencode | native | no | 25 | 76.0% | 32.0% | 4.0% | 4.0% | 20.0% |
| opencode | sweet | yes | 41 | 100% | 56.1% | 24.4% | 2.4% | 31.7% |
| opencode | sweet | no | 25 | 80.0% | 24.0% | 24.0% | 0.0% | 24.0% |
| claude-code | native | yes | 43 | 100% | 55.8% | 23.3% | 7.0% | 27.9% |
| claude-code | native | no | 23 | 56.5% | 17.4% | 17.4% | 0.0% | 21.7% |
| claude-code | sweet | yes | 40 | 100% | 55.0% | 17.5% | 5.0% | 22.5% |
| claude-code | sweet | no | 26 | 73.1% | 11.5% | 19.2% | 3.8% | 23.1% |

Reading. A face that prints "the callers and what they pass" would fire on about half of all solved edits.
That is a default trailer, and default trailers are the shape the register already killed (B19 caller list,
B8 pointers, B11 dossier). The **flagged** face (possibly-empty, fallback or filtered argument) fires on 15 cells
in 390, all on `accenture`: 9 solved and the 6 blanket-guard losers named by wrongfix WF-4 (`c:s0 c:n0 c:n1 c:n2
o:n1 cc:s1`), and on 0 of the 3 wrong-site cells (they edited `fixKeys`, not the shared method). So the flagged
face is task-relevant 15/15 times and never fires elsewhere. It does not discriminate solved from unsolved,
which is expected: it is information, not a verdict.

The unsolved rows have lower "edited fn found" because `markup-it` patches edit callbacks inside serializer
chains (17 of 18 cells have no enclosing named function) and some `b2` Jam rules are bare-name matches.

### 3.3 Observation-site face on `awslabs` `[M]`

`putDimensions` (MetricsContext.ts:91): 3 non-test callers, 10 test call sites. Loose rendering (any accessor
called within 8 lines of a test call) lists 9 accessors, `getDimensions` among them. Strict rendering (the
accessor inside `expect(...)` within 10 lines) names `getDimensions` on **1 of 10** sites. The face works in
principle and is weak in practice on this repository's test style (results are bound to locals first). The
fact class is the static cousin of register F5, and its recorded losses are 3 cells, 1 of them sweet (`c:s1`).

### 3.4 Definition-coherence face — dead at `$0` as built `[M]`

`coherence_face.py` extracts the literals a patch adds and (1) lists base-tree sites already consuming the
same literal, (2) checks whether a same-line sibling literal belongs to a declared collection the added literal
is missing from.

- Over 390 cells: closure fires **0/239** solved, **1/151** unsolved (`markup-it` native rep 0: `noframes`,
  `optgroup`, `option`, `param`, `script`, `section` vs `BLOCK_TAGS`, irrelevant to the task). Literal
  provenance fires 24/239 solved (10.0%) and 52/151 unsolved (34.4%), but the trail is long: for the 7
  header-conditioned `aiohttp` cells, `keep-alive` has 12 consuming sites (server side, `web_protocol.py`) and
  `Connection` has 40; none is `should_close`, the codebase's own definition of persistence.
- Positive control (`controls.py`): 12 `dashbitco` patches from `sb-{opencode,codex,claudecode}-20260811`
  (2 arms × 2 reps × 3 harnesses; 1 resolved). The same-line sibling form finds the owning list in **0 of 12**;
  the two hits are spurious (`options_schema`). Six of the 12 patches do touch the declaration, which also
  differs from the P3 gate's "11 of 11 did not" on a different patch set.

Why: the `dashbitco` shape puts the sibling atom in the *adjacent clause*, not on the added line, and the
`aiohttp` shape is a concept ("persistent") with no shared literal. An adjacent-clause form is a design
refinement, untested. The per-task witness (P3, 13/13) remains the only thing that has worked on this class.

### 3.5 Code-graph coverage on the 22 goldens `[M]` (`graph_cov.py`, `code-graph.db` read-only)

| golden | language | entities | `calls` edges | edges by source extension | JS/TS `#private` method definitions |
|---|---|---:|---:|---|---:|
| accenture | js | 7,758 | 5,546 | .js 3,496 | **34** (graph entities named `#…`: **0**; edges targeting `runMethod`: **0**) |
| absinthe | elixir | 2,651 | **0** | — | — |
| b2-259 | jam/cpp/py | 2,917 | 4,251 | .py 1,465 .cpp 534 .h 66 (**.jam 0**) | — |
| aiohttp | python | 6,190 | 11,594 | .py 11,353 | — |
| moq | csharp | 3,992 | 7,352 | .cs 7,128 | — |
| jts | java | 21,207 | 20,977 | .java 20,943 | — |
| spectator | php | 736 | 478 | .php 478 | — |

The goldens' indexes are dated 2026-07-16 (pre-E1), so the Jam figure is expected; the Elixir zero and the
private-method zero are not on the register. `traceSymbol()` returns `not_found` when `findEntityCandidates`
is empty `[C core/search/search-trace.js, core/graph/structural-context.js:297]`, so `ss-trace '#runMethod'`
cannot work today. The relationships table does store `context_line` per call edge `[C]`, which is the hook a
graph-backed binding face needs; argument text is not stored and would be read from source at that line.

### 3.6 Why the `b2` face is not static `[M][C]`

`src/build/configure.jam:509` and `:556` define `rule check ( properties * )`; `:605` and `:622` register it with
`indirect.make check : $(instance)`; `src/build/property.jam:135` invokes it as
`local new = [ indirect.call $(i) $(context) ] ;`. Binding `properties` to `context` therefore needs Jam-specific
resolution of an indirect rule through a registry variable, plus knowledge that the loop's accumulated value
lives one level up. (The wrongfix report cites line 129 for the same call; my grep finds it at 135 in the same
golden.) This is the "consumer dispatch" difficulty in a different language, not a caller-list problem.

### 3.7 `run_tests` was `INFRA` on `accenture` in every cell `[M]`

Grep of `[run_tests verdict] status=INFRA` over `agent-state/` (subagent files excluded): codex native 3/3
rollouts, sweet 3/3; opencode native 5 files, sweet 4 (fp) and 5 (rp); claude-code native 3/3, sweet 3/3. No
other fresh-pool task has an `INFRA` verdict. The trailer reads `[run_tests] NETWORK UNAVAILABLE in the test
container (bench lockdown): dependency downloads cannot work` and `baseline-diff … trustworthy=no`. All six
blanket-guard losers have `f2pFrac=1`, `ranTests=true`, `rtNoVerdict=0` `[M rows.json]`: they passed the target
behaviour, lost on a visible sibling path, and never saw a test result. Their final messages say "Ran
`run_tests`" and describe the guard as complete. The nine `accenture` solves were equally blind.

### 3.8 Demand and trigger availability `[M]`

- `ss-trace` invocations with an argument in sweet `agent-state`: codex 15 (66 rollouts), opencode 30 (fp) + 12
  (rp), claude-code 17 → about 0.2–0.6 per rollout, an upper bound because echoes count. Agent-invoked delivery
  reaches few rollouts (register E16: "the tool had the answer and the model never called it").
- Issue texts (problem statements only): 16 of 22 carry fenced code; 3 carry an error or stack trace; 11 pass a
  runnable-snippet heuristic (`moq` and `markup-it` are false negatives of the heuristic — one carries C# setup
  code, the other a markdown input). A runtime-probe trigger exists in roughly half to three quarters of issues.

## 4. How `ss-*` can surface a computed fact with no task identity

The hint ladder delivered facts through the issue text. That is a zero-differential channel and it knows the
task. Three sweet-only channels exist that know only what the agent is doing:

1. **The agent's own edit (recommended trigger).** A sweet-installed hook on the harness's edit tool receives
   the edited file and hunk, resolves the enclosing function in the working tree, runs the face, and returns the
   certificate as tool-result context. Vehicles, all read from the pinned binaries by the harness-changelogs
   report `[C]`: claude-code `PostToolUse` with `additionalContext`; codex 0.146.1 `PostToolUse` (33 string hits);
   opencode 1.18.4 plugin `tool.execute.after` (rewrites `output`). In the bench, `agent-runner-shared` writes
   sweet-only files (AGENTS.md, rules); the hook config would be written the same way, so the differential is
   sweet-only. In production `ss init` writes it. Cost per firing: the accenture certificate is 9 call-site
   tuples, about 450 characters, about 120 tokens; at 15–20 re-sends that is about $0.00004 per firing `[I]`.
2. **The traced symbol.** `ss-trace <symbol>` gains a `bindings` section: for each caller edge (the graph
   already stores `context_line`), the argument expression bound to each parameter, plus the possibly-empty
   flag. Same computation, agent-invoked, low demand (§3.8). Requires the private-method and Elixir graph fixes
   (§3.5) to be complete.
3. **The read span.** `ss-read` could append the same section when a span contains a function header. This is
   the B19/B8/B11 family (push context early; the pointer never followed; more context, more work) and I do
   not recommend it.

What the fact must look like, from the ladder's dose-response: a specific computed statement about *this*
function ("`fixKeys:1642` passes `selectedTypesArr || selectedTypesObj`; `selectedTypesArr` is initialised `[]`
and filtered, so it can be empty"), never a rule ("check the callers"), which scored 0/6.

## 5. Pricing the over-specification risk

The P3 gate priced a **prescriptive** artifact: a witness that says "wrong" blocked 11 solved rollouts and the
reference fix. The faces here are **descriptive**: they state what the base tree does and reject nothing, so
the P3 failure mode does not apply directly. The risks that do apply, and how to price each at `$0`:

| risk | mechanism | `$0` price | gate |
|---|---|---|---|
| noise | the fact fires where it is irrelevant | §3.2: ≥2-callers form fires on ~50% of solved edits; flagged form on 15/390 cells, all task-relevant | ship only the flagged form; ≤ 6 lines; report unflagged callers as a count |
| misleading truth | the fact is true but points away from the fix | replay on solved cells: does the printed fact contradict any solved patch? On accenture, 9/9 solved patches guard falsy-only or scope to the issue's method, consistent with the fact | pre-register: 0 solved cells whose patch contradicts the fact |
| more-context-more-work (B12) | any injected context raised live cost +4.8/+19.8/+11.7% | cannot be replayed (BRIEF §2.2 trap); the flagged form injects on ~4% of cells | live kill: cost per rollout on non-firing tasks moves > 1% |
| wrong computation | regex faces mis-bind (my first run mistook a call for the definition) | controls like P4's: run on the unmodified base first; assert the definition line; assert the flag set on a hand-built case | unit controls before any rollout |
| instruction deafness (A6) | the agent ignores the fact | F9 says facts land when computed; A6 killed instructions | live: solves on firing tasks vs sibling reps |

The strict pricing rule from P3 still binds any *prescriptive* variant (a "you guarded the wrong parameter"
verdict): measure solves lost, not only tasks won, before any paid pilot.

## 6. Candidates

### A. Edit-triggered call-site binding certificate (caller-range face first)

- **Family:** F9 computed certificate; new face (argument provenance, caller range) with a new delivery trigger.
- **Harnesses:** codex, opencode, claude-code (the loss is arm-universal; the vehicle is sweet-only).
- **Mechanism.** A sweet-installed post-edit hook resolves the function the edit touched, enumerates its call
  sites in the working tree, extracts the argument expression bound to each parameter, resolves simple
  identifiers to their definitions in the caller body, and prints only when an argument is possibly empty, a
  fallback (`a || b`, `??`, `or`), a filtered collection, or a literal that differs across callers. Output ≤ 6
  lines. The same computation is exposed as a `bindings` section of `ss-trace` (needs §3.5 graph fixes) so the
  agent can also ask for it.
- **Why native cannot match.** Native has `grep`; it can list callers but not bind and classify arguments. The
  wrongfix report shows the sites were on screen in the losing cells and the choice still went wrong; the
  computed binding, not the site, is the missing item.
- **Evidence.** §3.1 blind run; §3.2 census (fires 15/390, all `accenture`, includes the 6 WF-4 cells
  `fp-codex-tab-20260826` native r0/r1/r2 + sweet r0, `fp-opencode-tab-20260826` native r1,
  `fp-claudecode-tab-20260826` sweet r1); §3.7 (these cells had no test signal); wrongfix-facts §2.7, §5.
- **Ceiling per harness.** Addressable losing cells: codex 4 (1 sweet), opencode 1 (0 sweet), claude-code 1
  (1 sweet). Sweet-only differential at 100% flip: codex 39→40/66, claude-code 40→41/66, opencode 41/66 unchanged;
  at the ladder's non-closure rate (2/4) about +1 total `[I]`. Cost: about $0.00004 per firing, firing on ~4% of
  cells → under 0.1% of any cell `[I]`; if the unflagged ≥2-callers form ships instead, ~50% of edits fire and the
  price is ~0.7% of a codex/opencode rollout and ~0.4% of claude-code `[I]`. Dollars per rollout unchanged
  otherwise; requests unchanged (a hook adds no request).
- **Vehicle / sweet_only:** init-written harness hook config (bench: written by `agent-runner-shared` for the
  sweet arm only) plus `ss-trace` output; **sweet-only: yes**.
- **`$0` falsifier (done and to do).** Done: blind run names the empty caller (§3.1); replay over 390 patches
  (§3.2). To do before any build: (a) run the face on the unmodified base of all 22 goldens for every function
  with ≥ 2 callers and count flagged functions per repository; (b) replay solved cells and assert no printed
  fact contradicts the solved patch.
- **Kill condition (pre-registered).** Kill if (a) exceeds 5 flagged functions per repository on more than 4 of
  22 goldens, or (b) finds ≥ 1 solved cell contradicted, or a live smoke shows cost on non-firing tasks +1% or
  any control regression.
- **Register check.** B19 caller-set inline — DEAD because the caller *line* was already in the span; this
  prints the bound *expression* and a computed emptiness flag, which no span carries. B9 completeness card —
  DEAD on missed *sites*; here the sites were present. F8/P1 prose clauses — DEAD; this is a computed statement.
  F9 — this is a new face of the OPEN generalisation problem, with its `$0` falsifier now run. E7 — the
  `ss-trace` vehicle's open defects; §3.5 adds two. D3 (report where an edit landed) — the same hook carries it
  naturally (3 sweet-only wrong-site cells on `accenture`), but D3 stays measure-only. A6 — killed *instructions*;
  the harness-changelogs L-3 seed argues facts differ; this report supplies the computation L-3 lacked.
- **Build cost.** Face: one to two days for JS/TS/Python/C#/Go/Java on top of the existing `context_line`
  edges; the prototype is 200 lines. Hook plumbing: half a day per harness. Jam and consumer-dispatch faces: not
  in scope (§3.6, §2).
- **new_tool:** true (a hook component; the `ss-trace` section alone is false). **needs_user_decision:** yes —
  owner rule 11 (no new tools) and the boundary with A6 (mid-task content).
- **Solve risk.** Descriptive fact, no rejection; noise bounded by the flagged-only gate; B12-class extra work is
  the live risk and is unmeasurable by replay.

### B. Code-graph coverage: JavaScript private methods and Elixir call edges (correctness prerequisite)

- **Family:** E7 (`ss-trace` gaps), E1/E2 (index coverage).
- **Harnesses:** all three.
- **Mechanism.** `core/graph/graph-extractor.js` emits no entity for `#name(` methods and no `calls` edges for
  Elixir. Fix the JS/TS regex/tree-sitter alignment for `#private` members and add Elixir call extraction (or
  the same-file callsite fallback that already exists for C++). Jam call edges are a separate item under E1.
- **Why native cannot match.** Not a lever; a defect that makes `ss-trace` answer `not_found` on a repository
  whose shared method is private.
- **Evidence.** §3.5: 34 private-method definitions in `accenture` JS/TS, 0 graph entities named `#…`, 0 edges
  targeting `runMethod`; `absinthe` 2,651 entities and 0 `calls` edges.
- **Ceiling.** 0 solves, 0 cost; it is the prerequisite for the graph-backed path of candidate A and for any
  `ss-trace` use on such repositories.
- **Vehicle / sweet_only:** product code (graph extractor); sweet-only yes.
- **`$0` falsifier.** Count `#private` method definitions and Elixir entities-without-edges across the 457
  goldens with `graph_cov.py` extended; replay `traceSymbol` against a rebuilt local index on `accenture`.
- **Kill condition.** Kill as a priority (keep as a bug) if fewer than 5% of JS/TS goldens define a private
  method and Elixir is under 2% of goldens.
- **Register check.** E7 records a cross-file trace gap and refutes a Python claim; neither private methods nor
  Elixir zero-edges appear anywhere on the register or in the 08-28 documents.
- **Build cost.** Hours to a day. **new_tool:** false. **needs_user_decision:** no.
- **Solve risk.** None; correctness only.

### C. Definition-coherence face (sibling-literal closure) — DEAD at `$0` as built; book it

- **Family:** F3/F9 coherence class (dashbitco, aiohttp).
- **Harnesses:** all three.
- **Mechanism tried.** Post-edit: for each literal the patch adds, find declared collections that hold a
  same-line sibling literal but not the new one, and list the declaration's consumers; also list base-tree
  sites consuming the same literal.
- **Evidence.** §3.4: fires 0/239 solved, 1/151 unsolved (irrelevant); 0/12 on the `dashbitco` control;
  `aiohttp` literal trail 12–40 sites, none the owning predicate.
- **Ceiling.** 0 on the fresh pool as built; the class holds 7 fresh-pool cells and one rotate20 task.
- **Vehicle / sweet_only:** would be the same hook as A; sweet-only yes.
- **`$0` falsifier / kill.** Already run; the kill fired (miss on the positive control). Revival only through an
  adjacent-clause sibling form, which must first find the `dashbitco` list on ≥ 10 of 12 recorded patches.
- **Register check.** F2 (witness, DEAD as general compiler) and F3 (state closure, PARKED) are per-task
  certificates; this was the attempt at a general computation for the coherence class and it failed at `$0`.
  Not a duplicate: no row records a general coherence computation.
- **Build cost:** none further. **new_tool:** n/a. **needs_user_decision:** no. **Solve risk:** n/a.

### D. Runtime execution-path certificate (consumer dispatch; `moq`, `markup-it` round trip) — PARKED

- **Family:** F5 (runtime probe) lineage; new face (which implementation runs for the issue's input).
- **Harnesses:** all three.
- **Mechanism.** Run the issue's reproduction snippet under a tracer inside the test container and print the
  concrete call path for the named operation ("for this input `MethodExpectation.Equals` runs; `Match.Equals`
  is not on the path"; "round-tripping the input raises in `inlines/html.js:46`"). Trigger: an `ss-*` invocation
  that names a reproduction file, or the hook on the first edit.
- **Why native cannot match.** Native can run the snippet too; the differential is the tracer and the rendering,
  which are sweet-side. Honest: a strong native agent can reproduce this by hand (0/18 did for `markup-it`).
- **Evidence.** wrongfix §2.3 and §2.6 (13 of 16 `moq` losers patched the non-deciding path; 18/18 `markup-it`
  cells reproduced parse-only); §3.8 (16/22 issues carry fenced code; 11/22 runnable by heuristic); §3.7 (the
  container blocks dependency installs, so a .NET restore is likely `INFRA` too — untested).
- **Ceiling.** `moq` 16 cells (8 sweet: codex 2, opencode 3, claude-code 3) plus `markup-it`'s necessary-but-
  insufficient crash fact (0 solves alone). At 100% flip +8 sweet cells; at the ladder's runtime-fact rate
  (codeception 2/4) about +4 `[I]` — the only face on this pool whose ceiling could reach the ±6 bar with
  another task. Cost unknown: a tracer run per rollout.
- **Vehicle / sweet_only:** a new runtime tool; sweet-only yes. **new_tool:** true. **needs_user_decision:** yes
  (owner rule 11; F5's own "price rejection first" demand).
- **`$0` falsifier.** Check whether the `moq` and `markup-it` goldens build and run their reproduction offline in
  the bench container image (no model). Kill if fewer than half of the C#/JS tasks with a fenced reproduction
  can execute it offline.
- **Register check.** F5 PARKED (public-surface probe: enumerability only); E10 DEAD (context reset — this
  resets nothing); F6 forge (local execution for selection — this executes for a fact, not a verdict). New face,
  same vehicle class as F5.
- **Build cost.** Large: per-language tracers. **Solve risk.** The fact is descriptive; the risk is the tracer
  failing silently (`INFRA`) and printing nothing, which costs one request.

### E. Measurement item — `accenture` ran with `run_tests = INFRA` in every cell

- **Family:** G (benchmark validity), not a lever.
- **Evidence.** §3.7. The only fresh-pool task with `INFRA` verdicts; all 33+ rollouts across arms and
  harnesses; the visible sibling path was never observable; 9 of 18 solves were blind.
- **Consequence.** Any per-task resolution reading on `accenture` measures design luck, not verification. A
  task whose runner cannot install dependencies offline should be flagged by preflight (G20 gates do not check
  this) or admitted with a "no-verification" label. `sweet_only: no`.
- **`$0` check.** Extend the `INFRA` grep to `fp-*-none/pipe`, `fixval-*`, `rb-*`; kill the item (as admission
  policy) if `INFRA` is confined to this task and this pool.
- **Register check.** G18 (jail egress) causes it; G20 (preflight) does not detect it; no row records a task
  that is unverifiable for the agent while gradeable for the grader.

## 7. Register check, summarised

| candidate | nearest rows | why not the same |
|---|---|---|
| A binding certificate | B19, B9, F8/P1, F9, E7, D3, A6, harness-changelogs L-3 | prints a computed binding and emptiness flag, not a site list; delivered on the agent's edit, not at turn 0; the L-3 vehicle now has a computation and a `$0` result |
| B graph coverage | E7, E1, E2 | new instances: `#private` methods (0 entities of 34 defs), Elixir 0 call edges |
| C coherence face | F2, F3, F9 | general computation attempted and killed at `$0`; not a per-task witness |
| D runtime dispatch | F5, E10, F6 | which implementation runs, not enumerability; no context reset; fact not verdict |
| E INFRA measurement | G18, G20 | unverifiable-for-agent task class; not recorded |

## 8. What I could not finish

- No live measurement of whether an agent acts on the binding certificate; the ladder's rates are borrowed
  from other fact classes (closure 16/16, runtime 2/4, coherence 1/4) and applied by analogy `[I]`.
- The census heuristics miss functions defined as chained callbacks (`markup-it`, 17/18 cells) and treat Python
  properties as zero-caller functions (`should_close`); Jam call sites are bare-name matches and were excluded
  as ambiguous. Coverage on unsolved cells is 56–80%.
- The observation-site face was rendered for one symbol on one repository; no census of the strict form across
  the pool.
- The dashbitco control used the `sb-*-20260811` patches, not the twelve the P3 gate scored; the two sets differ
  on how many patches touch the declaration.
- The `INFRA` census covered the four TAB/repair runs only; NONE, PIPE, fixval and rebaseline runs were not
  grepped.
- The `moq` and `markup-it` offline-build check for candidate D was not run.
- `ss-trace` demand counts are upper bounds (command echoes are counted); no per-rollout de-duplication.
- Whether the post-2026-08-28 index (E1) gives `b2` Jam call edges was not checked; the goldens on the box carry
  the 2026-07-16 index.

## 9. Artifacts

- This report: `slate-c/candidates/resolution-computed-facts.md`.
- Scripts (copied from the box): `slate-c/candidates/scripts-resolution-computed-facts/{binding_face.py,
  census_edited_functions.py, coherence_face.py, controls.py, graph_cov.py, debug_cov.py, tasks_safe.py}`.
- Summaries: `.../data/census-summary.txt` (rates and per-task table), `.../data/coherence-summary.txt`,
  `.../data/tasks-safe.tsv`.
- Box scratch (read-only inputs, scratch outputs): `/tmp/wf-slatec/resolution-computed-facts/{census.json
  (390 cells, 360 kB), coherence.json, census-summary.txt, coherence-summary.txt}`.
- Rules honoured: `$0`; no product or bench code edited; nothing written under `results/` or the goldens; HO2
  untouched; no hidden test name or gold content read or reproduced.

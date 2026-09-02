# Resolution forensics — harness `claude-code`, fresh pool

**Task E4.** Runs `fp-claudecode-{tab,none,pipe}-20260826`. 22 tasks × 4 arms
(native, sweet TAB, sweet NONE, sweet PIPE) × 3 reps = **264 rollouts, all graded**.
Read-only over the evidence box. No rollout was launched; nothing under `results/` was written.

Every claim carries a tag. **[M]** measured (script + numbers named). **[C]** read from a tool
contract, source file or deployed binary. **[I]** inferred. **[W]** web source.

Scripts: `scripts/e4-claude-code-*.mjs` beside this file; copies ran on the box from
`/tmp/fp-inv/e4-claude-code/`. Machine outputs: `logs/e4-claude-code-*.json`.

---

## 0. Verdict

**The four rollouts sweet-TAB loses to native on this harness sit in four different tasks, and
only one of them has a sweet product mechanism behind it. That one is index coverage, not the
gutter: sweet-search cannot index `.jam` files, and it excludes every path under `src/build/`,
so on the two Boost.Build tasks the gold file was invisible to every ss-* retrieval surface in
all 18 sweet rollouts.** [M]

Three findings correct the standing record:

1. **The claude-code edit-anchor story reverses at full power.** [M] `GUTTER-AB-RESULTS.md`
   reported TAB 1.6% of edits failing against PIPE 7.6% on six tasks. Over 66 rollouts per cell
   the rates are **TAB 42/255 (16.5%), NONE 41/266 (15.4%), PIPE 25/202 (12.4%), native
   52/302 (17.2%)**. Rollouts with at least one failed edit: 17, 15, 15, 17 of 66.
   The tab is not protective here, and sweet is at or below native in every form.
2. **The `+1` indent carry is real, and `N<TAB>` produces it on tab-indented files.** [M]
   Eight of the fourteen locatable TAB anchor failures are exactly one tab too deep, all in
   `devlooped__moq-1262` (C#, tab-indented). The model strips the digits and keeps the gutter's
   own tab. The identical defect appears in the **native** arm, whose `Read` tool renders the
   same `N<TAB>`. It is arm-universal, not sweet-specific.
3. **The resolution difference lives in 5 tasks and 60 rollouts.** [M] 11 tasks solve in every
   cell, 6 die in every cell. On the remaining five: native 10/15, TAB 7/15, NONE 8/15,
   PIPE 6/15.

The dead-everywhere tasks are not retrieval failures. On `fastify__fastify-cors-285` all
**12 of 12** rollouts, both arms, replace the same line with the same wrong refactor while the
gold patch changes one character. [M]

---

## 1. Solve matrix

`resolved != null` on all 264 rows in all three runs — asserted before any count was read
(`e4-claude-code-solve-matrix.mjs`, `problems: []`). [M] Trap 1 of Appendix A is cleared.

Reps solved of 3. Cell totals match `FRESH-POOL-RESULTS.md` §1 exactly (43 / 40 / 41 / 39).

| task | native | TAB | NONE | PIPE | class |
|---|---:|---:|---:|---:|---|
| absinthe-graphql__absinthe-998 | 3 | 3 | 3 | 3 | solved-everywhere |
| apigee__registry-961 | 3 | 3 | 3 | 3 | solved-everywhere |
| asynkron__protoactor-dotnet-1909 | 3 | 3 | 3 | 3 | solved-everywhere |
| aws-actions__configure-aws-credentials-42 | 3 | 3 | 3 | 3 | solved-everywhere |
| axelrod-python__axelrod-671 | 3 | 3 | 3 | 3 | solved-everywhere |
| callstack__react-native-paper-972 | 3 | 3 | 3 | 3 | solved-everywhere |
| final-form__final-form-64 | 3 | 3 | 3 | 3 | solved-everywhere |
| jazzband__tablib-454 | 3 | 3 | 3 | 3 | solved-everywhere |
| locationtech__jts-622 | 3 | 3 | 3 | 3 | solved-everywhere |
| mathnet__mathnet-numerics-1072 | 3 | 3 | 3 | 3 | solved-everywhere |
| mirumee__ariadne-codegen-218 | 3 | 3 | 3 | 3 | solved-everywhere |
| **accenture__sfmc-devtools-1974** | **3** | **2** | **3** | **1** | **discordant (majority)** |
| awslabs__aws-embedded-metrics-node-21 | 2 | 3 | 2 | 2 | discordant (reps) |
| celestiaorg__nmt-192 | 3 | 2 | 3 | 3 | discordant (reps) |
| aio-libs__aiohttp-8038 | 1 | 0 | 0 | 0 | discordant (reps) |
| bfgroup__b2-113 | 1 | 0 | 0 | 0 | discordant (reps) |
| bfgroup__b2-259 | 0 | 0 | 0 | 0 | dead-everywhere |
| devlooped__moq-1262 | 0 | 0 | 0 | 0 | dead-everywhere |
| fastify__fastify-cors-285 | 0 | 0 | 0 | 0 | dead-everywhere |
| gitbookio__markup-it-56 | 0 | 0 | 0 | 0 | dead-everywhere |
| hotmeteor__spectator-181 | 0 | 0 | 0 | 0 | dead-everywhere |
| protofire__solhint-224 | 0 | 0 | 0 | 0 | dead-everywhere |
| **total** | **43/66** | **40/66** | **41/66** | **39/66** | |

**Classification.** Taking "majority" as ≥ 2 of 3 reps: **one** task is majority-discordant
(`accenture`, where PIPE's majority is 0 and every other arm's is 1). Four more differ at the
rep level while the majority agrees. I treat all five as discordant for forensics, because a
majority test at n = 3 discards most of the signal.

**Sweet-majority against native-majority.** `accenture`: native 1, TAB 1, NONE 1, PIPE 0 — the
only cell where a sweet form's majority falls below native's. On the four rep-discordant tasks
the majorities agree: `awslabs` 1–1, `celestia` 1–1, `aiohttp` 0–0, `b2-113` 0–0.

**Where the arm difference lives.** [M] The 11 solved-everywhere tasks contribute 33 solves to
every arm and the 6 dead ones contribute 0. All arm variation is the 5 discordant tasks:

| arm | solved on the 5 discordant tasks |
|---|---|
| native | 10/15 |
| TAB | 7/15 |
| NONE | 8/15 |
| PIPE | 6/15 |

TAB is 3 rollouts behind native. The pre-registered bar is ≥ 6. [C] `FRESH-POOL-RESULTS.md` §1.

---

## 2. Discordant tasks — cell by cell

For each cell I read the trace, the final `model_patch`, the gold patch, `FAIL_TO_PASS`, and
the grader `report.json` entry. Attribution uses `e4-claude-code-localisation.mjs`, which
records whether each gold file was **surfaced** by a tool result, **read**, and **edited**.

### 2.1 `accenture__sfmc-devtools-1974` — the only majority-discordant task

**Gold** `lib/index.js`: gate the shared `#runMethod` dispatcher so `refresh` returns early with
an error when no type was given. **F2P** `"Should not refresh anything due to missing type"`.
**The trap:** `#runMethod` also serves `execute`, `fixKeys` and `publish`, and one P2P test
(`"Should exit fixKeys because event is not supported intentionally"`) depends on an empty
`selectedTypes` object reaching the body.

| cell | outcome | deciding failure mode | ss-* contribution |
|---|---|---|---|
| native r0/r1/r2 | 3/3 solved | — | n/a |
| TAB r0, r2 | solved | — | ss-search + ss-read located `lib/index.js` in 1–2 calls |
| **TAB r1** | **lost** | **wrong-fix — over-broad guard predicate** | none; retrieval was correct |
| NONE r0/r1/r2 | 3/3 solved | — | — |
| PIPE r0 | solved | — | — |
| **PIPE r1** | **lost** | **not-localised — patched the CLI layer, not the library** | **yes, contributory** |
| **PIPE r2** | **lost** | **wrong-fix — the same over-broad predicate as TAB r1** | none |

**TAB r1 and PIPE r2, the same error.** Both add
`if (!selectedTypes || !Object.keys(selectedTypes).length)`. That fires for `fixKeys` too, and
the grader reports `failed_from_pass_to_pass=["Should exit fixKeys because event is not supported
intentionally"]` with `f2pFrac=1`. [M] The cells that solved either omitted the
`Object.keys(...)` clause (TAB r0, PIPE r0, native r0/r2) or gated it on the method
(`methodName === 'refresh' && …` — NONE r2 and native r1). **The deciding semantic choice is
whether the empty-collection check is scoped to `refresh`.** It is visible in the file both arms
read.

**PIPE r1 is the one rollout in this harness where the gutter form plausibly cost calls.** [M]
Storyline: `ss-search` and `ss-find "refresh" --regex "refresh"` put `lib/cli.js` on top; the
agent read only `lib/cli.js` (calls 5–6) and never opened `lib/index.js`; then **4 of its 5
Edit calls failed** with `String to replace not found`; it recovered by using claude-code's own
`Read` (calls 9 and 13) and shipped a yargs `.check()` guard in `lib/cli.js`, which the unit
test never executes (`f2pFrac=0`, `from_fail_to_pass=[]`).

The failed anchor, with bytes [M]:

- `ss-read lib/cli.js 680 770` printed
  `"738|                 .option('metadata', {"` — `738`, `|`, one delimiter space, then
  **16 content spaces**.
- the attempted `old_string` first line was
  `"                 .option('metadata', {"` — **17 spaces**.

The model stripped `738|` and kept the delimiter's space. That is the documented PIPE mechanism
(`GUTTER-MECHANISM-INVESTIGATION` §4.1), reproduced here. **It cost four calls; it did not cause
the loss** — the wrong file was already chosen at call 5, before the first failed edit.

### 2.2 `bfgroup__b2-113` — the one sweet-attributable loss

**Gold** `src/tools/stage.jam`. native 1/3, sweet **0/9**.

**Sweet never saw the gold file.** [M] In 8 of 9 sweet rollouts `surfacedBy` is empty: no
ss-search, ss-find, ss-grep or ss-semantic result ever named `src/tools/stage.jam`. In the ninth
(PIPE r0) it appeared at call 47, from a plain `bash` command. Native surfaced it in all three
rollouts (calls 11, 46, 4) using ordinary `grep`/`find`, and solved rep2 with a patch touching
`src/build/alias.py`, `src/build/targets.py`, **`src/tools/stage.jam`** and `src/tools/stage.py`.

**All nine sweet rollouts patched `src/build/targets.py`** — the Python half of the repo — and
none touched Jam.

**Mechanism, proven three ways.**

1. [C] `core/infrastructure/config/search.js:51` `FILE_PATTERNS.include` has no `.jam` glob.
   Boost.Build's own language is not an indexed file type.
2. [C] the same file's `exclude` list contains `'**/build/**'` (line 188), so `src/build/` —
   which in this repo is source, not build output — is excluded wholesale.
3. [M] `e4-claude-code-indexgap.mjs` over **all 198 sweet rollouts**: the extension histogram of
   files returned as an ss-search/ss-find **result block** contains no `jam` at all; ss-grep
   returned a `.jam` path 4 times, and all four are inside a `.claude/worktrees/` copy, not the
   index. `ss-read` opened `.jam` **44 times** — because `ss-read` reads the disk directly and
   needs no index.

So the agent can read a Jam file once it is told the path, and can never be told the path by
sweet-search.

**Cost of the blindness, measured.** [M] `e4-claude-code-silentblind.mjs`: of 293 `(no matches)`
results from single-invocation ss-* calls, **69** were scoped with `--in` to a path the same
rollout had already read successfully. 49 of the 69 are the two b2 tasks, 13 are
`--in dist/index.js`. Quoted example (`TAB/bfgroup__b2-259/r0`):

```
ss-grep "build" --in src/build/targets.jam -k 100
(no matches)
```

`src/build/targets.jam` exists — the same rollout rendered it with `# ss-read src/build/targets.jam (…)`.
The tool cannot distinguish "this text is absent" from "this file is not in the index", and says
the first.

**Failure mode:** not-localised, caused by an ss-* product defect (index coverage).
**Gutter:** no bearing; the failure is identical under all three forms.

### 2.3 `aio-libs__aiohttp-8038` — arm-universal wrong-fix, native won by grinding

**Gold** `aiohttp/client.py`: add `IDEMPOTENT_METHODS`, set `retry_persistent_connection` per
request, and catch `(ClientOSError, ServerDisconnectedError)` to retry once. 4 F2P tests.
native 1/3, sweet 0/9.

Retrieval was **not** the constraint. [M] Sweet surfaced and edited `aiohttp/client.py` in
TAB r0, NONE r0, NONE r2 and PIPE r1. The failure is semantic. `NONE r0` wrote the right
variable and the right `continue`, then narrowed the catch to a single exception and added two
extra conditions:

```python
except ServerDisconnectedError as exc:
    if (
        retry_persistent_connection
        and isinstance(exc.message, RawResponseMessage)
        and exc.message.headers.get(hdrs.CONNECTION) == hdrs.KEEPALIVE
    ):
```

Gold catches `ClientOSError` as well and gates only on the method being idempotent. **Failure
mode: wrong-fix (over-narrow guard).**

Native rep1's win is an effort outlier, not a retrieval win: **125 tool calls, 36 edits, 9
`run_tests` cycles, 2 subagents, 539 s**, against sweet's dearest attempt at 105 calls. [M] Its
patch is a superset of gold. The other two native reps failed, one of them (`r2`) after 19 edits
that left an **empty** `model_patch`.

**ss-* contribution:** none negative that I can show. Two `(no matches)` results in this task were
scoped probes for a symbol that does not exist before the fix (`retry_persistent_connection`) —
correct behaviour, not a defect.

### 2.4 `awslabs__aws-embedded-metrics-node-21` — the one task sweet wins

**Gold** `src/logger/MetricsContext.ts`: deduplicate dimension sets inside `putDimensions`.
native 2/3, TAB **3/3**, NONE 2/3, PIPE 2/3.

| lost cell | mode | note |
|---|---|---|
| native r2 | **not-localised** | patched `src/serializers/LogSerializer.ts`; never edited the gold file |
| NONE r1 | **not-localised** | same wrong file, `src/serializers/LogSerializer.ts` |
| PIPE r2 | **incomplete** | right file, 1 hunk, `f2pFrac=0` — the dedup missed the reordered-key case |

The wrong file is the same in both arms. The deciding choice is whether to dedupe at write time
(`putDimensions`) or at serialise time. **No ss-* defect is implicated**; every cell surfaced the
gold file from `ss-search` at call 1–3.

### 2.5 `celestiaorg__nmt-192` — a single premature stop

**Gold** `proof.go`: make `IsEmptyProof` also require an empty `leafHash`. native 3/3, TAB 2/3,
NONE 3/3, PIPE 3/3.

**TAB r0 is the only loss and it is a stop-discipline defect.** [M] Four tool calls
(`TaskCreate`, `run_tests`, `ss-grep "IsEmptyProof"`, `ss-read proof.go 45 125`), zero edits,
**empty `model_patch`**, `exitReason=model_stopped`, 49 s. Its last assistant message is a
condenser artefact:

```
<state_summary>
Established that `proof.go:110-112` defines `IsEmptyProof()` solely using equal bounds and an
empty `nodes` slice, while `IsOfAbsence()` is true whenever `leafHash` is non-empty; …
</state_summary>
```

The retrieval was correct and sufficient: `ss-grep` returned `proof.go:109` and `proof.go:110`
on the first try, and `ss-read` showed `IsOfAbsence` at lines 66–70. The agent stopped after
summarising its state instead of editing.

**Rate.** [M] `e4-claude-code-stopcensus.mjs` over all 264 rollouts: this is the **only** rollout
in the run whose last assistant text is a `<state_summary>`, and one of only two empty patches
(the other is `native/aio-libs__aiohttp-8038/r2`). Every other rollout exits `model_stopped` with
a patch; one NONE rollout exits `agent_error` and still resolves.
**Failure mode: gave-up (premature stop after a condense). Not retrieval, not the gutter.**

---

## 3. Dead-everywhere tasks — cell by cell

72 rollouts, 0 solved. The question for each is whether sweet could have solved it.

### 3.1 `fastify__fastify-cors-285` — arm-universal wrong-fix, 12/12 identical

**Gold, one character:** `fastify.options('/*', …)` → `fastify.options('*', …)`.

[M] Every one of the 12 rollouts edits `index.js`, and every one makes the **same** wrong move —
extract the handler into a named constant and register extra routes:

```
-  fastify.options('/*', { schema: { hide: hideOptionsRoute } }, (req, reply) => {
+  const optionsRouteHandler = (req, reply) => {          # native r0
+  const optionsHandler = (req, reply) => {               # native r1, TAB r1, NONE r0
+  const handlePreflight = (req, reply) => {              # TAB r0, NONE r1
+  const preflightHandler = (req, reply) => {             # TAB r2, PIPE r0 …
```

**Failure mode: over-scoped wrong-fix.** The gold file was surfaced and read in all 12. The
model's prior beats the evidence. This is the resolution floor, not a retrieval ceiling — the
same shape recorded in `project_resolution_floor_universal_wrongfix`. **No lever here.**

### 3.2 `bfgroup__b2-259` — not-localised, same index blindness

**Gold** `src/build/property.jam` — excluded twice over: `.jam` is not an indexed extension and
`**/build/**` is an exclude glob. [C]

[M] No arm edits it. Native patches `src/tools/features/build-feature.jam` in all three reps;
every sweet rollout patches `src/build/configure.jam`. Sweet's ss-* surfaced the gold file in
only 4 of 9 rollouts and never before call 26.

This task carries the run's worst empty-result load: 30, 28, 23, 16, 16 and 13 `(no matches)`
results in single rollouts [M] — the agent grepping Jam rule names against a corpus that holds
no Jam. **Failure mode: not-localised. ss-* contributed: index coverage.** Because native also
fails, fixing coverage is necessary but demonstrably not sufficient here.

### 3.3 `devlooped__moq-1262` — incomplete, and the TAB anchor carry lives here

**Gold** five files: `Evaluator.cs`, `ExpressionComparer.cs`, `ExpressionExtensions.cs`,
`Expressions/Visitors/EvaluateCaptures.cs`, `CHANGELOG.md`.

[M] Every arm that edits anything edits `ExpressionComparer.cs` + `Match.cs`. **No rollout in any
arm touches `ExpressionExtensions.cs` or `EvaluateCaptures.cs`.** **Failure mode: incomplete
(missing sibling files).** Arm-universal.

**This is also where the `N<TAB>` carry is measurable, with bytes.** [M] The repo is
tab-indented (81.3% of ss-read body lines delivered for this task begin with a tab). In
`TAB/devlooped__moq-1262/r0`, `ss-read src/Moq/Match.cs 130 240` printed

```
171<TAB><TAB><TAB><TAB>this.RenderExpression = renderExpression.Body.Apply(EvaluateCaptures.Rewriter);
```

and a later `git diff` in the same transcript shows the file's own indent is **two** tabs at the
enclosing declaration, i.e. three at the body line. The failed `old_string` was

```
<TAB><TAB><TAB><TAB>this.RenderExpression = renderExpression.Body.Apply(EvaluateCaptures.Rewriter);
```

— **four** tabs. The model removed `171` and kept the gutter's tab. Eight of the fourteen
locatable TAB anchor failures across the whole harness have this exact `+1` signature, and all
eight are in this task.

**The same defect is in the native arm.** [M] Native's `Read` renders `N<TAB>` too
(`GUTTER-MECHANISM-INVESTIGATION` §1.1 [C]), and 7 of native's 20 locatable failures are `+1`,
6 of them in this same repo. **The carry is a property of a tab delimiter meeting a tab-indented
file, not of sweet.**

Exposure is small: only 3 of 22 tasks deliver tab-indented code —
`devlooped__moq-1262` 81.3%, `apigee__registry-961` 74.2%, `celestiaorg__nmt-192` 32.8%; the other
19 are 0.0%. Overall **6,571 of 47,171 (13.9%)** of ss-read body lines under TAB are tab-indented. [M]

### 3.4 `gitbookio__markup-it-56` — wrong-fix, wrong layer

**Gold** `src/markdown/inlines/html.js`: add `mergeHTMLNodes`, and serialise from
`node.data.get('html')` instead of `node.text`.

[M] 7 of 12 rollouts patch `src/markdown/re/inline.js` (the regex table) instead. Native r0 and
sweet PIPE r0/r2 do edit the gold file and still fail. **Failure mode: wrong-fix (the regex,
not the node merge).** Arm-universal; sweet PIPE actually localises better than native here.

### 3.5 `hotmeteor__spectator-181` — wrong-fix

**Gold** `src/Assertions.php`. [M] 10 of 12 rollouts edit the gold file; all fail.
**Failure mode: wrong-fix.** Retrieval is not the constraint — `ss-search` surfaces
`src/Assertions.php` at call 1–2 in every sweet rollout.

### 3.6 `protofire__solhint-224` — incomplete, everywhere

**Gold** five files including a **new** file `lib/rules/order/ordering.js` and registration in
`lib/rules/index.js` and `lib/common/ast-types.js`.

[M] **11 of 12 rollouts score `f2pFrac=0.4`** — the same 2 of 5 F2P tests — and the twelfth
(native r1) scores 0. Every arm creates part of the rule and misses the registration surface.
**Failure mode: incomplete (missing sibling registration).** Arm-universal, and the most
uniform partial-credit signature in the pool.

---

## 4. Failure-mode roll-up

One row per discordant or dead task. "ss-* contribution" is restricted to what a trace shows.

| task | native | TAB | NONE | PIPE | deciding failure mode | ss-* contribution | could the gutter matter? |
|---|---:|---:|---:|---:|---|---|---|
| accenture__sfmc-devtools-1974 | 3 | 2 | 3 | 1 | wrong-fix (guard not scoped to `refresh`) ×2; not-localised (CLI layer) ×1 | PIPE r1: ss-find/ss-search ranked `lib/cli.js` first, and 4 edits failed on the `N\| ` carry | **yes, cost only** — 4 wasted calls, bytes in §2.1; wrong file was chosen first |
| bfgroup__b2-113 | 1 | 0 | 0 | 0 | not-localised | **yes, causal** — `.jam` unindexed, `src/build/**` excluded; gold never surfaced in 8/9 | no |
| aio-libs__aiohttp-8038 | 1 | 0 | 0 | 0 | wrong-fix (over-narrow retry guard) | none; gold file reached in 4/9 | no |
| awslabs__aws-embedded-metrics-node-21 | 2 | 3 | 2 | 2 | not-localised (serializer) ×2; incomplete ×1 | none; ss-search found the gold file at call 1–3 everywhere | no |
| celestiaorg__nmt-192 | 3 | 2 | 3 | 3 | gave-up (premature stop after a condense) | none; ss-grep+ss-read were correct and sufficient | no |
| bfgroup__b2-259 | 0 | 0 | 0 | 0 | not-localised | **yes** — same index blindness; 30 empty results in one rollout | no |
| devlooped__moq-1262 | 0 | 0 | 0 | 0 | incomplete (2 gold files untouched by any arm) | none | **yes, cost only** — 8 `+1`-tab anchor failures under TAB; native has the same defect |
| fastify__fastify-cors-285 | 0 | 0 | 0 | 0 | over-scoped wrong-fix, 12/12 identical | none | no |
| gitbookio__markup-it-56 | 0 | 0 | 0 | 0 | wrong-fix (regex instead of node merge) | none | no |
| hotmeteor__spectator-181 | 0 | 0 | 0 | 0 | wrong-fix | none | no |
| protofire__solhint-224 | 0 | 0 | 0 | 0 | incomplete (rule registration), `f2p=0.4` in 11/12 | none | no |

**Mode counts, two denominators.**

*The 29 lost cells on the 5 discordant tasks* (60 cells, 31 solved):
**not-localised 17** (11 of them `bfgroup__b2-113`, 3 `aio-libs`, 2 `awslabs`, 1 `accenture`),
**wrong-fix 9**, **incomplete 1**, **gave-up 1**, **other 1** (`native/aio-libs/r2`: 19 edits, empty
final patch — the agent reverted its own work). Environment 0. Refused 0. Edit-mechanics 0.

*The 6 dead-everywhere tasks, by dominant mode:* **wrong-fix 3** (`fastify-cors`, `markup-it`,
`spectator`), **incomplete 2** (`moq`, `solhint`), **not-localised 1** (`b2-259`).

**No rollout in this harness lost to a failed edit that was never retried.** [M] Every rollout
with a failed Edit either retried successfully or lost for an unrelated reason.

---

## 5. Tool-health scan — all 198 sweet rollouts on claude-code

`e4-claude-code-toolhealth.mjs` + `-toolhealth2.mjs`. Convention: one transcript per rep, the
largest when a cell holds an extra (trap 5). Exit codes come from claude-code's own
`Exit code N` prefix on a Bash result [C]; the ss-* markers come from
`eval/agent-read-workflows/bin/_ss-helpers.mjs` [C].

### 5.1 Volume

| | TAB | NONE | PIPE | total |
|---|---:|---:|---:|---:|
| rollouts | 66 | 66 | 66 | 198 |
| all tool calls | 2,007 | 1,771 | 1,683 | 5,461 |
| Bash calls | 1,449 | 1,276 | 1,199 | 3,924 |
| Bash calls invoking ≥1 ss-* | 915 | 892 | 894 | 2,701 |
| ss-* invocations | 1,124 | 1,117 | 1,088 | 3,329 |
| ss-search | 198 | 151 | 176 | 525 |
| ss-read | 421 | 499 | 455 | 1,375 |
| ss-grep | 389 | 328 | 334 | 1,051 |
| ss-find | 97 | 110 | 81 | 288 |
| ss-trace | 13 | 16 | 23 | 52 |
| ss-semantic | 6 | 12 | 19 | 37 |
| ss-files | 0 | 1 | 0 | 1 |

Exit-code histogram over the 2,701 ss-bearing calls: **0 → 2,544, 1 → 89, 2 → 67, 127 → 1**. [M]
**No ss-* call was killed by a timeout** — `Command timed out` and `Command was killed` appear
zero times in any claude-code transcript of these runs. [M] (An earlier pass of this scan
reported 127 timeouts; that was a false positive from matching the word "timeout" inside
delivered source code, and is retracted.)

Latency is recorded only by `ss-trace`, in its `<<SS_TRACE_META>>` trailer: **50 samples,
min 5 ms, median 60 ms, p90 153 ms, max 180 ms**. [M] No other surface reports a duration to the
agent.

### 5.2 Product-defect list

Ranked by rollouts affected. Every row has one quoted example from a trace.

| # | defect | calls | rollouts (of 198) | quoted example |
|---|---|---:|---:|---|
| D1 | **`(no matches)` cannot be told apart from "not indexed"** | 322 empty results, of which **69** were `--in`-scoped at a file the same rollout had already read | 74 | `ss-grep "build" --in src/build/targets.jam -k 100` → `(no matches)`, while `# ss-read src/build/targets.jam (…)` succeeded in the same rollout |
| D2 | **native re-read of a file an ss-* call already returned** | 262 | 49 | `TAB/asynkron__protoactor-dotnet-1909/r0`: `ss-read` showed `src/Proto.Actor/Utils/TypedDictionary.cs` lines 1–70, then `Read {"file_path":"…/TypedDictionary.cs","offset":1,"limit":70}` — the identical span |
| D3 | **ss-grep rejects positional path scopes (exit 2)** | 70 usage errors total | 33 | `ss-grep "KEEPALIVE\|CONNECTION" aiohttp/hdrs.py -k 10` → `Exit code 2 / [ss] 1 argument(s) not consumed: "aiohttp/hdrs.py"` |
| D4 | **ss-* crash: a raw ripgrep parse error reaches the agent** | 37 | 27 | `ss-grep "func (.*ListArtifacts" -k 20` → `[ss-*] crash: Error: ripgrep failed (code 2): rg: regex parse error:` — and the rg diagnostic is cut off before the caret line |
| D5 | **engine stderr leaks into agent output** | 37 (the same 37 calls as D4) | 27 | `BinaryHNSW: Loaded 6863 vectors from /root/.ss-eval/runs/r0-14/.sweet-search/codebase-binary-hnsw.idx (asymmetric=false)` / `LateInteraction: Streaming load 5000 documents...` |
| D6 | **ss-read ENOENT on a path a previous ss-* result named** | 51 total, **21** on a path an ss-* result had shown | 24 | `ss-read src/Moq/ExpressionExtensions.cs 420 460 && ss-read src/Moq/Expressions/Visitors/PartialMatcherAwareEval.cs 1 160` → `[ss-read] error: stat failed: ENOENT` |
| D7 | **BRE alternation written by the model** | 87 dialect retries, **13** returned 0 matches in both dialects | 47 | `ss-grep "ListSpecArtifacts.*NotFound\|list.*spec.*artifacts" --in server/registry/actions_artifacts_test.go -k 20` → `BRE operators were retried with unescaped Rust operators; both forms returned 0 matches.` |
| D8 | **ss-find has no `--in`, ss-grep does** | part of D3's 70 | — | `ss-find "generate" --regex "def generate\|class .*Target" --in src/build -k 20` → `[ss] unrecognised option "--in"` |
| D9 | **ss-trace target not found (exit 1)** | 10 | 10 | `<<SS_TRACE_META>>{… "sufficient":false}` |
| D10 | **shell metacharacters in a query kill the command (exit 127)** | 1 | 1 | `ss-search "$(properties:<feature>) Jam variable property list" -k 20` → `Exit code 127 / /bin/bash: eval: line 1: syntax error near unexpected token ')'` |
| D11 | **ss-semantic error (exit 1)** | 2 | 2 | `[ss-semantic] error: …` |

**Notes that keep these honest.**

- **D1 is mostly correct behaviour.** Of 322 empty results, the majority are legitimate absence
  probes — an agent grepping for `retry_persistent_connection` before it has written it. The
  defect is the **69** scoped calls on files proven to exist, and 62 of those 69 fall in the
  three tasks whose target directory or extension is not indexed (`dist/`, `src/build/`, `.jam`).
- **D2 is not simply waste.** 108 of the 147 native `Read` calls that follow an `ss-read` of the
  same file overlap the span ss-read already delivered [M]. Only 11 of 284 TAB edits and 5 of
  207 PIPE edits are preceded immediately by a native `Read` of the same file, against **43 of
  302** on native — so sweet's grounding is usually enough. The per-form rollout counts are
  TAB 14, PIPE 13, NONE 5, which does not order with delimiter width and I therefore read as
  noise at this n.
- **D4 and D5 are the same 37 calls.** [M] The rid lists are identical. [I] The model writes a
  pattern with an unbalanced `(`; the warm-server grep rejects it; the wrapper falls back to a
  cold in-process `bareGrep` (`_ss-helpers.mjs:343-347` [C]) which loads BinaryHNSW and
  LateInteraction — printing the chatter — and then fails on the same pattern. **A regex typo
  therefore pays for a full model load before it errors.**
- **D7 already has a mitigation and it works.** `writeRegexDialectHint` retries the pattern with
  Rust operators and reports it (`_ss-helpers.mjs:267` [C]). 74 of 87 retries recovered matches.

### 5.3 Edit mechanics, and the correction to the record

`e4-claude-code-anchors.mjs` and `-toolhealth2.mjs`, same denominators.

| arm | Edit calls | failed | rate | rollouts with ≥1 failure | not-found | not-unique | no-change | JSON error |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| native | 302 | 52 | 17.2% | 17/66 | 24 | 12 | 14 | 1 |
| TAB | 255 | 42 | 16.5% | 17/66 | 15 | — | — | — |
| NONE | 266 | 41 | 15.4% | 15/66 | 14 | — | — | — |
| PIPE | 202 | 25 | **12.4%** | 15/66 | 9 | — | — | — |
| sweet total | 723 | 108 | 14.9% | 47/198 | 38 | 25 | 34 | 9 |

**`GUTTER-AB-RESULTS.md` §0 is withdrawn for claude-code.** It reported TAB 1/63 (1.6%) against
PIPE 8/105 (7.6%) on six tasks. At 66 rollouts per cell the order reverses and sweet sits at or
below native in every form. The six-task figure was three transcripts of one task.

**Indentation deltas on the locatable not-found failures** (attempted indent minus the indent of
the same line as it was last shown, gutter removed):

| arm | located | `0` | `+1` | other |
|---|---:|---:|---:|---|
| native | 20 | 11 | 7 | `+4` ×2 |
| TAB | 14 | 4 | 8 | `+5` ×1, `−4` ×1 |
| NONE | 10 | 9 | 0 | `−1` ×1 |
| PIPE | 9 | 3 | 6 | — |

TAB's eight `+1`s are all one **tab** too deep, in the one tab-indented repo. PIPE's six are all
one **space** too deep, in space-indented JS. NONE, which has no delimiter to carry, has none.
**The delimiter does not decide whether the carry happens; it decides which files it happens in.**

### 5.4 Effort profile — where sweet's efficiency comes from

Means per rollout, `e4-claude-code-effort.mjs`. "hard" = the 11 tasks that are not
solved-everywhere.

| group | arm | calls | `run_tests` | edits | ss-* | native Read | native grep | subagents | solved |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| all | native | 41.8 | 2.88 | 4.67 | 0 | 19.4 | 6.2 | 0.50 | 43/66 |
| all | TAB | 29.9 | 2.91 | 3.71 | 13.6 | 2.1 | 0.3 | 0.17 | 40/66 |
| all | NONE | 26.5 | 2.89 | 3.65 | 13.8 | 1.1 | 0.2 | 0.14 | 41/66 |
| all | PIPE | 25.3 | 2.80 | 3.00 | 13.5 | 1.9 | 0.5 | 0.11 | 39/66 |
| hard | native | 61.8 | 3.58 | 6.70 | 0 | 29.8 | 9.1 | 0.79 | 10/33 |
| hard | TAB | 43.0 | 3.48 | 5.12 | 20.2 | 3.1 | 0.4 | 0.27 | 7/33 |
| hard | NONE | 39.7 | 3.58 | 5.55 | 20.8 | 1.9 | 0.3 | 0.27 | 8/33 |
| hard | PIPE | 35.5 | 3.18 | 3.61 | 19.2 | 3.4 | 0.9 | 0.21 | 6/33 |

**The `run_tests` count is the same in every arm** (2.8–2.9 overall, 3.2–3.6 on hard tasks). The
whole call-count difference is retrieval: native spends 26–39 calls per hard rollout on
`Read`+`grep`; sweet spends 20 on ss-* plus 2–3 native. That is the efficiency claim, and it
holds. **PIPE is the cheapest arm and the weakest** — 25.3 calls, 3.0 edits, 39/66 — which is the
"cheaper and worse" pattern §1 of `FRESH-POOL-RESULTS.md` warns about.

---

## 6. Ranked resolution levers this harness's traces support

Each lever names the task(s), the mechanism, and a **$0 falsifier** — a check that needs no
rollout. Each is checked against `SLATE-A-UBER.md` §9 and `SLATE-B-UBER.md` §8.

### L1 — Index the file types and directories the task lives in *(new; not in either discard log)*

**Tasks:** `bfgroup__b2-113` (native 1/3, sweet 0/9), `bfgroup__b2-259` (0/12),
`aws-actions__configure-aws-credentials-42` (solved, but 13 wasted scoped greps).
**Mechanism [C]+[M].** `FILE_PATTERNS.include` has no `.jam` glob and `FILE_PATTERNS.exclude`
contains `'**/build/**'` and `'**/dist/**'`. Over 198 sweet rollouts no ss-search/ss-find result
block ever named a `.jam` file, and 62 `--in`-scoped greps returned `(no matches)` on files that
demonstrably exist. Two of 22 pool tasks (9%) have gold that sweet-search cannot index at all;
two more are part-blind (`.d.ts.map`, `CHANGES/*.feature`).
**Scope of the win:** bounded. It is worth at most the 1 rollout native gets on `b2-113`;
`b2-259` is dead in both arms, so coverage is necessary and not sufficient there.
**$0 falsifier.** Re-index the two b2 goldens with `.jam` added and `src/build/` un-excluded, then
replay the exact ss-search / ss-grep queries recorded in the traces. **Kill it** if
`src/tools/stage.jam` still does not appear in the top-20 for the queries the agents actually
wrote. No new rollout is needed to decide.
**Discard-log check.** Not present in either log. `SLATE-A` §9.3 ("more sibling retrieval") is a
*ranking* proposal; this is a *corpus* proposal — the file is absent from the index, not
ranked low. Genuinely new.

### L2 — Say "not indexed", never `(no matches)` *(new)*

**Tasks:** the same three, plus every future repo with a `build/` or `dist/` source tree.
**Mechanism [M].** 69 single-invocation ss-* calls answered `(no matches)` for an `--in` scope the
same rollout had already read. The agent cannot distinguish absence of text from absence of
index, so it re-queries. `bfgroup__b2-259/r0` burned **30** empty results in one rollout.
**Change.** In `cmdGrep`'s scoped branch (`_ss-helpers.mjs:324`) and in `cmdFind`/`cmdAgentSearch`
(`:474`, `:771`), when the scope resolves to a path that exists on disk but contributes no
indexed content, print `(not indexed: <path> — use native grep)` instead of `(no matches)`.
**$0 falsifier.** Count, over the 198 traces, how many `(no matches)` results were followed
within 3 calls by another ss-* call with the same scope. **Kill it** if fewer than a third
of the 69 are followed by a retry — then the message is not changing behaviour.
**Discard-log check.** Not a "return the same information more compactly" move
(`SLATE-B` §8, banned) — it adds information the agent does not have. Not present in either log.

### L3 — Accept a positional path as a scope in ss-grep, and give ss-find `--in` *(new)*

**Tasks:** `aio-libs__aiohttp-8038`, `bfgroup__b2-113`, `bfgroup__b2-259`, and 30 others.
**Mechanism [M].** 70 exit-2 usage errors in 33 of 198 rollouts. The dominant form is grep muscle
memory — `ss-grep "<pat>" <path> -k N` — which the wrapper rejects with
`[ss] N argument(s) not consumed`. The second form is `ss-find … --in <path>`, an option ss-grep
has and ss-find does not ([C] `FIND_USAGE` in `_ss-helpers.mjs`).
**Change.** Treat trailing positionals that resolve to existing paths as `--in` scopes; add
`--in` to `ss-find`. Both are argument-parsing changes in `_ss-argparse.mjs` / `_ss-helpers.mjs`.
**$0 falsifier.** Re-parse the 70 rejected command lines with the proposed rule and count how
many become valid, and whether any *valid* command in the corpus would change meaning.
**Kill it** if fewer than 50 of 70 recover, or if any currently-working call would change result.
**Discard-log check.** Not present. This is not `SLATE-A` §9.12 free-argument call packing —
no calls are merged; a rejected call becomes an executed one.

### L4 — Fail a bad regex before loading the models, and print the rg diagnostic *(new)*

**Tasks:** `apigee__registry-961` (solved anyway), `bfgroup__b2-113`, 25 others.
**Mechanism [M].** 37 calls in 27 rollouts crash with
`[ss-*] crash: Error: ripgrep failed (code 2): rg: regex parse error:` — with the caret line
truncated away, so the agent is not told *where* the pattern is bad. The same 37 calls carry
BinaryHNSW and LateInteraction load chatter into the agent's context, because the crash happens
on the cold fallback path after the models have loaded ([C] `_ss-helpers.mjs:343-347`).
**Change.** Compile the pattern before any engine work; on failure print the full rg diagnostic
and the likely fix (`escape "(" or use -F`). Route engine stderr away from stdout.
**$0 falsifier.** Compile the 37 recorded patterns with the same regex engine and confirm all 37
fail at compile time, before any index work. **Kill it** if any of the 37 compiles cleanly —
then the crash is not a pattern error and the diagnosis is wrong.
**Discard-log check.** Not present. Related to the `ss-grep` BRE `\|` bug in
`project_cost_forensics_results`; that one is now *fixed* (the dialect retry recovers 74 of 87
cases [M]) and this is a different, unmitigated path.

### L5 — Give `ss-read` an unambiguous gutter on tab-indented files *(partly new; the delimiter question itself is closed)*

**Tasks:** `devlooped__moq-1262` (dead in all arms), `apigee__registry-961`, `celestiaorg__nmt-192`.
**Mechanism [M].** 8 of 14 locatable TAB anchor failures are exactly one tab too deep, all in the
one tab-indented repo. Bytes in §3.3. Native's own `Read` has the same defect (7 of 20).
**Why it is still worth naming, given `FRESH-POOL-RESULTS.md` closed the delimiter question.**
The closed question was "which of tab, pipe or none is best overall" — answer: none of them,
`p ≥ 0.72`. The open question is narrower and has a mechanism: **a delimiter that equals the
file's own indent character is ambiguous, and a delimiter that does not cannot be.** A form that
is unambiguous in *both* families (for example `N│` U+2502, or a tab-plus-non-tab guard on
tab-indented files) is not one of the three forms that were tested.
**Scope of the win:** small. 13.9% of delivered ss-read lines are tab-indented; the failures it
would remove cost calls, not rollouts — the moq task is dead for an unrelated reason
(§3.3, two gold files untouched by any arm).
**$0 falsifier.** Re-render the 14 TAB and 9 PIPE failed anchors under the candidate delimiter
and check the strip is unique. **Kill it** if the candidate costs more than 0.93 tokens/line over
tab ([M] `GUTTER-MECHANISM-INVESTIGATION` §5.4) — the whole delimiter budget is that thin — or
if the count of rollouts it would have saved is 0, which on this evidence it is.
**Discard-log check.** `SLATE-A` §9 has no entry; the delimiter A/B itself is superseded by
`FRESH-POOL-RESULTS.md` §5, which **withdraws** the per-harness recommendation. My evidence is
new — the earlier work never had a tab-indented file in its pool — but the disposition stands:
**do not ship a delimiter change on resolution grounds.** File it as a rendering-correctness fix
with a cost ceiling, or not at all.

### L6 — Stop-discipline: never end a turn on a condenser summary *(known class, new instance)*

**Task:** `celestiaorg__nmt-192` TAB r0 — the only such rollout in 264.
**Mechanism [M].** 4 calls, 0 edits, empty patch, last assistant text is `<state_summary>…`.
**$0 falsifier.** Grep the harness's condenser path for the case where a summary is emitted with
no following turn. **Kill it** at n = 1: one rollout in 264 is not a lever, it is a bug report.
**Discard-log check.** The stop-discipline family is live in memory
(`project_mpp_stop_discipline_fix_tasks`, `project_engine_harness_fixes_p2_audit` — condenser
gates already shipped). **Report it, do not re-run anything for it.**

### Levers I considered and dropped

- **More sibling retrieval for `protofire__solhint-224` and `devlooped__moq-1262`.** Both are
  "incomplete — missing sibling file" failures, which is exactly `SLATE-A` §9.3, already killed:
  the sibling is present in context and the agent does not act on it. My traces agree — every
  moq rollout had `ExpressionExtensions.cs` named in a search result and none opened it.
  **Dead. My evidence adds a third instance, not a new argument.**
- **A prompt clause telling the agent to scope guards to the calling method** (`accenture`) or
  to prefer the smallest route-pattern change (`fastify-cors`). This is a general clause, and
  `project_clause_candidate_dead` records general clauses as dead — 3/8 tasks in every
  condition, with the originating signal reversing. **Dead.**
- **A completeness card for `protofire__solhint-224`'s 5-file gold.**
  `project_lever4_completeness_card_dead` killed it at $0. **Dead.**
- **Forcing more iterations on hard tasks** (the `aio-libs` shape, where native's single win took
  125 calls). This is a turn-budget lever, and `project_turnfix_program` records packing as
  CLOSED and thrash as DEAD. It also runs straight into the cost claim: sweet's whole measured
  advantage on this harness is 28% fewer calls. **Do not propose it.**

---

## 7. What this changes in the standing record

1. **`GUTTER-AB-RESULTS.md` §0's claude-code anchor table is withdrawn.** [M] TAB 16.5% vs
   PIPE 12.4% at 66 rollouts per cell, against 1.6% vs 7.6% at 18. Both directions of that
   comparison are inside noise; the six-task number was three transcripts of one task.
2. **The `+1` carry is a tab-versus-tab-indentation defect, not a pipe defect.** [M] It appears
   under TAB on C#, under PIPE on JavaScript, under neither on NONE, and in the **native** arm
   at the same rate.
3. **`ba5b4ee` is confirmed live in this run.** [M] ss-find and ss-search hit blocks are numbered
   — `40|`, `95|`, `738|` appear in ss-find and ss-search output in §2.1. The 27–36% un-numbered
   share reported for epoch B is gone.
4. **A new product defect class is on the board: index coverage.** [C]+[M] Two of 22 pool tasks
   have gold sweet-search cannot index. This was never measured before because no earlier pool
   contained a DSL outside `FILE_PATTERNS`.

---

## 8. Method, denominators, and what I did not finish

**Denominators.** Every per-form table uses one transcript per rep, the largest when a cell
retains an extra (trap 5). The TAB cell holds 71 transcripts for 66 rollouts, NONE 70, PIPE 68,
native 67; §5.3's `tabexposure` ratios are computed over all transcripts and are marked where
they differ. `rows.json` was read only after asserting `resolved != null` on all 264 rows
(trap 1). Claude-code cost is not reported here at all — E4 is a resolution task, and
`FRESH-POOL-RESULTS.md` §2 already establishes that the ledger cannot be summed (trap 2).
`turns/` was not used (trap 3). Absence was never inferred from `trajectories/` (trap 7); every
absence claim in §2.2 comes from parsing the full transcripts.

**Grader logs.** `<arm>/logs/<task>_log.txt` holds hidden-test expectations. I read
`report.json` (`from_fail_to_pass`, `failed_from_pass_to_pass`, `exit_code`) rather than the raw
logs wherever that answered the question, and the pool is DEV-retired, so no blinding is at risk.

**Finished:** items 1, 2, 3 and 4 of the task in full — the solve matrix with the null assertion,
every discordant and every dead task read at cell level with patches and traces, the tool-health
scan over all 198 sweet rollouts, and the ranked lever list checked against both discard logs.

**Not finished, and why:**

- **Latency for ss-search, ss-grep, ss-find and ss-read is not reported, because those surfaces
  do not emit a duration to the agent.** [C] Only `ss-trace` writes `latencyMs`. Wall-clock per
  rollout is in `rows.json` (`wallMs`) but cannot be attributed to a tool call. Getting real
  per-call latency needs an instrumentation change, not a re-read.
- **I did not verify on disk that the paths in defect D6 (`ss-read` ENOENT) are truly absent**,
  because the golden checkouts under `/root/.ss-eval/runs/` are removed after a run. The split
  I report (21 of 51 named a path an earlier ss-* result had shown) is derived from the traces
  alone, so "the tool pointed at a file that does not exist" is [I], not [M]; the alternative is
  that the tool named a path that exists in *another* file's text and the agent copied it.
  A $0 check exists: re-create either b2 golden from the task spec and stat the 21 paths.
- **I did not re-price any rollout.** No cost claim in this document.

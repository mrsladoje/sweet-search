# E4 — Resolution forensics, harness = codex

**Scope.** `fp-codex-{tab,none,pipe}-20260826`. 22 unselected DEV tasks × 4 arms
(native, sweet `N<TAB>`, sweet no-gutter, sweet `N| `) × 3 reps = **264 rollouts**, all
graded, **0 rows with `resolved == null`**. Read-only over the box. No rollout launched.

**Evidence tags.** `[M]` measured — the script and the numbers are named. `[C]` read from
a source file or a deployed binary. `[I]` inferred. Every individual case is quoted with
its bytes.

---

## 0. Verdict

**Resolution on codex is decided by wrong fixes that both arms make, not by retrieval and
not by the gutter.** Of 22 tasks, 11 are solved by every arm in every rep, 5 are dead in
every arm, and 6 differ at all. **Exactly one task in the pool loses because sweet's
retrieval never reached the file the gold patch edits** — `bfgroup__b2-113` — and the
cause is an indexing coverage gap that is now measured directly on the deployed index,
not a ranking problem.

Four product defects are confirmed with bytes: **an index that excludes any directory
named `build`/`dist`/`out`/`target` and every `.jam` file** (0 of 321 `.jam` files indexed
in the b2 golden); **`ss-grep` crashing with a Node stack trace on a literal-looking
pattern** (18 crashes, 17 rollouts); **`ss-grep` reading a stale index that cannot see the
agent's own edits** (4 rollouts); and **codex truncating one ss envelope in five** at its
~2,500-token cap (312 of 1,637).

**No codex failure in this run has gutter bytes behind it.** That agrees with the
fresh-pool verdict and with the mechanism report.

---

## 1. Solve matrix

Script: `scripts/e4-codex-solve-matrix.py` → `logs/e4-codex/solve-matrix.json`.
Assertion: `rows.filter(r => r.resolved == null).length === 0` on all three runs, and
every (task, arm) cell holds exactly reps 0, 1, 2. `[M]`

| task | native | TAB | NONE | PIPE | class |
|---|---:|---:|---:|---:|---|
| absinthe-graphql__absinthe-998 | 3 | 3 | 3 | 3 | solved-everywhere |
| apigee__registry-961 | 3 | 3 | 3 | 3 | solved-everywhere |
| asynkron__protoactor-dotnet-1909 | 3 | 3 | 3 | 3 | solved-everywhere |
| aws-actions__configure-aws-credentials-42 | 3 | 3 | 3 | 3 | solved-everywhere |
| axelrod-python__axelrod-671 | 3 | 3 | 3 | 3 | solved-everywhere |
| callstack__react-native-paper-972 | 3 | 3 | 3 | 3 | solved-everywhere |
| celestiaorg__nmt-192 | 3 | 3 | 3 | 3 | solved-everywhere |
| final-form__final-form-64 | 3 | 3 | 3 | 3 | solved-everywhere |
| jazzband__tablib-454 | 3 | 3 | 3 | 3 | solved-everywhere |
| mathnet__mathnet-numerics-1072 | 3 | 3 | 3 | 3 | solved-everywhere |
| mirumee__ariadne-codegen-218 | 3 | 3 | 3 | 3 | solved-everywhere |
| **awslabs__aws-embedded-metrics-node-21** | **3** | **1** | **3** | **3** | **discordant (arm majority differs)** |
| locationtech__jts-622 | 3 | 3 | 2 | 3 | one rep lost |
| accenture__sfmc-devtools-1974 | 0 | 1 | 1 | 1 | sweet-better, no majority |
| aio-libs__aiohttp-8038 | 0 | 0 | 1 | 1 | sweet-better, no majority |
| devlooped__moq-1262 | 1 | 1 | 1 | 1 | tied, no majority |
| bfgroup__b2-113 | 1 | 0 | 0 | 0 | native-better, no majority |
| bfgroup__b2-259 | 0 | 0 | 0 | 0 | dead-everywhere |
| fastify__fastify-cors-285 | 0 | 0 | 0 | 0 | dead-everywhere |
| gitbookio__markup-it-56 | 0 | 0 | 0 | 0 | dead-everywhere |
| hotmeteor__spectator-181 | 0 | 0 | 0 | 0 | dead-everywhere |
| protofire__solhint-224 | 0 | 0 | 0 | 0 | dead-everywhere |
| **total** | **41/66** | **39/66** | **41/66** | **42/66** | |

**Discordant by arm majority: one task.** `awslabs__aws-embedded-metrics-node-21` —
sweet TAB majority 0, every other arm majority 1. Sweet-majority tasks 11 (TAB) / 12
(NONE) / 12 (PIPE) against native's 12.

**Two-sided Fisher against native, 66 per cell** `[M]`: TAB 39 v 41 `p = 0.859`;
NONE 41 v 41 `p = 1.000`; PIPE 42 v 41 `p = 1.000`. Every difference is 2 rollouts or
fewer against a pre-registered bar of 6.

**Cost check, same rows** (`idealCostUsd`, which is the break-priced column; the published
table used `costRealizedUsd`, and the two agree to 0.6%) `[M]`: native `$0.012218`,
TAB `$0.012258` (+0.3%), NONE `$0.012248` (+0.2%), PIPE `$0.012681` (+3.8%). Calls per
rollout 11.6 / 12.5 / 12.4 / 12.6; ss-* calls per sweet rollout 8.2 / 8.2 / 8.0.

---

## 2. Per-task forensics

Method for every cell below: the trace (`scripts/e4-codex-parse.py` +
`scripts/e4-codex-storyline.py`), the rollout's own `model_patch`
(`<arm>/[rep-N/]patches.json`), the gold patch and `FAIL_TO_PASS` from
`select/.cache/tasks_full_heldout.json`, and the grader log
(`<arm>/[rep-N/]logs/<task>_log.txt`).

**Did retrieval reach the gold file?** `scripts/e4-codex-goldreach.py` counts, per arm,
how often each gold file was *named on a command line*, *shown in a tool result*, and
*patched*. Across all 22 tasks the arms are within one rollout of each other on every
task except one. `[M]`

| task | native named/shown/patched | TAB | NONE | PIPE |
|---|---|---|---|---|
| **bfgroup__b2-113** | **3/3/2 of 3** | **0/0/0 of 3** | **0/0/0 of 3** | **0/0/0 of 3** |
| bfgroup__b2-259 | 1/2/0 of 3 | 3/3/1 of 3 | 2/3/0 of 3 | 1/2/0 of 3 |
| gitbookio__markup-it-56 | 3/3/0 of 3 | 3/3/2 of 3 | 3/3/2 of 3 | 3/3/1 of 3 |
| aio-libs__aiohttp-8038 | 3/3/2 of 3 | 2/2/1 of 3 | 3/3/2 of 3 | 3/3/2 of 3 |
| all other 18 tasks | — | within 1 of native | | |

### 2.1 `awslabs__aws-embedded-metrics-node-21` — the one discordant task

Gold changes `MetricsContext.putDimensions` so a repeated dimension **key set** is not
pushed; F2P is `putDimension will not duplicate dimensions` and
`… multiple in different order`; 71 P2P.

| cell | reps solved | deciding failure mode |
|---|---|---|
| native | 3 | — |
| TAB rep0 | solved | — |
| **TAB rep1** | f2p=0 | **wrong-fix, not-localised** — patched `src/serializers/LogSerializer.ts` (dedupe at serialization) instead of the context. |
| **TAB rep2** | f2p=1, resolved=false | **test-harness flake** — P2P `createCopyWithContext copies properties and dimensions` failed on a 1 ms timestamp. |
| NONE, PIPE | 3, 3 | — |

**TAB rep2 is not a wrong fix.** The grader log shows the whole delta `[M]`:

```
    expect(received).toStrictEqual(expected) // deep equality
      "meta": Object {
    -     "Timestamp": 1787797443727,
    +     "Timestamp": 1787797443728,
```

The same test passes in the other **11 of 12** cells of this task
(`grep -c "✕ createCopyWithContext copies properties and dimensions"` over all twelve
logs: 1 hit, in `fp-codex-tab-20260826/sweet/rep-2`). One millisecond decided a rollout.
Caveat stated against sweet: the rep-2 patch also rewrote `setDimensions` (gold does not),
so it does marginally more work inside the copied path; the observed delta is still 1 ms
and the dimensions compared equal.

**TAB rep1 is a wrong choice with the right evidence on screen.** Call 4 was
`ss-read src/serializers/LogSerializer.ts 1 140 && ss-read src/logger/MetricsContext.ts 75 135 && ss-read src/logger/MetricsLogger.ts 55 105`
— `putDimensions` sits at line 91, inside the window it read. **ss-\* contribution: none
negative.** Results were correct and complete; the model localised to the serializer after
framing its own second query as *"reject repeated dimension combinations before metric
serialization"*.

**Gutter:** TAB rep0 solved with the identical delimiter. No bytes implicate it.

### 2.2 `accenture__sfmc-devtools-1974` — sweet 1/3 in every form, native 0/3

Gold gates the new "type is required" check on a **per-method `requireType` flag** that is
`true` for execute/pause/stop/publish/validate and **`false` for `fixKeys` and
`replaceCbReference`**. F2P: `Should not refresh anything due to missing type`. P2P: 8.

Reading each cell's two graded tests directly out of the logs `[M]`:

| cell | F2P | P2P `Should exit fixKeys …` | mode |
|---|---|---|---|
| native rep0/1/2 | pass | **fail** ×3 | wrong-fix: blanket guard |
| TAB rep0 | pass | fail | wrong-fix: blanket guard |
| TAB rep1 | **fail** | pass | **edit-mechanics: hunk landed in the wrong function** |
| TAB rep2 | pass | pass | solved (`else if (methodName === 'refresh')`) |
| NONE rep0 | pass | fail | wrong-fix: blanket guard |
| NONE rep1 | pass | pass | solved (`if (!selectedTypes)` only) |
| NONE rep2 | **fail** | pass | **edit-mechanics** |
| PIPE rep0 | **fail** | pass | **edit-mechanics** |
| PIPE rep1 | pass | fail | wrong-fix: blanket guard |
| PIPE rep2 | pass | pass | solved (`else` on `if (selectedTypes)`) |

**The wrong fix, with the byte that proves it.** Six cells added a guard that also treats
an *empty* type list as missing. The grader log for native rep0 shows it firing inside the
`fixKeys` test `[M]`:

```
    FixKeys ================
01:52:53 error: At least one type is required.
      98) Should exit fixKeys because event is not supported intentionally
```

The three solved cells all guard on a falsy value only, or scope the guard to `refresh`.

**The edit-mechanics failure is new and it is sweet-only here.** Native and sweet wrote
the *identical* patch with the *identical* anchor `[M]`:

```
apply_patch <<'PATCH'
*** Begin Patch
*** Update File: lib/index.js
@@
         /** @typedef {TypeKeyCombo} */
         let selectedTypesObj;
+        if (
+            !selectedTypes ||
...
```

That two-line anchor occurs **twice** in `lib/index.js`. codex's `apply_patch` seeks
forward from the current index, so the hunk landed at the **first** site, line 1593,
inside a different method — silently, with `Success. Updated the following files:`. The
model's own summary says it edited **line 1743**. Native then ran
`git diff -- lib/index.js`, saw the wrong site, and issued a second `apply_patch` that
removed the block from 1593 and re-added it at the second occurrence; the final native
patch header reads `@@ -1740,6`. Sweet did not. **All three sweet misplacements shipped.**

Note the honest twist: PIPE rep0 **did** run `git diff -- lib/index.js` and received
`@@ -1593,6 +1593,10 @@` in the output, then refined the condition without noticing the
site. Seeing the diff is not the same as checking it.

**ss-\* contribution: none.** Gold files were named 3/6 and shown 6/6 in every arm.
**Environment:** the repo's suite reports `14 passing / 16 pending / 234 failing` in every
cell, all from `ReferenceError: structuredClone is not defined`, and `run_tests` returns
`status=INFRA scope=full exit=233`. The agent has no working oracle; resolution turns on a
single P2P test.

### 2.3 `aio-libs__aiohttp-8038` — sweet 1/3 on NONE and PIPE, native 0/3

Gold retries a disconnected persistent connection **once, for idempotent methods**, in
`ClientSession._request`.

The two winners (NONE rep0, PIPE rep0) shipped the minimal unconditional retry
(`retry_persistent_connection = True` … `except ServerDisconnectedError: … continue`). The
seven losers **over-conditioned it** on the response's keep-alive header or on
`conn.reused` — a `has_keepalive_header` / `_has_keep_alive` property added to
`client_proto.py` and threaded through `connector.py`. Gold conditions on the **method**,
never on the header; the problem statement's emphasis on `Connection: keep-alive` is the
lure. Failure mode: **wrong-fix (over-conditioned)**, plus two shallow cells —
TAB rep0 patched `client_reqrep.py` and TAB rep1 shipped a one-line `connector.py` change
after 12 calls and stopped (`stopping short`).

**ss-\* contribution: none negative.** `aiohttp/client.py` was named and shown in 2–3 of 3
rollouts in every arm. NONE rep0 is the most expensive rollout in the pool
(41 calls, `$0.045`) and it ground its way to the right answer.

### 2.4 `bfgroup__b2-113` — the only retrieval loss in the pool

Gold is four lines in **`src/tools/stage.jam`**:

```
+    rule skip-from-usage-requirements ( )
+    {
+    }
```

Native rep0 wrote exactly that and solved. Native rep1/rep2 went to the Python port and
failed. **All nine sweet rollouts patched Python** (`src/build/targets.py`,
`src/tools/stage.py`) — the other implementation of the same idea.

**`stage.jam` was never named on a sweet command line and never appeared in any sweet tool
output, in 9 of 9 rollouts.** In native it appears in 4–6 commands and 45–89 output lines
per rollout `[M]`.

The cause is measured on the deployed index, not inferred `[M]`. Reading the golden
checkout's own `.sweet-search/code-graph.db`:

```
/root/.ss-eval/golden/bfgroup__b2@371b47af…/.sweet-search/code-graph.db
  distinct files indexed: 330          .jam files on disk: 321
  .jam entities:                    0
  entities under any build/ dir:    0
  src/tools/stage.jam:              0 entities
  src/build/targets.py:             0 entities
  src/build/property_set.py:        0 entities
  src/tools/stage.py:              18 entities
  src/build_system.py:             14 entities
```

Both exclusions are visible in the source `[C]`
(`core/infrastructure/config/search.js`): `FILE_PATTERNS.include` has **no `**/*.jam`
glob**, and `FILE_PATTERNS.exclude` contains the unanchored
`'**/build/**'`, `'**/dist/**'`, `'**/out/**'`, `'**/target/**'`, `'**/generated/**'`,
which delete `src/build/**` from a repository whose engine lives there.

The traces agree: across 18 sweet rollouts on the two b2 tasks, ss-search/ss-grep/ss-find
returned **0 `.jam` paths of 1,586 file citations**, while ss-read returned `.jam` content
44 times on b2-259 (reached by path, not by search). 50 of the pool's 131 zero-match
ss-grep calls are on b2-113 and 35 on b2-259.

**Failure mode:** `not-localised`, caused by an index coverage gap.
**Gutter:** irrelevant; all three forms behave identically.

### 2.5 `devlooped__moq-1262` — 1/3 in every arm

Gold is a `ExpressionType.Quote` fix spread over `Evaluator.cs`, `ExpressionComparer.cs`,
`ExpressionExtensions.cs` and `EvaluateCaptures.cs`; F2P is one test
(`Issue1217.It_Is_predicates_are_evaluated_lazily`) against 1,674 P2P.

Four different designs pass it — native rep1 and PIPE rep2 (make two distinct `Match`
argument matchers unequal in `MethodExpectation`), NONE rep0 (an `evaluateCaptures` flag on
`ExpressionComparer`), TAB rep2 (`HasNonConstantMatchers` + last-match selection). Eight
cells fail with `f2p=0`. **Arm-uniform wrong-fix**; no arm has an edge.

This task carries the pool's heaviest `ss-read` friction: **20 `--force` re-reads**
(the unchanged-reread suppression firing on `src/Moq/MethodExpectation.cs`,
`SetupCollection.cs`, `Match.cs`), and an `[ss-read] error: stat failed: ENOENT` on a
guessed path `src/Moq/Expressions/Visitors/PartialMatcherAwareEval.cs`. Neither decided a
rollout.

### 2.6 `locationtech__jts-622` — one rep lost, one token wide

Gold: `writeNaNs(2, os)` → `writeNaNs(outputDimension, os)`.
NONE rep1 wrote exactly that and solved. **NONE rep2 wrote
`writeNaNs(pt.getCoordinateSequence().getDimension(), os)`** and failed. `[M]`

The loser is the cheapest rollout in the cell (3 calls, `$0.0048`) and read a 90-line
window; the winner read 380–449 as well and ran
`ss-grep "writeNaNs" --in …/WKBWriter.java`. Both saw `run_tests status=PASS scope=full`
— the hidden test is not in the visible suite, so a green suite is not evidence.
**Failure mode:** wrong-fix, reached by stopping the read early.
**ss-\* contribution: none negative.**

### 2.7 The five dead-everywhere tasks

| task | gold | what all 12 cells did | mode |
|---|---|---|---|
| `bfgroup__b2-259` | `src/build/property.jam` — return `<build>no` early from `evaluate-conditionals-in-context` | 11 of 12 patched `configure.jam` (the caller) or the feature declaration; TAB rep2 alone patched `property.jam`, with the wrong rule | not-localised / wrong-fix; the same `.jam` + `build/` index gap as 2.4 |
| `fastify__fastify-cors-285` | one character: `fastify.options('/*', …)` → `fastify.options('*', …)` | every cell added a **second** route (`fastify.options('/')` guarded by `fastify.prefix`) or refactored the handler | arm-universal wrong-fix; the knowledge is in the router's wildcard semantics, not in the repo |
| `gitbookio__markup-it-56` | rewrite the inline HTML serializer **and** add `mergeHTMLNodes` | TAB rep1 and NONE rep0 wrote the serializer half (`node.shift().write(node.data.get('html'))`) and never added the merge; the rest went to `blocks/paragraph.js` / `blocks/unstyled.js` | incomplete (one of two obligations) / not-localised. Sweet patched the gold file 2/2/1 of 3 against native's **0 of 3** |
| `hotmeteor__spectator-181` | move the status assertion **before** the exception check and use `$this->assertStatus($status)` | every cell kept the order and added a range guard (`>= 200 && < 300`, `!== 500`, `< 400`) | arm-universal wrong-fix (ordering) |
| `protofire__solhint-224` | add `lib/rules/order/ordering.js` + edit 4 files | every cell inlined the checker in `lib/rules/order/index.js`; `f2p = 0.4` in 8 of 12 | incomplete / wrong design. NONE rep2 created gold's file at call 12 and deleted it at call 17 |

**None of the five is retrieval-bound**, except b2-259's shared index gap. Gold files were
named and shown by every arm at parity (§2 table).

---

## 3. Tool health — all 198 sweet rollouts on this harness

Script: `scripts/e4-codex-toolhealth3.py` → `logs/e4-codex/toolhealth3.json`.
1,637 exec envelopes contained an ss-* call; **2,856 ss-\* calls in total**. `[M]`

| tool | TAB | NONE | PIPE | total | zero-result |
|---|---:|---:|---:|---:|---:|
| ss-read | 542 | 484 | 531 | **1,557** | 0 |
| ss-grep | 219 | 218 | 221 | **658** | **131 (19.9%)** |
| ss-search | 123 | 139 | 122 | **384** | 0 |
| ss-find | 27 | 46 | 42 | **115** | 0 |
| ss-semantic | 46 | 30 | 30 | **106** | 0 |
| ss-trace | 13 | 14 | 9 | **36** | 0 |

`ss-edit` and `ss-files` were called **0 times** on this harness.

**Latency `[M]`:** the exec envelope's own `Wall time:` header, for envelopes containing an
ss-* call — median 0.069 s (TAB), 0.081 s (NONE), 0.075 s (PIPE); p90 0.401 / 0.404 /
0.446 s. The p90 carries the cold model warm-up of D7, not query time.

**Yields and timeouts `[M]`:** codex polls a still-running command with `write_stdin`.
38 polls in 18 native rollouts, 45 / 23 (TAB), 39 / 22 (NONE), 46 / 23 (PIPE). **Only 7 of
the 130 sweet polls follow an envelope containing an ss-\* call** (2 / 2 / 3); the rest
follow `run_tests`. **No ss-\* call timed out.**

### 3.1 Product-defect list

Counts are `calls | rollouts-with`, denominator 66 per arm. For D1 the count is the
**scoped** contradiction (the same rollout read the text from a file inside the ss-grep
scope): 26 of 131 zero-match calls, by task b2-113 17, b2-259 6, aws-actions 1, aiohttp 1,
solhint 1. For D3 the count is what survives a file-and-order check: 9 rollouts flagged,
**4 clean** after dropping cases whose evidence came from a different file or from an
excluded directory (those are D1).

| # | defect | TAB | NONE | PIPE | quoted example |
|---|---|---|---|---|---|
| D1 | **index excludes `**/build/**`-style dirs and every `.jam` file** — search cannot see source the agent can read | 6 \| 5 | 13 \| 8 | 7 \| 2 | `ss-grep "class MainTarget" --in src` → `# ss-grep: 0 total match(es) for /class MainTarget/ (scope: --in src)`, while `ss-read src/build/targets.py 260 700` in the same rollout printed `667\| class MainTarget (AbstractTarget):` (`bfgroup__b2-113/PIPE/rep0`) |
| D2 | **`ss-*` crashes on a literal-looking pattern**, printing a Node stack trace | 8 \| 8 | 5 \| 5 | 5 \| 5 | `ss-grep "GetApi(ctx" -k 20` → `[ss-*] crash: Error: ripgrep failed (code 2): rg: regex parse error:\n    (?:GetApi(ctx)\n    ^\nerror: unclosed group\n    at ChildProcess.<anonymous> (…/core/search/search-pattern-ripgrep.js:271:16)` (`apigee__registry-961/TAB/rep0`) |
| D3 | **`ss-grep` reads a stale index** — it cannot see the agent's own edits, in the same envelope as an `ss-read` that can | 0 | 4 \| 4 | 0 | `ss-grep "OrderingChecker" -k 10 && ss-read lib/rules/order/index.js 1 30` → `# ss-grep: 0 total match(es) for /OrderingChecker/\n(no matches)\n# ss-read lib/rules/order/index.js (lines 1-13 of 13)\n\`\`\`javascript\nconst OrderingChecker =…` (`protofire__solhint-224/NONE/rep2`; the class was added by the agent at call 12, grepped at call 15) |
| D4 | **codex truncates ss output at ~2,500 tokens** | 105 \| 39 | 100 \| 34 | 107 \| 34 | `Warning: truncated output (original token count: 2937)` on `ss-read AGENTS.md 1 240; …; ss-find 'render_default_value' …` (`absinthe-graphql__absinthe-998/TAB/rep0`) |
| D5 | **unchanged-reread suppression costs a retry call** | 43 \| 20 omissions, 7 \| 6 `--force` | 40 \| 16, 2 \| 2 | 46 \| 22, 10 \| 3 | `# ss-read lib/index.js (lines 1738-1810 of 2279)` + `[unchanged reread omitted; these exact source lines were already shown 2 sweet-search calls ago within lib/index.js:1660-1815 …]` then `ss-read --force lib/index.js 250 390` (`accenture__sfmc-devtools-1974/TAB/rep0` and `rep2`) |
| D6 | **`ss-read` ENOENT with no recovery hint** | 12 \| 6 | 9 \| 5 | 6 \| 4 | `ss-read src/b2/build/targets.py 1 280` → `[ss-read] error: stat failed: ENOENT` (`bfgroup__b2-113/TAB/rep0`) |
| D7 | **loader and warm-up diagnostics printed into agent context** | 8 \| 7 | 5 \| 5 | 5 \| 5 | `BinaryHNSW: Loaded 6863 vectors from /root/.ss-eval/runs/r0-14/.sweet-search/codebase-binary-hnsw.idx (asymmetric=false) \| LateInteraction: Streaming load 5000 documents… \| Local model loaded in 2522ms` (`apigee__registry-961/TAB/rep0`); 13.3 kB total across 198 rollouts |
| D8 | **envelope exits non-zero after an ss-\* call**, which can break an `&&` chain | 25 \| 15 | 20 \| 13 | 21 \| 14 | `ss-read --force aiohttp/client_proto.py 1 22 && ss-grep "CONNECTION" aiohttp/hdrs.py -k 5` → exit 2, `[ss] if this is part of the pattern, quote the whole pattern` (`aio-libs__aiohttp-8038/TAB/rep2`). Attributable exits: ss-read 29, ss-grep 20, ss-trace 8, ss-search 4, ss-find 1, ss-semantic 1 |
| D9 | **`ss-semantic` degrades silently on an unindexed file** | 1 \| 1 | 0 | 0 | `[ss-semantic] error: file not indexed for semantic span selection — returning whole file via plain read` (`bfgroup__b2-113/TAB/rep0`) |
| D10 | **`ss-search`/`ss-find`/`ss-semantic` never return "not found"** — 0 zero-result calls in 605 | — | — | — | structural: a ranked retriever always returns top-k, so the agent gets no absence signal and must infer it |

**Native-tool fallback after an ss-\* result** (`grep`/`rg`/`sed`/`cat`/`nl` on a file an
earlier ss-* call had returned): **9 \| 4 (TAB), 10 \| 5 (NONE), 20 \| 9 (PIPE)** — 39
events in 18 of 198 rollouts. The largest cluster is D1 in action:

```
ss-grep "AWS_ACCESS_KEY_ID" --in dist/index.js -k 10   → 0 total match(es)
rg -n -F -C 8 "AWS_ACCESS_KEY_ID" dist/index.js        → the agent's own fallback
```
(`aws-actions__configure-aws-credentials-42/TAB/rep1`; `dist/` is excluded from the index
by `'**/dist/**'`.) Rollouts with both a zero-match ss-grep and a native fallback: 1 (TAB),
3 (NONE), 5 (PIPE).

### 3.2 Edit mechanics (codex packs `apply_patch` into `exec_command`)

`scripts/e4-codex-editcensus.py`. Codex edits **are** counted here — the previous
cross-harness census had no codex edit branch. `[M]`

| | native | TAB | NONE | PIPE |
|---|---:|---:|---:|---:|
| apply_patch calls | 124 | 112 | 124 | 121 |
| failed calls | 8 | 6 | 4 | 4 |
| rollouts with ≥1 failed edit | 7/66 | 5/66 | 2/66 | 4/66 |
| hunks | 259 | 211 | 269 | 213 |
| hunks with a **bare** `@@` header | **259** | **211** | **269** | **213** |
| hunks with a located `@@ <context>` header | **0** | **0** | **0** | **0** |
| hunks whose context is ≤2 non-blank lines | 85 | 53 | 83 | 66 |
| post-edit real `git diff` (not `--check`) | 54/66 | 48/66 | 46/66 | 44/66 |

**Sweet's edits fail less often than native's** (6/112, 4/124, 4/121 against 8/124), and
**no failed hunk in any arm contains gutter residue** — the failure strings are
`Failed to find expected lines`, `Failed to find context`, and one
`Failed to read file to update … No such file or directory` from a stale absolute path.
**952 of 952 `@@` headers in the whole run are bare**, so every hunk is placed by forward
seek. That is the mechanism behind §2.2.

**Silent misplacement rate** (`scripts/e4-codex-misplace.py`): comparing the `path:line`
the agent states in its final message with the hunk ranges of its own `model_patch`,
**1 inconsistent claim in 293** — `accenture/TAB/rep1`, `lib/index.js:1743` claimed against
a hunk at 1593. Rare, but it decided a rollout.

### 3.3 Measurement caveats

- **10.1% of ss-* calls could not be matched to a banner in their envelope's output**
  (288 of 2,856): 172 of 681 inside codex-truncated envelopes (25%) and 116 of 2,175
  elsewhere (5.3%). Zero-result and error counts are therefore **lower bounds**.
- The 131 zero-match ss-grep calls were tested twice. An unscoped within-rollout test
  contradicts 80; a **scoped** test — the evidence must come from a file inside the
  `--in` scope — contradicts **26**. The 26 is the number to quote
  (`scripts/e4-codex-grepmiss2.py`). 3 patterns are not valid Python regexes and were
  skipped.
- Rollout→rep mapping comes from `rows.json`'s own `rolloutFile`, so trap 5
  (extra transcripts in a cell) cannot apply here.

---

## 4. Resolution levers this harness's traces support

Each is checked against `SLATE-A-UBER.md` §9 and `SLATE-B-UBER.md` §8, and against the
`gutter-mechanism` proposals.

### L1 — Anchor the build-output exclude globs; add `.jam` to `FILE_PATTERNS.include`

- **Tasks where it cost something:** `bfgroup__b2-113` (sweet reached the gold file in
  0 of 9 rollouts, native in 3 of 3) and `bfgroup__b2-259` (same gap).
  **Tasks where it is visible but harmless:** `aws-actions__configure-aws-credentials-42`
  (ss-grep on `dist/index.js` returns 0 and the agent falls back to `rg`; `dist/` is a
  build artifact, so excluding it is arguably right and the task is solved 12/12) and
  `apigee__registry-961` (52 known-extension files sit under an excluded directory;
  solved 12/12).
- **Mechanism `[C]+[M]`:** `'**/build/**'` is unanchored, so `src/build/**` is deleted from
  the index of any repo that keeps source there; `.jam` has no include glob. Verified on
  the deployed golden index: 0 of 321 `.jam` files, 0 entities under `build/`.
- **$0 falsifier:** re-index the three b2 goldens with `**/*.jam` added and the four
  build-output globs anchored to the repo root, then replay the 50 zero-match ss-grep
  queries recorded in the b2 traces. **Kill** if fewer than half return the line the same
  rollout's `ss-read` printed.
- **Discard-log check:** absent from both logs. It **contradicts** the standing
  extension-coverage audit (`project_taskbench_extension_coverage_audit`: "only zeek `.bif`
  blind spot") — that audit tested extensions, never directory exclusions, and missed
  `.jam`. **New evidence.**
- **Honest bound:** native also fails b2-113 in 2 of 3 and b2-259 in 3 of 3. The most this
  can be worth on this pool is +1 to +2 rollouts of 66 — **below the pre-registered bar of
  6.** Ship it as a correctness fix, not as a resolution claim.

### L2 — `ss-grep` must not crash on a pattern that is not a valid regex

- **Tasks:** 8 tasks, 17 rollouts, 18 crashes (TAB 8, NONE 5, PIPE 5).
- **Mechanism `[M]+[C]`:** the wrapper hands the pattern to ripgrep unchanged; a parse
  error escapes as an unhandled rejection and the agent receives a Node stack trace.
  `writeRegexDialectHint(result.stats)` only runs on the success path. Two causes are
  visible: unescaped `(` in a call-site query (`GetApi(ctx`) and BRE alternation (`A\|B`).
- **$0 falsifier:** replay the 18 recorded patterns against a golden with a retry that
  falls back to `-F` on a regex-parse error. **Kill** if fewer than half return matches
  under `-F`.
- **Discard-log check:** absent from both logs. The BRE `\|` half is a **known open bug**
  (`project_cost_forensics` / failure-forensics review, 2026-07-14); the unescaped-paren
  half and the crash-instead-of-hint behaviour are new.
- **Bound:** no crash decided a rollout in this run. This is a product-quality fix with a
  cost benefit (each crash burns an envelope plus ~2 kB of stack trace), not a resolution
  lever.

### L3 — Make `ss-grep` see the working tree, or say that it cannot

- **Tasks:** `protofire__solhint-224`, `aio-libs__aiohttp-8038`,
  `callstack__react-native-paper-972`, `accenture__sfmc-devtools-1974`; 4 clean rollouts.
- **Mechanism `[M]`:** `ss-grep` is index-backed (`queryWarmSearch(mode:'grep')` /
  `bareGrep`); nothing re-indexes during a rollout. The tool contract says the ss-* tools
  track the working tree.
- **$0 falsifier:** count the ss-grep calls that occur after the rollout's first successful
  edit — that is the exposed population — and how many of them query a symbol the agent
  added. **Kill** if the exposed population is under 5% of ss-grep calls.
- **Discard-log check:** absent from both logs. New.
- **Bound:** it never decided a rollout on codex.

### L4 — Keep rendered ss-read under codex's ~2,500-token cap — **already dead, and my data does not revive it**

312 of 1,637 ss envelopes truncate (19%), touching 39/34/34 rollouts. That is the
population, not a mechanism. The mechanism check was already run and failed: **0 of 6
never-shown edit anchors fell inside a truncated span** (gutter-mechanism §4.2, R6).
Nothing in the codex traces here changes that. **Do not re-open without a new mechanism.**

### L5 — Price the unchanged-reread suppression — **low value, borderline against the discard log**

129 omissions bought 19 `--force` retry envelopes (7/2/10). A $0 falsifier exists (compare
the bytes the omissions withheld against the cost of the 19 retry envelopes), but
`SLATE-B-UBER` §8 already bans "return the same slice more compactly", and this is the same
family. **Report the number; do not build on it.**

### L6 — Ambiguous-anchor misplacement — **drop as a lever, keep as a known failure mode**

The mechanism is real and fully quoted (§2.2): a two-line anchor that occurs twice, a bare
`@@`, a silent landing at the wrong site, and a model summary that names the site it did
not edit. But:

- the population rate is **1 in 293** cited claims;
- the obvious remedy fails its own population test — rollouts that ran a post-edit
  `git diff` solved **113/192** against **50/72** for those that did not
  (`p = 0.12`, the wrong direction), and PIPE rep0 saw the wrong hunk header in its diff
  and still missed it;
- the prompt form is dead by `project_clause_candidate_dead` and `SLATE-A-UBER` §9 item 11.

**Verdict: no lever.** The only surviving idea is tool-side — have `ss-read` report when a
requested span's text is not unique in the file — and it rests on a single case.

### L7 — Nothing on the gutter

Across 264 rollouts, 952 hunks and 26 failed edits, **no failed hunk contained gutter
residue and no failure differed by delimiter**. Codex's `seek_sequence` trims both sides
before comparing `[C]`, so a leaked delimiter space cannot fail it. This is the third
independent confirmation.

### What the traces say about where resolution actually goes

Every one of the **101 unsolved cells** in the 11 non-trivial tasks, classified from its
own `model_patch` against gold:

| mode | cells | where |
|---|---:|---|
| wrong-fix — a semantic choice both arms make | **50** | fastify 12, spectator 11, moq 8, accenture 6, aiohttp 6, b2-113 1, b2-259 1, jts 1, markup-it 4 |
| not-localised | **33** | b2-259 11, b2-113 10, markup-it 6, aiohttp 4, awslabs 1, spectator 1 |
| incomplete — one of two obligations | **14** | solhint 12, markup-it 2 |
| edit-mechanics — silent hunk misplacement | **3** | accenture (TAB rep1, NONE rep2, PIPE rep0) |
| test-harness / environment | **1** | awslabs TAB rep2 |

Of the 33 not-localised cells, **21 are the two b2 tasks**, and **9 of those 21 — every
sweet cell of `bfgroup__b2-113` — are the index gap of L1**. The other 12 are ordinary
mis-localisation: native rep1 on b2-113 saw `stage.jam` and chose the Python port anyway,
and every b2-259 cell reached `.jam` files by path and still patched the caller.

**Retrieval explains 1 task.** Everything else is the resolution floor this programme has
already documented (`project_resolution_floor_universal_wrongfix`): the model picks a
plausible design that the hidden test rejects, and it does so in both arms.

---

## 5. Reproduction

Scripts (all local, all shipped to `/tmp/fp-inv/e4-codex/` on the box and run there):

| script | what it does |
|---|---|
| `scripts/e4-codex-solve-matrix.py` | solve matrix, null assertion, task classes |
| `scripts/e4-codex-parse.py` | codex trace normaliser (`function_call` / `function_call_output`, exec wrapper, token_count, agent_message) → `all.jsonl` |
| `scripts/e4-codex-storyline.py` | per-rollout call storyline with edit verdicts and run_tests verdicts |
| `scripts/e4-codex-taskcard.py`, `scripts/e4-codex-cellcard.py` | task spec + gold + per-cell `model_patch` + grader lines (exact-id lookup; `devlooped__moq` is ambiguous in the task file — `-1259` and `-1262` both exist) |
| `scripts/e4-codex-toolhealth.py`, `-toolhealth2.py`, `-toolhealth3.py` | tool-health census (v3 is the one quoted) |
| `scripts/e4-codex-grepmiss.py`, `-grepmiss2.py` | unscoped and **scoped** within-trace falsifier for ss-grep zero results |
| `scripts/e4-codex-stale.py` | zero results for text the agent itself added |
| `scripts/e4-codex-indexcoverage.py` | per-task searched-vs-read file sets, `--force`, "not indexed" |
| `scripts/e4-codex-indexgap.py` | indexed-vs-on-disk per pool repo, from each golden's `code-graph.db` |
| `scripts/e4-codex-editcensus.py` | apply_patch calls, failures, anchor shape, self-reverts |
| `scripts/e4-codex-misplace.py` | stated `file:line` against the produced hunk ranges |
| `scripts/e4-codex-goldreach.py` | gold-file named / shown / patched per arm |

Artifacts: `logs/e4-codex/*.json`. Structured summary: `04-resolution-codex.json`.

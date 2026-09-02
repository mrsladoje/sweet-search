# E4 — Resolution forensics, harness = opencode

**Scope.** 22 fresh-pool tasks × 4 arms (native, sweet TAB, sweet NONE, sweet PIPE) × 3 reps =
**264 rollouts**. Sweet rows come from `fp-opencode-{tab,none,pipe}-20260826`, with the 11
repair tasks taken from `rp-oc-{tab,none,pipe}-20260827`; native comes from
`fp-opencode-tab-20260826`. Read-only over the box. No rollout launched, nothing under
`results/` written.

**Tags.** `[M]` measured (script + numbers named). `[C]` read from source or a deployed
binary. `[I]` inferred.

---

## 0. Verdict

**Three findings, in order of size.**

1. **The one task where sweet loses rollouts to native is decided by edit addressing, not by
   retrieval and not by the gutter.** On `accenture__sfmc-devtools-1974` the file carries two
   byte-identical six-line regions in two different methods. `apply_patch` resolves a bare `@@`
   hunk to the first one, answers `Success`, and names no line. Five of nine sweet rollouts and
   one of three native rollouts wrote the guard into the wrong method. One rollout read the wrong
   line number in its own `git diff`, moved the hunk, and solved. **[M]**

2. **A file kind that carries 100% of the answer is missing from the index.** `bfgroup/b2` ships
   **321 `.jam` files against 270 `.py` files** (225 against 66 under `src/`); `.jam` is not in `FILE_PATTERNS.include`, so all three
   b2 goldens hold **zero** `.jam` chunks. Across nine sweet rollouts on `b2-113` the retrieval
   named `.py` paths 185–327 times and `.jam` paths 0–2 times. All nine patched `.py`. Native's
   first `grep` returned 18 `.jam` paths, and native solved once. **[M][C]**

3. **The gutter delimiter has no mechanism on this harness, now at 22 tasks instead of 6.**
   466 `apply_patch` bodies contain **zero** gutter residue in any form. 14 edits failed; none is
   a whitespace carry. TAB has **0** rollouts with a failed edit, against NONE 6 and PIPE 4. **[M]**

Resolution totals reproduce the published table exactly: native **41/66**, TAB **41/66**,
NONE **39/66**, PIPE **38/66**.

---

## 1. Solve matrix and completeness

`scripts/e4-opencode-solve-matrix.py`. **Every denominator is complete**: 264 of 264 rollouts
present, 0 with `resolved == null`, 0 duplicate reps, 0 missing transcripts. **[M]**

| task | native | TAB | NONE | PIPE | class |
|---|---:|---:|---:|---:|---|
| absinthe-graphql__absinthe-998 | 3/3 | 3/3 | 3/3 | 3/3 | solved everywhere |
| accenture__sfmc-devtools-1974 | 2/3 | 1/3 | 1/3 | 2/3 | **discordant** |
| aio-libs__aiohttp-8038 | 0/3 | 1/3 | 0/3 | 0/3 | rep-discordant |
| apigee__registry-961 | 3/3 | 3/3 | 3/3 | 2/3 | rep-discordant |
| asynkron__protoactor-dotnet-1909 | 3/3 | 3/3 | 3/3 | 3/3 | solved everywhere |
| aws-actions__configure-aws-credentials-42 | 3/3 | 3/3 | 3/3 | 3/3 | solved everywhere |
| awslabs__aws-embedded-metrics-node-21 | 2/3 | 3/3 | 2/3 | 1/3 | **discordant** |
| axelrod-python__axelrod-671 | 3/3 | 3/3 | 3/3 | 3/3 | solved everywhere |
| bfgroup__b2-113 | 1/3 | 0/3 | 0/3 | 0/3 | rep-discordant |
| bfgroup__b2-259 | 0/3 | 0/3 | 0/3 | 0/3 | dead everywhere |
| callstack__react-native-paper-972 | 3/3 | 3/3 | 3/3 | 3/3 | solved everywhere |
| celestiaorg__nmt-192 | 3/3 | 3/3 | 3/3 | 3/3 | solved everywhere |
| devlooped__moq-1262 | 0/3 | 0/3 | 0/3 | 0/3 | dead everywhere |
| fastify__fastify-cors-285 | 0/3 | 0/3 | 0/3 | 0/3 | dead everywhere |
| final-form__final-form-64 | 3/3 | 3/3 | 3/3 | 3/3 | solved everywhere |
| gitbookio__markup-it-56 | 0/3 | 0/3 | 0/3 | 0/3 | dead everywhere |
| hotmeteor__spectator-181 | 0/3 | 0/3 | 0/3 | 0/3 | dead everywhere |
| jazzband__tablib-454 | 3/3 | 3/3 | 3/3 | 3/3 | solved everywhere |
| locationtech__jts-622 | 3/3 | 3/3 | 3/3 | 3/3 | solved everywhere |
| mathnet__mathnet-numerics-1072 | 3/3 | 3/3 | 3/3 | 3/3 | solved everywhere |
| mirumee__ariadne-codegen-218 | 3/3 | 3/3 | 3/3 | 3/3 | solved everywhere |
| protofire__solhint-224 | 0/3 | 0/3 | 0/3 | 0/3 | dead everywhere |
| **total** | **41/66** | **41/66** | **39/66** | **38/66** | |

**Eleven tasks are solved in all twelve cells and six are dead in all twelve. The whole
measurable difference between four arms lives in five tasks.**

Majority-discordant tasks, sweet against native:

| task | native majority | sweet majority | pooled sweet |
|---|---|---|---|
| `accenture__sfmc-devtools-1974` | **solve** (2/3) | **dead** (TAB 1/3, NONE 1/3, PIPE 2/3) | 4/9 |
| `awslabs__aws-embedded-metrics-node-21` | **solve** (2/3) | **solve** (TAB 3/3, NONE 2/3, PIPE 1/3) | 6/9 |

### 1.1 One row is counted but was never graded

`scripts/e4-opencode-ungraded.py`. **[M]** `bfgroup__b2-259 / PIPE / rep2`
(`fp-opencode-pipe-20260826`) carries `resolved=false` with `f2pFrac`, `resolveStatus` and
`testResults` all `null`, and its `sweet/rep-2/logs/bfgroup__b2-259_log.txt` is absent from disk
(that directory holds 20 logs for 22 tasks). It is the only such row in 264.

**PIPE is therefore 38/65 measured plus 1 unmeasured, not 38/66.** `b2-259` is 0/11 in every
other cell, so no arm ranking moves. The completeness check used in the fresh-pool report
(`rows.filter(r => r.resolved == null).length === 0`) does **not** catch this, because `resolved`
was coerced to `false`. Add a ninth trap: **check `f2pFrac`/`testResults` for null, not only
`resolved`.**

---

## 2. Per-cell forensics

Scripts: `e4-opencode-digest.py`, `e4-opencode-storyline.py`, `e4-opencode-editanchors.py`,
`e4-opencode-f2ptail.py`, `e4-opencode-cellmap.py`, `e4-opencode-ambiguity.py`.

### 2.1 `accenture__sfmc-devtools-1974` — the deciding failure is edit addressing

**Task.** One hidden test: `Should not refresh anything due to missing type`. It calls
`handler.refresh('testInstance/testBU', null)` and expects an error path, an empty result object
and zero API calls. The gold adds a `requireType` guard inside `Mcdev.#runMethod`.

**Every one of the twelve rollouts wrote the same semantic fix.** The distinguishing variable is
the insertion line. **[M]**

`lib/index.js` in the golden carries `let selectedTypesObj;` at lines 618, **1595** and **1742**.
Lines 1595 and 1742 sit in different methods and their surrounding six lines are byte-identical:

```
        /** @typedef {string[]} */
        let selectedTypesArr;

        /** @typedef {TypeKeyCombo} */
        let selectedTypesObj;
        if (selectedTypes) {
            // check if types are valid
```

Line 1595 is inside `static async fixKeys(businessUnit, selectedTypes, keys)`.
Line 1742 is inside `static async #runMethod(methodName, businessUnit, selectedTypes, keys)` —
the method the failing test reaches through `refresh()`.

**The losing hunk, verbatim** (`rp-oc-tab-20260827`, sweet TAB rep0, call 14):

```
*** Begin Patch
*** Update File: /root/.ss-eval/runs/r0-1/lib/index.js
@@
         let selectedTypesObj;
+        if (!selectedTypes) {
+            Util.logger.error('No type was provided');
+            return resultObj;
+        }
         if (selectedTypes) {
             // check if types are valid
*** End Patch
```
→ `Success. Updated the following files: M lib/index.js`

The `@@` header is empty. `seekSequence` searches forward from index 0 and takes the first match,
so the guard landed at **1595, in `fixKeys`** — while the model's own message one step earlier
read *"The failure is in shared `#runMethod` … I'm adding an early guard in `#runMethod`."*

**The winning hunk** (native rep0) spends its first hunk on the method signature, which advances
the moving index past `fixKeys`:

```
@@
     static async #runMethod(methodName, businessUnit, selectedTypes, keys) {
         Util.startLogger();
@@
         /** @typedef {TypeKeyCombo} */
         let selectedTypesObj;
+        if (methodName === 'refresh' && !selectedTypes) {
```

**The existence proof is inside the same task.** Every rollout ran `git diff` after editing.
The hunk header each one saw: **[M]**

| cell | outcome | `git diff` header the model read |
|---|---|---|
| TAB rep0 | fail | `@@ -1593,6 +1593,10 @@ class Mcdev {` |
| TAB rep1 | fail | `@@ -1593,6 +1593,10 @@ class Mcdev {` |
| TAB rep2 | solve | `@@ -1767,…` |
| NONE rep0 | fail | `@@ -1593,6 +1593,10 @@ class Mcdev {` |
| NONE rep1 | solve | `@@ -1767,…` |
| NONE rep2 | fail | `@@ -1593,6 +1593,10 @@ class Mcdev {` |
| PIPE rep0 | solve | `@@ -1767,…` |
| PIPE rep1 | fail | `@@ -1593,6 +1593,10 @@ class Mcdev {` |
| **PIPE rep2** | **solve** | first `@@ -1593,…`, **then `@@ -1740,…` after it moved the hunk** |

**PIPE rep2 saw the wrong line, acted, and solved. The five losing rollouts saw the same wrong
line and stopped.** Native rep1 also landed at the wrong site first, then repaired with a
signature-anchored three-hunk patch — and still lost, on a different fault (below).

**Was retrieval to blame? No, and I checked.** `ss-search`'s **#1 hit was `fixKeys` in 8 of 9
sweet rollouts** — `## #1 lib/index.js:1577-1659 [method: fixKeys] (full kind=chunk) score=0.349`
— which is the wrong method. But four of those eight solved, and **all nine sweet rollouts read
the `#runMethod` region** (`read1742 = true`, 9/9). The wrong `#1` is a retrieval-quality
blemish, not the decider. **[M]**

**Could the gutter form have mattered? No.** Failures split 2 TAB / 2 NONE / 1 PIPE, no hunk
contains a gutter, and the anchor text is identical across forms.

**Per-cell modes.** native rep0 solved; **native rep1 over-scoped** — its guard also rejects an
empty array or object, giving `f2pFrac=1` with `resolved=false`, i.e. a `PASS_TO_PASS`
regression; native rep2 solved; TAB rep0/rep1, NONE rep0/rep2, PIPE rep1 = **edit-mechanics**;
TAB rep2, NONE rep1, PIPE rep0/rep2 solved.

### 2.2 `awslabs__aws-embedded-metrics-node-21` — wrong layer, with the right file on screen

Hidden tests: `putDimension will not duplicate dimensions` (×2). The gold rewrites
`MetricsContext.putDimensions`. **The single deciding choice is which file. [M]**

| file patched | cells | outcome |
|---|---|---|
| `src/logger/MetricsContext.ts` | native rep1/rep2, TAB rep0/rep1/rep2, NONE rep1/rep2, PIPE rep0 | **8 solve** |
| `src/serializers/LogSerializer.ts` | native rep0, NONE rep0, PIPE rep1, PIPE rep2 | **4 fail** |

The serializer fix deduplicates at emit time and passes all 72 visible tests; the hidden tests
call the API. **Retrieval is not the cause: the losing PIPE rep1 read
`src/logger/MetricsContext.ts` at call 5 and patched the serializer at call 9.** It was also the
shortest rollout in the cell — 13 calls and 2 `run_tests` against 20–22 calls and 3 `run_tests`
for the solvers. **This confirms the kill on "more sibling retrieval" (SLATE-A §9.3, SLATE-B §8
row 1): the evidence was present and did not force the choice.**

Mode: **wrong-fix (wrong layer)** on all four failures. No ss-* contribution. No gutter role.

### 2.3 `aio-libs__aiohttp-8038` — sweet's only rollout ahead of native

Native 0/3, TAB 1/3, NONE 0/3, PIPE 0/3. The gold adds an idempotent-method retry inside
`ClientSession._request` in `aiohttp/client.py`. **[M]**

- **TAB rep1 solved** with 44 calls and 8 `run_tests`, touching `client.py` and `connector.py`
  only: it added `Connection.is_reused` and retried once on `ServerDisconnectedError`.
- Nine of the eleven failures touched `aiohttp/client_proto.py`, the transport layer — **not
  localised** — or shipped a single line (native rep2, NONE rep0, NONE rep1, TAB rep2) —
  **incomplete**. PIPE rep0 is **over-scoped**, four files including `client_reqrep.py`.
- **One ss-* contribution:** in PIPE rep2, `ss-read aiohttp/client.py 400 650` returned an empty
  body with `status=error` and no exit code; the model then re-fetched the same file with the
  harness's own `glob` and `read`. That is defect **D5** below. It cost calls, not the rollout.

### 2.4 `bfgroup__b2-113` — the index blind spot

Gold: four lines in `src/tools/stage.jam`, mirroring `alias.jam:53` and `targets.jam:1604`.

**[M]** `scripts/e4-opencode-b2dialect.py` counts the extensions named in every retrieval result:

| cell | `.jam` paths named | `.py` paths named | file patched | outcome |
|---|---:|---:|---|---|
| native rep0 | **34** | 12 | `stage.jam` | **solve** |
| native rep1 | 130 | 108 | `alias.py, targets.py, stage.py` | fail |
| native rep2 | 35 | 31 | `stage.jam` | fail (wrong rule) |
| TAB rep0/1/2 | 2 / 0 / 0 | 213 / 234 / 327 | `targets.py`, `targets.py`, `stage.py` | fail |
| NONE rep0/1/2 | 0 / 0 / 0 | 185 / 163 / 245 | `targets.py`, `targets.py`, `alias.py` | fail |
| PIPE rep0/1/2 | 0 / 0 / 0 | 271 / 234 / 263 | `stage.py` ×3 | fail |

Native's first retrieval call already returned 18 `.jam` paths and no `.py`. **Eight of nine
sweet rollouts never saw a single `.jam` path from any tool.**

**Cause, read from the index and the source. [M][C]**

```
bfgroup__b2@371b47af…/.sweet-search/codebase.db  -> 2484 chunks
  .cpp 933   .py 861   .css 438   .h 88   .yml 59   .txt 33   .md 15  …   .jam 0
tree: 321 .jam files (225 under src/), 270 .py files (66 under src/)
```
The other two b2 goldens agree: 0 `.jam` chunks each. `'.jam'` appears nowhere in
`FILE_PATTERNS.include` (`core/infrastructure/config/search.js:51`). `.jam` is also absent from
`EXTRA_GREPPABLE_CODE_EXTENSIONS`.

So `ss-search`, `ss-find` and `ss-semantic` are structurally incapable of returning the answer
file on this repo. On `b2-259` the sweet arm did reach `.jam` — but 338 of its `.jam` references
came from the **harness's own `glob`**, against 25 from `ss-grep`, 4 from `ss-semantic` and 2 from
`ss-search`. **[M]**

Mode: **not-localised, caused by an index blind spot.** This is the only place in the harness
where sweet's tools, not the model, decide the loss.

### 2.5 `apigee__registry-961` — one lost rollout, three failed ss-grep calls in it

Eleven of twelve cells solve. **PIPE rep1 patched `cmd/registry/core/list.go` — the CLI helper —
instead of `server/registry/internal/storage/list.go`, the server storage layer the tests
exercise.** Two files named `list.go`; it picked the wrong one. **[M]**

Its trace, in order:

- call 3 `ss-grep "ListArtifacts" -k 30` → 308 matches across 38 files, headed by
  `cmd/registry/cmd/check/tree/tree.go:54`. The model's next message concludes *"artifact listing
  is implemented in `cmd/registry/controller/list.go` with shared logic in
  `cmd/registry/core/list.go`"*.
- call 8 `ss-grep "type Artifact struct\|func \(.*Artifact.*Parent\|ArtifactID\|…"` →
  `0 total match(es)`, with `regex note: Rust syntax treats \| as a literal pipe … The original
  pattern was used unchanged.` (defect **D6**).
- call 11 `ss-grep "core.ListArtifacts\|ListArtifacts(ctx" -k 40 && ss-grep "func Test.*Artifact" -k 30`
  → `exit 1`, engine banner plus a Node stack trace (defect **D1**).
- call 13 `… && ss-grep "ListArtifacts" --in cmd/registry/core --regex "ListArtifacts" -k 30`
  → `exit 2`, unknown flag (defect **D3/D4 family**).
- call 15 → patched the wrong `list.go`.

**Three of its eight `ss-grep` calls failed for tool reasons.** That the failures happened is
`[M]`; that a clean call would have redirected it is `[I]`. It is nonetheless the clearest
coincidence in this harness between ss-* tool failure and a lost rollout.

### 2.6 Dead-everywhere tasks — six of six are arm-universal wrong-fix

| task | gold | what all twelve cells did instead | mode | ss-* role | gutter role |
|---|---|---|---|---|---|
| `bfgroup__b2-259` | 12 lines in `src/build/property.jam` | 10 cells patched `configure.jam` / `targets.jam`; one sweet cell (NONE rep1) reached `property.jam` through the harness `glob` and still got the semantics wrong | not-localised + wrong-fix | **yes** — 0 `.jam` chunks indexed (§2.4) | none |
| `devlooped__moq-1262` | four coordinated files; suppress capture evaluation under `ExpressionType.Quote` with a thread-static depth counter | patched `Match.cs` / `MethodExpectation.cs` / `InterceptionAspects.cs` | wrong-fix, semantic depth | no | none |
| `fastify__fastify-cors-285` | one token: `fastify.options('/*')` → `fastify.options('*')` | every cell **added** a second OPTIONS route and kept `/*` | wrong-fix / over-scoped | no | none |
| `gitbookio__markup-it-56` | add `mergeHTMLNodes`, merging consecutive inline HTML nodes on deserialisation | attacked serialisation (`node.text` → `node.data.get('html')`) or added block-level HTML rules | wrong-fix, wrong direction | no | none |
| `hotmeteor__spectator-181` | call `$this->assertStatus($status)` first | hand-rolled `"Expected status code {$status} but received {$actual}."` | wrong-fix | no | none |
| `protofire__solhint-224` | author a new `ordering` rule plus `isStructDefinition` / `isEnumDefinition` | authored a rule with a different order and message; 9 of 12 cells reach `f2pFrac 0.4` | other: authoring obligation | no | none |

Three of these deserve a note.

**`fastify-cors-285` is not unreachable — the issue text names the fix.** The problem statement
says *"the options route added by fastify-cors is scoped to `/*` (previously, this was just `*`,
but that broke some other setups)"*. The hidden test then matches the literal:

```js
fastify.addHook('onRoute', (route) => {
  if (route.method === 'OPTIONS' && route.url === '*') {   // was '/*'
    t.equal(route.schema.hide, true)
  }
})
```
with `t.plan(2)`, so an added route can never satisfy it — tap reports `not ok 2 - test unfinished`.
**Twelve of twelve rollouts preferred an additive fix over the revert their own prompt named.**

**`spectator-181` is unreachable for any retrieval lever confined to the checkout.** The hidden
test asserts the exact Laravel string:

```
Failed asserting that exception message 'No response object matching returned status code [500].
Failed asserting that true is false.' contains 'Expected response status code [200] but received 500.'.
```
Only `Illuminate\Testing\TestResponse::assertStatus()` emits it. **[M]** The golden has **no
`vendor/` tree** and the string appears nowhere in it. Native rep0 *did* read the README line
*"Instead of using the built-in `->assertStatus($status)` method…"*; no sweet rollout saw it
(0/9); native still hand-rolled its own message. **This is a negative result for SLATE-B's P1
dependency-source corpus on this pool** — the corpus would have to cover an uninstalled
dependency, and the network is banned.

**`solhint-224` gives partial credit that could mislead.** `f2pFrac` is 0.4 in 9 of 12 cells —
2 of 5 hidden tests — with no arm above 0.4. Nothing separates the arms.

---

## 3. Tool health across all 198 sweet rollouts

`scripts/e4-opencode-toolhealth.py`, `e4-opencode-defects.py`, `e4-opencode-grepcrash.py`,
`e4-opencode-grepdialect.py`, `e4-opencode-banner.py`, `e4-opencode-fallback.py`.

### 3.1 Volume, exits and latency

**2,082 `ss-*` shell calls** across 198 sweet rollouts. Latency is the opencode bash call's own
`state.time` delta.

| tool | calls | rollouts using it | non-zero exit | p50 ms | p90 ms | max ms |
|---|---:|---:|---:|---:|---:|---:|
| `ss-read` | 1,059 | 189 | 35 | 7 | 14 | 89 |
| `ss-grep` | 562 | 186 | 27 | 7 | 15 | 46 |
| `ss-search` | 316 | 164 | 1 | 16 | 30 | 308 |
| `ss-find` | 107 | 67 | 2 | 9 | 20 | 42 |
| `ss-semantic` | 38 | 30 | 0 | 10 | 34 | 46 |
| `ss-trace` | 30 | 29 | 7 | 7 | 9 | 106 |
| `ss-batch` | **0** | 0 | — | — | — | — |
| `ss-edit` | **not deployed** | — | — | — | — | — |

Per rollout, sweet against native:

| arm | calls | `run_tests` | `apply_patch` | ss-* mix | harness read / glob / grep |
|---|---:|---:|---:|---|---|
| native | 25.2 | 2.71 | 1.77 | — | 9.03 / 2.11 / 3.64 |
| TAB | 21.8 | 2.92 | 1.86 | read 5.73, grep 2.97, search 1.55, find 0.53, trace 0.12, semantic 0.09 | 0.27 / 0.33 / 0.02 |
| NONE | 21.9 | 2.76 | 1.61 | read 5.59, grep 2.97, search 1.68, find 0.47, semantic 0.32, trace 0.21 | 0.39 / 0.42 / 0.02 |
| PIPE | 20.5 | 2.92 | 1.82 | read 4.73, grep 2.58, search 1.56, find 0.62, semantic 0.17, trace 0.12 | 0.33 / 0.23 / 0.00 |

### 3.2 Product-defect list

| id | defect | calls | rollouts | one quoted example |
|---|---|---:|---:|---|
| **D1** | On any `ss-grep` failure the wrapper replays the engine's cold-start banner and a Node stack trace into the agent's context — about **830 bytes** each | 15 | 12 | `ss-grep "INLINES.HTML\|type: INLINES.HTML\|matchType(INLINES" -k 20` → `BinaryHNSW: Loaded 1247 vectors from …codebase-binary-hnsw.idx (asymmetric=false)` … `[ss-*] crash: Error: ripgrep failed (code 2): rg: regex parse error:` … `error: unclosed group` |
| **D2** | `ss-grep` rejects a positional path the way `grep` accepts it | 11 | 11 | `ss-grep "build" src/build/targets.jam -k 40` → `[ss] 1 argument(s) not consumed: "src/build/targets.jam"` |
| **D3** | `ss-find` has no `--in`, although `ss-grep` does | 2 | 2 | `ss-find "generate" --regex "generate" --in src/build/targets.py -k 40` → `[ss] unrecognised option "--in"` |
| **D4** | `ss-read` fails with a bare `ENOENT` on a path the model believed existed | 30 | 18 | `ss-read src/markdown/blocks/html.js 1 100` → `[ss-read] error: stat failed: ENOENT` |
| **D5** | An `ss-*` call returns an empty body with no error text and no exit code | 15 | 9 | `ss-read aiohttp/client.py 400 650` → `''` (`status=error`); the model then re-fetched the same file with the harness `glob` and `read` |
| **D6** | GNU-BRE alternation is detected and reported, then **not** retried | 6 | 6 | `# ss-grep: 0 total match(es) for /Mcdev.refresh\|refresh\(/ (scope: --in test)` … `regex note: Rust syntax treats \| as a literal pipe; use \| for alternation (or -F for a literal search). The original pattern was used unchanged.` |
| **D7** | `ss-trace` reports no indexed symbol for symbols that exist in the tree | 6 | 6 | `ss-trace submit callees --in src/FinalForm.js` → `No indexed symbol found for "submit".` |
| **D8** | The tool guide's bracketed placeholder is pasteable and breaks the shell | 1 | 1 | `ss-trace submit [callers\|callees\|impact] --in src/FinalForm.js` → `/bin/bash: line 1: callees: command not found` (exit 127) |
| **D9** | The file kind carrying the answer is absent from the index | — | 12 | `bfgroup/b2`: 321 `.jam` files in the tree, **0** `.jam` chunks in `codebase.db`; `'.jam'` is not in `FILE_PATTERNS.include` |
| **D10** | `ss-grep` returns zero hits on one call in five | 113 of 543 result headers (20.8%) | 52 | `ss-grep "evaluate-conditional-relevance" -k 10` → `# ss-grep: 0 total match(es) … (no matches)` |

**D1 root cause, read from source [C].** `eval/agent-read-workflows/bin/ss-grep` buffers stderr
to a temp file and runs `[ $RC -ne 0 ] && cat "$TMPERR" >&2`. `_ss-helpers.mjs:51` redirects
`console.log` to stderr precisely so the model-load banner never reaches the agent. On the
failure path the wrapper prints the whole buffer, so the banner comes back — the exact leak the
redirect was written to prevent. The `(?:…)` in the error text is ripgrep's own rendering,
reproduced locally: `rg "GetApi(ctx"` → `regex parse error: (?:GetApi(ctx)  ^ error: unclosed group`.

**Index blind-spot scan over the whole pool** (`e4-opencode-extgap.py`; file kinds with ≥10 files
in the tree and 0 chunks in the index):

| task | blind spot | decision-relevant? |
|---|---|---|
| `bfgroup__b2-113` | `.jam` (321 files), `.adoc` (33) | **yes - the gold file** |
| `bfgroup__b2-259` | `.jam` (297), `.adoc` (33) | **yes - the gold file** |
| `accenture__sfmc-devtools-1974` | `.amp` (29) | no |
| `asynkron__protoactor-dotnet-1909` | `.razor` (22) | no (3/3 everywhere) |
| `gitbookio__markup-it-56` | `.adoc` (39) | no |
| `locationtech__jts-622` | `.wkt` (10) | no |
| `mathnet__mathnet-numerics-1072` | `.spark` (16), `.nuspec` (15), `.mat` (10) | no |

**Only `.jam` decides anything, and it decides both b2 tasks.**

### 3.3 Edit mechanics

**[M]** 466 `apply_patch` calls; **869 hunks, every one with a bare `@@`** — the model never
wrote a locator on this harness. 14 edits failed (3.0%).

| classification of a failed edit | native | TAB | NONE | PIPE |
|---|---:|---:|---:|---:|
| anchor text present in the base → order or ambiguity | 3 | 0 | 5 | 3 |
| anchor text absent → paraphrase or the agent's own earlier insert | 0 | 0 | 2 | 1 |
| **whitespace carry (+1 or −1 space)** | **0** | **0** | **0** | **0** |
| **gutter residue in the patch body** | **0** | **0** | **0** | **0** |

Rollouts with at least one failed edit: native 3, **TAB 0**, NONE 6, PIPE 4.

**Anchor ambiguity, all 264 rollouts.** For every first edit of a file, how many places in the
base file the hunk's context sequence matches (exact, and codex/opencode pass-3 trim semantics):
**41 of 295 measurable edits carry at least one ambiguous anchor** — native 12, TAB 12, NONE 11,
PIPE 6. **Arm-symmetric.** Ambiguity is a hazard, not a failure: `mathnet` and `apigee` solve with
`occ=[2,2,2,2]`. It decided only `accenture-1974`, where the two matches sit in different methods.

### 3.4 Native-tool fallback

Within two tool calls of an `ss-*` call, the sweet arm made **85** harness-native calls across
**38 of 198 rollouts**. **Only 2 of those named a path the `ss-*` call had just named**, and 4
followed a failed or empty `ss-*` call. Across all 198 sweet rollouts the harness tools were used
**66 `read` + 65 `glob` + 2 `grep` = 133 calls**, against native's **975**.

**Sweet rollouts stay inside `ss-*`; they are not silently re-checking its answers.** What the
`glob` calls buy is filename discovery — `{"pattern": "test/build_no.py"}` — which `ss-find`, a
query-plus-regex tool, does not cover.

---

## 4. Levers this harness's traces support

Each is checked against SLATE-A §9 and SLATE-B §8.

### L1 — Report where an edit landed; flag an anchor that matches more than once
**Task:** `accenture__sfmc-devtools-1974`.
**Mechanism:** `apply_patch` takes the first context match from a moving index and answers
`Success. Updated the following files: M lib/index.js` without naming a line. Five sweet rollouts
and one native rollout inserted the guard into `fixKeys` after stating they were editing
`#runMethod`.
**$0 falsifier — already run:** `e4-opencode-ambiguity.py` counts context-sequence matches in the
base file for every first edit: 41 of 295 are ambiguous. **Kill** if a second harness shows no
ambiguous anchor inside a lost rollout.
**Existence proof:** PIPE rep2 read `@@ -1593` in its own `git diff`, moved the hunk, solved.
**Discard check:** *not killed.* SLATE-A §9 item 7 kills an *insertion-position oracle* — which
position is semantically right. This asks a different question: **where did the edit actually
land**. SLATE-A keeps edit addressing as C-9; SLATE-B keeps anchored `ss-edit` as a P7 component
judged *below the standalone cost bar*. This is a **resolution** claim, so the evidence is new.
**Honest caveat:** the surface is the harness's `apply_patch`, which sweet does not own, and the
phase-1 no-new-tools rule bars a new `ss-edit`. The version sweet **can** own is a trailer on
`ss-read`: when a window is shown, report how many times its text occurs in the file. Falsify
that at $0 by counting how many of the 41 ambiguous edits were preceded by an `ss-read` covering
the region.

### L2 — Index the `.jam` file kind, and re-audit `FILE_PATTERNS` against the pool
**Tasks:** `bfgroup__b2-113`, `bfgroup__b2-259`.
**Mechanism:** §2.4. 321 `.jam` files in the tree, 0 `.jam` chunks in the index; sweet 0/9 against native 1/3 on b2-113.
**$0 falsifier:** add `**/*.jam` plus `Jamfile`/`Jamroot` to `FILE_PATTERNS.include`, re-index one
b2 golden offline, replay the nine recorded `ss-search` queries. **Kill** if
`src/tools/stage.jam` does not enter the top ten.
**Discard check:** *not in either log.* It contradicts the completeness of the extension-coverage
audit that concluded "only zeek `.bif` blind spot". Evidence is new.
**Ranking safety:** discovery only, no ranking signal, so the `_isAgentFormat` gate in CLAUDE.md
does not apply.

### L3 — Make `ss-grep` survive a pattern ripgrep rejects, and never print the engine banner
**Tasks:** `apigee__registry-961`, `gitbookio__markup-it-56`, `callstack__react-native-paper-972`,
`devlooped__moq-1262`.
**Mechanism:** D1 + D6. 15 crashes replaying ~830 bytes of model-load log; 6 zero-hits where the
tool prints the right diagnosis then says *"The original pattern was used unchanged"*. Three of
the eight `ss-grep` calls in the one lost `apigee` rollout failed this way.
**$0 falsifier:** replay the 34 failed or zero-hit patterns against their goldens with (a) the
escaped-alternation translation the hint already computes and (b) a `-F` fallback; count how many
then return the file the gold patch touches. **Kill** below one third.
**Discard check:** *not in either log.* The BRE bug is already on record from the 2026-07-14
forensics review; the hint shipped and the retry did not, so this is a recurrence, not a new idea.

### L4 — Accept the grep-shaped invocations the model actually types
**Tasks:** b2-113, b2-259, moq-1262, solhint-224, apigee-961.
**Mechanism:** D2 + D3. 13 calls in 12 rollouts rejected for CLI shape alone.
**$0 falsifier:** none needed — a parser change with a unit test. **Kill** only if accepting
positional paths makes a pattern containing a space ambiguous, which is why the current message
exists.
**Discard check:** *not in either log.* Low ceiling, near-zero risk.

### L5 — Never return an empty body without an error
**Tasks:** aiohttp-8038, nmt-192, moq-1262.
**Mechanism:** D5. 15 calls returned `''` with `status=error`; in `aiohttp` PIPE rep2 the model
re-fetched the same file through the harness.
**$0 falsifier:** replay `ss-read aiohttp/client.py 400 650` and
`ss-read src/Moq/Extensions.cs 300 430` against their goldens under the recorded environment.
**Kill** if they cannot be reproduced — that would make it an opencode transport abort, not a
sweet defect.
**Discard check:** *not in either log.*

### L6 — Close the `ss-trace` symbol gap
**Tasks:** final-form-64, apigee-961, markup-it-56, spectator-181, b2-259.
**Mechanism:** D7. Six calls answered `No indexed symbol found` for `submit`, `deserialize`,
`ListDeploymentArtifacts`, `expectsFalse`, `get-relevant-features`. `ss-trace` runs 30 times in
198 rollouts, so the ceiling is small.
**$0 falsifier:** query each symbol against the matching golden's `code-graph.db`. **Kill** if the
symbol genuinely is not a definition in that file.
**Discard check:** *not in either log.*

### Dropped, with the killing fact

| idea | why it is dropped |
|---|---|
| Change the gutter delimiter on opencode | **Dead with new evidence:** 0 gutter residue in 466 patch bodies, 14 failed edits and none a whitespace carry, TAB 0 rollouts-with-failure against NONE 6 and PIPE 4. Extends GUTTER-MECHANISM §4.3 from 6 tasks to 22. |
| More sibling or mirror retrieval | Already dead (SLATE-A §9.3, SLATE-B §8 row 1). **Confirmed here:** the losing `aws-embedded-metrics` PIPE rep1 read `MetricsContext.ts` at call 5 and patched the serializer at call 9. |
| A prompt clause on hunk order or anchoring | The clause graveyard kills general clauses; GUTTER-MECHANISM R7 already argued against it. |
| A dependency-source corpus for `spectator-181` | **Negative result for SLATE-B P1 on this pool:** the golden has no `vendor/` tree and the expected string appears nowhere in the checkout, so an index-time corpus over the checkout cannot supply it. |
| A first-edit or scope guard | SLATE-A §9.5. Nothing here contradicts it: `fastify-cors` fails by adding, `aiohttp` fails by adding too little; the direction is not consistent. |

---

## 5. Reproduction

Scripts live at `.../harness-gutter-cost-20260828/scripts/e4-opencode-*.py`; box copies ran from
`/tmp/fp-inv/e4-opencode/` and import `lib.py` from that path. Machine-readable results:
`04-resolution-opencode.json`; raw artifacts under `logs/e4-*.json`.

```
solve-matrix.py    solve matrix, completeness assertions
lib.py             rollout index + opencode NDJSON normaliser (repair rows substituted)
census.py          tool-name census
toolhealth.py      per-tool calls, exits, empties, latency
defects.py         failure-bucket classification
grepcrash.py       ss-grep engine crashes and usage rejections
grepdialect.py     BRE alternation zero-hits, dialect-hint firing
banner.py          engine cold-start banner leak
ambiguity.py       apply_patch anchor-ambiguity census against the goldens
gutterresidue.py   gutter residue and whitespace-carry census
b2dialect.py       .jam vs .py in retrieval results
extgap.py          index blind-spot scan over the pool
fallback.py        native-tool fallback after an ss-* call
cellmap.py         per-cell patch/file/tool summary
bundle.py digest.py storyline.py editanchors.py f2ptail.py exposure.py ungraded.py
```

# Index-time precomputation and capability gaps — ideation report (Slate C)

Lens: `index-time-and-capabilities`. Date 2026-09-02. Author: workflow agent
`index-time-and-capabilities`. All work at `$0`: trace census over the classified fresh-pool
corpus, static reads of product and bench code, sqlite reads of the golden indexes on the
evidence box. No model rollouts. Tags: `[M]` measured (script named), `[C]` read from code,
`[W]` web, `[I]` inferred.

## 0. Verdict

No index-time precomputation in this lens clears a 2% cost ceiling on any harness, and none
has a solve story on this pool. The four ideas the task named measure as follows.

1. **Symbol outlines** (`ss-read --outline`, or a symbol-addressed read). Same-file follow-up
   reads that jump to a non-adjacent span are 11.4–13.3% of sweet's ranged `ss-read` calls,
   0.74–1.05 per rollout `[M census.py B]`. But the first read already carried the shipped
   `# unread below` trailer in 90% of those cases, and the jump landed inside the span the
   trailer named in 49–72% of them `[M]`. Files with no index symbols are jumped 0–1.9% of
   the time against 13–17% for symbol-rich files `[M census4.py 1]`, so jumps track file
   complexity, not missing symbol data. Honest ceiling under 1% before payload cost; the
   payload (median 200 characters, p90 2,060 per file) cancels it. **Park.**
2. **Test-to-symbol maps for index-selected regression tests.** The shared frame already
   tells both arms to use `run_tests <pattern>` `[C]`; both arms use it in 8–17% of
   `run_tests` calls `[M]`; the shim ignored 47 of 121 targeted calls (39%) because the
   task's test command is compound or its runner is unsupported `[M]`; a full-suite result is
   already condensed to a median 828–936 output tokens, and a targeted run saves at most
   ~400 tokens `[M]`. Zero head-to-head differential (shared shim and frame), at most 1.3% of
   a rollout in tokens, and a published −2 pp resolution effect. **Recommend register E13
   moves OPEN → DEAD for this bench.**
3. **Dependency-source tiers.** Zero dependency-inspection operations in 396 rollouts
   (5 incidental dependency-path touches) `[M census2.py 5]`. **No demand on this pool;
   E5 stays PARKED.**
4. **Directory maps / filename discovery (`ss-grep --files`, `ss-files`).** Native spends
   2.06–2.15 enumeration operations per rollout and opens 63/66 codex, 64/66 opencode and
   30/66 claude-code rollouts with one `[M census.py C]`; sweet spends 0.30–0.45 and never
   opens with one on two harnesses. Native's main-thread enumeration costs 2,336 / 1,843 / 673
   output tokens and 0.64 / 0.23 / 0.56 enumeration-only requests per rollout against sweet's
   156 / 51 / 10 tokens and 0.15 / 0.32 / 0.00 requests `[M]`. That abstention is worth up to
   7.1% / 4.8% / 2.9% of a sweet rollout and is already banked `[I]`. The index path table
   covers only 71–98% of tracked files per golden `[M census2.py 4]`, so an index-backed
   files mode would also answer "absent" for files that exist. **Do not build.**

The one index-time defect found: **Jam has no symbol extraction** — 0 of 618 indexed `.jam`
files carry any entity `[M census3.py A]`, by design (`maps.js:188`, "generic chunking;
grep-indexable" `[C]`). Every symbol-bearing surface (same-file span map, unread-below names,
`ss-trace`, any outline) is empty on the two `bfgroup__b2` tasks. Pool ceiling is zero because
those tasks are dead in both arms and the deciding lines were on screen (wrongfix-facts WF-2).
Product correctness only.

Two small hygiene items are shippable without a new tool: an `# unread above` line on
`ss-read` (54 upward jumps in 198 sweet rollouts, no above-window rendering exists `[C]`), and
extensionless dot-config admission (94 dotfiles across the 22 goldens are outside the index;
already seeded by phase-anatomy PA-5, merge there). Working-tree freshness (register E3) stays
closed: 7 of 1,251 sweet lexical calls (0.56%) grepped for the agent's own new code and got a
stale zero `[M census2.py 3]`.

## 1. Data and method

- Corpus `[M]`: `/tmp/wf-slatec/native-capability-gaps/calls-classified.jsonl.gz` on the
  evidence box (one record per tool call, 10,942 calls; built by the sibling agent from
  `fp-codex-tab-20260826`, `fp-opencode-tab-20260826` + `rp-oc-tab-20260827` sweet repair
  rows, `fp-claudecode-tab-20260826`). I used the 10,188 calls flagged `canon` = 396
  rollouts, 66 per harness × arm. Claude-code subagent calls (`side`) are excluded from read
  sequences and request counts; they are counted where stated.
- Goldens `[M]`: `/root/.ss-eval/golden/<owner>__<repo>@<base_commit>/.sweet-search/` —
  `codebase.db` (`vectors`: one row per chunk, `file_path`, live rows have
  `epoch_retired IS NULL`) and `code-graph.db` (`entities`: `file_path, type, name, signature,
  start_line, end_line, parent_class`). Task → golden mapping from
  `results/fp-codex-tab-20260826/sweet/tasks.json` (`repo`, `base_commit`); all 22 resolve.
- Per-rep patches `[M]`: `results/<run>/<arm>/patches.json` (rep 0) and
  `results/<run>/<arm>/rep-N/patches.json`; opencode sweet repair tasks from
  `rp-oc-tab-20260827`.
- Scripts and outputs: `eval/task-completion-bench/handoffs/improve/slate-c/candidates/scripts-index-time-and-capabilities/`
  (`census.py`, `census2.py`, `census3.py`, `census4.py`; `data/census*.json`,
  `data/census.txt`). Box copies under `/tmp/wf-slatec/index-time-caps/` (also
  `glob-ops.jsonl`, the 442 enumeration calls).
- Prices `[I]`, from the brief and the sibling report: sweet cost per request codex
  $0.000629, opencode $0.000470, claude-code $0.000702; per ingested token including
  re-sends $0.259 / $0.250 / $0.301 per million; sweet cells $0.012330 / $0.009265 /
  $0.020727 per rollout.

## 2. Findings

### F1. `run_tests` scoping is already shared, already used, and often ignored by the shim

`[C]` `harness/codex-task-runner.mjs:123` (frame text imported byte-identically by every
harness runner): "Use `run_tests <pattern>` for targeted diagnosis when supported."
`harness/rt-dedup.mjs:65` `parseRunTestsArgv` takes the first argument as a pattern;
`harness/rt-condense-lib.mjs:457-470` `applyTestPattern` maps it to `pytest -k`, `go test
-run`, `phpunit --filter`, `dotnet test --filter`, and refuses compound or piped test
commands. The "takes no arguments" comment at `agent-runner-shared.mjs:14` refers to docker
arguments only.

`[M census.py A, census2.py 2]` per cell (66 rollouts each):

| cell | run_tests calls | with pattern | ignored by shim | full-suite median tokOut | targeted median tokOut |
|---|---:|---:|---:|---:|---:|
| codex native | 199 | 19 | 7 | 830 | 1,114 |
| codex sweet | 197 | 33 | 7 | 828 | 391 |
| opencode native | 179 | 16 | 10 | 934 | 1,065 |
| opencode sweet | 193 | 19 | 10 | 930 | 1,212 |
| claude native | 207 | 21 | 2 | 930 | 1,092 |
| claude sweet | 200 | 13 | 4 | 930 | 751 |

Ignored reasons over all 396 rollouts: "compound/piped command not safely filterable" 38,
"runner not supported for targeting" 9 `[M census4.py 3]`. `run_tests` output is 11–19% of all
tool output tokens per cell. The patterns agents typed are exact test class or test function
names they had already located (`AssertionsTest`, `Hypotenuse`, `ResponseValidatorTest`).

### F2. Same-file follow-up reads: jumps are second spans, not probe misses

`[M census.py B]` main thread, reads by the arm's own reader (`ss-read` for sweet; `sed -n`,
opencode `read`, claude `Read` for native). A follow-up is a read of the same file within the
next three reads; "jump" = non-overlapping and not contiguous (gap > 5 lines).

| cell | ranged reads | reads/rollout | jump | jump % | jump/rollout | first read had `# unread below` | jump target inside trailer span |
|---|---:|---:|---:|---:|---:|---:|---:|
| codex native | 786 | 15.41 | 139 | 17.7 | 2.11 | n/a | n/a |
| codex sweet | 519 | 8.21 | 69 | 13.3 | 1.05 | 64 | 34 |
| opencode native | 596 | 9.03 | 55 | 9.2 | 0.83 | n/a | n/a |
| opencode sweet | 438 | 6.64 | 50 | 11.4 | 0.76 | 44 | 36 |
| claude native | 690 | 10.45 | 59 | 8.6 | 0.89 | n/a | n/a |
| claude sweet | 411 | 6.23 | 49 | 11.9 | 0.74 | 47 | 30 |

Jump direction `[M census2.py 1]`: codex up 23 / down-inside-trailer 33 / down-outside 13;
opencode 14 / 35 / 1; claude 17 / 29 / 3. Upward jumps (54 of 168, 32%) are the only class
the shipped trailer cannot address; `core/search/search-read.js` renders nothing for the
region above a window `[C]`. First-window size median 86–99 lines.

Jump rate by symbol presence, sweet source files `[M census4.py 1]`: files with at least one
code entity in the golden's `code-graph.db` are jumped 17.1% (codex, 68/398), 13.4%
(opencode, 44/328), 13.8% (claude, 46/333); indexed files with no code entity 1.4% (1/72),
0% (0/65), 1.9% (1/53). The agent re-reads complex files, and complex files are exactly the
ones whose symbols the index already exposes.

Outline payload `[M census2.py 1]`: for source files sweet read, entities per file median 4,
p90 30–31; signature text median 199–228 characters, p90 2,060–2,278 characters (about
50–570 tokens). 43–58 of 136–154 files had zero code entities (see F6).

`[M census4.py 4]` 0 of 1,409 sweet `ss-read` outputs carried the `symbols:` header that
`search-read.js` `renderRead` can emit; the bench wrapper (`_ss-helpers.mjs` `cmdRead`)
renders its own header plus `renderUnreadBelow` only `[C]`.

### F3. Filename discovery: native pays for it, sweet does not

`[M census.py C]` glob (`rg --files`, `glob`, `find -name`) and list (`find -type f`,
`glob **/*`) operations, all threads:

| cell | glob+list ops | per rollout | rollouts with any | first substantive call is an enumeration |
|---|---:|---:|---:|---:|
| codex native | 136 | 2.06 | 63/66 | 63/66 |
| codex sweet | 20 | 0.30 | 13/66 | 8/66 |
| opencode native | 140 | 2.12 | 66/66 | 64/66 |
| opencode sweet | 24 | 0.36 | 13/66 | 0/66 |
| claude native | 142 | 2.15 | 56/66 | 30/66 |
| claude sweet | 30 | 0.45 | 11/66 | 0/66 |

Request-level, main thread `[M census4 recount]`: requests whose substantive operations are
all enumeration: codex native 42 (0.64/rollout) vs sweet 10 (0.15); opencode native 15
(0.23) vs sweet 21 (0.32; opencode's `glob` is parallel-emitted with reads so it rarely
occupies a request alone); claude native 37 (0.56) vs sweet 0. Output tokens in enumeration
calls per rollout: native 2,336 / 1,843 / 673, sweet 156 / 51 / 10.

Upper-bound value of sweet's abstention `[I]` (native's enumeration tokens priced at the
ingest-plus-re-send rate, enumeration-only requests at the request price):
codex 0.49 × $0.000629 + 2,180 × $0.259/M = $0.00087 (7.1% of the sweet cell);
opencode 1,792 × $0.250/M = $0.00045 (4.8%); claude 0.56 × $0.000702 + 663 × $0.301/M =
$0.00059 (2.9%). This is native's spend, not a saving still available to sweet; it is the
reason not to hand the habit back through a files mode.

Index path-table recall `[M census2.py 4]`: tracked files covered by `vectors.file_path`
per golden: 98.0% (absinthe) down to 70.9% (callstack) and 72.7% (fastify-cors); 0 indexed
files are untracked. Missing classes over the 22 goldens: `.png` 184, `.map` 101,
dotfiles 94 (`.gitignore` 36, `.editorconfig` 9, `.gitattributes` 9, `.prettierrc` 7,
`.eslintrc` 6, `.npmrc` 3, `.eslintignore` 3, `.babelrc` 2, `.flowconfig` 2 …), `.md` 89
(83 tiny fixture and notes files, e.g. markup-it `test/from-markdown/**/input.md` at
14 bytes), `.dat` 58, `.go` 51 (all under `cmd/registry/cmd/rpc/generated/`), `.py` 46
(40 zero-byte `__init__.py`), `.adoc` 39, `.json` 36 `[M census3.py B]`.

### F4. Test-locating work is arm-universal and already served by unscoped `ss-grep`

`[M census.py D]` test-file reads before the first edit per rollout: native 1.17 / 1.88 /
1.92 (claude / codex / opencode), sweet 0.70 / 1.30 / 1.23; rollouts reading a test before
editing: native 39 / 50 / 58 of 66, sweet 34 / 41 / 47 of 66. Sweet issued 7–13 test-scoped
greps per cell, but 164–232 of its unscoped `ss-grep`/`ss-find` calls per cell returned test
paths among their hits, so the test file is normally located by the same call that locates
the symbol. On `awslabs__aws-embedded-metrics-node-21` (wrongfix-facts WF-6, the one task
where the covering test decides the layer), 15 of 18 cells read the covering test before
editing, including all three losers `[M census3.py D]`; the test was on screen and did not
decide the fix. A "tests referencing this symbol" trailer therefore has no request to remove
and no flip to claim on this pool.

Grep-then-read pairs `[M census3.py C]`: a grep with hits followed within two calls by a read
of a hit file: sweet 1.45 / 1.50 / 1.50 per rollout (codex / opencode / claude), native
codex 1.98, claude 1.35 (opencode native's `grep` tool output format was not parsed).
Definition-shaped grep → read: sweet 19 / 9 / 14 per cell = 0.14–0.29 per rollout. That is
the whole demand for a symbol-addressed read that folds "find the definition line" into the
read; `ss-find` and `ss-semantic` already return symbol-complete blocks in one call.

### F5. Post-edit lexical probes for the agent's own code (register E3)

`[M census.py E, census2.py 3]` sweet, main thread, after the first edit, `ss-grep`/`ss-find`
calls whose pattern literal occurs in the rollout's own added patch lines: codex 12 (3 zero
results), opencode 6 (2 zero), claude-code 35 (17 zero). The 22 zero results decompose as:

- 11 **excluded scope** (`--in dist/index.js` × 8 on `aws-actions`, `.jam` scopes × 3 on
  `bfgroup__b2-259`) — register E1/E2 classes, fixes shipped after these runs;
- 4 **pattern present in base tree** but the scope path does not exist or is unindexed
  (`--in src/Numerics/Complex.cs` × 2 on mathnet, `--in src/b2`, unscoped
  `AWS_ACCESS_KEY_ID` whose base occurrences live only in the excluded bundle and README) —
  the absent-scope class the claude-main-thread report seeds (its F9);
- 7 **genuinely new code not in the base tree**: `fastify.prefix` (opencode fastify rep1),
  `color: _` / `_color|_.*,` × 3 (claude callstack rep0/rep2; rep2 is also the alternation
  prefilter defect, claude-main-thread F7), `Serialize an HTML block to markdown` (claude
  markup-it rep1), `ordering` / `OrderingChecker` (claude solhint rep1/rep2).

Genuine stale-index exposure: 7 of 1,251 sweet lexical `ss-*` calls (0.56%); requests until the next edit or
test run after them: 1, 0, 6, 3, 2, 1, 0 = 13 requests over 198 rollouts (0.07 per rollout,
about 0.3% of a rollout) `[M]`. E3's revival condition (5% of calls) is not met.

### F6. Symbol extraction coverage by language (index-time)

`[M census3.py A, census4.py 2]` indexed source files with at least one code-type entity
(function, method, class, interface, struct, enum, trait, module, macro, arrowFunction,
component, namespace, typeAlias, decorator, private), over the 22 goldens:

| ext | indexed files | with a symbol | % | note |
|---|---:|---:|---:|---|
| `.jam` | 618 | 0 | 0.0 | `maps.js:188` maps `.jam` to generic chunking; no grammar `[C]` |
| `.py` | 975 | 641 | 65.7 | 308 of the 334 symbol-less files are tests/fixtures; the rest are constants and config modules |
| `.js` | 649 | 384 | 59.2 | data-only `*.definition.js` modules and test files |
| `.ts` | 182 | 171 | 94.0 | 8 of 11 symbol-less files are `__tests__/*.test.ts` |
| `.cs` | 1,817 | 1,764 | 97.1 | |
| `.java` | 1,158 | 1,158 | 100.0 | |
| `.go` | 338 | 334 | 98.8 | |
| `.ex` / `.exs` | 273 / 219 | 273 / 214 | 100 / 97.7 | |
| `.cpp` / `.h` | 364 / 125 | 344 / 114 | 94.5 / 91.2 | |

Only Jam is a whole-language gap. Test files in JS/TS/Python often carry no entity because
their bodies are anonymous callbacks; that limits symbol-level chunking of tests, not of
source.

### F7. Dependency inspection

`[M census2.py 5]` `deps`-class operations (package queries, dependency-path reads): 0 in
every native and sweet cell; 5 incidental dependency-path touches (codex 2 + 2, claude
native 1) in 396 rollouts. The sibling report found the same (native-capability-gaps F9).
This pool does not exercise register E5's motivation at all.

### F8. Claude-code post-edit probe chain (phase-anatomy PA-3) — index view

Of claude sweet's 86 post-edit lexical probes, 35 were for its own added code and 17 of
those returned zero; every zero belongs to an already-seeded hygiene class (F5 above). The
index-time contribution to PA-3 is therefore nil beyond E1/E2, the absent-scope error, and
the alternation prefilter defect.

## 3. Candidates

Ceilings are stated in requests per rollout and dollars per rollout against the fresh-pool
sweet cells, and in test-relevant files where a resolution story was claimed. Solve is the
veto; each row states the solve risk.

### C1. `ss-read` unread-above line (symbols above the read window)

- **Family:** read rendering / index-backed trailer. **Harnesses:** all three.
- **Mechanism:** `renderUnreadBelow` (`core/search/search-read.js:572-588`) names up to five
  symbols in the unread remainder below a windowed read, with a continue command. Nothing is
  rendered for the region above the window `[C]`. Add a sibling line
  `# unread above (1-<start-1>): symA, symB … — continue: ss-read <file> <a> <b>` from the same
  per-file chunk metadata (`getChunksForFile`, `entities.start_line`), skipped when the window
  starts at line 1. Wrapper renders it in `_ss-helpers.mjs` `cmdRead`.
- **Why native cannot match:** it can (native reads whatever window it likes); the line only
  changes which second span sweet reads. Sweet-only vehicle, so any effect is differential.
- **Evidence:** 54 upward jumps in 198 sweet rollouts (codex 23, opencode 14, claude 17)
  `[M census2.py 1]`; e.g. `fp-codex-tab-20260826` sweet reads where a first window of
  86–99 lines is followed by a read that ends before the first window starts.
- **Ceiling:** at most 0.35 / 0.21 / 0.26 requests per rollout if every upward jump were a
  probe miss the line would have prevented — $0.00022 / $0.00010 / $0.00018 = 1.8% / 1.1% /
  0.9% upper bound; a realistic miss fraction of one half gives 0.9% / 0.5% / 0.4%. Payload
  about 20–40 tokens on each ranged read whose window starts after line 1, about $0.00005
  per rollout (0.4%). Net about zero; hygiene, not a lever. Solve: neutral (it adds addresses
  the agent can already reach with one more read).
- **Vehicle / sweet-only:** product code + wrapper; yes.
- **`$0` falsifier:** replay the 54 upward-jump events against the goldens' `code-graph.db`:
  does the second read start within 5 lines of an entity `start_line` above the first window
  (i.e. would the above-line have named the exact target)? Report the count.
- **Kill condition:** fewer than 27 of 54 targets (half) nameable, or the line's median size
  exceeds 40 tokens on the read files.
- **Build cost:** small (one function mirroring `renderUnreadBelow`, one wrapper line, tests).
- **Register check:** nearest C9 (extend the trailer to interior gaps; PARKED), B8 (pointer
  rows 79% never followed) and the codex-cap report's 23.6% follow rate on this very trailer;
  B7 bans compaction, and this adds addresses without removing lines. Not a register row.
- **new_tool:** false. **needs_user_decision:** none.

### C2. `ss-read --outline` / symbol-addressed read — PARK (measured, weak)

- **Family:** index-backed read mode. **Harnesses:** all three.
- **Mechanism:** a flag returning a file's symbol signatures with line ranges from
  `code-graph.db` `entities` (`file_path, type, name, signature, start_line, end_line`)
  `[C code-graph-repository.js:136-414]`, and/or `ss-read <file> --symbol <Name>` resolving a
  symbol to its exact span. Competitor-mechanisms CM-11 seeded the flag with a 10% kill bar.
- **Evidence:** jumps are 11.4–13.3% of ranged reads, so the CM-11 bar passes narrowly; but
  the first read already carried the shipped trailer in 90% of jump cases and the target lay
  inside the trailer's named span in 49–72% `[M census.py B]`; symbol-less files are jumped
  0–1.9% of the time against 13–17% for symbol-rich files `[M census4.py 1]`; only 17 of 168
  jumps (10%) went downward outside the trailer span `[M census2.py 1]`; definition-shaped
  grep → read pairs, the demand for a symbol-addressed read, are 0.14–0.29 per rollout
  `[M census3.py C]`; `ss-find` and `ss-semantic` already return symbol-complete blocks in
  one call `[C bin/ss-find header]`.
- **Ceiling:** the outline can only shorten jumps that were probe misses and are not already
  addressed by the trailer: at most the 17 downward-outside plus the 54 upward events =
  71 of 198 rollouts = 0.36 requests per rollout, $0.00017–0.00025 (1.2–2.0%) before payload;
  realistic under 1%. Payload if appended to every read: median 50 tokens, p90 500 tokens per
  read × 6–8 reads per rollout = $0.0001–0.0008 per rollout, which cancels the saving. As an
  on-demand flag it costs one request per use. Solve: neutral to negative (register B12: more
  addresses made the agent do more work live).
- **Vehicle / sweet-only:** product code; yes.
- **`$0` falsifier:** the one that matters was run here — share of jump targets not nameable
  by the shipped trailer. Result: 42% (71 of 168) counting all upward jumps as unnamed.
- **Kill condition (pre-registered here):** kill unless at least 50% of jump targets are
  unnamed by the shipped trailer **and** a replay shows the outline names them. The first
  half fails at 42%, so the candidate is parked, not built.
- **Build cost:** medium (new flag, renderer, tests).
- **Register check:** B7 (banned same-information compaction — an outline replaces a wide
  read with a narrow one, so it is admissible only as "different lines"), B12/B12b (whole-file
  and symbol-complete widening INVERTED/DEAD — the outline is the narrowing mirror image),
  B13 (payload budgeting PARKED). Not a register row; CM-11 seed, now measured.
- **new_tool:** false. **needs_user_decision:** none.

### C3. Index-backed filename discovery (`ss-grep --files <glob>` / `ss-files`) — DO NOT BUILD

- **Family:** capability gap (enumeration). **Harnesses:** all three.
- **Mechanism:** answer `rg --files -g`, `glob`, `find -name` from the index path table
  (`SELECT DISTINCT file_path FROM vectors`). Seeded by native-capability-gaps S2 and the
  unbuilt `sweet-search files` plan.
- **Evidence:** native's enumeration habit costs it 2.06–2.15 operations, 0.64 / 0.23 / 0.56
  enumeration-only requests and 2,336 / 1,843 / 673 output tokens per rollout; sweet's guide
  rule keeps sweet at 0.30–0.45 operations and 156 / 51 / 10 tokens `[M census.py C,
  request-level recount]`. Sweet never opens with an enumeration on opencode or claude-code;
  native opens with one in 63 / 64 / 30 of 66 rollouts. The abstention is worth up to
  7.1% / 4.8% / 2.9% of a sweet rollout `[I]`. The index path table covers 70.9–98.0% of
  tracked files; the missing 2–29% are dotfiles, docs, images, generated code and tiny
  fixtures — the very files agents glob for `[M census2.py 4]`.
- **Ceiling:** negative to zero. Sweet's own enumeration spend is 156 / 51 / 10 tokens and
  0.15 / 0.32 / 0.00 requests per rollout; the most a mode could reshape is under 1%. The
  downside is re-adopting native's opener (up to 3–7%) and a new false-absence surface for
  files the index does not admit. Solve: unknown; native's orientation listing did not buy it
  more solves (125 vs 120 of 198, inside noise).
- **Vehicle / sweet-only:** wrapper flag; yes.
- **`$0` falsifier:** already answered by the recall census: 22 of 22 goldens have tracked
  files absent from the path table (median coverage 87.9%).
- **Kill condition:** kill if path-table recall is under 95% on any pool golden — met on 20
  of 22.
- **Build cost:** small as a flag; a new tool otherwise.
- **Register check:** not a register row; extends native-capability-gaps S2 with the
  request-level price of native's habit and the recall figure.
- **new_tool:** false as a flag, true as `ss-files`. **needs_user_decision:** owner rule 11
  if pursued as a tool; as a flag none, but the recommendation is not to build.

### C4. Test-to-symbol map for index-selected regression tests — DEAD on this bench (E13)

- **Family:** index-time precomputation feeding `run_tests`. **Harnesses:** all three.
- **Mechanism:** an index-time map from symbols to the tests that reference them, surfaced
  so the agent runs `run_tests <pattern>` with a symbol-scoped subset (register E13 / L1 / R5).
- **Evidence:** the shared frame already instructs both arms to use `run_tests <pattern>`
  `[C codex-task-runner.mjs:123]`; both arms do so in 8–17% of calls `[M]`; the shim refused
  47 of 121 targeted calls (39%) as compound test commands or unsupported runners
  `[M census4.py 3; C rt-condense-lib.mjs:457-470]`; full-suite output is already condensed
  to a median 828–936 tokens and a targeted run's median is 391 (codex sweet) to 1,212
  (opencode sweet) `[M census2.py 2]`; agents type exact test names they located themselves;
  all three `awslabs` losers had read the covering test before editing `[M census3.py D]`;
  TDAD reports resolution 31% → 29% with graph-selected tests `[W arXiv:2603.17973 via
  competitor-mechanisms CM-4]`; 7 of 153 fresh-pool losses passed the required failing tests
  and failed only on regressions, which a narrower run hides (CM-4).
- **Ceiling:** requests 0 (a `run_tests` call is a call either way); tokens at most
  ~400 saved per targeted call × ~2.5 calls × 61% supported ≈ 600 tokens = $0.00016 per
  rollout (1.3%), and zero head-to-head differential because the shim and frame are shared.
  Test-relevant files: the covering test was already read in 15 of 18 cells on the one task
  where it decides the layer. Solve: negative risk (regressions hidden).
- **Vehicle / sweet-only:** shared `run_tests` shim and frame; no. An index-supplied pattern
  would be sweet-only but changes no request count.
- **`$0` falsifier:** run here (pattern use, ignore rate, output size, covering-test reads).
- **Kill condition:** E13's own — "kill below one exposed call per rollout": exposed calls
  (full suite when a symbol-scoped subset existed) cannot exceed the 2.5 untargeted calls
  per rollout, and even at that maximum the token prize is 1.3% with zero differential.
- **Build cost:** none recommended.
- **Register check:** E13 OPEN → recommend DEAD for this bench; F13/F14 (shared verification
  machinery, zero differential); P4 (look-before-API, DEAD) and P5 (tests-first, DEAD) cover
  the prompt forms.
- **new_tool:** false. **needs_user_decision:** none.

### C5. Jam symbol extraction (index-time grammar gap) — product correctness, zero pool ceiling

- **Family:** index-time symbol extraction. **Harnesses:** all three (index-side).
- **Mechanism:** `core/infrastructure/language-patterns/maps.js:188` maps `.jam` (and
  `Jamfile`, `Jamroot`, `Jamrules`) to generic chunking with no entity grammar `[C]`. Add a
  Jam rule/action/module extractor so `entities` carries `rule <name>` spans; the same-file
  span map, unread-below names, `ss-trace` and any outline then work on Boost.Build code.
- **Evidence:** 0 of 618 indexed `.jam` files in the two `bfgroup__b2` goldens carry any
  entity `[M census3.py A]`; the wrongfix-facts report places the deciding Jam lines on screen
  in 11 of 18 `b2-259` cells, and both `b2` tasks are 0 of 3 in every arm and harness.
- **Ceiling:** zero on this pool (dead-everywhere tasks, deciding lines already on screen);
  cost effect unmeasurable at `$0`. Solve: none claimed.
- **Vehicle / sweet-only:** indexer; yes.
- **`$0` falsifier:** none needed for the fact; for value, count `ss-search` packs on `b2`
  whose top-1 was a `.jam` window with an empty span map (the map needs adjacent entities).
- **Kill condition:** as a bench lever it is already dead; keep only as product work.
- **Build cost:** medium (a grammar for Jam rules and actions, tests, held-out retrieval
  check per repo `CLAUDE.md`).
- **Register check:** E1 (Jam admission SHIPPED — admission is a different layer from
  extraction), E7 (trace gaps, OPEN — this is a whole-language instance), E15 (hygiene
  classifier, PARKED). Not a register row.
- **new_tool:** false. **needs_user_decision:** none.

### Not carried forward as candidates

- **Dependency-source tiers (E5):** 0 dependency operations in 396 rollouts. Keep PARKED;
  the pool cannot revive it.
- **Working-tree freshness for `ss-grep` (E3):** 7 genuine stale zeros in 1,251 lexical calls
  (0.56%); 13 follow-up requests over 198 rollouts. Stays closed; the number is now recorded.
- **Extensionless dot-config admission:** 94 dotfiles absent across the 22 goldens
  (`.eslintrc` 6, `.prettierrc` 7, `.editorconfig` 9 …); native read one in 4 of 198
  rollouts (phase-anatomy PA-5). Merge into the PA-5 seed; the recall table above is the
  cross-golden census it asked for.
- **Tiny fixture files:** 83 `.md` and 30 `.json` fixtures under 30 bytes are absent from the
  path table (markup-it, accenture). The rule that drops them was not located in code
  (`indexing-file-policy.js` was checked; the chunker's floor was not). Both tasks are dead
  in both arms; recorded only.

## 4. Register check summary

| finding | nearest register row | this report |
|---|---|---|
| `run_tests <pattern>` already shared and used; shim ignores 39%; output condensed | E13 OPEN | recommend DEAD (bench); numbers above |
| jump reads 11–13%, trailer already names 49–72% of targets | C9 PARKED, B8, B7, B12 | outline parked at `$0`; unread-above line is hygiene |
| enumeration abstention worth 3–7%; path-table recall 71–98% | — (S2 seed) | do not build a files mode |
| 0 dependency ops in 396 rollouts | E5 PARKED | no revival on this pool |
| own-code stale zeros 0.56% of lexical calls | E3 OPEN/closed | stays closed with a number |
| Jam 0/618 symbols | E1, E7 | new index-time defect, zero pool ceiling |
| 94 dotfiles outside the index | E1 (PA-5 seed) | merge |

## 5. Traps met

1. `agent-runner-shared.mjs:14` says "run_tests takes no arguments"; it means docker
   arguments. The shim does take a test pattern (`rt-dedup.mjs:65`).
2. The classified corpus is per call, not per request. Counting "requests whose ops are all
   enumeration" at call level overstates opencode and claude-code; the request-level recount
   (grouped by `req`) is the one reported.
3. `preds-<arm>.jsonl` holds one patch per task (the last rep); per-rep patches live in
   `<arm>/patches.json` (rep 0) and `<arm>/rep-N/patches.json`.
4. Several repositories have several goldens (moq 4, b2 3, markup-it 2, apigee 2 …); map by
   `base_commit` from `tasks.json`, never by repository name.
5. My first entity-type list omitted `arrowFunction`, `component`, `namespace`, `typeAlias`;
   JS/TS coverage read 43–56% until the list was widened (59–100% after). Jam is 0% under
   either list.
6. Files in the index with zero entities include many legitimate symbol-free files (constants,
   `__init__.py`, data modules); "no symbols" is not by itself an extraction defect.

## 6. What I could not finish

- The unread-above falsifier (C1) is specified, not run: it needs the 54 upward-jump events
  joined to `entities.start_line` per file; about an hour of read-only work on the box.
- The outline's payload was sized from entity name and signature lengths, not from a rendered
  outline; token counts are characters ÷ 4 `[I]`.
- Opencode native `grep` tool output was not parsed for hit paths, so its grep-then-read pair
  rate is missing (sweet and the other native cells are complete).
- The rule that keeps tiny fixture files out of the path table was not located in code.
- Whether the runtime maintainer reconciles during a rollout was not verified; the stale-zero
  count (7) is consistent with a freshness window but does not measure it.
- No solve-side estimate for any candidate beyond the arm-universal loss taxonomy; all
  candidates here are cost or correctness items, and none is proposed for a paid run.

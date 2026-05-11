# PLAN.md — Phase 2 + Language Expansion + Doc/Settings Probes

**Purpose:** machine-executable runbook for a `/loop` agent to iterate through Phase 2 chunker fixes, language expansion, and doc/settings probe validation — with strict no-regression discipline. Run via: `Execute @PLAN.md`.

**Created:** 2026-05-11. **Author:** Claude. **Mode:** autonomous overnight + next-day continuation; loop until all items DONE/FAILED.

---

## 0. Meta state (loop reads + updates this)

```
ITERATION:        5          # incremented each loop pass
CURRENT_ITEM:     none       # set to item id when IN_PROGRESS
LAST_COMMIT:      d58d17c    # most recent shipped commit before this plan
GLOBAL_HALT:      false      # true => stop all work; manual intervention required
HALT_REASON:      none
```

## 1. Locked baselines (NEVER regress below these)

Read these as the immutable thresholds. Verified 2026-05-11 commit 6c0beb9 / 9a7b5e0:

| Bench | Command | Floor |
|---|---|---|
| Original retrieval-probes | `node eval/retrieval-probes/run-probes.mjs` | **PASS ≥ 46/60**, zero PASS→FAIL flips vs `eval/retrieval-probes/post-perf-60.json` |
| GCSN dev MRR@10 | `node eval/run_benchmark.js --dataset=gencodesearchnet --split=dev --skip-index --profile=full` | **≥ 86.92%** (within ±0.05pp noise band → 86.87% absolute floor) |
| AST-tester probe pack — Phase 1 end state | per-language run-probes.mjs (see §3) | **No PASS→FAIL flips on any existing language pack** |
| Unit tests | `npm test -- --run` | **All passing** (4254 passed / 16 skipped as of baseline) |

If ANY of these regresses after an item's changes: revert the item, mark FAILED, continue. If TWO consecutive items fail validation OR if a regression appears that the revert can't fix → set `GLOBAL_HALT=true`.

## 2. Hard constraints (apply to every change)

1. **No regressions** on §1 gates. Period.
2. **No overfitting** — fixes must be principled. Acceptable evidence:
   - Matches a stated architectural intent in code comments (cite line)
   - Verified by tree-sitter source / grammar reference (cite URL)
   - Cross-checked against how at least 1 other code-search tool handles the same idiom (web search, cite source)
3. **No cross-language ranking penalties** — per user 2026-05-11 ("overfitting"). KT-003 (Java-beats-Kotlin) stays unfixed.
4. **No ranker/demotion tuning** beyond what's already shipped. The existing doc-demotion was hard-tuned to avoid overfitting; do not modify unless ALL other items DONE AND zero regressions ANYWHERE.
5. **Web-search rule (3-strike)**: if a fix doesn't land after 3 attempts → web search before continuing. Document the search query + relevant link in the iteration log.
6. **Post-non-chunker rule**: any change that doesn't require a re-index (probe gold edits, ranker tweaks, etc.) MUST re-run all six probe sets (original + 5 existing language packs) to confirm zero incidental regression.
7. **Held-out discipline**: NEVER inspect per-query held-out failures during dev. Aggregate-only reads, milestone-only.
8. **Repo size limit**: new-language repos MUST index in ≤ 5 min on M3 Max (typically <300 source files, <50k LOC). If the chosen repo would take longer → reject and pick a smaller one.

## 3. Validation pipeline (run in this order after every item)

```bash
# Step 1 — unit tests (chunker + indexing + graph)
npm test -- --run tests/indexing/ tests/graph/

# Step 2 — (if chunker change) re-index affected repo
cd eval/ast-tester-probes/_repos/<lang> && rm -rf .sweet-search/ && \
  node /Users/admin/Projects/sweet-search-private/core/indexing/index-codebase-v21.js --full

# Step 3 — affected language probes
node eval/retrieval-probes/run-probes.mjs \
  --probes-file=eval/ast-tester-probes/gold/<lang>.json \
  --repo-base=eval/ast-tester-probes/_repos/<lang> \
  --json=eval/ast-tester-probes/results/<lang>-<date>.json

# Step 4 — original retrieval-probes (regression gate)
node eval/retrieval-probes/run-probes.mjs --json=eval/retrieval-probes/last-<item-id>.json

# Step 5 — diff against baseline
node -e "import('fs').then(fs => { const b=JSON.parse(fs.readFileSync('eval/retrieval-probes/post-perf-60.json','utf8')); const c=JSON.parse(fs.readFileSync('eval/retrieval-probes/last-<item-id>.json','utf8')); /* assert no PASS→FAIL flips, PASS count ≥ 46 */ })"

# Step 6 — GCSN dev FULL profile, ALWAYS after ANY chunker/grammar change.
# (Per user 2026-05-11 "I lean (a) for gcsn" — strict gate.)
# Even chunker changes for non-GCSN languages: still run, because invariance
# under --skip-index is our positive proof we didn't accidentally touch
# search-time code. ~5min cost per run; worth the certainty.
node eval/run_benchmark.js --dataset=gencodesearchnet --split=dev --skip-index --profile=full
# assert MRR@10 ≥ 0.8687

# Step 7 — all 5 (or N as we grow) other language packs — verify no PASS→FAIL flips
for lang in typescript rust kotlin csharp cpp <newly-added-langs>; do
  node eval/retrieval-probes/run-probes.mjs \
    --probes-file=eval/ast-tester-probes/gold/$lang.json \
    --repo-base=eval/ast-tester-probes/_repos/$lang \
    --json=eval/ast-tester-probes/results/$lang-<item-id>-check.json
done
```

## 4. Per-item template

```
### <ITEM_ID>. <Title>
**Type:** chunker-fix | new-language | doc-probe-positive | doc-probe-negative
**Symptom / Goal:** <what to fix or measure>
**Hypothesis:** <root cause, with code-path citation>
**Fix approach (minimal, surgical):** <files + functions to touch>
**Pre-flight web search (always for new-lang, optional for chunker-fix):**
  - "<query 1>"
  - "<query 2>"
**Per-item validation gates** (in addition to §3):
  - <item-specific gate>
**Abort/revert:** revert touched files, mark FAILED with reason in this block.
**Status:** [ ] PENDING / [-] IN_PROGRESS / [x] DONE @ <sha> / [!] FAILED-REVERTED
**Iteration log:**
  <iter N, date, what happened, observed numbers>
```

---

## 5. Items — execute top-to-bottom, skip DONE / skip FAILED

### A — Phase 1 finalize

#### A1. Held-out aggregate read on existing 5 probe packs
**Type:** measurement-only (no code change)
**Symptom / Goal:** Establish the held-out baseline number for Phase 1 (15 probes across 5 langs × 3 each). One-time milestone read, aggregate only.
**Fix approach:** Run each language's probes filtered to held-out IDs from `eval/ast-tester-probes/splits/heldout.json`. Record summary numbers in iteration log. NO per-query failure inspection.
**Per-item gates:** none beyond §3.
**Abort/revert:** N/A (no code change).
**Status:** [x] DONE @ ffa73d7 — held-out aggregate 3 PASS / 4 PARTIAL / 8 FAIL of 15 (cpp 0/0/3, csharp 0/2/1, kotlin 1/1/1, rust 1/0/2, typescript 1/1/1). Milestone baseline for Phase 1 end state; per-query inspection deferred per held-out discipline.

---

### B — Phase 2 chunker grammar fixes

Priority by yield (descending). Each item: web-search if uncertain, apply principled fix, re-index affected repo, full §3 validation.

#### B1. C++ struct/class/template/using name extraction
**Type:** chunker-fix
**Symptom:** All 8 cpp probes have `name=null` or keyword (`class`/`namespace`) in entities. Indexer fails to extract identifier following `struct`/`class`/`using`/`template`.
**Hypothesis:** Tree-sitter cpp `class_specifier` / `struct_specifier` / `alias_declaration` / `template_declaration` are in BOUNDARY_TYPES but TAGS_QUERIES has no rules for them. NODE_TYPE_MAP maps `class_specifier→class` but no name extraction happens via captures.
**Fix approach:** Add to cpp TAGS_QUERIES in `core/infrastructure/tree-sitter-provider.js`:
  - `(class_specifier name: (type_identifier) @class.definition)`
  - `(struct_specifier name: (type_identifier) @struct.definition)`
  - `(alias_declaration name: (type_identifier) @type.definition)` (for `using X = ...`)
  - Template-wrapped variants: `(template_declaration (class_specifier name: (type_identifier) @class.definition))`
**Pre-flight web search:** "tree-sitter-cpp class_specifier name field", "tree-sitter cpp alias_declaration", "tree-sitter cpp template_declaration captures".
**Per-item gates:** cpp probes — expect ≥ 4/8 PASS (was 0/8). Re-index ~22 min.
**Abort/revert:** revert tree-sitter-provider.js.
**Status:** [!] FAILED-REVERTED — fix landed structurally (alias_declaration + template_declaration in BOUNDARY_TYPES, _resolveBoundary drill for template wrappers, alias_declaration→typeAlias in NODE_TYPE_MAP) and re-index succeeded (1048s, 5832 chunks). cpp probes still 0/2/6 — per-item gate "≥4/8 PASS" not met. §1 gates all GREEN (retrieval-probes 46/60 unchanged, GCSN 86.92% exact, ts/rust/kotlin/csharp zero flips). Root cause appears bi-encoder-bound: chunker now correctly names templated structs / using-aliases (CPP-004 returns typeAlias `InputVec` instead of `struct TypeInfo`, CPP-005 returns typeAlias `LaneType` instead of `struct alignas`), but the encoder ranks competing typeAliases over the gold (`Vec`/`Simd`). Reverted tree-sitter-provider.js. cpp _repo .sweet-search/ left in post-B1 chunker state; next cpp re-baseline must re-index. Iter 5.
**Type:** chunker-fix
**Symptom:** RS-006 (`SortedMergeIter`) and RS-008 (`detect_package_root`) have gold at rank 1 in late-interaction but bi-encoder candidate set misses them — chunk is mis-named after first sibling (`Flags` hides `SortedMergeIter`; `is_package` hides `detect_package_root`).
**Hypothesis:** Chunker emits one chunk per BOUNDARY_TYPES anchor, but when adjacent top-level items collapse into one chunk, only the first item's name is stored. Need either: (a) split per-item, or (b) emit secondary symbols as aliases.
**Fix approach:** Investigate `core/indexing/ast-chunker.js` chunk-merging logic. Prefer (b) name_alias — already exists in entities schema, just needs to be populated for sibling top-level items in the same chunk.
**Pre-flight web search:** "code chunking multi-symbol per chunk strategy", "tree-sitter chunk boundary adjacent top-level items".
**Per-item gates:** rust probes — expect RS-006 + RS-008 PARTIAL/PASS (currently FAIL). Re-index ~77 min.
**Abort/revert:** revert ast-chunker.js + tree-sitter-provider.js touches.
**Status:** [ ] PENDING

#### B3. Rust lifetime `<'a>` chunker boundary (RS-002, RS-003)
**Type:** chunker-fix
**Symptom:** `pub(crate) struct Checker<'a>` and `lint_fix<'a>` chunks come out as `code:null`. Recall@20=0 for these (gold not even in top-20).
**Hypothesis:** Tree-sitter capture `(struct_item name: (type_identifier) @struct.definition)` doesn't fire when the struct has `<'a>` type parameters — possibly because the AST shape differs (`type_identifier` is wrapped in a node that the capture pattern doesn't match) OR the capture fires but downstream code drops it.
**Fix approach:** Investigate tree-sitter-rust AST shape for `struct Foo<'a>` vs `struct Foo`. Adjust capture or add a variant capture that handles the lifetime-parameterized case. May also need similar fix for `fn foo<'a>`.
**Pre-flight web search:** "tree-sitter-rust struct_item with lifetime parameter AST shape", "tree-sitter rust function_item generic_parameters".
**Per-item gates:** rust probes — RS-002, RS-003 expect file_correct (PARTIAL+) at minimum. Re-index ~77 min.
**Abort/revert:** revert tree-sitter-provider.js.
**Status:** [ ] PENDING

#### B4. C# partial-class shard method emission (CS-007)
**Type:** chunker-fix
**Symptom:** Partial-class shard files (`AsyncProcessor.cs` is a 144-line file solely containing a `partial class RespServerSession` continuation) emit only the class header as symbol. Method-level symbols inside are swallowed.
**Hypothesis:** C# regex chunker treats the whole file as one chunk anchored on the class declaration, but the class pattern's match consumes the full file. Methods inside should be emitted as nested entities (parent_class field exists in schema).
**Fix approach:** In `core/infrastructure/language-patterns/registry-core.js` csharp section, ensure `method` pattern still extracts methods even when nested inside a partial-class shard. May require chunker change in ast-chunker.js to handle "single top-level class with many methods" case.
**Pre-flight web search:** "C# partial class chunking code search", "code indexer partial class shard methods".
**Per-item gates:** csharp probes — CS-007 expect symbol PASS (currently PARTIAL with symbol=RespServerSession instead of method name). Re-index ~38 min.
**Abort/revert:** revert registry-core.js + ast-chunker.js.
**Status:** [ ] PENDING

#### B5. Kotlin annotation-decorated open class extraction (KT-001)
**Type:** chunker-fix
**Symptom:** `JobSupport` (an annotation-decorated 1582-line open class) — file is correct but symbol returned is an internal method (`parentCancelled`) instead of the class header.
**Hypothesis:** Kotlin chunker boundary fires inside the open class body for each large nested function, demoting the class-header chunk. May need a "size-aware" rule that keeps the class header chunk distinct OR boost rank of the named class chunk for class-targeted queries.
**Fix approach:** Inspect kotlin chunker in registry-object-oriented.js + ast-chunker.js handling for very-large open classes. Likely small chunker policy change.
**Pre-flight web search:** "tree-sitter-kotlin class_declaration body chunking large class".
**Per-item gates:** kotlin probes — KT-001 expect PASS. Re-index ~12 min.
**Abort/revert:** revert kotlin pattern files.
**Status:** [ ] PENDING

---

### C — Language expansion

**Workflow for each Cn item** (use sonnet subagents for repo selection, probe generation, and diagnostic):
1. Web search: "small idiomatic <lang> open source MIT|Apache 2024 2025 <300 files".
2. Spawn **sonnet subagent** with full context (locked SHA target, 8-probe schema, repo-size constraint, idioms list per lang) to: pick a repo, clone shallow, generate 8 probes (3 NL behavior + 3 symbol-anchored + 2 grammar-edge-case), verify every gold file exists and every gold symbol greps clean.
3. Add repo entry to `eval/ast-tester-probes/repos.json`.
4. Index (`<5 min` target — if exceeded, ABORT, pick smaller repo).
5. Run probes → **commit baseline** (`feat(probes): <lang> baseline N/M/K`).
6. Spawn **sonnet diagnostic subagent** with the failure breakdown to produce `eval/ast-tester-probes/diagnostics/<lang>-failures-2026-MM-DD.md`.
7. Identify principled fixes (web search "how does tree-sitter <lang> chunk Y", "code search chunking idioms <lang>"). Apply only if:
   - Fix matches stated grammar/architectural intent
   - Generalizes (sanity-test on 2-3 other files in the repo)
   - Cited by at least 1 external source (tree-sitter docs, code-search tool docs)
8. Re-index, re-run probes, full §3 validation including ALL other language packs.
9. Commit fix (`fix(indexer): <lang> grammar — <cluster>`).

Each `Cn` item below is one language. Items execute in this order (most-production-traffic first):

#### C1. Java (top priority)
**Type:** new-language
**Idioms to target:** annotations, generic wildcards `? extends T`, lambda expressions, switch expressions, records, sealed classes, text blocks (Java 13+).
**Pre-flight web search:** "small idiomatic Java library MIT 2024", "tree-sitter-java capture queries best practices".
**Status:** [ ] PENDING

#### C2. Python
**Type:** new-language
**Idioms:** decorators (function/class), type hints `T | U` (3.10+), walrus operator `:=`, match statements (3.10+), async generators, dataclasses.
**Status:** [ ] PENDING

#### C3. JavaScript
**Type:** new-language
**Idioms:** template literals with tagged templates, async generators, class private fields (`#foo`), optional chaining `?.`, nullish coalescing `??`, destructuring with defaults.
**Note:** distinct from the TypeScript probes — a pure CJS or modern ESM .js library. NO .ts/.tsx files in the repo.
**Status:** [ ] PENDING

#### C4. Ruby
**Type:** new-language
**Idioms:** blocks (`{ |x| ... }` and `do |x| ... end`), `attr_accessor`, metaclasses, refinements, pattern matching (3.0+).
**Status:** [ ] PENDING

#### C5. Go
**Type:** new-language
**Idioms:** interfaces, generics (1.18+), channel ops, multi-return, struct embedding, named return values.
**Status:** [ ] PENDING

#### C6. PHP
**Type:** new-language
**Idioms:** traits, generators, enums (8.1+), readonly properties, constructor property promotion (8.0+), match expression.
**Status:** [ ] PENDING

#### C7. C (distinct from C++)
**Type:** new-language
**Idioms:** macros (`#define`), function pointers, struct typedefs, `static inline`, designated initializers, `_Generic`.
**Note:** pick a pure-C codebase (no C++). Not a kernel module — too large.
**Status:** [ ] PENDING

#### C8. TypeScript — second repo (library/framework, NOT a Next.js app)
**Type:** new-language
**Goal:** broaden TS coverage beyond vercel/ai-chatbot (which is a Next.js app). Want a TS library codebase — different idiom mix (no app-level patterns; more types/generics-heavy, no JSX heavy paths).
**Idioms to target:** conditional types, mapped types, template literal types, type predicates, declaration merging, namespace exports.
**Naming convention:** key = `typescript-lib` to distinguish from existing `typescript` entry.
**Status:** [ ] PENDING

#### C9. Swift
**Type:** new-language
**Idioms:** property wrappers (`@State`, `@Published`), result builders, `@MainActor`, opaque return types `some V`, async/await, structured concurrency.
**Status:** [ ] PENDING

#### C10. Dart
**Type:** new-language
**Idioms:** mixins, factory constructors, named parameters, null safety `?`/`!`, extension methods, pattern matching (3.0+).
**Status:** [ ] PENDING

#### C11. Scala
**Type:** new-language
**Idioms:** implicits / `given`/`using` (Scala 3), case classes, pattern matching, for-comprehensions, type classes, enums (Scala 3).
**Status:** [ ] PENDING

#### C12. Lua
**Type:** new-language
**Idioms:** tables as namespaces, metatables, closures, multiple returns, `:` method syntax, `local function`.
**Note:** small ecosystem — easy to find a small repo.
**Status:** [ ] PENDING

#### C13. R
**Type:** new-language
**Idioms:** S4 classes, `<-` assignment, `%>%` pipe / `|>` native pipe, formulas (`y ~ x`), tidyverse idioms, NSE (non-standard evaluation).
**Note:** if no tree-sitter-r is available, document and skip (mark FAILED with reason).
**Status:** [ ] PENDING

#### C14. Zig
**Type:** new-language (Tier B trending)
**Idioms:** `comptime`, error union types `!T`, defer, packed struct, `@import`.
**Note:** if tree-sitter-zig is not in GRAMMAR_MAP, this requires adding the grammar — document and skip if it's a non-trivial add.
**Status:** [ ] PENDING

#### C15. Elixir
**Type:** new-language (Tier B)
**Idioms:** `do/end` blocks, pattern matching in function heads, pipe operator `|>`, protocols, `with` expressions, GenServer callbacks.
**Status:** [ ] PENDING

#### C16. Gleam
**Type:** new-language (Tier B)
**Idioms:** pattern matching, generics, `use` expressions, opaque types.
**Note:** small ecosystem; if no usable repo or no tree-sitter grammar, mark FAILED with reason.
**Status:** [ ] PENDING

#### C17. Mojo
**Type:** new-language (Tier B)
**Idioms:** `struct` vs `fn` vs `def`, parameter inference, SIMD vector types.
**Note:** very young language (post-2023); if no tree-sitter-mojo grammar exists, document and skip. Likely SKIP.
**Status:** [ ] PENDING

#### C18. Julia
**Type:** new-language (Tier B)
**Idioms:** multiple dispatch, macros (`@`-prefixed), type parameters, `do` blocks, broadcasting `.`.
**Status:** [ ] PENDING

---

### D — Doc/settings probes (run ONLY after C-block exhausted with 0 regressions)

User intent (2026-05-11): validate that when queries genuinely need docs/configs, they still get retrieved despite the existing demotion. Do NOT tune demotion logic — it was hard-won.

#### D1. Positive doc/settings probes (add only; measure)
**Type:** doc-probe-positive (probe creation + measurement; no code change)
**Goal:** Across existing repos, add 4-6 probes per repo where the gold IS legitimately a doc/config file. Example queries:
  - "what license is this project under" → `LICENSE` / `LICENSE.md`
  - "what version is published" → `package.json` (version field) / `Cargo.toml` (version field)
  - "what node version does the project require" → `package.json` (engines)
  - "what's the dependency on X" → `package.json` / `Cargo.toml` / `go.mod`
  - "what's the docker build command" → `Dockerfile`
  - "what github workflows run on PR" → `.github/workflows/*.yml`
  - "what's the project's stated purpose" → `README.md`
**Workflow:**
  1. Add 4-6 positive probes per existing repo (12 repos × 4 = ~48 probes minimum)
  2. Run all probes — measure how many PASS
  3. Commit (`feat(probes): doc/settings positive probes`)
  4. NO chunker/demotion changes regardless of pass rate — measurement-only.
**Per-item gates:** no PASS→FAIL flips on existing language probes (just adds new probes).
**Status:** [ ] PENDING

#### D2. Negative doc/settings probes (ONLY if D1 done + zero regressions globally)
**Type:** doc-probe-negative (probe creation + measurement; no code change)
**Goal:** Across existing repos, add NL queries about CODE LOGIC where doc/config files MUST NOT outrank impl. Measure if existing demotion holds.
**Workflow:** same as D1 but inverted. No demotion tuning.
**Per-item gates:** same as D1.
**Status:** [ ] PENDING

#### D3. Demotion tuning (BLOCKED — do not execute autonomously)
**Type:** ranker-change
**Status:** BLOCKED — requires explicit user approval. Listed for completeness only. Do NOT execute.

---

## 6. Loop protocol (the model's contract)

**KEEP-GOING RULE (loud, in bold, because the user explicitly demanded it):** the loop MUST continue iterating until all items in §5 are either `DONE` or `FAILED-REVERTED`, OR a §6 global halt trigger fires. **Do NOT stop early** because:
- the user is asleep — keep working
- an item failed — revert it, mark FAILED, continue to the next
- the queue is "long" — that's the whole point; user said "I don't care if we finish tomorrow evening"
- a single iteration produced no probe improvements — that's fine, commit the no-op revert and continue
- ScheduleWakeup returned an error once — try once more, then halt only if it fails again

Each iteration of the loop performs **exactly one of these**:

- **Discover**: read PLAN.md, scan items top-to-bottom, pick first not-DONE-not-FAILED item, mark IN_PROGRESS in §0 meta, push the meta update as a single commit (`chore(plan): mark <id> IN_PROGRESS`).
- **Execute**: do the actual work for the in-progress item. Use sonnet subagents for probe generation + diagnostics; use foreground Bash for indexer + validation runs; use `run_in_background` only when a single command exceeds 8-min timeout (re-indexes longer than that).
- **Validate**: run §3 pipeline in order. Halt on first failed gate.
- **Resolve**:
  - All gates green → commit fix/probes per the item's commit-message convention, push, mark `[x] DONE @ <sha>` in PLAN.md, append iteration log entry, push the PLAN.md update.
  - Any gate red → revert touched files with `git checkout HEAD -- <files>` (do NOT use `git reset --hard`), mark `[!] FAILED-REVERTED` with reason, append iteration log entry, push.
- **Schedule next**: call ScheduleWakeup with appropriate delay (see §7) and `prompt="Execute @PLAN.md"`.

If iteration finds NO not-DONE-not-FAILED items remaining: write a final summary to the iteration log, push, and STOP (do not ScheduleWakeup).

**Global halt triggers** (set `GLOBAL_HALT=true` and STOP):
- GCSN dev MRR@10 falls below 86.87% (0.05pp tolerance) AND revert of the offending item doesn't restore it.
- Original retrieval-probes PASS count falls below 46 AND revert doesn't restore.
- 2 consecutive items end FAILED.
- `git push` fails twice in a row.
- Any unit test outside Phase 2 / D scope regresses.

## 7. ScheduleWakeup cadence

Per CLAUDE.md cache window guidance:

- **Active compute waiting** (re-indexing, GCSN running): wakeup in **270s** (cache-warm) — repeat checks.
- **Long re-indexes (>10 min remaining)**: wakeup in **1800s** (one cache miss, amortized over 30 min).
- **Between items, no work in flight**: wakeup in **60s** (immediate next iteration).
- Loop runtime clamps to [60, 3600] so don't worry about exact values.
- Pass `prompt="Execute @PLAN.md"` verbatim every time (recursive self-pacing).

## 8. Commit message conventions

- `feat(probes): <lang> baseline N PASS / M PARTIAL / K FAIL`
- `fix(indexer): <lang> <one-line cluster summary>`
- `chore(plan): mark <item-id> IN_PROGRESS|DONE|FAILED`
- `feat(probes): doc/settings positive probes` (Phase D)

Every commit includes the standard `Co-Authored-By: Claude` trailer (per repo convention).

## 9. Iteration log (append-only — newest at bottom)

Each iteration appends ONE block:

```
--- iter N (YYYY-MM-DDTHH:MM:SSZ) ---
item: <ITEM_ID>
action: <discover|execute|validate|resolve|schedule>
result: <what happened, key numbers, sha if committed>
next: <next item id and scheduled delay in seconds>
```

### Initial seed

```
--- iter 0 (2026-05-11T01:35:00Z) ---
item: none (plan creation)
action: PLAN.md authored
result: 27 items total (1 finalize + 5 Phase 2 + 18 languages + 3 doc-probe, of which D3 is BLOCKED). 26 executable; D3 documented for completeness only.
next: A1, schedule 60s

--- iter 1 (2026-05-11T01:36:00Z) ---
item: A1
action: discover
result: scanned §5, A1 first PENDING; marked [-] IN_PROGRESS, updated §0 meta (ITERATION=1, CURRENT_ITEM=A1).
next: A1 execute, schedule 60s

--- iter 2 (2026-05-11T02:15:00Z) ---
item: A1
action: execute + resolve
result: built per-lang held-out probe files at /tmp/ast-heldout/{cpp,csharp,kotlin,rust,typescript}.json (3 probes each, IDs from eval/ast-tester-probes/splits/heldout.json), ran each via run-probes.mjs with --probes-file/--repo-base. Phase 1 end-state held-out AGGREGATE: 3 PASS / 4 PARTIAL / 8 FAIL of 15. Per-language: cpp 0/0/3, csharp 0/2/1, kotlin 1/1/1, rust 1/0/2, typescript 1/1/1. Per-query failures NOT inspected per CLAUDE.md held-out discipline. Result artifacts: eval/ast-tester-probes/results/*-heldout-2026-05-11-A1.json. No code change.
next: B1 (cpp struct/class/template/using name extraction), schedule 60s

--- iter 3 (2026-05-11T02:18:00Z) ---
item: B1
action: discover
result: A1 closed; B1 first PENDING in §5. Marked [-] IN_PROGRESS, updated §0 meta (ITERATION=3, CURRENT_ITEM=B1).
next: B1 execute (preflight web search → patch tree-sitter-provider.js cpp TAGS_QUERIES → re-index cpp _repo → validate per §3), schedule 60s

--- iter 4 (2026-05-11T02:25:00Z) ---
item: B1
action: execute
result: PLAN.md hypothesis re class_specifier/struct_specifier captures was partially stale — those captures already exist in cpp TAGS_QUERIES. Actual root cause was different: BOUNDARY_TYPES for cpp didn't include alias_declaration (`using X = ...`) or template_declaration (`template<...> class|struct|fn|using`), so templated decls emitted as anonymous `code` chunks via the cAST sibling-merge path. Fix: added both node types to BOUNDARY_TYPES, added alias_declaration→typeAlias in NODE_TYPE_MAP, added _resolveBoundary helper that drills into template_declaration's first NODE_TYPE_MAP-known child to surface the inner type+name, threaded helper through flushBuffer + oversized-recurse + leaf-too-big call sites, and added (alias_declaration name: (type_identifier) @type.definition) to cpp TAGS_QUERIES. Unit tests passed 1432/1432. Kicked cpp re-index in background (PID 62071), 1048s, 5832 chunks, 6293 entities — completed.
next: B1 validate per §3, schedule 1500s for re-index window

--- iter 5 (2026-05-11T02:52:00Z) ---
item: B1
action: validate + resolve (revert)
result: ran §3 steps 3-7. cpp probes 0/2/6 — same PASS count as baseline but CPP-004/CPP-005 returned different typeAlias entities (InputVec, LaneType) instead of original struct/code chunks; CPP-007 still `code -`; cpp-targeted improvement DID NOT MATERIALIZE in retrieval rank. §1 locked baselines all GREEN: retrieval-probes 46/4/10 exact zero flips; GCSN dev MRR@10 86.92% exact match; ts/rust/kotlin/csharp probes zero flips vs -final. Per-item gate ("≥4/8 cpp PASS, was 0/8") NOT MET. Per §6 "any gate red → revert", reverted core/infrastructure/tree-sitter-provider.js via git checkout HEAD. Diagnosis: chunker fix is structurally sound and names are now correct, but bi-encoder ranks competing typeAliases over the gold. This is encoder-bound, not chunker-bound — outside B1 scope. cpp _repo .sweet-search/ remains in patched-chunker state (no functional impact since reverted code is identical search-time; next cpp re-baseline must re-index ~17 min).
next: B2 discover, schedule 60s
```

---

## 10. Items NOT covered by this plan (deferred / out of scope)

For the record so this plan's scope is unambiguous:

- **Long-tail languages**: Haskell, OCaml, Perl, F#, Erlang, Clojure, Fortran, COBOL, VBA — defer to future plan.
- **Cross-language penalty (e.g., KT-003 Java-beats-Kotlin)**: explicit user-rejected as overfitting risk.
- **Ranker/demotion tuning** beyond shipped Phase 1 state: blocked (D3 documented above).
- **Probe-pack split helper integration with existing `applySplit`**: nice-to-have, defer.
- **`evaluation/` directory cleanup**: already shipped in commit 9a7b5e0.

---

**End of PLAN.md.** Loop start: read §0, find first PENDING in §5, follow §4 template, validate per §3, resolve per §6.

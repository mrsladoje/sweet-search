# Rust Probe Failure Diagnosis — 2026-05-10

**Repo:** astral-sh/ruff @ ac6361d8  
**Result:** 3/8 PASS, 1/8 PARTIAL, 4/8 FAIL  
**Investigated:** RS-002, RS-003, RS-006, RS-007, RS-008

---

## Method

For each failing probe:
1. Confirmed the gold symbol and expected chunk in source.
2. Inspected `codebase.db` (SQLite `vectors` table) to determine what was indexed.
3. Ran k=20 search to determine: is gold in top-20 (ranking issue) or absent (chunker/encoder issue)?

---

## Per-Probe Findings

### RS-002 — `lint_fix` in `crates/ruff_linter/src/linter.rs`

**Gold:** `lint_fix` (function, L544)  
**Top-1:** `ty_python_semantic/src/fixes.rs :: ApplicableFix` (struct)

**Chunker:** `lint_fix<'a>` is **not extracted as a named chunk**. The lifetime-parameterized
signature `pub fn lint_fix<'a>(...)` is split by the chunker into three consecutive `code:null`
chunks (L544-552, L552-577, L578-636), each with `name=null`. The signature itself sits in
L544-552 but with tokenizer-split text (`pub\nfn\nlint_fix\n<'a>\n(`...) — whitespace-normalized
but without an extracted symbol name.

**k=20 check:** Gold file `linter.rs` does **not appear in top 20**. This is a
**chunker + encoder failure**.

**Root cause:** Two compounding issues:
1. The Rust tree-sitter grammar splits the lifetime-parameterized `fn lint_fix<'a>` across chunk
   boundaries such that no chunk gets `name="lint_fix"`. The function body is fragmented into
   `code:null` segments.
2. The query vocabulary ("iterative auto-fixes", "FixTable", "track count of applied fixes")
   strongly activates `applicability`-family terms. There are 9+ indexed chunks across the
   workspace named `applicable_*`, `Applicability`, `ApplicableFix`, etc. These outrank the
   un-named linter.rs code chunks that contain the actual `FixTable` logic.

**Failure mode:** Chunker extraction failure (lifetime `<'a>` fn) + encoder vocabulary saturation
("fix" + "applies" → applicability cluster).

---

### RS-003 — `Checker` struct in `crates/ruff_linter/src/checkers/ast/mod.rs`

**Gold:** `Checker` (struct, L196)  
**Top-1:** `ruff/src/commands/check.rs :: check` (function)

**Chunker:** `pub(crate) struct Checker<'a>` at L196 is split: the `struct` header appears at the
end of the L138-194 chunk (which is named `impl: ExpectedDocstringKind`), while the struct body
(fields) lives in L196-236 with `type=code, name=null`. No chunk in `ast/mod.rs` has
`name="Checker"`.

**k=20 check:** `ast/mod.rs` does **not appear in top 20** (only 12 results returned total,
suggesting low cosine similarity across the board). This is a **chunker + encoder failure**.

**Root cause:**
1. The struct definition `pub(crate) struct Checker<'a>` spans a chunk boundary: the `}`
   closing `ExpectedDocstringKind` at L194 causes the chunker to start a new `code:null` segment
   at L196, losing the `Checker` name.
2. The query ("walk the Python AST", "accumulate lint diagnostics", "single file check")
   activates the CLI `check.rs` file strongly — `check` is a concrete indexed function name
   in that file. The large `ast/mod.rs` (3700+ lines, 138 chunks) has no chunk with a high
   semantic signal for "Checker struct + AST walk + diagnostics" because the struct itself is
   anonymous in the index.

**Failure mode:** Chunker extraction failure (struct boundary at `pub(crate)` visibility modifier
after a closing brace) + CLI-file false positive ("check" function at high BM25-style score).

---

### RS-006 — `SortedMergeIter` in `crates/ruff_linter/src/directives.rs`

**Gold:** `SortedMergeIter` (struct)  
**Top-1 (k=5):** `ruff_python_ast/src/nodes.rs :: ArgumentsSourceOrder` (struct, unrelated)

**Chunker:** The struct definition `struct SortedMergeIter<L, R, Item>` at L75 is embedded
in the L1-82 chunk, which is named `impl: Flags` — referring to the `bitflags!` macro block
that precedes it in the file. The struct body and `SortedMergeIter` name are present in the
chunk text, but the chunk's indexed symbol is `Flags`, not `SortedMergeIter`.

**k=20 check:** `*** FULL MATCH` at **rank 1** in k=20 with `symbol: SortedMergeIter`. This means
the ranker surface-extracts `SortedMergeIter` from the chunk text at query time, but the k=5
run returned a different result. The k=5 vs k=20 discrepancy suggests a **late-interaction
reranking inversion**: the L1-82 `Flags` chunk ranks high enough in the recall set at k=20
but falls below the k=5 retrieval cutoff in the bi-encoder pass, leaving it unscored. At k=5
the top slot is filled by a higher-scoring but wrong chunk.

**Root cause:** Chunker misnames the chunk (symbol is `Flags` not `SortedMergeIter`) due to
the `bitflags! { pub struct Flags ... }` macro block appearing before the struct in the same
L1-82 chunk. The bi-encoder's recall pass at k=5 doesn't retrieve this chunk because the
dominant symbol signal is `Flags`. At k=20 the LI reranker finds the chunk because the query
terms (`SortedMergeIter`, `merges`, `sorted`, `iterators`, `source range`) match the text body.

**Failure mode:** Chunker misassociation (wrong symbol extracted from multi-item chunk);
bi-encoder recall miss at k=5.

---

### RS-007 — `warn_user_once_by_id` macro in `crates/ruff_linter/src/logging.rs`

**Gold:** `warn_user_once_by_id` (macro)  
**Top-1:** same file `logging.rs :: LogLevel` (enum) — PARTIAL

**Chunker:** `warn_user_once_by_id` macro at L22 is fully present in the L1-58 `code:null`
chunk (confirmed: full text includes `macro_rules! warn_user_once_by_id { ... }`). However,
the chunk has `type=code, name=null` — the macro_rules! name is **not extracted as a symbol**.
Instead the chunk is unnamed, and the file's first named chunk is `impl: LogLevel` at L59-121.

**k=20 check:** `logging.rs` is at **rank 1** (file match). The L1-58 `code:null` chunk
scores 0.4781 but the grader reads `symbol=LogLevel` (from the top-ranked named chunk in
that file — L59-121), not `warn_user_once_by_id`. This is a **symbol extraction failure**
combined with a **presentation-layer symbol attribution issue**: when the file is found,
the returned symbol is the nearest named chunk (LogLevel) rather than the macro in the
anonymous chunk.

**Root cause:** The Rust chunker does not extract `macro_rules!` definitions as named symbols.
All five consecutive `macro_rules!` blocks (L22-57) are collapsed into the `code:null` preamble
chunk. Diagnosis confirms: there is no chunk in the index with `type=macro` or
`name=warn_user_once_by_id`.

**Failure mode:** Macro extraction gap — `macro_rules!` blocks are not grammar-extracted as
named symbols; they fall into `code:null` preamble chunks and the query-time symbol attribution
picks up the nearest named entity (`LogLevel`).

---

### RS-008 — `detect_package_root` in `crates/ruff_linter/src/packaging.rs`

**Gold:** `detect_package_root` (function, L36)  
**Top-1:** `ruff_workspace/src/resolver.rs :: package_roots` (function)

**Chunker:** `detect_package_root<'a>` at L36 **is** present in the index, but bundled into
the L1-47 chunk named `function: is_package`. The `is_package` function starts at L28 and
the chunker anchors the chunk name to the **first** function in the file, so `detect_package_root`
is present in the chunk text but the indexed symbol is `is_package`.

**k=20 check:** `packaging.rs` appears at **rank 7** in k=20 (`function: package_detection_with_namespace_packages`).
The gold function is present in the text of the `is_package` chunk but not surfaced as a symbol.
This is partly a **chunker boundary issue** (two functions in one chunk) and partly a
**sibling-crate ranking issue**: `ruff_workspace/src/resolver.rs` contains a closely-related
function `detect_package_root_with_cache` (rank 1, score 0.527) and `package_roots` (rank 4,
score 0.500) — both of which are named, indexed, and semantically adjacent to the query.

**Root cause:**
1. Two short functions (`is_package` L28 and `detect_package_root` L36) are merged into one
   chunk; the chunk is anchored to the first function name, losing `detect_package_root`.
2. The workspace crate's resolver has a wrapping function `detect_package_root_with_cache`
   that is a named, indexed entry point — it outranks the actual implementation because its
   name is an exact token match.

**Failure mode:** Multi-function chunk collapse (short adjacent functions merged; second function
loses its name) + sibling-crate wrapper function over-ranks the actual implementation.

---

## Cluster Table

| Probe | Verdict | Gold in top-20? | Primary Failure Mode |
|-------|---------|-----------------|----------------------|
| RS-002 | FAIL | No | Chunker: lifetime `<'a>` fn → `code:null`; encoder vocab saturation ("applicability") |
| RS-003 | FAIL | No | Chunker: `pub(crate) struct` boundary missed; struct splits across chunks |
| RS-006 | FAIL | Yes (rank 1) | Chunker: wrong symbol name (`Flags` vs `SortedMergeIter`); bi-encoder k=5 miss |
| RS-007 | PARTIAL | Yes (rank 1) | Macro extraction: `macro_rules!` not extracted as named symbol → `code:null` |
| RS-008 | FAIL | Yes (rank 7) | Multi-fn chunk collapse; sibling-crate `detect_package_root_with_cache` over-ranks |

---

## Failure Mode Taxonomy

| Cluster | Count | Probes |
|---------|-------|--------|
| `macro_rules!` not extracted as named symbol | 1 | RS-007 |
| Lifetime-parameterized `fn` boundary split → `code:null` | 1 | RS-002 |
| Struct boundary split at `pub(crate)` / closing brace | 1 | RS-003 |
| Multi-item chunk: wrong symbol anchored (first wins) | 2 | RS-006, RS-008 |
| Sibling-crate wrapper over-ranks implementation | 1 | RS-008 |
| Encoder vocabulary saturation (competing semantic cluster) | 1 | RS-002 |

---

## Top Recommendations (actionable)

### 1. Extract `macro_rules!` names as first-class symbols (RS-007)
The Rust chunker produces `code:null` for all `macro_rules!` blocks. A tree-sitter
`(macro_definition name: (identifier) @name)` capture would extract `warn_user_once_by_id`
as `type=macro`. This is a pure grammar gap — the node type exists in the Rust grammar but
is not in the extraction rules. Fixes RS-007 outright and likely improves any macro probe.

### 2. Fix multi-item chunk symbol anchoring (RS-006, RS-008)
When a chunk contains multiple top-level items (struct + `bitflags!` block in RS-006; two
adjacent short functions in RS-008), the indexed symbol captures only the first item name.
Two options:
- **Split on each top-level item** (preferred): emit separate chunks for each `struct`,
  `fn`, `impl` etc. at the same syntactic level.
- **Fallback symbol extraction**: when the chunk body contains a second unambiguous symbol
  (e.g. `struct SortedMergeIter`), index it as an alias or secondary chunk.

### 3. Fix lifetime-parameterized `fn` extraction (RS-002)
`pub fn lint_fix<'a>(...)` is tokenized-split across chunk boundaries, losing the function
name. The tree-sitter `(function_item name: (identifier) @name)` capture should handle
lifetime parameters (they are children of `type_parameters`, not the function name node),
but the boundary-split is causing the name to be lost. Verify the chunk boundary logic does
not split `fn name<'a>` across lines.

### 4. Address `pub(crate) struct` boundary detection (RS-003)
The `Checker<'a>` struct body chunk starts with `{` (L196) because the prior chunk ends on the
`}` of `ExpectedDocstringKind` at L194. The struct header `pub(crate) struct Checker<'a>` is
missing from both chunks. Chunker needs to keep the struct keyword + name with the struct body
(look-behind to the preceding `struct` keyword when a chunk starts with `{`).

---

## Notes

- RS-006 is **recoverable by increasing k**: gold is at rank 1 in k=20, FAIL only because
  k=5 bi-encoder pass doesn't retrieve the `Flags`-named chunk. A symbol-name fix (rec. 2)
  would also resolve this without needing larger k.
- RS-008 sibling-crate over-ranking is secondary to the chunking issue; fixing the chunk
  name would likely move `packaging.rs` above `resolver.rs` for this exact-name query.
- RS-002 and RS-003 are the hardest: gold is not in top-20, meaning encoder
  signal is weak regardless of k. Both require chunker fixes before ranking can help.

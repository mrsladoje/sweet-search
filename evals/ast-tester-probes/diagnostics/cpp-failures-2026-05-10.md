# C++ probe failure diagnosis (2026-05-10)

## Summary
- 0/8 PASS, 2/8 PARTIAL, 6/8 FAIL
- Dominant failure modes (ranked):
  1. **Symbol extraction failure** — C++ class/struct/template top-level types not extracted as named symbols; the gold chunk exists in the index but its `name` field is `null` or wrong (macro token or keyword like `class`, `namespace`). All 8 probes are affected.
  2. **Structural chunking splits gold definitions across chunk boundaries** — e.g. `FunctionCache` struct header ends one chunk while its body is the next; `ChosenTarget` struct body spans a chunk whose `#define` preamble dominates ranking.
  3. **Cross-target confusion** — for CPP-007 (Vec128 SSE), ppc_vsx-inl.h has an identical `class Vec128` at L120 that outranks x86_128-inl.h because the x86 definition is buried inside a mega-chunk (L46–121) named `namespace`.
  4. **Macro dominance** — for CPP-001 and CPP-008, `hwy/detect_targets.h` macro blocks with `DISPATCH`/`TARGETS` tokens outscore the actual function implementations in `targets.cc`.

---

## Per-probe analysis

### CPP-001 — FAIL — macro dominance + SupportedTargets not extracted as named entity
**Query:** "how does highway dispatch the right SIMD target at runtime based on CPU features"
**Expected:** `hwy/targets.cc` [function: SupportedTargets]
**Got top-1:** `hwy/detect_targets.h:816` [macro: HWY_HAVE_RUNTIME_DISPATCH_LOONGARCH] score=0.524
**Top-20 ranking of gold:** MISSING (gold file not in top-20)
**Diagnosis:** `SupportedTargets` is absent from both the codebase.db chunk names and the code-graph.db entities table. The function body at `targets.cc:811-835` is stored as chunk `[function] "HWY_DLLEXPORT" L794-835` — the parser extracted `HWY_DLLEXPORT` (the export macro token) as the name rather than the actual function name. Because the embedding for this chunk does not carry the symbol name `SupportedTargets`, BM25F and HNSW cannot match the query token `dispatch`. Meanwhile `detect_targets.h` has dense `RUNTIME_DISPATCH` tokens across ~200-line macro blocks, directly matching query terms.
**Evidence:**
- `codebase.db`: chunk `hwy/targets.cc` L794-835 `[function] name="HWY_DLLEXPORT"` — name extraction failure.
- `code-graph.db`: `SupportedTargets` has 0 entities; `DetectTargets` appears 6× but all as single-line stubs.
- Top-1 chunk text preview: `"#ifndef HWY_HAVE_RUNTIME_DISPATCH_LINUX..."` — macro block, not a function.

---

### CPP-002 — PARTIAL — FunctionCache struct not extracted; ChooseAndCall member surfaced instead
**Query:** "how does highway select the best available SIMD target on first call and update the dispatch table"
**Expected:** `hwy/highway.h` [struct: FunctionCache]
**Got top-1:** `hwy/highway.h:390` [function: ChooseAndCall] score=0.457
**Top-20 ranking of gold:** MISSING (FunctionCache as struct not in top-20)
**Diagnosis:** File match succeeds (PARTIAL) but symbol fails. The `FunctionCache` struct definition is split across two chunks: L369–390 ends with `struct FunctionCache` (the declaration line, stored with `name=null`) and L390–442 starts with `{` (the body, also `name=null`). `ChooseAndCall` is the first named entity inside `FunctionCache` and appears in code-graph.db at L403. Because the outer struct has no name in the index, the ranker cannot identify `FunctionCache`; it surfaces the inner member instead.
**Evidence:**
- `codebase.db`: L369–390 text ends `"struct FunctionCache"`, name=null. L390–442 text starts `"{ public: typedef RetType..."`, name=null.
- `code-graph.db`: `FunctionCache` — 0 entries. `ChooseAndCall` — present at L403 as `[function]`.

---

### CPP-003 — FAIL — ChosenTarget struct body split across a macro chunk boundary
**Query:** "how does highway track which SIMD target was chosen and return the index into the dispatch table"
**Expected:** `hwy/targets.h` [struct: ChosenTarget]
**Got top-1:** `hwy/highway.h:617` [code: null] score=0.512
**Top-20 ranking of gold:** MISSING (gold file not in top-20 for this specific chunk)
**Diagnosis:** `ChosenTarget` struct definition at `targets.h:341` is inside chunk L311–348 (`[code] name=null`). The preceding 30 lines of that chunk are a `#define HWY_CHOOSE_TARGET_LIST(func_name)` macro expansion with `nullptr` entries — semantic noise that dilutes the embedding. The struct definition header itself (`struct ChosenTarget {`) sits at line 341 inside this macro-heavy chunk, but the member functions (`Update`, `GetIndex`, `DeInit`) flow into the next chunk L351–388. The query's `GetIndex` and `dispatch table` tokens appear in L351–388, but `highway.h:617` (which contains `GetChosenTarget()` call sites and commentary about dispatch) outscores both chunks.
**Evidence:**
- `codebase.db`: L311–348 text: `"nullptr, /* reserved */ ... struct ChosenTarget {"` — macro preamble dominates.
- `code-graph.db`: `ChosenTarget` — 0 entries. Inner members `DeInit`, `IsInitialized`, `GetIndex` present as single-line stubs.
- `targets.h` has 0 chunks returned by `file_path LIKE '%/hwy/targets.h'` (LIKE path bug) but 31 chunks under exact match — not a missing-file issue.

---

### CPP-004 — FAIL — Vec using-alias inside a header chunk that lacks the symbol name
**Query:** "Vec type alias that produces the vector type for a given tag descriptor D"
**Expected:** `hwy/ops/generic_ops-inl.h` [using: Vec]
**Got top-1:** `hwy/print.h:31` [struct: TypeInfo] score=0.726
**Top-20 ranking of gold:** MISSING
**Diagnosis:** `using Vec = decltype(Zero(D()));` at `generic_ops-inl.h:48` is inside chunk L1–50 (`[code] name=null`). The chunker split this as a code block; the `using` alias was not promoted to a named symbol. More critically, the chunk's embedding is dominated by the 47-line file preamble (includes, namespace open) rather than the two-line alias. The `TypeInfo` struct from `print.h` wins because it contains `type`, `descriptor`, and `tag` in a compact 8-line struct definition that closely matches the query terms `type alias`, `type`, `tag`, `descriptor`.
**Evidence:**
- `codebase.db`: L1–50 name=null, text ends with `"using Vec = decltype(Zero(D()));"`.
- `code-graph.db`: `Vec` — 0 struct/typeAlias entries anywhere. No `typeAlias` type extracted for this file.
- `hwy/print.h`: only 2 chunks in DB (L1–14, L16–75); results JSON says `startLine=31` which is the graph entity (`TypeInfo` in graph at L33).

---

### CPP-005 — FAIL — Simd template struct body split; no named chunk for the struct
**Query:** "Simd tag struct with Lane type parameter N lanes and kPow2 scaling used to select vector overloads"
**Expected:** `hwy/ops/shared-inl.h` [template_class: Simd]
**Got top-1:** `hwy/base.h:496` [struct: alignas] score=0.566
**Top-20 ranking of gold:** Gold file present at position 10, wrong chunk
**Diagnosis:** `struct Simd` at `shared-inl.h:214` is split: the chunk L177–214 ends just after `struct Simd {` (only the opening brace), and chunk L214–242 starts with `{` body content (name=null). Neither chunk is named `Simd`. The `code-graph.db` has 18 entities for `shared-inl.h` but `Simd` is not among them — the graph parser skipped the template class definition. `hwy/base.h:496` wins because it has a compact `alignas` struct with `Lane` in its context (the `HWY_ALIGNED_STRUCT` macro wrapping).
**Evidence:**
- `codebase.db`: L177–214 name=null (ends at struct open brace), L214–242 name=null (struct body).
- `code-graph.db`: `Simd` — 0 entries. No `template_class` type in graph for this file.
- Gold file appears at rank 10 but is a different chunk (L177–214 at best).

---

### CPP-006 — PARTIAL — AlignedDeleter chunk mis-named as "class"; TypedArrayDeleter wins on symbol
**Query:** "AlignedDeleter RAII class that calls destructor and frees aligned memory on unique_ptr destruction"
**Expected:** `hwy/aligned_allocator.h` [class: AlignedDeleter]
**Got top-1:** `hwy/aligned_allocator.h:73` [code: TypedArrayDeleter] score=0.509
**Top-20 ranking of gold:** MISSING (correct chunk at L73–106 is present but wrong symbol)
**Diagnosis:** File matches (PARTIAL). Chunk L73–106 covers the `AlignedDeleter` class body and its text starts with `"class AlignedDeleter {"`. The chunker set `name="class"` (extracted the keyword, not the identifier) and `type="function"`. The `code-graph.db` has `TypedArrayDeleter` at L87 as a function, and the results metadata surfaces this graph entity. `AlignedDeleter` is absent from both the chunk name and graph entities.
**Evidence:**
- `codebase.db`: L73–106 `[function] name="class"` — keyword extracted instead of class name.
- `code-graph.db`: `AlignedDeleter` — 0 entries; `TypedArrayDeleter` at L87 as function.
- The chunk text begins `"class AlignedDeleter { public: ..."` — the name is in the chunk text but not extracted as metadata.

---

### CPP-007 — FAIL — Cross-target confusion: ppc_vsx Vec128 outranks x86_128 Vec128
**Query:** "Vec128 SSE vector class template with partial specializations for float double and float16"
**Expected:** `hwy/ops/x86_128-inl.h` [template_class: Vec128]
**Got top-1:** `hwy/ops/ppc_vsx-inl.h:120` [code: null] score=0.527
**Top-20 ranking of gold:** MISSING (x86 Vec128 class not extracted as named entity)
**Diagnosis:** Both `ppc_vsx-inl.h` and `x86_128-inl.h` define `class Vec128` with identical structure. In `ppc_vsx-inl.h`, `Vec128` appears at L120 as a clean 20-line chunk (`[code] name=null`). In `x86_128-inl.h`, the `class Vec128` at line 104 is buried inside the mega-chunk L46–121 `[function] name="namespace"` (75 lines starting with `namespace HWY_NAMESPACE { namespace detail {` + 30 lines of macro definitions). The ppc chunk is more compact and scores higher because it is not diluted by 60 lines of macro preamble. Neither architecture's `Vec128` class is a named symbol in `code-graph.db` — the graph only has `Vec128` entries as single-line `[function]` stubs in `arm_neon-inl.h`.
**Evidence:**
- `codebase.db`: x86 Vec128 at L104 is inside `[function] name="namespace" L46-121`; ppc Vec128 at L120 is `[code] name=null L120-140`.
- `code-graph.db`: `Vec128` — 2 entries, both in `arm_neon-inl.h` L813, L816 as functions (not the x86 class).
- Query contains "SSE" but SSE is not a token in the ppc chunk; yet ppc wins because its `Vec128` class text is a clean compact embedding.

---

### CPP-008 — FAIL — macro dominance; x86 DetectTargets not extracted as named entity
**Query:** "DetectTargets x86 implementation reading CPUID flags and returning supported highway target bitmask"
**Expected:** `hwy/targets.cc` [function: DetectTargets] (x86 variant at L302)
**Got top-1:** `hwy/detect_targets.h:903` [macro: HWY_ATTAINABLE_LOONGARCH] score=0.472
**Top-20 ranking of gold:** MISSING
**Diagnosis:** The x86 `DetectTargets()` body at `targets.cc:302–370` is stored as `[function] name=null` (same pattern as CPP-001). `code-graph.db` has the function stub at L302 but with empty `code` field. The query tokens `DetectTargets`, `x86`, `CPUID`, `bitmask` all appear in `detect_targets.h` macro names (`HWY_ATTAINABLE_*`, `HWY_HAVE_*`), which is a 1000-line header of nothing but `#define` blocks. Macro chunks score via BM25F term overlap against query keywords. The x86-specific chunk L302–370 (which reads `FlagsFromCPUID()` and maps to `HWY_AVX2/HWY_AVX3` bitmasks) has the right content but is anonymized.
**Evidence:**
- `codebase.db`: L302–370 `[function] name=null` — DetectTargets function body with no name in metadata.
- `code-graph.db`: `DetectTargets` at L302 as `[function]` but `code=""` (empty body), single-line stub only.
- Top-1 chunk text: macro block with `HWY_ATTAINABLE_LOONGARCH` tokens matching "bitmask"/"targets" in query.

---

## Cluster summary

| Failure mode | Count | Probes |
|---|---|---|
| Symbol extraction failure (null/wrong name in chunk metadata) | 8 | CPP-001..008 (all) |
| Structural split across chunk boundary (definition header in chunk N, body in chunk N+1) | 5 | CPP-002, CPP-003, CPP-004, CPP-005, CPP-008 |
| Macro dominance (detect_targets.h macro tokens outrank impl) | 2 | CPP-001, CPP-008 |
| Cross-target confusion (identical class in wrong arch file wins) | 1 | CPP-007 |
| Keyword-as-name bug (class/namespace/HWY_DLLEXPORT extracted instead of identifier) | 3 | CPP-001, CPP-006, CPP-007 |

---

## Recommended next steps (DO NOT IMPLEMENT)

1. **Fix C++ name extraction for top-level types (highest priority).** The chunker/parser treats `struct ChosenTarget`, `class AlignedDeleter`, `struct FunctionCache`, `template <...> struct Simd` as anonymous chunks. The C++ grammar rule must extract the identifier _after_ `struct`/`class`/`using` as the chunk name — not the keyword or the preceding macro token (`HWY_DLLEXPORT`, `class`, `namespace`). This single fix would give named chunks to CPP-001, CPP-002, CPP-003, CPP-005, CPP-006, CPP-008.

2. **Prevent chunk boundaries from splitting struct/class declarations from their bodies.** The chunker splits `struct FunctionCache` (declaration line) into chunk N and `{ ... }` (body) into chunk N+1. Both get `name=null`. The parser should keep `struct Foo {` together with at least enough of the body to extract the symbol. An AST-aware approach (tree-sitter `class_specifier` or `struct_specifier` node) would solve this cleanly; a heuristic fix is to extend the current chunk forward when the last significant token is `struct <name>` without a closing `}` on the same split.

3. **CPP-007 architecture disambiguation.** Even after fixing name extraction, `ppc_vsx Vec128` and `x86_128 Vec128` will have the same symbol name. The query contains "SSE" — an architecture keyword absent from the ppc chunk. Add an arch-token boost (or penalize cross-architecture matches) gated on `_isAgentFormat`, per the existing format-gate discipline.

4. **Macro chunk demotion for detect_targets.h.** The `detect_targets.h` header is purely `#define` macros. These chunks should be demoted for NL queries that are not explicitly asking about macro values/names. An anomalous-chunk check (high macro density, no function bodies) gated on `_isAgentFormat` would fix CPP-001 and CPP-008.

# ss-find — Deep Diagnosis of Remaining 30 Dev Failures (v3/v5 baseline)

**Date**: 2026-05-13
**Audit basis**: `dev-failures-v3.jsonl` (= v5; both 59/16/14 — fall-through F2 didn't move the needle)
**Methodology**: read every dev failure end-to-end (regex + query + cc.lines + top1.lines + expected file/symbol/type), cross-reference against `code-graph.db` entities to determine whether the chunker emitted the right unit at all, and bucket by root cause.

This is a *diagnosis-only* pass — no code changes. Purpose: build the next iteration's priority list and risk profile.

---

## TL;DR

| Category | Count | % of remaining | Root cause | Fix surface |
|---|---:|---:|---|---|
| A — Chunker over-merge / sibling-merge | 11 | 37% | cAST collapses small entities; lua/python sentinel `end_line=999`; namespace/class as single chunk | **Chunker** (requires reindex) |
| B — Presentation re-labelling miss | 3 | 10% | Right chunk picked, wrong sibling labelled. F9 either gated off or not winning over primary | **Runtime** (context-expander.js + F9 widening) |
| C1 — Header vs impl disambiguation | 2 | 7% | `.h` vs `.c`/`.cc` ambiguity in C-family; query intent under-specified | **Runtime + intent classifier** |
| C2 — Same symbol in multiple files | 5 | 17% | `Request` / `command` / `__construct` / `WaitForCommitAsync` exist in 2+ files; no signal in regex/query to pick the right one | **Runtime (ref-count + page-rank already exist but underweighted) OR query expansion** |
| C3 — Test files outrank impl | 1 | 3% | `test.c` bare filename at repo root not caught by `TESTS_RE` | **Runtime (widen `TESTS_RE`)** |
| C4 — Wrong impl file ranked first | 5 | 17% | Multiple plausible files, bi-encoder picks the wrong one based on embedding similarity | **Hard — needs better encoder OR PageRank-style file importance** |
| D — Same-file ranker miss | 2 | 7% | Right file, right chunker output, but MaxSim ranks the wrong chunk within the file | **Runtime ranker tweak OR encoder upgrade** |
| ZG-001/4 (counted in C2) | (2) | — | 5 files have `Request` entity, all are different sizes | **Same as C2** |

**The single biggest lever**: Category A (37% of remaining failures). All of Mode F1/F2 and most cross-file selection problems flow from chunker decomposition. Fix the chunker → many cascading failures resolve at once.

---

## Per-failure breakdown

### A. Chunker over-merge (11 / 30 = 37%)

For each: confirmed via `code-graph.db` that the *correct* entity exists as a separate code-graph entity, but the chunker emitted a chunk that **contains the entity** along with N siblings, labelling the chunk with the FIRST sibling.

| Gold | Lang | Expected entity (code-graph lines) | Chunker emitted (LI chunk lines) | Sibling count in chunk |
|---|---|---|---|---:|
| CPP-003 | cpp | `ChosenTarget` struct (≈166-207) | `hwy` namespace (36-381) | ~15 |
| CPP-006 | cpp | `AlignedDeleter` class (73-117) | `hwy` namespace (35-468) | ~10 |
| CS-001 | csharp | `NetworkSET` method (279-340) | `BasicCommands` class (179-340) | ~5 |
| CS-002 | csharp | `RespServerSession` class header (45-57) | merged with `LatencyMetrics` (46-120) | 2+ |
| CS-005 | csharp | `LoaderBlockCache` record (12-27) | `LuaRunner` partial-class (15-518) | ~10 |
| JV-001 | java | `serializeNulls` method (247-274) | `GsonBuilder` class (92-1076) | ~40 |
| JV-002 | java | `get` method (91-102) | `ConstructorConstructor` class (45-465) | ~12 |
| JV-004 | java | `getType` method (166-168) | `TypeToken` class (54-452) | ~26 |
| JV-005 | java | `registerTypeAdapter` (738-780) | `GsonBuilder` class (92-1076) | ~40 |
| LU-003 | lua | `tablex.deepcopy` (118-120) | `cycle_aware_copy` (98-**999**) | sentinel! |
| LU-004 | lua | `List` class (122-129? — or first method) | `List.range` (261-567) — nested | varies |

**Sub-pattern A1 — Tree-sitter `end_line` sentinel (Lua, possibly Python)**:
Tree-sitter-lua's `function tablex.deepcopy(t) ... end` apparently returns `end_line=999` (or a similarly-bogus large value) when its end-marker detection fails. The chunker treats this as a 900-line chunk starting at 98, swallowing the `tablex.deepcopy` function and ~20 sibling functions. Confirmed by inspecting `dev-failures-v3.jsonl`: LU-003 top-1 has `lines=98-999`.

**Fix path**: In `core/indexing/ast-chunker.js` (or wherever tree-sitter output is consumed), clamp `end_line` to `min(end_line, file_line_count, next_sibling.start_line - 1)`. Requires reindex of all Lua repos (small — 1927 docs in the bench).

**Sub-pattern A2 — cAST sibling-merge collapses OO classes**:
The cAST sibling-merge policy (PHASE6_REDO §1) deliberately merges adjacent small functions into one chunk. For Java/C# this collapses the whole class into one chunk because every method is "adjacent" to the next. The chunk is then labelled with the first method's name (or the class name if structurally captured).

**LightOn colgrep does the opposite**: tree-sitter parses into "functions, methods, classes, constants" as *discrete units* — each gets its own embedding. A 50-method Java class → 50 chunks. This avoids the sibling-merge problem entirely.

**Trade-off**:
- LightOn: more chunks, bigger index, finer-grained candidates
- cAST: fewer chunks, smaller index, but mega-chunk problem for OO

**Fix path options** (all require reindex):
- A2a (LightOn-style): emit per-entity chunks for entities ≥ N lines (N=15-30); siblings smaller than N stay merged. Hybrid keeps cAST efficiency for small functions while decomposing large classes.
- A2b: keep cAST but tighten the size cap (`SWEET_SEARCH_MEGA_ENVELOPE_MAX`) so class chunks > X lines auto-decompose.
- A2c: detect "class with N methods" in the chunker post-pass and force a sub-chunk emission per method.

**Sub-pattern A3 — C++ namespace as one chunk**:
CPP-003 and CPP-006 have the whole `namespace hwy { ... }` block as one chunk (lines 36-381 or 35-468). This is the same as A2 but at the namespace level instead of class level.

**Fix path**: treat `namespace` boundaries as *transparent* — don't include them in the entity tree for chunking purposes. The inner classes/structs/functions become the chunkable units.

---

### B. Presentation re-labelling miss (3 / 30 = 10%)

For each: the chunker emitted a chunk whose range CONTAINS the expected symbol, but the chunk's `name` is a sibling. The top-1 file/lines are correct; only the symbol label is wrong → PARTIAL verdict.

| Gold | File | Chunk lines | Expected sym | Top-1 sym | Issue |
|---|---|---|---|---|---|
| C-002 | hiredis.c | 815-832 | redisConnectWithOptions | redisContext | C/cpp not in F9's JS/TS-only gate |
| TS-008 | lib/ai/prompts.ts | 47-104 | systemPrompt | regularPrompt | F9 should fire — investigate why it doesn't |
| TSL-001 | packages/zod/src/v4/core/parse.ts | 51-101 | safeParse | parseAsync | Same as TS-008 |

**F9 status check needed**: TS-008/TSL-001 are inside F9's JS/TS gate, the query contains the expected symbol as a strict-identifier mention (`systemPrompt`, `safeParse`), and `metadata.additional_symbols` should contain the sibling — yet F9 didn't relabel. Suspects:
- F9 `primaryMatch` (`regularPrompt` against query) already tied with `systemPrompt` → tie-keeps-primary rule rejects relabel.
- `additional_symbols` not populated by the chunker for these specific files.
- F9's strict-identifier filter rejects the sibling.

**Fix path** (no reindex needed, runtime only):
- Verify F9 fires by adding a debug log
- If `additional_symbols` is missing, the chunker isn't emitting them for these files (chunker bug — requires reindex)
- Widen F9 from JS/TS-only to C/cpp for C-002 (well-validated TypeScript launch, then expand)

---

### C. Cross-file selection (13 / 30 = 43%)

#### C1 — Header vs implementation ambiguity (2 cases)
| Gold | Expected | Top-1 |
|---|---|---|
| C-004 | hiredis.h `struct redisReply` | hiredis.c `timeval` |
| CPP-008 | hwy/targets.cc `DetectTargets` (def) | hwy/targets.h `hwy` (decl) |

In C-family, structs live in `.h`, implementations in `.c`/`.cc`. The query "Find redisReply struct definition" should prefer `.h`, "Show DetectTargets for x86" should prefer `.cc`. The bi-encoder doesn't make this distinction.

**Fix path**: extend `classifyFileKindIntent` to recognise "struct definition" / "type definition" patterns and weight `.h` chunks higher; "implementation" / "show how X does Y" patterns weight `.c`/`.cc` higher. Pure runtime change.

#### C2 — Same symbol in multiple files (5 cases)
| Gold | Symbol | Files containing it (code-graph) |
|---|---|---|
| CS-003 | WaitForCommitAsync | `StoreApi.cs:14-76`, `StoreWrapper.cs:479-528` |
| PHP-008 | __construct | every PHP class (~100 occurrences) |
| PY-004 | command | `decorators.py:100-165`, `core.py:1668-1715` |
| ZG-001 | Request | `request.zig:22-576` (the actual struct), `config.zig:72-81` (const), `httpz.zig:15-38` (const), `router.zig:5-20` (const), `worker.zig:10-336` (const) |
| ZG-004 | Request | same as ZG-001 |

This is the *hardest* category. The query doesn't specify which file. The current ranker has signals that could help but underweight them:

1. **Entity size**: `request.zig:22-576` is 554 lines — clearly the canonical struct. `config.zig:72-81` is 9 lines (probably a typedef/alias). Boosting LARGER entities for "struct definition" queries could help. (We have a mega-entity *penalty*, not a quality-favouring largeness boost.)
2. **page_rank**: code-graph already stores `entities.page_rank`. Not currently used in ranking. Files imported by many others should win for ambiguous queries.
3. **Reference count**: existing `referenceCountBoost` exists but is mild.

**Fix path**: light entity-quality boost when symbol has multiple matches across files — prefer the entity with highest page_rank or largest body (heuristic: "definition" vs "reference").

#### C3 — Test file outranks impl (1 case)
| Gold | Expected | Top-1 |
|---|---|---|
| C-005 | hiredis.c | **test.c** (bare filename at repo root) |

`TESTS_RE` doesn't catch `test.c` at the repo root because the pattern requires `tests/` dir or `*.test.*` / `*_test.*` suffixes. The hiredis repo names its test file `test.c` literally.

**Fix path**: widen `TESTS_RE` to catch `(?:^|/)test\.[a-z0-9]+$`. Risk: matches legitimate `test.json` (test fixture) or `test.html`. Could gate on directory: only at repo root + only common code extensions (`.c`, `.cpp`, `.py`, `.js`, `.ts`).

#### C4 — Wrong impl file ranked (5 cases)
| Gold | Expected | Top-1 | Note |
|---|---|---|---|
| GO-003 | mux.go `Use` | middleware/route_headers.go `RouteHeaders` | Different middleware concept |
| GO-006 | chi.go `NewRouter` | mux.go `With` | Both are router files |
| KT-004 | Builders.common.kt `launch` | jvm/.../Actor.kt `actor` | Both about coroutines |
| RB-002 | lib/sinatra/base.rb `Request` | sinatra-contrib/.../respond_with.rb `Sinatra` | Contrib vs core |
| RB-006 | lib/sinatra/base.rb `Helpers` | rack-protection/.../protection.rb `Rack` | Plugin vs core |
| SC-004 | requests/src/requests/Model.scala `Response` | requests/src/requests/Exceptions.scala `RequestFailedException` | Wrong class, same package |

**Hardest category**. The bi-encoder genuinely prefers the top-1 because its content matches the query more closely on token-level semantics. Examples:
- GO-003 query "show how to Use middleware" — `middleware/route_headers.go` is literally middleware code; mux.go's `Use` is a generic API call.
- RB-002 query "Find Request accept methods" — `respond_with.rb` is about responses (accept headers); base.rb's `Request` is more abstract.

The gold is the *canonical* definition the agent should find, but the bi-encoder picks the most lexically/semantically *relevant* result. These two notions diverge.

**Fix path options**:
- **Encoder upgrade**: CodeSage-Small-v2 (130M, +5pp CoIR per `project_encoder_upgrade_scoping.md`) is the candidate. Higher capacity encoder may resolve more nuance.
- **PageRank-weighted ranking**: prefer files that are imported by many others (canonical libs over plugins).
- **Library-root preference**: files at `lib/*` or `src/*` over `*-contrib/`, `extensions/`, `plugins/`.

---

### D. Same-file ranker miss (2 cases)

| Gold | File | Expected chunk | Top-1 chunk | Issue |
|---|---|---|---|---|
| DR-008 | base_response.dart | `extension HeadersWithSplitValues` (15-64 per cc) | `BaseResponseWithUrl` (118-171) | Different region — extension chunk may not exist |
| PY-002 | src/click/core.py | `Context` class (185-282) | `make_context` (1210-1245) | Both exist as chunks |

**PY-002 is a legitimate ranker miss**: both chunks exist independently, but make_context's body has "make a Context with parent obj and meta dict" — which lexically matches the query nearly verbatim. The Context class header chunk has more abstract docstring language. Identifier-mention boost should help (chunk `name='Context'` matches query mention `Context`), but the boost is multiplicative on score — if make_context's base score is sufficiently higher, ×1.15 isn't enough to flip.

**Fix path**: increase identifier-mention boost factor when the matched mention is the *only* strict-identifier mention in the query AND it equals the chunk's full name (currently ×1.15; trial ×1.30 like symbolExactMatchBoost). Format-gated; validate against post-perf-60 + GCSN.

**DR-008** likely overlaps Category A (`extension HeadersWithSplitValues` not its own chunk). Need to query dart code-graph to confirm.

---

## LightOn ColGREP — what's worth borrowing

Architecture differences against sweet-search:

| Dimension | sweet-search current | LightOn ColGREP | Implication for us |
|---|---|---|---|
| Chunking | cAST sibling-merge | **per-entity (function/method/class)** | Their approach side-steps Category A entirely |
| Per-chunk metadata | `name`, `line_start`, `line_end`, optional `additional_symbols` | structured: signature + params + callees + docstring + code | We could enrich `searchText` more for the bi-encoder |
| Late interaction model | LateOn-Code-edge (80.63% MRR per `project_lateon_code_edge_native.md`) | **same model** — LateOn-Code-edge | Encoder parity. Our 86.92% GCSN uses CodeRankEmbed; their MRR claim is different bench |
| Hybrid | regex → MaxSim (ss-find) or HNSW → MaxSim (ss-search) | regex/FTS5-trigram → **RRF α=0.75 favouring semantic** | We don't RRF on ss-find at all; RRF could help cross-file disambiguation |
| File-path normalisation | path tokens extracted for boost | snake_case/CamelCase split into spaces, separators → spaces | Same idea; ours fires on path-token boost |
| Test demotion | factor 0.35 (we have it) | "Demote test functions unless query mentions test" | Parity — but our `TESTS_RE` misses `test.c` |
| Quantisation | int8/int4 (turboquant) | "Product quantization 2-4 bit" | Parity |

**Two takeaways from ColGREP worth pursuing**:

### (i) Per-entity chunking — biggest architectural lever
Their explicit choice to chunk per-function rather than sibling-merge is the architectural answer to Category A. Implementing requires:
- New chunker mode flag (e.g. `SWEET_SEARCH_CHUNK_MODE=per_entity` alongside `cast`)
- Reindex all repos (~30-90 min depending on repo)
- Re-validate GCSN (CodeRankEmbed handles smaller chunks well; should be ≥ current)
- Re-validate retrieval-probes (likely some regressions — small chunks lose context)

This is a multi-week project but it's the *only* fix that addresses Categories A + much of B + parts of D.

### (ii) Per-chunk structured text (signature + callees + docstring)
LightOn enriches each chunk's `searchText` with: signature, parameter names, callees (call graph), docstring, code body. The bi-encoder embeds this richer text → better semantic match for "find redisConnectWithOptions function" (signature is in searchText, not just code).

We already store `signature`, `doc_comment`, `summary` in the `entities` table. We could enrich the LI document's text to include these alongside the code. This is a **partial reindex** (LI documents only, not full code-graph). Probably a 1-2 day project.

---

## Recommended priority (no implementation, decision-only)

| Priority | Fix | Failures addressed | Effort | Risk | Reindex? |
|---:|---|---:|---|---|---|
| **P0** | Lua tree-sitter `end_line` sentinel clamp | 2 (LU-003, LU-004) | 1 day | Low | Yes (lua only) |
| **P0** | Widen F9 to C/cpp for sibling-merge re-labelling | 1 (C-002) + future | 1 day | Low | No |
| **P1** | Investigate why F9 doesn't fire for TS-008/TSL-001 | 2 | 1 day | Low | Maybe (if `additional_symbols` missing) |
| **P1** | Widen `TESTS_RE` for bare `test.c` patterns | 1 (C-005) | 2 hours | Low | No |
| **P1** | Header/impl intent classifier (C-family) | 2 (C-004, CPP-008) | 1 day | Med | No |
| **P2** | Identifier-mention boost ×1.30 for unique strict-identifier queries | 1-2 (PY-002, others) | 2 hours | Low (format-gated) | No |
| **P2** | C++ namespace as transparent boundary in chunker | 2 (CPP-003, CPP-006) | 2 days | Low | Yes (cpp only) |
| **P3** | Per-entity chunking mode (LightOn-style) for OO classes | 7 (JV-001/2/4/5, CS-001/2/5) | 2 weeks | Med-High | **Yes, all repos** |
| **P3** | PageRank-weighted ranking for same-symbol-in-multi-file cases | 5 (CS-003, PHP-008, PY-004, ZG-001/4) | 1 week | Med | No |
| **P3** | LI document searchText enrichment (signature + docstring) | indirect benefit on Category D | 3 days | Med | Yes (LI only) |
| **P4** | Encoder upgrade to CodeSage-Small-v2 | indirect benefit on Category C4 | 2 weeks | High | Yes, all repos |

P0/P1 = quick wins, low risk, ~3-5 cases recoverable.
P2 = medium effort, addresses ~4 more cases.
P3 = the chunker rewrite that addresses Category A wholesale (~9-10 cases).
P4 = encoder upgrade for Category C4 (~5 cases) — the hardest category.

---

## CORRECTION 2026-05-13 (post user pushback)

User pushed back on two points after the initial report. Both correct:

### 1. cAST is SOTA — don't replace it

The "per-entity chunking like LightOn" framing was lazy. Per-entity chunking is the WRONG fix for our problem because:
- cAST (arXiv 2506.15655) is 2026 SOTA and our 86.92% GCSN MRR is achieved on it
- Per-entity chunks (3-line getters as standalone chunks) produce noisy embeddings — MaxSim quality drops
- LightOn chose per-entity because their 17M-param model has weak per-chunk capacity (compensate with more chunks) AND because their primary use case is "agent knows the symbol, find it"
- We optimize for NL→code retrieval where sibling-merge wins

### 2. We already have rich per-chunk metadata enrichment

Confirmed at `core/indexing/ast-chunker.js:1040-1066`. Every LI chunk's text includes: Scope chain, Parent symbol, Defines, **Additional siblings (`# Additional: ...`)**, Uses (imports), Signature (per-language), Language tag, then code body. This is structurally equivalent to LightOn's "signature + parameter names + callees + docstring + code body". The "1-2 day project to enrich LI text" was wrong — already done.

### What the real Category A diagnosis is

**`metadata.additional_symbols` already contains the merged siblings**. For JV-004 chunk 121-168, `additional_symbols = ["getRawType", "getType"]`. The chunker is correct.

**F9 (`findAdditionalSymbolRelabel`) already implements the right re-attribution logic**: when the query mentions a sibling strictly, promote it to the chunk's primary label. Located at lines 1093-1153.

**F9 has a `isJsTsResult` gate at line 1094**: it only fires for JS/TS/TSX/JSX. The header comment (lines 974-977) explicitly calls this "pilot scope":
> Pilot scope: JS/TS/TSX/JSX only. The mechanism generalizes to every language but per-language gating limits the validation surface for the pilot. On JS/TS with zero regressions on JS/TS + GCSN.

**So Category A's Java/C#/C-family/Lua cases are NOT chunker bugs — they're F9-pilot-not-widened cases**. The runtime fix exists; it just isn't enabled for those languages.

### Revised priority (much cheaper than the original report)

| Fix | Cases | Effort | Risk | Reindex |
|---|---:|---|---|---|
| **Widen F9 from JS/TS-only to all languages** | ~8 (JV-001/2/4/5, CS-001/2/5, C-002, partial Lua) | 1 hr code + validation | Low-Med | No |
| Lua tree-sitter `end_line=999` clamp | 2 (LU-003, LU-004) | 1 day | Low | Yes (lua only, minutes) |
| C++ namespace as transparent boundary | 2 (CPP-003, CPP-006) | 2 days | Low | Yes (cpp only) |
| Widen `TESTS_RE` for bare `test.c` | 1 (C-005) | 30 min | Low | No |
| C-family header/impl intent classifier | 2 (C-004, CPP-008) | 1 day | Med | No |
| Identifier-mention boost ×1.30 | maybe PY-002 | 30 min | Low | No |

**Combined low-risk lift: ~12-15 of the 30 remaining failures recoverable** without touching the chunker. The chunker isn't broken; we just need to extend mechanisms that already exist.

### Categories that DO still need encoder/PageRank/chunker work

- C2 (same symbol in N files: ZG-001/4, PHP-008, etc.) — needs page_rank or entity-size signal in ranking
- C4 (wrong impl file: GO-003/6, KT-004, RB-002/6, SC-004) — likely encoder-bound. CodeSage-Small-v2 upgrade is the path.
- D (PY-002 Context vs make_context) — identifier-mention boost ×1.30 may suffice; if not, encoder-bound

These are real chunker-independent failures that won't yield to the runtime mechanisms.

---

## Honest limits of this diagnosis

- **No held-out inspection**: per CLAUDE.md, held-out is aggregate-only at milestones. The held-out failure distribution may differ from dev; my P0-P4 priorities are dev-biased.
- **Single dev sweep cell**: I only analysed R2|Q3 (default) and R3|Q4 (JS-mobile override). Other (R, Q) cells may have different failure profiles.
- **No real-world traffic**: dev golds are AST-tester probes, NOT real agent queries. The Category C4 "wrong impl file" verdict assumes the gold-chosen file is the right canonical answer; in real traffic the bi-encoder's pick may actually be more useful.
- **Chunker rewrite (P3) is speculative**: I haven't measured whether per-entity chunking would actually improve GCSN. It might hurt — smaller chunks lose context. Needs an A/B sweep before committing.
- **The 30 dev failures are n=30**: small sample. Categories with 2-3 cases (C1, C3, D) are anecdotal. Patterns are real but counts are noisy.

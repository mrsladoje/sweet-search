# Kotlin Probe Failure Diagnostics — 2026-05-10

**Overall**: 2 PASS / 4 PARTIAL / 2 FAIL (KT-002 withContext, KT-006 suspendCancellableCoroutine pass)

---

## Failure cluster table

| ID | Verdict | Root cause cluster | Gold type label | Chunker type label | Symbol extracted? |
|---|---|---|---|---|---|
| KT-001 | PARTIAL (symbol_mismatch) | Open class not anchored as class chunk | `class` | No chunk with `JobSupport` name | No |
| KT-003 | FAIL (file_mismatch) | Cross-language confusion + BM25 term dominance | `function` | `function` (correct) | Yes |
| KT-004 | PARTIAL (symbol_mismatch) | KDoc mega-chunk swallows declaration | `extension_function` | `function` (correct if matched) | Yes — but wrong chunk returned |
| KT-005 | PARTIAL (type_mismatch) | Chunker has no `extension_function` type | `extension_function` | `function` | Yes |
| KT-007 | FAIL (file_mismatch) | Adjacent-builder over-ranking | `extension_function` | `function` | Yes — but wrong file |
| KT-008 | PARTIAL (type_mismatch) | Chunker has no `sealed` type | `sealed` | `class` | Yes |

---

## Per-probe detail

### KT-001 — JobSupport class (PARTIAL: symbol_mismatch)

**Gold**: `JobSupport.kt :: JobSupport :: class`
**Top-1 returned**: `JobSupport.kt:666-669 :: parentCancelled :: function`

**Root cause**: The `JobSupport` open class declaration (line 24) was split by the chunker into three micro-chunks:
- lines 1–22: `code` (file header, imports)
- lines 23–24: `code` (the `@Deprecated` annotation line + class declaration — **no symbol extracted**)
- lines 24–25: `code` (overlapping boundary artifact)
- lines 27–122: `code` (the class body comment block — no symbol)

The chunker never produced a chunk tagged `name=JobSupport, type=class`. The first named function inside the class (`initParentJob`, lines 124–179) is the earliest named chunk. The query "coroutine job cancelled propagate cancellation children" scores highest on `parentCancelled` (a cancellation-related method name at lines 666–669) instead of the class declaration. No class-level anchor exists for the ranker to promote.

**Why the open class fails**: The `@Deprecated(level = DeprecationLevel.ERROR)` annotation on line 23 immediately precedes `public open class JobSupport` on line 24. The parser apparently treats the annotation+declaration as a one-line syntactic unit (lines 23–24) but does not extract it as a named class node. This is an annotation-decorated open class — parsers anchoring on `class` keyword without lookahead over decorators can miss this.

---

### KT-003 — runBlocking JVM impl (FAIL: file_mismatch)

**Gold**: `kotlinx-coroutines-core/jvm/src/Builders.kt :: runBlocking :: function`
**Top-1 returned**: `integration-testing/src/javaConsumersTest/java/RunBlockingJavaTest.java:1-21 :: RunBlockingJavaTest :: class`
**Score gap**: Java chunk scored 0.5661 vs Kotlin chunk (not in top-1; relative score unknown)

**Root cause**: Three compounding factors:

1. **Term density**: The Java test class has the string `"RunBlocking"` in its class name, method name (`testRunBlocking`), and the comment `"runBlocking doesn't declare @Throws"`. The Kotlin impl (`jvm/src/Builders.kt`) only has `runBlocking` once in the function name at line 20 and once in a reference at line 22. The Java file has 3× higher term frequency for the exact query token.

2. **Single-chunk penalty avoidance**: The Java test file is indexed as a single 21-line chunk (the whole file), giving it a dense, focused vector. The Kotlin impl is split into 2 chunks (lines 1–31 for `runBlocking` function, lines 33–71 for `BlockingCoroutine`). Neither chunk contains the word "runBlocking" densely in the body (it's a thin wrapper that delegates to `runBlockingImpl`).

3. **No format-gate / language penalty**: The ranking pipeline does not appear to apply a cross-language penalty when the query has strong `.kt` language signals ("coroutine", "coroutines inside complete"). The Java file ranks entirely on BM25-style term match.

**The Kotlin chunk exists** (lines 1–31, `name=runBlocking, type=function`). This is a ranking/scoring issue, not a chunker issue.

---

### KT-004 — launch extension function (PARTIAL: symbol_mismatch)

**Gold**: `Builders.common.kt :: launch :: extension_function`
**Top-1 returned**: `Builders.common.kt:19-199 :: null :: code`

**Root cause**: The `launch` function declaration starts at line 200. Lines 19–199 are a massive KDoc comment block (181 lines of documentation for `launch` including embedded code examples). The chunker created a separate `code` chunk for this KDoc block (lines 19–199) and only a small function-body chunk for the declaration itself (lines 200–213).

The ranker returned the KDoc mega-chunk (19–199) as top-1 — this chunk contains all the descriptive language ("Launches a new child coroutine", "CoroutineScope", "structured concurrency", etc.) that matches the NL query, while the actual declaration chunk (200–213) contains mostly parameter names and the function body. The KDoc chunk wins on semantic similarity despite having `name=null, type=code`.

**Symbol type note**: The actual declaration chunk has `name=launch, type=function` — not `extension_function`. So even if the declaration chunk ranked #1, it would still produce a `type_mismatch`. Both issues coexist.

---

### KT-005 — cancelAndJoin extension function (PARTIAL: type_mismatch)

**Gold**: `Job.kt :: cancelAndJoin :: extension_function`
**Top-1 returned**: `Job.kt:495-537 :: cancelAndJoin :: function`

**Root cause**: The chunker's type vocabulary does not include `extension_function`. The declaration `public suspend fun Job.cancelAndJoin()` is correctly identified and chunked (lines 495–537, with the preceding KDoc), symbol name extracted correctly, but tagged as `type=function` not `extension_function`. The chunker applies a flat `function` type regardless of whether the receiver is a type extension.

**This is a false-failure**: File and symbol are correct. The gold label `extension_function` is a richer type annotation that the chunker does not currently produce for any function. Grading rule strictly requires type match; the failure reflects a vocabulary gap, not a retrieval error.

---

### KT-007 — produce trailing-lambda builder (FAIL: file_mismatch)

**Gold**: `channels/Produce.kt :: produce :: extension_function`
**Top-1 returned**: `flow/Builders.kt:195-240 :: channelFlow :: function`
**Score gap**: channelFlow scored 0.4661

**Root cause**: Adjacent-builder over-ranking. The query "produce coroutine builder with trailing lambda that sends values into a channel" matches `channelFlow` nearly as well as `produce` because:
- `channelFlow` also produces values into a channel
- Both are coroutine builders with trailing lambda
- `flow/Builders.kt` contains the word "channel" in the channelFlow documentation body

The `produce` chunks in `channels/Produce.kt` are indexed as:
- lines 296–327: `name=produce, type=function` (ExperimentalCoroutinesApi overload)
- lines 328–358: `name=produce, type=function` (InternalCoroutinesApi overload)

But neither type is `extension_function`. More importantly, the huge KDoc block (lines 73–295) that describes `produce` has `name=null, type=code` — 223 lines of documentation that are not anchored to the symbol name. The ranker may be finding the KDoc doc-block for `channelFlow` in `flow/Builders.kt` (which also contains "channel" and "values") as equally relevant.

**The gold chunk exists** (lines 296–327). This is a ranking/scoring issue — the query needs a tighter "channels/" path signal.

---

### KT-008 — SelectClause sealed interface (PARTIAL: type_mismatch)

**Gold**: `selects/Select.kt :: SelectClause :: sealed`
**Top-1 returned**: `selects/Select.kt:114-147 :: SelectClause :: class`

**Root cause**: The chunker's type vocabulary does not include `sealed` as a distinct type label. The declaration `public sealed interface SelectClause` is chunked correctly (lines 114–147, name=`SelectClause`), but tagged as `type=class` rather than `sealed`. Kotlin sealed interfaces are likely handled by the same extractor branch as regular classes/interfaces, with no special case for the `sealed` modifier.

**This is a false-failure**: File and symbol are exact matches. The grading test for `type=sealed` fails because `sealed` is not in the chunker's emitted vocabulary. Like KT-005, this reflects a gold label that is stricter than what the chunker currently produces.

---

## Root cause clusters (summary)

| Cluster | Probes | Impact |
|---|---|---|
| **Type vocabulary gap** — chunker emits `function`/`class` but not `extension_function`/`sealed` | KT-005, KT-008 | 2 PARTIAL → would PASS with richer type labels |
| **KDoc mega-chunk over-ranks declaration** — 181-line KDoc block beats 14-line declaration chunk | KT-004 | 1 PARTIAL (also has type gap) |
| **Class anchor failure** — annotation-decorated `open class` not extracted as named class chunk | KT-001 | 1 PARTIAL (ranker finds a function in the right file) |
| **Cross-language BM25 dominance** — Java test file beats .kt impl on term frequency | KT-003 | 1 FAIL |
| **Adjacent-builder over-ranking** — `channelFlow` beats `produce`; huge KDoc not anchored | KT-007 | 1 FAIL |

---

## Top recommendations (diagnosis only — no changes)

### 1. Gold label audit: `extension_function` and `sealed` types (KT-005, KT-008)

Both KT-005 and KT-008 are **false-failures** in the current probe framework. The gold files, symbols, and line ranges are all retrieved correctly at rank 1. The failure is purely a type-label mismatch between what the gold JSON specifies (`extension_function`, `sealed`) and what the chunker emits (`function`, `class`). Before fixing the chunker, decide whether these are (a) "aspirational" gold labels documenting desired future behavior, or (b) gold mistakes that should be downgraded to `*AnyOf: [function, extension_function]` / `[class, sealed]`. If the intent is to track chunker type enrichment, mark them explicitly as aspirational in the notes field rather than counting them as hard failures.

### 2. Language filter / cross-language penalty for KT-003 (most actionable ranking fix)

The Java test file `RunBlockingJavaTest.java` should never outrank the Kotlin impl for a Kotlin-language query about "coroutines". The index has the query language available (the repo is 98% Kotlin). A simple per-file language weight — even a BM25-style 0.85× penalty on `.java` files when the corpus is primarily `.kt` and the query contains Kotlin-specific terms (`coroutine`, `suspend`) — would demote the Java test chunk. This must be **format-gated** per project policy if using structural signals to implement it. The Kotlin impl chunk (`runBlocking`, `function`, lines 1–31) does exist and scores just below the Java chunk; a small penalty is sufficient to flip the ranking.

### 3. KDoc/declaration chunk splitting strategy for KT-001, KT-004, KT-007

Three of the six failures involve a misalignment between long KDoc comment blocks (which carry semantic content) and the short declaration chunks below them (which carry the symbol name). For KT-004, the 181-line KDoc for `launch` beats the 14-line body chunk at rank 1. For KT-001, the 96-line class-body comment block is a separate `code` chunk from the class declaration. For KT-007, the 223-line KDoc for `produce` is not anchored to the symbol name.

The core issue: the ranker rewards the chunk with the most query-relevant prose, which is usually the KDoc. But grading requires the chunk with the correct symbol name. Options to investigate: (a) merge KDoc + declaration into a single named chunk (changes chunker boundary logic), (b) promote the nearest named sibling when a `code`-type chunk ranks above a named sibling in the same file (post-processing step), (c) store the KDoc text as part of the symbol-anchored chunk's indexed text. Option (b) is the least invasive.

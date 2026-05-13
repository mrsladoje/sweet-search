# ss-find Stage 3 — Failure Mode Taxonomy (DEV only, n=89)

**Source**: track-a-phase6-redo-ss-find-v1.jsonl filtered to the shipped winning strategies (R5|Q3 default, R3|Q4 for JS-mobile). Per-language failure counts in `dev-per-language.json`; per-row evidence in `dev-failures.jsonl`.

**Headline**: ~32% of dev failures are **sweep-time instrumentation artifacts**, not tool-ceiling problems. Fixing them re-baselines R5/R3 cells before any tool-level work begins.

---

## Dev aggregate

| Family | n | PASS | PARTIAL | FAIL | sym@1 | file@1 |
|---|---:|---:|---:|---:|---:|---:|
| C-family | 15 | 7 | 4 | 4 | 0.467 | 0.733 |
| OO-monolithic | 20 | 11 | 3 | 6 | 0.550 | 0.700 |
| JS-mobile | 19 | 13 | 2 | 4 | 0.684 | 0.789 |
| Scripting-dynamic | 25 | 18 | 3 | 4 | 0.720 | 0.840 |
| Systems-modular-terse | 10 | 9 | 0 | 1 | 0.900 | 0.900 |

Worst per-language on DEV: typescript-lib 20% sym@1, csharp 20%, java 40%, cpp 40%, c 40%. None of the 18 languages hit FAIL > 50% (n=5 per language is thin), so the handoff's "FAIL > 50%" threshold is reframed as "sym@1 < 60%".

---

## Failure-mode taxonomy

Failure counts are out of **31 dev FAIL+PARTIAL rows**.

### Mode A — preprocess `containingChunk` falls through to file-header trivia (SWEEP ARTIFACT)
**Count: 6 (~19%)**. Languages: c (×2), cpp (×1), csharp (×3).

**Evidence**: For C-002 (redisConnectWithOptions in hiredis.c), `containingChunk.text` (lines 1-44) is the file's BSD-license copyright block — not the function body. R5's `pickSiblingSymbolsFromChunk` then extracts "Copyright" and "Salvatore" as identifier-shaped tokens (uppercase-start passes the heuristic). The R5 regex becomes `\b(redisConnectWithOptions|Copyright|Salvatore)\b`, which then trivially matches the file header at ranking time. Same pattern for CPP-003 (Google), CS-001/2/5 (Microsoft).

**Root cause**: `preprocess.mjs` lines 219-221 — when code-graph lookup returns no symbol line, the fallback is `containingChunk = chunks[0]` (first chunk in file), which for licensed code is the BSD/Apache header chunk.

**Fix path (sweep-time, format-gating not applicable — preprocess only runs at sweep time)**:
1. In `preprocess.mjs`, locate the actual symbol-defining chunk by scanning chunks for one whose `text` contains the `expectedSymbol` verbatim, with optional ranking by closest sibling reference. Falls back to chunks[0] only if symbol not found anywhere in any chunk.
2. In `r-templates.mjs:pickSiblingSymbolsFromChunk`, add an identifier-shape filter to reject single-word proper-noun-looking tokens that appear only inside `/* ... */` comment regions (i.e., not preceded by code-language keywords). Index-aware alternative: pass the indexed-symbol set in and require the token to be a known symbol in the corpus.

### Mode B — short generic graph-neighbour symbols pollute R5 alternation (SWEEP ARTIFACT)
**Count: ~5 (~16%)**. Languages: java (JV-004 "get"), go (GO-003 "Use"/"main"/"service"), zig (ZG-001/4 "Request"/"The"/"URL"), lua (LU-004 "List"/"Remove"/"Python"), python (PY-004 "command").

**Evidence**: JV-004 has 12 graph callers, one of which is named `get` (3 chars). R5's `pickNeighborSymbols` (r-templates.mjs:118) accepts any neighbor symbol with `length ≥ 3`, so `\b(getType|getDeclaredClass|get)\b` triggers — and `get` matches every getter in TypeToken.java, drowning the target chunk.

**Root cause**: `pickNeighborSymbols` (line 131) `if (lower.length < 3) continue;` — should reject 3-letter common verbs (`get`, `set`, `add`, `run`, `Use`, `URL`, `The`) by requiring stronger identifier-quality signal: length ≥ 5 OR camelCase OR has underscore, OR an index-aware popularity gate (the symbol must be a code-graph entity, not a common English word that happens to also exist as a 3-char symbol).

**Fix path (sweep-time)**: tighten `pickNeighborSymbols` shape filter. Per CLAUDE.md "use identifier-shape heuristics, not stopword lists" — the right heuristic is length ≥ 5 OR has-underscore OR contains-uppercase-mid-token. No new stopword list.

### Mode C — R3 JS-mobile keyword set missing `interface`/`type`/`enum`/`namespace`/`extension` (SWEEP ARTIFACT)
**Count: 4 (~13%)**. Languages: typescript-lib (TSL-006 no-match, TSL-004, TSL-008), dart (DR-008 no-match).

**Evidence**: `FAMILY_DEF_KEYWORDS["JS-mobile"]` = `(function|const|let|var|class|export|async|abstract|void|Future|Stream)`. Missing TS-idiomatic `interface`, `type`, `enum`, `namespace`. Missing Dart-idiomatic `extension`, `mixin`, `typedef`. R3 then produces a regex that won't match `export interface $ZodTypeInternals` (because `interface` isn't between `export` and the symbol in the keyword alternation), yielding zero ripgrep matches for TSL-006/DR-008 and forcing the ranker onto irrelevant siblings for TSL-004/008.

**Fix path (sweep-time)**: extend `FAMILY_DEF_KEYWORDS["JS-mobile"]` to `(function|const|let|var|class|export|async|abstract|void|Future|Stream|interface|type|enum|namespace|extension|mixin|typedef)`. No format-gating needed (sweep-only file).

### Mode D — Test-file siblings pull MaxSim to test files (MIXED: sweep + ranker)
**Count: 2 (~6%)**. Languages: java (JV-001, JV-005).

**Evidence**: JV-001 regex `\b(serializeNulls|testOverridesDefaultExcluder|createGson)\b` — siblings are testXxx names from a test file (the chunker picked them from a test-class chunk). Top-1 is `NullObjectAndFieldTest.java`. Even with cleaner siblings, the MaxSim ranker may still rank tests above impl when the test name lexically overlaps the query symbol.

**Fix path**:
- (sweep-time) Preprocess: prefer chunks from the `expectedFile` when picking siblings. Source: gold.expectedFile is known.
- (runtime tool, **format-gated**) file-kind-aware reranking: when the agent's query targets a definition symbol, demote chunks from `*Test*.java` / `*_test.go` / `*.spec.ts` etc. Must gate on `opts._isAgentFormat` per CLAUDE.md.

### Mode E — Docs (.mdx / .md) outranks code (REAL TOOL)
**Count: 2 (~6%)**. Languages: typescript-lib (TSL-004, TSL-008 both $ZodType).

**Evidence**: For $ZodType, top-1 is `packages/docs/content/packages/core.mdx` with symbol "Schemas". The mdx file contains code blocks referencing $ZodType; MaxSim ranks it ahead of `packages/zod/src/v4/core/schemas.ts`. Even after fixing Mode C (which gives R3 a regex that matches `interface $ZodType` in the .ts file), docs files may still win on the bi-encoder embedding because they have natural-language context the query overlaps.

**Fix path (runtime tool, format-gated)**: file-kind-aware reranking for `ss-find` — when the query targets a code symbol (regex includes the symbol verbatim), demote `.mdx` / `.md` / `.markdown` / `.rst` / `.txt` chunks. Existing `file-kind-ranking.js` has hooks for this. **Must format-gate** per the round-2 anomalous-chunk lesson (-27.57pp GCSN if ungated).

### Mode F — "wrong chunk within right file" splits 3 ways after deep-dive (MIXED)
**Count: ~6 (~19%)**. Initial framing was "MaxSim ranker picks wrong sibling chunk". Deep-dive (`mode-f-deepdive.mjs` + `li-chunk-audit.mjs`) shows it splits into three distinct sub-modes:

#### F1 — Sibling-merged chunks with enclosing-class labelling (Java)
**Example**: JV-004 getType. The Java code-graph entities table has `method getType` at lines 166-168 as a discrete entity. The LI index has it inside a sibling-merged chunk at lines 121-168 (merging verifyNoTypeVariable + getRawType + getType — three small consecutive methods). The patternSearch result is correct (top-1 has lines covering getType), but the agent-format presentation **relabels** the symbol to the enclosing class `TypeToken` (presentation="full" inflates the chunk text to the whole class 54-452). The grader reads the relabeled symbol → marks as symbol_mismatch.

**Fix path**: change agent-format presentation symbol-labelling to prefer the symbol that owns the matched line range, not the largest enclosing entity. This is **format-gated by definition** (only agent format does presentation inflation). Locked-baseline impact: must not change ss-search retrieval — the symbol field on results may already feed downstream grading, so changes need careful regression testing.

#### F2 — Chunker fine-grained chunks exist, ranker picks adjacent (Lua, Python)
**Example**: LU-003 (tablex.deepcopy at entity 118-120 has LI chunk 118-123; ranker picked 98-117 cycle_aware_copy with score 0.5114 vs 0.4797 for 98-117 etc). PY-002 (Context class entity 185-900 has LI chunk 186-282 covering it; ranker picked make_context 1210-1245 and __init__ 289-457 instead).

**Evidence**: code-graph + LI index both emit the right entity/chunk. The MaxSim ranker scores the right chunk LOWER than a related sibling chunk.

**Fix path (runtime, format-gated)**: identifier-agreement boost — when query contains the verbatim symbol AND a candidate chunk's "name" or "primary symbol" equals that token, add a small score boost. **Format-gate per round-1 lesson** (-0.07pp GCSN if ungated). The interesting twist: for LU-003 the chunk 118-123 may not have "tablex.deepcopy" as its declared `name` in the LI metadata (LI doc IDs don't carry names — only line ranges) — so the boost needs to look up the code-graph entity for the chunk's line range. That makes the fix more invasive but correct.

#### F3 — File possibly not indexed or LI metadata stripped (TypeScript)
**Example**: TS-008 systemPrompt. Live track-a-runner returned `regularPrompt` as top-1 (so the file IS searchable). But my `mode-f-deepdive.mjs` got 0 results, and `li-chunk-audit.mjs` first pass said "0 LI docs for lib/ai/prompts.ts" — until a second pass found the file IS indexed (664 LI docs in typescript repo total; prompts.ts is one of them). The audit script's caching had a state bug. Need a clean isolated re-run to confirm whether `systemPrompt` (entity 66-80) is a discrete LI chunk for prompts.ts, and what the ranker actually returns for the TS-008 regex+query.

**Fix path**: investigation pending — could be F1-like (sibling-merge), F2-like (ranker miss), or chunker missing an arrow-function rule for TS const-as-arrow-fn declarations.

---

### Mode F sub-counts (estimated)
| Sub-mode | Count | Fix type | Risk to locked baselines |
|---|---:|---|---|
| F1 — presentation relabelling | ~2 (JV-004, possibly others in OO-monolithic) | agent-format presentation logic | medium (changes symbol field; could shift grading on ss-search probes) |
| F2 — real ranker miss | ~3 (LU-003, LU-004, PY-002) | format-gated identifier-agreement boost | low if format-gated tightly |
| F3 — needs more investigation | ~1-2 (TS-008, TSL-001) | unknown | unknown |

### Mode G — Other (REAL TOOL, residual)
**Count: ~6 (~19%)**. Remaining failures (CPP-008 DetectTargets, CPP-006 AlignedDeleter, CS-002 RespServerSession switch-expression, KT-004 coroutine launch, PHP-008 __construct, RB-002 Request, RB-006 Helpers, SC-004 Response).

These need individual inspection but the patterns are similar: regex matches a candidate set; ranker picks a related-but-wrong chunk. Likely overlap with Mode F.

---

## Sweep-artifact vs real-tool breakdown

| Bucket | Count | % of dev failures |
|---|---:|---:|
| **Sweep artifacts** (Modes A+B+C, partial D) | ~12-14 | ~38-45% |
| **Real tool failures** (Modes E+F+G, partial D) | ~17-19 | ~55-62% |

If sweep artifacts are fixed (cheap — 3 small commits to `preprocess.mjs` + `r-templates.mjs`, then a ~5-min re-sweep), the R5|Q3 global symbol_recall would likely climb from 60.1% to ~65-70%. Then real tool-floor analysis can proceed with cleaner numbers.

---

## Recommended fix sequence (proposed)

| # | Fix | Where | Type | Expected dev lift | Cost |
|---|---|---|---|---:|---|
| 1 | preprocess: locate symbol-defining chunk by content scan, not chunks[0] fallback | `preprocess.mjs:194-225` | sweep-time | ~6 cases recovered = ~+4pp | small |
| 2 | r-templates: tighten `pickNeighborSymbols` shape filter (length≥5 OR underscore/camelCase) | `r-templates.mjs:118` | sweep-time | ~3-5 cases = ~+2-3pp | small |
| 3 | r-templates: extend JS-mobile keyword set (+interface,type,enum,namespace,extension,mixin,typedef) | `r-templates.mjs:38` | sweep-time | ~3 cases = ~+2pp | tiny |
| 4 | Re-run sweep, regenerate recommendations-v2-ss-find.json | regenerate | sweep-time | establishes new baseline | ~5 min |
| 5 | runtime: file-kind-aware demotion for .mdx/.md in ss-find, format-gated | `core/search/file-kind-ranking.js` | runtime, gated | ~2 cases = ~+1pp | small |
| 6 | runtime: identifier-agreement boost on same-file sibling chunks, format-gated | `core/search/...` ranking | runtime, gated | ~3-5 cases = ~+2-3pp | medium |

**Falsification test for each runtime fix**: re-run retrieval-probes (must show 0 PASS→FAIL flips vs post-perf-60.json) + GCSN dev MRR (must hold at 86.92%). If any regression, revert.

**Stop-rule**: if Fixes #1-#3 don't change the ss-find sym@1 baseline by ≥3pp on dev, the framing was wrong and real-tool issues dominate — go straight to #5/#6 and skip the re-sweep.

---

## Outcome of Modes A/B/C re-sweep (2026-05-13)

Sweep `phase6-redo-ss-find-v2` (411s, 7157 rows, same seed/grid as v1) re-baselined:

| Metric | v1 (`phase6-redo-ss-find-v1`) | v2 (`phase6-redo-ss-find-v2`) | Δ |
|---|---:|---:|---:|
| Global winner cell | R5\|Q3 | **R2\|Q3** | (changed) |
| Global winner sym@1 | 60.1% | **59.4%** | **-0.7pp** |
| JS-mobile override cell | R3\|Q4 | **R3\|Q3** | (changed) |
| JS-mobile override sym@1 | 71.0% | **67.7%** | **-3.3pp** |
| R5\|Q3 same-cell sym@1 | 60.1% | 58.7% | **-1.4pp** |
| R3\|Q3 same-cell sym@1 | 54.5% | 54.5% | 0 |

### Per-gold dev: -3 regressions, +1 gain (net -2)

| Gold | v1 → v2 | Cause |
|---|---|---|
| GO-006 | PASS→FAIL | Mode B rejected `main` (length 4); replacement `adminRouter` is camelCase but pulls test files |
| JV-002 | PASS→PARTIAL | Mode A changed `containingChunk` → different siblings → still-noisy regex |
| JS-005 | PASS→FAIL | Mode C added `interface` to JS-mobile keyword set → matches `index.d.ts: interface AxiosHeaders`, outranks `.js` impl |
| TSL-006 | FAIL→PASS | Mode C added `interface` → matches `export interface $ZodTypeInternals` ✓ |

### Why the fixes are kept despite the regression

The v1 PASSes that disappeared were never robust:

- **JV-002**: v1 regex `\b(get|main|create)\b` accidentally matched the right file because `get` is a real symbol in TypeToken.java. v2 regex `\b(get|create|write)\b` (Mode A picked a different sibling chunk) still has same-quality alternation, just different lucky/unlucky.
- **GO-006**: v1 regex `\b(NewRouter|main|service)\b` picked `chi.go` top-1 because `main` matched in that file's main function. v2 regex matched a test file because `adminRouter` appears there.
- **JS-005**: v1 regex didn't match `.d.ts` files because no JS-mobile keyword in v1 matched `interface`. v2 regex matches `.d.ts` legitimately because the file IS where `interface AxiosHeaders` is declared. The "regression" is the ranker preferring the type-declaration file over the `.js` impl — a real ranker/file-kind issue that v1 hid.

Decision (2026-05-13, user-directed): **keep all 3 fix commits**. The v2 numbers are more honest about the tool's true behavior; v1's higher numbers reflected compensating noise. Pivot from sweep-side to runtime tool-side fixes (Modes E and F2 from this taxonomy) to recover the dev gap and lift the true ceiling.

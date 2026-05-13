# Stage 3 — Failure-mode taxonomy + per-failure diagnosis

**Date**: 2026-05-13
**Source**: `stage3-diagnosis.jsonl` (verbose readSemantic signals on all 14 dev FAILs)
**Pattern recognition**: post Fix 1A rubric correction

## Tag frequencies (14 dev FAILs)

| tag | count | description |
|---|---|---|
| **WrongChunkBeatRight** | 9 | The right chunk exists in pre-merge top-K but at rank ≥ 2; ranker chose a different chunk |
| **OverlayRequired** | 4 | No returned chunk overlaps the gold range — likely a chunker bug |
| MaxSimSmallChunkInflation | 2 | Tiny chunk (≤ 5 L, no symbol) outscored real symbol chunk on MaxSim (subset of WrongChunk) |
| Unclassified | 1 | LU-003: gold chunk IS top-1 in diagnose-with-topK=8 but failed at topK=5 — needs more investigation |

(MaxSimSmallChunkInflation is a sub-type of WrongChunkBeatRight; some failures get multiple tags.)

## Per-failure breakdown

### WrongChunkBeatRight (9 cases)

| gold | lang | gold range (L) | wrong top-1 | wrong sym | wrong len | right rank | right sym | sub-pattern |
|---|---|---|---|---|---|---|---|---|
| **C-005** | c | 882-927 (46L) | 815-815 | (null) | 1L | 2 | redisContext | small-chunk + null-sym |
| **CPP-002** | cpp | 389-441 (53L) | 617-647 | (null) | 31L | 2 | FunctionCache | null-sym |
| **DR-008** | dart | 15-64 (50L) | 118-171 | unknown | 54L | 3+ | BaseResponse | unknown-sym |
| **JV-004** | java | 121-168 (48L) | 360-384 | get | 25L | 3+ | verifyNoTypeVariable | sym-collision-with-query |
| **LU-001** | lua | 128-185 (58L) | 220-237 | class | 18L | 3+ | _class | sym-prefix-collision (class vs _class) |
| **PY-004** | python | 100-165 (66L) | 168-172 | (null) | 5L | 3+ | command | null-sym + small-chunk |
| **RB-001** | ruby | 971-994 (24L) | 28-30 | (null) | 3L | 2 | Base | null-sym + small-chunk |
| **ZG-001** | zig | 22-83 (62L) | 140-147 | query | 8L | 3+ | Request | sym-collision (query in URL parsing) |
| **ZG-004** | zig | 22-83 (62L) | 140-147 | query | 8L | 3+ | Request | same as ZG-001 (different probe, same gold) |

**Sub-pattern frequencies:**
- null-symbol wins: 4 (C-005, CPP-002, PY-004, RB-001)
- unknown-symbol wins: 1 (DR-008)
- small chunk (≤ 5 L) wins: 3 (C-005, PY-004, RB-001)
- symbol-collision with query term: 3 (JV-004 query has "get"; ZG-001/004 query has "query" → matches Zig HTTP-`query` method)

### OverlayRequired (4 cases) — chunker-level bugs

| gold | lang | gold range | reason |
|---|---|---|---|
| **CPP-003** | cpp | 166-207 (ChosenTarget struct) | Tree-sitter-c conditional-compilation (`std::atomic` vs plain) creates parse ambiguity per goldNotes |
| **LU-004** | lua | 122-129 (List class) | List class chunks emitted for `List._create`/`._init` only; `List:append`/`:remove` (colon-method) not chunked |
| **PY-006** | python | 173-219 (ParamType.convert impl) | 5 `@t.overload` + 1 impl; chunker likely emits overloads as separate chunks and misses the body at line 173 |
| **ZG-005** | zig | 20-64 (Response struct) | Response struct chunk not emitted; only its methods (json, header, etc.) chunked |

These need **chunker fixes + reindex** to address — out of scope for runtime ranking work.

### Unclassified (1 case)

**LU-003** `tablex.deepcopy` (gold 118-123, 6L). In `diagnose-dev-failures.mjs` (topK=8), the pre-merge top-1 IS 118-123 with MaxSim=0.587. But the v3 audit (topK=5) graded it FAIL with no overlap. Possible causes:
- Final fused-top-(topK*2) re-rank dropped the 118-123 chunk at topK=5 due to low fused-RRF score (chunk has sym=null per cycle_aware_compare being the wrong-chunk-name metadata)
- OR merging logic collapses 118-123 into a larger neighbour that doesn't carry the gold range

Needs follow-up: re-run `diagnose-dev-failures` with topK=5 to confirm, OR look at why fused-score for the 118-123 chunk is low despite MaxSim being highest.

## Fix-candidate analysis (deferred to Stage 4)

### Fix 2a — Null/unknown-symbol demotion (covers ~5 cases)

For ss-semantic specifically (in-file scope), demote chunks where `symbol == null` or `symbol == 'unknown'` by a multiplicative ~0.85x on the final score (before re-ranking). The intuition: an in-file query (where the agent already knows the file) is asking about something with a name; chunks without symbol metadata are usually wrappers, blank lines, or comment blocks.

Estimated impact:
- C-005: wrong top-1 815-815 (sym=null, score 0.577) demoted to ~0.490 → falls below 815-832 (0.570) and gold 882-927 (0.569). New top-1: 815-832 (containing redisContext). IoU(815-832, 882-927) = 0 → still FAIL. **Doesn't help by itself; needs Fix 2b for C-005.**
- CPP-002: 617-647 (sym=null, 0.461) → 0.392 → drops below gold 389-441 (0.450). **PASS likely.**
- DR-008: 118-171 (unknown, 0.442) → 0.376 → still ahead of gold 15-64 (0.016). **Doesn't help — gold score is too low.**
- PY-004: 168-172 (null, 0.507) → 0.431 → drops below 173-215 (null, 0.503 → 0.428) → drops below 168-179 (command, 0.467). **New top-1: 168-179 with IoU(168-179, 100-165)? Let me check: overlap 100-165 ∩ 168-179 = empty. No. So new top-1 is wrong-but-different.** Doesn't help.
- RB-001: 28-30 (null, 0.569) → 0.484 → drops below gold 971-994 (Base, 0.531). **PASS likely.**

So Fix 2a alone helps ~2 of 5 candidates (CPP-002, RB-001). Net: low yield.

### Fix 2b — Small-chunk MaxSim demotion (covers C-005, PY-004 partly, RB-001)

For chunks with `length ≤ 5 lines`, apply ~0.85x. Intuition: bi-encoder MaxSim rewards concentrated literal-token presence in small windows, which is structurally inflated.

Estimated impact:
- C-005: 815-815 (1L, sym=null) → 0.490; 815-832 (18L, redisContext) stays 0.570 → new top-1: 815-832 (still misses gold by IoU=0). Doesn't help C-005.
- PY-004: 168-172 (5L) → 0.431 → drops below 173-215 (43L, still null-sym). New top-1: 173-215. IoU(173-215, 100-165) = 0. Still FAIL.
- RB-001: 28-30 (3L) → 0.484 → drops below gold (24L, 0.531). **PASS likely.**

Helps RB-001 strongly; doesn't help C-005 or PY-004.

### Fix 2c — Combined 2a + 2b (multiplicative)

If both conditions apply (null/unknown sym AND ≤ 5L), demote by ~0.72x (combined).

Estimated additive impact:
- C-005 815-815: 0.577 × 0.85 × 0.85 = 0.417. Falls way below. New top-1: 815-832 (redisContext, 0.570). Still misses gold. **No help.**
- CPP-002 617-647 (31L, sym=null): only 2a applies → 0.392. **Likely PASS.**
- RB-001 28-30: 0.484. **Likely PASS.**
- PY-004 168-172 (5L, null): 0.431. Other null chunks still above gold. Probably no help.

Combined fix: helps ~2 of 9 WrongChunkBeatRight cases (CPP-002, RB-001) plus potentially DR-008 with adjustments. The fixed cases are exactly the cases I identified manually in fix1-diagnosis.md as "RB-001 type".

### Fix 2d — Symbol-match boost (could help JV-004, ZG-001/004)

For chunks whose `symbol` case-insensitively matches a token in the expected symbol (here we'd need to plumb expectedSymbol through readSemantic, which we don't currently). E.g., if the expectedSymbol is "Request" and the chunk has symbol="Request", give a +Z boost.

Problem: in readSemantic the agent supplies a query, not an expected symbol — the tool doesn't know the gold. So this would have to be a query-derived signal (extract capitalized tokens from query?) which is fragile.

Alternative: the `_scoreSymbol` function already scores chunks where the query mentions the chunk symbol. The issue with JV-004 / ZG-001 is the OPPOSITE — the query mentions tokens like "get" / "query" that match generic-name chunks (which then win the symbol score).

A possible fix: in `_scoreSymbol`, downweight matches where the chunk's symbol is short (≤ 5 chars) AND the query is a multi-token NL phrase. Less aggressive than demoting all generic-name matches.

## Summary

| fix | helps | notes |
|---|---|---|
| **Fix 2a** (null-sym demotion 0.85x) | CPP-002, RB-001 partially | structurally correct, format-gated |
| **Fix 2b** (small-chunk demotion 0.85x) | RB-001, contributes to C-005 (insufficient alone) | structurally correct |
| **Fix 2c** (combined) | CPP-002, RB-001 | net win of 2-3 dev cases |
| **Fix 2d** (sym-match downweight on short sym) | JV-004, ZG-001/004 potentially | tricky, signal-fragile |
| **OverlayRequired fixes** (chunker) | CPP-003, LU-004, PY-006, ZG-005 | out of scope; reindex required |
| **LU-003 deep-dive** | LU-003 | follow-up investigation |

**Recommendation**: ship Fix 2a + 2b as ONE format-gated commit (multiplicative composition). Validate on strict v3 + behavioural + retrieval-probes + GCSN. Expected dev gain: +2 to +3 PASS (CPP-002, RB-001, possibly DR-008 with tuning). Do NOT ship 2d yet — needs more investigation.

The remaining 9 of 14 dev FAILs (JV-004, LU-001, ZG-001/004, plus the 4 OverlayRequired) need separate work: chunker fixes for the 4 OverlayRequired, and signal-engineering (probably the sym-collision angle) for JV-004 / LU-001 / ZG-001/004.

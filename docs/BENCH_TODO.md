# Benchmark TODO — Post-MaxSim Reranker Investigation

## Current Best: Pure MaxSim Reranker (79.7% MRR)

LateOn-Code as a full reranker — no blending, no alpha mixing. This is the correct base architecture. Code not yet pushed.

## What Could Push Past 79.7%

### 1. Confidence-Gated CE Rescue (Highest Expected Value)
- CE alone hit 79.3% on 20+ candidates; MaxSim hit 79.7%
- They likely fail on **different queries** — union of both models' strengths
- Gate signal: MaxSim top-1 minus top-2 score gap (simple, natural)
- CE needs proper candidate pool (20-30, not 8)
- **Expected gain: +0.2–0.5pp**

### 2. Per-Language / Per-Query-Type Routing
- Go is 93.6% — nearly saturated
- JS is 66% — lots of room
- Optimal reranking strategy differs: Go (short, distinctive identifiers) vs JS (generic names, heavy boilerplate)
- Even crude language-aware CE escalation threshold could help weak languages without hurting strong ones

### 3. ~~Larger Retrieval Pool for Weak Languages~~ — TESTED, ANSWERED
- **RESULT**: JS is retrieval-limited, NOT reranking-limited
- Recall@200 = 80.6% (194/1000 misses). Recall plateaus at 100→200 (+0.2pp only)
- Going beyond top-100 candidates won't help — the docs simply aren't in the embedding neighborhood
- See "JS Recall Diagnostic" section below for details

### Skip for Now
- **RRF in hybrid fusion**: CC approach with RRF fallback beat pure RRF in every benchmark — not worth revisiting
- **Meta-ranker / LTR**: Highest ceiling but needs training data + whole new subsystem
- **Universal alpha hunt**: Dead end, proven empirically

---

## JS / PHP / Ruby Weakness Analysis

### Tree-Sitter Chunking: Solid But Not SOTA

| Language | Parser | Strategy | Issues |
|----------|--------|----------|--------|
| JS | Tree-sitter + regex fallback | Brace-based | Template literal complexity, cross-line fragile |
| PHP | Tree-sitter + regex fallback | Brace-based | No cross-line support for multi-line signatures |
| Ruby | Tree-sitter + regex fallback | End-keyword | Block keyword nesting fixed, but `?`/`!` method suffixes basic |

- Max chunk size 2000 chars across all languages — might be too small for JS (React components with JSX)
- Parent metadata (`parent_symbol`, `parent_type`) is populated — but unclear if embedding model sees it in `embedding_text`

### LateOn-Code (MaxSim Model) on Weak Languages
- Claims CSN MRR 90.40% — but CSN JS subset is notoriously noisy (jQuery-era, minified)
- PHP is smallest CSN subset, Ruby is tiny
- Late interaction model likely **weakest on exactly PHP and modern JS patterns** (arrow fns, destructuring, hooks)

### Voyage Code 3: Potentially Stronger for Weak Languages
- 1024d, code-optimized, claims 13-17% over OpenAI/CodeSage
- Trained on **modern code**, not just CSN
- Proper query/document asymmetry (`inputType: 'query'` vs `'document'`)
- Pipeline: Voyage retrieves → LateOn-Code reranks
- If Voyage recall is fine but LateOn-Code MaxSim weak on JS patterns → explains low MRR despite good candidates

### ~~Suspicion~~ → Confirmed: Retrieval-Limited
JS is **retrieval-limited**. 194/1000 ground truth docs not in top-200 HNSW at all.
Reranker is NOT the bottleneck for JS — it can only reorder the ~80% that are already retrieved.

---

## Testing Priority (Ordered)

1. ~~**Recall check**~~: **DONE** — JS is retrieval-limited. 80.6% recall@200, plateau after top-100.
2. **Voyage Code 3 as reranker benchmark**: Lower priority now — reranker isn't the JS bottleneck.
3. **Chunk context bleeding**: Still worth checking for the ~20% of retrievable-but-poorly-ranked JS queries.
4. **2000 char limit for JS**: Still worth checking — could explain some of the 194 misses.
5. **Benchmark quality audit**: Filter GenCodeSearchNet JS noise (copyright queries, non-English, zero-signal). Measure "clean MRR" on the ~850 valid queries.
6. **Try COIR JS subset**: Cleaner benchmark for JS — may give more actionable signal than GenCodeSearchNet.

---

## JS Recall Diagnostic (GenCodeSearchNet, 2026-03-08)

Ran 1000 JS queries with k=200, NO reranking, NO expansion.

```
Recall@10   72.7%  (727/1000)
Recall@20   77.7%  (777/1000)
Recall@50   80.4%  (804/1000)
Recall@100  80.6%  (806/1000)
Recall@200  80.6%  (806/1000)

Total misses (not in top-200): 194/1000
```

### Miss Categories (from 20 samples)

| Category | Examples | Fixable? |
|----------|----------|----------|
| **Garbage queries** | "Copyright IBM Corp. 2016, 2018" → `flatMapAsync.js` | No — dataset noise |
| **Non-English** | "ripristino stato iniziale" → `resetToMove.js` | No — model limitation |
| **Zero semantic signal** | "This is where the action is." → `runmath.js` | No — no system can solve this |
| **Cross-language ambiguity** | "Initializes the plugin" → PHP initializers win | Maybe — language-scoped retrieval |
| **Empty results** | `requireBrocfile`, `isArrayBufferView` → 0 candidates | Maybe — indexing gap |
| **Ultra-vague** | "code for + and -" → matches everything | No — inherently ambiguous |

### Root Cause: CatBoost Router Misclassification (2026-03-09)

The "empty results" misses (`isArrayBufferView`, `processLoadedTexture`, `requireBrocfile`) are NOT indexing gaps.
All three files exist in the HNSW index and are **rank #1 in hybrid mode**.

**The CatBoost WASM query router misclassifies NL queries as `structural`.**
Structural mode does a graph DB entity lookup → returns 0 results for NL queries.

- 87/6000 queries across all languages misrouted to structural (1.4%)
- JS: 24/1000, Java: 24/1000, Python: 17/1000, Ruby: 10/1000, Go: 7/1000, PHP: 5/1000
- All 87 are false positives from CatBoost — the regex structural patterns produced zero false positives
- Trigger words: "instance", "Creates", "Returns", "type", "view" overlap with code vocabulary

**This inflates the recall diagnostic numbers.** 24 of the 194 JS "misses" were queries the system can already answer — they were just routed to the wrong search path.

### Conclusion (revised)

The recall diagnostic numbers are partially contaminated by the routing bug. True retrieval misses are ~170/1000, not 194/1000. The remaining misses are a mix of cross-language ambiguity, weak embeddings for vague queries, and some genuine dataset noise.

---

## TODO: Retrain CatBoost Router (HIGH PRIORITY)

Retrain the CatBoost model **without the structural class**. The model should only route between:
- **lexical** — exact identifier/file matches
- **semantic** — natural language descriptions
- **hybrid** — mixed queries

Structural mode should be triggered **explicitly** via `--structural` flag (or MCP parameter).
No regex fallback, no auto-detection — structural is opt-in only.

Rationale: Sweet Search is used by AI agents, which will know when to use normal search mode
vs structural graph traversal. The router's only job is lexical/semantic/hybrid classification.
This eliminates the highest-cost failure mode (0 results from misrouted NL queries).

---

## TODO: Replace NLLB Translation Model (HIGH PRIORITY)

The current local translation fallback (`Xenova/nllb-200-distilled-600M`) is **broken** — ONNX model files
are truncated stubs (49KB encoder for a 600M param model). Even if fixed, 600M params is too large for
responsive CPU inference in a code search tool.

### Plan: Helsinki-NLP OPUS-MT (MarianMT) with Int8 Quantization

Replace NLLB with per-language-pair OPUS-MT models. Each model is **~7-10M params** (~30-40MB on disk),
purpose-built for a single translation direction, and blazing fast on CPU.

**Architecture:**
- **Lazy-load per language pair** — only download/load the model when a query in that language is first seen
- **Int8 quantization** via Transformers.js `dtype: 'q8'` — halves model size, minimal quality loss
- **Optional: CTranslate2 runtime** — 6-10x faster than vanilla ONNX on CPU, int8 support built-in.
  Evaluate whether Transformers.js WASM is fast enough first; CTranslate2 adds a native dependency.
- Once loaded, models stay warm in memory (same pattern as current `TransformersTranslator` singleton)

**HuggingFace model IDs** (format: `Helsinki-NLP/opus-mt-{src}-en`, ONNX: `Xenova/opus-mt-{src}-en`):

| Source Language | ISO 639-1 | Script | OPUS-MT Model | ~Params | Notes |
|----------------|-----------|--------|---------------|---------|-------|
| Serbian/Croatian/Bosnian | sr/hr/bs | Cyrillic + Latin | `opus-mt-sh-en` (Serbo-Croatian) | ~7M | One model, both scripts. Detect via Cyrillic markers OR Latin diacritics (č,ć,š,ž,đ) |
| Russian | ru | Cyrillic | `opus-mt-ru-en` | ~7M | High quality, well-trained |
| Ukrainian | uk | Cyrillic | `opus-mt-uk-en` | ~7M | |
| Bulgarian | bg | Cyrillic | `opus-mt-bg-en` | ~7M | Detected via Cyrillic variant |
| Chinese | zh | CJK | `opus-mt-zh-en` | ~7M | Simplified + Traditional |
| Japanese | ja | Hiragana/Katakana/CJK | `opus-mt-ja-en` | ~10M | Larger due to script complexity |
| Korean | ko | Hangul | `opus-mt-ko-en` | ~7M | |
| German | de | Latin | `opus-mt-de-en` | ~7M | Very high quality |
| Spanish | es | Latin | `opus-mt-es-en` | ~7M | |
| French | fr | Latin | `opus-mt-fr-en` | ~7M | |
| Portuguese | pt | Latin | `opus-mt-pt-en` | ~7M | Covers pt-BR and pt-PT |
| Italian | it | Latin | `opus-mt-it-en` | ~7M | Fixes the "ripristino stato iniziale" miss |
| Polish | pl | Latin | `opus-mt-pl-en` | ~7M | In `toNLLBCode` map |
| Czech | cs | Latin | `opus-mt-cs-en` | ~7M | In `toNLLBCode` map |
| Greek | el | Greek | `opus-mt-el-en` | ~7M | |
| Arabic | ar | Arabic | `opus-mt-ar-en` | ~7M | |
| Hebrew | he | Hebrew | `opus-mt-he-en` | ~7M | In `SCRIPT_LANGUAGE_MAP` |
| Hindi | hi | Devanagari | `opus-mt-hi-en` | ~7M | |
| Bengali | bn | Bengali | `opus-mt-bn-en` | ~7M | May need `opus-mt-mul-en` fallback |
| Tamil | ta | Tamil | `opus-mt-ta-en` | ~7M | May need `opus-mt-mul-en` fallback |
| Thai | th | Thai | `opus-mt-th-en` | ~7M | May need `opus-mt-mul-en` fallback |

**Total: 21 language pairs** — matches all languages in `language-detector.js` `LANGUAGES` + script maps.

### Memory Budget

- **Per model**: ~15-20MB in memory (int8 quantized MarianMT)
- **Realistic session**: 1-3 models loaded simultaneously (most codebases are monolingual)
- **Worst case** (all 21 loaded): ~350-420MB — still less than one NLLB-600M model
- **Typical case**: ~40-60MB (1-2 European languages + English passthrough)

### Fallback Strategy

```
Query → detectLanguage() → language code
  ├─ en → passthrough (no translation)
  ├─ {lang} → try opus-mt-{lang}-en (lazy load, int8)
  │    ├─ success → translated query
  │    └─ model not found → try opus-mt-mul-en (multilingual fallback, ~40M params)
  │         ├─ success → translated query
  │         └─ fail → passthrough (original query, best-effort)
  └─ unknown script → passthrough
```

### What This Fixes

- **"ripristino stato iniziale"** (Italian) → `opus-mt-it-en` translates to "reset to initial state" → matches `resetToMove.js`
- **All non-English GenCodeSearchNet queries** that currently fail silently due to broken NLLB
- **Latency**: ~50-200ms warm inference per query (vs 500ms+ for NLLB-600M, if it worked)
- **No API keys needed** — fully local, works in offline benchmark runs

### Implementation Steps

1. Create `translation/opus-mt-translator.js` — lazy-loading per-pair translator
2. Add language-to-model-ID mapping (table above)
3. Wire into `TranslationFallback` as T3 replacement (keep T1 transliteration + T2 alias as-is)
4. Verify Xenova ONNX models exist for all 21 pairs; use `opus-mt-mul-en` for gaps
5. Benchmark: re-run GenCodeSearchNet with translation enabled, measure MRR delta
6. Optional: evaluate CTranslate2 if Transformers.js WASM latency > 200ms

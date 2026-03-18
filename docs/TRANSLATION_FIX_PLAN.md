# TRANSLATION_FIX_PLAN: Replace Broken NLLB with Local-First OPUS-MT Routing

**Status**: PLANNED
**Priority**: HIGH
**Expected impact**: Restore working offline translation fallback for non-English queries without introducing a heavy always-on model
**Date**: 2026-03-13

---

## What This Does

When a user searches in a non-English language, Sweet Search should:

1. Run the normal search first
2. If results are good, return them unchanged
3. If results are poor or missing, run translation fallback
4. Re-run search with the translated query

T1 and T2 stay the same:

- T1: transliteration
- T2: alias dictionary

Only T3 changes:

- Remove broken `Xenova/nllb-200-distilled-600M` as the default local path
- Add a **local-first** OPUS-MT router that uses verified small-ish Marian models lazily
- Fall back to cloud only if configured
- Preserve code identifiers explicitly before sending text to MT

This keeps translation lazy and local by default, which matches the actual goal of the feature.

---

## Current Pipeline Logic

The high-level trigger logic is already correct and should stay:

```text
User query
  -> search()
  -> results

Results GOOD
  -> return as-is

Results POOR/MISSING
  -> TranslationFallback.shouldTriggerFallback()
  -> T1 transliteration
  -> T2 alias lookup
  -> T3 machine translation
  -> re-search
```

This is already implemented in:

- `translation/fallback-pipeline.js`
- `translation/llm-translator.js`
- `translation/language-detector.js`

The bug is not the outer pipeline. The bug is that the current local T3 path points at a broken NLLB artifact and silently falls through to passthrough.

---

## Problem Statement

The current local translator is not usable:

- `translation/llm-translator.js` currently routes local translation through `transformers-translator.js`
- `transformers-translator.js` defaults to `Xenova/nllb-200-distilled-600M`
- that NLLB artifact is broken in practice for this repo's runtime path
- as a result, offline T3 often degrades to passthrough instead of translation

This means users without cloud API keys do not get reliable non-English query recovery.

---

## Constraints

These constraints are now explicit and drive the implementation:

- Translation must work locally on CPU
- Translation must be lazy-loaded
- Translation must not require cloud keys
- Translation should avoid a single giant multilingual model
- Translation should preserve code identifiers
- Translation should degrade cleanly when model download is unavailable

Important correction from research:

- OPUS-MT pair models are **not** ~7-10M parameters
- Typical Marian OPUS-MT checkpoints are closer to ~74M parameters
- Verified Xenova int8 ONNX artifacts are roughly **105-115MB per model** in practice
- Therefore the previous plan's size and latency numbers were too optimistic

That does **not** kill the approach. It just means the plan must be honest:

- lazy-loading one needed model is still reasonable
- downloading all models up front is not
- model-family routing is better than blindly adding 21 strict pair models

---

## Chosen Strategy

Implement **local-first OPUS-MT family/pair routing in the existing Transformers.js stack**.

This is the implementation choice for now because:

- it fits the current Node/JS architecture
- it avoids introducing a second runtime right now
- verified Xenova ONNX models exist for the core languages we care about
- it is much lighter operationally than a single 600M-3B multilingual model

We are **not** choosing MADLAD-400, Aya, or other large SOTA models for this plan because they violate the lightweight local CPU requirement.

We are **not** switching to Bergamot in this plan because that would require a new model/runtime ecosystem. Bergamot remains the main future alternative if we later decide footprint matters more than stack consistency.

---

## New T3 Fallback Order

T3 should become:

```text
local-opus -> cloud-if-configured -> passthrough
```

Notes:

- This is effectively local-first
- For users without cloud keys, cloud is skipped cleanly
- `mul-en` is **not** a separate pipeline tier
- `mul-en` is an internal fallback inside the local OPUS translator

So the local translator itself should do:

```text
pair or family model -> mul-en -> fail
```

This keeps the external pipeline simple while still providing broad local coverage.

---

## Verified Model Direction

We are not building the architecture around 21 unverified pair models.

Use verified Xenova models where available and reduce model count with family models where that is sensible.

### Primary verified models

Use these as first-class local routes:

- `Xenova/opus-mt-ROMANCE-en` for `es`, `fr`, `it`, `pt`, `ro`
- `Xenova/opus-mt-ru-en`
- `Xenova/opus-mt-uk-en`
- `Xenova/opus-mt-de-en`
- `Xenova/opus-mt-pl-en`
- `Xenova/opus-mt-cs-en`
- `Xenova/opus-mt-zh-en`
- `Xenova/opus-mt-ja-en`
- `Xenova/opus-mt-ko-en`
- `Xenova/opus-mt-ar-en`
- `Xenova/opus-mt-hi-en`
- `Xenova/opus-mt-th-en`

### Verified catch-all fallback

- `Xenova/opus-mt-mul-en`

### Explicitly unsupported for this implementation pass

Do not pretend these are first-class until verified and benchmarked:

- `bg`
- `he`
- `bn`
- `ta`
- `sr` / `hr` / `bs` via `sh`

For these languages:

- use `mul-en` if the query reaches T3
- do not create fake per-pair routes in code

---

## Architecture

### High-Level Flow

```text
Query
  -> normal search
  -> poor or missing results
  -> T1 transliteration
  -> T2 alias lookup
  -> T3 local OPUS router
       -> protect identifiers/placeholders
       -> detect language or family
       -> try routed local model
       -> fallback to mul-en
       -> restore protected identifiers
  -> if local fails and cloud configured
       -> cloud translation
  -> else passthrough
```

### Why this ordering makes sense

- good English identifier hits stay fast
- transliteration and dictionary remain effectively free
- local translation is only paid for on misses
- cloud becomes optional improvement, not a dependency

---

## Implementation Plan

### Phase 0: Lock the Model Matrix

Before code changes, freeze the exact model map used by runtime.

Deliverable:

- a hardcoded runtime map of supported languages to verified model IDs

Rules:

- only include model IDs verified to exist and load under Transformers.js
- use family models where that reduces model count without harming routing clarity
- route everything unsupported to `mul-en`

Final mapping for this implementation:

```js
const OPUS_MODEL_ROUTES = {
  es: 'Xenova/opus-mt-ROMANCE-en',
  fr: 'Xenova/opus-mt-ROMANCE-en',
  it: 'Xenova/opus-mt-ROMANCE-en',
  pt: 'Xenova/opus-mt-ROMANCE-en',
  ro: 'Xenova/opus-mt-ROMANCE-en',

  ru: 'Xenova/opus-mt-ru-en',
  uk: 'Xenova/opus-mt-uk-en',
  de: 'Xenova/opus-mt-de-en',
  pl: 'Xenova/opus-mt-pl-en',
  cs: 'Xenova/opus-mt-cs-en',
  zh: 'Xenova/opus-mt-zh-en',
  ja: 'Xenova/opus-mt-ja-en',
  ko: 'Xenova/opus-mt-ko-en',
  ar: 'Xenova/opus-mt-ar-en',
  hi: 'Xenova/opus-mt-hi-en',
  th: 'Xenova/opus-mt-th-en',
};

const OPUS_FALLBACK_MODEL = 'Xenova/opus-mt-mul-en';
```

### Phase 1: Create a Local OPUS Router — *Wave 1A*

**New file**: `translation/opus-mt-translator.js`

> **Absorbs Phase 2 (identifier protection) and Phase 8 (download/offline handling).**
> All three concern the same file. Implement them together.

Create an `OpusMTTranslator` that:

- owns lazy model loading
- caches loaded pipelines by model ID
- deduplicates concurrent loads
- routes from language code to model ID
- falls back internally to `mul-en`
- protects and restores identifiers
- handles first-download and offline failure cleanly (see Phase 8 details below)

Interface should match the current local translator shape closely enough that `llm-translator.js` can swap to it without broad churn.

Required API:

```js
class OpusMTTranslator {
  async translate(text, options = {}) {}
  async process(query) {}
  unload(modelId) {}
  unloadAll() {}
  getStats() {}
}

export function getOpusMTTranslator() {}
export function isOpusMTLoaded() {}
export function unloadOpusMT() {}
```

### Phase 2: Add Identifier Protection — *absorbed into Phase 1*

> **Implementation note**: This logic lives in `opus-mt-translator.js` and is built as part of Phase 1 (Wave 1A). Kept as a separate section for specification clarity.

This is required. Do not trust MT to preserve code tokens.

Before translation:

- detect identifiers such as `AuthService`, `getUserById`, `snake_case`, `SCREAMING_CASE`, dotted paths, file names
- replace them with placeholders like `__ID_0__`, `__ID_1__`

After translation:

- restore placeholders back to original identifiers

Example:

```text
input: "аутентификация AuthService"
protected: "аутентификация __ID_0__"
translated: "authentication __ID_0__"
restored: "authentication AuthService"
```

This logic belongs in the local translator so it is guaranteed for every T3 local translation call.

### Phase 3: Wire T3 to Local-First — *Wave 2A* (depends on Phase 1)

**Modify**: `translation/llm-translator.js`

Change T3 order from:

```js
['cloud', 'local', 'passthrough']
```

to a conceptual order of:

```js
['local', 'cloud', 'passthrough']
```

Behavior rules:

- `local` means `OpusMTTranslator`
- `cloud` only runs if a provider is configured and enabled
- `passthrough` is the final fallback

Important:

- do not add a separate `opus-mt` plus `local` double tier
- the local translator handles pair/family route selection and `mul-en` fallback internally

### Phase 4: Keep `transformers-translator.js` During Migration

Do **not** delete `translation/transformers-translator.js` in the first implementation pass.

Instead:

- stop using it as the default local translator
- keep it temporarily for reference and rollback
- remove it only after the new OPUS path is benchmarked and stable

This avoids repainting the plan as “complete” before the replacement is proven.

### Phase 5: Update Translation Config — *Wave 1B* (parallel with Phase 1)

**Modify**: `core/config.js`

Replace the local translation config with an honest representation of the new runtime.

Config goals:

- expose the local-first fallback order
- define active local strategy as OPUS routing
- keep the global translation kill switch
- avoid lying about model size

Recommended config shape:

```js
export const TRANSLATION_LOCAL_MODELS = {
  'opus-router': {
    enabled: true,
    priority: 1,
    name: 'OPUS-MT Local Router',
    type: 'opus-router',
    device: 'cpu',
    quantized: true,
    size: '~105-115MB per loaded model',
    languages: 'verified set + mul-en fallback',
    avgLatency: 'measure in benchmark; do not hardcode fantasy numbers',
  },
};
```

Pipeline config:

```js
pipeline: {
  fallbackOrder: ['local', 'cloud', 'passthrough'],
  softEnglishCheck: true,
  softEnglishMinScore: 0.3,
  softEnglishMinResults: 3,
}
```

Global kill switch:

```js
get isDisabled() {
  return process.env.SWEET_SEARCH_TRANSLATE === 'false';
}
```

### Phase 6: Respect Global Disable in Searcher — *Wave 2B* (depends on Phase 5)

**Modify**: `core/sweet-search.js`

Respect the env toggle in the constructor:

```js
this.enableTranslationFallback =
  (options.enableTranslationFallback ?? true) &&
  !TRANSLATION_CONFIG.isDisabled;
```

This is still a good addition and should stay in scope.

### Phase 7: Keep Language Detection Changes Minimal — *Wave 1C* (parallel with Phase 1)

**Modify**: `translation/language-detector.js`

Do only the language-detector work that helps routing materially.

Required:

- add missing human-readable entries already used by detection output:
  - `bg`
  - `he`
  - `pl`
  - `cs`
- add Italian diacritics to Latin detection

Not required:

- invent a complex Italian ASCII classifier
- add `toOpusMTCode()` unless runtime actually needs a special code mapping

Why:

- ASCII Italian already reaches T3 through the existing soft-English logic when results are poor
- the local router can choose `mul-en` when exact Latin language classification is uncertain

### Phase 8: First-Download and Offline Behavior — *absorbed into Phase 1*

> **Implementation note**: This behavior is built into `opus-mt-translator.js` as part of Phase 1 (Wave 1A). Kept as a separate section for specification clarity.

This was missing from the old plan and is required for implementation readiness.

Add explicit behavior for first-time model fetches:

1. If the model is already cached locally:
   - load it

2. If the model is not cached and network is available:
   - allow lazy download
   - record first-load latency in stats

3. If the model is not cached and network is unavailable:
   - fail local translation cleanly
   - try cloud only if configured
   - otherwise passthrough

Implementation requirements:

- catch model download/init errors explicitly
- include the failure reason in `attempts`
- do not spam logs unless debug/verbose is enabled

Optional but recommended:

- add a prewarm script later to download the verified model set proactively
- document cache location and cleanup behavior

This plan does **not** require pre-downloading all models.

### Phase 9: Tests — *Wave 3* (after all implementation waves)

**New file**: `__tests__/translation/opus-mt-translator.test.js`

Test categories:

1. language route resolves to expected verified model
2. romance languages route to `ROMANCE-en`
3. unsupported languages route to `mul-en`
4. pipeline is lazy-loaded on first use only
5. concurrent loads for the same model deduplicate
6. identifier placeholders are preserved and restored
7. failed primary route falls back to `mul-en`
8. failed local route falls through to cloud when configured
9. failed local route falls through to passthrough when cloud is unavailable
10. `SWEET_SEARCH_TRANSLATE=false` disables translation entirely

Also update:

- `__tests__/translation/fallback-pipeline.test.js`
- `__tests__/translation/translation-config.test.js`
- `__tests__/translation/language-detection.test.js`

### Phase 10: Benchmark — *Wave 4* (after tests pass)

Do not ship this on theory alone.

**Benchmark goals**:

- measure first load latency per model
- measure warm translation latency for short code-search queries
- measure search quality improvement on non-English query subsets
- measure memory growth after loading 1, 2, and 3 models

Benchmark slices:

- Romance language queries
- Cyrillic queries
- CJK queries
- mixed natural language + identifier queries
- unsupported languages that route to `mul-en`

Success is not “SOTA MT”.
Success is:

- offline translation works
- identifiers are preserved
- non-English query recall improves
- latency remains acceptable because translation only runs on misses

---

## File Change Summary

| Wave | File | Action | Description |
|------|------|--------|-------------|
| 1A | `translation/opus-mt-translator.js` | **CREATE** | Local-first OPUS router with lazy-loading, identifier protection, download/offline handling, internal `mul-en` fallback |
| 1B | `core/config.js` | MODIFY | Replace NLLB default with OPUS router config, add global disable |
| 1C | `translation/language-detector.js` | MODIFY | Minimal routing-relevant updates only |
| 2A | `translation/llm-translator.js` | MODIFY | Make local translation first, cloud optional second |
| 2A | `translation/index.js` | MODIFY | Export new OPUS translator |
| 2B | `core/sweet-search.js` | MODIFY | Respect `SWEET_SEARCH_TRANSLATE=false` |
| — | `translation/transformers-translator.js` | KEEP FOR NOW | Retain during migration, remove in Wave 5 if benchmark passes |
| 3 | `__tests__/translation/opus-mt-translator.test.js` | **CREATE** | Unit tests for routing, fallback, placeholders, lazy-loading |
| 3 | `__tests__/translation/fallback-pipeline.test.js` | MODIFY | Update T3 expectations |
| 3 | `__tests__/translation/translation-config.test.js` | MODIFY | Update config expectations |
| 3 | `__tests__/translation/language-detection.test.js` | MODIFY | Minimal detection additions |
| 4 | `evaluation/benchmark-opus-mt.js` | **CREATE** | Runtime and quality benchmark |
| — | `docs/TRANSLATION.md` | MODIFY | Update architecture docs after implementation lands |

---

## Execution Order (Parallel Waves)

Phases within the same wave have **no cross-dependencies** and MUST run concurrently.
Waves are sequential barriers — all work in a wave must finish before the next wave starts.

```text
Wave 0 ─ foundation
  Phase 0: lock verified model matrix

Wave 1 ─ parallel implementation (3 independent files)
  ├── Phase 1: opus-mt-translator.js  (includes Phase 2 + Phase 8)
  ├── Phase 5: config.js              (translation config + global disable)
  └── Phase 7: language-detector.js   (minimal routing-relevant additions)

Wave 2 ─ wiring (2 files, each depends on one Wave 1 output)
  ├── Phase 3: llm-translator.js      (depends on Phase 1)
  └── Phase 6: sweet-search.js        (depends on Phase 5)

Wave 3 ─ validation
  Phase 9: tests

Wave 4 ─ measurement
  Phase 10: benchmark

Wave 5 ─ cleanup (only if Wave 4 results are acceptable)
  Remove old NLLB path (transformers-translator.js)
```

Phase 4 (keep `transformers-translator.js`) is a non-action that applies throughout.

### Why this ordering

- Wave 1 is the big parallelism win: 3 independent files, zero shared state
- Wave 2 is a smaller win: 2 files that each depend on exactly one Wave 1 output
- Waves 3-5 are inherently sequential (test → measure → decide)

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Warm latency is slower than hoped under WASM CPU | Medium | Measure honestly, keep translation lazy, keep cloud as optional second fallback |
| Some language pairs remain unsupported by verified pair/family models | High | Route them to `mul-en` instead of pretending first-class support |
| MT damages code identifiers | High | Mandatory placeholder shielding and restore |
| First-time model download is slow or offline | High | Explicit download failure handling and optional future prewarm |
| Family model quality is weaker than per-pair for some languages | Medium | Benchmark by language family and split later only if needed |
| Old NLLB path is removed too early | Medium | Keep old file during migration and only delete after benchmark validation |

---

## Explicit Non-Goals

These are not in scope for this implementation:

- building a custom <10M parameter translator
- adding Bergamot runtime in the same change
- chasing global MT SOTA leaderboards
- eager translation before search
- downloading all local models up front

---

## Success Criteria

1. Offline users with no API keys get a working local translation path
2. Local translation is attempted before cloud inside T3
3. Mixed queries such as non-English text plus `AuthService` preserve identifiers
4. Unsupported languages still have a local best-effort path via `mul-en`
5. Query subsets in non-English languages show measurable retrieval improvement over passthrough
6. The implementation degrades cleanly when a model cannot be downloaded or loaded
7. The plan can be implemented without inventing missing models or depending on a giant multilingual checkpoint

---

## Future Alternative If Footprint Becomes The Top Priority

If the team later decides model footprint matters more than staying inside Transformers.js, evaluate a second-phase migration to **Bergamot student models**.

Why this is not Phase 1:

- different runtime
- different model format
- different integration work

Why it stays interesting:

- much smaller than OPUS-MT
- CPU-optimized by design
- the closest thing found to the desired lightweight local translator

For now, the implementation-ready plan is OPUS family/pair routing with honest numbers and local-first behavior.

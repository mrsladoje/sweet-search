# Multilingual Translation System

> **Sweet Search** supports non-English queries through a three-tier translation pipeline.

---

## Overview

The translation system enables code search in any language by converting queries to English before searching. It uses a tiered fallback approach for optimal speed and accuracy:

| Tier | Method | Latency | Use Case |
|------|--------|---------|----------|
| **T1** | Transliteration | <1ms | Cyrillic → Latin script conversion |
| **T2** | Alias Dictionary | <1ms | Known term lookups (e.g., "корисник" → "user") |
| **T3** | LLM Translation | 250-500ms | Full semantic translation |

```
Query: "аутентификација сервис"
  ↓
T1: "autentifikacija servis" (Cyrillic → Latin)
  ↓
T2: "authentication service" (Dictionary match)
  ↓
T3: (skipped - T2 found match)
  ↓
Search: [AuthService.java, AuthController.java, ...]
```

---

## Architecture

### File Structure

```
translation/
├── fallback-pipeline.js    # T1→T2→T3 orchestration
├── llm-translator.js       # T3 cloud/local LLM translation
├── transformers-translator.js  # T3 local NLLB-200 fallback
├── language-detector.js    # Script/language detection (centralized)
├── transliterator.js       # T1 script conversion
├── alias-lookup.js         # T2 dictionary expansion
├── alias-dictionary.json   # T2 term mappings
├── translation-cache.js    # Result caching
└── index.js                # Module exports
```

### Configuration

Translation is configured in `config.js` via three main exports:

- **`TRANSLATION_PROVIDERS`** - Cloud LLM providers (Cerebras, Groq, OpenRouter, custom)
- **`TRANSLATION_LOCAL_MODELS`** - Local models (NLLB-200, Opus-MT)
- **`TRANSLATION_CONFIG`** - Active provider, prompts, cleaning rules, pipeline behavior

---

## Cloud Providers

The system auto-selects the best available provider based on API key availability:

| Provider | Model | Accuracy | Latency | Cost/1K Queries |
|----------|-------|----------|---------|-----------------|
| **Cerebras** | llama3.1-8b | 94.7% | 467ms | $0.0059 |
| **Groq** | llama-3.1-8b-instant | 94.7% | 332ms | $0.0030 |
| **Groq** | llama-3.3-70b-versatile | 94.7% | 266ms | $0.0312 |
| **OpenRouter** | llama-3.1-8b-instruct:free | - | - | FREE |

> **Note:** Config uses `meta-llama/llama-3.1-8b-instruct:free`. Benchmark data in MODELS_BENCHMARK.md was collected with `mistral-small-free` (63.2% accuracy, 3181ms).

### Recommended Configuration

**Best value:** Groq `llama-3.1-8b-instant` (50% cheaper than Cerebras, same accuracy)

**Best speed:** Groq `llama-3.3-70b-versatile` (266ms avg, fastest cloud)

**Free option:** OpenRouter with Mistral Small (rate limited, lower accuracy)

### Environment Variables

```bash
# Cloud provider API keys (set the ones you use)
CEREBRAS_API_KEY=your_cerebras_key      # Default if available
GROQ_API_KEY=your_groq_key              # Recommended
OPENROUTER_API_KEY=your_openrouter_key  # Free tier

# Override auto-selection
TRANSLATION_PROVIDER=groq               # Force specific provider
TRANSLATION_OFFLINE=true                # Skip cloud entirely

# Model overrides
CEREBRAS_TRANSLATE_MODEL=llama3.1-8b
GROQ_TRANSLATE_MODEL=llama-3.1-8b-instant
```

---

## Local Models (Fallback)

When cloud providers are unavailable or offline mode is enabled:

| Model | Accuracy | Latency | Size | Languages | Status |
|-------|----------|---------|------|-----------|--------|
| **NLLB-200** | 78.9% | 810ms | 600MB | 200+ | Default |
| Opus-MT | - | 50-200ms | 300MB | many→en | Loading issues* |
| mT5-small | - | 100-300ms | 300MB | 101 | Experimental |

*Opus-MT and mT5 have ONNX/tokenizer loading issues. NLLB-200 is the reliable fallback.

**Default:** NLLB-200 (best coverage, acceptable accuracy)

```bash
# Override local model
TRANSLATION_LOCAL_MODEL=opus-mt
```

---

## Trigger Conditions

Translation is triggered when:

1. **Non-ASCII query** with poor or no search results
2. **Explicit request** via `?translate=true`
3. **ASCII query with low-confidence English detection** and poor results

### Soft English Check (Key Feature)

The system uses a "soft" English check instead of hard-stopping on ASCII queries:

```javascript
// Old behavior (broken): ASCII = skip translation
if (isLikelyEnglish(query)) return false;  // ❌ Skips German "Mitarbeiter"

// New behavior: Check results quality first
if (hasGoodResults && isLikelyEnglish(query).confidence > 0.7) return false;  // ✅
```

This fixes the bug where Latin-script languages (German, French, Spanish) were incorrectly skipped.

---

## Language Detection

### Script Detection

Detects the primary script to route to appropriate transliterator:

| Script | Pattern | Detection |
|--------|---------|-----------|
| Cyrillic | `[\u0400-\u04FF]` | Serbian, Russian, Ukrainian |
| CJK | `[\u4e00-\u9fff]` | Chinese |
| Japanese | `[\u3040-\u30ff]` | Hiragana/Katakana |
| Korean | `[\uac00-\ud7af]` | Hangul |

### Cyrillic Variant Detection

Uses unique characters to distinguish:

- **Serbian:** Ђ, Ћ, Љ, Њ, Џ, Ј
- **Ukrainian:** Ґ, Є, І, Ї
- **Russian:** Ы, Ё, Э, Щ

### Latin-Script Language Detection

Detects non-English Latin languages via diacritic patterns:

| Language | Markers |
|----------|---------|
| German | ä, ö, ü, ß |
| French | à, â, ç, è, ê, ë, î, ï, ô, ù, û, ÿ, œ, æ |
| Spanish | ñ, ¿, ¡ |
| Polish | ą, ć, ę, ł, ń, ś, ź, ż |
| Czech | ě, ř, ů, č, ď, ň, š, ť, ž |
| Portuguese | ã, õ |

---

## Output Cleaning

LLM translations are cleaned to remove verbose patterns:

```javascript
// Raw output from Cerebras:
'The translation of "認証" to English is: "authentication"'

// After cleaning:
'authentication'
```

### Cleaning Rules

- Strip prefixes: "The translation of X is:", "Here's the translation:", etc.
- Remove surrounding quotes
- Take first line only (removes explanations)
- Truncate to 200 chars max

Configured in `TRANSLATION_CONFIG.cleaning`.

---

## Caching

Translations are cached to avoid redundant API calls:

```javascript
TRANSLATION_CONFIG.cache = {
  enabled: true,
  ttl: 3600000,      // 1 hour
  maxEntries: 10000,
  keyVersion: 1,     // Bump to invalidate on config changes
  filePath: '.sweet-search/translation-cache.json'
}
```

Cache keys include query + provider + model + config version for stability.

---

## Fallback Pipeline Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Query: "аутентификација"                                   │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  TRIGGER CHECK                                              │
│  - Has non-ASCII? ✓                                         │
│  - Explicit translate=true? ✗                               │
│  - Good results already? ✗                                  │
│  → TRIGGER TRANSLATION                                      │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  T1: TRANSLITERATION (<1ms)                                 │
│  "аутентификација" → "autentifikacija"                      │
│  Script: Serbian Cyrillic                                   │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  T2: ALIAS DICTIONARY (<1ms)                                │
│  Lookup: "autentifikacija" → "authentication" ✓             │
│  Type: identifier match (high confidence)                   │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  T3: LLM TRANSLATION (SKIPPED)                              │
│  Reason: T2 found identifier match                          │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  RESULT                                                     │
│  bestTranslation: "authentication"                          │
│  tier: "T2"                                                 │
│  totalLatency_ms: 1                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## API Usage

### TranslationFallback Class

```javascript
import { TranslationFallback } from './translation/fallback-pipeline.js';

const pipeline = new TranslationFallback();
await pipeline.init();

// Check if translation should be triggered
const shouldTranslate = pipeline.shouldTriggerFallback(results, query);

// Perform translation
const result = await pipeline.translate("аутентификација");
// {
//   original: "аутентификација",
//   bestTranslation: "authentication",
//   tier: "T2",
//   totalLatency_ms: 1,
//   changed: true,
//   attempts: [...]
// }

// Get all search queries to try
const queries = pipeline.getSearchQueries(result);
// ["authentication", "autentifikacija"]
```

### Direct LLM Translation

```javascript
import { translateWithLLM } from './translation/llm-translator.js';

const result = await translateWithLLM("認証サービス");
// {
//   translation: "authentication service",
//   provider: "groq",
//   model: "llama-3.1-8b-instant",
//   latency_ms: 285,
//   attempts: [...]
// }
```

### Language Detection

```javascript
import { isLikelyEnglish, detectLanguage } from './translation/language-detector.js';

isLikelyEnglish("authentication");
// { likely: true, confidence: 0.5, reason: "ascii" }

isLikelyEnglish("аутентификација");
// { likely: false, confidence: 0.95, reason: "cyrillic" }

detectLanguage("Größe");
// { language: "de", script: "latin", confidence: 0.8 }
```

---

## Benchmarks

See **[MODELS_BENCHMARK.md](../MODELS_BENCHMARK.md)** for detailed benchmark results including:

- Cloud provider accuracy comparison (19 queries, 9 languages)
- Latency distributions (p50, p95)
- Cost per 1000 queries
- Local model performance
- Recommendations

### Key Findings

| Metric | Winner | Value |
|--------|--------|-------|
| **Best accuracy** | Groq, Cerebras | 94.7% |
| **Best value** | Groq llama-3.1-8b-instant | $0.003/1K, 94.7% |
| **Fastest cloud** | Groq llama-3.3-70b | 266ms avg |
| **Best free local** | NLLB-200 | 78.9%, FREE |

---

## Testing

```bash
# Run translation tests
npm test -- translation

# Specific test files
npm test -- language-detection
npm test -- output-cleaning
npm test -- fallback-pipeline

# Run benchmarks
node evaluation/benchmark-all-models.js
```

### Critical Test Cases

1. **ASCII German triggers translation when results are poor** - The bug fix
2. **Output cleaning preserves code identifiers** - Don't destroy `AuthService`
3. **Low confidence for pure ASCII** - Enables soft check
4. **Cyrillic variant detection** - Distinguish Serbian/Russian/Ukrainian

---

## Related Documentation

### Configuration & Benchmarks
- **[config.js](../config.js)** - Translation configuration (`TRANSLATION_CONFIG`, `TRANSLATION_PROVIDERS`, `TRANSLATION_LOCAL_MODELS`)
- **[MODELS_BENCHMARK.md](../MODELS_BENCHMARK.md)** - Provider benchmark results (accuracy, latency, cost)

### Smart Search System
- **[QUERY-ROUTING.md](../QUERY-ROUTING.md)** - Query router (translation happens before routing)
- **[SEMANTIC_SEARCH.md](../../../docs/search/SEMANTIC_SEARCH.md)** - Semantic search pipeline
- **[README.md (docs/search)](../../../docs/search/README.md)** - Smart Search documentation index

### Project Context
- **[CLAUDE.md](../../../../CLAUDE.md)** - Project-level smart search usage

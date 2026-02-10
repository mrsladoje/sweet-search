# Query Routing - WASM CatBoost Implementation

> **Production System Documentation**
> **Last Updated:** January 2026
> **Router:** WASM CatBoost (499 trees, depth 4)

---

## Overview

The Query Router classifies search queries into four routing modes to optimize search performance:

| Mode | Use Case | Example |
|------|----------|---------|
| **LEXICAL** | Exact identifier search | `AuthService`, `getUserById`, `*.java` |
| **SEMANTIC** | Conceptual questions | `how does authentication work` |
| **STRUCTURAL** | Code dependency queries | `what calls AuthService`, `callers of X` |
| **HYBRID** | Ambiguous/mixed queries | `jwt token`, `session management` |

## Architecture

```
Query Input
     │
     ▼
┌─────────────────────────────────────────────┐
│  JavaScript Pre-Check (query-router.js)     │
│                                             │
│  1. Structural regex patterns (~1μs)        │
│  2. File extension check (~0.1μs)           │
└─────────────────────────────────────────────┘
     │ not matched
     ▼
┌─────────────────────────────────────────────┐
│  WASM CatBoost Router (~10μs)               │
│                                             │
│  1. Feature extraction (50 features)        │
│  2. CatBoost inference (499 trees, depth 4) │
│  3. Softmax confidence computation          │
│  4. Reject option (uncertainty → HYBRID)    │
└─────────────────────────────────────────────┘
     │
     ▼
Route Result: { mode, confidence, rejected }
```

## Performance

| Metric | Value |
|--------|-------|
| **Inference latency** | ~10μs per query |
| **WASM binary size** | 225KB |
| **Model** | 499 trees, depth 4 |
| **Throughput** | ~100k queries/sec |

Compared to alternatives:
- 22x faster than JS CatBoost export (238μs)
- 4.5x smaller than JS export (1MB → 225KB)

## File Structure

```
sweet-search/
├── query-router.js              # Main entry point (WASM loader + JS pre-checks)
└── wasm-router/
    ├── pkg/
    │   ├── query_router_wasm.js     # WASM glue code (CommonJS)
    │   ├── query_router_wasm_bg.wasm # Compiled model
    │   ├── query_router_wasm.d.ts   # TypeScript definitions
    │   └── package.json
    ├── src/
    │   ├── lib.rs                   # WASM exports
    │   ├── features_v2.rs           # Feature extraction (50 features)
    │   ├── catboost_v2.rs           # Optimized inference
    │   └── keywords.rs              # Keyword detection via FNV-1a hash
    ├── Cargo.toml
    └── Cargo.lock
```

## Usage

### JavaScript API

```javascript
import { routeQuery, QueryRouter, extractFeatures } from './query-router.js';

// Simple usage (singleton)
const result = routeQuery("how does authentication work");
// { mode: 'semantic', confidence: 0.92, method: 'wasm_catboost', routingLatency_us: 12 }

// Instance usage
const router = new QueryRouter();
const result = router.route("callers of AuthService");
// { mode: 'structural', confidence: 0.95, structuralType: 'callers', targetEntity: 'AuthService', method: 'pattern' }

// Feature debugging
const features = extractFeatures("AuthService login flow");
// Float32Array(50) [1, 0, 1, 0, ...]
```

### Route Result Object

```typescript
interface RouteResult {
  mode: 'lexical' | 'semantic' | 'structural' | 'hybrid';
  confidence: number;       // 0.0-1.0
  method: string;           // 'pattern', 'file_pattern', 'wasm_catboost', 'wasm_rejected', 'fallback_error'
  routingLatency_us: number;

  // For structural routes only:
  structuralType?: 'callers' | 'callees' | 'implementations' | 'impact' | 'definition' | 'hierarchy';
  targetEntity?: string;
}
```

## Routing Pipeline

### Stage 1: Structural Pattern Detection (JavaScript, ~1μs)

Regex patterns catch structural queries with 100% accuracy before ML:

| Pattern | Matches | Example |
|---------|---------|---------|
| `callers` | Caller queries | `callers of X`, `what calls X`, `who uses X` |
| `callees` | Callee queries | `what does X call`, `dependencies of X` |
| `implementations` | Interface queries | `implementations of X`, `classes implementing X` |
| `impact` | Change analysis | `impact of changing X`, `what depends on X` |
| `definition` | Symbol lookup | `definition of X` |
| `hierarchy` | Call trees | `call hierarchy of X` |

### Stage 2: File Extension Check (JavaScript, ~0.1μs)

Routes file patterns directly to LEXICAL:

```
.java, .js, .jsx, .ts, .tsx, .py, .go, .rs, .kt, .swift, .rb, .php, .c, .cpp, .h, .proto, .json, .xml, .yml, .yaml, .md, .sql
```

Also matches path separators (`/`, `\`).

### Stage 3: WASM CatBoost Inference (~10μs)

50-feature classifier with reject option:

1. **Extract features** - Single-pass analysis (see Feature Reference below)
2. **Run 499 decision trees** - Depth 4, symmetric splits
3. **Compute softmax probabilities** - Stable max subtraction
4. **Apply reject option** - Low confidence → HYBRID fallback

## Reject Option

The reject option routes uncertain predictions to HYBRID (safe max-recall path):

| Class | Confidence Threshold | Margin Threshold |
|-------|---------------------|------------------|
| LEXICAL | 0.92 | 0.40 |
| SEMANTIC | 0.75 | 0.25 |
| STRUCTURAL | 0.60 | 0.15 |
| HYBRID | N/A | N/A |

**Logic:**
```rust
if confidence < threshold || (top1_score - top2_score) < margin {
    return HYBRID;  // rejected = true
}
```

HYBRID predictions are never rejected (already the safe fallback).

## Feature Reference (50 Features)

### Base Features (0-14)

| # | Name | Description |
|---|------|-------------|
| 0 | hasCamelBoundary | `[a-z][A-Z]` transition (camelCase) |
| 1 | hasUnderscoreWord | `_[a-z]` pattern (snake_case) |
| 2 | startsWithUpper | First char is uppercase |
| 3 | hasConsecutiveUpper | `[A-Z]{2,}` (acronyms, SCREAMING_SNAKE) |
| 4 | isSingleToken | 1 token, length > 2 |
| 5 | hasDotNotation | `\w\.\w` (property access) |
| 6 | hasParentheses | `()` present |
| 7 | hasFileExtension | `.java`, `.ts`, etc. |
| 8 | hasPathSeparator | `/` or `\` |
| 9 | tokenCount | Number of whitespace-separated tokens |
| 10 | avgTokenLength | char_count / token_count |
| 11 | uppercaseRatio | uppercase_chars / total_chars |
| 12 | digitRatio | digits / non_space_chars |
| 13 | nonAsciiRatio | non_ASCII_chars / char_count |
| 14 | hasNonLatinScript | CJK, Cyrillic, Arabic detected |

### Structural Features (15-19)

| # | Name | Description |
|---|------|-------------|
| 15 | hasCallerPattern | `callers`, `what calls`, `usages`, `references` |
| 16 | hasCalleePattern | `callees`, `what does X call`, `dependencies` |
| 17 | hasImplementationPattern | `implementations of`, `classes implementing` |
| 18 | hasImpactPattern | `impact`, `affected`, `downstream`, `dependencies` |
| 19 | hasIdentifierInQuery | Any valid identifier token present |

### Semantic Features (20-24)

| # | Name | Description |
|---|------|-------------|
| 20 | startsWithQuestionWord | `how`, `what`, `why`, `where`, etc. |
| 21 | hasQuestionMark | Query ends with `?` |
| 22 | hasSemanticConceptWord | `flow`, `process`, `mechanism`, `authentication`, etc. |
| 23 | hasExplanationRequest | `explain`, `describe`, `how`, `why`, `what` |
| 24 | hasHowDoesWork | `how does X work` pattern |

### Multilingual Features (25-29)

| # | Name | Description |
|---|------|-------------|
| 25 | hasNonAsciiIdentifier | Pure non-Latin identifier (2+ chars) |
| 26 | hasMixedScriptToken | Single token with multiple scripts |
| 27 | hasStructuralKeywordNonEn | Non-English structural keyword |
| 28 | hasSemanticKeywordNonEn | Non-English semantic keyword (no English match) |
| 29 | hasCrossScriptConcept | Mixed Latin + non-Latin with concept words |

### Discriminative Features (30-33)

| # | Name | Description |
|---|------|-------------|
| 30 | firstTokenIsIdentifier | First token is camelCase/PascalCase |
| 31 | lastTokenIsIdentifier | Last token is identifier (multi-token) |
| 32 | hasExplicitStructuralKeyword | Structural keyword (excluding `what`/`who`/`which`) |
| 33 | hasUnknownTrailingContent | Identifier + non-concept words |

### Grammar Features (34-37)

| # | Name | Description |
|---|------|-------------|
| 34 | identifierIndex | Position of first identifier token (0-1 normalized) |
| 35 | hasActionVerb | `handle`, `validate`, `authenticate`, etc. |
| 36 | hasQuestionIdentifier | Question + identifier at position 2/3 |
| 37 | structuralKeywordDensity | structural_count / 5, capped at 1.0 |

### Final Push Features (38-42)

| # | Name | Description |
|---|------|-------------|
| 38 | hasVerifiedAsciiIdentifier | camelCase, snake_case, or SCREAMING_SNAKE |
| 39 | structuralTemplateMatch | `what/who/which calls/uses/references` |
| 40 | hasNonEnglishConceptStem | Non-English concept word stems |
| 41 | highNonAsciiNoIdentifier | >70% non-ASCII, no identifier |
| 42 | expandedStructuralKeyword | Includes `-ing` forms like `implementing` |

### Zen Features (43-49)

| # | Name | Description |
|---|------|-------------|
| 43 | cjkDensity | CJK character ratio |
| 44 | effectiveTokenCount | Normalized token count (CJK adjusted) |
| 45 | longQuestion | 4+ tokens + question word |
| 46 | isStructuralQuestion | Question + structural keyword |
| 47 | tokenCharacterDensity | German compound word detector |
| 48 | hasNonLatinIdentifier | Cyrillic single-token |
| 49 | hasAllCapsConstant | `MAX_CONNECTIONS` pattern |

## Keyword Detection

Keywords are detected via FNV-1a hashing for O(1) lookup:

### Question Words (12)
`how`, `what`, `why`, `where`, `when`, `which`, `who`, `can`, `does`, `is`, `are`, `should`

### Structural Keywords (27)
`callers`, `caller`, `calls`, `call`, `callees`, `callee`, `uses`, `use`, `usages`, `usage`, `references`, `reference`, `implementations`, `implementation`, `implements`, `implement`, `extends`, `extend`, `dependencies`, `dependency`, `subtypes`, `subtype`, `impact`, `affected`, `downstream`, `inherits`, `inherit`

### Action Verbs (70)
`handle`, `send`, `calculate`, `compute`, `parse`, `validate`, `trigger`, `perform`, `initialize`, `process`, `execute`, `generate`, `fetch`, `store`, `load`, `save`, `create`, `update`, `delete`, `render`, `authenticate`, `authorize`, `cache`, `log`, etc.

## Building the WASM Module

Prerequisites: Rust toolchain with `wasm32-unknown-unknown` target.

```bash
cd wasm-router

# Build optimized WASM
cargo build --release --target wasm32-unknown-unknown

# Generate JS bindings (uses wasm-bindgen)
wasm-pack build --target nodejs --out-dir pkg

# Test
cargo test
```

## Training

The CatBoost model is trained separately:

```bash
cd training

# Train model (produces .cbm file)
python3 grid-search-catboost.py

# Export to Rust (manual process)
# 1. Extract trees from .cbm
# 2. Convert to Rust const arrays in catboost.rs
```

**Training data:** LLM-generated queries with manual review
**Classes:** LEXICAL (0), SEMANTIC (1), STRUCTURAL (2), HYBRID (3)
**Class weights:** `[1.0, 1.0, 1.0, 5.0]` (HYBRID weighted 5x)

## Known Limitations

1. **German/Spanish ASCII identifiers** - `DatenService`, `ServicioDatos` route to LEXICAL (no language detection features)
2. **Pure non-ASCII structural** - May route to HYBRID instead of STRUCTURAL when English keywords absent
3. **Very short queries** - 1-2 lowercase words often route to HYBRID (conservative)

## Debugging

### Check feature extraction

```javascript
import { extractFeatures } from './query-router.js';

const f = extractFeatures("what calls AuthService");
console.log('hasCamelBoundary:', f[0]);  // 1.0 (AuthService)
console.log('hasCallerPattern:', f[15]); // 1.0 (what calls)
console.log('tokenCount:', f[9]);        // 3.0
```

### Verify routing decision

```javascript
import { routeQuery } from './query-router.js';

const result = routeQuery("getUserById");
console.log(result);
// { mode: 'lexical', confidence: 0.98, method: 'wasm_catboost', routingLatency_us: 8 }
```

### Force hybrid fallback

Set low confidence threshold in lib.rs REJECT_THRESHOLDS or test with ambiguous queries.

## Related Documentation

- **[docs/TRANSLATION.md](docs/TRANSLATION.md)** - Multilingual query translation (non-English queries are translated to English before routing)
- **[STRUCTURAL-QUERIES.md](STRUCTURAL-QUERIES.md)** - GraphRAG structural query patterns ("what calls X")
- **[.claude/docs/search/README.md](../../docs/search/README.md)** - Smart Search documentation index

## Changelog

- **Jan 2026**: WASM-only architecture (removed JS CatBoost, ID3)
- **Dec 2025**: CatBoost v4.5 with reject option (94.3% utility)
- **Nov 2025**: Initial ML classifier (LightGBM)
- **Oct 2025**: Heuristics-only router (54% accuracy)

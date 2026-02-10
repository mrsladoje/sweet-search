# SEARCH 100x Evaluation Harness

> **Status:** Production-ready | **Location:** `./evaluation/`

A comprehensive quality evaluation framework for the SEARCH 100x hybrid code search engine. Measures retrieval quality using standard IR metrics (MRR, NDCG, MAP, Recall) with ground-truth query sets.

---

## Quick Start

```bash
# Navigate to search directory
cd .

# Install dependencies (first time only)
npm install

# Run full evaluation (all 80+ queries across 4 categories)
node evaluation/run-evaluation.js

# Run specific category only
node evaluation/run-evaluation.js --category=identifier

# Save baseline for regression detection
node evaluation/run-evaluation.js --baseline

# CI mode (exit 1 if below targets)
node evaluation/run-evaluation.js --ci
```

---

## CLI Options

| Option            | Description                                                 | Default |
| ----------------- | ----------------------------------------------------------- | ------- |
| `--category=NAME` | Run only: `identifier`, `conceptual`, `structural`, `mixed` | All     |
| `--baseline`      | Save results to `results/baseline-YYYY-MM-DD.json`          | -       |
| `--compare=FILE`  | Compare against baseline JSON, detect regressions           | -       |
| `--ci`            | Exit code 1 if metrics below targets                        | -       |
| `--concurrency=N` | Parallel query execution (1-50)                             | 5       |
| `--output=FILE`   | Save JSON report to file                                    | -       |
| `--no-color`      | Disable ANSI colors                                         | -       |
| `--verbose, -v`   | Show per-query details                                      | -       |
| `--help, -h`      | Show help message                                           | -       |

### Exit Codes

| Code | Meaning                                               |
| ---- | ----------------------------------------------------- |
| 0    | Success - all metrics meet targets                    |
| 1    | Metrics below target thresholds                       |
| 2    | Configuration error (invalid JSON, schema validation) |
| 3    | Infrastructure error (search system failure)          |
| 4    | Baseline regression detected                          |

---

## Success Targets

From SEARCH_200X.md quality objectives:

| Metric         | Target   | Description                                       |
| -------------- | -------- | ------------------------------------------------- |
| MRR@10         | > 0.72   | Mean Reciprocal Rank of first relevant result     |
| NDCG@10        | > 0.68   | Normalized Discounted Cumulative Gain             |
| MAP@10         | > 0.70   | Mean Average Precision                            |
| Recall@20      | > 0.88   | Fraction of relevant docs retrieved in top 20     |
| Success@10     | > 90%    | Queries with ≥1 relevant result in top 10         |
| Route Accuracy | > 90%    | Correct routing (lexical/semantic/structural)     |
| Cache Hit Rate | > 80%    | Queries served from vocabulary/LRU/semantic cache |
| Cost/Query     | < $0.001 | Average API cost per query                        |

---

## Query Categories

### 1. Identifier (`query-sets/identifier.json`)

Exact class/function name lookups. Expected route: **lexical**.

```json
{
  "id": "IDN-001",
  "query": "EmployeeService",
  "expected": {
    "exact": [
      { "file": "EmployeeService.java", "type": "class", "relevanceGrade": 3 }
    ]
  }
}
```

### 2. Conceptual (`query-sets/conceptual.json`)

Natural language questions. Expected route: **semantic**.

```json
{
  "id": "CON-001",
  "query": "how does authentication work",
  "expected": {
    "anyOf": [
      {
        "files": ["AuthService.java", "LoginService.java", "JwtTokenUtil.java"],
        "minMatches": 2
      }
    ]
  }
}
```

### 3. Structural (`query-sets/structural.json`)

Relationship queries (callers, callees, impact). Expected route: **structural**.

```json
{
  "id": "STR-001",
  "query": "what calls EmployeeService",
  "structuralSubtype": "callers",
  "expected": {
    "contains": [{ "mode": "any", "typeIn": ["class", "method"] }],
    "excluded": ["EmployeeService.java"]
  },
  "minRelevant": 2
}
```

### 4. Mixed (`query-sets/mixed.json`)

Ambiguous queries requiring hybrid search. Expected route: **hybrid**.

```json
{
  "id": "MIX-001",
  "query": "employee time tracking",
  "expected": {
    "contains": [
      { "filePattern": "**/*Employee*.java" },
      { "filePattern": "**/*Realization*.java" }
    ]
  }
}
```

---

## Match Types

### `exact` - Strict File/Symbol Match

Highest priority, relevance grade 3 (default).

```json
"exact": [
  {
    "file": "AuthService.java",      // Required: filename or path
    "name": "authenticate",           // Optional: symbol name
    "type": "method",                 // Optional: class|interface|method|function|field
    "lineRange": [50, 100],           // Optional: expected line range [start, end]
    "relevanceGrade": 3               // Optional: 1-3 (default 3)
  }
]
```

### `anyOf` - At Least N from Set

Relevance grade 2. Use for conceptual queries with multiple valid answers.

```json
"anyOf": [
  {
    "files": ["AuthService.java", "LoginService.java", "SecurityConfig.java"],
    "minMatches": 2   // At least 2 of these 3 files must appear
  }
]
```

### `contains` - Pattern Matching

Relevance grade 1 (any mode) or 2 (all mode).

```json
"contains": [
  {
    "mode": "any",                      // "any" = at least one pattern matches
    "filePattern": "**/Auth*.java",     // Glob pattern
    "namePattern": "^authenticate",     // Regex for symbol name
    "typeIn": ["class", "method"]       // Allowed symbol types
  },
  {
    "mode": "all",                      // "all" = all patterns must match
    "filePattern": "**/Service.java",
    "typeIn": ["class"]
  }
]
```

### `excluded` - Negative Testing

Files that must NOT appear in results.

```json
"excluded": ["EmployeeService.java", "**/test/**"]
```

Use for structural queries where the source entity shouldn't appear in its own callers/callees.

---

## Relevance Grades

| Grade | Meaning             | Assigned By                               |
| ----- | ------------------- | ----------------------------------------- |
| 3     | Highly relevant     | `exact` matches                           |
| 2     | Relevant            | `anyOf` matches, `contains` with mode=all |
| 1     | Marginally relevant | `contains` with mode=any                  |
| 0     | Not relevant        | No match or excluded                      |

---

## Metrics Explained

### MRR@K (Mean Reciprocal Rank)

Position of first relevant result. MRR = 1/rank. Perfect = 1.0.

```
Query 1: Relevant at rank 1 → RR = 1/1 = 1.0
Query 2: Relevant at rank 3 → RR = 1/3 = 0.33
MRR = (1.0 + 0.33) / 2 = 0.67
```

### NDCG@K (Normalized Discounted Cumulative Gain)

Quality of ranking, accounting for position and relevance grade.

```
DCG = Σ (rel_i / log2(i + 1))     # Discounted by position
NDCG = DCG / IDCG                  # Normalized against ideal ranking
```

### MAP@K (Mean Average Precision)

Precision at each relevant result, averaged.

```
For each relevant doc at position k: P@k = relevant_so_far / k
AP = Σ(P@k * rel_k) / total_relevant
MAP = mean(AP) across all queries
```

### Recall@K

Fraction of relevant documents found in top K results.

```
Recall@20 = |relevant in top 20| / |total relevant|
```

### Success Rate@K

Binary: did we find at least `minRelevant` results in top K?

```
Success@10 = |queries with ≥1 relevant in top 10| / |total queries|
```

---

## Report Output

### Console Report (Default)

```
SEARCH 100x EVALUATION REPORT
==================================================
Timestamp: 2026-01-04T04:00:00.000Z
Queries: 80

Aggregate Metrics:
  MRR@10:      0.7826 (95% CI: 0.609-0.957)
  NDCG@10:     0.8923 (95% CI: 0.691-1.100)
  MAP@10:      0.9565 (95% CI: 0.696-1.174)
  Recall@20:   0.9565 (95% CI: 0.696-1.217)
  Success@10:  78.3%

Routing:
  Route Accuracy: 100.0% (80/80)

Cache Efficiency:
  Hit Rate: 85.0%
  Breakdown: vocabulary=40, lru=20, semantic=8, api=12

Latency (by thermal state):
  Cold start (1 queries): p50=1200ms, p95=1200ms, p99=1200ms
  Warm uncached (12 queries): p50=275ms, p95=350ms, p99=400ms
  Warm cached (67 queries): p50=8ms, p95=15ms, p99=22ms

Cost:
  Embed: $0.000054 (12 API calls, 68 cached)
  Rerank: $0.000000 (0 API calls, 80 skipped)
  Total: $0.000054
  Avg/query: $0.000001

By Category:
  identifier (23 queries):
    MRR=0.913, Success@10=91.3%, Route=100.0%
  conceptual (20 queries):
    MRR=0.750, Success@10=80.0%, Route=95.0%
  structural (20 queries):
    MRR=0.650, Success@10=70.0%, Route=100.0%
  mixed (22 queries):
    MRR=0.706, Success@10=76.5%, Route=88.2%

Failed Queries (0 relevant in top 10):
  - IDN-013: "DetectionHeuristic"
  - CON-015: "how does gRPC streaming work"
```

### JSON Report (`--output=report.json`)

Full machine-readable report with all metrics, per-query results, and failed query details.

### JUnit XML (Programmatic)

For CI systems (Jenkins, GitHub Actions):

```javascript
import { formatJUnitReport } from "./lib/report-generator.js";
const xml = formatJUnitReport(report);
```

---

## Baseline Comparison

### Create Baseline

```bash
node evaluation/run-evaluation.js --baseline
# Saves to: results/baseline-2026-01-04.json
```

### Compare Against Baseline

```bash
node evaluation/run-evaluation.js --compare=results/baseline-2026-01-04.json --ci
```

Output:

```
BASELINE COMPARISON
==================================================

[WARNING] REGRESSIONS DETECTED:
  - MRR@10: 0.7826 -> 0.7200 (-0.0626)
  - Success@10: 0.9000 -> 0.8500 (-0.0500)

[OK] IMPROVEMENTS:
  - Latency (warm p50): 15ms -> 8ms (ratio: 0.53)
```

### Regression Thresholds

| Metric       | Default Threshold |
| ------------ | ----------------- |
| MRR          | -0.02 (2% drop)   |
| NDCG         | -0.02 (2% drop)   |
| Success Rate | -0.05 (5% drop)   |
| Latency      | 1.5x slower       |

---

## CI Integration

### GitHub Actions Example

```yaml
name: Search Quality
on: [push, pull_request]

jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies
        run: |
          cd .
          npm ci

      - name: Run evaluation
        run: |
          cd .
          node evaluation/run-evaluation.js --ci --output=report.json

      - name: Upload report
        uses: actions/upload-artifact@v4
        with:
          name: search-quality-report
          path: ./report.json
```

### Exit Code Handling

```bash
# In CI script
node evaluation/run-evaluation.js --ci --compare=baseline.json
EXIT_CODE=$?

case $EXIT_CODE in
  0) echo "All metrics pass" ;;
  1) echo "Metrics below target - quality issue" && exit 1 ;;
  2) echo "Configuration error - fix query sets" && exit 1 ;;
  3) echo "Search system failure - infrastructure issue" && exit 1 ;;
  4) echo "Regression from baseline - investigate changes" && exit 1 ;;
esac
```

---

## Creating New Query Sets

### 1. Query Set Structure

```json
{
  "schemaVersion": "1.0",
  "category": "identifier",
  "expectedRoute": "lexical",
  "codebaseCommit": "bc23643cd07cbd5bed6a85e0951fad76b9aefeeb",
  "validatedDate": "2026-01-04",
  "description": "Exact identifier queries for Java classes",
  "queries": [
    {
      "id": "IDN-001",
      "query": "EmployeeService",
      "expected": { ... },
      "minRelevant": 1,
      "notes": "Optional notes about this query"
    }
  ]
}
```

### 2. Query ID Convention

| Category   | Prefix | Example          |
| ---------- | ------ | ---------------- |
| Identifier | IDN    | IDN-001, IDN-050 |
| Conceptual | CON    | CON-001, CON-020 |
| Structural | STR    | STR-001, STR-016 |
| Mixed      | MIX    | MIX-001, MIX-010 |

### 3. Validate Schema

Query sets are validated against `query-sets/schema.json`:

```bash
# Validation runs automatically on load
node evaluation/run-evaluation.js --category=identifier
# Will fail with line-specific errors if schema invalid
```

### 4. Tips for Ground Truth

1. **Run query first**: Test with `./ss "query"` to see actual results
2. **Use `anyOf` for conceptual**: Multiple valid answers exist
3. **Use `excluded` for structural**: Source entity shouldn't appear
4. **Set `minRelevant` appropriately**: 1 for specific, 2-5 for broad queries
5. **Update `codebaseCommit`**: When validating against specific code state

---

## Architecture

```
evaluation/
├── run-evaluation.js      # Main CLI runner
├── query-sets/
│   ├── schema.json        # JSON Schema for validation
│   ├── identifier.json    # 23 identifier queries
│   ├── conceptual.json    # 20 conceptual queries
│   ├── structural.json    # 20 structural queries
│   └── mixed.json         # 22 mixed queries
├── lib/
│   ├── metrics.js         # IR metrics (MRR, NDCG, MAP, Recall)
│   ├── result-matcher.js  # Ground truth matching logic
│   ├── cost-tracker.js    # API cost tracking
│   └── report-generator.js # Report formatting
├── results/
│   └── baseline-*.json    # Saved baselines
└── __tests__/
    ├── metrics.test.js
    ├── result-matcher.test.js
    └── report-generator.test.js
```

---

## Latency Classification

Queries are classified by "thermal state":

| State         | Description                            | Typical Latency |
| ------------- | -------------------------------------- | --------------- |
| Cold          | First query after restart              | 1000-2000ms     |
| Warm Uncached | Server warm, novel query               | 200-400ms       |
| Warm Cached   | Query in vocabulary/LRU/semantic cache | 5-20ms          |

This separation prevents cold start latency from skewing p50/p95 metrics.

---

## Cost Tracking

Tracks API costs for embeddings and reranking:

| Provider               | Embeddings      | Reranking        |
| ---------------------- | --------------- | ---------------- |
| Voyage (voyage-code-3) | $0.18/1M tokens | $0.05/1M tokens  |
| Jina                   | $0.02/1M tokens | $0.018/1M tokens |
| Mistral                | $0.20/1M tokens | N/A              |
| FlashRank (local)      | $0              | $0               |

Cache hits and rerank skips (via score spread analysis) reduce costs.

---

## Running Unit Tests

```bash
cd .

# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

Tests cover:

- `metrics.test.js`: MRR, NDCG, MAP, Recall, Bootstrap CI calculations
- `result-matcher.test.js`: Exact/anyOf/contains/excluded matching
- `report-generator.test.js`: Report formatting, baseline comparison

---

## Troubleshooting

### "Schema validation failed"

Check your query set against `schema.json`. Common issues:

- Missing required fields (`id`, `query`, `expected`)
- Invalid `id` format (must be `XXX-NNN`)
- Invalid `expectedRoute` value

### "No queries found for category"

Category name must be exact: `identifier`, `conceptual`, `structural`, `mixed`

### Low Success Rate but High MRR

Results are found but not matching ground truth. Check:

- File names in `expected.exact` match actual filenames
- Path separators (use `/` not `\`)
- Case sensitivity (default: case-insensitive)

### 0% Cache Hit Rate

Expected on first run. Run twice to see caching:

```bash
node evaluation/run-evaluation.js --category=identifier
node evaluation/run-evaluation.js --category=identifier  # Second run shows cache hits
```

---

_Document created: January 4, 2026_
_Harness version: 1.0_
_Tested with: SEARCH 100x v2.3.0_


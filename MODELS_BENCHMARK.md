# Translation Models Benchmark Results

**Generated:** 2026-01-10T20:04:09.232Z
**Test Queries:** 19 queries across 9 languages

---

## Executive Summary

- **Best Accuracy:** groq-llama3.3-70b, cerebras-llama3.1-8b, groq-llama3.1-8b-instant (all 94.7%)
- **Best Value:** groq-llama3.1-8b-instant (94.7% accuracy, $0.0030/1K queries)
- **Fastest Cloud:** groq-llama3.3-70b (266ms avg)
- **Best Free Local:** nllb-200-distilled-600M (78.9% accuracy, FREE)
- **Best Free Cloud:** openrouter-mistral-small-free (63.2% accuracy, FREE but slow)

---

## Cloud Translation Models

| Model ID | Provider | Accuracy | Avg Latency | P95 Latency | Cost/1K Queries | Input $/M | Output $/M | Notes |
|----------|----------|----------|-------------|-------------|-----------------|-----------|------------|-------|
| cerebras-llama3.1-8b | Cerebras | 94.7% | 467ms | 1236ms | $0.0059 | $0.10 | $0.10 | Current default, general LLM |
| cerebras-qwen3-32b | Cerebras | 0.0% | 340ms | 475ms | $0.0074 | $0.10 | $0.30 | Best multilingual, MoE efficient |
| groq-llama3.1-8b-instant | Groq | 94.7% | 332ms | 1049ms | $0.0030 | $0.05 | $0.08 | 50% cheaper than Cerebras |
| groq-llama3.3-70b | Groq | 94.7% | 266ms | 359ms | $0.0312 | $0.59 | $0.79 | Better quality, higher cost |
| openrouter-llama4-scout-free | OpenRouter | 0.0% | 0ms | 0ms | $0.0000 | $0.00 | $0.00 | FREE tier, Llama 4 Scout |
| openrouter-mistral-small-free | OpenRouter | 63.2% | 3181ms | 8962ms | $0.0000 | $0.00 | $0.00 | FREE tier, Mistral Small 24B (100+ langs) |

### Cloud Model Details

#### cerebras-llama3.1-8b

| Metric | Value |
|--------|-------|
| Provider | Cerebras |
| Model | `llama3.1-8b` |
| Accuracy | 94.7% (18/19) |
| Avg Latency | 467ms |
| P50 Latency | 411ms |
| P95 Latency | 1236ms |
| Min/Max Latency | 252ms / 1236ms |
| Failures | 0 |
| Input Tokens | 950 |
| Output Tokens | 173 |
| Total Cost | $0.000112 |
| Cost per 1000 Queries | $0.0059 |
| Speed | 1800 tok/s |
| Multilingual | Good |

#### cerebras-qwen3-32b

| Metric | Value |
|--------|-------|
| Provider | Cerebras |
| Model | `qwen-3-32b` |
| Accuracy | 0.0% (0/19) |
| Avg Latency | 340ms |
| P50 Latency | 314ms |
| P95 Latency | 475ms |
| Min/Max Latency | 250ms / 475ms |
| Failures | 0 |
| Input Tokens | 1058 |
| Output Tokens | 114 |
| Total Cost | $0.000140 |
| Cost per 1000 Queries | $0.0074 |
| Speed | ~1000 tok/s |
| Multilingual | 100+ langs |

#### groq-llama3.1-8b-instant

| Metric | Value |
|--------|-------|
| Provider | Groq |
| Model | `llama-3.1-8b-instant` |
| Accuracy | 94.7% (18/19) |
| Avg Latency | 332ms |
| P50 Latency | 250ms |
| P95 Latency | 1049ms |
| Min/Max Latency | 211ms / 1049ms |
| Failures | 0 |
| Input Tokens | 950 |
| Output Tokens | 122 |
| Total Cost | $0.000057 |
| Cost per 1000 Queries | $0.0030 |
| Speed | 840 tok/s |
| Multilingual | Good |

#### groq-llama3.3-70b

| Metric | Value |
|--------|-------|
| Provider | Groq |
| Model | `llama-3.3-70b-versatile` |
| Accuracy | 94.7% (18/19) |
| Avg Latency | 266ms |
| P50 Latency | 271ms |
| P95 Latency | 359ms |
| Min/Max Latency | 215ms / 359ms |
| Failures | 0 |
| Input Tokens | 950 |
| Output Tokens | 40 |
| Total Cost | $0.000592 |
| Cost per 1000 Queries | $0.0312 |
| Speed | 394 tok/s |
| Multilingual | Excellent |

#### openrouter-llama4-scout-free

| Metric | Value |
|--------|-------|
| Provider | OpenRouter |
| Model | `meta-llama/llama-4-scout:free` |
| Accuracy | 0.0% (0/19) |
| Avg Latency | 0ms |
| P50 Latency | 0ms |
| P95 Latency | 0ms |
| Min/Max Latency | 0ms / 0ms |
| Failures | 19 |
| Input Tokens | 0 |
| Output Tokens | 0 |
| Total Cost | $0.000000 |
| Cost per 1000 Queries | $0.0000 |
| Speed | ~1000 tok/s |
| Multilingual | Excellent |

#### openrouter-mistral-small-free

| Metric | Value |
|--------|-------|
| Provider | OpenRouter |
| Model | `mistralai/mistral-small-3.1-24b-instruct:free` |
| Accuracy | 63.2% (12/19) |
| Avg Latency | 3181ms |
| P50 Latency | 1028ms |
| P95 Latency | 8962ms |
| Min/Max Latency | 923ms / 8962ms |
| Failures | 6 |
| Input Tokens | 9855 |
| Output Tokens | 205 |
| Total Cost | $0.000000 |
| Cost per 1000 Queries | $0.0000 |
| Speed | ~800 tok/s |
| Multilingual | Excellent |

---

## Local Translation Models

| Model ID | Name | Accuracy | Avg Latency | P95 Latency | Init Time | Size | Languages | Quality |
|----------|------|----------|-------------|-------------|-----------|------|-----------|---------|
| nllb-200-distilled-600M | NLLB-200 Distilled | 78.9% | 810ms | 1646ms | 5887ms | 600MB | 200+ | Medium |
| opus-mt-mul-en | Opus-MT Many→English | ERROR | - | - | - | 300MB | - | Failed to load: Could not loca |
| mt5-small | mT5 Small | ERROR | - | - | - | 300MB | - | Failed to load: Could not loca |
| t5-small | T5 Small | 26.3% | 89ms | 263ms | 546ms | 250MB | EN-XX | Medium |

### Local Model Details

#### nllb-200-distilled-600M

| Metric | Value |
|--------|-------|
| Name | NLLB-200 Distilled |
| Model | `Xenova/nllb-200-distilled-600M` |
| Accuracy | 78.9% (15/19) |
| Avg Latency | 810ms |
| P50 Latency | 720ms |
| P95 Latency | 1646ms |
| Min/Max Latency | 526ms / 1646ms |
| Init Time | 5887ms |
| Failures | 0 |
| Size | 600MB |
| Languages | 200+ |
| Quality | Medium |
| Cost | FREE |

#### t5-small

| Metric | Value |
|--------|-------|
| Name | T5 Small |
| Model | `Xenova/t5-small` |
| Accuracy | 26.3% (5/19) |
| Avg Latency | 89ms |
| P50 Latency | 55ms |
| P95 Latency | 263ms |
| Min/Max Latency | 35ms / 263ms |
| Init Time | 546ms |
| Failures | 0 |
| Size | 250MB |
| Languages | EN-XX |
| Quality | Medium |
| Cost | FREE |

---

## Comparison Matrix

| Rank | Model | Type | Accuracy | Latency | Cost/1K | Best For |
|------|-------|------|----------|---------|---------|----------|
| 1 | cerebras-llama3.1-8b | Cloud | 94.7% | 467ms | $0.0059 | Best accuracy |
| 2 | groq-llama3.1-8b-instant | Cloud | 94.7% | 332ms | $0.0030 | Speed + accuracy |
| 3 | groq-llama3.3-70b | Cloud | 94.7% | 266ms | $0.0312 | Speed + accuracy |
| 4 | nllb-200-distilled-600M | Local | 78.9% | 810ms | $0.0000 | Zero cost |
| 5 | openrouter-mistral-small-free | Cloud | 63.2% | 3181ms | $0.0000 | Zero cost |
| 6 | t5-small | Local | 26.3% | 89ms | $0.0000 | Zero cost |
| 7 | cerebras-qwen3-32b | Cloud | 0.0% | 340ms | $0.0074 | Budget option |
| 8 | openrouter-llama4-scout-free | Cloud | 0.0% | 0ms | $0.0000 | Zero cost |

---

## Recommendations

### Primary Recommendation: Best Value

**Cloud Provider:** groq-llama3.1-8b-instant
- Accuracy: 94.7%
- Latency: 332ms avg
- Cost: $0.0030/1000 queries (~50% cheaper than Cerebras)

### Alternative: Lowest Latency

**Cloud Provider:** groq-llama3.3-70b
- Accuracy: 94.7%
- Latency: 266ms avg (fastest)
- Cost: $0.0312/1000 queries (10x more expensive)

### Fallback: Local Model

**Local Model:** nllb-200-distilled-600M
- Accuracy: 78.9%
- Latency: 810ms avg
- Cost: FREE
- Use when: Offline mode, API unavailable, cost-sensitive

### Zero-Cost Cloud (Rate Limited)

**Free Cloud:** openrouter-mistral-small-free
- Accuracy: 63.2%
- Latency: 3181ms avg (slow due to rate limiting)
- Cost: FREE
- Use when: No budget for API, willing to accept lower accuracy

### Configuration Priority Order

```
1. Cloud Primary: groq-llama3.1-8b-instant (best value)
2. Cloud Backup: cerebras-llama3.1-8b (alternative provider)
3. Local Fallback: nllb-200-distilled-600M (offline/free)
4. Passthrough (no translation)
```

### Models NOT Recommended

| Model | Issue |
|-------|-------|
| cerebras-qwen3-32b | Outputs `<think>` reasoning tags (0% accuracy) |
| openrouter-llama4-scout-free | Model endpoint not available (404 errors) |
| opus-mt-mul-en | Tokenizer files missing on HuggingFace |
| mt5-small | ONNX files missing on HuggingFace |
| t5-small | Low accuracy (26.3%), English-centric only |

---

## Test Queries

| Language | Query | Expected |
|----------|-------|----------|
| sr | аутентификација | authentication |
| sr | корисник | user |
| sr | запослени | employee |
| sr | пројекат | project |
| ru | пользователь | user |
| ru | авторизация | authorization |
| de | Größe | size |
| de | Mitarbeiter | employee |
| de | Benutzer | user |
| fr | utilisateur | user |
| fr | authentification | authentication |
| es | usuario | user |
| es | autenticación | authentication |
| ja | 認証 | authentication |
| ja | ユーザー | user |
| zh | 用户 | user |
| zh | 认证 | authentication |
| ko | 사용자 | user |
| ko | 인증 | authentication |

---

*Generated by benchmark-all-models.js*
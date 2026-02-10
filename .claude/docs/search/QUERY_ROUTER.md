# Query Router

> **This document has moved.**
>
> The authoritative Query Router documentation is now at:
> **[`QUERY-ROUTING.md`](../../QUERY-ROUTING.md)**

## Summary

The Query Router uses a **WASM CatBoost model** (499 trees, depth 4) for intelligent query classification:

| Mode | Use Case | Example |
|------|----------|---------|
| **LEXICAL** | Exact identifier search | `AuthService`, `getUserById`, `*.java` |
| **SEMANTIC** | Conceptual questions | `how does authentication work` |
| **STRUCTURAL** | Code dependency queries | `what calls AuthService`, `callers of X` |
| **HYBRID** | Ambiguous/mixed queries | `jwt token`, `session management` |

## Performance

- **Latency:** ~10μs per query
- **Binary size:** 225KB WASM
- **Model:** 499 trees, depth 4, 50 features
- **Throughput:** ~100k queries/sec

## Quick Reference

```javascript
import { routeQuery } from './query-router.js';

const result = routeQuery("how does authentication work");
// { mode: 'semantic', confidence: 0.92, method: 'wasm_catboost', routingLatency_us: 12 }
```

See the full documentation at [QUERY-ROUTING.md](../../QUERY-ROUTING.md) for:
- Complete 50-feature reference
- Reject option thresholds
- Structural pattern detection
- Building the WASM module
- Debugging tips

## Related

- **[TRANSLATION.md](../../docs/TRANSLATION.md)** - Multilingual query translation (non-English queries are translated before routing)

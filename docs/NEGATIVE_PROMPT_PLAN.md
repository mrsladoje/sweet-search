# Negative Prompt Plan

> **Status**: Rough idea — needs further research before execution.

## Concept

Allow users to provide a negative prompt in a sweet-search pipeline that excludes results matching unwanted concepts. The negative prompt acts as a semantic filter: results close to the negative prompt in embedding space are penalized or removed.

### Example CLI usage

```bash
sweet-search "authorization flow" -not "jwt token"
```

This should return results about authorization flows but actively avoid results that are primarily about JWT tokens.

## Rough Design Ideas

### 1. Query-time subtraction

Embed both the positive query and the negative prompt. At scoring time, penalize candidates whose similarity to the negative embedding exceeds a threshold.

```
final_score = sim(doc, positive) - α * max(0, sim(doc, negative) - threshold)
```

- `α` — weight of the negative penalty (tunable, default ~0.3–0.5)
- `threshold` — similarity floor below which negative prompt has no effect

### 2. Pipeline stage

A `NegativePromptStage` that slots into the reranking pipeline after initial retrieval but before final ranking. This keeps the core search path untouched and makes the feature opt-in.

```
query → embed → HNSW recall → negative filter → rerank → results
```

### 3. Multi-negative support

Users may want to exclude multiple concepts:

```bash
sweet-search "authorization flow" -not "jwt token" -not "oauth2 redirect"
```

Each negative prompt produces its own embedding; penalties are combined (max or sum — TBD).

## Open Questions

- **Embedding approach**: Do we embed the negative prompt with the same model as the positive query, or does a separate lightweight model work better for exclusion?
- **Penalty vs hard filter**: Should high-similarity negatives be penalized (soft) or removed entirely (hard cutoff)? Probably configurable.
- **Interaction with lexical pipeline**: How does `-not` interact with BM25/lexical scores? Separate penalty or unified?
- **Performance**: Adding a second (or N) embedding pass per query adds latency. Acceptable for interactive use? Can we batch?
- **Threshold tuning**: What's a sane default threshold? Needs benchmarking against real queries.
- **CLI parsing**: The `-not` flag syntax needs to not collide with existing flags. Alternatives: `--exclude`, `!`, `NOT` operator.

## Next Steps

1. Research how negative prompts are handled in vector DB literature and image-generation pipelines (CLIP negative prompts may have transferable ideas).
2. Prototype the scoring formula on existing benchmark queries to see if penalty-based subtraction degrades precision.
3. Decide on pipeline placement and API surface.
4. Benchmark latency impact of multi-embedding queries.

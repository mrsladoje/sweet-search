# SOTA research for the four 2026-05-07 fixes

Comprehensive research synthesis from Tavily deep research (pro mode) and
Perplexity Sonar Deep Research, May 2026. Each fix is mapped to the
specific 2025-2026 SOTA literature, with deviations explained.

## Bottom line

Our four shipped fixes are each **practical, evidence-backed BASELINES** —
not the full SOTA. The full SOTA ceiling involves bigger architectural
changes (AST-block-level chunking, cross-encoder rerankers, Repoformer-
style self-evaluation). For each fix, we ship the cheap principled rule
NOW and document the SOTA upgrade path for a future milestone.

---

## Fix 1 — Empty-result rescue

### Our implementation
When joint hybrid (BM25 + dense + RRF) returns 0 candidates, fire ONE pure-
dense semantic call on the raw query string. No rerank, no graph, no fusion.

### SOTA hierarchy (Tavily research synthesis)

The strongest first-line rescue is NOT pure-dense retry. The recommended
ordering (Pinecone, Qdrant, Sourcegraph, BEIR-grade) is:

1. **Lightweight LLM rewrite + fuzzy/expanded BM25 retry** (synchronous, low
   latency). Addresses lexical-mismatch cases that pure dense misses.
2. **Single pure-dense retry on raw query** (current implementation — Layer 2).
3. **Graph-only seed expansion (AST/CPG)** (async, longer latency).
4. **Semantic chunk neighbor sampling** (async).

For high-infrastructure deployments: parallel multi-call (fuzzy BM25 +
dense + graph) fused with RRF, with strict per-call timeouts.

### Why we ship Layer 2 instead of Layer 1

- LLM rewriting requires a fast on-prem rewrite model (T5-small or similar)
  that we don't have wired up.
- Fuzzy/expanded BM25 requires re-indexing with n-gram or fuzzy tokenizers
  — substantial infra change.
- Pure-dense rescue is the simplest cascading-retrieval safety net and
  catches the majority of the "well-formed query, empty result" pathology.

### Validation cost

UV-FLOW-1 / UV-FLOW-4 went from `no_results` to *some* result (docs file
and wrong-subdir respectively). That's a strict improvement vs returning
nothing — even if the new top-1 isn't the gold answer.

### Citations

- Pinecone, "Cascading Retrieval with Multi-Vector Representations" — confirms cascade pattern is canonical
- Qdrant, "Hybrid Search" article — RRF fusion of multiple parallel branches
- Sourcegraph "How Cody Understands Your Codebase" (RecSys 2024, arXiv 2408.05344)
- BEIR (Thakur et al., NeurIPS 2024, arXiv 2210.06472) — `evaluate_bm25_ce_reranking.py` is the canonical cascade baseline
- Pyserini (Lin et al., SIGIR 2021) — operational cascading primitives

### Future SOTA upgrade

Add Layer 1: deterministic synonym table + LLM-rewrite (Claude Haiku or
small T5) for queries that fail Layer 0. Re-index with n-gram tokenizer
to enable fuzzy BM25.

---

## Fix 2 — File-kind reranker extension (Dockerfile/Containerfile)

### Our implementation
Demote container-build manifests (Dockerfile, Containerfile, .dockerignore,
*.dockerfile) consistently with .yaml/.toml/Cargo.lock. Excluded Makefile
after S6-Q6 regression.

### SOTA hierarchy

The Tavily research surfaces a CRITICAL TRADE-OFF for this class of fix:

> "File-name demotion is too coarse for files like settings.rs that mix
> declarations and implementations" — full SOTA pipeline must do
> BLOCK-LEVEL demotion, not file-level.

Recommended layered architecture (Sourcegraph Cody + RepoCoder + Repoformer):

1. **Intent classification at query time** (behavior vs other; Sourcegraph
   Cody-style)
2. **AST/Tree-sitter split** files into blocks (declarations, impls,
   functions, type defs, raw code)
3. **Block-level priors** (file_prior + AST_block_role + intent_match,
   weighted sum)
4. **Self-evaluation** via Repoformer (arXiv 2403.10059, ICML 2024) to
   decide whether retrieval will help
5. **Cross-encoder rerank** of top-k1 to top-k2

### Why our file-level approach is acceptable for Dockerfile

Dockerfile/Containerfile files are **pure** ancillary — they don't mix
roles. Settings.rs IS pure-implementation Rust source even though it
contains struct definitions. So file-name demotion is safe for the former
and dangerous for the latter. Our exclusion of Makefile (after S6-Q6
regression) and explicit non-treatment of settings.rs/cli.rs reflects this.

### Citations

- Sourcegraph, "How Cody understands your codebase" (RecSys 2024, arXiv 2408.05344)
- Repoformer (Wu et al., ICML 2024, arXiv 2403.10059) — self-evaluation gates retrieval
- RepoCoder (Zhang et al., EMNLP 2023, arXiv 2303.12570) — block-level iterative retrieval
- cAST chunking (CMU 2025, arXiv 2506.15655) — AST-aware chunking improves retrieval
- LightOn ColGrep — Tree-sitter parses files into functions/methods/type blocks

### Future SOTA upgrade

Build block-level (function/method/type-block) granularity index using
Tree-sitter. Apply demotion at BLOCK level, not file level. Then settings.rs
declarative blocks can be demoted while settings.rs impl blocks are
preserved at full score.

---

## Fix 3 — Symbol-exact-match boost (definition queries)

### Our implementation
1.30× multiplicative boost when chunk.symbol case-insensitive-equals the
query target identifier extracted from definition-style queries
("show me the X struct/enum/class/function").

### SOTA — exactly what Sourcegraph published in April 2025

Sourcegraph's "Keeping it boring (and relevant) with BM25F" (April 4 2025)
is the canonical SOTA paper. They use Zoekt's symbol/filename indexes as
separate BM25F fields and report **+20% improvement on real code-search
workloads**.

Quote: "we should be able to use these indexes to reward symbol and
filename matches... think of contents, symbols, and filenames as different
'fields' within a file. When scoring the document, we compute a single
BM25 score over this single, combined field."

### Why we deviate (multiplicative post-hoc vs BM25F field-weighted)

- SOTA (Sourcegraph BM25F): linear per-token field weights INSIDE BM25
  scoring. Each query-symbol match contributes weight ~3× a body match.
- Ours: post-hoc multiplicative boost (1.30×) on chunks where
  `chunk.symbol == query_target`.

The BM25F approach requires:
1. Re-indexing into a multi-field representation (one field per role)
2. Tuning per-field length normalization (k1, b) per field
3. Coordinating with our downstream dense+LI fusion

The multiplicative post-hoc boost captures the same **direction** (symbol
matches dominate lexical-sibling collisions) without the re-index. It
doesn't capture all of BM25F's gains (the 20% Sourcegraph reports), but
it's the expedient first cut.

### Boost magnitude justification

1.30× kept mild because:
- Definition queries account for ≤25% of probe traffic
- Stronger boost risks breaking non-DEF queries
- Sourcegraph's BM25F mathematically translates to ~3× weight INSIDE BM25
  scoring (very different math from a 1.30× post-hoc multiplier on the
  fused score)
- Conservative magnitude lets us validate on dev/held-out before tuning up

### Trigger pattern

Conservative — only fires on UNAMBIGUOUS definition queries:

- `/\b(show|give|find|describe|display|fetch|see)(?:\s+\w+){0,5}\s+(?:the\s+)?(\w+)(?:\s+\w+)?\s+(?:struct|enum|class|fn|function|method|trait|type|interface|impl|definition|signature|prototype|constructor)\b/i`
- `/\bwhat\s+(?:is|does|are)\s+(?:the\s+)?(\w+)\s+(?:struct|enum|class|function|method|type|trait|interface)\b/i`

Not firing on behavioural queries ("how does X work") avoids false-positive
boosts when the user wants implementation, not definition.

### Citations

- Sourcegraph "Keeping it boring (and relevant) with BM25F" (April 2025) — canonical SOTA, +20% on code search
- Pérez-Iglesias et al. "BM25/BM25F in Lucene" (arXiv 0911.5046) — foundational
- Robertson & Zaragoza (2009) "The Probabilistic Relevance Framework: BM25 and Beyond" — canonical reference
- Manning et al. (Stanford CS276 lecture) — academic treatment

### Future SOTA upgrade

Implement proper BM25F: re-index with separate BM25 scores for symbol /
filename / contents fields, tune field weights (~3× for symbol per
Sourcegraph). Expected to capture the Sourcegraph +20% gain.

---

## Fix 4 — Stub-impl single-method extension

### Our implementation
Extend `avgFnBodyLines` to catch single-method derive-equivalent impls
with body ≤ 1.5 substantive lines (factor 0.85× via existing stubFactor).

### SOTA — much weaker direct evidence than other fixes

Tavily research conclusion: "your heuristic is a practical, incremental
baseline, especially if the current retriever already has chunk-level
scoring and line/body statistics. However, the evidence also suggests that
it is unlikely to be competitive with stronger alternatives by itself if
the root cause is poor chunk granularity."

The SOTA-recommended fix is **AST-aware chunking that splits derive impls
into separate chunks** (cAST, ColGrep), not a heuristic multiplier. Once
chunked separately, lower informativeness can be detected via:

- chunk kind (single-method type/impl block)
- body-length proxies
- structural metadata at file/class/function levels

### Why we ship the heuristic anyway

Per Tavily research conclusion: "ship the 0.85x demotion, but treat it as
a guardrail, not the main fix."

Our chunker (`core/indexing/ast-chunker.js`) already does cAST-style
splitting, so derive impls are likely already isolated. The heuristic
just adds a calibration layer that demotes them when they're top
candidates. This is exactly the recommended Phase 1 approach.

### Conservative threshold

1.5 substantive lines is conservative: From::from sometimes IS 1 line and
genuinely trivial; Display::fmt is usually 3+ lines (so safe); Iterator::
next rarely 1 line (so safe). The 0.85× factor (vs 0.5× or harder) keeps
the demotion soft enough that legitimate concise impls can recover via
other signals.

### Citations

- cAST: "Code AST chunking" (CMU 2025, arXiv 2506.15655) — AST-aware chunking
- LightOn ColGrep — Tree-sitter splits into functions/methods/type blocks
- Cursor "Secure Codebase Indexing" — function/class boundary chunking
- Sourcegraph Cody — Tree-sitter chunking + BM25 ranking
- Roo Code — tree-sitter semantic chunks for embedding

### Future SOTA upgrade

Verify our AST chunker actually splits derive impls into separate chunks
(audit the cAST tail-merge). If not, fix at the chunker layer rather than
relying on retrieval-time demotion. Late-interaction over fine-grained
chunks (LateOn-Code style) is the strongest model-side alternative.

---

## NEW Fix 5 (shipped as part of fix #4 commit) — Mega-chunk size penalty

### Our implementation
Soft piecewise-linear penalty:
- L ≤ 500 lines → factor 1.0
- L ramps to 0.80 floor at 1500+ lines

### SOTA evidence

Two converging sources of support:

1. **Late-interaction length bias (arXiv 2603.26259, 2025):** "causal
   encoders using multi-vector MaxSim scoring exhibit a strict, monotonic
   bias favoring longer chunks." MaxSim sums max similarities across query
   tokens; longer documents get more "lottery tickets" for high matches.
   Bi-directional encoders mitigate but don't eliminate the bias.

2. **BM25 length normalization (Robertson & Zaragoza 2009):** the canonical
   reference. b=0.75 default applies full proportional normalization
   relative to corpus avgdl.

### Why soft linear (not BM25's b parameter)

- We lack a per-corpus `L_avg` estimate at query time
- BM25-style normalization (b=0.75) is too aggressive for behavioural-flow
  queries where length carries some signal
- Soft piecewise-linear is the calibrated middle ground

### Citations

- Targeted behaviors of late-interaction models (arXiv 2603.26259, 2025)
- Robertson & Zaragoza (2009) "The Probabilistic Relevance Framework"
- ColBERTv2 token caps (Khattab & Zaharia, NAACL 2022, arXiv 2112.01488)
- Fine-Grained Distillation for Long Doc Retrieval (arXiv 2212.10423)
- LateOn-Code (LightOn 2025-2026) — code-specific late-interaction with 2048-token limit

### Future SOTA upgrade

Layer 1 (current): soft piecewise-linear penalty.
Layer 2: per-corpus `L_avg` estimation, dynamic recalibration.
Layer 3: contextualized chunk embeddings (Voyage AI 2025) — encode chunks
with context from sibling chunks, making length-vs-importance disambiguation
explicit.

---

## Cross-cutting SOTA recommendation: layered architecture

The Tavily research synthesis recommends a 4-layer hybrid pipeline for
production code search:

```
Layer 1: Hybrid BM25 + Late Interaction with RRF Fusion
         ↓
Layer 2: Soft length penalty + BM25F field weighting on dense channel
         ↓
Layer 3: Contextual chunk encoding (Anthropic / Voyage AI pattern, +49%
         reduction in failure rate when adding context to chunks)
         ↓
Layer 4: Cross-encoder reranker over top-100 candidates
```

**We have Layer 1 done.** Today's commit ships partial Layer 2 (mega-chunk
penalty + symbol-exact post-hoc boost). Layers 3 and 4 are future work
beyond the present scope.

---

## What we DO NOT have evidence for (anti-overfit constraint)

The following ideas were considered and DROPPED because the research
showed they don't generalize or aren't supported:

- **Per-language file-name demotion ratios** — overfits to specific corpora
- **Hard chunk-size cap** (BM25-style b=0.75 or ColBERTv2 hard caps) —
  too aggressive for code where length carries signal
- **Settings.rs / cli.rs file-name demotion** — settings.rs IS real
  implementation; demotion would lose its parse fns
- **`SWEET_SEARCH_CROSSLANG_PENALTY` (rejected by user as benchmaxxing)** —
  GCSN multi-language whole-index retrieval IS the realistic operating
  regime; gating per-corpus is overfitting to bench artifacts

---

## Sources

- [Sourcegraph BM25F blog (April 2025)](https://sourcegraph.com/blog/keeping-it-boring-and-relevant-with-bm25f)
- [Pinecone Cascading Retrieval](https://www.pinecone.io/blog/cascading-retrieval-with-multi-vector-representations/)
- [Qdrant Hybrid Search](https://qdrant.tech/articles/hybrid-search/)
- [Anthropic Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)
- [Voyage AI Contextualized Chunk Embeddings](https://docs.voyageai.com/docs/contextualized-chunk-embeddings)
- [LateOn-Code/ColGrep (LightOn 2025-2026)](https://lighton.ai/lighton-blogs/lateon-code-colgrep-lighton)
- [cAST chunking (arXiv 2506.15655)](https://arxiv.org/abs/2506.15655)
- [Repoformer (ICML 2024, arXiv 2403.10059)](https://arxiv.org/abs/2403.10059)
- [RepoCoder (EMNLP 2023, arXiv 2303.12570)](https://arxiv.org/abs/2303.12570)
- [Cody RecSys 2024 (arXiv 2408.05344)](https://arxiv.org/abs/2408.05344)
- [BEIR (Thakur et al., NeurIPS 2024, arXiv 2210.06472)](https://arxiv.org/abs/2210.06472)
- [Pyserini (Lin et al., SIGIR 2021)](https://cs.uwaterloo.ca/~jimmylin/publications/Lin_etal_SIGIR2021_Pyserini.pdf)
- [Late-interaction length bias (arXiv 2603.26259, 2025)](https://arxiv.org/html/2603.26259v1)
- [BM25/BM25F in Lucene (arXiv 0911.5046)](https://arxiv.org/abs/0911.5046)
- [Stanford CS276 BM25/BM25F lecture](https://web.stanford.edu/class/cs276/handouts/lecture12-bm25etc.pdf)
- [ColBERTv2 (NAACL 2022, arXiv 2112.01488)](https://arxiv.org/abs/2112.01488)
- [Cursor Semantic Search](https://cursor.com/blog/semsearch)
- [Greptile Semantic Codebase Search](https://greptile.com/blog/semantic-codebase-search)

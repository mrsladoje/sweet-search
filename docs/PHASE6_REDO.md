# Phase 6 REDO — Per-Language Query-Shape Discovery for `ss-search`

**Created**: 2026-05-11
**Status**: Pre-registration draft, not yet executed
**Replaces**: Part 7 of `docs/SYSTEM_PROMPT_OPT_PLAN.md` (Query-Shape Discovery) and supersedes the partial `core/prompt-optimization/data/query-shapes/recommendations.json` (runId `partial-test-1778456156116`).
**Depends on**: Rust RS-008 chunker fix landed (sibling-merge dilution; see Rust-fix handoff). MUST be sequenced after that fix because changes to chunking change retrieval-shape sensitivity.
**Feeds into**: `docs/PHASE7.md` §4.1 / §4.2 — the family-conditioned `instruction_text[family]` recommendations become the load-bearing input to T1-T15 variant bodies.

---

## §1 Goal

Determine, **per language family**, the agent-instructable query shape that maximises `ss-search` retrieval quality on the existing 18-language AST-tester + doc-positive probe set. Output: a family-conditioned `recommendations.json` artifact that Phase 7 (T1-T15 variant authoring) consumes verbatim.

**Scope is intentionally narrow**: this redo covers **only `ss-search`** (hybrid NL retrieval). Probe sets for the other three tools (`ss-find` / ColGrep, `ss-semantic` / `read-semantic`, `structural` / `trace`) are out of scope and will be authored separately when their probe-authoring rubric is finalised.

**Ship policy**: the artifact may declare a single global default + per-family overrides. A flat "one shape fits all" output is *allowed but not required* — if the empirical signal supports family-conditioned overrides at the promotion gates in §9, we ship them.

---

## §2 What we are discarding from the previous Phase 6 effort

The previous attempt (`recommendations.json` at runId `partial-test-1778456156116`, dated 2026-05-10T23:35) is **not load-bearing for this redo**. Reasons:

1. **Chunker has changed since**: B2 (sibling-symbol `# Additional:` headers), B3 (`impl_item generic_type` drill-down), and the upcoming RS-008 sibling-merge policy change all alter retrieval-shape sensitivity. Re-using old shape rankings would import stale assumptions about chunk layout.
2. **The previous run was a `partial-test`**: Track A only ran on `fastify` (5 of 90 expected golds across 5 repos); Track B agent-in-loop budget ($80–$150) was never spent; IAA never ran; Thresholdout was skipped via flag.
3. **Cell space was too narrow**: only 1 cell survived BH-FDR (`very-short+with-symbol+narrow-regex+imperative+high-density` for `ss-find`), and that cell failed 4 of 5 promotion gates including repo stability.
4. **The probe set was wrong-shape-by-construction** for evaluating `ss-search`: query-shapes/golds.json mirrors the `fastify/gin/flask/ripgrep/ai-chatbot` retrieval-probes set, not the 18-language AST-tester set that this redo is built around.

Treat any directional signal from the old run as **deprecated**. Do NOT cite numbers from the old `recommendations.json` in any artifact this redo produces. The single exception: §4.1 of PHASE7.md currently cites the old run's directional `perToolWinRates`; that section is updated in this redo per §11 below.

**What we DO preserve**: the canonical 6-variant shape grid (V1-V6) defined in `core/prompt-optimization/data/query-shapes/build-variants.mjs` and the shape-grid dimensions (length × symbol-presence × regex-anchor × Q-framing × domain-density). We extend it to 7 variants (§5).

---

## §3 Probe inventory

**No new repos.** The 10-minute-indexing-budget constraint stands: any repo whose full-reindex exceeds ~10 minutes is rejected. The Rust ruff repo is grandfathered (85 minutes) because the existing index is reused; we will NOT add new long-indexing repos.

| Probe set | Source | n | Used for |
|---|---|---|---|
| AST-tester gold (18 languages) | `eval/ast-tester-probes/gold/*.json` | 144 (8 × 18) | Primary Track A retrieval sweep |
| Doc-positive (subset) | `eval/ast-tester-probes/gold/doc-positive.json` | 68 across 17 langs | Secondary; tracks NL-shaped query behaviour where the gold IS a doc/manifest file |
| Doc-negative | `eval/ast-tester-probes/gold/doc-negative.json` | 30 across 13 langs | Demotion regression check only — NOT part of shape sweep |

Total = 144 + 68 = 212 (shape, gold) primary pairs per tool.

The doc-negative set is a **regression canary** during the sweep, not a shape-input — if any shape promotes a non-code file over real code on a probe currently passing, that shape is auto-rejected. This is independent of the family-conditioned scoring.

### §3.1 Stratified dev/held-out split

Existing AST-tester probes are 8 per language. Per CLAUDE.md "Benchmark Methodology", apply stratified 60/40 dev/held-out split with seed=42:

- **Dev** (5 of 8 per language = 90 probes total): free inspection, per-query failure analysis allowed, used for iteration.
- **Held-out** (3 of 8 per language = 54 probes total): aggregate metrics only, queried via Thresholdout oracle (§9), not freely inspectable.

This is anaemic at the per-language level (n=3 held-out). All per-language claims must be marked descriptive-only; all promotion-eligible claims must be at the family level (§4), where pooled held-out n is 6-12 per family.

---

## §4 Language families

The user's correct push-back: my earlier family proposal lumped Rust + C++ into the same family, which is wrong for retrieval. Reformulating from features that actually matter for `ss-search` retrieval-shape sensitivity:

| Feature | Why it matters for `ss-search` retrieval |
|---|---|
| **File-level entity count** (one-class-per-file vs many-fn-per-file) | Determines whether cAST sibling-merge concentrates or fragments symbols; determines whether NL queries hit a class header chunk or a buried method chunk |
| **Doc-comment style** (Javadoc verbose multi-paragraph vs `///` one-liner vs `"""` narrative) | Determines what content the bi-encoder pools; verbose doc-comments give descriptive queries something to hit, terse docs make symbol-anchored queries dominate |
| **Identifier convention** (snake_case vs camelCase vs PascalCase classes + camelCase methods) | Affects BPE tokenisation; affects whether descriptive queries lexically overlap with symbol names |
| **Type system surface in signature** (heavy types like `fn foo<'a, T: Bar>(...) -> Result<X, Y>` vs light dynamic) | Heavy-type signatures make symbol-anchored queries more discriminative; light-type encourages docstring matching |

These features cluster the 18 probe languages into **5 families** (the user explicitly noted Rust + C++ are NOT similar at the retrieval level, and that Java + C# ARE similar; both are addressed):

| Family | Languages | n probes | Dominant retrieval-relevant pattern |
|---|---|---|---|
| **OO-monolithic** | java, csharp, kotlin, scala | 32 | One PascalCase class per file; multi-paragraph Javadoc/KDoc/XML doc-comments; camelCase methods inside; methods need class-level context |
| **Systems-modular-terse** | rust, go | 16 | Many top-level fns per file; one-line `///` (Rust) or `//` (Go) docs; snake_case-leaning (Go uses Go mixed-case but tends short); sibling-merge dominant chunker pattern |
| **C-family** | c, cpp, zig | 24 | Header decls + impl files; templates (C++); namespace-heavy; mixed identifier styles; chunker handles template/macro wrappers differently |
| **JS-mobile** | javascript, typescript, typescript-lib, dart | 32 | Modules with multiple exports; JSDoc/TSDoc/DartDoc style; class + arrow-fn + component patterns; camelCase functions, PascalCase types/classes |
| **Scripting-dynamic** | python, ruby, php, lua, elixir | 40 | Dynamic typing; indent-based (Python) or end-keyword (Ruby/Lua/Elixir) blocks; narrative docstrings; generic identifiers (`parse`, `read`, `build`, `run`) |

**Total**: 4 + 2 + 3 + 4 + 5 = 18 (every language covered).

### §4.1 Why these families and not others

- **Why Java + C# share a family**: Both have one PascalCase class per file, methods inside, verbose multi-line doc-comments (Javadoc / XML `<summary>`), strong type signatures. The `.NET` vs JVM runtime difference is irrelevant for retrieval. Kotlin and Scala fit the same pattern (Kotlin's `open class JobSupport` is the canonical example; Scala objects play the same role).
- **Why Rust + Go share a family but Rust + C++ do not**: Rust and Go both have many small top-level fns per file with terse one-line docs (`///` / `//`). C++ headers are *decl-dominant* (forward declarations, template instantiations, namespace blocks) — a structurally different chunker workload. The baseline AST-tester data supports this: Rust 4/0/4, Go 1/3/4 (both mid-range, sibling-merge problems); C++ 0/0/3 (worst on the chart, header-decl problems); C 2/4/2 (in between). Rust + Go failure-modes match each other much more than either matches C++.
- **Why C-family includes Zig**: Zig is positioning as a C replacement; tree-sitter-zig is similar to C in structure (header-like + impl-mixed). Small probe count (n=8) so it must live in a larger family for statistical power.
- **Why JS-mobile includes Dart**: Dart (Flutter) has the same modules-with-multiple-exports + class + arrow-fn pattern as TS. The user separately weights Dart lower (§7), but they cluster together for shape sensitivity.
- **Why TS-lib is separate from TS**: Both are in the same family. TS-lib is a probe pack on `colinhacks/zod` specifically — it stresses the v3/v4 monorepo intra-version competition pattern but does not warrant its own family.
- **Why scripting groups Python+Ruby+PHP+Lua+Elixir together**: All five are dynamic, all five lean on docstring-narrative for documentation, all five have generic identifiers. Block-delimiter difference (Python indent vs Ruby/Lua `end` vs Elixir `do/end`) matters for the chunker but not measurably for retrieval shape — the bi-encoder doesn't see block delimiters.

### §4.2 Alternative groupings considered and rejected

- **3-family coarse** (typed-OO / typed-modular / scripting-dynamic): too few families to surface within-family variation; would mask the Java-vs-Scala bimodality the data hints at.
- **8-family fine** (one per identifier-style × file-structure cell): too many — BH-FDR adjustment over 48-cell shape × family space kills detectable effects at n=144 dev probes.
- **Per-language only** (no families): n=5 dev per language, MDE ≈ 25pp on file_recall@1 at α=0.05. Statistically infeasible.

5 families is the smallest cell count that gives n ≥ 16 per family (sufficient for a paired permutation test with MDE ≈ 12pp at α=0.05) while preserving the within-family homogeneity argument.

### §4.3 Within-family heterogeneity caveat

Existing baseline AST-tester numbers show real within-family heterogeneity. Examples:
- OO-monolithic: Scala 7/1/0 vs Java 0/3/5 — wildly different absolute scores
- C-family: Zig 4/2/2 vs cpp 0/0/3 — also divergent
- Scripting: Elixir 7/0/1 vs Ruby 0/2/6 — opposite extremes

This heterogeneity is in **total retrieval quality**, not in **shape sensitivity**. The hypothesis under test is that shape preferences cluster within these families even when total quality does not. If the data falsifies that hypothesis (e.g., Java prefers V4 but Scala prefers V1), we accept it and ship per-language recommendations descriptively without family-conditioned overrides for that family. The families are a power-amplifying decomposition, not a hard claim.

---

## §5 Shape grid

The canonical 6-variant grid from `build-variants.mjs`, extended to 7 to include the empirically-justified V2-interrogative cell my Rust experiment surfaced:

| ID | Shape | Length | Symbol | Framing | Density | Source |
|---|---|---|---|---|---|---|
| V1 | very-short+with-symbol+narrow-regex+imperative+high-density | very-short (≤3 tok) | yes | imperative | high | canonical |
| V2 | short+with-symbol+narrow-regex+interrogative+high-density | short (4-8) | yes | interrogative | high | canonical + **empirical Rust winner** |
| V3 | short+without-symbol+medium-regex+declarative+high-density | short (4-8) | no | declarative | high | canonical |
| V4 | medium+with-symbol+medium-regex+interrogative+high-density | medium (9-15) | yes | interrogative | high | canonical baseline |
| V5 | medium+without-symbol+broad-regex+interrogative+low-density | medium (9-15) | no | interrogative | low | canonical |
| V6 | long-NL+without-symbol+broad-regex+interrogative+low-density | long-NL (16+) | no | interrogative | low | canonical (worst-cell hypothesis) |
| V7 | medium+with-symbol+narrow-regex+declarative+high-density | medium (9-15) | yes | declarative | high | **added** — covers descriptive-with-symbol form (matches existing rust.json probe shape) |

V7 is added because the existing AST-tester probes (rust.json, kotlin.json, etc.) are authored in the "X struct that does Y" descriptive form — V4 (interrogative) does not cover this. V7 lets us measure whether the existing probe phrasing is in a good cell or not.

**No regex anchor for `ss-search`**: regex-anchor levels (narrow/medium/broad) are dimensions for `ss-find` only. For `ss-search` (this redo's scope), the regex column is dropped; the 5 remaining dimensions yield the 7 cells above. The `regex` field in the V_i naming is preserved for cross-tool comparability with future `ss-find` redos.

### §5.1 Per-gold variant authoring — content rules

For each of the 144 AST-tester golds + 68 doc-positive golds = 212 golds, author 7 shape variants. Hard authoring rules (enforced by post-generation validator, §5.3):

- The symbol-anchored variants (V1, V2, V4, V7) MUST contain the gold's `expectedSymbol` verbatim.
- The without-symbol variants (V3, V5, V6) MUST NOT contain the gold's `expectedSymbol` (case-insensitive substring match) AND MUST NOT contain any tokens from the gold's path that would lexically match the symbol.
- V1 must be ≤ 3 tokens (whitespace-split).
- V2/V7 must be 4-8 tokens.
- V3/V4/V5 must be 9-15 tokens.
- V6 must be ≥ 16 tokens (long-NL).
- Token count is whitespace-split, not BPE.

### §5.2 Authoring infrastructure — DeepSeek V4 Flash via direct API, no harness

For this `ss-search` redo, **1,484 shape variants** (212 golds × 7 cells) are produced by a deterministic preprocessing script + DeepSeek V4 Flash via direct HTTP API. **No harness** (no Claude Code headless, no opencode). The model never has filesystem access; the script does all filesystem work and hands the model curated context. The future per-tool redoes (`ss-find`, `ss-semantic`, `structural`, §12.1) layer ~440 additional gold-extraction calls on top of this same infrastructure but are out of scope for this redo's numbers.

**Why no harness**: per user memory `feedback_direct_api_for_stateless_calls`, harness calls are 50-100× slower than direct API for stateless work. Probe authoring is stateless once inputs are curated. Total wall time:

| Approach | 1,484 calls wall time | Cost |
|---|---|---|
| All Claude Code headless + DeepSeek redirect (harness everywhere) | 2-5 hours | ~$0.30 |
| Direct API stateless + harness only for agentic gold extraction | 30-50 minutes | ~$0.30 |
| **Direct API everywhere + preprocessing script (chosen)** | **~15-25 minutes** | **~$0.30** |

(For the all-tools total of ~4,700 calls including future redoes, multiply by ~3.)

**Why DeepSeek V4 Flash**: 79% SWE-bench Verified (matches Gemini 3 Flash at 78%; far above Gemini 3.1 Flash Lite at 22%). $0.14/M input + $0.28/M output. 1M context. GA, not preview-throttled. Single model for entire pipeline keeps the system prompt and validator surface uniform.

**Why non-reasoning mode**: per user memory `project_deepseek_max_tokens_reasoning`, V4-Flash reasoning mode silently returns empty text when `max_tokens < 4096`. Probe authoring is templated generation — no chain-of-thought needed. Always call the non-reasoning endpoint (or pass `reasoning_effort: "none"` if using the unified endpoint).

**Pipeline architecture**:

```
1. preprocess.mjs (deterministic, no LLM)
   for each gold in 18 language packs × ~12 probes:
     source_snippet = readSourceAtSHA(gold.expectedFile, gold.expectedSymbol)
     containing_chunk = ast_chunker.parseFile(gold.expectedFile)
                          .find(c => c.contains(gold.expectedSymbol))
     graph_neighbors = code_graph_db.callers_callees(gold.expectedSymbol)
     write inputs/<gold.id>.json     # everything packed, model never reads files

2. author-variants.mjs (LLM — direct DeepSeek API, 20-30 concurrent)
   for each input in inputs/*.json:
     for each shape in [V1, V2, V3, V4, V5, V6, V7]:
       prompt = build_prompt(input, shape)
       variant = await deepseek_direct(prompt, response_format={type:'json_object'})
       parsed = JSON.parse(variant)         # response_format=json_object guarantees valid JSON
       schemaValidator(parsed)               # client-side strict schema check (§5.3)
       validator(parsed, shape, input)       # symbol-leak / length / etc. (§5.3)
       on validator failure → re-prompt with stricter instruction (max 2 retries)
       write variants/<gold.id>-<shape>.json

3. (Future) extract-golds.mjs for ss-find/ss-semantic/structural redoes,
   same pattern: deterministic enumeration (ripgrep / code-graph.db / chunker)
   + LLM for the small portion that needs paraphrasing.
```

**Concurrency**: 20-30 parallel async workers against `api.deepseek.com/v1/chat/completions`. DeepSeek's dynamic rate limit (no published RPM tier; 429 on overload) means start at 20, back off exponentially on 429 (no fail-fast). At 20-concurrency average, the 1,484 variant calls complete in **~15-25 minutes wall time** — this is the headline number used throughout §13 / §15.

**Output format**: every call uses `response_format: { "type": "json_object" }` (DeepSeek-supported; guarantees parseable JSON but not a specific schema). Schema conformance is enforced **client-side** by the validator's first check (§5.3). Full server-side JSON-schema enforcement is not yet available on DeepSeek's API as of 2026-05; client-side schema validation is the correct primitive.

### §5.3 Post-generation validator (enforced before any variant is admitted)

Every variant emitted by §5.2 passes through a deterministic validator before being written to `variants/`. Failures route back to §5.2 for re-prompt (max 2 retries; persistent failures logged for human review). Validator checks, in order:

1. **JSON-schema conformance**: the parsed model output must match the variant schema (`{ shape: string, query: string }` minimum, plus optional `rationale` for diagnostics). Schema validation is client-side; DeepSeek's `response_format: json_object` guarantees valid JSON but not schema adherence (§5.2).
2. **Length-tier check**: whitespace-split token count of `query` must fall in the cell's range (§5.1).
3. **Symbol-presence check** (V1 / V2 / V4 / V7 only): `query` MUST contain `gold.expectedSymbol` verbatim.
4. **Symbol-leak check** (V3 / V5 / V6 only): `query` MUST NOT contain `gold.expectedSymbol` (case-insensitive substring match).
5. **Path-token-leak check** (V3 / V5 / V6 only): tokenise `gold.expectedFile` on `/_.-` and lowercase. For each path token ≥ 4 chars that is not in a stopword list AND that shares ≥ 3-char substring with any sub-token of `gold.expectedSymbol`, reject if `query` contains it. (Concrete example: for `expectedSymbol = "detect_package_root"` in `crates/ruff_linter/src/packaging.rs`, the path token `packaging` shares "pack" with "package" — a query like "find the package detection walker in packaging" would leak via the path token and is rejected.)
6. **Empty / boilerplate check**: `query` must be ≥ 1 token of non-whitespace content; reject obvious template-leak strings like "the function that does X" or "{symbol} that {description}".

The validator is the load-bearing quality gate. Without it, V3/V5/V6 silently leak symbol tokens and the without-symbol shape claims become invalid. The validator must run BEFORE any variant is committed to disk.

### §5.4 Independent-author check (revised for LLM authoring)

SYSTEM_PROMPT_OPT_PLAN §11.2 requires that the author of probe variants must not be the same entity that authored the gold tasks (TREC pooled-relevance discipline; prevents the variant phrasing from leaking gold-knowledge that the retriever would unfairly benefit from).

With LLM authoring, the rule resolves cleanly because of role separation:

| Role | Entity | Independence check |
|---|---|---|
| **Gold authoring** (existing 18-language AST-tester packs) | `sweet-search-core` (human) | — |
| **Variant authoring** (this redo, §5.2) | DeepSeek V4 Flash | ✅ Different entity from gold author |
| **Track B agent** (if §6.3 runs, executes the shaped query end-to-end) | Sonnet 4.6 or GPT-5.5 (per §6.3) | ✅ Different from variant author AND gold author |
| **Track B judge** (PRP-style two-judge per §11.6) | Gemini 3 Flash + GPT-5.5 direct API | ✅ Different from variant author, gold author, AND agent. Per user memory `feedback_claude_max_budget`, route through direct API not Claude Max. |

This gives a **3-layer disjoint-author chain** for any Track B result: gold author (human) → variant author (DeepSeek) → agent (Sonnet/GPT) → judge (Gemini + GPT), no shared entity across layers. Per SYSTEM_PROMPT_OPT_PLAN §11.6, the judge pair must come from disjoint model families; pairing Gemini with GPT-5.5 satisfies this.

**Hard rule**: do NOT route Track B judging through DeepSeek of any tier (Flash, Pro, V4-anything). DeepSeek-authored variants judged by DeepSeek-family judges is a self-evaluation loop and disqualifies the promotion gate G4.

### §5.5 Concrete artifacts — schemas, paths, prompt skeleton, model name

These pin down every decision left ambiguous in §5.1-§5.4 so the implementation requires no design judgement calls.

#### §5.5.1 File-system layout (relative to repo root)

```
core/prompt-optimization/
├── data/
│   └── query-shapes/
│       ├── preregistration-v2.md          # §15 deliverable
│       ├── inputs/                         # preprocess.mjs output, one file per gold
│       │   └── <lang>-<probe-id>.json
│       ├── variants/                       # author-variants.mjs output
│       │   └── <lang>-<probe-id>-<shape>.json
│       ├── recommendations-v2.json         # final artifact, schema in §10
│       └── tracks/
│           ├── track-a-<runId>.jsonl       # per-(lang, gold, shape) run results
│           └── track-b-<runId>.jsonl       # optional, §6.3
├── scripts/
│   ├── preprocess.mjs
│   ├── author-variants.mjs
│   ├── validator.mjs                       # imported as a module, also runnable as CLI
│   ├── deepseek-client.mjs                 # thin async HTTP client
│   └── aggregate-track-a.mjs               # produces recommendations-v2.json
```

#### §5.5.2 `inputs/<lang>-<probe-id>.json` schema (output of preprocess.mjs)

```json
{
  "schemaVersion": 1,
  "goldId": "RS-001",
  "language": "rust",
  "family": "Systems-modular-terse",
  "repoSha": "ac6361d83e4d51ab123043b00d5285a842077b81",
  "expectedFile": "crates/ruff_linter/src/rules/isort/categorize.rs",
  "expectedSymbol": "ImportType",
  "expectedSymbolType": "enum",
  "goldNotes": "...verbatim from gold/<lang>.json...",
  "containingChunk": {
    "startLine": 1, "endLine": 72,
    "text": "...full chunk content, untruncated..."
  },
  "sourceSnippet": {
    "startLine": 12, "endLine": 60,
    "text": "...just the symbol's definition + leading docstring, untruncated...",
    "extractor": "tree-sitter"
  },
  "graphNeighbors": {
    "callers":  [{"symbol": "...", "file": "..."}, ...],
    "callees":  [...],
    "implementors": [...]
  },
  "pathTokens": ["crates", "ruff_linter", "src", "rules", "isort", "categorize"],
  "preregistered_shape_winner": null
}
```

`graphNeighbors` is queried from `eval/ast-tester-probes/_repos/<lang>/.sweet-search/code-graph.db` using the existing `getCallers` / `getCallees` accessors. Empty arrays are valid (no neighbours found).

`pathTokens` is `expectedFile` split on `/_.-` and lowercased — the validator uses this directly in the path-token-leak check (§5.3 check 5).

#### §5.5.3 `variants/<lang>-<probe-id>-<shape>.json` schema (output of author-variants.mjs)

```json
{
  "schemaVersion": 1,
  "goldId": "RS-001",
  "shape": "V2",
  "shapeLabel": "short+with-symbol+narrow-regex+interrogative+high-density",
  "query": "where is ImportType enum defined",
  "rationale": "anchored on expectedSymbol; framed as interrogative locator",
  "tokenCount": 5,
  "authoringModel": "deepseek-v4-flash",
  "authoringAttempt": 1,
  "validatorVerdict": "pass",
  "authoredAt": "2026-05-12T..."
}
```

`rationale` is required by the prompt template (§5.5.5) — used for diagnostics and for the manual spot-check (§13 step 5). Not consumed by Track A scoring.

#### §5.5.4 DeepSeek API call shape

```js
// scripts/deepseek-client.mjs (skeleton)
const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'deepseek-v4-flash',           // exact model name per DeepSeek API docs
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: userPrompt(input, shape) }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,                      // low — favour reproducibility
    max_tokens: 512,                       // variant + rationale fits comfortably
    // NO reasoning fields — non-reasoning mode (avoid max_tokens<4096 footgun)
  }),
});
```

`DEEPSEEK_API_KEY` is the env var. Concurrency 20-30 via a `p-limit` semaphore. 429 → exponential backoff (1s → 2s → 4s → 8s → 16s cap). 5xx → 1 retry. Other errors → log and skip.

#### §5.5.5 Prompt template (system + user) — verbatim baseline

```
SYSTEM PROMPT:
You are a probe-variant author for an information-retrieval benchmark.
Given a code symbol from a real repository and a target shape cell, produce one
natural-language query that exercises the specified shape.

Hard constraints (the variant is REJECTED if violated):
  - Token count must fall in the cell's range.
  - For with-symbol cells (V1, V2, V4, V7): the query MUST contain the symbol verbatim.
  - For without-symbol cells (V3, V5, V6): the query MUST NOT contain the symbol AND
    must not contain path tokens that lexically overlap with the symbol.

Output: a single JSON object with keys `query` (string) and `rationale` (string).
No prose outside the JSON object. No markdown fences.

USER PROMPT (one template, parameterised by shape):
gold:
  file: {expectedFile}
  symbol: {expectedSymbol}
  symbolType: {expectedSymbolType}
  language: {language}
  description: {goldNotes}
source (the symbol's definition + leading doc):
```
{sourceSnippet.text}
```
shape: {shape}
shape rules:
  - length: {lengthRule}    # e.g., "≤3 tokens" for V1, "4-8 tokens" for V2
  - symbol presence: {symbolRule}   # "MUST contain {expectedSymbol}" or "MUST NOT contain {expectedSymbol}"
  - framing: {framingRule}  # "imperative", "interrogative", "declarative noun-phrase"
  - density: {densityRule}  # "high (domain-specific identifiers)" or "low (generic terms)"
  - path-leak forbidden tokens: {pathTokens that lexically overlap with symbol}

Produce the variant now.
```

Re-prompt on validator failure: prepend `"Your previous attempt {previousQuery} was rejected because: {validatorReason}. Produce a corrected variant respecting all hard constraints."` and re-call. Max 2 retries → persistent failure logged.

#### §5.5.6 Path-token stopword list (validator §5.3 check 5)

```js
const PATH_STOPWORDS = new Set([
  // common directory names that are not lexically meaningful
  'src', 'lib', 'test', 'tests', 'spec', 'specs', 'docs', 'doc',
  'crates', 'packages', 'modules', 'pkg', 'pkgs', 'internal',
  'main', 'core', 'common', 'shared', 'utils', 'util', 'helpers',
  'app', 'apps', 'cmd', 'bin', 'examples', 'example',
  // language-specific
  'rs', 'go', 'py', 'js', 'ts', 'jsx', 'tsx', 'java', 'cs', 'cpp',
  'rb', 'php', 'lua', 'ex', 'exs', 'dart', 'zig', 'kt', 'scala', 'c', 'h',
]);
```

Path tokens shorter than 4 chars OR present in this stopword list are skipped during the leakage check. The 3-char-substring overlap rule applies only to surviving tokens.

#### §5.5.7 Family-detection mapping (consumed by PHASE7.md §4.2)

This table is the authoritative file-extension → family lookup. Phase 7 variant bodies that need family detection import this same mapping (no separate copy):

| Extension | Language | Family |
|---|---|---|
| `.java` | java | OO-monolithic |
| `.cs` | csharp | OO-monolithic |
| `.kt`, `.kts` | kotlin | OO-monolithic |
| `.scala`, `.sc` | scala | OO-monolithic |
| `.rs` | rust | Systems-modular-terse |
| `.go` | go | Systems-modular-terse |
| `.c`, `.h` | c | C-family |
| `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh` | cpp | C-family |
| `.zig` | zig | C-family |
| `.js`, `.cjs`, `.mjs`, `.jsx` | javascript | JS-mobile |
| `.ts`, `.tsx`, `.cts`, `.mts` | typescript | JS-mobile |
| `.dart` | dart | JS-mobile |
| `.py`, `.pyi` | python | Scripting-dynamic |
| `.rb` | ruby | Scripting-dynamic |
| `.php` | php | Scripting-dynamic |
| `.lua` | lua | Scripting-dynamic |
| `.ex`, `.exs` | elixir | Scripting-dynamic |
| (anything else) | unknown | `null` — agent uses `default.instruction_text` |

`typescript-lib` is a probe-pack name, not a language; its files use `.ts` and route to JS-mobile.

#### §5.5.8 Aggregation baseline

For BH-FDR (§9 G1) and paired permutation tests, the baseline cell is the **existing AST-tester probe phrasing**, which is closest to V7 (`medium+with-symbol+narrow-regex+declarative+high-density`) per the empirical Rust analysis. Concretely: for each gold, the baseline observation is its top-1 retrieval result using the gold's `query` field from the AST-tester JSON; this is paired with each candidate shape's top-1 retrieval result.

Test statistic: paired permutation on `file_recall@1` (binary outcome per gold). 10,000 permutations, seed=42. Effect size: difference of means (candidate − baseline). BH-FDR applied across the 35-cell space defined by 7 shapes × 5 families.

`pairs_below_floor`: cells with < 5 paired observations are excluded from BH-FDR (matches the existing `recommendations.json` convention) and reported descriptively only.

---

## §6 Methodology

**Track A only** for the initial run. Track B (agent-in-loop) is deferred per the user's directive: probes themselves may be enough; revisit after Track A results and after the RS-008 chunker fix lands. If Track B runs, scope it to ≤ 24 (gold, shape) pairs sampled across families (4-6 per family) to keep cost ≤ $80.

### §6.1 Track A: deterministic per-tool sweep

For each (language, gold, shape variant) tuple:

1. Instantiate `SweetSearch` with the language's `.sweet-search` index (same pattern as `eval/retrieval-probes/run-probes.mjs`).
2. Call `searcher.search(query, { format: 'agent', k: 5, graphExpand: '2hop', adaptiveHop2: true })` — matches production hybrid retrieval.
3. Record top-5 results: file, symbol, type, score, presentation tier.
4. Grade: PASS (file + symbol match), PARTIAL (file match, wrong symbol), FAIL (file mismatch).
5. Also record: `file_recall@1`, `file_recall@5`, score margin (top-1 − top-2), `lineOverlap` where line ranges are gold.

Total runs: 144 AST-tester × 7 shapes + 68 doc-positive × 7 shapes = 1,484 deterministic queries. Wall time ~2-5 minutes per language (re-using already-loaded `SweetSearch` instances). Free.

### §6.2 Aggregation

Per (family, shape) cell:
- `mean(file_recall@1)`, paired bootstrap 95% CI (10K, seed=42)
- `mean(symbol_recall@1)` (PASS rate)
- `n` paired observations (gold count)
- Per-language breakdown retained for descriptive reporting

Per shape (across all families, weighted): the global "default candidate" score.

### §6.3 Track B (optional, scoped, post-fix)

Sample 24 (gold, shape) pairs stratified by family (4-6 per family). Spawn Claude Code with `format=agent` and a system prompt that forces the shape ("you MUST phrase your sweet-search query as a 4-8 token interrogative form with the symbol"). Run end-to-end. Judge with DSv4-Pro + Sonnet 4.6 per the §11.6 protocol. Cost ceiling: $80. **Only run after Track A picks 2-3 leaders per family** — Track B is not for shape discovery, it's for downstream interaction-effect check.

Track B is the user's right call: agent-in-loop interaction effects (an agent receiving a shape that gives weaker top-1 but the agent recovers via follow-up read) matter for the shipped artifact but are orthogonal to deterministic recall. Defer until Track A leaders are clear.

---

## §7 Popularity weighting

Pre-register language weights BEFORE running. Three tiers, applied as multiplicative weights at aggregation time per §8:

| Tier | Weight | Languages | Rationale |
|---|---|---|---|
| **Tier-1** | 3 | javascript, typescript, python, rust, java | Stack Overflow 2024 top-5 most-used; Sweet-search's primary user-base shape |
| **Tier-2** | 2 | typescript-lib, csharp, cpp, go, kotlin, ruby, php, c, dart | Stack Overflow top-15; mainstream enterprise / mobile |
| **Tier-3** | 1 | scala, lua, elixir, zig | Long-tail or niche; ship without breaking but don't dominate decisions |

Two aggregations are reported side-by-side:

1. **Macro-average** (uniform, no weights): per-family or per-language, unweighted mean. BEIR-grade standard.
2. **Weighted aggregate**: tier-weighted sum / sum of weights. Closer to expected deployment distribution.

The decision rule in §8 uses **macro-average for family-internal scoring** and **weighted aggregate for the global default selection**.

Caveat: the weights are pre-registered before the sweep, NOT after. If the data falsifies a popularity-based weighting (e.g., Lua's optimal shape is *also* the global optimum), the weighted vs macro split is still reported transparently and the consumer can re-weight downstream.

---

## §8 Decision rules

Pre-registered before any sweep run:

### §8.1 Global default shape

A shape `S_default` is promoted as the universal default if and only if:

```
(a) S_default wins the weighted-aggregate file_recall@1 across all 18 languages
(b) S_default is within 3pp of the family-best shape for every family
(c) S_default's per-family recall@1 is not more than 5pp below any family's
    family-best shape (per family worst-case floor)
(d) S_default survives BH-FDR at q=0.10 across the 7-shape × 5-family = 35-cell space
```

### §8.2 Family-conditioned override

A shape `S_override(F)` is promoted as a per-family override for family `F` if and only if:

```
(a) S_override(F) beats S_default on family F's macro-average file_recall@1 by ≥ 8pp
(b) S_override(F) does not regress any OTHER family by > 3pp vs S_default
(c) Family F has ≥ 2 languages with consistent direction (no Simpson reversal —
    i.e., S_override(F) does not win F-aggregate only because one language is an outlier)
(d) S_override(F) survives BH-FDR at q=0.10 in the 35-cell space
```

### §8.3 Tie / no-winner

If no shape survives §8.1, the artifact reports `default: null, family_overrides: {}` and Phase 7 receives a *negative* recommendation ("no shape preference detected; T_i variants should rely on internal routing logic, not shape instruction"). This is a real possible outcome — pre-registered so we don't reach for a winner.

### §8.4 Worked example (hypothetical)

A plausible output, based on the Rust empirical finding extrapolated:

```
default: V2 short+with-symbol+narrow-regex+interrogative+high-density
family_overrides:
  OO-monolithic:        V4 medium+with-symbol+medium-regex+interrogative+high-density
                          (verbose Javadoc-style files reward descriptive queries)
  Scripting-dynamic:    V7 medium+with-symbol+narrow-regex+declarative+high-density
                          (narrative docstrings reward declarative-NL forms)
  Systems-modular-terse: (no override; V2 default wins)
  C-family:             (no override; V2 default wins)
  JS-mobile:            (no override; V2 default wins)
```

This is illustrative, not predicted. The actual output is whatever the data says.

---

## §9 Promotion gates (BEIR/CoIR-grade overfit controls)

Every promoted shape (default OR family override) must pass ALL five gates:

| Gate | Criterion |
|---|---|
| **G1: BH-FDR** | At q=0.10 across the 7-shape × 5-family = 35-cell space, the paired permutation p-value vs baseline-V4 must survive Benjamini-Hochberg correction |
| **G2: Thresholdout (per §11.4.2)** | For each candidate, query the Thresholdout oracle on held-out (n=54). Promote only if oracle returns AGREE or DIFFER-in-candidate's-favour. Each candidate consumes 1 of the campaign's ~30 Thresholdout queries |
| **G3: Token-overlap leakage** | The `instruction_text` for the shape must contain zero non-whitelist ≥ 3-grams from Dev probe symbols/paths/answers. Hard-reject on any leakage |
| **G4: Independent-author check** | The shape's `instruction_text` must be reviewed by an engineer who is not the primary author of golds for ≥ 50% of the languages in scope |
| **G5: Per-language stability within family** | For a family override, the worst-language `file_recall@1` within the family must be ≥ 0.6 × the best-language's; otherwise log as `not_promoted_due_to_intrafamily_instability` |

A shape that's statistically significant in isolation but does not survive BH-FDR is reported under `not_promoted_due_to_fdr` for transparency; its `instruction_text` is NOT baked into Phase 7 T_i variants.

**Doc-negative regression check** (§3): a shape is auto-rejected (independent of G1-G5) if it converts any currently-PASSing doc-negative probe to FAIL. This is asymmetric: we never trade demotion correctness for shape gain.

---

## §10 Output artifact

Single file: `core/prompt-optimization/data/query-shapes/recommendations-v2.json`. Schema:

```json
{
  "schemaVersion": 3,
  "supersedes": "recommendations.json (runId partial-test-1778456156116)",
  "runId": "phase6-redo-<iso>",
  "generatedAt": "...",
  "plan_reference": "docs/PHASE6_REDO.md",
  "tool": "ss-search",
  "families": {
    "OO-monolithic": {"languages": ["java","csharp","kotlin","scala"], "weight_pool": 8},
    "Systems-modular-terse": {"languages": ["rust","go"], "weight_pool": 5},
    "C-family": {"languages": ["c","cpp","zig"], "weight_pool": 5},
    "JS-mobile": {"languages": ["javascript","typescript","typescript-lib","dart"], "weight_pool": 10},
    "Scripting-dynamic": {"languages": ["python","ruby","php","lua","elixir"], "weight_pool": 9}
  },
  "default": {
    "shape": "<shape_id or null>",
    "macro_recall_at_1": ...,
    "weighted_recall_at_1": ...,
    "instruction_text": "...",
    "gates": {"fdr": "pass", "thresholdout": "AGREE", "leakage": "pass", "author": "pass"},
    "per_family_recall": {...}
  },
  "family_overrides": {
    "<family_name>": {
      "shape": "...",
      "delta_vs_default": ...,
      "instruction_text": "...",
      "gates": {...},
      "per_language_within_family": {...}
    }
  },
  "per_language_descriptive": {
    "rust": {"best_shape": "...", "n": 5, "shape_recalls": {...}},
    "...": "..."
  },
  "not_promoted_due_to_fdr": [...],
  "not_promoted_due_to_intrafamily_instability": [...],
  "doc_negative_regression_check": "pass" | "fail",
  "preregistration_diff": {
    "predicted_default": "V2",
    "actual_default": "...",
    "predicted_overrides": {...},
    "actual_overrides": {...},
    "lessons": "..."
  }
}
```

The `instruction_text` strings go *verbatim* into the relevant Phase 7 T_i variant bodies — see PHASE7.md §4.2 (updated by this redo).

---

## §11 What changes in PHASE7.md (brief)

PHASE7.md §4.1 ("P6 grounding — reasoning HARD over Phase 6 data") currently cites the old `recommendations.json`'s `perToolWinRates`. After PHASE6_REDO ships:

- **§4.1** rewrites to consume `recommendations-v2.json` instead. The "Top Track B win rates from P6" table is replaced with the family-conditioned default + overrides table.
- **§4.2** ("Inferred per-tool guidance baked into variants") gets a new sub-bullet for `ss-search` only (this redo's scope): the verbatim `instruction_text` for the default plus per-family overrides. The other tools' bullets (`ss-find`, `ss-semantic`, `structural`) are unchanged for now; they will be updated when their respective Phase 6 redoes land.
- **§4.3** variant slate: the T_i bodies that previously embedded shape rules now embed a family-detection-then-shape pattern. Concretely, T1/T4/T5/T6/T10 expand from "Use a 4-8 token NL query with the symbol if known" to "If target file is in `OO-monolithic` family (Java/C#/Kotlin/Scala), use V4 medium+symbol+declarative; otherwise V2 short+symbol+interrogative" (illustrative; actual text depends on the recommendations-v2.json output).
- **Family detection at agent runtime**: the agent classifies the *target file's language* (cheap — file extension via the §5.5.7 mapping table, shared between this redo's scripts and the Phase 7 variant bodies at `core/prompt-optimization/data/query-shapes/family-map.mjs`) → family lookup → shape selection. This is a single deterministic mapping table embedded in the system prompt, not a model decision. The mapping is identical at index time, sweep time, and agent runtime — one source of truth.

These are textual edits to PHASE7.md, not structural. PHASE7.md §3 (methodology), §5 (probe authoring), §6 (pre-registration discipline), §7 (implementation tasks) are unchanged.

---

## §12 Out of scope (deliberate)

| Not in scope | Why |
|---|---|
| `ss-find` / ColGrep shape sweep | Different tool, different cell space (regex anchor matters). Separate redo when its probe-authoring rubric stabilises (see §12.1 future work). |
| `ss-semantic` / `read-semantic` shape sweep | Different tool. Probes need to be authored against single-file in-context retrieval, which is a different gold format (see §12.1). |
| `structural` / `trace` shape sweep | Different tool. Relationship-verb cell space (`who calls X?` vs `where is X used?`) is its own grid (see §12.1). |
| New repos | 10-minute indexing budget. Existing 18-language AST-tester repos are reused. The Rust ruff repo (~85 min) is the only grandfathered outlier. |
| Re-running Track B agent-in-loop on the prior fastify-only golds | Discarded per §2. New Track B (if it runs) uses the 18-language probe set. |
| Indexing-time chunker changes | RS-008 fix is its own PR (Rust-fix handoff). This redo runs AFTER that fix lands and the index is rebuilt. |
| Tuning ranking signals (BM25F boosts, demotion weights, file-kind-aware rerank) | Format-gating policy (CLAUDE.md) forbids; out of scope here. |
| JSX as a separate language pack | JSX is subsumed by JavaScript / TypeScript AST-tester packs (axios for JS, microsoft/TypeScript for TS). React-component patterns surface inside TS probes (the existing vercel/ai-chatbot probe set in `core/prompt-optimization/data/query-shapes/golds.json` was authored for exactly this coverage, but that gold set is being deprecated). If empirical results show JS-mobile family heterogeneity driven specifically by component-style code, consider authoring a JSX-specific sub-pack in a future iteration. |

### §12.1 Future work — per-tool Phase-6 redoes (planned, not scheduled)

User's stated intent: when probe-authoring rubrics stabilise for the other three tools, run analogous per-language family redoes for each. The expected sequence:

1. **`ss-find` redo** — needs an `ss-find`-specific probe set whose gold is "regex anchor + symbol" and grades on regex-match-plus-symbol-retrieval. The shape cell space adds regex-anchor breadth as a dimension (narrow / medium / broad alternation). Likely outcome: V1 (very-short + symbol + narrow-regex) replicates as the dominant cell, since the prior partial Phase-6 sweep already pointed there for fastify.
2. **`ss-semantic` redo** — needs golds authored against single-file in-context retrieval (the tool returns spans within one file). Shape grid is different: length and symbol-presence still matter, but the regex anchor dimension drops out (no regex in semantic mode); a "scoping verb" dimension may be added ("explain", "summarise", "find the section that").
3. **`structural` redo** — needs golds authored around the tree-sitter relationship model (callers, callees, depends-on). The shape grid adds a "relationship verb" dimension (`who calls X?` / `what does X depend on?` / `where is X overridden?`).

Each future redo follows the same architectural pattern as this `ss-search` redo: 5 pre-registered families, deterministic Track A primary, optional scoped Track B, BH-FDR + Thresholdout + leakage + author + intrafamily-stability gates, family-conditioned `recommendations-v2-<tool>.json` output. The 5 families established in §4 are **shared** across all tools (they're language properties, not tool properties); the per-tool sweep produces its own per-family override map.

The three future redoes are sequenced AFTER this `ss-search` redo because (a) `ss-search` is the highest-traffic tool, (b) PHASE7 needs at least one tool's family-conditioned recommendations to motivate the family-detection scaffolding in T_i variants, and (c) the families themselves are validated by this first redo — if intra-family heterogeneity (§4.3) forces per-language reporting, that finding propagates to the other three redoes and changes their design too.

---

## §13 Sequencing

```
1. Land Rust RS-008 chunker fix (separate PR; Rust-fix handoff)
2. Re-index affected languages (the chunker change re-indexes ALL languages
   because the sibling-merge policy applies cross-language)
3. Re-run baseline AST-tester probes per language; commit new baselines
   (these become the new locked baseline per PLAN.md §1)
4. Build authoring infra per §5.2/§5.3: preprocess.mjs + author-variants.mjs
   + validator.mjs. One-time setup, reusable for all 4 tool redoes.
5. Spot-check the pipeline: author ~20 variants for 1 language, human-review
   V5/V6 paraphrase quality. Reject pipeline if quality rate < 70%; iterate
   on prompt template before scaling.
6. Author the 1,484 shape variants (§5.1-§5.4) — direct DeepSeek V4 Flash API,
   20-30 concurrent, ~15-25 min wall, ~$0.30 cost.
7. Run Track A deterministic sweep (§6.1) — ~5 min wall
8. Aggregate, apply §8 decision rules and §9 promotion gates
9. Write recommendations-v2.json
10. (Optional, post-Track-A) Track B subsample (§6.3) — ~$80, 24 pairs, judge via Gemini 3 Flash or GPT-5.5 direct API (NOT DeepSeek — keep judge disjoint from authoring model per §5.4)
11. Update PHASE7.md per §11
12. Bump SYSTEM_PROMPT_OPT_PLAN.md reference stub date
```

Steps 4-7 are the load-bearing block. Steps 1-3 happen first because the chunker change invalidates shape sensitivity. Step 4 (infra) and step 5 (spot-check) are one-time costs paid before scaling. Step 10 is optional and gated on step 9's outcome (skip if recommendations are decisive). End-to-end wall time after step 3: **~20-30 min for steps 6-9** at concurrency 20-30 (variant authoring 15-25 min + Track A sweep ~5 min). Step 4 infra build is one-time engineering work, not measured in sweep wall time.

---

## §14 Open risks

1. **Probe representativeness.** The AST-tester probe queries were authored to stress chunkers, not to mirror how real agents query. If the optimal shape per family is fitted to probe-author phrasing, the recommendation may overfit to a synthetic distribution. **Mitigation**: as a sanity check, sample 50-100 real `ss-search` queries from logged Claude Code traces (if logged) and classify their shape distribution; if probe shapes mismatch real-query shapes by > 30%, downgrade the artifact's confidence and add a `representativeness_caveat` field to recommendations-v2.json.
2. **Within-family heterogeneity.** §4.3 — if the OO-monolithic family splits (e.g., Scala prefers V1 but Java prefers V4), the family override gate G5 will block promotion and we ship per-language descriptive-only. That is the correct outcome but it weakens the value of family conditioning. Plan accordingly.
3. **n=3 held-out per language.** Thresholdout oracle has thin signal at the per-language level. All G2 decisions are at family-pooled n=6-12. Acceptable but tight.
4. **The chunker fix changes things we don't expect.** The RS-008 sibling-merge policy change may shift retrieval characteristics in subtle ways across languages (any small multi-fn file). After step 3 re-index, validate that the new baselines on the 18-language probes do not show large unexpected shifts in PASS/FAIL pattern. If they do, the families themselves may need to be re-clustered.
5. **Probe authoring bandwidth.** 1,484 variants is real human work even with templating. If we cannot fund the variant authoring, run a reduced 5-shape grid (V1/V2/V4/V5/V7, dropping V3 and V6) to halve the work.

---

## §15 Pre-registration items

These must be committed BEFORE any sweep run. Checklist:

- [ ] PHASE6_REDO.md committed (this file)
- [ ] `core/prompt-optimization/data/query-shapes/preregistration-v2.md` written with: split seed (42), family groupings (§4), weights (§7), decision rules (§8), promotion gates (§9), expected default shape, expected family overrides
- [ ] Variant-builder grid updated to V7 alongside V1-V6: `core/prompt-optimization/data/query-shapes/build-variants.mjs`
- [ ] **`preprocess.mjs`** script written (§5.2 + §5.5): produces `inputs/<lang>-<probe-id>.json` per the §5.5.2 schema — source snippet at pinned SHA + containing chunk via `ast_chunker` + graph neighbours from `code-graph.db` + path-token decomposition.
- [ ] **`deepseek-client.mjs`** + **`author-variants.mjs`** scripts written (§5.2 + §5.5.4 + §5.5.5): direct DeepSeek V4 Flash HTTP API client using exact model name `deepseek-v4-flash`, non-reasoning mode, `response_format: { type: 'json_object' }`, `temperature: 0.3`, `max_tokens: 512`, 20-30 concurrent async workers via `p-limit`, exponential backoff on 429 (1→2→4→8→16s cap). Prompt template per §5.5.5. Variant output per §5.5.3 schema.
- [ ] **`validator.mjs`** module written (§5.3 + §5.5.6): all six checks (JSON schema, length, symbol-presence, symbol-leak, path-token-leak with the §5.5.6 stopword list and 3-char-substring rule, empty/boilerplate). Runs synchronously after every model emit, drives re-prompt loop (max 2 retries with the §5.5.5 re-prompt prefix).
- [ ] DeepSeek API key configured in env (`DEEPSEEK_API_KEY`); endpoint `api.deepseek.com/v1/chat/completions` reachable; non-zero balance confirmed.
- [ ] **Family-detection mapping (§5.5.7)** committed as a shared module at `core/prompt-optimization/data/query-shapes/family-map.mjs` so both PHASE6_REDO scripts and PHASE7.md T_i variants import the same source of truth.
- [ ] **`aggregate-track-a.mjs`** script written (§5.5.8): paired permutation tests on `file_recall@1`, baseline = existing AST-tester probe phrasing, 10K permutations seed=42, BH-FDR over 7-shape × 5-family = 35-cell space, emits `recommendations-v2.json` per §10 schema.
- [ ] Track A runner extended to read AST-tester gold + doc-positive gold, write per-(language, gold, shape) rows to `tracks/track-a-<runId>.jsonl` per §5.5.1 layout.
- [ ] Spot-check: run §5.2 pipeline on 1 language (10-20 variants) and human-review for paraphrase quality before committing to full 1,484-variant sweep. Reject if V5/V6 quality rate < 70%.

After all 10 boxes are ticked, sweep is unblocked. Estimated wall time after unlock: ~15-25 min for variant authoring + ~5 min for Track A sweep = **~20-30 min end-to-end for this `ss-search` redo**. (Per-tool wall time for the future ss-find / ss-semantic / structural redoes will be similar once their probe sets are authored — the same infra in §5.2-§5.5 is reused.)

---

## §16 Relationship to documents

- **Replaces**: SYSTEM_PROMPT_OPT_PLAN.md Part 7 (Query-Shape Discovery)
- **Feeds**: docs/PHASE7.md §4.1, §4.2, §4.3 (variant authoring with family-conditioned instruction_text)
- **Depends on**: Rust RS-008 chunker fix (handoff message; not a doc)
- **Compatible with**: SYSTEM_PROMPT_OPT_PLAN.md §0.5 (overfit controls) — all five gates of §9 are subsumed under the §0.5 dual-layer framework
- **Out of scope but referenced**: separate Phase 6 redos for `ss-find`, `ss-semantic`, `structural` (future work)

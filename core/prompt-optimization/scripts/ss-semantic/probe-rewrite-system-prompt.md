# Behavioural-rewrite system prompt — ss-semantic Stage 0.5

**Purpose**: produce a parallel benchmark of *behavioural* queries against the
existing ast-tester golds. Each rewrite turns a symbol-anchored gold into the
sort of query a real agent would issue when they already know the file path
but want to find "the bit that does Y" inside it.

This complements (does not replace) the strict symbol-anchored benchmark.
A real Stage 4 fix is one that wins on BOTH benchmarks; a symptom-fit only
wins on one.

## Authoring discipline

- **Author**: DeepSeek V4-Flash (`deepseek-v4-flash`), non-reasoning, direct API.
- **Disjoint-author chain**: original gold authored by sweet-search-core (human);
  variants authored by DeepSeek; **rewrites also DeepSeek** for consistency with
  the variant-authoring chain. Do NOT have Claude/Sonnet/GPT-5 rewrite — the
  chain stays uniform.
- **Reproducibility**: seed=42, temperature=0.3, response_format=json_object.
- **Schema version**: matches author-variants.mjs schema (`outputSha256` for
  drift detection on re-runs).

## System prompt (verbatim — feed to DeepSeek as the `system` message)

```
You are rewriting a code-search probe into a behavioural query. The original
probe is symbol-anchored ("find function X"); your job is to express the SAME
intent as a natural-language question about behaviour ("find the bit that
does Y") so we can measure whether the search tool is actually useful for
the way agents query in practice.

You will see:
  - file path
  - expected symbol name (the thing the original probe was looking for)
  - the source code of that symbol (its actual body, including signature
    and doc comments)
  - a human-authored description of what the symbol does ("goldNotes")

Produce ONE rewritten query that captures the same intent without naming
the symbol.

Hard constraints (query is REJECTED if violated):

1. Length: 4 to 15 whitespace-split tokens.

2. Must NOT contain the expected symbol verbatim (case-insensitive substring).
   If the symbol is "redisConnectWithOptions", queries like "redisConnect" or
   "ConnectWithOptions" are also rejected — no sub-string of the symbol of
   length ≥ 5 chars may appear.

3. Must NOT contain any symbol sub-token stem (≥ 5-char shared prefix or
   suffix with any symbol sub-token after splitting on underscores AND
   camelCase). Example: if the symbol is "redisConnectWithOptions", the
   sub-tokens are ["redis", "connect", "with", "options"]. Forbidden query
   words include "redis", "redisreader", "connection", "connecting",
   "options", "optional", "withhold". Re-phrase with synonyms.

4. Must contain at least one behavioural verb or interrogative:
   find / show / locate / where / how / trace / identify / return / handle
   / process / build / parse / render / open / send / read / write / dispatch
   / resolve / convert / extract / emit / register / wait / track / cancel
   / join / encode / decode / authenticate / validate / serialize / persist.

5. Must contain at least one domain-relevant content word drawn from the
   symbol's actual behaviour (NOT the symbol name or path). Examples:
   - For an HTTP-response builder: "response", "headers", "cookies"
   - For a JSON parser: "json", "type", "field", "value"
   - For a TCP connect: "tcp", "socket", "connection", "host"
   The point: the rewrite should be lexically anchored on what the code
   DOES, not on what it's CALLED.

6. Must read like a real agent query, not a textbook prose paraphrase.
   Prefer short imperative or how/where forms over long declarative
   subordinate-clause constructions. "find the function that handles the
   retry backoff loop" is good. "How is the architecture of the retry
   subsystem organized to satisfy the requirement of bounded latency under
   failure conditions" is bad.

If the symbol is genuinely impossible to rewrite without leaking
(e.g., trivial generic names like "Reader" or "Convert" where no synonym
exists that isn't itself the symbol), return:

  {"rewrittenQuery": null, "rationale": "behavioural rewrite infeasible: <one sentence why>"}

Otherwise return:

  {"rewrittenQuery": "<the query>", "rationale": "<one sentence on what behaviour the query captures>"}

No prose outside the JSON object. No markdown fences.
```

## Validation pipeline

After parsing the model emit, in order:

1. **Schema**: `rewrittenQuery` is either `null` (infeasible) or a non-empty
   string. `rationale` is a string. Reject everything else.
2. **Length check**: `whitespaceTokenCount(rewrittenQuery)` ∈ [4, 15].
3. **Symbol-leak check**: reuse `validateVariant(parsed, 'V5', input)` from
   `validator.mjs` after re-keying `rewrittenQuery` → `query`. V5 is the
   "medium+without-symbol" cell — exactly the rules we want except for the
   length tier (which we override above).
4. **Behavioural-verb regex** (additional, on top of V5): query must match
   `/\b(find|show|locate|where|how|trace|identify|return|handle|process|build|parse|render|open|send|read|write|dispatch|resolve|convert|extract|emit|register|wait|track|cancel|join|encode|decode|authenticate|validate|serialize|persist)\b/i`.

On validation failure: re-prompt with the §5.5.5 re-prompt prefix already
defined in `author-variants.mjs`. Max 2 retries (matching the existing
convention). If all retries fail, log `rewrittenQuery: null, infeasible: true`
in the output JSON so the artefact preserves the count of "unrewritable"
golds (signal for later — these are the golds where the symbol IS the
behaviour).

## Stratification

Sample 30-50 golds total, stratified per family (so each family contributes
6-10 rewrites):

| family | n probes | sample target |
|---|---|---|
| OO-monolithic | 32 | 8 |
| Systems-modular-terse | 16 | 6 |
| C-family | 24 | 7 |
| JS-mobile | 32 | 8 |
| Scripting-dynamic | 40 | 10 |

Total target: 39. Stratified random with seed=42 within each family.
Apply the same 60/40 dev/heldout split from `splits/manifest.json`.

## Output schema

Per-language file at `eval/ast-tester-probes/gold-behavioral/<lang>.json`:

```json
{
  "schemaVersion": 1,
  "description": "Behavioural rewrites of ast-tester probes — Stage 0.5 parallel benchmark",
  "createdAt": "<ISO>",
  "rewriteModel": "deepseek-v4-flash",
  "rewriteSeed": 42,
  "rewriteTemperature": 0.3,
  "language": "<lang>",
  "rewrites": [
    {
      "id": "<rewrittenFrom>-B",
      "rewrittenFrom": "<original goldId>",
      "rewrittenQuery": "<the query>",
      "infeasible": false,
      "rationale": "<one-sentence rationale>",
      "validatorVerdict": "pass",
      "outputSha256": "<sha256 of rewrittenQuery>",
      "expectedFile": "<copied from original gold>",
      "expectedSymbol": "<copied — for traceability ONLY, NOT used in query>",
      "containingChunk": { "startLine": ..., "endLine": ... }
    }
  ]
}
```

The runner that grades behavioural-benchmark rows reads
`expectedFile` + `rewrittenQuery` (the symbol field is for traceability
only — never substituted into the query).

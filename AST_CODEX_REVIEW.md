# AST Chunker / Graph Extractor Implementation Review

Date: 2026-02-12
Reviewer: Codex
Scope reviewed:
- `ast-chunker.js`
- `core/graph-extractor.js`
- `core/language-patterns.js`
- `core/config.js`
- `__tests__/language-patterns.test.js`
- `__tests__/multi-language-chunker.test.js`
- `__tests__/graph-extractor-generic.test.js`
- `docs/AST_CHUNKER_FIX_PLAN.md`

Verification performed:
- Static code audit (line-by-line)
- Targeted behavioral probes with Node snippets
- Test execution:
  - New tests only: `68/68` passing
  - Full suite: `1028 passed, 1 skipped, 0 failed`

## Claim Check

1. "68 new tests across 3 files": **Accurate**
2. "1028 tests passed, 0 failures": **Accurate in current repo run** (there is also `1 skipped`)
3. "Files modified" list in summary: **Incomplete**
4. "Implementation fully complete" / all gates passed: **Overstated** due correctness gaps below

## Findings (ordered by severity)

1. **High: End-keyword chunking closes blocks too early in real Ruby/Elixir/Lua code**
- Why this matters: `if/end`, `case/end`, etc. inside methods/classes can prematurely terminate chunks.
- Evidence: `ast-chunker.js:140`, `ast-chunker.js:151`, `ast-chunker.js:154`.
- Root cause: depth increments only on chunk-boundary patterns, but decrements on every `end` line.
- Impact: malformed chunks, missing tails, bad metadata.

2. **High: Go method chunk symbol is wrong (receiver type instead of method name)**
- Why this matters: chunk metadata symbol for methods is incorrect.
- Evidence: `core/language-patterns.js:282`, `ast-chunker.js:176`.
- Root cause: method regex captures receiver type in group 1; chunker always uses `match[1]` as symbol.
- Example observed: `func (s *S) Start()` yields symbol `S`, not `Start`.

3. **High: Generic graph extractor uses brace-based end-line logic for non-brace languages**
- Why this matters: Python/Ruby/YAML/etc entities get inflated/wrong `end_line` values (often file end).
- Evidence: `core/graph-extractor.js:626`, `core/graph-extractor.js:749`.
- Impact: inaccurate entity ranges and degraded downstream quality.

4. **High: Generic extraction contract (`match[1]`) is violated by multiple registry patterns**
- Why this matters: silent wrong/missing entities/relationships.
- Evidence:
  - `core/graph-extractor.js:613`
  - `core/language-patterns.js:328` (Rust `impl` captures trait in group 1; type in group 2)
  - `core/language-patterns.js:335` (Rust `implFor` has two groups but generic logic only uses first)
  - `core/language-patterns.js:1186` (Docker `entrypoint` has no capture group)
- Impact: incorrect graph semantics (e.g., impl targets wrong/missing), silent data loss.

5. **High: Docker `FROM` relationship extracts wrong target (`n` from `node:20`)**
- Why this matters: dependency graph quality is broken for Dockerfiles.
- Evidence: `core/language-patterns.js:1191`.
- Root cause: non-greedy capture `\S+?` combined with optional tag group.

6. **Medium: Python plain imports are missed (`import os`)**
- Why this matters: import graph is incomplete.
- Evidence: `core/language-patterns.js:264`, `core/graph-extractor.js:652`.
- Root cause: generic relation logic requires `match[1]`; for plain imports, group 1 is undefined.

7. **Medium: Several chunker patterns can never create boundaries**
- Why this matters: these languages/types degrade to large generic `code/unknown` chunks.
- Evidence: `ast-chunker.js:176` (requires capture group), plus patterns without capture groups such as:
  - `core/language-patterns.js:730` (css.rule)
  - `core/language-patterns.js:731` (css.media)
  - `core/language-patterns.js:1178` (dockerfile.run)
  - `core/language-patterns.js:1179` (dockerfile.copy)
- Impact: gate claim "structured output for all languages" is not met.

8. **Medium: Chunk `line_end` metadata is off-by-one for non-final chunks**
- Why this matters: source ranges are systematically inaccurate.
- Evidence: `ast-chunker.js:65`, `ast-chunker.js:100`, `ast-chunker.js:113`, `ast-chunker.js:144`, `ast-chunker.js:159`, `ast-chunker.js:233`.

9. **Medium: Generic call relationships lose source linkage (`source_id: null`)**
- Why this matters: weak graph traversal and poorer resolution/dedup behavior.
- Evidence: `core/graph-extractor.js:642`.

10. **Medium: Summary file-change claim is incomplete**
- Claimed modified files omitted:
  - `core/config.js` (actually modified)
  - `docs/AST_CHUNKER_FIX_PLAN.md` (actually modified)
- Evidence: latest implementation commit `67f3952` includes both files in its diffstat.

11. **Low: Plan doc still says not implemented**
- Why this matters: status/documentation contradiction.
- Evidence: `docs/AST_CHUNKER_FIX_PLAN.md:3` still reads `Status: Plan (not yet implemented)`.

12. **Low: Registry completeness claim is slightly overstated**
- `EXTENSION_MAP` has 70 extensions (not 70+), and includes `vb` mapping without a `LANGUAGES.vb` implementation.
- Evidence: `core/language-patterns.js:129`, `core/language-patterns.js:152`.

13. **Low: Gate 3 language verification claim includes PHP, but new generic graph tests do not cover PHP**
- Evidence: `__tests__/graph-extractor-generic.test.js:71` starts the generic entity language set and that file includes no PHP case.

## Potential Vulnerabilities / Risk Surface

1. **Parser correctness risk**: silent malformed extraction (no runtime crash) can poison graph/search quality without obvious failure signals.
2. **Potential ReDoS/perf risk on adversarial huge lines**: many complex regexes are run line-by-line across many patterns; this is a practical DoS vector during indexing of untrusted repos.
3. **Silent data-loss patterns**: mismatch between regex captures and generic extractor assumptions leads to missing entities/relationships without warnings.

## Optimization Opportunities

1. Precompute and cache `methodCall` global regexes per language instead of constructing `new RegExp(...)` per line in `extractGeneric`.
2. Add a registry validator test that enforces:
- every `chunker` pattern has capture group 1
- every `graph.entities` pattern has capture group 1
- every `graph.relationships` pattern either maps explicitly or is intentionally default-mapped
3. Split generic end-line detection by strategy (brace vs indent vs end-keyword), same as chunker.
4. Add negative/edge tests for:
- Ruby/Elixir nested `end`
- Go method symbol extraction
- Python `import x` and `from x import y`
- Docker `FROM image:tag` parsing
- CSS rule chunk boundaries
5. Emit debug counters/warnings when a pattern matches but `match[1]` is empty to avoid silent drops.
6. Consider per-language fast prefilters (prefix checks) before trying every regex on every line.

## Test Notes

- New test files and counts match your summary (`37 + 12 + 19 = 68`).
- Full suite currently passes (`1028 passed, 1 skipped, 0 failed`).
- Current test coverage is broad but not deep for many newly added languages; several semantic bugs above pass existing tests.

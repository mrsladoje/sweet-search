# AST Chunker / Graph Extractor — Remaining Findings

Date: 2026-02-12 (original), trimmed 2026-02-13
Reviewer: Codex
Scope: `ast-chunker.js`, `core/graph-extractor.js`, `core/language-patterns.js`

Resolved findings removed: #5 (Docker FROM regex), #10–13 (documentation-only).
Partially resolved: #2 (Go method symbol — fixed in graph extractor, still wrong in chunker).

---

## Findings (ordered by severity)

1. **High: End-keyword chunking closes blocks too early in real Ruby/Elixir/Lua code**
- Why this matters: `if/end`, `case/end`, etc. inside methods/classes can prematurely terminate chunks.
- Evidence: `ast-chunker.js:140`, `ast-chunker.js:151`, `ast-chunker.js:154`.
- Root cause: depth increments only on chunk-boundary patterns, but decrements on every `end` line.
- Impact: malformed chunks, missing tails, bad metadata.

2. **High: Generic graph extractor uses brace-based end-line logic for non-brace languages**
- Why this matters: Python/Ruby/YAML/etc entities get inflated/wrong `end_line` values (often file end).
- Evidence: `core/graph-extractor.js:792–810`.
- Root cause: `findEndLine()` is purely brace-counting; non-brace languages fall through to `return lines.length`.
- Impact: inaccurate entity ranges and degraded downstream quality.

3. **High: Go method chunker symbol is wrong (receiver type instead of method name)**
- Why this matters: chunk metadata symbol for Go methods is the receiver type, not the method name.
- Evidence: `core/language-patterns.js:287` chunker method pattern captures receiver type in group 1.
- Root cause: `/^func\s+\(\w+\s+\*?(\w+)\)\s+(\w+)\s*\(/` — group 1 = receiver type, group 2 = method name. `_matchBoundary` uses `match[1]`.
- Note: the graph extractor pattern at line 295 was fixed (method name in group 1). Only the chunker pattern remains wrong.
- Example: `func (s *S) Start()` yields chunk symbol `S`, not `Start`.

4. **High: Generic extraction contract (`match[1]`) is violated by multiple registry patterns**
- Why this matters: silent wrong/missing entities/relationships.
- Evidence:
  - `core/graph-extractor.js:636`
  - `core/language-patterns.js:340` (Rust `implFor` captures trait in group 1; type in group 2)
  - `core/language-patterns.js:1191` (Docker `entrypoint` has no capture group)
- Impact: incorrect graph semantics (e.g., impl targets wrong/missing), silent data loss.

5. **Medium: Python plain imports are missed (`import os`)**
- Why this matters: import graph is incomplete.
- Evidence: `core/language-patterns.js:269`, `core/graph-extractor.js:682`.
- Root cause: generic relation logic requires `match[1]`; for plain imports, group 1 is undefined.

6. **Medium: Several chunker patterns can never create boundaries**
- Why this matters: these languages/types degrade to large generic `code/unknown` chunks.
- Evidence: `ast-chunker.js:189` (requires capture group), plus patterns without capture groups:
  - `core/language-patterns.js:735` (css.rule)
  - `core/language-patterns.js:736` (css.media)
  - `core/language-patterns.js:1183` (dockerfile.run)
  - `core/language-patterns.js:1184` (dockerfile.copy)
- Impact: gate claim "structured output for all languages" is not met.

7. **Medium: Chunk `line_end` metadata is off-by-one for non-final chunks**
- Why this matters: source ranges are systematically inaccurate.
- Evidence: `ast-chunker.js:65`, `ast-chunker.js:100`, `ast-chunker.js:113`, `ast-chunker.js:144`, `ast-chunker.js:159`, `ast-chunker.js:233`.

8. **Medium: Generic call relationships lose source linkage (`source_id: null`)**
- Why this matters: weak graph traversal and poorer resolution/dedup behavior.
- Evidence: `core/graph-extractor.js:666`.

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
- Go method chunk symbol extraction
- Python `import x` and `from x import y`
- CSS rule chunk boundaries
5. Emit debug counters/warnings when a pattern matches but `match[1]` is empty to avoid silent drops.
6. Consider per-language fast prefilters (prefix checks) before trying every regex on every line.

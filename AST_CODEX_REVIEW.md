# AST Chunker / Graph Extractor — Remaining Findings

Date: 2026-02-12 (original), trimmed 2026-02-13
Reviewer: Codex
Scope: `ast-chunker.js`, `core/graph-extractor.js`, `core/language-patterns.js`

Resolved findings removed: #5 (Docker FROM regex), #10–13 (documentation-only).
Partially resolved: #2 (Go method symbol — fixed in graph extractor, still wrong in chunker).

**2026-02-14: All 8 remaining findings resolved.** See commit for details.

---

## Findings (ordered by severity) — ALL RESOLVED

1. ~~**High: End-keyword chunking closes blocks too early in real Ruby/Elixir/Lua code**~~
   **RESOLVED**: Added `blockKeywords` to Ruby, Elixir, and Lua language configs. `parseEndKeywordFile` now counts non-boundary block starters (if/unless/while/case/etc.) for correct depth tracking. Nested `if/end` blocks no longer prematurely close method/class chunks.

2. ~~**High: Generic graph extractor uses brace-based end-line logic for non-brace languages**~~
   **RESOLVED**: Added `findEndLineIndent()` and `findEndLineKeyword()` methods to `GraphExtractor`. `extractGeneric()` now chooses the correct strategy based on `langInfo.indentBased`/`endKeyword`.

3. ~~**High: Go method chunker symbol is wrong (receiver type instead of method name)**~~
   **RESOLVED**: Changed Go chunker method pattern from `/^func\s+\(\w+\s+\*?(\w+)\)\s+(\w+)\s*\(/` to `/^func\s+\(\w+\s+\*?\w+\)\s+(\w+)\s*\(/` — receiver type is now non-capturing, method name is group 1.

4. ~~**High: Generic extraction contract (`match[1]`) is violated by multiple registry patterns**~~
   **RESOLVED**: Fixed Rust `impl` entity pattern to always capture the impl target type in group 1. Added `implFor: 'implements'` and `plainImport: 'imports'` to `relMapping` in `extractGeneric`. Fixed Docker `entrypoint` to have a capture group.

5. ~~**Medium: Python plain imports are missed (`import os`)**~~
   **RESOLVED**: Split Python import relationship into two patterns: `import` for `from X import Y` and `plainImport` for `import X`. Both always have the module name in group 1.

6. ~~**Medium: Several chunker patterns can never create boundaries**~~
   **RESOLVED**: Added capture groups to CSS rule/media/fontface, SCSS rule/media, LESS rule, Sass rule, Dockerfile RUN/COPY. Added `from`/`to`/`\d+%` to CSS rule negative lookahead to prevent keyframe internals from creating boundaries.

7. ~~**Medium: Chunk `line_end` metadata is off-by-one for non-final chunks**~~
   **RESOLVED**: Fixed `buildChunk` to use `lineEnd + 1` for consistent 1-based line_end. Adjusted `_pushFinalChunk` and `parseGenericFile` callers accordingly.

8. ~~**Medium: Generic call relationships lose source linkage (`source_id: null`)**~~
   **RESOLVED**: `extractGeneric` now tracks `lastEntityId` as context and uses it as `source_id` for method call relationships.

## Potential Vulnerabilities / Risk Surface

1. **Parser correctness risk**: ~~silent malformed extraction~~ Mitigated by fixes 1-4. Consider adding a registry validator test (see optimization #2).
2. **Potential ReDoS/perf risk on adversarial huge lines**: many complex regexes are run line-by-line across many patterns; this is a practical DoS vector during indexing of untrusted repos.
3. **Silent data-loss patterns**: ~~mismatch between regex captures and generic extractor assumptions~~ Mitigated by fix 4. Consider adding debug counters (optimization #5).

## Optimization Opportunities (remaining)

1. ~~Precompute and cache `methodCall` global regexes per language instead of constructing `new RegExp(...)` per line in `extractGeneric`.~~ **DONE** (cached per-language in `GraphExtractor`).
2. ~~Add a registry validator test that enforces:~~ **DONE** (see `__tests__/language-pattern-registry-validator.test.js`):
- every `chunker` pattern has capture group 1
- every `graph.entities` pattern has capture group 1
- every `graph.relationships` pattern either maps explicitly or is intentionally default-mapped
3. ~~Split generic end-line detection by strategy (brace vs indent vs end-keyword), same as chunker.~~ **DONE** (fix #2).
4. ~~Add negative/edge tests for Ruby/Elixir nested end, Go method symbol, Python imports, CSS rules.~~ **DONE** (tests updated in this commit).
5. ~~Emit debug counters/warnings when a pattern matches but `match[1]` is empty to avoid silent drops.~~ **DONE** (added counters in `ASTChunker` and `GraphExtractor`, optional warnings via `warnOnPatternDrop`).
6. ~~Consider per-language fast prefilters (prefix checks) before trying every regex on every line.~~ **DONE** (added cached start-token prefilters for generic entity/relationship matching).

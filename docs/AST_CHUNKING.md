# AST Chunking & Graph Extraction

Sweet Search's regex-based code intelligence engine. Extracts semantic chunks and
knowledge graphs from 37 languages across 70+ file extensions.

---

## Architecture

```
File on disk
  |
  v
core/language-patterns.js          <-- shared registry (single source of truth)
  |                  |
  v                  v
ast-chunker.js      core/graph-extractor.js
  |                  |
  v                  v
Chunks (text +      Entities + Relationships
metadata)           (code graph in SQLite)
  |                  |
  v                  v
Vector embeddings   FTS5 indexes (porter + trigram)
HNSW index          Relationship resolution
                    HCGS summaries
```

Everything downstream of the chunker and graph extractor is language-agnostic.
Only these two components need language patterns.

### Key Files

| File | Responsibility |
|------|---------------|
| `ast-chunker.js` | `ASTChunker` class - splits source into semantic chunks |
| `core/graph-extractor.js` | `GraphExtractor` class - extracts entities and relationships |
| `core/language-patterns.js` | API entry point (`getLanguageByPath`, `getLanguageByExtension`, etc.) |
| `core/language-patterns/maps.js` | `EXTENSION_MAP` (70+ extensions) and `FILENAME_MAP` |
| `core/language-patterns/registry.js` | Composes the 5 themed registry modules |
| `core/language-patterns/registry-core.js` | JS/TS, Java, Python, Go, Rust, C, C++, C# |
| `core/language-patterns/registry-object-oriented.js` | Proto, PHP, Ruby, Kotlin, Swift, Scala, Dart, Groovy, Obj-C |
| `core/language-patterns/registry-web-style.js` | HTML, CSS, SCSS, Sass, LESS |
| `core/language-patterns/registry-data-query.js` | SQL, GraphQL, JSON, YAML, TOML, XML |
| `core/language-patterns/registry-tooling.js` | Shell, PowerShell, Lua, Zig, Elixir, Nim, F#, Dockerfile, Makefile |
| `core/document-chunker.js` | Facade dispatching `.md`/`.mdx`/`.rst`/`.txt` to specialized chunkers |

---

## Supported Languages (37 configs + 3 document formats)

### Core (registry-core.js)

| ID | Extensions | Parsing Strategy |
|----|-----------|------------------|
| `javascript` | `.js` `.jsx` `.mjs` `.cjs` `.ts` `.tsx` | Brace-based |
| `java` | `.java` | Brace-based |
| `python` | `.py` `.pyi` | Indent-based |
| `go` | `.go` | Brace-based |
| `rust` | `.rs` | Brace-based |
| `c` | `.c` `.h` | Brace-based |
| `cpp` | `.cpp` `.cc` `.cxx` `.hpp` `.hxx` | Brace-based |
| `csharp` | `.cs` | Brace-based |

### Object-Oriented (registry-object-oriented.js)

| ID | Extensions | Parsing Strategy |
|----|-----------|------------------|
| `proto` | `.proto` | Brace-based |
| `php` | `.php` | Brace-based |
| `ruby` | `.rb` `.erb` | End-keyword (`end`) |
| `kotlin` | `.kt` `.kts` | Brace-based |
| `swift` | `.swift` | Brace-based |
| `scala` | `.scala` | Brace-based |
| `dart` | `.dart` | Brace-based |
| `groovy` | `.groovy` | Brace-based |
| `objc` | `.m` `.mm` | End-keyword (`@end`) |

### Web & Style (registry-web-style.js)

| ID | Extensions | Parsing Strategy |
|----|-----------|------------------|
| `html` | `.html` `.htm` `.xhtml` `.vue` `.svelte` | Brace-based |
| `css` | `.css` | Brace-based |
| `scss` | `.scss` | Brace-based |
| `sass` | `.sass` | Indent-based |
| `less` | `.less` | Brace-based |

### Data & Query (registry-data-query.js)

| ID | Extensions | Parsing Strategy |
|----|-----------|------------------|
| `sql` | `.sql` | Brace-based |
| `graphql` | `.graphql` `.gql` | Brace-based |
| `json` | `.json` `.jsonc` `.json5` | Brace-based |
| `yaml` | `.yaml` `.yml` | Indent-based |
| `toml` | `.toml` | Brace-based |
| `xml` | `.xml` `.xsl` `.xsd` `.wsdl` `.pom` `.csproj` | Brace-based |

### Tooling & Infrastructure (registry-tooling.js)

| ID | Extensions / Filenames | Parsing Strategy |
|----|----------------------|------------------|
| `shell` | `.sh` `.bash` `.zsh` `.fish` | Brace-based |
| `powershell` | `.ps1` | Brace-based |
| `lua` | `.lua` | End-keyword (`end`) |
| `zig` | `.zig` | Brace-based |
| `elixir` | `.ex` `.exs` | End-keyword (`end`) |
| `nim` | `.nim` | Indent-based |
| `fsharp` | `.fs` `.fsx` | Indent-based |
| `dockerfile` | `.dockerfile`, `Dockerfile`, `Dockerfile.*` | Brace-based |
| `makefile` | `.mk`, `Makefile`, `GNUmakefile` | Brace-based |

### Document Formats (via DocumentChunker)

| ID | Extensions | Handler |
|----|-----------|---------|
| `markdown` | `.md` `.mdx` | `MarkdownChunker` (heading-based) |
| `rst` | `.rst` | `MarkdownChunker` (underline-style headers) |
| `plaintext` | `.txt` | `PlainTextChunker` (paragraph-based) |

---

## Chunking: Three Parsing Strategies

`ASTChunker.parseFile()` dispatches to the correct strategy based on the language
config's `indentBased` and `endKeyword` flags.

### 1. Brace-Based (`parseBraceBasedFile`)

Used by most languages. Tracks `{` / `}` depth.

- A **boundary** is detected when a line matches a chunker pattern (via `_matchBoundary`)
- The chunk closes when either:
  - A new boundary is found (starts a new chunk), or
  - `braceDepth` returns to 0
- Comment/string stripping via `_stripNonCode()` prevents false brace counts
  - Handles line comments, block comments, single/double-quoted strings
  - JavaScript template literals with `${}` interpolation tracked correctly

### 2. Indent-Based (`parseIndentBasedFile`)

Used by: Python, YAML, Nim, F#, Sass.

- Boundary matched via `_matchBoundary`, same as brace-based
- Chunk closes when a non-blank, non-comment line appears at equal or lesser indentation
- Blank lines and `#`-comments are skipped during indent tracking

### 3. End-Keyword (`parseEndKeywordFile`)

Used by: Ruby (`end`), Elixir (`end`), Lua (`end`), Objective-C (`@end`).

- Boundary patterns start a chunk and increment `depth`
- The `endKeyword` regex decrements `depth`
- **Block keywords** (`blockKeywords` array) also increment depth without starting
  new chunks. This prevents nested `if/case/while/for` blocks from prematurely
  closing the enclosing `def`/`class`/`module` chunk.
- Chunk closes when `depth` returns to 0 after an `end` match

**Block keywords by language:**

| Language | blockKeywords |
|----------|--------------|
| Ruby | `class`, `module`, `def`, `if`, `unless`, `while`, `until`, `case`, `for`, `begin`, `do` |
| Elixir | `defmodule`, `defmacro`, `defp`, `def`, `fn`, `if`, `unless`, `case`, `cond`, `with`, `try`, `receive` |
| Lua | `function`, `if`, `while`, `for` |

### Boundary Matching (`_matchBoundary`)

All strategies share the same boundary detection:

1. The line is **trimmed** (`trimStart()`) before regex matching
2. Lines longer than `maxRegexLineLength` (default: 4000 chars) are skipped
3. Each chunker pattern is tested; the first match with a non-empty `match[1]` wins
4. If `match[1]` is empty, the match is recorded as a dropped empty capture (debug counter)

### Chunk Construction (`buildChunk`)

Every chunk gets this metadata:

```js
{
  text: content.trim(),
  content: content.trim(),
  metadata: {
    type: 'codebase',
    file: 'filename.py',
    path: 'relative/path/filename.py',
    language: 'python',
    chunk_type: 'function',       // from pattern key
    symbol: 'my_function',        // from match[1]
    line_start: 42,               // 1-based
    line_end: 67,                 // 1-based (lineEnd + 1)
    hash: 'abc123...'            // sha256 first 16 chars
  },
  tags: ['codebase', 'python', 'project-name']
}
```

- The 30-character threshold (`> 30`, strict) filters out trivially small chunks
- `line_end` uses `lineEnd + 1` for consistent 1-based numbering

### Generic Fallback (`parseGenericFile`)

Files with no language config fall through to a naive line-based chunker:
- 50-line window, 10-line overlap
- 20-character minimum threshold
- No structural awareness, no symbol metadata

### Document Dispatch

`.md`, `.mdx`, `.rst`, `.txt` files bypass `ASTChunker` entirely and are routed
to `DocumentChunker`, which delegates to `MarkdownChunker` or `PlainTextChunker`.

---

## Graph Extraction

`GraphExtractor.extractFromFile()` produces `{ entities[], relationships[] }` for
each source file.

### Specialized Extractors

Three languages have hand-written extractors with richer logic:

| Language | Method | Special Features |
|----------|--------|-----------------|
| Java | `extractJava()` | Package tracking, `@Override` detection, overloaded method disambiguation via signature hash, import resolution (static/wildcard) |
| JavaScript | `extractJavaScript()` | React component detection (capitalized names), arrow functions, external import filtering |
| Proto | `extractProto()` | Message/service/RPC extraction, RPC input/output `uses` relationships |

### Generic Extractor (`extractGeneric`)

All other languages use the registry-driven generic extractor. For each line:

1. **Entity extraction**: Tries each `graph.entities` pattern; first match with
   non-empty `match[1]` creates an entity with `id`, `type`, `name`, `signature`,
   `signature_hash`, `start_line`, `end_line`
2. **Relationship extraction**: Tries each `graph.relationships` pattern;
   `GENERIC_RELATIONSHIP_MAPPING` maps pattern keys to standardized types
3. **Method call extraction**: `methodCall` patterns get special global-regex
   handling (multiple matches per line), with `skipCallObjects` filtering

**End-line detection** uses the correct strategy per language:
- `findEndLine()` for brace-based (tracks `{`/`}` depth)
- `findEndLineIndent()` for indent-based (scans for equal/lesser indentation)
- `findEndLineKeyword()` for end-keyword (counts block starters vs end keywords)

**Entity scope tracking**: `activeEntityScopes` stack attributes `source_id` to
method call relationships by lexical position.

### Relationship Mapping

The `GENERIC_RELATIONSHIP_MAPPING` in `graph-extractor.js` normalizes pattern keys
to standard relationship types:

| Mapped Type | Pattern Keys |
|-------------|-------------|
| `imports` | `import`, `plainImport`, `include`, `require`, `use`, `prepend`, `open`, `source`, `from`, `forward`, `using`, `link`, `script`, `copyFrom`, `alias`, `namespace`, `ref`, `dep`, `package` |
| `extends` | `extends`, `inherit`, `mixin`, `with`, `category` |
| `implements` | `implements`, `protocol`, `implFor` |
| `uses` | `decorator`, `embed`, `extend`, `anchor`, `derive`, `throw`, `img`, `form`, `methodOf` |

Unmapped pattern keys default to `uses`.

### JSON Dependency Extraction

JSON files get special handling for `package.json`-style dependencies:

- `dep` pattern detects `"dependencies"`, `"devDependencies"`, `"peerDependencies"`
  section markers
- Brace depth tracking identifies which keys are inside dependency objects
- Each `"package": "version"` pair inside a dependency section creates an `imports`
  relationship

### Python Import Handling

Python has two import patterns to cover both forms:

- `import` pattern: `from X import Y` (captures module `X`)
- `plainImport` pattern: `import X, Y, Z` (captures comma-separated list)

`expandRelationshipTargets()` splits `plainImport` targets on commas and strips
`as` aliases.

### Entity IDs

`makeId(filePath, type, name, options)` generates 16-char hex IDs:

```
sha256(relativePath:type:name[:disambiguator])[0:16]
```

Disambiguation uses signature hash (8-char) or start line number as fallback,
preventing ID collisions for overloaded methods.

---

## Performance Optimizations

| Optimization | Location | Effect |
|-------------|----------|--------|
| **Cached global regexes** | `getCachedGlobalRegex()` | Avoids per-line `new RegExp()` for methodCall patterns |
| **Start-token prefilters** | `getPatternPrefilter()` | Skips regex execution when line prefix can't match |
| **Pattern plan cache** | `getGenericPatternPlan()` | Builds entity/relationship plan once per language |
| **Long line skip** | `maxRegexLineLength` (4000) | Prevents ReDoS on minified/generated lines |
| **Comment stripping** | `_stripNonCode()` | Prevents false brace counts from strings/comments |

### Prefilter Algorithm

`extractLineStartTokens()` statically analyzes regex source to extract mandatory
literal prefixes. For each line, a cheap `startsWith()` check runs before the full
regex. Patterns without extractable prefixes get no prefilter (full regex always
runs).

---

## Debug & Diagnostics

Both `ASTChunker` and `GraphExtractor` track debug counters accessible via
`getDebugCounters()`:

```js
{
  emptyCapture: { boundary: 0, entity: 0, relationship: 0 },
  skippedLongLines: 0,
  byLanguage: {
    python: { boundary: 0, skippedLongLines: 0 }
  },
  byPattern: {
    'python:boundary:decorator': 2
  }
}
```

Set `warnOnPatternDrop: true` in constructor options to emit console warnings
for the first 3 occurrences of each dropped pattern.

---

## Known Limitations

These are inherent to the regex-based approach and documented intentionally:

1. **`_matchBoundary()` trims lines** before regex matching. Patterns that rely on
   leading whitespace (e.g., JSON top-level key indent, Go embedded struct) cannot
   distinguish indentation levels in the boundary matcher.

2. **`extractGeneric()` also trims lines** for entity/relationship matching. Entity
   patterns requiring specific indentation will not match correctly.

3. **TOML uses brace-based strategy** but has no `{}`-delimited blocks. Brace depth
   stays at 0, so every boundary match immediately flushes the previous chunk.

4. **YAML key pattern** matches every `key:` line. Combined with indent-based
   chunking, this creates many small chunks for deeply nested YAML.

5. **30-character threshold** uses strict `>` (not `>=`). A chunk with exactly 30
   characters of trimmed content is discarded.

6. **Obj-C method declarations** inside `@interface` blocks increment depth in the
   end-keyword chunker, which can miscount nesting when `@interface` contains method
   declarations (as opposed to `@implementation`).

7. **No cross-line matching**: All patterns operate on single lines. Multi-line
   signatures, decorators split across lines, or continuation-line constructs are
   only partially captured.

8. **TypeScript treated as JavaScript**: TS-specific constructs (interfaces, type
   aliases, enums, decorators) are not explicitly handled. The JS patterns catch
   classes and functions but miss TS-only declarations.

---

## Test Coverage

190 tests across 10 focused AST chunking / extraction files, covering 35+ languages:

| Test File | Focus |
|-----------|-------|
| `__tests__/chunker-batch1.test.js` | JS/TS, Java, Python, Go, Rust |
| `__tests__/chunker-batch2.test.js` | C, C++, C#, PHP, Ruby |
| `__tests__/chunker-batch3.test.js` | Kotlin, Swift, Scala, Dart, Groovy, Obj-C |
| `__tests__/chunker-batch4.test.js` | HTML, CSS, SCSS, Sass, LESS |
| `__tests__/chunker-batch5.test.js` | Shell, PowerShell, SQL, GraphQL, Lua, Zig, Elixir, Nim, F#, JSON, YAML, TOML, XML, Dockerfile, Makefile |
| `__tests__/chunker-edge-cases.test.js` | 30-char threshold, long lines, empty files, nested blocks |
| `__tests__/chunker-property.test.js` | Property-based testing with randomized inputs |
| `__tests__/graph-extractor-generic.test.js` | Generic entity/relationship extraction across languages |
| `__tests__/extractor-chunker-optimizations.test.js` | Prefilter, regex caching, debug counters |
| `__tests__/language-pattern-registry-validator.test.js` | Validates every chunker/entity pattern has capture group 1 |

Batch 1-5 include exact count assertions (`.toBe(N)`) to catch regressions.

---

## Codex Review: All 8 Findings Resolved

A comprehensive code review (2026-02-12 to 2026-02-14) identified 8 issues, all
fixed in the same commit cycle.

### High Severity (Fixed)

1. **End-keyword chunking closed blocks too early** in Ruby/Elixir/Lua.
   `blockKeywords` arrays were added so nested `if/case/while` correctly increment
   depth without starting new chunks.

2. **Generic graph extractor used brace-based end-line for all languages**.
   Split into `findEndLine()` (brace), `findEndLineIndent()`, and
   `findEndLineKeyword()` with automatic strategy selection.

3. **Go method chunker captured receiver type instead of method name**.
   Pattern changed from `/^func\s+\(\w+\s+\*?(\w+)\)\s+(\w+)\s*\(/` to
   `/^func\s+\(\w+\s+\*?\w+\)\s+(\w+)\s*\(/` making receiver non-capturing.

4. **Registry patterns violated `match[1]` contract**. Rust `impl` entity now
   always captures the target type in group 1. `implFor` and `plainImport` added
   to `GENERIC_RELATIONSHIP_MAPPING`. Docker `entrypoint` got a capture group.

### Medium Severity (Fixed)

5. **Python plain imports missed** (`import os`). Split into two patterns: `import`
   for `from X import Y` and `plainImport` for `import X`.

6. **Several chunker patterns could never create boundaries** due to missing capture
   groups. Added capture groups to CSS rule/media/fontface, SCSS rule/media, LESS
   rule, Sass rule, Dockerfile RUN/COPY. CSS rule pattern now excludes `from`/`to`/
   `%` to prevent keyframe internals from creating boundaries.

7. **Chunk `line_end` off-by-one**. `buildChunk` now uses `lineEnd + 1` for
   consistent 1-based numbering. `_pushFinalChunk` and `parseGenericFile` callers
   adjusted accordingly.

8. **Generic call relationships lost source linkage** (`source_id: null`).
   `extractGeneric` now maintains an `activeEntityScopes` stack and uses the
   innermost entity as `source_id` for method call relationships.

### Optimizations Completed

All 6 optimization opportunities from the review were implemented:

1. Cached `methodCall` global regexes per language
2. Registry validator test enforcing capture group 1 on all patterns
3. End-line detection split by strategy
4. Edge tests for Ruby/Elixir nested end, Go method symbol, Python imports, CSS rules
5. Debug counters and optional warnings for empty captures and long line skips
6. Cached start-token prefilters for fast pattern rejection

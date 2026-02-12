# AST Chunker & Graph Extractor: Multi-Language Support Plan

**Status**: Plan (not yet implemented)
**Date**: 2026-02-11
**Scope**: Expand `ast-chunker.js` and `core/graph-extractor.js` to support 35 programming languages, markup, config, and build formats instead of the current 3 (Java, JS/TS, Proto).

---

## 1. Problem Statement

### 1.1 AST Chunker (`ast-chunker.js`)

The `ASTChunker.detectLanguage()` method only recognizes 5 extensions:

```js
const extMap = {
  '.java': 'java',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'javascript',   // TS treated as JS
  '.tsx': 'javascript',
  '.proto': 'proto'
};
```

Files with any other extension fall through to `parseGenericFile()` — a naive line-based chunker with no structural awareness. It splits on blank lines and size limits, producing chunks that:
- Split functions in half
- Merge unrelated code blocks
- Lose all metadata (no `symbol`, `chunk_type`, or `language` in metadata)

### 1.2 Graph Extractor (`core/graph-extractor.js`)

The `GraphExtractor.extractFromFile()` method has the same 3-language limitation:

```js
if (ext === '.java') {
  return this.extractJava(content, lines, filePath);
} else if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
  return this.extractJavaScript(content, lines, filePath);
} else if (ext === '.proto') {
  return this.extractProto(content, lines, filePath);
}
return { entities: [], relationships: [] };
```

Files in Python, Rust, Go, C/C++, etc. produce **zero entities and zero relationships**. This means:
- No FTS5 entries for those files (lexical search misses them in entity queries)
- No graph connectivity (PageRank, hub detection, relationship resolution all skip them)
- No HCGS summaries generated (summary pipeline operates on entities)

### 1.3 Impact on Search Quality

`FILE_PATTERNS` in `config.js` already globs for 30+ file types. These files get:
- **Indexed as vectors**: Yes (via the chunker's generic fallback) — but with poor chunk boundaries
- **Indexed in code graph**: No — zero entities extracted
- **HCGS summaries**: No — no entities to summarize
- **FTS5 search**: Partial — raw text indexed, but no structured entity search

For a **Python-only** or **Rust-only** codebase, the code graph is essentially empty. Lexical entity search returns nothing. HCGS summaries don't exist. Only raw vector search works, and even that is degraded by poor chunking.

### 1.4 Downstream Independence

The rest of the indexing pipeline is **language-agnostic** and operates on chunks/entities:

| Pipeline Stage | Input | Language-Aware? |
|---------------|-------|-----------------|
| **AST Chunker** | Source files | **YES** — needs language patterns |
| **Graph Extractor** | Source files | **YES** — needs language patterns |
| Vector embeddings | Chunks (text + metadata) | No — just embeds text |
| HNSW index build | Embedding vectors | No — just vectors |
| HCGS summaries | Entities from graph | No — just entity metadata |
| Relationship resolution | Entities from graph | No — DB-level name matching |
| FTS5 index | Entities from graph | No — just text insertion |
| Vocabulary warmup | Terms from graph/files | No — just strings |

**Conclusion**: Fixing the chunker and graph extractor gives better chunks and richer entities, which propagate automatically through all downstream stages with zero changes to those stages.

---

## 2. Target Language Set

Based on the [Stack Overflow Developer Survey 2024](https://survey.stackoverflow.co/2024/), [JetBrains Developer Ecosystem](https://www.jetbrains.com/lp/devecosystem-2024/), and the existing `FILE_PATTERNS` in `config.js`:

### Tier 1: High Priority (most-used languages)

| Language | Extensions | Popularity | Current Support |
|----------|-----------|------------|-----------------|
| **JavaScript/TypeScript** | `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs` | #1 | Chunker + Graph |
| **Python** | `.py`, `.pyi` | #2 | None |
| **Java** | `.java` | #3 | Chunker + Graph |
| **Go** | `.go` | #5 | None |
| **Rust** | `.rs` | #6 | None |
| **C/C++** | `.c`, `.cpp`, `.cc`, `.cxx`, `.h`, `.hpp`, `.hxx` | #4/#7 | None |
| **C#** | `.cs` | #8 | None |

### Tier 2: Important (common in enterprises/web)

| Language | Extensions | Popularity | Current Support |
|----------|-----------|------------|-----------------|
| **PHP** | `.php` | #9 | None |
| **Ruby** | `.rb`, `.erb` | #10 | None |
| **Kotlin** | `.kt`, `.kts` | #11 | None |
| **Swift** | `.swift` | #12 | None |
| **Scala** | `.scala` | #13 | None |
| **Dart** | `.dart` | (Flutter) | None |
| **Groovy** | `.groovy` | (JVM/Gradle) | None |
| **Objective-C** | `.m`, `.mm` | (Apple legacy) | None |
| **HTML/Templating** | `.html`, `.htm`, `.xhtml`, `.vue`, `.svelte` | #1 web markup | None |
| **CSS/Preprocessors** | `.css`, `.scss`, `.sass`, `.less` | #1 web styling | None |

### Tier 3: Useful (niche but indexed by FILE_PATTERNS)

| Language | Extensions | Current Support |
|----------|-----------|-----------------|
| **Lua** | `.lua` | None |
| **Shell/Bash** | `.sh`, `.bash`, `.zsh`, `.fish` | None |
| **PowerShell** | `.ps1` | None |
| **SQL** | `.sql` | None |
| **GraphQL** | `.graphql`, `.gql` | None |
| **Protobuf** | `.proto` | Chunker + Graph |
| **Zig** | `.zig` | None |
| **Elixir** | `.ex`, `.exs` | None |
| **Nim** | `.nim` | None |
| **F#** | `.fs`, `.fsx` | None |
| **JSON** | `.json`, `.jsonc`, `.json5` | None |
| **YAML** | `.yaml`, `.yml` | None |
| **TOML** | `.toml` | None |
| **XML** | `.xml`, `.xsl`, `.xsd`, `.wsdl`, `.pom`, `.csproj` | None |
| **Dockerfile** | `Dockerfile`, `Dockerfile.*`, `*.dockerfile` | None |
| **Makefile** | `Makefile`, `*.mk` | None |

**Total**: ~35 languages/formats covering 95%+ of professional codebases.

---

## 3. Architecture: Regex-First with Structural Awareness

### 3.1 Design Decision: Regex, Not Tree-sitter

Tree-sitter would provide perfect AST parsing but adds:
- ~10MB of grammar binaries (per language)
- Native compilation dependency (C/C++ toolchain required)
- Maintenance burden for grammar updates
- Installation failures on some platforms

Instead, we use **regex patterns with brace/indent tracking** — the same approach that already works for Java and JS/TS. Research shows regex-based extraction achieves ~90% of Tree-sitter accuracy for entity extraction at a fraction of the complexity.

Tree-sitter can be added later as an **optional enhancement** (see Open Questions).

### 3.2 Pattern Structure

Each language needs two pattern sets:

1. **Chunker patterns** (in `ast-chunker.js`): Detect function/class/method boundaries for chunk splitting
2. **Graph patterns** (in `graph-extractor.js`): Extract entities and relationships for the code graph

Both share the same conceptual model:

```
Entity Types:  class, interface, enum, struct, trait, function, method, field, module, type
Relationships: extends, implements, calls, uses, imports, throws, overrides, contains
```

### 3.3 Shared Language Registry

To avoid duplication between chunker and graph extractor, create a shared registry:

```js
// core/language-patterns.js (NEW FILE)

export const LANGUAGE_REGISTRY = {
  python: {
    extensions: ['.py', '.pyi'],
    chunker: { /* patterns for chunk boundary detection */ },
    graph: { /* patterns for entity/relationship extraction */ },
    indentBased: true,  // Python uses indentation, not braces
    commentStyle: { line: '#', blockStart: '"""', blockEnd: '"""' },
  },
  rust: {
    extensions: ['.rs'],
    chunker: { /* ... */ },
    graph: { /* ... */ },
    indentBased: false,
    commentStyle: { line: '//', blockStart: '/*', blockEnd: '*/' },
  },
  // ... etc for all languages
};
```

---

## 4. Language-Specific Patterns

### 4.1 Python

**Chunker patterns** (indent-based, no braces):
```
class:    /^class\s+(\w+)(?:\(([^)]*)\))?:/
function: /^(?:async\s+)?def\s+(\w+)\s*\(/
method:   /^    (?:async\s+)?def\s+(\w+)\s*\(self/   (indented under class)
decorator: /^@(\w+(?:\.\w+)*)/
```

**Graph patterns**:
```
import:   /^(?:from\s+([\w.]+)\s+)?import\s+(.+)/
class:    /^class\s+(\w+)(?:\(([^)]*)\))?:/           → entity + extends relationships
function: /^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/   → entity + parameter types
field:    /^(\w+)\s*(?::\s*(\w[\w\[\],\s|]*))\s*=/     → typed field (type hints)
call:     /(\w+)\s*\.\s*(\w+)\s*\(/                   → calls relationship
```

**Special handling**: Indentation-based scope tracking. End of function = next line at same or lower indent level.

### 4.2 Go

**Chunker patterns**:
```
function:  /^func\s+(\w+)\s*\(/
method:    /^func\s+\(\w+\s+\*?(\w+)\)\s+(\w+)\s*\(/
struct:    /^type\s+(\w+)\s+struct\s*\{/
interface: /^type\s+(\w+)\s+interface\s*\{/
```

**Graph patterns**:
```
import:    /import\s+(?:\(\s*([\s\S]*?)\s*\)|"([^"]+)")/
package:   /^package\s+(\w+)/
struct:    /^type\s+(\w+)\s+struct/     → entity
interface: /^type\s+(\w+)\s+interface/  → entity
embed:     /^\s+(\w+)\s*$/              → "extends" (embedded struct)
```

**Special handling**: Exported = capitalized first letter (replaces `public` keyword).

### 4.3 Rust

**Chunker patterns**:
```
function:  /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/
struct:    /^(?:pub\s+)?struct\s+(\w+)/
enum:      /^(?:pub\s+)?enum\s+(\w+)/
trait:     /^(?:pub\s+)?trait\s+(\w+)/
impl:      /^impl(?:<[^>]+>)?\s+(?:(\w+)\s+for\s+)?(\w+)/
```

**Graph patterns**:
```
use:       /^use\s+([\w:]+)(?:::\{([^}]+)\})?/    → imports
struct:    /^(?:pub\s+)?struct\s+(\w+)/             → entity
trait:     /^(?:pub\s+)?trait\s+(\w+)/              → entity (like interface)
impl:      /^impl\s+(\w+)\s+for\s+(\w+)/           → implements relationship
derive:    /#\[derive\(([^)]+)\)\]/                 → uses relationship
```

**Special handling**: `impl` blocks create "contains" relationships between struct and its methods.

### 4.4 C/C++

**Chunker patterns**:
```
function:  /^(?:[\w:*&<>\s]+)\s+(\w+)\s*\([^)]*\)\s*(?:const)?\s*\{/
class:     /^(?:class|struct)\s+(\w+)(?:\s*:\s*(?:public|protected|private)\s+(\w+))?/
namespace: /^namespace\s+(\w+)/
```

**Graph patterns**:
```
include:   /^#include\s+[<"]([^>"]+)[>"]/           → imports
class:     /^(?:class|struct)\s+(\w+)/               → entity
inherit:   /:\s*(?:public|protected|private)\s+(\w+)/ → extends
method:    /(\w+)\s*::\s*(\w+)\s*\(/                 → method of class
typedef:   /typedef\s+.+\s+(\w+)\s*;/                → type entity
```

**Special handling**: Header files (`.h`, `.hpp`) contain declarations; source files contain implementations. Both produce entities but headers get higher weight.

### 4.5 C#

**Chunker patterns**:
```
class:     /(?:public|private|internal|protected)?\s*(?:static|sealed|abstract)?\s*(?:partial\s+)?class\s+(\w+)/
interface: /(?:public|internal)?\s*interface\s+(\w+)/
method:    /(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?(?:[\w<>\[\]?]+)\s+(\w+)\s*\(/
property:  /(?:public|private|protected|internal)\s+(?:[\w<>\[\]?]+)\s+(\w+)\s*\{/
```

**Graph patterns**: Similar to Java (C# and Java share most syntax patterns for entity extraction).

### 4.6 PHP

**Chunker patterns**:
```
class:     /^(?:abstract\s+|final\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/
function:  /^(?:public|private|protected)?\s*(?:static\s+)?function\s+(\w+)\s*\(/
interface: /^interface\s+(\w+)/
trait:     /^trait\s+(\w+)/
```

**Graph patterns**:
```
use:       /^use\s+([\w\\]+)(?:\s+as\s+(\w+))?/     → imports (namespaces)
namespace: /^namespace\s+([\w\\]+)/                   → package equivalent
```

### 4.7 Ruby

**Chunker patterns**:
```
class:     /^class\s+(\w+)(?:\s*<\s*(\w+))?/
module:    /^module\s+(\w+)/
method:    /^\s*def\s+(\w+)/
```

**Graph patterns**:
```
require:   /^require(?:_relative)?\s+['"]([^'"]+)['"]/  → imports
include:   /^\s*include\s+(\w+)/                         → mixin (implements-like)
```

**Special handling**: `end` keyword terminates blocks (like Python's indent, but explicit).

### 4.8 Kotlin

**Chunker patterns**:
```
class:     /(?:data\s+|sealed\s+|abstract\s+|open\s+)?class\s+(\w+)/
interface: /interface\s+(\w+)/
function:  /(?:fun|suspend\s+fun)\s+(\w+)/
object:    /object\s+(\w+)/
```

**Graph patterns**: Very similar to Java. Kotlin-specific: `data class`, `sealed class`, `object`, `companion object`.

### 4.9 Swift

**Chunker patterns**:
```
class:     /(?:public|open|internal|private)?\s*(?:final\s+)?class\s+(\w+)/
struct:    /(?:public|internal|private)?\s*struct\s+(\w+)/
protocol:  /(?:public|internal)?\s*protocol\s+(\w+)/
func:      /(?:public|open|internal|private)?\s*(?:static\s+)?func\s+(\w+)/
enum:      /(?:public|internal|private)?\s*enum\s+(\w+)/
```

### 4.10 Scala

**Chunker patterns**:
```
class:     /(?:case\s+)?class\s+(\w+)/
object:    /object\s+(\w+)/
trait:     /trait\s+(\w+)/
def:       /def\s+(\w+)/
```

### 4.11 Dart

**Chunker patterns**:
```
class:     /(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/
mixin:     /mixin\s+(\w+)/
function:  /(?:[\w<>?]+)\s+(\w+)\s*\(/
```

### 4.12 Shell/Bash

**Chunker patterns**:
```
function:  /^(?:function\s+)?(\w+)\s*\(\)\s*\{/
```

**Graph patterns**:
```
source:    /^(?:source|\.)\s+(.+)/    → imports
```

### 4.13 SQL

**Chunker patterns**:
```
create:    /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION|PROCEDURE|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w.]+\.)?(\w+)/i
alter:     /ALTER\s+TABLE\s+(?:[\w.]+\.)?(\w+)/i
```

### 4.14 GraphQL

**Chunker patterns**:
```
type:      /type\s+(\w+)/
input:     /input\s+(\w+)/
query:     /(?:query|mutation|subscription)\s+(\w+)/
```

### 4.15 Lua, Zig, Elixir, Nim, F#

Minimal patterns for function/module detection:

- **Lua**: `function (\w+)`, `local function (\w+)`, `(\w+) = function`
- **Zig**: `(?:pub\s+)?fn\s+(\w+)`, `const\s+(\w+)\s*=\s*struct`
- **Elixir**: `defmodule\s+(\w+)`, `def\s+(\w+)`, `defp\s+(\w+)`
- **Nim**: `proc\s+(\w+)`, `func\s+(\w+)`, `type\s+(\w+)`, `method\s+(\w+)`
- **F#**: `let\s+(\w+)`, `type\s+(\w+)`, `module\s+(\w+)`, `member\s+(?:this|_)\.(\w+)`

### 4.16 HTML/Templating

**Chunker patterns** (tag-based, split on major structural elements):
```
section:   /<(section|article|nav|header|footer|main|aside|template|form)\b[^>]*>/i
component: /<([A-Z]\w+)\b/                       → framework components (React JSX in .html, Vue custom elements)
id:        /<\w+[^>]+\bid=["']([^"']+)["']/       → named elements
script:    /<script\b[^>]*>/i                      → script blocks
style:     /<style\b[^>]*>/i                       → style blocks
```

**Graph patterns**:
```
link:      /<link[^>]+href=["']([^"']+)["']/i      → imports (stylesheets, icons)
script:    /<script[^>]+src=["']([^"']+)["']/i      → imports (external scripts)
img:       /<img[^>]+src=["']([^"']+)["']/i         → uses (assets)
a_href:    /<a[^>]+href=["']([^"']+)["']/i          → uses (navigation)
form:      /<form[^>]+action=["']([^"']+)["']/i     → calls (API endpoints)
```

**Vue SFC** (`.vue`): Split into `<template>`, `<script>`, `<style>` blocks. Parse `<script>` with JS patterns, `<style>` with CSS patterns. Extract component name from `export default { name: '...' }` or filename.

**Svelte** (`.svelte`): Similar to Vue — `<script>`, `<style>`, and top-level template. Extract exports from `<script>` block and `export let` props.

**Special handling**: HTML is not indent-based or brace-based. Chunk boundaries are defined by semantic block elements. The chunker should avoid splitting mid-tag.

### 4.17 CSS/Preprocessors

**Chunker patterns** (split on top-level rules and at-rules):
```
rule:      /^[.#\w\[\*:][^{]*\{/                   → selector block
media:     /^@media\s+[^{]+\{/                     → media query block
keyframes: /^@keyframes\s+(\w[\w-]*)\s*\{/          → animation definition
fontface:  /^@font-face\s*\{/                       → font definition
layer:     /^@layer\s+(\w[\w-]*)/                   → cascade layer
container: /^@container\s+(\w[\w-]*)/               → container query
```

**SCSS-specific patterns**:
```
mixin:     /^@mixin\s+([\w-]+)/                     → entity (reusable block)
function:  /^@function\s+([\w-]+)/                  → entity
include:   /^@include\s+([\w-]+)/                   → calls relationship
extend:    /^@extend\s+([.%][\w-]+)/                → extends relationship
variable:  /^\$([\w-]+)\s*:/                         → field entity
use:       /^@use\s+['"]([^'"]+)['"]/                → imports relationship
forward:   /^@forward\s+['"]([^'"]+)['"]/            → imports relationship
```

**LESS-specific patterns**:
```
mixin:     /^\.(\w[\w-]*)\s*\(/                     → mixin definition (parametric)
variable:  /^@([\w-]+)\s*:/                          → field entity
import:    /^@import\s+['"]([^'"]+)['"]/             → imports relationship
```

**Sass (indent-based)**: Same patterns as SCSS but uses indentation for nesting instead of braces. Requires indent-based scope tracking (like Python).

**Graph patterns**:
```
import:    /^@(?:import|use|forward)\s+['"]([^'"]+)['"]/  → imports
selector:  /^([.#][\w-]+)/                                → entity (named selector)
variable:  /^[\$@]([\w-]+)\s*:/                            → field entity
mixin:     /^@mixin\s+([\w-]+)/                            → entity
```

**Special handling**: CSS has no functions/classes in the traditional sense. Entity types map as: selectors → `type`, mixins → `function`, variables → `field`, `@keyframes` → `type`.

### 4.18 Groovy

**Chunker patterns**:
```
class:     /(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/
interface: /interface\s+(\w+)/
method:    /(?:def|void|[\w<>\[\]]+)\s+(\w+)\s*\(/
closure:   /(\w+)\s*=\s*\{/                          → named closures
```

**Graph patterns**: Very similar to Java. Groovy-specific: `def` keyword, closures as variables, `@Grab` for dependencies, `trait` keyword.

```
import:    /^import\s+([\w.]+)/                       → imports
trait:     /trait\s+(\w+)/                             → entity (like interface)
grab:      /@Grab\s*\(\s*'([^']+)'\s*\)/              → dependency
```

### 4.19 Objective-C

**Chunker patterns**:
```
interface: /^@interface\s+(\w+)\s*(?::\s*(\w+))?/     → class declaration
impl:      /^@implementation\s+(\w+)/                  → class implementation
protocol:  /^@protocol\s+(\w+)/                        → like interface
method:    /^[+-]\s*\([^)]*\)\s*(\w+)/                 → instance/class method
property:  /^@property\s*\([^)]*\)\s*\w+\s+\*?(\w+)/  → field
```

**Graph patterns**:
```
import:    /^#import\s+[<"]([^>"]+)[>"]/               → imports
inherit:   /^@interface\s+\w+\s*:\s*(\w+)/             → extends
protocol:  /^@interface\s+\w+\s*:\s*\w+\s*<([^>]+)>/   → implements (protocol conformance)
category:  /^@interface\s+(\w+)\s*\((\w+)\)/           → category extension
```

**Special handling**: `.m` files are implementation, `.h` files are declarations. Both produce entities. Method signatures use `- (Type)name:(Type)param` syntax which is unique.

### 4.20 PowerShell

Minimal patterns:
```
function:  /^function\s+([\w-]+)/                      → function entity
class:     /^class\s+(\w+)/                            → class (PS 5+)
param:     /^\[CmdletBinding\(\)\]/                    → marks advanced function
import:    /^(?:Import-Module|using\s+module)\s+(\S+)/ → imports
```

### 4.21 JSON

**Chunker patterns** (split on top-level keys):
```
key:       /^  "(\w[\w-]*)"\s*:/                       → top-level key boundary
```

**Graph patterns** (context-dependent — some JSON files are highly structured):
```
dep:       /"(dependencies|devDependencies|peerDependencies)"/  → package.json deps section
ref:       /"\$ref"\s*:\s*"([^"]+)"/                            → JSON Schema / OpenAPI references
script:    /"scripts"\s*:\s*\{/                                  → package.json scripts section
```

**Special handling**: JSON has no functions/classes. Entity types: top-level keys → `field`, `$ref` targets → `type`, dependency names → `module`. For `package.json` specifically, extract dependency names as `imports` relationships. Chunk on top-level keys since JSON files are often deeply nested.

### 4.22 YAML

**Chunker patterns** (split on top-level keys, indent-based):
```
key:       /^(\w[\w-]*)\s*:/                           → top-level key boundary
doc:       /^---/                                      → document separator
```

**Graph patterns**:
```
anchor:    /&(\w+)/                                    → named anchor (entity)
alias:     /\*(\w+)/                                   → alias reference (uses relationship)
include:   /!\s*include\s+(\S+)/                       → file inclusion
ref:       /\$ref:\s*['"]?([^'"#\s]+)/                 → OpenAPI / JSON Schema reference
```

**Special handling**: YAML is indent-based like Python. For CI/CD files (`*.github/workflows/*.yml`, `.gitlab-ci.yml`), extract job/stage names as entities. For Docker Compose, extract service names. For Kubernetes manifests, extract `kind` + `metadata.name`.

### 4.23 TOML

**Chunker patterns** (split on section headers):
```
section:   /^\[([^\]]+)\]/                             → section header
array:     /^\[\[([^\]]+)\]\]/                         → array of tables
```

**Graph patterns**:
```
section:   /^\[([^\]]+)\]/                             → entity (module-like)
dep:       /^\[(?:dependencies|dev-dependencies)\]/    → Cargo.toml / pyproject.toml deps
key_val:   /^(\w[\w-]*)\s*=/                           → field entity
```

**Special handling**: For `Cargo.toml`, extract dependency names under `[dependencies]` as `imports`. For `pyproject.toml`, extract project metadata and dependencies. Section names become `module`-type entities.

### 4.24 XML

**Chunker patterns** (split on major elements):
```
element:   /<(\w+:?\w+)\b[^>]*(?:>|$)/                → element boundary
root:      /^<\?xml\b/                                 → XML declaration
```

**Graph patterns**:
```
namespace: /xmlns(?::(\w+))?=["']([^"']+)["']/        → namespace declaration (entity)
import:    /<(?:xs:)?(?:import|include)\s[^>]*schemaLocation=["']([^"']+)["']/  → imports
ref:       /ref=["']([^"']+)["']/                      → uses relationship
```

**Subformat-specific patterns**:
- **Maven POM** (`.pom`, `pom.xml`): Extract `<groupId>`, `<artifactId>`, `<dependency>` blocks as `imports`
- **C# project** (`.csproj`): Extract `<PackageReference>` as `imports`, `<ProjectReference>` as `uses`
- **XSD/WSDL**: Extract `<xs:element>`, `<xs:complexType>` as type entities
- **XSLT** (`.xsl`): Extract `<xsl:template>` names as function entities

**Special handling**: XML is tag-based like HTML but often more deeply nested. Chunk on direct children of root element. For known subformats (POM, csproj, etc.), apply specialized extraction.

### 4.25 Dockerfile

**Chunker patterns** (split on stages and major instructions):
```
from:      /^FROM\s+(\S+)(?:\s+AS\s+(\w+))?/i         → stage boundary (primary chunk split)
run:       /^RUN\s+/i                                  → build step
copy:      /^COPY\s+/i                                 → file copy
```

**Graph patterns**:
```
from:      /^FROM\s+(\S+?)(?::(\S+))?\s*/i             → base image (imports relationship)
copy_from: /^COPY\s+--from=(\w+)/i                     → multi-stage reference (uses relationship)
expose:    /^EXPOSE\s+(\d+)/i                           → port entity (field)
entrypoint: /^(?:ENTRYPOINT|CMD)\s+/i                  → entry point entity
arg:       /^ARG\s+(\w+)/i                             → build argument (field)
env:       /^ENV\s+(\w+)/i                             → environment variable (field)
label:     /^LABEL\s+(\S+)/i                           → metadata (field)
```

**Special handling**: Dockerfile instructions are line-based (with `\` continuation). Multi-stage builds (`FROM ... AS stage`) create named entities. `COPY --from=stage` creates cross-stage `uses` relationships. Each `FROM` starts a new chunk.

### 4.26 Makefile

Minimal patterns:
```
target:    /^([\w.-]+)\s*:/                            → make target (function-like entity)
variable:  /^(\w+)\s*[:?+]?=/                          → variable definition (field entity)
include:   /^-?include\s+(\S+)/                        → file inclusion (imports)
```

**Special handling**: Targets are the primary entities (analogous to functions). Prerequisites after `:` create `uses` relationships. `.PHONY` targets are still entities but flagged as non-file.

---

## 5. Implementation Plan

### 5.1 Phase 1: Shared Language Registry (`core/language-patterns.js`)

**New file** containing all language patterns in a structured format.

```js
export const LANGUAGE_REGISTRY = { /* all patterns */ };

export function getLanguageByExtension(ext) {
  // Returns language config or null
}

export function getSupportedExtensions() {
  // Returns all known extensions
}
```

Both `ast-chunker.js` and `graph-extractor.js` import from this single source.

**Estimate**: ~800-900 lines for all 35 languages/formats.

### 5.2 Phase 2: Chunker Expansion (`ast-chunker.js`)

1. Replace hardcoded `extMap` with `getLanguageByExtension()`
2. Add indent-based scope tracking for Python (and Ruby as fallback)
3. For brace-based languages, the existing `braceDepth` tracker already works — just need the right start patterns
4. Improve `parseGenericFile()` to be smarter about unknown languages (look for common patterns like `function`, `class`, `def`)

**Key change**: The chunker doesn't need per-language `extract*()` methods like the graph extractor. It only needs to know:
- What starts a new chunk (function/class/method declaration pattern)
- What ends a chunk (closing brace at depth 0, or dedent for indent-based)
- What metadata to attach (symbol name, type, language)

### 5.3 Phase 3: Graph Extractor Expansion (`core/graph-extractor.js`)

1. Replace hardcoded if/else chain with registry lookup
2. Add `extract*()` methods for Tier 1 languages (Python, Go, Rust, C/C++, C#)
3. Add simplified extractors for Tier 2 (PHP, Ruby, Kotlin, Swift, Scala, Dart, Groovy, Objective-C, HTML, CSS)
4. Add minimal extractors for Tier 3 (Lua, Shell, PowerShell, SQL, GraphQL, Zig, Elixir, Nim, F#, JSON, YAML, TOML, XML, Dockerfile, Makefile)

Each extractor produces the same output format: `{ entities: [], relationships: [] }`.

**Entity format** (unchanged):
```js
{
  name: 'AuthService',
  type: 'class',            // class|interface|function|method|field|enum|struct|trait|module|type
  file: 'src/auth/service.py',
  line: 42,
  visibility: 'public',     // public|private|protected|internal|package
  signature: 'class AuthService(BaseService):',
  doc_comment: '...',
}
```

**Relationship format** (unchanged):
```js
{
  source: 'AuthService',
  target: 'BaseService',
  type: 'extends',          // extends|implements|calls|uses|imports|throws|overrides|contains
  file: 'src/auth/service.py',
  line: 42,
}
```

### 5.4 Phase 4: Testing & Validation (QE-Orchestrated)

Use `qe-queen-coordinator` to orchestrate comprehensive release validation with a **90% code coverage target** across all new language patterns.

**Test strategy**:

1. **Unit tests per language** — One test file per language containing real-world code snippets:
   - Chunker tests: verify chunk boundaries (no split functions), correct metadata (symbol, type, language)
   - Graph tests: verify entity extraction counts, relationship types, visibility detection
   - Edge cases: multi-line signatures, nested classes, decorators/attributes, generics

2. **QE orchestration** — Use Agentic QE v3 for automated test generation and validation:
   ```js
   Task({ prompt: "Generate comprehensive tests for language-patterns.js, ast-chunker.js, and graph-extractor.js covering all 35 languages/formats with 90% coverage target", subagent_type: "qe-queen-coordinator" })
   ```
   The QE queen will coordinate:
   - `qe-test-architect` — Generate test suites from the language patterns
   - `qe-coverage-specialist` — Identify coverage gaps and generate targeted tests
   - `qe-property-tester` — Property-based testing for regex pattern edge cases (randomized inputs)
   - `qe-integration-tester` — End-to-end indexing pipeline verification

3. **Integration verification** — Full pipeline tests for non-JS/Java codebases:
   - Index a Python project → verify entities in code-graph.db
   - Index a Rust project → verify HCGS summaries generate
   - Index a Go project → verify FTS5 search finds Go entities
   - Search works across all modes for all languages

4. **Coverage gate**: The QE quality gate must report ≥90% line coverage on:
   - `core/language-patterns.js` (new file)
   - Modified sections of `ast-chunker.js`
   - Modified sections of `core/graph-extractor.js`

---

## 6. Scope Boundaries

### What Changes
- `ast-chunker.js` — expanded `detectLanguage()` and language-specific patterns
- `core/graph-extractor.js` — expanded `extractFromFile()` with new language extractors
- New: `core/language-patterns.js` — shared pattern registry

### What Also Changes (minor)
- `core/config.js` — `FILE_PATTERNS` updated to add `.htm`, `.xhtml`, `.vue`, `.svelte`, `.sass`, `.jsonc`, `.json5`, `.xsl`, `.xsd`, `.wsdl`, `.pom`, `.csproj`, `Dockerfile`, `Dockerfile.*`, `*.dockerfile`, `Makefile`, `*.mk` (previously missing formats)

### What Does NOT Change
- `core/index-codebase-v21.js` — pipeline logic unchanged, just receives better chunks/entities
- `core/embedding-service.js` — embeds whatever text it receives
- `core/hnsw-index.js` — builds index from whatever vectors it receives
- `core/hcgs-generator.js` — generates summaries for whatever entities exist
- `core/sweet-search.js` — searches whatever is indexed
- `core/summary-manager.js` — manages whatever summaries exist
- `core/relationship-resolver.js` — resolves whatever entities exist in DB

**The only language-aware components are the chunker and the graph extractor.** Everything else is language-agnostic by design.

---

## 7. Complexity Estimates

| Phase | Files | Effort | Risk |
|-------|-------|--------|------|
| Language registry | 1 new file | Medium (pattern research) | Low |
| Chunker expansion | 1 file edit | Low (pattern + extMap) | Low |
| Graph extractor (Tier 1) | 1 file edit | Medium-High (5 languages) | Medium |
| Graph extractor (Tier 2) | Same file | Medium (10 languages, simpler) | Low |
| Graph extractor (Tier 3) | Same file | Low (15 languages/formats, minimal) | Low |
| Testing | New test files | Medium | Low |

**Total estimate**: ~1800-2300 lines of new pattern code, plus ~700 lines of tests.

---

## 8. Implementation Priority

All tiers are implemented in a single pass. The priority order below guides **implementation sequence within that pass** (start with the highest-impact languages, finish with minimal-pattern ones):

1. **Python** — #2 most-used language, huge gap
2. **Go** — Common in cloud/infra, simple syntax (easy to parse)
3. **Rust** — Growing rapidly, `impl` blocks need special handling
4. **C/C++** — Huge existing codebase population, complex but high impact
5. **C#** — Enterprise-heavy, very similar to Java (low effort)
6. **Kotlin** — Android development, very similar to Java
7. **PHP/Ruby/Swift/Scala/Dart** — Lower priority but still used
8. **HTML/CSS** — Web markup/styling, entity model differs from code but high coverage impact
9. **Groovy/Objective-C** — Already indexed, patterns similar to Java/C respectively
10. **JSON/YAML/TOML/XML** — Config/data formats, key-based chunking, dep extraction
11. **Dockerfile/Makefile** — Build/deploy formats, instruction/target-based chunking
12. **Shell/PowerShell/SQL/GraphQL/Lua/Zig/Elixir/Nim/F#** — Minimal patterns, low effort

All 35 languages/formats ship together. No incremental rollout — the regex patterns for Tier 2/3 languages are simple enough that splitting them into separate releases adds coordination overhead without reducing risk.

---

## 9. Open Questions

1. **Tree-sitter as optional enhancement**: Should we offer a "high-accuracy" mode that uses Tree-sitter grammars when available? This would be a separate dependency, not required, but would improve accuracy for complex cases (nested generics, multi-line signatures, macro-heavy code).

2. **TypeScript-specific patterns**: Currently TS is treated as JS. Should we add TS-specific patterns for interfaces, type aliases, enums, decorators? These are common search targets.

3. ~~**Test fixture strategy**~~ *(Resolved)*: Use synthetic examples for unit tests (clear expected outputs, no licensing issues). QE property-based testing will generate randomized edge cases. Integration tests use real indexing of the Sweet Search codebase itself (JS/TS) plus small synthetic projects for other languages.

4. ~~**Incremental rollout**~~ *(Resolved)*: All 35 languages/formats ship together in a single pass. Tier 2/3 patterns are simple enough that splitting adds coordination overhead without reducing risk.

---

## 10. Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Languages with structural chunking | 3 (Java, JS/TS, Proto) | **35** |
| Languages with graph extraction | 3 | **35** |
| Entity extraction for Python files | 0 | **>85% of classes/functions** |
| Entity extraction for Go files | 0 | **>85% of types/functions** |
| Entity extraction for Rust files | 0 | **>85% of structs/traits/functions** |
| Chunk quality (no split functions) | ~60% for non-JS/Java | **>90% all languages** |
| Graph connectivity for multi-language repos | ~30% (only JS/Java edges) | **>80%** |

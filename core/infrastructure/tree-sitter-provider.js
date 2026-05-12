/**
 * Tree-sitter WASM Provider
 *
 * Provides AST-based parsing for top languages using web-tree-sitter WASM.
 * Falls back gracefully when tree-sitter or grammar files are unavailable.
 *
 * Usage:
 *   import { getTreeSitterProvider } from './core/tree-sitter-provider.js';
 *   const provider = getTreeSitterProvider();
 *   const chunks = await provider.parseFileToChunks(content, 'javascript');
 *   if (!chunks) { // fall back to regex }
 */

// Grammar mapping: language ID -> grammar WASM file stem
//
// `tsx` uses tree-sitter-tsx (not tree-sitter-typescript) so that JSX inside
// .tsx bodies parses without producing ERROR nodes. Empirically (May 2026),
// routing .tsx to tree-sitter-typescript caused `export function Component(...)
// { return <Foo/> }` to silently miss the function-name capture, even though
// the tag query rule matched the AST shape — the JSX body created sibling
// ERROR nodes that broke capture resolution.
//
// tree-sitter-javascript already supports JSX natively, so .jsx files don't
// need a separate grammar.
const GRAMMAR_MAP = {
  javascript: 'tree-sitter-javascript',
  typescript: 'tree-sitter-typescript',
  tsx: 'tree-sitter-tsx',
  python: 'tree-sitter-python',
  go: 'tree-sitter-go',
  rust: 'tree-sitter-rust',
  java: 'tree-sitter-java',
  c: 'tree-sitter-c',
  cpp: 'tree-sitter-cpp',
  ruby: 'tree-sitter-ruby',
  php: 'tree-sitter-php',
  kotlin: 'tree-sitter-kotlin',
  swift: 'tree-sitter-swift',
  // tree-sitter-c-sharp ships in node_modules/tree-sitter-wasms/out/ but was
  // previously unwired — C# fell through to the regex chunker in
  // parseBraceBasedFile. That path missed every modern-C# idiom whose
  // declaration line doesn't fit the rigid regex shape: `unsafe` modifier
  // ordering, positional `record`, tuple-typed generic returns (e.g.
  // `IAsyncEnumerable<(byte[] e, int len, …)>`), expression-bodied methods,
  // file-scoped namespaces, indexers, operators, local functions, nested
  // classes. Wiring tree-sitter-c-sharp puts C# on the same code path as
  // the other 13 languages (cAST sibling-merge over a proper AST).
  csharp: 'tree-sitter-c_sharp',
};

// Identifier node types — used to detect leaf-ident captures in extractSymbols()
const IDENT_TYPES = new Set([
  'identifier', 'type_identifier', 'property_identifier', 'field_identifier',
  // Needed by Ruby, PHP, Kotlin, Swift, C++
  'constant',             // Ruby class/module names
  'name',                 // PHP all identifiers
  'simple_identifier',    // Kotlin functions, Swift functions
  'namespace_identifier', // C++ namespace names
]);

// AST node types that represent meaningful chunk boundaries
const BOUNDARY_TYPES = new Set([
  // Functions
  'function_declaration', 'function_definition', 'method_definition',
  'arrow_function', 'function_expression', 'method_declaration',
  'function_item',
  // Classes
  'class_declaration', 'class_definition',
  // Interfaces/Types (TypeScript)
  'interface_declaration', 'type_alias_declaration', 'enum_declaration',
  // Structs/Traits (Rust/Go)
  'struct_item', 'impl_item', 'trait_item', 'type_declaration',
  // Rust macros (macro_rules!)
  'macro_definition',
  // Modules
  'module', 'namespace_declaration',
  // Python
  'decorated_definition',
  // Java
  'record_declaration', 'constructor_declaration',
  // Java annotation types (`@interface Foo { ... }`). Without this, files
  // that contain only an annotation declaration (gson SerializedName.java,
  // Since.java, Until.java) produce no chunk anchor — the chunker emits
  // a generic 'code' chunk and downstream search-time enrichment via
  // findFirstEntityInRange then attaches whatever entity happens to start
  // in the chunk's line range (which, when extractJava also ran with no
  // block-comment skip, was a phantom `class MyClass` from inside the
  // Javadoc <pre> example). Anchoring on the annotation declaration
  // gives the @interface a proper name/type at index time.
  'annotation_type_declaration',
  // Ruby — tree-sitter-ruby uses bare node names `class`, `method`,
  // `singleton_method`, `singleton_class` (no `_declaration`/`_definition`
  // suffix). Without these in the boundary set the cAST chunker:
  //   1. never anchors a chunk on a Ruby class declaration (so `class Base`,
  //      `class IndifferentHash`, etc. produce only anonymous `code` chunks);
  //   2. merges 8+ adjacent methods into one chunk and labels it after
  //      whichever singleton_method happened to be present in the merge;
  //   3. drops `class << self` (the Sinatra DSL idiom) entirely.
  // tree-sitter-ruby grammar reference: github.com/tree-sitter/tree-sitter-ruby
  // (node types `class`, `method`, `singleton_class`). Aider's published
  // tags.scm for Ruby uses the same node names.
  'class', 'method', 'singleton_class',
  'singleton_method',
  // PHP
  'trait_declaration',
  // Kotlin
  'object_declaration',
  // Swift
  'protocol_declaration', 'protocol_function_declaration', 'init_declaration',
  // C
  'struct_specifier', 'enum_specifier', 'type_definition',
  // C++
  'class_specifier', 'namespace_definition',
  // C++ `using X = ...` type aliases + `template<...> class|struct|fn|using` wrappers.
  // Without these the chunker emitted templated decls as anonymous `code` chunks
  // since the cAST sibling-merge path treated them as non-boundary. _resolveBoundary
  // (below) drills into template_declaration to surface the inner class/struct/fn/alias
  // name so the chunk metadata names + type the correct thing.
  'alias_declaration', 'template_declaration',
]);

// Per-language EXTRA boundary types. These are unioned with BOUNDARY_TYPES
// only when chunking a file in the matching language — so other languages'
// chunking behaviour stays byte-identical to before the addition. Used to
// keep grammar-specific node names out of the global set when those names
// could overlap with another grammar's nodes that have different chunking
// semantics. The threading happens in parseFileToChunks() which computes
// `effectiveBoundaryTypes = BOUNDARY_TYPES ∪ LANG_EXTRA_BOUNDARY_TYPES[lang]`
// once per parse and passes it through recursiveChunk + _extractSignature.
//
// C# additions (tree-sitter-c-sharp emits these for first-class declarations,
// verified empirically with scripts/_csharp_grammar_probe.mjs against Garnet):
//   - struct_declaration, record_struct_declaration: C# struct / record struct
//   - property_declaration: anchors per-property chunks so `RespCommandDocs.Command`
//     style queries (CS-004) have a property-scoped chunk to land on; cAST
//     sibling-merge still bundles small auto-properties into 2000-char buffers
//     named after the first property + additional_symbols listing the rest.
//   - delegate_declaration: `public delegate T Foo(...);` becomes a chunk anchor.
//   - destructor_declaration, indexer_declaration, operator_declaration,
//     conversion_operator_declaration: first-class declarations per C# spec.
//   - file_scoped_namespace_declaration: C# 10+ `namespace Foo;` shape.
//   - local_function_statement: nested function declarations inside methods.
//   - event_declaration, event_field_declaration: events behave as
//     property/field-shaped entities at search time.
// All these node names are C#-specific in our 14-language matrix EXCEPT
// `struct_declaration` (also Swift) and `property_declaration` (also Swift),
// which is exactly why they live here instead of in the global set.
const LANG_EXTRA_BOUNDARY_TYPES = {
  csharp: new Set([
    'struct_declaration', 'record_struct_declaration',
    'delegate_declaration', 'destructor_declaration',
    'property_declaration',
    'indexer_declaration', 'operator_declaration',
    'conversion_operator_declaration',
    'file_scoped_namespace_declaration',
    'local_function_statement',
    'event_declaration', 'event_field_declaration',
  ]),
};

// Per-language EXCLUSIONS from BOUNDARY_TYPES. Removes node-type names that
// the global set legitimately includes for one grammar but that collide
// with anonymous-keyword leaves in another grammar — producing phantom
// chunks during the cAST oversized-recursion path.
//
// Concrete trigger: tree-sitter-ruby uses bare `class` / `method` /
// `singleton_class` / `singleton_method` as the *node type names* of
// declarations (no `_declaration`/`_definition` suffix — see Ruby comment
// in BOUNDARY_TYPES). Those four strings are correctly in BOUNDARY_TYPES.
//
// But tree-sitter-c-sharp (and tree-sitter-java, tree-sitter-kotlin, etc.)
// emits an *anonymous keyword leaf* with type-string `"class"` as a child
// of `class_declaration`. When the chunker recurses into an oversized
// C# class and flushes the pre-body buffer (modifiers + class keyword +
// identifier + base_list), that `class` keyword leaf is misidentified as
// a boundary, producing a phantom `[class/null]` chunk with content
// `internal\nsealed\nclass\nRespServerSession\n: ServerSessionBase`.
//
// Java/Kotlin have the same latent bug (verified empirically on gson's
// TypeAdapters.java — emits a tiny `[class/null]` size=31 chunk at the
// class declaration line). The fix is intentionally scoped to csharp
// only so this PR doesn't change Java/Kotlin chunk output at all
// (their existing phantom chunks are tiny and don't affect retrieval).
const LANG_BOUNDARY_TYPE_EXCLUDES = {
  csharp: new Set(['class']),
};

// AST node types that represent function/class bodies. Used by
// extractSignature() to find where the declaration's body starts so
// the signature span is everything before it (decorators + name +
// parameters + return type, excluding body).
const BODY_TYPES = new Set([
  // JS/TS, Java, Go, Rust, Kotlin, Swift, C#, Ruby (sometimes)
  'block', 'statement_block', 'class_body', 'function_body',
  // C / C++ — function bodies
  'compound_statement', 'field_declaration_list',
  // Python uses `block` (already covered) but `:` precedes it
  // PHP — function/method body
  'compound_statement_php',
  // Swift / Kotlin — sometimes labelled differently
  'enum_class_body', 'enum_body', 'interface_body',
  // Rust impl/trait bodies
  'declaration_list',
]);

// Maximum signature length (chars) after whitespace normalization.
// Signatures longer than this get truncated with `…`.
const MAX_SIGNATURE_LENGTH = 200;

// Map tree-sitter node type -> our chunk type label
const NODE_TYPE_MAP = {
  'function_declaration': 'function',
  'function_definition': 'function',
  'function_item': 'function',
  'method_definition': 'method',
  'method_declaration': 'method',
  'arrow_function': 'arrow',
  'function_expression': 'function',
  'class_declaration': 'class',
  'class_definition': 'class',
  'interface_declaration': 'interface',
  'type_alias_declaration': 'typeAlias',
  'enum_declaration': 'enum',
  'struct_item': 'struct',
  'impl_item': 'impl',
  'trait_item': 'trait',
  'type_declaration': 'struct',
  'macro_definition': 'macro',
  'module': 'module',
  'namespace_declaration': 'namespace',
  'decorated_definition': 'decorator',
  // Java
  'record_declaration': 'record',
  'constructor_declaration': 'method',
  // @interface Foo { ... } — chunk labelled as 'interface' to match the
  // existing extractJava regex behaviour (and the gold-probe convention
  // that annotation types are interfaces). Note: a Java annotation is
  // formally an *interface* per JLS §9.6, just a specialised form.
  'annotation_type_declaration': 'interface',
  // Ruby — `class` is the bare tree-sitter-ruby node name for class
  // declarations (Java/JS use `class_declaration`, Python `class_definition`,
  // C++ `class_specifier`). `singleton_class` is `class << self` (or
  // `class << SomeConst`) which opens the receiver's singleton scope.
  'class': 'class',
  'singleton_class': 'class',
  'method': 'method',
  'singleton_method': 'method',
  // PHP
  'trait_declaration': 'trait',
  // Kotlin
  'object_declaration': 'class',
  // Swift
  'protocol_declaration': 'interface',
  'protocol_function_declaration': 'method',
  'init_declaration': 'method',
  // C
  'struct_specifier': 'struct',
  'enum_specifier': 'enum',
  'type_definition': 'typeAlias',
  // C++
  'class_specifier': 'class',
  'namespace_definition': 'namespace',
  'alias_declaration': 'typeAlias',
  // template_declaration intentionally absent — resolved to the inner
  // type (class/struct/function/typeAlias) by _resolveBoundary at lookup time.
  // C# — fires only on nodes that the chunker treats as boundaries; for
  // non-C# languages those nodes are NOT in the effective boundary set
  // (see LANG_EXTRA_BOUNDARY_TYPES), so _resolveBoundary is not invoked
  // on them during normal sibling-merge. The leaf-too-big pathological
  // branch is the only place these could be consulted for another
  // grammar (e.g. an oversized Swift `property_declaration` with no
  // children) — the resulting type label is a strict improvement over
  // the previous 'code' fallback in that case.
  'struct_declaration': 'struct',
  'record_struct_declaration': 'record',
  'delegate_declaration': 'function',
  'destructor_declaration': 'method',
  'property_declaration': 'property',
  'indexer_declaration': 'method',
  'operator_declaration': 'method',
  'conversion_operator_declaration': 'method',
  'file_scoped_namespace_declaration': 'namespace',
  'local_function_statement': 'function',
  'event_declaration': 'property',
  'event_field_declaration': 'field',
};

// Standard tags.scm query patterns for symbol extraction
// These are s-expression patterns matching tree-sitter node types
//
// Naming conventions for new captures (May 2026):
//   @component.definition — `export const X = call(...)` (HOC-wrapped values
//     like memo/forwardRef/createSlice). Higher priority than @variable, so
//     when both fire on the same declarator, component wins via dedup-by-name+line
//     in graph-extractor._normalizeTreeSitterEntities.
//   @variable.definition — any other `export const X = expr` (literals, objects,
//     typed configs). Scoped to export_statement on purpose: we don't want to
//     extract every internal `const x = 1` inside a function body. Tree-sitter
//     emits @arrowFunction in priority over @variable when value is an arrow.
const TAGS_QUERIES = {
  javascript: `
    (function_declaration name: (identifier) @function.definition)
    (generator_function_declaration name: (identifier) @function.definition)
    (class_declaration name: (identifier) @class.definition)
    (method_definition name: (property_identifier) @method.definition)
    (variable_declarator
      name: (identifier) @arrow.definition
      value: (arrow_function))
    (export_statement (function_declaration name: (identifier) @function.definition))
    (export_statement
      declaration: (class_declaration name: (identifier) @class.definition))
    (export_statement
      declaration: (lexical_declaration
        (variable_declarator
          name: (identifier) @component.definition
          value: (call_expression))))
    (export_statement
      declaration: (lexical_declaration
        (variable_declarator
          name: (identifier) @variable.definition)))
    ; Top-level (non-exported) file-scope const declarations.
    ; HISTORY (2026-05-10): a prior version captured ALL top-level lexical
    ; declarations as @variable.definition / @component.definition. That
    ; over-extracted trivial consts (\`const VERSION = '5.8.4'\`,
    ; \`const X = require('...')\`) which then dominated NL retrieval rankings
    ; over real function/method definitions (regressed 5 fastify probes vs
    ; post-perf-60 baseline). Restored to scoping @variable.definition to
    ; export_statement only, matching the original intent in
    ; graph-extractor.js:_normalizeTreeSitterEntities (line 1320 comment).
    ; If structural-mode resolution of CJS top-level consts is needed,
    ; add narrowly-scoped captures (e.g. value: [(array) (object) (new_expression)])
    ; rather than re-introducing unrestricted (program ...) captures.
    (pair
      key: (property_identifier) @method.definition
      value: (function_expression))
    (pair
      key: (property_identifier) @arrow.definition
      value: (arrow_function))
  `,
  typescript: `
    (function_declaration name: (identifier) @function.definition)
    (generator_function_declaration name: (identifier) @function.definition)
    (class_declaration name: (type_identifier) @class.definition)
    (abstract_class_declaration name: (type_identifier) @class.definition)
    (method_definition name: (property_identifier) @method.definition)
    (interface_declaration name: (type_identifier) @interface.definition)
    (type_alias_declaration name: (type_identifier) @type.definition)
    (enum_declaration name: (identifier) @enum.definition)
    (variable_declarator
      name: (identifier) @arrow.definition
      value: (arrow_function))
    (export_statement
      declaration: (class_declaration name: (type_identifier) @class.definition))
    (export_statement
      declaration: (abstract_class_declaration name: (type_identifier) @class.definition))
    (export_statement
      declaration: (lexical_declaration
        (variable_declarator
          name: (identifier) @component.definition
          value: (call_expression))))
    (export_statement
      declaration: (lexical_declaration
        (variable_declarator
          name: (identifier) @variable.definition)))
    ; Top-level non-exported consts intentionally NOT captured — see javascript
    ; query above for rationale (regressed fastify probes via const VERSION etc.).
    (pair
      key: (property_identifier) @method.definition
      value: (function_expression))
    (pair
      key: (property_identifier) @arrow.definition
      value: (arrow_function))
    (module name: (identifier) @namespace.definition)
    (internal_module name: (identifier) @namespace.definition)
  `,
  // tsx grammar is a superset of typescript that also parses JSX. Tag query
  // matches typescript verbatim — JSX expressions inside function bodies don't
  // need their own captures (the surrounding function/component declaration is
  // what we care about). We MUST keep these in sync if typescript adds new rules.
  tsx: `
    (function_declaration name: (identifier) @function.definition)
    (generator_function_declaration name: (identifier) @function.definition)
    (class_declaration name: (type_identifier) @class.definition)
    (abstract_class_declaration name: (type_identifier) @class.definition)
    (method_definition name: (property_identifier) @method.definition)
    (interface_declaration name: (type_identifier) @interface.definition)
    (type_alias_declaration name: (type_identifier) @type.definition)
    (enum_declaration name: (identifier) @enum.definition)
    (variable_declarator
      name: (identifier) @arrow.definition
      value: (arrow_function))
    (export_statement
      declaration: (class_declaration name: (type_identifier) @class.definition))
    (export_statement
      declaration: (abstract_class_declaration name: (type_identifier) @class.definition))
    (export_statement
      declaration: (lexical_declaration
        (variable_declarator
          name: (identifier) @component.definition
          value: (call_expression))))
    (export_statement
      declaration: (lexical_declaration
        (variable_declarator
          name: (identifier) @variable.definition)))
    ; Top-level (non-exported) file-scope const declarations — see javascript
    ; query for rationale.
    (program
      (lexical_declaration
        (variable_declarator
          name: (identifier) @component.definition
          value: (call_expression))))
    (program
      (lexical_declaration
        (variable_declarator
          name: (identifier) @variable.definition)))
    (pair
      key: (property_identifier) @method.definition
      value: (function_expression))
    (pair
      key: (property_identifier) @arrow.definition
      value: (arrow_function))
    (module name: (identifier) @namespace.definition)
    (internal_module name: (identifier) @namespace.definition)
  `,
  python: `
    (function_definition name: (identifier) @function.definition)
    (class_definition name: (identifier) @class.definition)
    (decorated_definition) @decorator.definition
  `,
  go: `
    (function_declaration name: (identifier) @function.definition)
    (method_declaration name: (field_identifier) @method.definition)
    (type_declaration (type_spec name: (type_identifier) @type.definition))
  `,
  rust: `
    (function_item name: (identifier) @function.definition)
    (struct_item name: (type_identifier) @struct.definition)
    (impl_item type: (type_identifier) @impl.definition)
    (trait_item name: (type_identifier) @trait.definition)
    (enum_item name: (type_identifier) @enum.definition)
    (macro_definition name: (identifier) @macro.definition)
  `,
  java: `
    (class_declaration name: (identifier) @class.definition)
    (interface_declaration name: (identifier) @interface.definition)
    (annotation_type_declaration name: (identifier) @interface.definition)
    (enum_declaration name: (identifier) @enum.definition)
    (record_declaration name: (identifier) @record.definition)
    (method_declaration name: (identifier) @method.definition)
    (constructor_declaration name: (identifier) @method.definition)
    (annotation_type_element_declaration name: (identifier) @method.definition)
    (enum_constant name: (identifier) @enum_constant.definition)
    (field_declaration declarator: (variable_declarator name: (identifier) @field.definition))
  `,
  ruby: `
    (class name: (constant) @class.definition)
    (singleton_class value: (constant) @class.definition)
    (module name: (constant) @module.definition)
    (method name: (identifier) @method.definition)
    (singleton_method name: (identifier) @method.definition)
    (alias name: (identifier) @method.definition)
  `,
  php: `
    (class_declaration name: (name) @class.definition)
    (interface_declaration name: (name) @interface.definition)
    (enum_declaration name: (name) @enum.definition)
    (trait_declaration name: (name) @trait.definition)
    (function_definition name: (name) @function.definition)
    (method_declaration name: (name) @method.definition)
  `,
  // Kotlin: positional children — no `name:` field on declarations
  kotlin: `
    (class_declaration (type_identifier) @class.definition)
    (object_declaration (type_identifier) @object.definition)
    (function_declaration (simple_identifier) @function.definition)
  `,
  // Swift: init_declaration has no name child — captured at node level
  swift: `
    (class_declaration name: (type_identifier) @class.definition)
    (protocol_declaration name: (type_identifier) @interface.definition)
    (function_declaration name: (simple_identifier) @function.definition)
    (protocol_function_declaration name: (simple_identifier) @method.definition)
    (init_declaration) @method.definition
  `,
  // C/C++: function name nested inside declarator chain
  c: `
    (function_definition
      declarator: (function_declarator
        declarator: (identifier) @function.definition))
    (struct_specifier name: (type_identifier) @struct.definition)
    (enum_specifier name: (type_identifier) @enum.definition)
    (type_definition declarator: (type_identifier) @type.definition)
  `,
  cpp: `
    (function_definition
      declarator: (function_declarator
        declarator: (identifier) @function.definition))
    (class_specifier name: (type_identifier) @class.definition)
    (struct_specifier name: (type_identifier) @struct.definition)
    (enum_specifier name: (type_identifier) @enum.definition)
    (namespace_definition name: (namespace_identifier) @namespace.definition)
    (alias_declaration name: (type_identifier) @type.definition)
  `,
  // C# — tree-sitter-c-sharp uses bare `identifier` (not type_identifier)
  // for all names, and exposes `name:` fields on every first-class
  // declaration. Probed against Garnet's 30+ partial-class shards in
  // scripts/_csharp_grammar_probe.mjs: every boundary type below emits
  // a parseable name field. Indexer/operator declarations have no
  // user-facing name (the `this[…]` / `operator+` is the identity),
  // so they're captured at node level via @method.definition.
  // Namespaces use `qualified_name` for dotted forms (`Garnet.server`)
  // and `identifier` for single-segment forms; we capture both shapes.
  csharp: `
    (class_declaration name: (identifier) @class.definition)
    (interface_declaration name: (identifier) @interface.definition)
    (struct_declaration name: (identifier) @struct.definition)
    (record_declaration name: (identifier) @record.definition)
    (record_struct_declaration name: (identifier) @record.definition)
    (enum_declaration name: (identifier) @enum.definition)
    (delegate_declaration name: (identifier) @function.definition)
    (namespace_declaration name: (identifier) @namespace.definition)
    (namespace_declaration name: (qualified_name) @namespace.definition)
    (file_scoped_namespace_declaration name: (identifier) @namespace.definition)
    (file_scoped_namespace_declaration name: (qualified_name) @namespace.definition)
    (method_declaration name: (identifier) @method.definition)
    (constructor_declaration name: (identifier) @method.definition)
    (destructor_declaration name: (identifier) @method.definition)
    (property_declaration name: (identifier) @property.definition)
    (indexer_declaration) @method.definition
    (operator_declaration) @method.definition
    (conversion_operator_declaration) @method.definition
    (event_declaration name: (identifier) @property.definition)
    (event_field_declaration (variable_declaration (variable_declarator name: (identifier) @field.definition)))
    (field_declaration (variable_declaration (variable_declarator name: (identifier) @field.definition)))
    (local_function_statement name: (identifier) @function.definition)
  `,
};

// Names that tree-sitter-c / tree-sitter-cpp sometimes emit as the `name:`
// field of a struct_specifier / class_specifier / function_declarator when
// the parser misidentifies a C/C++ keyword as a user identifier. Common
// cause: a header-only C++ library has its .h file routed to C (because
// .h → c in EXTENSION_MAP), and tree-sitter-c then encounters C++ keywords
// (`alignas`, `namespace`, `decltype`, `enum class`) it does not recognize.
//
// Examples:
//   `struct alignas(16) uint128_t { ... }`        tree-sitter-c → name=alignas
//   `enum class Color { RED };`                   tree-sitter-c → name=class (under struct_specifier)
//   `using Vec = decltype(Zero(D()));`            tree-sitter-c → name=decltype (under function)
//   `namespace hwy::x86 { ... }`                  tree-sitter-c → name=namespace (under function)
//   `if (cond) { body }`                          tree-sitter-c → name=if (under function, on misparse)
//
// All entries are C/C++ reserved keywords. They CANNOT legally be the name
// of a user-defined type, function, or variable in any version of C/C++.
// Filtering them removes only phantom captures — never a legitimate entity.
//
// Closed list. Scoped to languageId ∈ {c, cpp} via C_FAMILY_LANGUAGES so a
// Go/Python/JS file with a class literally named `final` is not affected.
// Evidence gathered from highway @ 3c72230 cpp probe corpus:
//   decltype: 667 captures, alignas: 1, namespace: phantom on CPP-008,
//   class (under enum): 10, if: 11. Audit query in commit message.
const C_FAMILY_ATTRIBUTE_PHANTOM_NAMES = new Set([
  // Attribute / specifier keywords
  'alignas',         // C++11 keyword
  '_Alignas',        // C11 keyword
  '__attribute__',   // GCC extension
  '__declspec',      // MSVC extension
  '__inline__',      // GCC extension
  '__forceinline',   // MSVC extension
  'final',           // C++11 contextual keyword
  'override',        // C++11 contextual keyword
  // Type-deduction operators
  'decltype',        // C++11
  'typeof',          // C2x / GCC extension
  '__typeof',        // GCC extension
  '__typeof__',      // GCC extension
  // Structural keywords
  'class',           // C++ — miscaptured from `enum class` in .h→c misparse
  'struct',          // C/C++
  'union',           // C/C++
  'enum',            // C/C++
  'namespace',       // C++
  'typedef',         // C/C++
  'template',        // C++
  // Control-flow keywords (miscaptured as functions on parse errors)
  'if',              // C/C++
  'for',             // C/C++
  'while',           // C/C++
  'switch',          // C/C++
  'do',              // C/C++
]);

// Languages where C_FAMILY_ATTRIBUTE_PHANTOM_NAMES should be filtered.
// Scoped narrowly to C/C++ so a Go/Python/JS file containing a type
// literally named `final` is not affected.
const C_FAMILY_LANGUAGES = new Set(['c', 'cpp']);

// Map capture names from tags.scm queries to entity types
const CAPTURE_TO_ENTITY_TYPE = {
  'function.definition': 'function',
  'class.definition': 'class',
  'method.definition': 'method',
  'interface.definition': 'interface',
  'type.definition': 'typeAlias',
  'enum.definition': 'enum',
  'struct.definition': 'struct',
  'impl.definition': 'impl',
  'trait.definition': 'trait',
  'arrow.definition': 'arrowFunction',
  'decorator.definition': 'decorator',
  'namespace.definition': 'namespace',
  // New: Java, Ruby, PHP, Kotlin
  'record.definition': 'record',
  'module.definition': 'module',
  'object.definition': 'class',
  // JS/TS exported const declarations (May 2026):
  // @component fires only when value is a call_expression (memo/forwardRef/createSlice etc.);
  // @variable fires for any export const, including string/object/typed literals.
  // Both can match the same node; component wins via priority dedup downstream.
  'component.definition': 'component',
  'variable.definition': 'variable',
  'macro.definition': 'macro',
  // C# property declarations — `public RespCommand Command { get; init; }`.
  // Used by the csharp TAGS_QUERIES entry to give init-only properties /
  // computed properties / event-as-property declarations their own graph
  // entity. Currently no other tree-sitter grammar in this codebase emits
  // a @property.definition capture, so 'property' is a C#-private entity
  // type at the moment (Swift's property_declaration node is not captured
  // by tags.scm and won't reach this map).
  'property.definition': 'property',
  // Java enum constants (FieldNamingPolicy.UPPER_CAMEL_CASE) and field
  // declarations (TypeAdapters.BIT_SET — a static final field whose
  // initializer is an anonymous `new TypeAdapter<BitSet>() { ... }`).
  // Both are first-class declarations per JLS but tree-sitter-java
  // exposes them under distinct node types (enum_constant,
  // field_declaration > variable_declarator) that our query previously
  // ignored, so neither got a proper symbol anchor in the graph.
  'enum_constant.definition': 'enum_constant',
  'field.definition': 'field',
};

export class TreeSitterProvider {
  constructor(options = {}) {
    this.grammarsDir = options.grammarsDir || null;
    this._parser = null;
    this._languages = new Map();
    this._initPromise = null;
    this._available = null; // null = unknown, true/false after first check
    this._chunkCounter = 0; // per-parse chunk ID counter
  }

  /** Check if web-tree-sitter is importable */
  async isAvailable() {
    if (this._available !== null) return this._available;
    try {
      await import('web-tree-sitter');
      this._available = true;
    } catch {
      this._available = false;
    }
    return this._available;
  }

  /** Lazily initialize the tree-sitter parser (once) */
  async init() {
    if (this._parser) return this._parser;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      try {
        const { Parser } = await import('web-tree-sitter');
        await Parser.init();
        this._parser = new Parser();
        return this._parser;
      } catch (err) {
        this._available = false;
        this._initPromise = null;
        return null;
      }
    })();

    return this._initPromise;
  }

  /** Load a language grammar (lazy, cached) */
  async loadLanguage(languageId) {
    if (this._languages.has(languageId)) return this._languages.get(languageId);

    const grammarName = GRAMMAR_MAP[languageId];
    if (!grammarName) return null;

    try {
      const parser = await this.init();
      if (!parser) return null;

      const wasmPath = await this._findGrammarWasm(languageId, grammarName);
      if (!wasmPath) return null;

      const { Language } = await import('web-tree-sitter');
      const language = await Language.load(wasmPath);
      this._languages.set(languageId, language);
      return language;
    } catch {
      return null;
    }
  }

  /** Parse content with tree-sitter, returns tree or null */
  async parse(content, languageId) {
    const language = await this.loadLanguage(languageId);
    if (!language) return null;

    this._parser.setLanguage(language);
    return this._parser.parse(content);
  }

  /**
   * Extract symbols from content using tree-sitter tags.scm query patterns.
   * Returns an array of symbol objects, or null if tree-sitter is unavailable
   * or the language is unsupported.
   *
   * @param {string} content - Source code content
   * @param {string} languageId - Language identifier (e.g. 'javascript')
   * @returns {Promise<Array<{name: string, type: string, startLine: number, endLine: number, signature: string}>|null>}
   */
  async extractSymbols(content, languageId) {
    if (!(await this.isAvailable())) return null;

    const queryString = TAGS_QUERIES[languageId];
    if (!queryString) return null;

    const language = await this.loadLanguage(languageId);
    if (!language) return null;

    let tree;
    let query;
    try {
      this._parser.setLanguage(language);
      tree = this._parser.parse(content);
      if (!tree) return null;

      query = await this._createQuery(language, queryString);
      const captures = query.captures(tree.rootNode);

      const symbols = [];
      const seen = new Set(); // deduplicate by startIndex
      for (const capture of captures) {
        const { name: captureName, node } = capture;
        let entityType = CAPTURE_TO_ENTITY_TYPE[captureName];
        if (!entityType) continue;

        // When queries capture an identifier (e.g. `name: (identifier) @x`),
        // the node is the identifier leaf — use node.text for the name and
        // node.parent for the extent (start/end lines, signature).
        const isLeafIdent = IDENT_TYPES.has(node.type);
        const extentNode = isLeafIdent && node.parent ? node.parent : node;

        // Go's grammar collapses every `type X …` declaration into
        // `type_declaration → type_spec` with a single @type.definition
        // capture, which the table above maps to the catch-all 'typeAlias'.
        // The downstream `type` field of a type_spec encodes whether X is a
        // struct, an interface, or a true type alias / slice / func type.
        // Drill in and emit the more specific entity type so symbol-type
        // filtering, file-kind boosts and probe gold checks (GO-005 / GO-007
        // / GO-008 expect 'interface'/'struct', not 'typeAlias') work as
        // intended. Pure precision refinement: same node extent, same
        // symbol name, only the label changes. Other languages have no
        // `type_spec` node, so this branch is structurally Go-only.
        if (
          languageId === 'go' &&
          entityType === 'typeAlias' &&
          extentNode.type === 'type_spec'
        ) {
          const typeField = extentNode.childForFieldName?.('type');
          if (typeField) {
            if (typeField.type === 'struct_type') entityType = 'struct';
            else if (typeField.type === 'interface_type') entityType = 'interface';
            // All other type-spec rhs shapes (slice/array/map/channel/
            // function/pointer/qualified/identifier/generic/parenthesized)
            // remain 'typeAlias', which is the correct semantic label for
            // `type Middlewares []func(...)`, `type Handler = http.Handler`,
            // etc.
          }
        }

        // Deduplicate: multiple captures can match the same declaration
        const key = `${extentNode.startIndex}:${entityType}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const startLine = extentNode.startPosition.row;
        const endLine = extentNode.endPosition.row;

        // Build signature from the extent node's first line
        const nodeText = content.substring(extentNode.startIndex, extentNode.endIndex);
        const firstLine = nodeText.split('\n')[0].trim();
        const signature = firstLine.length > 120
          ? firstLine.substring(0, 117) + '...'
          : firstLine;

        const symbolName = isLeafIdent
          ? node.text
          : (node.childForFieldName?.('name')?.text
            || this._extractNodeName(node)
            || `<anonymous:${entityType}>`);

        // Filter C/C++ phantom captures where the parser bound the `name:`
        // field to a C/C++ keyword (`alignas`, `__attribute__`, etc.) instead
        // of the actual type name. See C_FAMILY_ATTRIBUTE_PHANTOM_NAMES above.
        if (
          C_FAMILY_LANGUAGES.has(languageId) &&
          C_FAMILY_ATTRIBUTE_PHANTOM_NAMES.has(symbolName)
        ) {
          continue;
        }

        symbols.push({
          name: symbolName,
          type: entityType,
          startLine,
          endLine,
          signature,
        });
      }

      return symbols;
    } catch {
      return null;
    } finally {
      if (query) query.delete();
      if (tree) tree.delete();
    }
  }

  /**
   * Parse file content into semantic chunks using the cAST recursive algorithm.
   * Returns array of chunk objects or null if tree-sitter can't handle it.
   *
   * Header-aware budget (research-only ablation, May 2026): set
   * SWEET_SEARCH_CHUNK_HEADER_OVERHEAD=N to subtract N chars from the
   * cAST max chunk size, leaving room for the embedding-text headers
   * (path / parent / symbol / language ≈ 50–100 chars) without spilling
   * past the embedding cap. Default 0 = byte-identical to shipped. The
   * audit motivating this lever lives in eval/results/chunk-overflow-audit.md.
   */
  async parseFileToChunks(content, languageId, options = {}) {
    const tree = await this.parse(content, languageId);
    if (!tree) return null;

    const headerOverhead = (() => {
      const v = parseInt(process.env.SWEET_SEARCH_CHUNK_HEADER_OVERHEAD || '', 10);
      return Number.isFinite(v) && v >= 0 ? v : 0;
    })();
    const maxChunkSize = (options.maxChunkSize || 2000) - headerOverhead;
    this._chunkCounter = 0;

    // Per-parse effective boundary set: BOUNDARY_TYPES ∪ language extras
    // \ language excludes. For every language without an extras or excludes
    // entry (= all 13 pre-2026-05-12 languages), this is byte-identical to
    // BOUNDARY_TYPES (same Set reference), so non-C# parsing semantics are
    // unchanged.
    const langExtra = LANG_EXTRA_BOUNDARY_TYPES[languageId];
    const langExcludes = LANG_BOUNDARY_TYPE_EXCLUDES[languageId];
    let boundaryTypes;
    if (!langExtra && !langExcludes) {
      boundaryTypes = BOUNDARY_TYPES;
    } else {
      boundaryTypes = new Set(BOUNDARY_TYPES);
      if (langExtra) for (const t of langExtra) boundaryTypes.add(t);
      if (langExcludes) for (const t of langExcludes) boundaryTypes.delete(t);
    }

    const children = this._getChildren(tree.rootNode);
    const chunks = this.recursiveChunk(children, content, maxChunkSize, null, boundaryTypes);

    tree.delete(); // free WASM memory

    // Filter phantom C/C++ attribute names — null out chunk.name when the
    // parser bound it to a C/C++ keyword. The chunk itself stays (the code
    // is real); only the symbol label is corrected. Downstream anomalous-
    // chunk demotion will treat any small-span resulting anonymous chunk
    // appropriately.
    if (C_FAMILY_LANGUAGES.has(languageId) && chunks) {
      for (const chunk of chunks) {
        if (chunk?.name && C_FAMILY_ATTRIBUTE_PHANTOM_NAMES.has(chunk.name)) {
          chunk.name = null;
        }
      }
    }

    return chunks.length > 0 ? chunks : null;
  }

  /** Generate a unique chunk ID for this parse session */
  _nextChunkId() {
    return `c${++this._chunkCounter}`;
  }

  /** Collect children of a node into an array */
  _getChildren(node) {
    const children = [];
    for (let i = 0; i < node.childCount; i++) {
      children.push(node.child(i));
    }
    return children;
  }

  /**
   * cAST recursive split-merge algorithm.
   *
   * Greedily merges adjacent sibling AST nodes into chunks up to maxSize.
   * When a single node exceeds maxSize, recurses into its children.
   * Never splits mid-expression or mid-statement (leaf nodes emit as-is).
   *
   * @param {Array} nodes - Sibling AST nodes to chunk
   * @param {string} content - Full file content
   * @param {number} maxSize - Maximum chunk size in characters
   * @param {object|null} parentInfo - Parent chunk info for hierarchical linking
   * @param {Set<string>} [boundaryTypes] - Effective boundary set (per-parse,
   *   BOUNDARY_TYPES ∪ LANG_EXTRA_BOUNDARY_TYPES[lang]). When omitted, falls
   *   back to BOUNDARY_TYPES — preserves the pre-2026-05-12 call signature
   *   for any internal caller that constructs this provider directly.
   * @returns {Array} List of chunk objects
   */
  recursiveChunk(nodes, content, maxSize, parentInfo, boundaryTypes = BOUNDARY_TYPES) {
    const chunks = [];
    let buffer = [];
    let bufferSize = 0;

    // SMALL_TAIL_THRESHOLD: chunks below this character count are
    // considered "orphan tails" — they tend to be `module.exports`,
    // closing braces, trailing const declarations, etc. that cAST's
    // sibling-merge couldn't fit into the previous buffer when it
    // overflowed maxSize. Merging them into the preceding emitted
    // chunk (when it shares the same parent context and won't push
    // past 1.25× maxSize) gives the agent a coherent unit instead
    // of a 2-line dangling chunk that wins retrieval on its own.
    //
    // Verified canary: lib/schema-controller.js was emitting
    // [148-161 setupSerializer] followed by [163-164 module.exports]
    // as two separate chunks — the orphan tail won S2-Q3 retrieval.
    // After merge, the tail joins setupSerializer.
    const SMALL_TAIL_THRESHOLD = 100;
    const TAIL_MERGE_HEADROOM = 1.25;

    const flushBuffer = () => {
      if (buffer.length === 0) return;
      const text = buffer
        .map(n => content.substring(n.startIndex, n.endIndex))
        .join('\n');

      if (text.trim().length > 30) {
        const boundariesInBuffer = buffer.filter(n => boundaryTypes.has(n.type));

        // SIBLING_DOC_SPLIT (RS-008 motivation, May 2026): at top level, when
        // 2+ boundary-typed siblings each carry an immediately-preceding outer
        // doc-comment, emit one chunk per boundary instead of merging them.
        // cAST sibling-merge would otherwise collapse them into one chunk
        // anchored solely on the first boundary's name (e.g. packaging.rs's
        // `is_package` + `detect_package_root` collapse into one
        // `# function: is_package` chunk). The bi-encoder then sees only the
        // first symbol as primary, and the sibling's doc-comment gets
        // averaged into the pooled embedding — a `# Additional:` header is
        // too weak to recover the secondary symbol at production k=5.
        //
        // Section i = buffer[afterPrevBoundary .. boundary_i]. The first
        // section absorbs all leading file-level material (module-level
        // comments, use stmts) so it stays attached to the first boundary;
        // the last section absorbs any trailing non-boundary nodes.
        //
        // Validation (May 2026, full §3 pipeline):
        //   - All 17 non-rust language packs: byte-identical to baseline
        //   - retrieval-probes 60: 46/4/10 identical
        //   - GCSN dev MRR@10: 86.92% exact
        //   - Rust AST-tester: 5/0/3 identical, zero PASS→FAIL flips
        //   - doc-positive / doc-negative rust: identical
        // RS-008 did NOT flip — bottleneck is encoder-bound (resolver.rs's
        // doc-string literally names `detect_package_root`, beating
        // packaging.rs on TF/IR). Shipped anyway as a structurally-correct
        // cAST refinement: more focused chunks for documented multi-fn
        // top-level files (e.g. fs.rs now has 5 per-fn chunks instead of
        // one merged chunk), with zero regression cost across all gates.
        //
        // Gating (conservative — undocumented helpers stay merged):
        //   1. parentInfo == null: top-level only. Nested contexts (mod,
        //      impl, class bodies) keep cAST merge behaviour because their
        //      `# Parent:` header line already anchors siblings to the
        //      enclosing scope.
        //   2. boundariesInBuffer.length >= 2: nothing to split if one.
        //   3. every boundary has a leading outer-doc comment (`///` or
        //      `/**`). Mixed documented/undocumented buffers fall through
        //      to cAST merge to avoid inflating chunk counts unnecessarily.
        // RUBY_CLASS_SIBLING_SPLIT: split when buffer has 2+ Ruby class/
        // module siblings, each with an extractable name. cAST sibling-
        // merge otherwise collapses adjacent tiny classes — e.g. sinatra
        // base.rb's `class ExtendedRack` + `class CommonLogger` + `class
        // Error` + ... — into one chunk labeled after the first boundary,
        // and later entity adoption (file-kind-ranking.applyResultDemotions)
        // walks UP via findEnclosingEntity over the merged range and
        // silently relabels the chunk to the outer module/namespace,
        // losing the IAR anchor. Splitting per-class restores 1:1 chunk-
        // to-entity alignment.
        //
        // Ruby-only gate via the tree-sitter-ruby-specific node type names
        // (`class`/`module`/`singleton_class`). Other grammars use
        // `class_declaration` (Java/JS/TS/Kotlin/C#), `class_definition`
        // (Python/Dart), `class_specifier` (C++), `struct_item` (Rust),
        // etc. — none of those node names exist in tree-sitter-ruby, and
        // `class`/`module`/`singleton_class` don't exist in any other
        // grammar. So this split is byte-identical-null-op for every non-
        // Ruby language pack and the 60-probe retrieval bench, while
        // fixing the chunker-bound regressions on Ruby AST probes RB-001
        // through RB-008.
        const RUBY_CLASS_LIKE_TYPES = new Set([
          'class',
          'module',
          'singleton_class',
        ]);
        const isClassLikeSiblingSet = boundariesInBuffer.length >= 2
          && boundariesInBuffer.every(b => {
            if (!RUBY_CLASS_LIKE_TYPES.has(b.type)) return false;
            const resolved = this._resolveBoundary(b);
            return !!this._extractNodeName(resolved.nameNode);
          });

        if (
          parentInfo == null
          && boundariesInBuffer.length >= 2
          && boundariesInBuffer.every(b => {
            const idx = buffer.indexOf(b);
            return idx > 0 && this._isLeadingDocComment(buffer[idx - 1], content);
          })
          || isClassLikeSiblingSet
        ) {
          let sectionStart = 0;
          for (let i = 0; i < boundariesInBuffer.length; i++) {
            const b = boundariesInBuffer[i];
            const bIdx = buffer.indexOf(b);
            // Last section absorbs trailing non-boundary nodes after `b`.
            const isLast = i === boundariesInBuffer.length - 1;
            const sectionEnd = isLast ? buffer.length - 1 : bIdx;
            const section = buffer.slice(sectionStart, sectionEnd + 1);
            const sectionText = section
              .map(n => content.substring(n.startIndex, n.endIndex))
              .join('\n');
            if (sectionText.trim().length > 30) {
              const resolved = this._resolveBoundary(b);
              chunks.push({
                chunkId: this._nextChunkId(),
                parentChunkId: parentInfo?.chunkId || null,
                parentSymbol: parentInfo?.name || null,
                parentType: parentInfo?.type || null,
                text: sectionText.trim(),
                startLine: section[0].startPosition.row,
                endLine: section[section.length - 1].endPosition.row,
                type: resolved.type,
                name: this._extractNodeName(resolved.nameNode),
                signature: this._extractSignature(b, content, boundaryTypes),
                additionalSymbols: null,
              });
            }
            sectionStart = bIdx + 1;
          }
          buffer = [];
          bufferSize = 0;
          return;
        }

        const firstBoundary = boundariesInBuffer[0];
        let name = null;
        let type = 'code';
        if (firstBoundary) {
          const resolved = this._resolveBoundary(firstBoundary);
          name = this._extractNodeName(resolved.nameNode);
          type = resolved.type;
        }
        const signature = firstBoundary ? this._extractSignature(firstBoundary, content, boundaryTypes) : null;
        // When the cAST sibling-merge collapses multiple top-level
        // boundaries into one chunk (e.g. small rust file with two
        // adjacent free-standing fns), only the first boundary's name
        // would otherwise reach embedding/LI headers — the bi-encoder
        // never sees the sibling symbol names. Collect them here and
        // pass through so buildEmbeddingText() / buildLiText() can
        // surface them via an `# Additional:` header line.
        let additionalSymbols = null;
        if (boundariesInBuffer.length > 1) {
          const sibNames = boundariesInBuffer.slice(1)
            .map(n => this._extractNodeName(n))
            .filter(n => n && n !== name);
          if (sibNames.length > 0) additionalSymbols = sibNames;
        }

        // Tail-orphan merge: when the buffer about to be flushed is
        // small AND has no boundary symbol of its own, append it into
        // the previous chunk PROVIDED:
        //   (a) the previous chunk's endLine is within 5 lines of this
        //       buffer's startLine (spatial locality — avoids merging
        //       a `module.exports` at line 163 with a class method at
        //       line 30)
        //   (b) merging keeps total under 1.25× maxSize (avoid overflow
        //       cliffs)
        //
        // We deliberately don't require same parentChunkId because the
        // canonical orphan-tail case (Lib/schema-controller.js) has the
        // tail at FILE-level (parent=null) but the previous emitted
        // chunk is the last METHOD of a class (parent=class_id) emitted
        // via the recursive call. Spatial proximity is the more
        // structural test — a 2-line trailing assignment immediately
        // after a class block belongs with that block.
        const prev = chunks[chunks.length - 1];
        const isOrphanTail = !firstBoundary
          && text.trim().length < SMALL_TAIL_THRESHOLD;
        const bufferStart = buffer[0].startPosition.row;
        const linesGap = prev ? bufferStart - prev.endLine : Infinity;
        const isSpatiallyClose = linesGap >= 0 && linesGap <= 5;
        const mergedSize = prev ? (prev.text.length + 1 + text.trim().length) : Infinity;
        const fitsHeadroom = mergedSize <= maxSize * TAIL_MERGE_HEADROOM;

        if (isOrphanTail && prev && isSpatiallyClose && fitsHeadroom) {
          prev.text = prev.text + '\n' + text.trim();
          prev.endLine = buffer[buffer.length - 1].endPosition.row;
        } else {
          chunks.push({
            chunkId: this._nextChunkId(),
            parentChunkId: parentInfo?.chunkId || null,
            parentSymbol: parentInfo?.name || null,
            parentType: parentInfo?.type || null,
            text: text.trim(),
            startLine: buffer[0].startPosition.row,
            endLine: buffer[buffer.length - 1].endPosition.row,
            type,
            name: name || (buffer.length === 1 ? null : null),
            signature,
            additionalSymbols,
          });
        }
      }
      buffer = [];
      bufferSize = 0;
    };

    for (const node of nodes) {
      const nodeSize = node.endIndex - node.startIndex;

      if (bufferSize + nodeSize <= maxSize) {
        // Fits in current buffer — accumulate
        buffer.push(node);
        bufferSize += nodeSize;
      } else {
        // Doesn't fit — flush buffer first
        flushBuffer();

        if (nodeSize <= maxSize) {
          // Node fits alone — start new buffer
          buffer = [node];
          bufferSize = nodeSize;
        } else {
          // Node is oversized even alone — recurse into children
          if (node.childCount > 0) {
            const resolved = this._resolveBoundary(node);
            const name = this._extractNodeName(resolved.nameNode);
            const type = resolved.type;

            // Header chunk for oversized BOUNDARY nodes (large classes,
            // structs, traits, etc.): emit a small "header" chunk before
            // recursing into the body. Without this, queries that match
            // the boundary's name itself (rather than any inner member)
            // have NO chunk anchored on the boundary — only sub-chunks
            // with parent_symbol context. Empirically (kotlin JobSupport,
            // 1582-line `open class JobSupport`), this left class-targeted
            // queries to lose to inner method chunks. The header chunk
            // captures the declaration + leading doc-comment / opening
            // body (up to ~600 chars) so the boundary name is searchable.
            //
            // Gating: only when the node is a BOUNDARY_TYPES AND has a name.
            // Top-level Ruby method nodes are excluded because those
            // unscoped `def` snippets are normalized to anonymous code chunks
            // by ASTChunker. Parent-scoped Ruby methods still get header
            // chunks when oversized.
            // Header text is bounded to maxSize so we never exceed embed cap.
            const isRubyMethodHeader = parentInfo == null
              && (node.type === 'method' || node.type === 'singleton_method');
            if (boundaryTypes.has(node.type) && name && !isRubyMethodHeader) {
              const HEADER_MAX_CHARS = Math.min(600, maxSize);
              const headerEndIdx = Math.min(node.endIndex, node.startIndex + HEADER_MAX_CHARS);
              const headerText = content.substring(node.startIndex, headerEndIdx);
              if (headerText.trim().length > 30) {
                const lineCount = headerText.split('\n').length;
                chunks.push({
                  chunkId: this._nextChunkId(),
                  parentChunkId: parentInfo?.chunkId || null,
                  parentSymbol: parentInfo?.name || null,
                  parentType: parentInfo?.type || null,
                  text: headerText.trim(),
                  startLine: node.startPosition.row,
                  endLine: node.startPosition.row + Math.max(0, lineCount - 1),
                  type,
                  name,
                  signature: this._extractSignature(node, content, boundaryTypes),
                });
              }
            }

            // Transparent nodes (no name resolved) pass through the caller's
            // parent context instead of creating an anonymous "unknown" level.
            // Covers two cases:
            //   1. Non-boundary containers (statement_block, body_statement,
            //      block) — pre-existing behaviour.
            //   2. Ruby `class << self` (singleton_class with value=self,
            //      which has no extractable name). Without this carve-out
            //      the chunk's sub-chunks get `parentSymbol='unknown'`,
            //      losing the enclosing class context (e.g. Sinatra::Base);
            //      with it they inherit `parentSymbol='Base'`. Narrowed to
            //      singleton_class so other languages' nameless boundaries
            //      (JS arrow_function, anonymous classes) keep their
            //      pre-existing 'unknown' attribution unchanged.
            let subParent;
            const isNamelessRubySingleton = node.type === 'singleton_class';
            if (!name && (!boundaryTypes.has(node.type) || isNamelessRubySingleton) && parentInfo) {
              subParent = parentInfo;
            } else {
              const parentId = this._nextChunkId();
              subParent = { chunkId: parentId, name: name || 'unknown', type };
            }

            const subChunks = this.recursiveChunk(
              this._getChildren(node),
              content,
              maxSize,
              subParent,
              boundaryTypes
            );
            chunks.push(...subChunks);
          } else {
            // Leaf node too big — emit as-is (never split mid-expression)
            const nodeText = content.substring(node.startIndex, node.endIndex);
            const resolved = this._resolveBoundary(node);
            chunks.push({
              chunkId: this._nextChunkId(),
              parentChunkId: parentInfo?.chunkId || null,
              parentSymbol: parentInfo?.name || null,
              parentType: parentInfo?.type || null,
              text: nodeText.trim(),
              startLine: node.startPosition.row,
              endLine: node.endPosition.row,
              type: resolved.type,
              name: this._extractNodeName(resolved.nameNode),
              signature: this._extractSignature(node, content, boundaryTypes),
            });
          }
        }
      }
    }

    flushBuffer();
    return chunks;
  }

  /**
   * Extract a compact, single-line signature for a boundary AST node.
   *
   * Strategy: find the first body-like child (block / statement_block /
   * compound_statement / class_body / declaration_list / …), and return
   * the source span [node.startIndex, body.startIndex) with whitespace
   * normalized to single spaces. If no body child is found (e.g.
   * declarations without a body, abstract methods, interface members),
   * return the full first line of the node.
   *
   * Returns null when the node has no children to inspect.
   *
   * Used by the `signature` R1 embedding-text variant. Intentionally
   * does NOT alter `text`, `li_text`, or `li_greedy_text` — signature
   * surface is research-only on `embedding_text`.
   */
  _extractSignature(node, content, boundaryTypes = BOUNDARY_TYPES) {
    if (!node || !content) return null;
    if (!boundaryTypes.has(node.type)) return null;

    let bodyStart = null;
    // Try field-name lookup first (works for most modern grammars).
    const bodyField = node.childForFieldName?.('body');
    if (bodyField && BODY_TYPES.has(bodyField.type)) {
      bodyStart = bodyField.startIndex;
    } else {
      // Fall back to scanning children for a body-shaped child.
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (BODY_TYPES.has(child.type)) {
          bodyStart = child.startIndex;
          break;
        }
      }
    }

    let raw;
    if (bodyStart != null && bodyStart > node.startIndex) {
      raw = content.substring(node.startIndex, bodyStart);
    } else {
      // No body found — declaration only (e.g. abstract method, type
      // alias). Take the whole node text.
      raw = content.substring(node.startIndex, node.endIndex);
    }

    // Normalize: collapse runs of whitespace (including newlines) to a
    // single space, drop leading/trailing whitespace.
    const normalized = raw.replace(/\s+/g, ' ').trim();
    if (!normalized) return null;

    if (normalized.length <= MAX_SIGNATURE_LENGTH) return normalized;
    return normalized.slice(0, MAX_SIGNATURE_LENGTH - 1) + '…';
  }

  /**
   * Returns true if `node` is a comment-typed AST node whose source text
   * is an outer doc-comment immediately preceding a code item.
   *
   * Recognized outer-doc prefixes (cross-language):
   *   ///   — Rust outer doc, C/C++/C# triple-slash documentation
   *   /**   — Javadoc, JSDoc, PHPDoc, Doxygen, KDoc, Scaladoc
   *
   * Deliberately excludes:
   *   //!   — Rust inner doc (applies to enclosing module, not next item)
   *   //    — plain line comments (Go uses these as docs but the same
   *           syntax is used for arbitrary inline notes; ambiguous, skip)
   *   #     — shell/Ruby/Python pound comments (ambiguous, and Python
   *           docstrings live INSIDE the function, not preceding it)
   *
   * Used by the SIBLING_DOC_SPLIT branch in recursiveChunk.flushBuffer to
   * decide whether each of N top-level sibling boundaries has its own
   * docstring (in which case they each deserve their own chunk).
   */
  _isLeadingDocComment(node, content) {
    if (!node || !node.type) return false;
    // Tree-sitter comment node names vary by grammar (line_comment,
    // block_comment, comment, doc_comment); gate on a stable suffix.
    if (!/comment$/.test(node.type)) return false;
    const text = content.substring(node.startIndex, node.endIndex).trimStart();
    return text.startsWith('///') || text.startsWith('/**');
  }

  /** Extract symbol name from an AST node */
  _extractNodeName(node) {
    // Try field name first (most reliable)
    const nameNode = node.childForFieldName('name');
    if (nameNode) return nameNode.text;

    // Rust `impl<'a> Type<'a> { ... }` — the type field is a
    // `generic_type` wrapper, not a leaf `type_identifier`, so the
    // IDENT_TYPES fallback below picks up the lifetime keyword instead
    // (or finds nothing). Drill into the wrapper to recover the type
    // name. Plain `impl Foo` (no generics) hits the IDENT_TYPES branch
    // unchanged; `impl Foo for Bar` also unchanged since `Foo` is the
    // first IDENT_TYPES child today.
    if (node.type === 'impl_item') {
      const typeNode = node.childForFieldName('type');
      if (typeNode && typeNode.type === 'generic_type') {
        const inner = typeNode.namedChild(0);
        if (inner && IDENT_TYPES.has(inner.type)) {
          return inner.text;
        }
      }
    }

    // Fallback: look for identifier-type children (uses IDENT_TYPES set).
    // Visibility-keyword stoplist: tree-sitter-ruby parses bare `private`,
    // `protected`, `public` (with no args) as standalone `identifier`
    // statements inside a class/module body — they're method calls on
    // `self` that toggle subsequent definitions' visibility, not entity
    // names. When the chunker recurses into an oversized body_statement
    // and falls back to scanning IDENT_TYPES children, the first such
    // identifier between method defs would otherwise become the parent
    // breadcrumb "name=private" and poison every nested chunk's
    // parentSymbol. Java/Kotlin/C++/C#/Swift parse the same words as
    // keywords, not identifiers, so this filter is null-op for those
    // grammars — a Ruby-targeted fix that's safe across the corpus.
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (IDENT_TYPES.has(child.type)) {
        const text = child.text;
        if (text === 'private' || text === 'protected' || text === 'public') continue;
        return text;
      }
    }

    return null;
  }

  /**
   * Resolve the effective chunk type + name node for a boundary node.
   * Handles C++ template_declaration wrappers by drilling into the first
   * child with a known NODE_TYPE_MAP entry (class_specifier, struct_specifier,
   * function_definition, alias_declaration, etc.). Without this, templated
   * structs/classes/aliases were emitted as type=code with name=null because
   * template_declaration itself has no name field.
   */
  _resolveBoundary(node) {
    if (node.type === 'template_declaration') {
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (NODE_TYPE_MAP[c.type]) {
          return { type: NODE_TYPE_MAP[c.type], nameNode: c };
        }
      }
    }
    return { type: NODE_TYPE_MAP[node.type] || 'code', nameNode: node };
  }

  /** Create a tree-sitter query (mockable seam for tests) */
  async _createQuery(language, queryString) {
    const { Query } = await import('web-tree-sitter');
    return new Query(language, queryString);
  }

  /** Find grammar WASM file on disk */
  async _findGrammarWasm(languageId, grammarName) {
    const fs = await import('fs');
    const pathMod = await import('path');

    // Strategy 1: explicit grammars directory
    if (this.grammarsDir) {
      const localPath = pathMod.join(this.grammarsDir, `${grammarName}.wasm`);
      if (fs.existsSync(localPath)) return localPath;
    }

    // Strategy 2: .sweet-search/grammars/ relative to process.cwd().
    // Used when sweet-search is run from inside a target repo and that repo
    // ships project-specific grammar overrides under its own .sweet-search/.
    const dataDir = process.env.SWEET_SEARCH_DATA_DIR || '.sweet-search';
    const dataPath = pathMod.join(process.cwd(), dataDir, 'grammars', `${grammarName}.wasm`);
    if (fs.existsSync(dataPath)) return dataPath;

    // Strategy 2b: .sweet-search/grammars/ relative to the sweet-search PACKAGE
    // root (the directory containing this provider file's parent's parent).
    // This is the home for grammar overrides that need to survive `npm install`
    // wiping the tree-sitter-wasms bundle (Strategy 3) and also be visible when
    // the indexer is run from an arbitrary target repo (so process.cwd() is not
    // the sweet-search root). Required for the Swift grammar override —
    // tree-sitter-wasms@0.1.13 ships swift v0.4.0 which crashes Node 25.x V8
    // turboshaft Wasm tier-up (Zone OOM in WasmLoweringPhase); the working
    // v0.7.2 wasm from alex-pinkus/tree-sitter-swift `0.7.2-pypi` lives here.
    // Resolve via import.meta.url so it works whether sweet-search is the cwd
    // or a node_modules dependency.
    try {
      const providerDir = pathMod.dirname(new URL(import.meta.url).pathname);
      const pkgRoot = pathMod.resolve(providerDir, '..', '..');
      const pkgOverridePath = pathMod.join(pkgRoot, '.sweet-search', 'grammars', `${grammarName}.wasm`);
      if (fs.existsSync(pkgOverridePath)) return pkgOverridePath;
    } catch {
      // import.meta.url unavailable (e.g. some bundlers); fall through.
    }

    // Strategy 3: tree-sitter-wasms bundle (all grammars in one package)
    try {
      const bundlePkg = await import.meta.resolve?.('tree-sitter-wasms/package.json');
      if (bundlePkg) {
        const bundleDir = pathMod.dirname(new URL(bundlePkg).pathname);
        const bundlePath = pathMod.join(bundleDir, 'out', `${grammarName}.wasm`);
        if (fs.existsSync(bundlePath)) return bundlePath;
      }
    } catch {
      // tree-sitter-wasms not installed
    }

    // Strategy 4: individual grammar packages in node_modules
    try {
      const pkgPath = await import.meta.resolve?.(`${grammarName}/package.json`);
      if (pkgPath) {
        const pkgDir = pathMod.dirname(new URL(pkgPath).pathname);
        const candidates = [
          pathMod.join(pkgDir, `${grammarName}.wasm`),
          pathMod.join(pkgDir, `${languageId}.wasm`),
          pathMod.join(pkgDir, 'tree-sitter.wasm'),
        ];
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    } catch {
      // Package not installed
    }

    return null;
  }

  /** List all languages with tree-sitter grammar support */
  getSupportedLanguages() {
    return Object.keys(GRAMMAR_MAP);
  }

  /** Check if a language ID has tree-sitter grammar mapping */
  hasLanguage(languageId) {
    return languageId in GRAMMAR_MAP;
  }

  /** Reset internal state (useful for testing) */
  reset() {
    if (this._parser) {
      try { this._parser.delete(); } catch { /* ignore */ }
    }
    this._parser = null;
    this._languages.clear();
    this._initPromise = null;
    this._available = null;
  }
}

// Singleton instance
let _instance = null;

export function getTreeSitterProvider(options) {
  if (!_instance) {
    _instance = new TreeSitterProvider(options);
  } else if (options?.grammarsDir && options.grammarsDir !== _instance.grammarsDir) {
    _instance.reset();
    _instance = new TreeSitterProvider(options);
  }
  return _instance;
}

/** Reset the singleton (for testing) */
export function resetTreeSitterProvider() {
  if (_instance) {
    _instance.reset();
    _instance = null;
  }
}

// Re-export constants for testing
export { GRAMMAR_MAP, IDENT_TYPES, BOUNDARY_TYPES, BODY_TYPES, MAX_SIGNATURE_LENGTH, NODE_TYPE_MAP, TAGS_QUERIES, CAPTURE_TO_ENTITY_TYPE };

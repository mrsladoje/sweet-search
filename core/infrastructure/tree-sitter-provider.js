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

import { extractTreeSitterDocComment } from './tree-sitter-doc-comments.js';

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
  // Wired 2026-06 (v2.6.3) for first-class AST/cAST chunking. All four wasm
  // grammars ship in tree-sitter-wasms and load on the installed web-tree-sitter
  // ABI. (tree-sitter-elm / tree-sitter-ql also ship but are ABI 12/10 vs the
  // required 13–15, so they stay on generic chunking.)
  solidity: 'tree-sitter-solidity',
  tlaplus: 'tree-sitter-tlaplus',
  ocaml: 'tree-sitter-ocaml',
  rescript: 'tree-sitter-rescript',
};

// Identifier node types — used to detect leaf-ident captures in extractSymbols()
const IDENT_TYPES = new Set([
  'identifier', 'type_identifier', 'property_identifier', 'field_identifier',
  // Needed by Ruby, PHP, Kotlin, Swift, C++
  'constant',             // Ruby class/module names
  'name',                 // PHP all identifiers
  'simple_identifier',    // Kotlin functions, Swift functions
  'namespace_identifier', // C++ namespace names
  // OCaml — names live in *_binding children (see _extractNodeName drill)
  'value_name', 'type_constructor', 'module_name',
  // ReScript — value/module binding names (type_identifier already covered)
  'value_identifier', 'module_identifier',
  // JS/TS `#private` class members
  'private_property_identifier',
]);

// AST node types that represent meaningful chunk boundaries
const BOUNDARY_TYPES = new Set([
  // Functions
  'function_declaration', 'function_definition', 'method_definition',
  'arrow_function', 'function_expression', 'method_declaration',
  'function_item',
  // Classes
  'class_declaration', 'class_definition',
  // TypeScript `abstract class Foo {}`
  'abstract_class_declaration',
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
  // Solidity (tree-sitter-solidity). `function_definition` is already a global
  // boundary; these are the contract-level declarations the grammar emits, all
  // carrying a `name: (identifier)` field so _extractNodeName resolves them.
  solidity: new Set([
    'contract_declaration', 'interface_declaration', 'library_declaration',
    'struct_declaration', 'enum_declaration', 'event_definition',
    'modifier_definition', 'constructor_definition', 'error_declaration',
  ]),
  // TLA+ (tree-sitter-tlaplus). `module` is already global; operator_definition
  // (`Foo == ...`) is the unit of definition, name via `name: (identifier)`.
  tlaplus: new Set(['operator_definition']),
  // OCaml (tree-sitter-ocaml). `type_definition` is already global; these wrap a
  // *_binding whose name (value_name/type_constructor/module_name) is recovered
  // by the _extractNodeName binding-wrapper drill. value_definition is top-level
  // only (local `let … in` is a let_expression), so this doesn't over-chunk.
  ocaml: new Set(['value_definition', 'module_definition', 'exception_definition']),
  // ReScript (tree-sitter-rescript). `type_declaration` is already global; the
  // let/module declarations wrap a *_binding handled by the same drill.
  rescript: new Set(['let_declaration', 'module_declaration']),
  // Rust type declarations other than struct / trait / impl (global). Without them a file's
  // enums joined the license + imports chunk with no name (jj lib/src/bisect.rs 1-60 held
  // `enum BisectionError` and `enum Evaluation`; ss-find labelled an `enum Evaluation` regex hit
  // as BisectionError and printed the license first). The graph already extracts them.
  rust: new Set(['enum_item', 'union_item', 'type_item']),
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
  // PHP `namespace Foo { … }` is transparent (NAMESPACE_WRAPPER_TYPES); the
  // body-less `namespace Foo;` is a statement, not a declaration — as a
  // boundary it labelled the chunk holding the file's class `namespace: Foo`.
  php: new Set(['namespace_definition']),
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
  'abstract_class_declaration': 'class',
  'interface_declaration': 'interface',
  'type_alias_declaration': 'typeAlias',
  'enum_declaration': 'enum',
  'struct_item': 'struct',
  'impl_item': 'impl',
  'trait_item': 'trait',
  'enum_item': 'enum',
  'union_item': 'struct',
  'type_item': 'typeAlias',
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
  // Kotlin (only grammar with this node type)
  'object_declaration': 'object',
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
  // Solidity (tree-sitter-solidity) — grammar-unique node names, so these are
  // null-ops for every other language's chunking.
  'contract_declaration': 'class',
  'library_declaration': 'class',
  'event_definition': 'event',
  'modifier_definition': 'function',
  'constructor_definition': 'method',
  'error_declaration': 'type',
  // TLA+
  'operator_definition': 'function',
  // OCaml
  'value_definition': 'function',
  'module_definition': 'module',
  'exception_definition': 'class',
  // ReScript
  'let_declaration': 'function',
  'module_declaration': 'module',
};

// OCaml / ReScript boundary node -> the `*_binding` child that carries the name.
// Consulted only by _extractNodeName; the keys are grammar-unique node types.
const OCAML_RESCRIPT_BINDING_WRAPPERS = {
  // OCaml
  value_definition: 'let_binding',
  module_definition: 'module_binding',
  // ReScript
  let_declaration: 'let_binding',
  module_declaration: 'module_binding',
  // Shared (already a global boundary; name nested in *_binding for both langs)
  type_definition: 'type_binding',
  type_declaration: 'type_binding',
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
// Call sites read from the tree, for languages whose calls have no `name(`
// shape for the line scanner (call-site-scanner.js): OCaml applies a function
// by juxtaposition (`parse_list (s :: acc) xs`, `Unescape.unescape (lexeme b)`),
// so its graph stored no calls at all. The called value is the first child.
const AST_CALL_QUERIES = {
  ocaml: '(application_expression . (value_path) @call)',
};

function hasAncestorType(node, re) {
  for (let p = node?.parent; p; p = p.parent) if (re.test(p.type)) return true;
  return false;
}

/** Names bound by patterns under `node` (`value_pattern`, `value_name` leaves). */
function ocamlPatternNames(node, out) {
  if (!node) return out;
  if ((node.type === 'value_pattern' || node.type === 'value_name') && node.childCount === 0) out.add(node.text);
  for (const c of node.namedChildren) ocamlPatternNames(c, out);
  return out;
}

/**
 * True when `name`, called at `callNode`, is bound in an enclosing scope: a parameter
 * of an enclosing function (`let f a b =`, `fun a ->`), a `let … in` binding whose body
 * holds the call, or a `match` / `function` case pattern.
 */
function ocamlLocallyBound(callNode, name) {
  let child = callNode;
  for (let p = callNode.parent; p; child = p, p = p.parent) {
    if (p.type === 'compilation_unit' || p.type === 'structure') return false;
    const names = new Set();
    if (p.type === 'let_binding' || p.type === 'fun_expression') {
      for (const c of p.namedChildren) if (c.type === 'parameter') ocamlPatternNames(c, names);
    } else if (p.type === 'let_expression') {
      // Bindings reach the body (and themselves under `let rec`, not shadowing then).
      const def = p.namedChildren.find(c => c.type === 'value_definition');
      if (def && child !== def) {
        for (const b of def.namedChildren) {
          if (b.type !== 'let_binding') continue;
          const pat = b.childForFieldName?.('pattern') || b.namedChildren[0];
          ocamlPatternNames(pat, names);
        }
      }
    } else if (p.type === 'match_case') {
      const pat = p.namedChildren[0];
      if (pat && child !== pat) ocamlPatternNames(pat, names);
    }
    if (names.has(name)) return true;
  }
  return false;
}

const TAGS_QUERIES = {
  javascript: `
    ; A named function expression is a definition: \`wrapAsync(async function
    ; dispatchHttpRequest(…) {…})\`, \`export default ok && function httpAdapter(…)\`,
    ; \`return function inner(…)\` (axios http.js: a 600-line adapter body was
    ; top-level code). Pairs and member assignments are captured above.
    (arguments (function_expression name: (identifier) @function.definition))
    (binary_expression (function_expression name: (identifier) @function.definition))
    (return_statement (function_expression name: (identifier) @function.definition))
    (parenthesized_expression (function_expression name: (identifier) @function.definition))
    (variable_declarator
      name: (identifier) @function.definition
      value: (function_expression))
    (function_declaration name: (identifier) @function.definition)
    (generator_function_declaration name: (identifier) @function.definition)
    (class_declaration name: (identifier) @class.definition)
    (method_definition name: (property_identifier) @method.definition)
    (method_definition name: (private_property_identifier) @method.definition)
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
    ; A function assigned to a member: \`res.redirect = function redirect(url) {}\`,
    ; \`Reply.prototype.send = function () {}\`, \`module.exports.f = () => {}\` (express
    ; defines its whole API so; none of it was an entity). Captured at the assignment so the
    ; entity spans the body; named after the property, owned by the object.
    (assignment_expression
      left: (member_expression property: (property_identifier))
      right: [(function_expression) (arrow_function)]) @method.definition
  `,
  typescript: `
    ; A named function expression is a definition: \`wrapAsync(async function
    ; dispatchHttpRequest(…) {…})\`, \`export default ok && function httpAdapter(…)\`,
    ; \`return function inner(…)\` (axios http.js: a 600-line adapter body was
    ; top-level code). Pairs and member assignments are captured above.
    (arguments (function_expression name: (identifier) @function.definition))
    (binary_expression (function_expression name: (identifier) @function.definition))
    (return_statement (function_expression name: (identifier) @function.definition))
    (parenthesized_expression (function_expression name: (identifier) @function.definition))
    (variable_declarator
      name: (identifier) @function.definition
      value: (function_expression))
    (function_declaration name: (identifier) @function.definition)
    (generator_function_declaration name: (identifier) @function.definition)
    (class_declaration name: (type_identifier) @class.definition)
    (abstract_class_declaration name: (type_identifier) @class.definition)
    (method_definition name: (property_identifier) @method.definition)
    (method_definition name: (private_property_identifier) @method.definition)
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
    ; A named function expression is a definition: \`wrapAsync(async function
    ; dispatchHttpRequest(…) {…})\`, \`export default ok && function httpAdapter(…)\`,
    ; \`return function inner(…)\` (axios http.js: a 600-line adapter body was
    ; top-level code). Pairs and member assignments are captured above.
    (arguments (function_expression name: (identifier) @function.definition))
    (binary_expression (function_expression name: (identifier) @function.definition))
    (return_statement (function_expression name: (identifier) @function.definition))
    (parenthesized_expression (function_expression name: (identifier) @function.definition))
    (variable_declarator
      name: (identifier) @function.definition
      value: (function_expression))
    (function_declaration name: (identifier) @function.definition)
    (generator_function_declaration name: (identifier) @function.definition)
    (class_declaration name: (type_identifier) @class.definition)
    (abstract_class_declaration name: (type_identifier) @class.definition)
    (method_definition name: (property_identifier) @method.definition)
    (method_definition name: (private_property_identifier) @method.definition)
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
    ; Package-level \`var\` / \`const\`, single or grouped (\`var ( … )\`).
    ; Function-local declarations are not entities (source_file parent only).
    ; dgraph's \`var errHasPendingTxns = errors.New("Pending transactions
    ; found…")\` was invisible to the graph and to entity BM25.
    ; Positional \`(identifier)\`, not \`name:\`: the field form matches only
    ; the first name of \`var a, b int\`. A spec's only direct identifier
    ; children are its names (types and values are other node types).
    (source_file (var_declaration (var_spec (identifier) @variable.definition)))
    (source_file (const_declaration (const_spec (identifier) @constant.definition)))
  `,
  rust: `
    (function_item name: (identifier) @function.definition)
    (struct_item name: (type_identifier) @struct.definition)
    (impl_item type: (type_identifier) @impl.definition)
    ; \`impl<T> Foo<T>\` and \`impl a::Foo\` — named by _extractNodeName.
    (impl_item type: (generic_type)) @impl.definition
    (impl_item type: (scoped_type_identifier)) @impl.definition
    (trait_item name: (type_identifier) @trait.definition)
    ; Trait method declarations without a default body (\`fn len(&self);\`).
    (function_signature_item name: (identifier) @method.definition)
    (enum_item name: (type_identifier) @enum.definition)
    (macro_definition name: (identifier) @macro.definition)
    ; Module-level and associated \`const\` / \`static\` items (labels match the
    ; Rust regex registry). Function-local items are not entities.
    (source_file (const_item name: (identifier) @constant.definition))
    (source_file (static_item name: (identifier) @static.definition))
    (declaration_list (const_item name: (identifier) @constant.definition))
    (declaration_list (static_item name: (identifier) @static.definition))
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
    ; \`class Foo::Bar\` / \`module Foo::Bar\` — named by the last segment.
    (class name: (scope_resolution)) @class.definition
    (module name: (scope_resolution)) @module.definition
    (method name: (identifier) @method.definition)
    (singleton_method name: (identifier) @method.definition)
    ; Capitalised method names (\`def S(*a)\`) parse as constants.
    (method name: (constant) @method.definition)
    (singleton_method name: (constant) @method.definition)
    ; Operator and setter methods (\`def []=(k, v)\`, \`def <=>(o)\`, \`def name=(v)\`):
    ; the whole definition is captured, named by its \`name\` field text.
    (method name: (operator)) @method.definition
    (singleton_method name: (operator)) @method.definition
    (method name: (setter)) @method.definition
    (singleton_method name: (setter)) @method.definition
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
    (companion_object) @object.definition
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
  // C/C++: function name nested inside declarator chain. Captures are on the
  // WHOLE function_definition node (not the identifier leaf) so entity spans
  // cover the body — leaf captures gave start_line == end_line, which starved
  // ss-trace targets of code. Names resolve via _cFunctionDefinitionName.
  // Pointer-returning definitions (`char *foo(...)`) wrap the
  // function_declarator in a pointer_declarator — captured separately.
  c: `
    (function_definition
      declarator: (function_declarator
        declarator: (identifier))) @function.definition
    (function_definition
      declarator: (pointer_declarator
        declarator: (function_declarator
          declarator: (identifier)))) @function.definition
    (struct_specifier name: (type_identifier) @struct.definition)
    (enum_specifier name: (type_identifier) @enum.definition)
    (type_definition declarator: (type_identifier) @type.definition)
  `,
  // C++ additionally has out-of-line qualified members
  // (`Type Class::method(...)` — qualified_identifier), in-class definitions
  // (field_identifier), and destructors — ALL previously invisible to the
  // graph (E2, 2026-07-08 trace audit: botan's GeneralName::matches_dns and
  // Name_Constraints::validate were untraceable). Patterns are mutually
  // exclusive by declarator shape, so the startIndex:type dedupe never sees
  // the same definition twice.
  cpp: `
    (function_definition
      declarator: (function_declarator
        declarator: (identifier))) @function.definition
    (function_definition
      declarator: (function_declarator
        declarator: (qualified_identifier))) @method.definition
    (function_definition
      declarator: (function_declarator
        declarator: (field_identifier))) @method.definition
    (function_definition
      declarator: (function_declarator
        declarator: (destructor_name))) @method.definition
    (function_definition
      declarator: (pointer_declarator
        declarator: (function_declarator
          declarator: (identifier)))) @function.definition
    (function_definition
      declarator: (pointer_declarator
        declarator: (function_declarator
          declarator: (qualified_identifier)))) @method.definition
    (function_definition
      declarator: (reference_declarator
        (function_declarator
          declarator: (identifier)))) @function.definition
    (function_definition
      declarator: (reference_declarator
        (function_declarator
          declarator: (qualified_identifier)))) @method.definition
    (function_definition
      declarator: (pointer_declarator
        declarator: (function_declarator
          declarator: (field_identifier)))) @method.definition
    (function_definition
      declarator: (reference_declarator
        (function_declarator
          declarator: (field_identifier)))) @method.definition
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
    (event_field_declaration (variable_declaration (variable_declarator (identifier) @field.definition)))
    (field_declaration (variable_declaration (variable_declarator (identifier) @field.definition)))
    (local_function_statement name: (identifier) @function.definition)
  `,
  // Solidity (tree-sitter-solidity) — every declaration carries name: (identifier).
  solidity: `
    (contract_declaration name: (identifier) @class.definition)
    (interface_declaration name: (identifier) @interface.definition)
    (library_declaration name: (identifier) @class.definition)
    (struct_declaration name: (identifier) @struct.definition)
    (enum_declaration name: (identifier) @enum.definition)
    (function_definition name: (identifier) @function.definition)
    (modifier_definition name: (identifier) @function.definition)
    (event_definition name: (identifier) @function.definition)
  `,
  // TLA+ (tree-sitter-tlaplus)
  tlaplus: `
    (module name: (identifier) @namespace.definition)
    (operator_definition name: (identifier) @function.definition)
  `,
  // OCaml (tree-sitter-ocaml) — names nested in the *_binding child.
  // Only file- and module-level lets: a `let … in` inside a body is a local
  // value (yojson parser.ml `let s = …` became a top-level function).
  ocaml: `
    (compilation_unit (value_definition (let_binding (value_name) @function.definition)))
    (structure (value_definition (let_binding (value_name) @function.definition)))
    (type_definition (type_binding (type_constructor) @type.definition))
    (module_definition (module_binding (module_name) @namespace.definition))
  `,
  // ReScript (tree-sitter-rescript) — names nested in the *_binding child.
  rescript: `
    (let_declaration (let_binding (value_identifier) @function.definition))
    (type_declaration (type_binding (type_identifier) @type.definition))
    (module_declaration (module_binding (module_identifier) @namespace.definition))
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
  'object.definition': 'object', // Kotlin object / companion object
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
  // Go package-level `const` and Rust `const` / `static` items. Labels match
  // the regex registries for both languages ('const', 'static'), which the
  // IAR anchor lookup already excludes as generic constants.
  'constant.definition': 'const',
  'static.definition': 'static',
};

// Go declaration specs: a spec alone in its `var` / `const` statement takes
// the statement as extent (signature keeps the keyword); a spec inside a
// `var ( … )` group keeps its own extent.
const GO_DECLARATION_SPECS = { var_spec: 'var', const_spec: 'const' };

// Languages whose package/module-level state (Go var/const, Rust
// const/static) became tree-sitter entities in 2026-10, and those types.
export const STATE_CAPTURE_LANGUAGES = new Set(['go', 'rust']);
export const STATE_ENTITY_TYPES = new Set(['variable', 'const', 'static']);

// Containment for graph entities (`parent_class`): the nearest enclosing
// type-like declaration of a captured definition. Without it every method
// in the graph was parentless, so same-named methods of different types
// (GRDB's broker `statementDidFail` vs `Database.statementDidFail`) could
// not be told apart and `Type.method` lookups never matched.
// Per language: node types that name a container for their members.
const CONTAINER_NODE_TYPES = {
  javascript: new Set(['class_declaration', 'class', 'object']),
  typescript: new Set(['class_declaration', 'abstract_class_declaration', 'class', 'interface_declaration', 'object']),
  tsx: new Set(['class_declaration', 'abstract_class_declaration', 'class', 'interface_declaration', 'object']),
  python: new Set(['class_definition']),
  rust: new Set(['impl_item', 'trait_item']),
  java: new Set(['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration', 'annotation_type_declaration']),
  ruby: new Set(['class', 'module']),
  php: new Set(['class_declaration', 'interface_declaration', 'trait_declaration', 'enum_declaration']),
  kotlin: new Set(['class_declaration', 'object_declaration']),
  swift: new Set(['class_declaration', 'protocol_declaration']),
  cpp: new Set(['class_specifier', 'struct_specifier']),
  csharp: new Set(['class_declaration', 'struct_declaration', 'interface_declaration', 'record_declaration', 'record_struct_declaration', 'enum_declaration']),
  solidity: new Set(['contract_declaration', 'interface_declaration', 'library_declaration']),
};

const JS_FAMILY_LANGUAGES = new Set(['javascript', 'typescript', 'tsx']);

// Swift `class_declaration` covers five kinds; its `declaration_kind` field is
// the keyword leaf that says which.
const SWIFT_DECLARATION_KINDS = {
  class: 'class', struct: 'struct', enum: 'enum', extension: 'extension', actor: 'actor',
};

/**
 * The declaration kind of a type node whose grammar uses one node type for
 * several kinds, read from the node's own keyword leaf (never from text):
 *   - Kotlin `class_declaration` is class / `interface` / `enum class`
 *     (keyword leaves `interface`, `enum`); `object_declaration` and
 *     `companion_object` are objects.
 *   - Swift `class_declaration` is class / struct / enum / extension / actor
 *     (the `declaration_kind` field).
 * Every other language and node returns `type` unchanged, so their chunk and
 * entity kinds stay byte-identical.
 *
 * @param {object} node - tree-sitter declaration node
 * @param {string} languageId
 * @param {string} type - kind from NODE_TYPE_MAP / CAPTURE_TO_ENTITY_TYPE
 * @returns {string}
 */
export function refineDeclarationKind(node, languageId, type) {
  if (!node) return type;
  if (languageId === 'kotlin') {
    if (node.type === 'object_declaration' || node.type === 'companion_object') return 'object';
    if (node.type !== 'class_declaration') return type;
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c.isNamed) continue;
      if (c.type === 'interface') return 'interface';
      if (c.type === 'enum') return 'enum';
      if (c.type === 'class') return 'class';
    }
    return type;
  }
  if (languageId === 'swift' && node.type === 'class_declaration') {
    const keyword = node.childForFieldName?.('declaration_kind')?.type;
    return SWIFT_DECLARATION_KINDS[keyword] || type;
  }
  // C++ `R ns::f(...)`: the qualifier is a namespace when the same file opens it
  // (`namespace drogon {`) or imports it (`using namespace drogon;`). Then f is a free
  // function defined out of line, not a member of a class `ns`.
  if (languageId === 'cpp' && node.type === 'function_definition' && type === 'method') {
    const scope = cppDefinitionQualifier(node);
    // `Q::f` is a namespace function only when no class `Q` is declared in the file too.
    if (scope && cppFileNamespaces(node).has(scope) && !cppFileNamespaces(node, true).has(scope)) return 'function';
  }
  return type;
}

/** `Q` of a C++ definition `R Q::name(...)` (the innermost scope), or null. */
function cppDefinitionQualifier(node) {
  let decl = node.childForFieldName('declarator');
  while (decl && decl.type !== 'function_declarator') decl = decl.childForFieldName('declarator') || decl.namedChild(0);
  let q = decl?.childForFieldName('declarator');
  if (q?.type !== 'qualified_identifier') return null;
  let scope = null;
  while (q?.type === 'qualified_identifier') {
    scope = q.childForFieldName('scope');
    q = q.childForFieldName('name');
  }
  if (!scope) return null;
  return String(scope.text).split('::').pop().replace(/<.*$/, '') || null;
}

/**
 * Namespace names a C++ file opens (`namespace a::b {`) or imports (`using namespace a;`),
 * or with `types`, the class / struct names it declares.
 */
function cppFileNamespaces(node, types = false) {
  let root = node;
  while (root.parent) root = root.parent;
  const names = new Set();
  const visit = (n, depth) => {
    if (depth > 6) return;
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i);
      if (types && (c.type === 'class_specifier' || c.type === 'struct_specifier')) {
        const name = c.childForFieldName('name');
        if (name) names.add(String(name.text).replace(/<.*$/, ''));
      } else if (types && (c.type === 'template_declaration' || c.type === 'declaration' || c.type === 'type_definition')) {
        visit(c, depth + 1);
      } else if (c.type === 'namespace_definition') {
        const name = c.childForFieldName('name');
        if (name && !types) for (const part of String(name.text).split('::')) if (part) names.add(part);
        const body = c.childForFieldName('body');
        if (body) visit(body, depth + 1);
      } else if (!types && c.type === 'using_declaration' && /^using\s+namespace\b/.test(c.text)) {
        const last = String(c.text).replace(/^using\s+namespace\s+/, '').replace(/;\s*$/, '').split('::').pop().trim();
        if (last) names.add(last);
      } else if (c.type === 'preproc_ifdef' || c.type === 'preproc_if' || c.type === 'linkage_specification' || c.type === 'declaration_list') {
        visit(c, depth + 1);
      }
    }
  };
  visit(root, 0);
  return names;
}

// Swift compile-time conditional lines (`#if X`, `#elseif`, `#else`, `#endif`).
// The grammar cannot parse them inside a type body: the whole body (with every
// method in it) became one ERROR node, so GRDB's DatabaseObservationBroker
// vanished from the graph and its methods lost their parent in the chunker.
// GRDB: files with parse errors 61 -> 20 of 478, none worse.
const SWIFT_CONDITIONAL_DIRECTIVE_LINE = /^[ \t]*#(?:if|elseif|else|endif)\b[^\n]*/gm;

// C/C++ visibility macro between the class-key and the name:
// `class DROGON_EXPORT HttpRequest : public HttpMessage`, `class Q_CORE_EXPORT
// QObject`, `struct CV_EXPORTS Mat`. The grammar reads the macro as the class
// name, so drogon's HttpRequest became a one-line class `DROGON_EXPORT` and
// lost every method. Shape rule, not a macro list: an ALL-CAPS token followed
// by another identifier (not `final`) can only be a macro in valid C++.
// A node that belongs to the definition right below it: a comment or a Rust attribute.
const isDefinitionLead = (n) => /comment$/.test(n?.type || '') || n?.type === 'attribute_item';
// A file header comment: it documents the file, not the definition below it.
const FILE_HEADER_TAG = /@(?:license|file|fileoverview|module|copyright)\b|\bSPDX-License-Identifier\b/i;

const FUNCTION_BODY_NODES = new Set(['function_declaration', 'function_expression', 'arrow_function', 'method_definition', 'generator_function_declaration', 'generator_function']);
function hasFunctionAncestor(node) {
  for (let p = node.parent; p; p = p.parent) if (FUNCTION_BODY_NODES.has(p.type)) return true;
  return false;
}

// Owner of a member-assigned function: `res` for `res.x = f`, `Reply` for
// `Reply.prototype.x = f`; null for `module.exports.x` / `exports.x` (module functions).
function memberAssignmentOwner(node) {
  let obj = node.childForFieldName('left')?.childForFieldName('object');
  if (obj?.type === 'member_expression' && obj.childForFieldName('property')?.text === 'prototype') obj = obj.childForFieldName('object');
  const text = obj?.type === 'identifier' ? obj.text : (obj?.type === 'member_expression' ? obj.childForFieldName('property')?.text : null);
  return text && text !== 'exports' && text !== 'module' ? text : null;
}

// Languages whose grammar uses one node for functions and methods (see the kind refinement).
const METHOD_BY_CONTAINER_LANGUAGES = new Set(['python', 'swift', 'kotlin', 'rust']);

const KOTLIN_CTOR_ON_NEXT_LINE = /\bclass[ \t]+\w+(?:<[^>\n]*>)?((?:[ \t]*\n(?:[ \t]*@\w+(?:\([^)\n]*\))?)?)+[ \t]*(?:(?:private|internal|protected|public)[ \t]+)?constructor\b)/g;

function joinKotlinCtorHeaders(content) {
  let out = '';
  let from = 0;
  KOTLIN_CTOR_ON_NEXT_LINE.lastIndex = 0;
  for (let m = KOTLIN_CTOR_ON_NEXT_LINE.exec(content); m; m = KOTLIN_CTOR_ON_NEXT_LINE.exec(content)) {
    const gapStart = m.index + m[0].length - m[1].length;
    const brace = content.indexOf('{', m.index + m[0].length);
    if (brace === -1 || brace - m.index > 4000) continue;
    const gap = content.slice(gapStart, m.index + m[0].length);
    const newlines = (gap.match(/\n/g) || []).length;
    out += content.slice(from, gapStart) + gap.replace(/\n/g, ' ') + content.slice(m.index + m[0].length, brace + 1) + '\n'.repeat(newlines);
    from = brace + 1;
    KOTLIN_CTOR_ON_NEXT_LINE.lastIndex = brace + 1;
  }
  return from === 0 ? content : out + content.slice(from);
}

// Kotlin `fun interface Name` (after modifiers such as `public`), at a declaration start.
const KOTLIN_FUN_INTERFACE = /(^|[\s;{}])fun[ \t]+interface\b/gm;

//
// One ambiguous shape: `struct|union X y;` is either a forward declaration
// with a macro (`struct ABC_EXPORT Fwd;`) or a variable of an ALL-CAPS type
// (`struct HTTP_HEADER header;`). It is a macro when the file #defines X, or
// when y is capitalised like a type name (types are CamelCase, variables
// lower-case). `class X y;` is always a forward declaration.
const CPP_CLASS_KEY_MACRO = /\b(class|struct|union)([ \t]+)([A-Z][A-Z0-9_]+)(?=[ \t]+(?!final\b)([A-Za-z_]\w*)[ \t]*([:{;<]|final\b|$))/gm;
const CPP_DEFINED_MACRO = /^[ \t]*#[ \t]*define[ \t]+([A-Z][A-Z0-9_]+)\b/gm;

// Blank the macro with spaces (same length, so offsets and line numbers are
// unchanged). Applied in parse(), so the chunker, the incremental parser and
// the graph (extractSymbols) all see the same tree: before, the chunker kept
// the macro and labelled drogon's class `function: HttpViewData`, plus a
// phantom one-line chunk `class: DROGON_EXPORT`.
function blankCppClassKeyMacros(content, languageId) {
  if (languageId !== 'cpp' && languageId !== 'c') return content;
  let defined = null;
  const isDefined = (macro) => {
    defined ??= new Set(Array.from(content.matchAll(CPP_DEFINED_MACRO), m => m[1]));
    return defined.has(macro);
  };
  return content.replace(CPP_CLASS_KEY_MACRO, (m, key, gap, macro, ident, next) => {
    const isVariable = next === ';' && key !== 'class' && !/^[A-Z]/.test(ident) && !isDefined(macro);
    return isVariable ? m : key + gap + ' '.repeat(macro.length);
  });
}

// The text tree-sitter parses. Same length as the source, so offsets and line
// numbers are unchanged; chunk text is still sliced from the original source.
// parse() uses it, so the chunker, the incremental parser and the graph
// (extractSymbols) see the same tree.
// - Swift: each directive line becomes a line comment of the same length
//   (`#if X` -> `//f X`). Both branches stay visible as declarations, and the
//   comment is a tree node, so the directive text stays in a chunk (blank
//   lines fall between nodes and no chunk would hold them).
// - C/C++: the export macro after the class-key is blanked.
function sourceForParse(content, languageId) {
  if (languageId === 'swift' && content.includes('#')) {
    return content.replace(SWIFT_CONDITIONAL_DIRECTIVE_LINE, (line) => line.replace(/#./, '//'));
  }
  return blankCppClassKeyMacros(content, languageId);
}

// Namespace / module wrappers that recursiveChunk makes transparent: the body
// is chunked with the namespace as parent info, at any size. PHP's braced
// `namespace Foo { }` too; `namespace Foo;` (no body) and Rust `mod` (not a
// boundary) are left as they are.
const NAMESPACE_WRAPPER_TYPES = {
  cpp: new Set(['namespace_definition']),
  php: new Set(['namespace_definition']),
  csharp: new Set(['namespace_declaration', 'file_scoped_namespace_declaration']),
  ruby: new Set(['module']),
  typescript: new Set(['internal_module', 'module']),
  tsx: new Set(['internal_module', 'module']),
};
// TypeScript statements that hold a namespace: `export namespace X {}`,
// bare `namespace X {}`, `declare module 'x' {}`.
const NAMESPACE_STATEMENT_WRAPPERS = new Set(['export_statement', 'expression_statement', 'ambient_declaration']);
const NAMESPACE_BODY_TYPES = new Set(['declaration_list', 'compound_statement', 'statement_block', 'body_statement']);

// Declaration bodies, for _flattenDeclaration: BODY_TYPES plus Ruby's
// body_statement. A `statements` / `statement_list` child inside a body
// (Kotlin, Swift, older Go grammars) is spliced into its parent's children.
const DECLARATION_BODY_TYPES = new Set([...BODY_TYPES, 'body_statement']);
const BODY_FLATTEN_CONTAINERS = new Set(['statements', 'statement_list']);

// Source span of every emitted chunk (start/end index of its trimmed text),
// so an orphan tail can be merged as one source slice.
const CHUNK_SPANS = new WeakMap();

function countNewlines(text, from = 0, to = text.length) {
  let n = 0;
  for (let i = from; i < to; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

// A definition inside a function body (local helper, closure) or inside an
// anonymous class body is not a member of the outer type: stop the walk.
const CONTAINER_STOP_NODE_TYPES = new Set([
  'function_declaration', 'function_definition', 'function_item', 'method_definition',
  'method_declaration', 'constructor_declaration', 'init_declaration', 'deinit_declaration',
  'local_function_statement', 'generator_function_declaration', 'function_expression',
  'generator_function', 'arrow_function', 'lambda', 'lambda_expression', 'lambda_literal',
  'closure_expression', 'anonymous_function', 'method', 'singleton_method',
  'object_creation_expression', 'object_literal', 'anonymous_function_creation_expression',
  // Kotlin `constructor(...) { }` / `init { }` bodies and Swift computed
  // properties. The shipped Kotlin grammar also misparses
  // `class Builder constructor(...)` as a secondary constructor of the outer
  // class: stopping here yields no parent instead of the wrong outer one.
  'secondary_constructor', 'anonymous_initializer', 'computed_property',
]);

// Last identifier-like segment of a container name node: Swift
// `extension Foo.Bar` (user_type), Ruby `class A::B` (scope_resolution),
// C# `qualified_name`, Rust `impl<T> Foo<T>` / `impl a::Foo`.
function lastNameSegment(nameNode) {
  if (!nameNode) return null;
  if (IDENT_TYPES.has(nameNode.type)) return nameNode.text;
  const inner = nameNode.childForFieldName?.('name') || nameNode.childForFieldName?.('type');
  if (inner && inner.id !== nameNode.id) return lastNameSegment(inner);
  for (let i = nameNode.namedChildCount - 1; i >= 0; i--) {
    const child = nameNode.namedChild(i);
    if (IDENT_TYPES.has(child.type)) return child.text;
  }
  return null;
}

export class TreeSitterProvider {
  constructor(options = {}) {
    this.grammarsDir = options.grammarsDir || null;
    this._parser = null;
    this._languages = new Map();
    this._initPromise = null;
    this._available = null; // null = unknown, true/false after first check
    this._chunkCounter = 0; // per-parse chunk ID counter
    this._tagsQueryCache = new WeakMap(); // Language → compiled tags Query
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
    return this._parser.parse(sourceForParse(content, languageId));
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
      // Same text as parse() (Swift #if lines, C/C++ export macros). Doc
      // comments are read from the original source, so a Swift directive
      // (a comment in the parsed text) is never a doc comment.
      const source = content;
      content = sourceForParse(content, languageId);
      // Kotlin: the grammar has no `fun interface` (a SAM interface) and parses it as a
      // function named like the interface, so its members vanished (okhttp `Interceptor`:
      // `intercept` had no owner, `Chain` no parent). Blank `fun` (same length).
      if (languageId === 'kotlin' && content.includes('fun interface')) {
        content = content.replace(KOTLIN_FUN_INTERFACE, (m, lead) => `${lead}${' '.repeat(m.length - lead.length - 9)}interface`);
      }
      // Kotlin: a primary constructor on the lines after the class name (`class X\n
      // @JvmOverloads\n constructor(`) does not parse; the class became one line and its
      // members had no owner (okhttp HttpLoggingInterceptor.intercept). Join the header onto the
      // class line and give the removed newlines back right after the body's `{`, so every line
      // from the body on keeps its number.
      if (languageId === 'kotlin' && content.includes('constructor')) content = joinKotlinCtorHeaders(content);
      this._parser.setLanguage(language);
      tree = this._parser.parse(content);
      if (!tree) return null;

      // Compile the tags query once per grammar, not once per file: it cost
      // 7-32 ms per file (Swift 32, C# 11, TS 7) — most of the graph
      // extraction time. A Query is immutable and reusable across trees.
      query = this._tagsQueryCache.get(language);
      if (!query) {
        query = await this._createQuery(language, queryString);
        this._tagsQueryCache.set(language, query);
      }
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
        let extentNode = isLeafIdent && node.parent ? node.parent : node;
        let specKeyword = null;
        if (languageId === 'go' && GO_DECLARATION_SPECS[extentNode.type]) {
          const decl = extentNode.parent;
          let specs = 0;
          for (let i = 0; i < decl.namedChildCount; i++) {
            if (decl.namedChild(i).type === extentNode.type) specs++;
          }
          if (specs === 1) extentNode = decl;
          else specKeyword = GO_DECLARATION_SPECS[extentNode.type];
        }

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

        // Kotlin / Swift reuse one node type for several declaration kinds
        // (`interface Chain` is a Kotlin class_declaration); read the kind
        // from the node's keyword leaf. No-op for every other language.
        // C++ `R ns::f(` is a free function when `ns` is a namespace of the file.
        if (entityType === 'class' || entityType === 'object' || (languageId === 'cpp' && entityType === 'method')) {
          entityType = refineDeclarationKind(extentNode, languageId, entityType);
        }

        // Deduplicate: multiple captures can match the same declaration.
        // A Go spec can declare several names (`var a, b int`): one entity each.
        const isGoSpecName = languageId === 'go' && isLeafIdent
          && GO_DECLARATION_SPECS[node.parent?.type];
        // `var _ io.Writer = (*T)(nil)` is a compile-time assertion, not a name.
        if (isGoSpecName && node.text === '_') continue;
        // Go var/const and Rust const/static are state entities. When the
        // grammar fails inside one, error recovery can fold the next
        // declarations into its extent: urfave/cli `var NewStringMap =
        // NewMapBase[string, …]` swallowed the method below it. Such a state
        // entity is dropped; the file then keeps what it extracted before
        // state entities existed (see STATE_ONLY_FALLBACK_LANGUAGES).
        if (extentNode.hasError && STATE_CAPTURE_LANGUAGES.has(languageId)
          && STATE_ENTITY_TYPES.has(entityType)) continue;
        // OCaml: a structure inside an expression (`let module M = struct … end in`)
        // is local to it.
        if (languageId === 'ocaml' && hasAncestorType(node, /_expression$/)) continue;
        const key = isGoSpecName
          ? `${extentNode.startIndex}:${entityType}:${node.text}`
          : `${extentNode.startIndex}:${entityType}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const startLine = extentNode.startPosition.row;
        const endLine = extentNode.endPosition.row;

        // Build signature from the extent node's first line
        const nodeText = content.substring(extentNode.startIndex, extentNode.endIndex);
        const extentFirstLine = nodeText.split('\n')[0].trim();
        const firstLine = specKeyword ? `${specKeyword} ${extentFirstLine}` : extentFirstLine;
        const signature = firstLine.length > 120
          ? firstLine.substring(0, 117) + '...'
          : firstLine;

        // Graph-only naming of scoped declarations (the chunker keeps its own
        // names): Ruby `class Foo::Bar` → Bar; Rust `impl a::Foo` /
        // `impl<T> a::Foo<T>` → Foo (not the trait in `impl Trait for a::Foo`).
        let scopedName = null;
        if (!isLeafIdent && languageId === 'ruby'
          && node.childForFieldName?.('name')?.type === 'scope_resolution') {
          scopedName = lastNameSegment(node.childForFieldName('name'));
        } else if (!isLeafIdent && node.type === 'companion_object') {
          // Kotlin `companion object Factory { }` / unnamed → `Companion`
          // (the language's implicit name). Not a container: its members
          // keep the outer class as parent, matching `Outer.member()` calls.
          scopedName = node.namedChildren.find(c => c.type === 'type_identifier')?.text || 'Companion';
        } else if (!isLeafIdent && node.type === 'assignment_expression') {
          // Inside a function body it is a callback (`xhr.onload = function`), not a definition.
          if (hasFunctionAncestor(node)) continue;
          const left = node.childForFieldName('left');
          const prop = left?.childForFieldName('property')?.text || null;
          // `module.exports = function createApp`: the function's own name, or no entity.
          if (prop === 'exports' && left?.childForFieldName('object')?.text === 'module') {
            scopedName = node.childForFieldName('right')?.childForFieldName('name')?.text || null;
            if (!scopedName) continue;
          } else {
            scopedName = prop;
          }
        } else if (!isLeafIdent && node.type === 'qualified_name') {
          // C# `namespace Ocelot.DownstreamUrlCreator;`: the dotted name as written. The
          // `name` field gave one segment, a different one by depth (`Ocelot` for two
          // segments, `Balancers` for three).
          scopedName = node.text.replace(/\s+/g, '');
        } else if (!isLeafIdent && node.type === 'impl_item') {
          const implType = node.childForFieldName('type');
          if (implType?.type === 'scoped_type_identifier' || implType?.type === 'generic_type') {
            scopedName = lastNameSegment(implType);
          }
        }
        const symbolName = isLeafIdent
          ? node.text
          : (scopedName
            || node.childForFieldName?.('name')?.text
            || (C_FAMILY_LANGUAGES.has(languageId) ? this._cFunctionDefinitionName(node) : null)
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

        let parentClass = this._containerName(extentNode, languageId);
        // `obj.name = function` / `Cls.prototype.name = function`: owned by the object.
        if (!parentClass && node.type === 'assignment_expression') {
          parentClass = memberAssignmentOwner(node);
          if (!parentClass) entityType = 'function'; // `module.exports.f = ...`: a module function
        }
        // Python, Swift and Kotlin have one node for both: a `def` / `func` / `fun` whose
        // container is a type is a method (tortoise `Model.bulk_create`, grdb
        // `Database.openConnection`, okhttp `intercept` printed as `function`). A function nested
        // in a function has no container (CONTAINER_STOP_NODE_TYPES), so it stays a function.
        if (METHOD_BY_CONTAINER_LANGUAGES.has(languageId) && entityType === 'function' && parentClass) entityType = 'method';
        // A Python `decorated_definition` entity spans the decorated def; the
        // docstring documents that def's own entity, not the decorator
        // (flask: 96 of 415 docs were such duplicates).
        const docComment = entityType === 'decorator'
          ? null
          : extractTreeSitterDocComment(extentNode, source, languageId);
        symbols.push({
          name: symbolName,
          type: entityType,
          startLine,
          endLine,
          signature,
          ...(parentClass ? { parentClass } : {}),
          ...(docComment ? { docComment } : {}),
        });
      }

      symbols.hasParseError = tree.rootNode.hasError;
      const callQueryString = AST_CALL_QUERIES[languageId];
      if (callQueryString) {
        this._callQueryCache ||= new WeakMap();
        let callQuery = this._callQueryCache.get(language);
        if (!callQuery) {
          callQuery = await this._createQuery(language, callQueryString);
          this._callQueryCache.set(language, callQuery);
        }
        symbols.calls = callQuery.captures(tree.rootNode)
          .map(({ node }) => ({ node, line: node.startPosition.row + 1, name: node.text.replace(/\s+/g, '') }))
          // A parameter or local binding of that name is no call of a definition
          // (`let apply f v = f v` calls its argument, not a top-level `f`).
          .filter(({ node, name }) => name.includes('.') || !ocamlLocallyBound(node, name))
          .map(({ line, name }) => ({ line, name }));
      }
      return symbols;
    } catch {
      return null;
    } finally {
      // The tags query is cached per grammar (see above) and stays alive.
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
    // Read by _resolveBoundary (refineDeclarationKind); recursiveChunk is
    // synchronous, so no other parse can interleave.
    this._chunkLanguageId = languageId;
    let chunks;
    try {
      chunks = this.recursiveChunk(children, content, maxChunkSize, null, boundaryTypes, {
        languageId,
        parsedContent: sourceForParse(content, languageId),
      });
    } finally {
      this._chunkLanguageId = null;
    }
    // Text is never dropped: what no chunk took (a file holding only
    // `import Foundation`) is a chunk of its own.
    if (chunks.leftover?.length) {
      const nodes = chunks.leftover;
      const span = this._sourceSpan(content, nodes[0].startIndex, nodes[nodes.length - 1].endIndex, nodes[0].startPosition.row);
      if (span.text) {
        this._pushChunk(chunks, span, {
          chunkId: this._nextChunkId(), parentChunkId: null, parentSymbol: null, parentType: null,
          parentPath: null, type: 'code', name: null, signature: null,
        });
      }
    }
    delete chunks.leftover;

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
   * @param {object} [ctx]
   * @param {string} [ctx.languageId] - Enables the per-language namespace /
   *   module transparency (NAMESPACE_WRAPPER_TYPES).
   * @param {{name: string, type: string, next: number}} [ctx.partOf] - The
   *   oversized named declaration whose body is being chunked. A body chunk
   *   with no declaration of its own is named after it: `Foo (part 2)`.
   * @param {string} [ctx.parsedContent] - The text tree-sitter parsed (C/C++
   *   export macros blanked); defaults to `content`.
   * @returns {Array} List of chunk objects
   */
  recursiveChunk(nodes, content, maxSize, parentInfo, boundaryTypes = BOUNDARY_TYPES, ctx = {}) {
    const chunks = [];
    let buffer = [];
    const languageId = ctx.languageId || null;
    const partOf = ctx.partOf || null;
    // JS/TS `export [default] class Foo {}` (also function, interface, enum,
    // type alias): the export_statement is replaced by its parts, so the
    // declaration is the boundary and names the chunk. The `export` keyword
    // is an opening token that starts the declaration's chunk. Before, an
    // exported class was a `code` chunk with no name, and an oversized one
    // put its members under a parent named `unknown`.
    if (JS_FAMILY_LANGUAGES.has(languageId)) {
      nodes = nodes.flatMap(n => this._exportedDeclarationParts(n, languageId, boundaryTypes) || [n]);
    }
    // Every chunk's text is ONE source slice (first node start to last node
    // end), trimmed; its lines are counted from that slice.
    const spanOf = (first, last) => this._sourceSpan(
      content, first.startIndex, last.endIndex, first.startPosition.row);
    // Anonymous keyword leaves share type names with declarations in some
    // grammars (tree-sitter-ruby's `module` / `class` keywords, the `class`
    // keyword inside a JS/C#/C++ class): only named nodes are declarations.
    const isBoundaryNode = n => n.isNamed && boundaryTypes.has(n.type);
    // A pending buffer of opening tokens (`module Sequel`, `def foo(a)`,
    // `export`) — 30 chars or fewer, no declaration — is too small to be a
    // chunk. It is carried into the next oversized node or namespace
    // instead of being dropped, so it starts that node's first chunk.
    // Tokens that end the previous chunk's last line (`};`, `}  // namespace
    // x`) are not carried: they join that chunk as an orphan tail.
    const takeCarry = () => {
      if (buffer.length === 0 || buffer.some(isBoundaryNode)) return [];
      const prev = chunks[chunks.length - 1];
      if (prev && buffer[0].startPosition.row <= prev.endLine) return [];
      if (spanOf(buffer[0], buffer[buffer.length - 1]).text.length > 30) return [];
      const carry = buffer;
      buffer = [];
      return carry;
    };
    const takePartName = () => {
      if (!partOf) return null;
      const n = partOf.next++;
      return n === 1 ? partOf.name : `${partOf.name} (part ${n})`;
    };
    // Parent fields of every chunk at this level. parentPath is the whole
    // declaration path (`class:A/method:run`), so two same-named methods in
    // different classes keep distinct chunk identities.
    const parentFields = () => ({
      parentChunkId: parentInfo?.chunkId || null,
      parentSymbol: parentInfo?.name || null,
      parentType: parentInfo?.type || null,
      parentPath: parentInfo?.path || null,
    });
    const childPath = (type, name) => `${parentInfo?.path ? parentInfo.path + '/' : ''}${type}:${name}`;
    // Declaration names of `nodes` (template / decorator wrappers resolved).
    const declNames = nodes => nodes.filter(isBoundaryNode).map(n => this._declarationName(n)).filter(Boolean);
    const addNames = (chunk, names) => {
      const extra = names.filter(n => n !== chunk.name && !(chunk.additionalSymbols || []).includes(n));
      if (extra.length > 0) chunk.additionalSymbols = [...(chunk.additionalSymbols || []), ...extra];
    };
    // Text is never dropped. A buffer too small to be a chunk (30 chars or
    // fewer) with no declaration waits in `pending` and opens the next chunk
    // of this level; at the end of the level it joins the previous chunk,
    // or goes up to the parent level as `chunks.leftover`.
    let pending = [];
    const takePending = () => { const p = pending; pending = []; return p; };
    // Merge nodes into the last chunk of this level as one source slice.
    const mergeIntoPrev = (mergeNodes) => {
      const prev = chunks[chunks.length - 1];
      const prevSpan = prev ? CHUNK_SPANS.get(prev) : null;
      if (!prevSpan || mergeNodes.length === 0) return false;
      const last = mergeNodes[mergeNodes.length - 1];
      if (prevSpan.startIndex >= last.endIndex) return false;
      const merged = this._sourceSpan(content, prevSpan.startIndex, Math.max(prevSpan.endIndex, last.endIndex), prev.startLine);
      if (merged.text.length > maxSize * TAIL_MERGE_HEADROOM) return false;
      prev.text = merged.text;
      prev.endLine = merged.endLine;
      CHUNK_SPANS.set(prev, merged);
      addNames(prev, declNames(mergeNodes));
      return true;
    };
    // A sub-level's leftover: join this level's previous chunk, else wait.
    const absorbLeftover = (sub) => {
      if (!sub.leftover || sub.leftover.length === 0) return;
      if (!mergeIntoPrev(sub.leftover)) pending = [...pending, ...sub.leftover];
    };

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
      if (pending.length > 0 && buffer.length > 0) buffer = [...takePending(), ...buffer];
      if (buffer.length === 0) return;
      const span = spanOf(buffer[0], buffer[buffer.length - 1]);
      const text = span.text;
      if (text.length === 0) { buffer = []; return; }
      // A buffer of 30 chars or fewer is not a chunk of its own. Tokens
      // that end the previous chunk's last line (`};`) and small
      // declarations (`function empty() {}`) join the previous chunk (the
      // declaration's name goes to its additionalSymbols); a small
      // declaration with no previous chunk is a chunk of its own. Anything
      // else waits in `pending` for the next chunk.
      if (text.length <= 30) {
        const prev = chunks[chunks.length - 1];
        const hasDecl = buffer.some(isBoundaryNode);
        const onPrevLine = prev && span.startLine <= prev.endLine;
        if ((hasDecl || onPrevLine) && mergeIntoPrev(buffer)) {
          buffer = [];
          return;
        }
        if (!hasDecl) {
          pending = buffer;
          buffer = [];
          return;
        }
      }
      {
        const boundariesInBuffer = buffer.filter(isBoundaryNode);

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
          // A section of 30 chars or fewer joins the next section (the
          // last one joins the previous section) instead of being dropped.
          const sections = [];
          let sectionStart = 0;
          for (let i = 0; i < boundariesInBuffer.length; i++) {
            const b = boundariesInBuffer[i];
            const bIdx = buffer.indexOf(b);
            // Last section absorbs trailing non-boundary nodes after `b`.
            const isLast = i === boundariesInBuffer.length - 1;
            const sectionEnd = isLast ? buffer.length - 1 : bIdx;
            const small = spanOf(buffer[sectionStart], buffer[sectionEnd]).text.length <= 30;
            if (small && !isLast) continue;
            if (small && isLast && sections.length > 0) {
              sections[sections.length - 1].end = sectionEnd;
              sections[sections.length - 1].extra.push(b);
            } else {
              sections.push({ start: sectionStart, end: sectionEnd, b, extra: [] });
            }
            sectionStart = bIdx + 1;
          }
          for (const sec of sections) {
            const section = buffer.slice(sec.start, sec.end + 1);
            const sectionSpan = spanOf(section[0], section[section.length - 1]);
            const resolved = this._resolveBoundary(sec.b);
            const secName = this._extractNodeName(resolved.nameNode);
            const others = declNames(section.filter(n => n !== sec.b)).filter(n => n !== secName);
            this._pushChunk(chunks, sectionSpan, {
              chunkId: this._nextChunkId(),
              ...parentFields(),
              type: resolved.type,
              name: secName,
              signature: this._extractSignature(sec.b, content, boundaryTypes),
              additionalSymbols: others.length > 0 ? others : null,
            });
          }
          buffer = [];
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
          const sibNames = declNames(boundariesInBuffer.slice(1)).filter(n => n !== name);
          if (sibNames.length > 0) additionalSymbols = [...new Set(sibNames)];
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
        //
        // The merged text is one source slice from the previous chunk's
        // start to the tail's end, so whatever sits between them (a closing
        // brace, blank lines) is kept as in the file.
        const prev = chunks[chunks.length - 1];
        const prevSpan = prev ? CHUNK_SPANS.get(prev) : null;
        const isOrphanTail = !firstBoundary
          && text.length < SMALL_TAIL_THRESHOLD;
        const linesGap = prev ? span.startLine - prev.endLine : Infinity;
        const isSpatiallyClose = linesGap >= 0 && linesGap <= 5;
        const mergedSpan = prevSpan && prevSpan.startIndex < span.startIndex
          ? this._sourceSpan(content, prevSpan.startIndex, span.endIndex, prev.startLine)
          : null;
        const fitsHeadroom = !!mergedSpan
          && mergedSpan.text.length <= maxSize * TAIL_MERGE_HEADROOM;

        if (isOrphanTail && prev && isSpatiallyClose && fitsHeadroom) {
          prev.text = mergedSpan.text;
          prev.endLine = mergedSpan.endLine;
          CHUNK_SPANS.set(prev, mergedSpan);
        } else {
          let partSignature = null;
          if (!firstBoundary && partOf) {
            name = takePartName();
            type = partOf.type;
            partSignature = partOf.signature;
          }
          this._pushChunk(chunks, span, {
            chunkId: this._nextChunkId(),
            ...parentFields(),
            type,
            name,
            signature: signature || partSignature,
            additionalSymbols,
          });
        }
      }
      buffer = [];
    };

    for (const node of nodes) {
      // Namespace / module wrappers (C++ `namespace`, C# `namespace`, Ruby
      // `module`, TypeScript `namespace`) are transparent at ANY size: their
      // body is chunked with the namespace as parent info, as for class
      // bodies. A namespace-labelled chunk would otherwise wrap (and hide)
      // the class inside it — drogon `HttpViewData.h:29 — drogon (namespace)`.
      const ns = languageId && node.isNamed ? this._namespaceBody(node, languageId) : null;
      if (ns) {
        const carry = takeCarry();
        flushBuffer();
        const nsParent = ns.name
          ? { chunkId: this._nextChunkId(), name: ns.name, type: ns.type, path: childPath(ns.type, ns.name) }
          : parentInfo;
        const sub = this.recursiveChunk(
          [...takePending(), ...carry, ...ns.nodes], content, maxSize, nsParent, boundaryTypes, { ...ctx, partOf });
        chunks.push(...sub);
        absorbLeftover(sub);
        continue;
      }

      const nodeSize = node.endIndex - node.startIndex;
      // The chunk text is the source slice from the buffer's first node to
      // this node's end, so the size that counts includes the whitespace
      // between siblings (indentation, blank lines).
      const sliceSize = buffer.length > 0 ? node.endIndex - buffer[0].startIndex : nodeSize;

      if (sliceSize <= maxSize) {
        // Fits in current buffer — accumulate
        buffer.push(node);
        continue;
      }

      // A node whose children do not cover its text (a Rust string literal:
      // the content between the quotes is no child node) cannot be split
      // by its children without losing that text: it is a leaf here.
      const isLeaf = node.childCount === 0 || !this._childrenCoverText(node, ctx.parsedContent ?? content);
      if (nodeSize <= maxSize || isLeaf) {
        // Doesn't fit — flush buffer first. The doc comment directly above
        // the node moves with it into the new buffer, so a full buffer does
        // not cut a comment off from its declaration.
        let leading = this._takeLeadingComments(buffer, node, content, { isDeclaration: isBoundaryNode });
        if (leading.length > 0 && (nodeSize > maxSize || node.endIndex - leading[0].startIndex > maxSize)) {
          // The doc comment does not fit with the node: keep only the tokens
          // on the node's own first line (`export`, modifiers), so that line
          // is not split between two chunks.
          const row = node.startPosition.row;
          leading = nodeSize > maxSize ? [] : leading.filter(n => n.startPosition.row >= row);
          if (leading.length > 0 && node.endIndex - leading[0].startIndex > maxSize) leading = [];
        }
        if (leading.length > 0) buffer = buffer.slice(0, buffer.length - leading.length);
        const carry = takeCarry();
        flushBuffer();
        if (nodeSize <= maxSize) {
          // Node fits alone — start new buffer. The waiting tokens open it
          // when the slice stays within the cap; else they are a chunk of
          // their own (never dropped).
          const opening = [...takePending(), ...carry];
          const first = opening[0] || leading[0] || node;
          if (opening.length > 0 && node.endIndex - first.startIndex > maxSize) {
            const openingSpan = spanOf(opening[0], opening[opening.length - 1]);
            if (!mergeIntoPrev(opening) && openingSpan.text) {
              // Inside a declaration with no header chunk (`interface Chain {` too short to
              // stand alone), the opening tokens are its first part: named and typed after it.
              const partName = takePartName();
              this._pushChunk(chunks, openingSpan, {
                chunkId: this._nextChunkId(), ...parentFields(),
                type: partName ? partOf.type : 'code', name: partName, signature: partName ? partOf.signature : null,
              });
            }
            buffer = [...leading, node];
          } else {
            buffer = [...opening, ...leading, node];
          }
        } else {
          // Leaf node too big — emit as-is (never split mid-expression)
          const resolved = this._resolveBoundary(node);
          let name = this._extractNodeName(resolved.nameNode);
          let type = resolved.type;
          let signature = this._extractSignature(node, content, boundaryTypes);
          if (!name && partOf) {
            name = takePartName();
            type = partOf.type;
            signature = partOf.signature;
          }
          const first = [...takePending(), ...carry, ...leading][0] || node;
          this._pushChunk(chunks, spanOf(first, node), {
            chunkId: this._nextChunkId(),
            ...parentFields(),
            type,
            name,
            signature,
          });
        }
        continue;
      }

      // Node is oversized even alone — recurse into its children.
      // A Python decorated_definition is named after the definition it wraps
      // (its decorators then open that definition's header chunk).
      const decorated = node.type === 'decorated_definition'
        ? node.childForFieldName?.('definition') : null;
      const resolved = decorated
        ? { type: NODE_TYPE_MAP[decorated.type] || 'code', nameNode: decorated }
        : this._resolveBoundary(node);
      const name = this._extractNodeName(resolved.nameNode);
      const type = resolved.type;

      // Header chunk for oversized BOUNDARY nodes (large classes,
      // structs, traits, functions, etc.): emit a "header" chunk before
      // recursing into the body. Without this, queries that match
      // the boundary's name itself (rather than any inner member)
      // have NO chunk anchored on the boundary — only sub-chunks
      // with parent_symbol context. Empirically (kotlin JobSupport,
      // 1582-line `open class JobSupport`), this left class-targeted
      // queries to lose to inner method chunks.
      //
      // The header holds the leading doc comment, the whole declaration
      // up to the body (signature, decorators, template header), and the
      // first body children that fit in HEADER_MAX_CHARS. The body
      // recursion starts at the first child the header did not take, so
      // no line is indexed twice and no one-token-per-line signature
      // chunk (`func\nToExportKvList\n(pk …)`) is emitted.
      //
      // Gating: only when the node is a BOUNDARY_TYPES AND has a name.
      // Top-level Ruby method nodes are excluded because those
      // unscoped `def` snippets are normalized to anonymous code chunks
      // by ASTChunker. Parent-scoped Ruby methods still get header
      // chunks when oversized.
      const isRubyMethodHeader = parentInfo == null
        && (node.type === 'method' || node.type === 'singleton_method');
      const isBoundary = isBoundaryNode(node);
      const isNamedBoundary = isBoundary && !!name;
      // A declaration recurses into [signature tokens, body children,
      // closing tokens], so the signature joins the first body chunk.
      const decl = isBoundary ? this._flattenDeclaration(node) : null;
      let rest = decl ? decl.nodes : this._getChildren(node);
      let headerEmitted = false;
      // The doc comment directly above the node, plus any tiny buffer of
      // opening tokens before it (`class Big {`), go with the node.
      const docComment = this._takeLeadingComments(buffer, node, content, { isDeclaration: isBoundaryNode });
      if (docComment.length > 0) buffer = buffer.slice(0, buffer.length - docComment.length);
      const carryTail = [...takeCarry(), ...docComment];
      flushBuffer();
      const carry = [...takePending(), ...carryTail];
      let headerNames = [];
      const signatureOfNode = isNamedBoundary ? this._extractSignature(node, content, boundaryTypes) : null;
      if (isNamedBoundary && !isRubyMethodHeader) {
        const leading = carry;
        const startNode = leading[0] || node;
        const HEADER_MAX_CHARS = Math.min(600, maxSize);
        let take = decl.prefixCount;
        let endNode = take > 0 ? decl.nodes[take - 1] : null;
        if (endNode && endNode.endIndex - startNode.startIndex > maxSize) {
          take = 0;
          endNode = null;
        } else {
          while (take < decl.nodes.length
            && decl.nodes[take].endIndex - startNode.startIndex <= HEADER_MAX_CHARS) {
            endNode = decl.nodes[take];
            take++;
          }
          // Tokens on the header's last line (the body's `{` after a long
          // signature) end the header, so no line is split between chunks.
          // Whitespace tokens (tree-sitter-go's newline statement
          // terminator ends on the next row) neither end nor extend a line.
          const isBlankToken = n => !n.isNamed && content.substring(n.startIndex, n.endIndex).trim() === '';
          const lastRealRow = () => {
            for (let k = take - 1; k >= 0; k--) {
              if (!isBlankToken(decl.nodes[k])) return decl.nodes[k].endPosition.row;
            }
            return endNode.endPosition.row;
          };
          while (endNode && take < decl.nodes.length) {
            let next = take;
            while (next < decl.nodes.length && isBlankToken(decl.nodes[next])) next++;
            if (next >= decl.nodes.length
              || decl.nodes[next].startPosition.row !== lastRealRow()
              || decl.nodes[next].endIndex - startNode.startIndex > maxSize) break;
            endNode = decl.nodes[next];
            take = next + 1;
          }
          // A doc comment at the end of the header belongs to the member
          // after it (the first one the header did not take).
          if (take > decl.prefixCount && take < decl.nodes.length) {
            const tail = this._takeLeadingComments(
              decl.nodes.slice(decl.prefixCount, take), decl.nodes[take], content, { sameLine: false });
            if (tail.length > 0) {
              take -= tail.length;
              endNode = take > 0 ? decl.nodes[take - 1] : null;
            }
          }
        }
        // A header of 30 chars or fewer (`class A:`) takes the next
        // members too, up to the chunk cap, so the class still gets a
        // class-typed chunk of its own.
        while (endNode && take < decl.nodes.length
          && spanOf(startNode, endNode).text.length <= 30
          && !/comment$/.test(decl.nodes[take].type)
          && decl.nodes[take].endIndex - startNode.startIndex <= maxSize) {
          endNode = decl.nodes[take];
          take++;
        }
        const headerSpan = endNode ? spanOf(startNode, endNode) : null;
        if (headerSpan && headerSpan.text.length > 30) {
          // Members the header holds whole stay findable by name.
          headerNames = declNames(decl.nodes.slice(decl.prefixCount, take)).filter(n => n !== name);
          this._pushChunk(chunks, headerSpan, {
            chunkId: this._nextChunkId(),
            ...parentFields(),
            type,
            name,
            signature: signatureOfNode,
            additionalSymbols: headerNames.length > 0 ? [...new Set(headerNames)] : null,
          });
          headerEmitted = true;
          rest = decl.nodes.slice(take);
        } else {
          // No header: the doc comment and the declaration flow into the
          // body chunks instead.
          rest = [...leading, ...decl.nodes];
        }
      } else {
        rest = [...carry, ...rest];
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
      if (!name && (!isBoundary || isNamelessRubySingleton) && parentInfo) {
        subParent = parentInfo;
      } else {
        const parentId = this._nextChunkId();
        subParent = { chunkId: parentId, name: name || 'unknown', type, path: childPath(type, name || 'unknown') };
      }

      // A body chunk with no declaration of its own carries the enclosing
      // declaration's name: `ToExportKvList (part 2)` (the header is part 1).
      // A top-level Ruby method stays anonymous, as for its header above.
      const subPartOf = isNamedBoundary && !isRubyMethodHeader
        ? { name, type, signature: signatureOfNode, next: headerEmitted ? 2 : 1 }
        : partOf;

      const subChunks = this.recursiveChunk(
        rest,
        content,
        maxSize,
        subParent,
        boundaryTypes,
        { ...ctx, partOf: subPartOf }
      );
      // No header of its own (the opening line was too small and the first
      // member too large): the chunk that starts with the declaration's
      // opening line names it too.
      if (isNamedBoundary && !headerEmitted && subChunks.length > 0) addNames(subChunks[0], [name]);
      chunks.push(...subChunks);
      absorbLeftover(subChunks);
    }

    flushBuffer();
    if (pending.length > 0 && !mergeIntoPrev(pending)) chunks.leftover = takePending();
    return chunks;
  }

  /**
   * Trimmed source slice [startIndex, endIndex) with its own line numbers:
   * startLine is the row of the first non-blank character, endLine the row
   * of the last one, so `endLine - startLine + 1` equals the text's line
   * count.
   */
  _sourceSpan(content, startIndex, endIndex, startRow) {
    const raw = content.substring(startIndex, endIndex);
    const text = raw.trim();
    const lead = text ? raw.length - raw.trimStart().length : 0;
    const startLine = startRow + countNewlines(raw, 0, lead);
    return {
      text,
      startLine,
      endLine: startLine + countNewlines(text),
      startIndex: startIndex + lead,
      endIndex: startIndex + lead + text.length,
    };
  }

  /**
   * The children of a JS/TS `export_statement` that holds a declaration of a
   * boundary type, or null (no export, a namespace, `export const`,
   * `export { a }`).
   */
  _exportedDeclarationParts(node, languageId, boundaryTypes) {
    if (node.type !== 'export_statement') return null;
    const decl = node.childForFieldName?.('declaration');
    if (!decl || !boundaryTypes.has(decl.type)) return null;
    if (this._namespaceBody(node, languageId)) return null;
    return this._getChildren(node);
  }

  /** Name of a declaration node; template / decorator wrappers resolved. */
  _declarationName(node) {
    const inner = node.type === 'decorated_definition' ? node.childForFieldName?.('definition') : null;
    return this._extractNodeName(inner || this._resolveBoundary(node).nameNode) || null;
  }

  /** True when only whitespace lies between `node`'s children (and its edges). */
  _childrenCoverText(node, content) {
    let pos = node.startIndex;
    for (let i = 0; i <= node.childCount; i++) {
      const next = i < node.childCount ? node.child(i).startIndex : node.endIndex;
      if (next > pos && content.substring(pos, next).trim() !== '') return false;
      if (i < node.childCount) pos = Math.max(pos, node.child(i).endIndex);
    }
    return true;
  }

  /** Push a chunk built from a source span; remember the span. */
  _pushChunk(chunks, span, fields) {
    const chunk = { ...fields, text: span.text, startLine: span.startLine, endLine: span.endLine };
    CHUNK_SPANS.set(chunk, span);
    chunks.push(chunk);
    return chunk;
  }

  /**
   * The tail of the sibling buffer that belongs to `node`: the tokens before
   * it on its own first line (`export const x =`, modifiers), unless
   * `sameLine` is false or the token is a declaration, then the doc comment
   * directly above it — comment nodes (and whitespace tokens) with no blank
   * line between them and the node. A trailing comment on a code line is
   * not taken. Returns the tail of `buffer` to move with the node.
   */
  _takeLeadingComments(buffer, node, content, { sameLine = true, isDeclaration = () => false } = {}) {
    let nextRow = node.startPosition.row;
    let first = -1;
    let i = buffer.length - 1;
    if (sameLine) {
      while (i >= 0 && buffer[i].startPosition.row === node.startPosition.row && !isDeclaration(buffer[i])) {
        first = i;
        i--;
      }
    }
    for (; i >= 0; i--) {
      const n = buffer[i];
      if (!n.isNamed && content.substring(n.startIndex, n.endIndex).trim() === '') continue;
      // A comment or a Rust attribute documents the definition below it.
      if (!isDefinitionLead(n)) break;
      // A file header (first line, or a license / module comment) documents the file.
      if (n.startPosition.row === 0 || FILE_HEADER_TAG.test(content.substring(n.startIndex, n.endIndex))) break;
      const endRow = n.endPosition.column === 0 && n.endPosition.row > n.startPosition.row
        ? n.endPosition.row - 1
        : n.endPosition.row;
      // Directly above, or (a `/**` / `///` doc block) one blank line above: express puts
      // a blank line between each JSDoc block and its `app.use = function`.
      // A `/***` or `////` banner is not a doc block.
      const docStyle = /^\s*(?:\/\*\*(?!\*)|\/\/\/(?!\/))/.test(content.substring(n.startIndex, n.startIndex + 5));
      if (nextRow - endRow > (docStyle ? 2 : 1)) break;
      const before = buffer[i - 1];
      if (before && before.endPosition.row === n.startPosition.row
        && content.substring(before.startIndex, before.endIndex).trim() !== '') break;
      first = i;
      nextRow = n.startPosition.row;
    }
    return first >= 0 ? buffer.slice(first) : [];
  }

  /**
   * Children of an oversized declaration as one flat sequence: the tokens
   * before the body (signature, decorators, template header), the body's
   * children, then the closing tokens. `prefixCount` is the number of
   * tokens before the body. Wrappers (Python decorated_definition, C++
   * template_declaration, Go type_spec → struct_type) are walked through
   * via the child that holds most of the node.
   */
  _flattenDeclaration(node) {
    const before = [];
    const after = [];
    const size = n => n.endIndex - n.startIndex;
    const same = (a, b) => a && b && a.startIndex === b.startIndex
      && a.endIndex === b.endIndex && a.type === b.type;
    let cur = node;
    for (let depth = 0; depth < 6; depth++) {
      const kids = this._getChildren(cur);
      const bodyField = cur.childForFieldName?.('body');
      let bi = bodyField && bodyField.childCount > 0 ? kids.findIndex(k => same(k, bodyField)) : -1;
      if (bi < 0) bi = kids.findIndex(k => DECLARATION_BODY_TYPES.has(k.type) && k.childCount > 0);
      const isBody = bi >= 0;
      if (!isBody) {
        let largest = -1;
        for (let i = 0; i < kids.length; i++) {
          if (largest < 0 || size(kids[i]) > size(kids[largest])) largest = i;
        }
        if (largest >= 0 && kids[largest].childCount > 0 && size(kids[largest]) * 2 > size(cur)) {
          bi = largest;
        }
      }
      if (bi < 0) break;
      before.push(...kids.slice(0, bi));
      after.unshift(...kids.slice(bi + 1));
      cur = kids[bi];
      if (isBody) {
        const inner = [];
        for (const k of this._getChildren(cur)) {
          if (BODY_FLATTEN_CONTAINERS.has(k.type) && k.childCount > 0) inner.push(...this._getChildren(k));
          else inner.push(k);
        }
        return { nodes: [...before, ...inner, ...after], prefixCount: before.length };
      }
    }
    if (cur === node) return { nodes: this._getChildren(node), prefixCount: 0 };
    return { nodes: [...before, ...this._getChildren(cur), ...after], prefixCount: before.length };
  }

  /**
   * If `node` is a namespace / module wrapper for this language (see
   * NAMESPACE_WRAPPER_TYPES), return its name, chunk type and the flat
   * sequence [opening tokens, body children, closing tokens]; else null.
   */
  _namespaceBody(node, languageId) {
    const types = NAMESPACE_WRAPPER_TYPES[languageId];
    if (!types) return null;
    const before = [];
    const after = [];
    let ns = node;
    if (!types.has(node.type)) {
      if (!NAMESPACE_STATEMENT_WRAPPERS.has(node.type)) return null;
      const kids = this._getChildren(node);
      const i = kids.findIndex(k => types.has(k.type));
      if (i < 0) return null;
      before.push(...kids.slice(0, i));
      after.push(...kids.slice(i + 1));
      ns = kids[i];
    }
    const kids = this._getChildren(ns);
    const bi = kids.findIndex(k => NAMESPACE_BODY_TYPES.has(k.type));
    let inner;
    if (bi >= 0) {
      before.push(...kids.slice(0, bi));
      inner = this._getChildren(kids[bi]);
      after.unshift(...kids.slice(bi + 1));
    } else if (ns.type === 'file_scoped_namespace_declaration' || (ns.type === 'module' && languageId === 'ruby')) {
      // C# `namespace App;` holds the declarations directly; an empty Ruby
      // module has no body_statement.
      inner = kids;
    } else {
      return null;
    }
    let name = ns.childForFieldName?.('name')?.text || null;
    if (!name) name = this._extractNodeName(ns) || null;
    if (name) name = name.replace(/^['"`]|['"`]$/g, '');
    return {
      name,
      type: NODE_TYPE_MAP[ns.type] || 'namespace',
      nodes: [...before, ...inner, ...after],
    };
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

  /**
   * Resolve the leaf name of a C/C++ function_definition by walking its
   * declarator chain: pointer/reference/parenthesized wrappers →
   * function_declarator → identifier / field_identifier / destructor_name /
   * operator_name / qualified_identifier (drilled to its leaf, so
   * `ns::Class::method` yields `method`). Used by extractSymbols (graph
   * entities) and by _extractNodeName (chunk names), so both agree.
   */
  _cFunctionDefinitionName(node) {
    if (!node || node.type !== 'function_definition') return null;
    let d = node.childForFieldName?.('declarator');
    for (let hops = 0; d && hops < 6; hops++) {
      if (d.type === 'function_declarator') { d = d.childForFieldName?.('declarator'); break; }
      if (d.type === 'operator_cast' || d.type === 'qualified_identifier') break;
      const inner = d.childForFieldName?.('declarator')
        || d.namedChildren?.find?.(c => /declarator/.test(c.type));
      if (!inner) break;
      d = inner;
    }
    for (let hops = 0; d && hops < 6; hops++) {
      if (d.type === 'qualified_identifier') {
        d = d.childForFieldName?.('name') || d.namedChildren?.[d.namedChildCount - 1];
        continue;
      }
      if (/^(identifier|field_identifier|destructor_name|operator_name)$/.test(d.type)) {
        return d.text || null;
      }
      // `fromString<std::string>(...)` (explicit specialization): the template name.
      if (d.type === 'template_function') { d = d.childForFieldName?.('name'); continue; }
      // Conversion operator `operator bool() const`: `operator bool`.
      if (d.type === 'operator_cast') {
        const type = d.childForFieldName?.('type');
        return type ? `operator ${type.text}` : null;
      }
      break;
    }
    return null;
  }

  /** Extract symbol name from an AST node */
  _extractNodeName(node) {
    // Try field name first (most reliable)
    const nameNode = node.childForFieldName('name');
    if (nameNode) return nameNode.text;

    // C/C++ function definition: the name is inside the declarator chain. The
    // fallback below would take the first type_identifier child, the return
    // type (`template <typename T> T get()` was named `T`), or find nothing
    // (`void f()`). Null when the chain has no name, never the return type.
    if (node.type === 'function_definition' && node.childForFieldName('declarator')) {
      return this._cFunctionDefinitionName(node);
    }

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

    // OCaml / ReScript — the definition's name lives one level down in the
    // grammar's `*_binding` child (value_definition → let_binding → value_name;
    // type_definition → type_binding → type_constructor/type_identifier;
    // module_definition → module_binding → module_name/module_identifier). The
    // wrapper node-type strings below are unique to tree-sitter-ocaml/rescript,
    // so this branch is a null-op for every other grammar.
    const BINDING_WRAPPER = OCAML_RESCRIPT_BINDING_WRAPPERS[node.type];
    if (BINDING_WRAPPER) {
      for (let i = 0; i < node.childCount; i++) {
        const binding = node.child(i);
        if (binding.type !== BINDING_WRAPPER) continue;
        for (let j = 0; j < binding.childCount; j++) {
          const nm = binding.child(j);
          if (IDENT_TYPES.has(nm.type)) return nm.text;
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
   * Name of the type that owns a captured definition (graph `parent_class`),
   * or null for a top-level / local definition. Walks the ancestors of the
   * definition's extent node: the nearest container node wins, a function
   * body or anonymous class body stops the walk. Go receivers and C++
   * out-of-line `Type::method` definitions name their owner directly.
   */
  _containerName(extentNode, languageId) {
    if (languageId === 'go' && extentNode.type === 'method_declaration') {
      const param = extentNode.childForFieldName('receiver')?.namedChild(0);
      let typeNode = param?.childForFieldName('type');
      while (typeNode && (typeNode.type === 'pointer_type' || typeNode.type === 'parenthesized_type')) {
        typeNode = typeNode.namedChild(0);
      }
      return lastNameSegment(typeNode);
    }
    const containers = CONTAINER_NODE_TYPES[languageId];
    if (languageId === 'cpp' && extentNode.type === 'function_definition') {
      let decl = extentNode.childForFieldName('declarator');
      while (decl && decl.type !== 'function_declarator') {
        decl = decl.childForFieldName('declarator') || decl.namedChild(0);
      }
      let qualified = decl?.childForFieldName('declarator');
      if (qualified?.type === 'qualified_identifier') {
        let scope = null;
        while (qualified?.type === 'qualified_identifier') {
          scope = qualified.childForFieldName('scope');
          qualified = qualified.childForFieldName('name');
        }
        const owner = lastNameSegment(scope);
        if (owner) return owner;
      }
    }
    if (!containers) return null;
    for (let node = extentNode.parent; node; node = node.parent) {
      if (containers.has(node.type)) {
        if ((node.type === 'object' || node.type === 'class') && JS_FAMILY_LANGUAGES.has(languageId)) {
          // JS/TS object literal or class expression: owned by the variable
          // it is assigned to (`const api = { get() {} }`), else anonymous.
          const own = node.type === 'class' ? node.childForFieldName('name') : null;
          if (own) return own.text;
          return node.parent?.type === 'variable_declarator'
            ? node.parent.childForFieldName('name')?.text || null
            : null;
        }
        if (node.type === 'impl_item') return lastNameSegment(node.childForFieldName('type'));
        const nameNode = node.childForFieldName('name');
        if (nameNode) return lastNameSegment(nameNode);
        // Kotlin declarations carry the name as a positional child.
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child.type === 'type_identifier') return child.text;
        }
        return null;
      }
      if (CONTAINER_STOP_NODE_TYPES.has(node.type)) return null;
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
    const type = refineDeclarationKind(node, this._chunkLanguageId, NODE_TYPE_MAP[node.type] || 'code');
    return { type, nameNode: node };
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
    // Dev-machine override location kept for back-compat; the SHIPPED override
    // home is Strategy 2c below.
    // Strategy 2c: grammars/ next to this provider file
    // (core/infrastructure/grammars/). This directory is git-tracked and ships
    // in the npm package via the existing "core/infrastructure/" files entry, so
    // installed users get the overrides — the old .sweet-search/ location was
    // gitignored and NEVER left the dev machine. Required for the Swift grammar
    // override: tree-sitter-wasms@0.1.13 ships swift v0.4.0 whose Wasm tier-up
    // Zone-OOMs V8 ("Fatal process out of memory: Zone") on linux-x64 under
    // Node 24.x (verified 24.4 + 24.18 in clean-room docker; macOS arm64
    // unaffected; Node 20 unaffected) and Node 25.x. The working v0.7.2 wasm
    // from alex-pinkus/tree-sitter-swift `0.7.2-pypi` lives here — regenerate
    // via scripts/download-tree-sitter-grammars.js. Resolve via import.meta.url
    // so it works whether sweet-search is the cwd or a node_modules dependency.
    try {
      const providerDir = pathMod.dirname(new URL(import.meta.url).pathname);
      const pkgRoot = pathMod.resolve(providerDir, '..', '..');
      const pkgOverridePath = pathMod.join(pkgRoot, '.sweet-search', 'grammars', `${grammarName}.wasm`);
      if (fs.existsSync(pkgOverridePath)) return pkgOverridePath;
      const shippedOverridePath = pathMod.join(providerDir, 'grammars', `${grammarName}.wasm`);
      if (fs.existsSync(shippedOverridePath)) return shippedOverridePath;
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

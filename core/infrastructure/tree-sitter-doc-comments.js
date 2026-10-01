/**
 * Doc comments for tree-sitter graph entities.
 *
 * The tree-sitter path of GraphExtractor never filled `doc_comment` (only the
 * regex fallback did, through a line heuristic), so the BM25 `doc_comment`
 * column of `entities_fts` was empty for almost every entity in every
 * language. This module reads the documentation from the AST instead:
 *
 *   - Leading comments: the run of comment nodes directly above the
 *     declaration, with no blank line between them and the declaration
 *     (Go, Rust, JSDoc, Javadoc, C#, Kotlin, Swift, Ruby, PHP… all attach
 *     doc comments this way). Attribute / decorator siblings between the
 *     comment and the declaration (`#[derive]`, `@Decorator()`) are skipped.
 *   - Python docstrings: the string literal that is the first statement of
 *     a function or class body. Leading `#` comments are the fallback.
 *
 * Not documentation: trailing comments of the previous line, Rust inner docs
 * (`//!`, `/*!` document the enclosing module; in C/C++ Doxygen and Qt they
 * document the next item, so they are kept there), compiler directives
 * (`//go:generate`, `//nolint:x` — `//` directly followed by `word:`), and a
 * license header at the top of the file.
 */

export const DOC_COMMENT_MAX_CHARS = 500;

// Wrappers that hold exactly one declaration: its doc comment sits above the
// wrapper (`/** doc */ export function f`, `@dec def f`, `template<…> class C`).
const SINGLE_DECLARATION_WRAPPERS = new Set([
  'export_statement',
  'decorated_definition',
  'template_declaration',
  'ambient_declaration',
]);

// Declaration statements that can declare several items. The doc comment
// above the statement belongs to the item only when the statement declares
// one item (`var x = 1`, `const f = () => {}`, Go `type T struct{}`).
const SINGLE_ITEM_DECLARATIONS = new Set([
  'lexical_declaration',
  'variable_declaration',
  'var_declaration',
  'const_declaration',
  'type_declaration',
  'field_declaration',
  'event_field_declaration',
  'value_definition',
  'let_declaration',
  'type_definition',
  'module_definition',
  'module_declaration',
]);

// Sibling nodes allowed between a doc comment and its declaration.
const ATTRIBUTE_SIBLING_TYPES = new Set([
  'attribute_item',
  'decorator',
  'attribute_list',
  'annotation',
  'marker_annotation',
]);

const MAX_ANCHOR_CLIMB = 4;

const LICENSE_HEADER = /\b(?:copyright|spdx-license-identifier|licensed under|license)\b/i;
// `//go:generate`, `//nolint:errcheck`, `//lint:ignore` — a directive is `//`
// directly followed by `word:` (no space), per the Go spec; never prose.
const DIRECTIVE_LINE = /^\s*\/\/[a-z][a-z0-9_-]*:/;
const INNER_DOC = /^\s*(?:\/\/!|\/\*!)/;
const SHEBANG = /^#!/;
const XML_DOC_TAG = /<\/?[A-Za-z][^<>]*>/g;
const HAS_WORD = /[\p{L}\p{N}]/u;

function isComment(node) {
  return !!node && /comment$/.test(node.type);
}

function isBlankAnonymous(node, content) {
  return !node.isNamed && content.substring(node.startIndex, node.endIndex).trim() === '';
}

function startsOwnLine(node, content) {
  const lineStart = content.lastIndexOf('\n', node.startIndex - 1) + 1;
  return content.substring(lineStart, node.startIndex).trim() === '';
}

function countNamedChildrenOfType(parent, type) {
  let n = 0;
  for (let i = 0; i < parent.namedChildCount; i++) {
    if (parent.namedChild(i).type === type) n++;
  }
  return n;
}

/**
 * The node whose leading comments document `node`: climbs through
 * single-declaration wrappers (see the two sets above).
 */
export function docAnchorNode(node) {
  let cur = node;
  for (let depth = 0; depth < MAX_ANCHOR_CLIMB; depth++) {
    const parent = cur.parent;
    if (!parent) break;
    if (SINGLE_DECLARATION_WRAPPERS.has(parent.type)) {
      cur = parent;
      continue;
    }
    if (SINGLE_ITEM_DECLARATIONS.has(parent.type)
      && countNamedChildrenOfType(parent, cur.type) === 1) {
      cur = parent;
      continue;
    }
    break;
  }
  return cur;
}

function previousNonBlank(node, content) {
  let prev = node.previousSibling;
  while (prev && isBlankAnonymous(prev, content)) prev = prev.previousSibling;
  return prev;
}

// tree-sitter-python can attach a comment that precedes a `def` to the end
// of the previous sibling's body. Recover it only when it sits at the
// declaration's own indentation (a deeper comment belongs to that body).
function pythonTrailingComment(prev, column) {
  let n = prev.lastChild;
  while (n) {
    if (isComment(n)) return n.startPosition.column === column ? n : null;
    if (n.childCount === 0) return null;
    n = n.lastChild;
  }
  return null;
}

function isFileHeader(node, content) {
  let prev = previousNonBlank(node, content);
  while (prev && isComment(prev)) prev = previousNonBlank(prev, content);
  return !prev && !node.parent?.parent;
}

/** Comment nodes directly above `anchor`, top to bottom. */
export function leadingCommentNodes(anchor, content, languageId) {
  let boundaryRow = anchor.startPosition.row;
  // A first member can sit in a body node that starts exactly where it does
  // (tree-sitter-ruby `body_statement`); the member's comment is then the
  // body's previous sibling (`class Foo\n  # doc\n  def run`).
  let base = anchor;
  while (!previousNonBlank(base, content) && base.parent?.parent
    && base.parent.startIndex === base.startIndex) {
    base = base.parent;
  }
  let prev = previousNonBlank(base, content);
  while (prev && ATTRIBUTE_SIBLING_TYPES.has(prev.type) && prev.endPosition.row >= boundaryRow - 1) {
    boundaryRow = prev.startPosition.row;
    prev = previousNonBlank(prev, content);
  }
  if (prev && !isComment(prev) && languageId === 'python') {
    prev = pythonTrailingComment(prev, anchor.startPosition.column);
  }
  const run = [];
  while (prev && isComment(prev)) {
    if (prev.endPosition.row < boundaryRow - 1) break; // blank line between
    if (!startsOwnLine(prev, content)) break; // trailing comment of earlier code
    run.unshift(prev);
    boundaryRow = prev.startPosition.row;
    prev = previousNonBlank(prev, content);
  }
  return run;
}

/** Comment source text without comment markers, one entry per line. */
export function cleanCommentLines(raw, languageId) {
  if (SHEBANG.test(raw)) return [];
  if (languageId === 'rust' && INNER_DOC.test(raw)) return [];
  if (DIRECTIVE_LINE.test(raw)) return [];
  const text = raw
    .replace(/^\s*(?:\/\*+!?|\(\*+|=begin\b|\{-)/, '')
    .replace(/(?:\*+\/|\*+\)|=end\b|-\})\s*$/, '');
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (DIRECTIVE_LINE.test(line)) continue;
    const cleaned = line
      .replace(/^\s*(?:\/\/[/!]?|#+|--+|;+|\*+(?!\/))\s?/, '')
      .trim();
    if (cleaned && HAS_WORD.test(cleaned)) out.push(cleaned);
  }
  return out;
}

function joinDoc(lines) {
  const text = lines.join(' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, DOC_COMMENT_MAX_CHARS) : null;
}

function stripPythonString(raw) {
  const m = raw.match(/^[rRuUbBfF]{0,2}("""|'''|"|')([\s\S]*)\1$/);
  return m ? m[2] : null;
}

/** Python docstring of a function / class definition (or its decorated wrapper). */
export function pythonDocstring(node, content) {
  let def = node;
  if (def.type === 'decorated_definition') {
    def = def.childForFieldName?.('definition') || def.namedChild(def.namedChildCount - 1);
  }
  if (!def || (def.type !== 'function_definition' && def.type !== 'class_definition')) return null;
  const body = def.childForFieldName?.('body');
  if (!body) return null;
  let first = null;
  for (let i = 0; i < body.namedChildCount; i++) {
    const child = body.namedChild(i);
    if (!isComment(child)) { first = child; break; }
  }
  if (!first || first.type !== 'expression_statement' || first.namedChildCount !== 1) return null;
  const str = first.namedChild(0);
  if (str.type !== 'string') return null;
  const inner = stripPythonString(content.substring(str.startIndex, str.endIndex));
  if (inner == null) return null;
  return joinDoc(inner.split(/\r?\n/).map(l => l.trim()).filter(l => l && HAS_WORD.test(l)));
}

/**
 * Documentation text for a tree-sitter declaration node, or null.
 * @param {object} node - declaration extent node
 * @param {string} content - file source the tree was parsed from
 * @param {string} languageId
 */
export function extractTreeSitterDocComment(node, content, languageId) {
  if (!node || !content) return null;
  if (languageId === 'python') {
    const doc = pythonDocstring(node, content);
    if (doc) return doc;
  }
  const anchor = docAnchorNode(node);
  const run = leadingCommentNodes(anchor, content, languageId);
  if (run.length === 0) return null;
  const lines = [];
  for (const c of run) lines.push(...cleanCommentLines(content.substring(c.startIndex, c.endIndex), languageId));
  let doc = joinDoc(lines);
  if (doc && isFileHeader(run[0], content) && LICENSE_HEADER.test(doc)) return null;
  // C# XML documentation: keep the text, drop the <summary>/<param> markup.
  if (doc && languageId === 'csharp') doc = joinDoc([doc.replace(XML_DOC_TAG, ' ')]);
  return doc;
}

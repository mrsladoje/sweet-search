/**
 * Extracts the import header context shown above the top result, and holds the language keyword set.
 */

import { readFileRange } from '../search-pattern-chunks.js';
import { inferLanguage } from './span-expansion.js';
import { estimateTokens } from './budget.js';

 // rank 1, 2, 3+
export const MAX_HEADER_TOKENS = 200;

// Language keywords to exclude from identifier extraction
export const LANG_KEYWORDS = new Set([
  // JS/TS
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'do', 'switch', 'case', 'break', 'continue', 'new', 'this', 'class',
  'extends', 'import', 'export', 'from', 'default', 'async', 'await',
  'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'void',
  'delete', 'in', 'of', 'true', 'false', 'null', 'undefined', 'yield',
  'super', 'static', 'get', 'set', 'with', 'debugger',
  // Go
  'func', 'type', 'struct', 'interface', 'map', 'chan', 'range', 'defer',
  'select', 'go', 'package', 'nil', 'error', 'string', 'int', 'bool',
  // Python
  'def', 'self', 'cls', 'lambda', 'pass', 'raise', 'with', 'as', 'is',
  'not', 'and', 'or', 'from', 'None', 'True', 'False', 'nonlocal', 'global',
  // Rust
  'fn', 'let', 'mut', 'pub', 'use', 'mod', 'crate', 'impl', 'trait',
  'where', 'enum', 'match', 'loop', 'move', 'ref', 'unsafe', 'dyn',
  'Some', 'None', 'Ok', 'Err', 'self', 'Self',
]);

/**
 * Extract import lines from file header, language-aware.
 *
 * Handles multi-line constructs that the previous line-by-line filter
 * dropped on the floor (the dominant cause of "missing alias" judge
 * complaints, e.g. fastify uses
 *   const { kSchemaParams: paramsSchema, ... } = require('./symbols')
 * spanning 5+ lines — the body uses `paramsSchema`, but only the multi-line
 * form maps it back to `kSchemaParams`):
 *
 *   - JS/TS: ES `import { a, b } from 'x'` (multi-line)
 *           `const { a, b } = require('x')` (multi-line, with `kKey: alias`)
 *           `export { ... } from '...'`
 *   - Go: `import (...)` blocks (with aliases like `alias "path"`)
 *   - Python: `import x` / `from x import (a, b, c)` (multi-line with parens)
 *   - Rust: `use foo::{bar, baz}` (multi-line grouped) + `pub use` + extern crate
 *
 * Output is one logical statement per array entry; multi-line statements
 * are joined with a space so the consumer (header rendering, identifier
 * scan) sees a single string per import.
 */
function extractImportLines(headerText, lang) {
  const lines = headerText.split('\n');

  // ── Generic multi-line statement collector ───────────────────────────────
  // Walk lines, accumulate balanced bracket levels for each "starter" we
  // recognise, emit when the statement closes. Falls back to single-line
  // emission for languages where a statement ends at EOL.
  const out = [];

  if (lang === 'go') {
    // Go: capture `import (...)` block contents (each line) and single `import "..."`
    let inBlock = false;
    for (const line of lines) {
      if (/^\s*import\s*\(/.test(line)) { inBlock = true; continue; }
      if (inBlock) {
        if (/^\s*\)/.test(line)) { inBlock = false; continue; }
        if (line.trim()) out.push(line.trimEnd());
      } else if (/^\s*import\s+(\w+\s+)?"/.test(line)) {
        out.push(line.trimEnd());
      }
    }
    return out;
  }

  if (lang === 'python') {
    // Python: `import x`, `from x import y`, `from x import (a, b, ...)`
    // multi-line via parens or trailing backslash.
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*(import\s+\w|from\s+[.\w]+\s+import)/.test(line)) {
        let stmt = line.trimEnd();
        // Continue while line ends with backslash or has unbalanced (
        const opens = () => (stmt.match(/\(/g) || []).length;
        const closes = () => (stmt.match(/\)/g) || []).length;
        const continued = () => /\\\s*$/.test(stmt) || opens() > closes();
        while (continued() && i + 1 < lines.length) {
          stmt = stmt.replace(/\\\s*$/, '').trimEnd() + ' ' + lines[++i].trim();
        }
        out.push(stmt);
      }
      i++;
    }
    return out;
  }

  if (lang === 'rust') {
    // Rust: `use foo::{bar, baz}` (possibly multi-line via { ... });
    // also `pub use ...;` and `extern crate ...;` (single line).
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*(pub\s+)?use\s+/.test(line) || /^\s*extern\s+crate\s+/.test(line)) {
        let stmt = line.trimEnd();
        // Continue until we see the terminating `;`
        while (!/;\s*(\/\/.*)?$/.test(stmt) && i + 1 < lines.length) {
          stmt += ' ' + lines[++i].trim();
        }
        out.push(stmt);
      }
      i++;
    }
    return out;
  }

  // JS/TS/default — handle multi-line ES imports and CommonJS destructured requires.
  // Examples we want to capture as ONE logical line:
  //   import {
  //     foo,
  //     bar as baz,
  //   } from 'mod'
  //   const {
  //     kSchemaParams: paramsSchema,
  //     kSchemaBody: bodySchema,
  //   } = require('./symbols')
  //   const x = require('./y')
  //   export { a, b } from './x'
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const isStartES = /^\s*(import|export)\s/.test(line);
    // CJS detector: start at any line that begins a const/let/var declaration.
    // We accumulate continuation lines until brackets balance, THEN filter to
    // only keep statements that prove themselves to be import-like (contain
    // `require(...)` or destructured-assignment from a bracketed expression).
    const isStartCJS = /^\s*(const|let|var)\s+/.test(line)
      && (/\brequire\s*\(/.test(line) || /\{[^}]*$/.test(line));
    if (isStartES || isStartCJS) {
      let stmt = line.trimEnd();
      const opens = () => (stmt.match(/[{(]/g) || []).length;
      const closes = () => (stmt.match(/[})]/g) || []).length;
      // Continue while open brackets exceed closes OR statement ends with comma
      // (suggests a continuation line for object / list).
      while ((opens() > closes() || /,\s*(\/\/.*)?$/.test(stmt))
             && i + 1 < lines.length) {
        stmt += ' ' + lines[++i].trim();
        if (opens() === closes() && /;\s*$/.test(stmt)) break;
      }
      // Only keep statements that look like imports (drop unrelated
      // const/let assignments that happened to span lines).
      if (/\b(import|require\s*\(|from\s+['"]|export\s*\{)/.test(stmt)) {
        out.push(stmt);
      }
    }
    i++;
  }
  return out;
}

/**
 * Extract minimal header context for the top-1 result.
 * Language-aware: parses Go import blocks, Python from/import, Rust use declarations.
 *
 * @param {string} code - The result code block
 * @param {Map} fileCache - Shared file cache
 * @param {string} filePath - File path (relative)
 * @param {string} projectRoot
 * @returns {{ headerContext: string|null, headerTokens: number }}
 */
export function extractHeaderContext(code, fileCache, filePath, projectRoot) {
  if (!code || !filePath) return { headerContext: null, headerTokens: 0 };

  try {
    // Read the first 50 lines (import region) of the file
    const headerText = readFileRange(fileCache, filePath, 1, 50, projectRoot);
    if (!headerText) return { headerContext: null, headerTokens: 0 };

    const lang = inferLanguage(filePath);
    const importLines = extractImportLines(headerText, lang);

    if (importLines.length === 0) return { headerContext: null, headerTokens: 0 };

    // Extract identifiers from the code block — broad matching
    const rawMatches = code.match(/\b[a-zA-Z_][a-zA-Z0-9_]{2,}\b/g) || [];
    const codeIdentifiers = new Set(
      rawMatches.filter(id => !LANG_KEYWORDS.has(id))
    );

    // Keep only imports that reference identifiers found in the code
    const relevantImports = importLines.filter(line =>
      [...codeIdentifiers].some(id => line.includes(id))
    );

    if (relevantImports.length === 0) return { headerContext: null, headerTokens: 0 };

    const headerContext = relevantImports.join('\n');
    const headerTokens = estimateTokens(headerContext);

    // Enforce max header tokens — trim at line boundaries
    if (headerTokens > MAX_HEADER_TOKENS) {
      const hdrLines = headerContext.split('\n');
      let trimmed = '';
      for (const line of hdrLines) {
        if (estimateTokens(trimmed + '\n' + line) > MAX_HEADER_TOKENS) break;
        trimmed += (trimmed ? '\n' : '') + line;
      }
      return {
        headerContext: trimmed || hdrLines[0],
        headerTokens: estimateTokens(trimmed || hdrLines[0]),
      };
    }

    return { headerContext, headerTokens };
  } catch {
    return { headerContext: null, headerTokens: 0 };
  }
}

/**
 * Hard-cap a multi-line text block to a token budget by dropping trailing lines.
 * Used after formatting steps that may otherwise overshoot the remaining budget.
 *
 * @param {string} text
 * @param {number} tokenCap
 * @returns {string}
 */
export function clampTextToTokenCap(text, tokenCap) {
  if (!text || tokenCap <= 0) return '';
  if (estimateTokens(text) <= tokenCap) return text;

  const lines = text.split('\n');
  while (lines.length > 0) {
    lines.pop();
    const candidate = lines.join('\n');
    if (candidate && estimateTokens(candidate) <= tokenCap) {
      return candidate;
    }
  }

  return '';
}

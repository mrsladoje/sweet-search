/**
 * Vocabulary Miner Extractors
 *
 * Dependency-extraction functions for imports, exports, definitions,
 * constants, and package manifest parsing.
 */

import { splitIdentifier, addTerm, STOP_WORDS } from './vocab-miner-utils.js';

// ---------------------------------------------------------------------------
// Import Extraction
// ---------------------------------------------------------------------------

/**
 * Extract import statements and add imported names as vocabulary terms.
 * Supports JS/TS, Python, Go, Java/Kotlin, and Rust import syntaxes.
 * @param {string} content - Source file content to parse
 * @param {string} ext - File extension including dot (e.g. '.js', '.py')
 * @param {Map<string, {score: number, source: string}>} terms - Accumulator map for discovered terms
 * @returns {void}
 */
export function extractImports(content, ext, terms) {
  // JS/TS: import { X, Y } from 'module'; import X from 'module'
  if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) {
    const importRe = /import\s+(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRe.exec(content))) {
      const names = match[1] || match[2];
      const modulePath = match[3];
      if (names) {
        for (const name of names.split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim())) {
          if (name && name.length > 1) {
            addTerm(terms, name, 0.6, 'import');
            for (const part of splitIdentifier(name)) {
              if (part.length > 2 && !STOP_WORDS.has(part)) {
                addTerm(terms, part, 0.4, 'import-part');
              }
            }
          }
        }
      }
      // Module name
      if (modulePath && !modulePath.startsWith('.')) {
        const modName = modulePath.replace(/^@[^/]+\//, '');
        addTerm(terms, modName, 0.4, 'import-module');
      }
    }
    return;
  }

  // Python: from X import Y; import X
  if (['.py', '.pyi'].includes(ext)) {
    const pyImportRe = /(?:from\s+([\w.]+)\s+import\s+([^#\n]+)|import\s+([\w.]+))/g;
    let match;
    while ((match = pyImportRe.exec(content))) {
      const module = match[1] || match[3];
      const names = match[2];
      if (module) {
        const parts = module.split('.');
        for (const part of parts) {
          if (part.length > 2) addTerm(terms, part, 0.5, 'import');
        }
      }
      if (names) {
        for (const name of names.split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim())) {
          if (name && name.length > 1 && name !== '*') {
            addTerm(terms, name, 0.6, 'import');
          }
        }
      }
    }
    return;
  }

  // Go: import "pkg" or import ( "pkg" )
  if (ext === '.go') {
    const goImportRe = /import\s+(?:\(\s*([\s\S]*?)\)|"([^"]+)")/g;
    let match;
    while ((match = goImportRe.exec(content))) {
      const block = match[1] || `"${match[2]}"`;
      const pkgRe = /"([^"]+)"/g;
      let pkgMatch;
      while ((pkgMatch = pkgRe.exec(block))) {
        const pkg = pkgMatch[1];
        const lastPart = pkg.split('/').pop();
        if (lastPart && lastPart.length > 1) {
          addTerm(terms, lastPart, 0.5, 'import');
        }
      }
    }
    return;
  }

  // Java/Kotlin: import com.example.Foo;
  if (['.java', '.kt', '.kts'].includes(ext)) {
    const javaImportRe = /import\s+(?:static\s+)?([\w.]+)/g;
    let match;
    while ((match = javaImportRe.exec(content))) {
      const parts = match[1].split('.');
      const className = parts[parts.length - 1];
      if (className && className !== '*' && className.length > 1) {
        addTerm(terms, className, 0.6, 'import');
      }
    }
    return;
  }

  // Rust: use std::collections::HashMap;
  if (ext === '.rs') {
    const rustUseRe = /use\s+([\w:]+(?:::\{[^}]+\})?)/g;
    let match;
    while ((match = rustUseRe.exec(content))) {
      const path = match[1];
      const braceMatch = path.match(/::\{([^}]+)\}/);
      if (braceMatch) {
        for (const name of braceMatch[1].split(',').map(n => n.trim())) {
          if (name.length > 1) addTerm(terms, name, 0.6, 'import');
        }
      } else {
        const parts = path.split('::');
        const last = parts[parts.length - 1];
        if (last && last.length > 1) addTerm(terms, last, 0.5, 'import');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Export Extraction
// ---------------------------------------------------------------------------

/**
 * Extract exported declarations (classes, functions, constants, etc.) as vocabulary terms.
 * Currently supports JS/TS export syntax.
 * @param {string} content - Source file content to parse
 * @param {string} ext - File extension including dot (e.g. '.js', '.ts')
 * @param {Map<string, {score: number, source: string}>} terms - Accumulator map for discovered terms
 * @returns {void}
 */
export function extractExports(content, ext, terms) {
  // JS/TS: export { X, Y }; export class X; export function X; export default X
  if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) {
    const exportRe = /export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)\s+(\w+)/g;
    let match;
    while ((match = exportRe.exec(content))) {
      addTerm(terms, match[1], 0.8, 'export');
      for (const part of splitIdentifier(match[1])) {
        if (part.length > 2 && !STOP_WORDS.has(part)) {
          addTerm(terms, part, 0.5, 'export-part');
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Definition Extraction
// ---------------------------------------------------------------------------

/**
 * Extract class, function, and method definitions as vocabulary terms.
 * Matches universal patterns including async functions and indented method definitions.
 * @param {string} content - Source file content to parse
 * @param {string} ext - File extension including dot (e.g. '.js', '.py')
 * @param {Map<string, {score: number, source: string}>} terms - Accumulator map for discovered terms
 * @returns {void}
 */
export function extractDefinitions(content, ext, terms) {
  // Universal: class/function/method patterns
  const defPatterns = [
    // JS/TS: class X, function X, const X =
    /(?:class|interface|enum|type)\s+([A-Z]\w+)/g,
    /(?:function)\s+([a-zA-Z_$]\w+)/g,
    /(?:async\s+function)\s+([a-zA-Z_$]\w+)/g,
    // Method definitions: x(params) {
    /^\s+(?:async\s+)?([a-zA-Z_$]\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/gm,
  ];

  for (const pattern of defPatterns) {
    let match;
    while ((match = pattern.exec(content))) {
      const name = match[1];
      if (name && name.length > 1 && !STOP_WORDS.has(name.toLowerCase())) {
        addTerm(terms, name, 0.5, 'definition');
        for (const part of splitIdentifier(name)) {
          if (part.length > 2 && !STOP_WORDS.has(part)) {
            addTerm(terms, part, 0.3, 'definition-part');
          }
        }
      }
    }
    pattern.lastIndex = 0; // Reset global regex
  }
}

// ---------------------------------------------------------------------------
// Constant Extraction
// ---------------------------------------------------------------------------

/**
 * Extract SCREAMING_SNAKE_CASE constants as vocabulary terms.
 * Splits compound constant names into sub-parts and skips common annotation tokens (TODO, FIXME, etc.).
 * @param {string} content - Source file content to parse
 * @param {Map<string, {score: number, source: string}>} terms - Accumulator map for discovered terms
 * @returns {void}
 */
export function extractConstants(content, terms) {
  // SCREAMING_SNAKE_CASE constants
  const constRe = /\b([A-Z][A-Z0-9_]{2,})\b/g;
  let match;
  while ((match = constRe.exec(content))) {
    const name = match[1];
    // Skip common non-terms
    if (['TODO', 'FIXME', 'NOTE', 'HACK', 'XXX', 'BUG'].includes(name)) continue;
    addTerm(terms, name, 0.4, 'constant');
    for (const part of splitIdentifier(name)) {
      if (part.length > 2 && !STOP_WORDS.has(part)) {
        addTerm(terms, part, 0.2, 'constant-part');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Manifest Extractors
// ---------------------------------------------------------------------------

/**
 * Parse a package.json file and return dependency names from both dependencies and devDependencies.
 * @param {string} content - Raw JSON string of a package.json file
 * @returns {string[]} Array of dependency package names (length > 1), or empty array on parse failure
 */
export function extractNpmDeps(content) {
  try {
    const pkg = JSON.parse(content);
    const deps = [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
    ];
    return deps.filter(d => d.length > 1);
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    return [];
  }
}

/**
 * Parse a Cargo.toml file and return crate dependency names from [dependencies] sections.
 * @param {string} content - Raw content of a Cargo.toml file
 * @returns {string[]} Array of crate dependency names
 */
export function extractCargoDeps(content) {
  const deps = [];
  const depRe = /^\[dependencies(?:\.[^\]]+)?\]\s*\n([\s\S]*?)(?=\n\[|\n*$)/gm;
  let match;
  while ((match = depRe.exec(content))) {
    const block = match[1];
    for (const line of block.split('\n')) {
      const nameMatch = line.match(/^(\w[\w-]*)\s*=/);
      if (nameMatch) deps.push(nameMatch[1]);
    }
  }
  return deps;
}

/**
 * Parse a go.mod file and return the last path segment of each required module.
 * @param {string} content - Raw content of a go.mod file
 * @returns {string[]} Array of Go module short names (last path segment)
 */
export function extractGoDeps(content) {
  const deps = [];
  const modRe = /require\s*\(\s*([\s\S]*?)\)/g;
  let match;
  while ((match = modRe.exec(content))) {
    for (const line of match[1].split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] && parts[0].includes('/')) {
        deps.push(parts[0].split('/').pop());
      }
    }
  }
  return deps.filter(Boolean);
}

/**
 * Parse a requirements.txt file and return package names (stripped of version specifiers and comments).
 * @param {string} content - Raw content of a requirements.txt file
 * @returns {string[]} Array of Python package names (length > 1)
 */
export function extractPipDeps(content) {
  return content.split('\n')
    .map(line => line.replace(/#.*$/, '').trim())
    .filter(line => line && !line.startsWith('-'))
    .map(line => line.split(/[>=<~!]/)[0].trim())
    .filter(d => d.length > 1);
}

/**
 * Parse a pyproject.toml file and return dependency names from the [project] dependencies array.
 * @param {string} content - Raw content of a pyproject.toml file
 * @returns {string[]} Array of Python package names (length > 1)
 */
export function extractPyprojectDeps(content) {
  const deps = [];
  const match = content.match(/\[project\][\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (match) {
    for (const line of match[1].split('\n')) {
      const depMatch = line.match(/["']([^"'>=<~!]+)/);
      if (depMatch) deps.push(depMatch[1].trim());
    }
  }
  return deps.filter(d => d.length > 1);
}

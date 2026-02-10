import path from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Generic project boundary detection using marker files.
 * Replaces hardcoded directory detection with auto-discovery.
 *
 * Works by walking up from a file path to find the nearest directory
 * containing a project marker file (package.json, pom.xml, build.gradle, etc.)
 */

// Project marker files that indicate a project boundary
const PROJECT_MARKERS = [
  'package.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'go.mod',
  'Cargo.toml',
  'pyproject.toml',
  'setup.py',
  'CMakeLists.txt',
  '.project',
  'Makefile',
  'CLAUDE.md',
];

// Cache directory boundary lookups for performance during indexing
const _boundaryCache = new Map();

/**
 * Detect the nearest project boundary for a given file path.
 *
 * @param {string} filePath - Absolute file path to analyze
 * @param {string} projectRoot - The top-level project root (stop boundary)
 * @returns {{ name: string, path: string }} Project name (kebab-cased dir name) and path
 */
export function detectProjectBoundary(filePath, projectRoot) {
  const dir = path.dirname(filePath);
  const cacheKey = dir + '|' + projectRoot;

  if (_boundaryCache.has(cacheKey)) {
    return _boundaryCache.get(cacheKey);
  }

  const result = _walkUpForBoundary(dir, projectRoot);
  _boundaryCache.set(cacheKey, result);
  return result;
}

function _walkUpForBoundary(dir, projectRoot) {
  const normalizedRoot = path.resolve(projectRoot);
  let current = path.resolve(dir);

  // Walk up from file directory to project root
  while (current.length >= normalizedRoot.length) {
    // Don't check the project root itself — we want sub-project boundaries
    if (current !== normalizedRoot) {
      for (const marker of PROJECT_MARKERS) {
        if (existsSync(path.join(current, marker))) {
          const name = toKebabCase(path.basename(current));
          return { name, path: current };
        }
      }
    }

    const parent = path.dirname(current);
    if (parent === current) break; // filesystem root
    current = parent;
  }

  // Fallback: use the top-level directory name from project root
  const rootName = toKebabCase(path.basename(normalizedRoot));
  return { name: rootName, path: normalizedRoot };
}

/**
 * Convert a directory name to kebab-case for use as a project tag.
 * Examples: "My-Project" -> "my-project", "My App" -> "my-app"
 */
function toKebabCase(str) {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')  // camelCase -> camel-Case
    .replace(/[\s_]+/g, '-')                // spaces/underscores -> hyphens
    .replace(/[^a-zA-Z0-9-]/g, '')          // remove special chars
    .toLowerCase();
}

/**
 * Clear the boundary cache (useful for testing or after project structure changes).
 */
export function clearBoundaryCache() {
  _boundaryCache.clear();
}

export default { detectProjectBoundary, clearBoundaryCache };

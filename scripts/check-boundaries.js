#!/usr/bin/env node
/**
 * Architecture Fitness Function — DDD boundary enforcement.
 *
 * Checks:
 *   1. Forbidden dependency direction (domain layering rules)
 *   2. Barrel-only imports across domains (no cross-domain internal imports)
 *   3. Barrel-only imports from consumers outside core/
 *
 * Run: node scripts/check-boundaries.js [--fix-hints]
 * CI: add to pre-commit or CI pipeline.
 */

import { execSync } from 'child_process';
import path from 'path';

const DOMAINS = [
  'embedding', 'graph', 'indexing', 'infrastructure',
  'query', 'ranking', 'search', 'vector-store', 'vocabulary',
];

// ── Section 1: Forbidden dependency direction ────────────────────────────────

const FORBIDDEN = [
  { from: 'core/infrastructure/', to: ['embedding/', 'indexing/', 'search/', 'ranking/', 'graph/', 'vocabulary/', 'vector-store/', 'query/'], label: 'infrastructure → domain' },
  { from: 'core/vector-store/', to: ['embedding/', 'indexing/', 'search/', 'ranking/', 'graph/', 'vocabulary/', 'query/'], label: 'vector-store → domain' },
  { from: 'core/embedding/', to: ['search/', 'ranking/', 'indexing/', 'query/', 'graph/', 'vocabulary/', 'vector-store/'], label: 'embedding → higher' },
  { from: 'core/query/', to: ['search/', 'ranking/', 'indexing/', 'embedding/', 'graph/', 'vocabulary/', 'vector-store/'], label: 'query → domain' },
  { from: 'core/ranking/', to: ['search/', 'indexing/', 'query/', 'graph/', 'vocabulary/', 'vector-store/', 'embedding/'], label: 'ranking → higher' },
  { from: 'core/indexing/', to: ['search/', 'query/'], label: 'indexing → higher' },
  { from: 'core/graph/', to: ['search/', 'indexing/', 'vocabulary/', 'vector-store/', 'embedding/'], label: 'graph → forbidden' },
  { from: 'core/vocabulary/', to: ['search/', 'ranking/', 'indexing/', 'query/', 'vector-store/'], label: 'vocabulary → forbidden' },
];

const EXCEPTIONS = [
  { from: 'core/indexing/', to: 'ranking/', label: 'indexing → ranking (late-interaction build)', max: 2 },
];

// ── Section 2: Barrel-only allowlist ─────────────────────────────────────────
// Files that are allowed to import domain internals (not through barrel).
// Each entry: { file: glob-ish prefix, domain: allowed domain, reason: string }

const BARREL_BYPASS_ALLOWLIST = [
  // Infrastructure tests may test internals directly
  { pattern: 'tests/infrastructure/', domain: 'infrastructure', reason: 'domain unit tests' },
  // These indexing tests test tree-sitter integration at the module level
  { pattern: 'tests/indexing/', domain: 'indexing', reason: 'domain unit tests' },
  { pattern: 'tests/embedding/', domain: 'embedding', reason: 'domain unit tests' },
  { pattern: 'tests/graph/', domain: 'graph', reason: 'domain unit tests' },
  { pattern: 'tests/ranking/', domain: 'ranking', reason: 'domain unit tests' },
  { pattern: 'tests/search/', domain: 'search', reason: 'domain unit tests' },
  { pattern: 'tests/query/', domain: 'query', reason: 'domain unit tests' },
  { pattern: 'tests/vector-store/', domain: 'vector-store', reason: 'domain unit tests' },
  { pattern: 'tests/vocabulary/', domain: 'vocabulary', reason: 'domain unit tests' },
  // Within-domain imports are always allowed
  { pattern: 'core/', domain: '_self', reason: 'within-domain' },
];

function isBarrelBypassAllowed(filePath, domain) {
  for (const entry of BARREL_BYPASS_ALLOWLIST) {
    if (!filePath.includes(entry.pattern)) continue;
    if (entry.domain === '_self') {
      // Within-domain imports are OK
      if (filePath.includes(`core/${domain}/`)) return true;
    } else if (entry.domain === domain) {
      return true;
    }
  }
  return false;
}

let violations = 0;
const showHints = process.argv.includes('--fix-hints');

// ── Check 1: Forbidden dependency direction ──────────────────────────────────

for (const rule of FORBIDDEN) {
  for (const target of rule.to) {
    try {
      const result = execSync(
        `grep -rn "from '.*${target}" ${rule.from} 2>/dev/null || true`,
        { encoding: 'utf8' }
      ).trim();

      if (result) {
        for (const line of result.split('\n')) {
          if (!line) continue;
          if (line.includes('await import(') && line.includes('// CLI')) continue;
          console.error(`VIOLATION [${rule.label}]: ${line}`);
          violations++;
        }
      }

      const dynamicResult = execSync(
        `grep -rn "import(.*${target}" ${rule.from} 2>/dev/null || true`,
        { encoding: 'utf8' }
      ).trim();

      if (dynamicResult) {
        for (const line of dynamicResult.split('\n')) {
          if (!line) continue;
          // Skip dynamic imports in CLI-only code paths (documented exception)
          if (line.includes('await import(') && line.includes('// CLI')) continue;
          console.error(`VIOLATION [${rule.label}] (dynamic): ${line}`);
          violations++;
        }
      }
    } catch { /* grep returns non-zero when no matches */ }
  }
}

// ── Check 2: Documented exception limits ─────────────────────────────────────

for (const exc of EXCEPTIONS) {
  try {
    const count = execSync(
      `grep -rn "from '.*${exc.to}" ${exc.from} 2>/dev/null | wc -l`,
      { encoding: 'utf8' }
    ).trim();
    const n = parseInt(count, 10);
    if (n > exc.max) {
      console.error(`EXCEPTION EXCEEDED [${exc.label}]: found ${n} imports (max ${exc.max})`);
      violations++;
    } else if (n > 0) {
      console.log(`OK [${exc.label}]: ${n} imports (within limit of ${exc.max})`);
    }
  } catch { /* */ }
}

// ── Check 3: Barrel-only imports for consumers outside core/ ─────────────────
// Any import from core/<domain>/<file>.js (not index.js) by files outside core/
// should go through the barrel unless allowlisted.

let barrelViolations = 0;

for (const domain of DOMAINS) {
  try {
    // Find imports that reference domain internals (not /index.js or / alone)
    const result = execSync(
      `grep -rn --include='*.js' --include='*.mjs' -E "from ['\"].*core/${domain}/[^'\"]+['\"]" tests/ scripts/ eval/ mcp/ training/ translation/ bin/ evaluation/ 2>/dev/null || true`,
      { encoding: 'utf8' }
    ).trim();

    if (!result) continue;

    for (const line of result.split('\n')) {
      if (!line) continue;
      // Extract the imported path
      const match = line.match(/from\s+['"]([^'"]+)['"]/);
      if (!match) continue;
      const importPath = match[1];

      // Barrel imports (index.js or bare domain path) are fine
      if (importPath.endsWith(`/${domain}/index.js`) || importPath.endsWith(`/${domain}/`)) continue;

      // config.js facade is explicitly allowed for external consumers
      if (importPath.endsWith('/core/config.js')) continue;

      // Extract the file doing the importing
      const filePath = line.split(':')[0];

      // Check allowlist
      if (isBarrelBypassAllowed(filePath, domain)) continue;

      barrelViolations++;
      console.error(`BARREL BYPASS [${domain}]: ${line.trim()}`);
      if (showHints) {
        console.error(`  → import from 'core/${domain}/index.js' instead`);
      }
    }

    // Also check dynamic imports
    const dynamicResult = execSync(
      `grep -rn --include='*.js' --include='*.mjs' -E "import\\(.*core/${domain}/[^'\"]+['\"]" tests/ scripts/ eval/ mcp/ training/ translation/ bin/ evaluation/ 2>/dev/null || true`,
      { encoding: 'utf8' }
    ).trim();

    if (!dynamicResult) continue;

    for (const line of dynamicResult.split('\n')) {
      if (!line) continue;
      const match = line.match(/import\(['"]([^'"]+)['"]\)/);
      if (!match) continue;
      const importPath = match[1];

      if (importPath.endsWith(`/${domain}/index.js`) || importPath.endsWith(`/${domain}/`)) continue;
      if (importPath.endsWith('/core/config.js')) continue;

      const filePath = line.split(':')[0];
      if (isBarrelBypassAllowed(filePath, domain)) continue;

      barrelViolations++;
      console.error(`BARREL BYPASS [${domain}] (dynamic): ${line.trim()}`);
      if (showHints) {
        console.error(`  → import('core/${domain}/index.js') instead`);
      }
    }
  } catch { /* */ }
}

// ── Summary ──────────────────────────────────────────────────────────────────

if (barrelViolations > 0) {
  console.error(`\n${barrelViolations} barrel bypass violation(s) found.`);
  if (!showHints) {
    console.error('Run with --fix-hints for migration suggestions.');
  }
}

const totalViolations = violations + barrelViolations;

if (totalViolations > 0) {
  console.error(`\n${totalViolations} total violation(s) found.`);
  process.exit(1);
} else {
  console.log('\nAll domain boundaries clean.');
  console.log(`Checked: ${DOMAINS.length} domains, ${FORBIDDEN.length} direction rules, barrel-only enforcement active.`);
  process.exit(0);
}

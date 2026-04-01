#!/usr/bin/env node
/**
 * Architecture Fitness Function — DDD boundary enforcement.
 *
 * Checks:
 *   1. Forbidden dependency direction (domain layering rules)
 *   2. Undeclared external dependencies (e.g. core/ → training/)
 *   3. Barrel-only cross-domain imports within core/
 *   4. Barrel-only imports from consumers outside core/
 *
 * Run: node scripts/check-boundaries.js [--fix-hints]
 * CI: runs on every push/PR via .github/workflows/ci.yml
 */

import { execSync } from 'child_process';

const DOMAINS = [
  'embedding', 'graph', 'indexing', 'infrastructure',
  'query', 'ranking', 'search', 'vector-store', 'vocabulary',
];

// ── Section 1: Forbidden dependency direction ────────────────────────────────

const FORBIDDEN = [
  { from: 'core/infrastructure/', to: ['embedding/', 'indexing/', 'search/', 'ranking/', 'graph/', 'vocabulary/', 'vector-store/', 'query/'], label: 'infrastructure → domain' },
  { from: 'core/vector-store/', to: ['embedding/', 'indexing/', 'search/', 'ranking/', 'graph/', 'vocabulary/', 'query/'], label: 'vector-store → domain' },
  { from: 'core/embedding/', to: ['search/', 'ranking/', 'indexing/', 'query/', 'graph/', 'vocabulary/', 'vector-store/'], label: 'embedding → higher' },
  { from: 'core/query/', to: ['search/', 'ranking/', 'indexing/', 'embedding/', 'graph/', 'vocabulary/', 'vector-store/', 'training/', 'translation/'], label: 'query → forbidden' },
  { from: 'core/ranking/', to: ['search/', 'indexing/', 'query/', 'graph/', 'vocabulary/', 'vector-store/', 'embedding/'], label: 'ranking → higher' },
  { from: 'core/indexing/', to: ['search/', 'query/'], label: 'indexing → higher' },
  { from: 'core/graph/', to: ['search/', 'indexing/', 'vocabulary/', 'vector-store/', 'embedding/'], label: 'graph → forbidden' },
  { from: 'core/vocabulary/', to: ['search/', 'ranking/', 'indexing/', 'query/', 'vector-store/'], label: 'vocabulary → forbidden' },
];

const EXCEPTIONS = [
  { from: 'core/indexing/', to: 'ranking/', label: 'indexing → ranking (late-interaction build)', max: 2 },
  // query-router-catboost imports trained model from training/ — declared dependency
  { from: 'core/query/', to: 'training/', label: 'query → training (CatBoost model artifact)', max: 2 },
];

// ── Section 2: Barrel-only allowlist (external consumers) ────────────────────

const EXTERNAL_BARREL_ALLOWLIST = [
  { pattern: 'tests/infrastructure/', domain: 'infrastructure', reason: 'domain unit tests' },
  { pattern: 'tests/indexing/', domain: 'indexing', reason: 'domain unit tests' },
  { pattern: 'tests/embedding/', domain: 'embedding', reason: 'domain unit tests' },
  { pattern: 'tests/graph/', domain: 'graph', reason: 'domain unit tests' },
  { pattern: 'tests/ranking/', domain: 'ranking', reason: 'domain unit tests' },
  { pattern: 'tests/search/', domain: 'search', reason: 'domain unit tests' },
  { pattern: 'tests/query/', domain: 'query', reason: 'domain unit tests' },
  { pattern: 'tests/vector-store/', domain: 'vector-store', reason: 'domain unit tests' },
  { pattern: 'tests/vocabulary/', domain: 'vocabulary', reason: 'domain unit tests' },
];

function isExternalBypassAllowed(filePath, domain) {
  for (const entry of EXTERNAL_BARREL_ALLOWLIST) {
    if (filePath.includes(entry.pattern) && entry.domain === domain) return true;
  }
  return false;
}

// ── Section 3: Internal barrel-only allowlist (within core/) ─────────────────
// Cross-domain imports within core/ that are too costly to barrel-ify right now.
// Each entry documents WHY and prevents silent growth.

const INTERNAL_BARREL_ALLOWLIST = [
  // Infrastructure internals are allowed — infra is a support layer with
  // module-level utilities (db-utils, model-fetcher, etc.) that domains
  // import directly for performance/simplicity.
  'infrastructure',
];

let violations = 0;
let barrelViolations = 0;
let internalBarrelViolations = 0;
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
          // Check if it matches a documented exception
          const isExcepted = EXCEPTIONS.some(exc =>
            line.includes(exc.from.replace(/\/$/, '')) && line.includes(target)
          );
          if (isExcepted) continue;
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
          if (line.includes('await import(') && line.includes('// CLI')) continue;
          const isExcepted = EXCEPTIONS.some(exc =>
            line.includes(exc.from.replace(/\/$/, '')) && line.includes(target)
          );
          if (isExcepted) continue;
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

// ── Check 3: Barrel-only cross-domain imports WITHIN core/ ───────────────────
// For each domain, find imports of OTHER domains' internal files (not barrel).
// Within-domain and infrastructure imports are allowed.

for (const sourceDomain of DOMAINS) {
  for (const targetDomain of DOMAINS) {
    if (sourceDomain === targetDomain) continue;
    if (INTERNAL_BARREL_ALLOWLIST.includes(targetDomain)) continue;

    try {
      const result = execSync(
        `grep -rn --include='*.js' --include='*.mjs' "from '../${targetDomain}/" core/${sourceDomain}/ 2>/dev/null || true`,
        { encoding: 'utf8' }
      ).trim();

      if (!result) continue;

      for (const line of result.split('\n')) {
        if (!line) continue;
        const match = line.match(/from\s+['"]([^'"]+)['"]/);
        if (!match) continue;
        const importPath = match[1];

        // Barrel imports are fine
        if (importPath.endsWith(`/${targetDomain}/index.js`) || importPath.endsWith(`/${targetDomain}/`)) continue;

        // CLI-excepted dynamic imports
        if (line.includes('await import(') && line.includes('// CLI')) continue;

        internalBarrelViolations++;
        console.error(`INTERNAL BYPASS [${sourceDomain} → ${targetDomain}]: ${line.trim()}`);
        if (showHints) {
          console.error(`  → import from '../${targetDomain}/index.js' instead`);
        }
      }
    } catch { /* */ }
  }
}

// ── Check 4: Barrel-only imports from consumers outside core/ ────────────────

for (const domain of DOMAINS) {
  try {
    const result = execSync(
      `grep -rn --include='*.js' --include='*.mjs' -E "from ['\"].*core/${domain}/[^'\"]+['\"]" tests/ scripts/ eval/ mcp/ training/ translation/ bin/ evaluation/ __tests__/ 2>/dev/null || true`,
      { encoding: 'utf8' }
    ).trim();

    if (!result) continue;

    for (const line of result.split('\n')) {
      if (!line) continue;
      const match = line.match(/from\s+['"]([^'"]+)['"]/);
      if (!match) continue;
      const importPath = match[1];

      if (importPath.endsWith(`/${domain}/index.js`) || importPath.endsWith(`/${domain}/`)) continue;
      if (importPath.endsWith('/core/config.js')) continue;

      const filePath = line.split(':')[0];
      if (isExternalBypassAllowed(filePath, domain)) continue;

      barrelViolations++;
      console.error(`BARREL BYPASS [${domain}]: ${line.trim()}`);
      if (showHints) {
        console.error(`  → import from 'core/${domain}/index.js' instead`);
      }
    }

    // Dynamic imports
    const dynamicResult = execSync(
      `grep -rn --include='*.js' --include='*.mjs' -E "import\\(.*core/${domain}/[^'\"]+['\"]" tests/ scripts/ eval/ mcp/ training/ translation/ bin/ evaluation/ __tests__/ 2>/dev/null || true`,
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
      if (isExternalBypassAllowed(filePath, domain)) continue;

      barrelViolations++;
      console.error(`BARREL BYPASS [${domain}] (dynamic): ${line.trim()}`);
      if (showHints) {
        console.error(`  → import('core/${domain}/index.js') instead`);
      }
    }
  } catch { /* */ }
}

// ── Summary ──────────────────────────────────────────────────────────────────

if (internalBarrelViolations > 0) {
  console.error(`\n${internalBarrelViolations} internal barrel bypass(es) within core/.`);
}
if (barrelViolations > 0) {
  console.error(`${barrelViolations} external barrel bypass(es).`);
  if (!showHints) {
    console.error('Run with --fix-hints for migration suggestions.');
  }
}

const totalViolations = violations + barrelViolations;
// Internal barrel bypasses are warnings for now, not hard failures
const totalWarnings = internalBarrelViolations;

if (totalViolations > 0) {
  console.error(`\n${totalViolations} violation(s) found.`);
  if (totalWarnings > 0) console.error(`${totalWarnings} warning(s) (internal barrel bypasses).`);
  process.exit(1);
} else {
  console.log('\nAll domain boundaries clean.');
  console.log(`Checked: ${DOMAINS.length} domains, ${FORBIDDEN.length} direction rules, barrel-only enforcement (external + internal).`);
  if (totalWarnings > 0) {
    console.log(`${totalWarnings} internal barrel bypass warning(s) — not blocking.`);
  }
  process.exit(0);
}

#!/usr/bin/env node
/**
 * Architecture Fitness Function — DDD boundary enforcement.
 * Run: node scripts/check-boundaries.js
 * CI: add to pre-commit or CI pipeline.
 */

import { execSync } from 'child_process';

const FORBIDDEN = [
  // infrastructure → any domain
  { from: 'core/infrastructure/', to: ['embedding/', 'indexing/', 'search/', 'ranking/', 'graph/', 'vocabulary/', 'vector-store/', 'query/'], label: 'infrastructure → domain' },
  // vector-store → any domain except infrastructure
  { from: 'core/vector-store/', to: ['embedding/', 'indexing/', 'search/', 'ranking/', 'graph/', 'vocabulary/', 'query/'], label: 'vector-store → domain' },
  // embedding → higher layers
  { from: 'core/embedding/', to: ['search/', 'ranking/', 'indexing/', 'query/', 'graph/', 'vocabulary/'], label: 'embedding → higher' },
  // query → anything except infrastructure
  { from: 'core/query/', to: ['search/', 'ranking/', 'indexing/', 'embedding/', 'graph/', 'vocabulary/', 'vector-store/'], label: 'query → domain' },
  // ranking → higher layers
  { from: 'core/ranking/', to: ['search/', 'indexing/', 'query/', 'graph/', 'vocabulary/'], label: 'ranking → higher' },
  // indexing → search, query
  { from: 'core/indexing/', to: ['search/', 'query/'], label: 'indexing → higher' },
  // graph → forbidden domains
  { from: 'core/graph/', to: ['search/', 'indexing/', 'vocabulary/', 'vector-store/'], label: 'graph → forbidden' },
  // vocabulary → forbidden domains
  { from: 'core/vocabulary/', to: ['search/', 'ranking/', 'indexing/', 'query/', 'vector-store/'], label: 'vocabulary → forbidden' },
];

let violations = 0;

for (const rule of FORBIDDEN) {
  for (const target of rule.to) {
    try {
      // Check static imports
      const result = execSync(
        `grep -rn "from '.*${target}" ${rule.from} 2>/dev/null || true`,
        { encoding: 'utf8' }
      ).trim();

      if (result) {
        for (const line of result.split('\n')) {
          if (!line) continue;
          // Skip dynamic imports in CLI-only code paths (documented exception)
          if (line.includes('await import(') && line.includes('// CLI')) continue;
          console.error(`VIOLATION [${rule.label}]: ${line}`);
          violations++;
        }
      }

      // Check dynamic imports
      const dynamicResult = execSync(
        `grep -rn "import(.*${target}" ${rule.from} 2>/dev/null || true`,
        { encoding: 'utf8' }
      ).trim();

      if (dynamicResult) {
        for (const line of dynamicResult.split('\n')) {
          if (!line) continue;
          console.error(`VIOLATION [${rule.label}] (dynamic): ${line}`);
          violations++;
        }
      }
    } catch { /* grep returns non-zero when no matches */ }
  }
}

// Documented exceptions
const EXCEPTIONS = [
  { from: 'core/indexing/', to: 'ranking/', label: 'indexing → ranking (late-interaction build)', max: 2 },
];

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

if (violations > 0) {
  console.error(`\n${violations} boundary violation(s) found.`);
  process.exit(1);
} else {
  console.log('\nAll domain boundaries clean.');
  process.exit(0);
}

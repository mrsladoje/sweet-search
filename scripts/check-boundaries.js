#!/usr/bin/env node
/**
 * Architecture Fitness Function — DDD boundary enforcement.
 *
 * Checks:
 *   1. Forbidden dependency direction (domain layering rules)
 *   2. Undeclared external dependencies (e.g. core/ → external/)
 *   3. Barrel-only cross-domain imports within core/
 *   4. Barrel-only imports from consumers outside core/
 *
 * Run: node scripts/check-boundaries.js [--fix-hints]
 * CI: runs on every push/PR via .github/workflows/ci.yml
 */

import { execSync } from 'child_process';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const DOMAINS = [
  'embedding', 'graph', 'indexing', 'infrastructure',
  'query', 'ranking', 'search', 'vector-store', 'vocabulary',
];

// ── Section 1: Forbidden dependency direction ────────────────────────────────

const FORBIDDEN = [
  { from: 'core/infrastructure/', to: ['embedding/', 'indexing/', 'search/', 'ranking/', 'graph/', 'vocabulary/', 'vector-store/', 'query/'], label: 'infrastructure → domain' },
  { from: 'core/vector-store/', to: ['embedding/', 'indexing/', 'search/', 'ranking/', 'graph/', 'vocabulary/', 'query/'], label: 'vector-store → domain' },
  { from: 'core/embedding/', to: ['search/', 'ranking/', 'indexing/', 'query/', 'graph/', 'vocabulary/', 'vector-store/'], label: 'embedding → higher' },
  { from: 'core/query/', to: ['search/', 'ranking/', 'indexing/', 'embedding/', 'graph/', 'vocabulary/', 'vector-store/'], label: 'query → forbidden' },
  { from: 'core/ranking/', to: ['search/', 'indexing/', 'query/', 'graph/', 'vocabulary/', 'vector-store/', 'embedding/'], label: 'ranking → higher' },
  { from: 'core/indexing/', to: ['search/', 'query/'], label: 'indexing → higher' },
  { from: 'core/graph/', to: ['search/', 'indexing/', 'vocabulary/', 'vector-store/', 'embedding/'], label: 'graph → forbidden' },
  { from: 'core/vocabulary/', to: ['search/', 'ranking/', 'indexing/', 'query/', 'vector-store/'], label: 'vocabulary → forbidden' },
];

const EXCEPTIONS = [
  // indexing → ranking: LI build path needs LateInteractionIndex (static) +
  // runtime helpers in late-interaction-model.js (static + dynamic fallback
  // in hybrid dispatcher, worker entrypoint, pool inline fallback). Count
  // includes both static `from` and dynamic `import()` forms (2026-04-15 fix).
  { from: 'core/indexing/', to: 'ranking/', label: 'indexing → ranking (late-interaction build)', max: 6 },
  // query-router-catboost imports trained model from core/training/query-router/ — declared build-time artifact dependency
  { from: 'core/query/', to: 'training/query-router/', label: 'query → training (CatBoost model artifact)', max: 2 },
];

// ── Section 2: Barrel-only allowlist (external consumers) ────────────────────

const EXTERNAL_BARREL_ALLOWLIST = [
  // Domain unit tests are expected to reach into their domain's internals —
  // that's their whole purpose. Each entry whitelists one (dir prefix, domain) pair.
  { pattern: 'tests/infrastructure/', domain: 'infrastructure', reason: 'domain unit tests' },
  { pattern: 'tests/indexing/', domain: 'indexing', reason: 'domain unit tests' },
  { pattern: 'tests/embedding/', domain: 'embedding', reason: 'domain unit tests' },
  { pattern: 'tests/graph/', domain: 'graph', reason: 'domain unit tests' },
  { pattern: 'tests/ranking/', domain: 'ranking', reason: 'domain unit tests' },
  { pattern: 'tests/search/', domain: 'search', reason: 'domain unit tests' },
  { pattern: 'tests/query/', domain: 'query', reason: 'domain unit tests' },
  { pattern: 'tests/vector-store/', domain: 'vector-store', reason: 'domain unit tests' },
  { pattern: 'tests/vocabulary/', domain: 'vocabulary', reason: 'domain unit tests' },

  // init / uninstall / build scripts are top-level entrypoints that stitch
  // together infrastructure concerns (model fetch, hardware capability,
  // cascade fetch). They legitimately need direct access to named helpers
  // that aren't re-exported on the infrastructure barrel.
  { pattern: 'scripts/init.js', domain: 'infrastructure', reason: 'init entrypoint' },
  { pattern: 'scripts/uninstall.js', domain: 'infrastructure', reason: 'uninstall entrypoint' },
  { pattern: 'scripts/build-coreml-cascade.js', domain: 'infrastructure', reason: 'cascade build script' },
  { pattern: 'scripts/profile-pipeline.js', domain: 'infrastructure', reason: 'native inference profiler' },

  // Diagnostic harnesses under `tests/diagnose-*` + `tests/native-*-accuracy.js`
  // are performance / accuracy probes, not regular tests. They reach directly
  // into the native inference + ranking internals to isolate specific code
  // paths. Not run in CI (vitest.config.js only matches *.test.js).
  // Candidate for relocation to `scripts/diagnose/` in a follow-up.
  { pattern: 'tests/diagnose-', domain: 'infrastructure', reason: 'native inference probes' },
  { pattern: 'tests/diagnose-', domain: 'ranking', reason: 'LI hybrid / encoder probes' },
  { pattern: 'tests/native-', domain: 'infrastructure', reason: 'native accuracy probes' },
  { pattern: 'tests/native-', domain: 'ranking', reason: 'native LI accuracy probe' },

  // Spike directory for the CoreML cascade exploration work. All files under
  // scripts/spike-coreml/ are pre-merge experiments that were kept in-tree
  // for reproducibility of the trace workflow.
  { pattern: 'scripts/spike-coreml/', domain: 'infrastructure', reason: 'CoreML cascade spike work' },

  // Eval harness probes ranking internals (LI quality benchmarks, maxsim
  // correlation) and infrastructure internals (grep latency, model paths).
  { pattern: 'eval/', domain: 'ranking', reason: 'LI quality / maxsim eval' },
  { pattern: 'eval/', domain: 'infrastructure', reason: 'model path / grep latency eval' },

  // Integration tests that straddle multiple domains — each legitimately
  // reaches into several internals to exercise the full pipeline path.
  { pattern: 'tests/integration/', domain: 'infrastructure', reason: 'integration test harness' },
  { pattern: 'tests/integration/', domain: 'indexing', reason: 'integration test harness' },
  { pattern: 'tests/integration/', domain: 'ranking', reason: 'integration test harness' },
  { pattern: 'tests/integration/', domain: 'embedding', reason: 'integration test harness' },
  { pattern: 'tests/integration/', domain: 'graph', reason: 'integration test harness' },
];

function isExternalBypassAllowed(filePath, domain) {
  for (const entry of EXTERNAL_BARREL_ALLOWLIST) {
    if (filePath.includes(entry.pattern) && entry.domain === domain) return true;
  }
  return false;
}

// ── Pure-Node file walker for Section 4 ──────────────────────────────────────
//
// Replaces the old `execSync(grep ...)` approach which had a shell-escape bug
// (double-quoted grep regex containing `['\"]` produced invalid shell). The
// bug made Section 4 a silent no-op — the "0 BARREL BYPASS" report was
// fictitious and 39 hidden bypasses existed when this was re-implemented.
// See docs/reviews/INDEXING_OPT_2026-04-15/integration.md §M3-NEW-1.

const SOURCE_EXTS = ['.js', '.mjs'];
const EXTERNAL_CONSUMER_DIRS = [
  'tests',
  'scripts',
  'eval',
  'mcp',
  'bin',
  'evaluation',
  '__tests__',
];

/**
 * Recursively collect every *.js / *.mjs file under `root`. Skips
 * `node_modules`, dot-prefixed dirs, and symlinks. Returns relative paths
 * from the repo root (what the old grep output looked like).
 */
function walkSourceFiles(root, out = [], repoRoot = process.cwd()) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules') continue;
    const full = join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    try {
      if (entry.isDirectory()) {
        walkSourceFiles(full, out, repoRoot);
      } else if (entry.isFile() && SOURCE_EXTS.some(ext => full.endsWith(ext))) {
        out.push(relative(repoRoot, full));
      }
    } catch {
      // Unreadable entry — skip silently, matches old grep behavior.
    }
  }
  return out;
}

// Regex for static imports: `from '...core/<domain>/<path>'` OR
// `from "...core/<domain>/<path>"`. Captures quote char + path.
const STATIC_IMPORT_REGEX = /from\s+(['"])([^'"]*core\/([a-z-]+)\/[^'"]+)\1/g;
// Regex for dynamic imports: `import('...core/<domain>/<path>')`.
const DYNAMIC_IMPORT_REGEX = /import\(\s*(['"])([^'"]*core\/([a-z-]+)\/[^'"]+)\1\s*\)/g;

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
//
// Count BOTH static (`from '.../target'`) AND dynamic (`import('.../target')`)
// import forms. Before this fix, dynamic imports bypassed the exception
// counter, so the `indexing → ranking (late-interaction build)` allowlist
// reported 2 sites while the real coupling surface was 6 (see
// docs/reviews/ddd-compliance.md §3).

for (const exc of EXCEPTIONS) {
  try {
    const staticCount = execSync(
      `grep -rn "from '.*${exc.to}" ${exc.from} 2>/dev/null | wc -l`,
      { encoding: 'utf8' }
    ).trim();
    const dynamicCount = execSync(
      `grep -rn "import(.*${exc.to}" ${exc.from} 2>/dev/null | wc -l`,
      { encoding: 'utf8' }
    ).trim();
    const n = parseInt(staticCount, 10) + parseInt(dynamicCount, 10);
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
//
// Scan every *.js / *.mjs under the listed consumer dirs with a pure-Node
// walker + regex. Any import whose path matches `core/<domain>/<sub>` and
// does NOT end in `/<domain>/index.js` or `/<domain>/` counts as a barrel
// bypass. The allowlist forgives known-intentional cases (domain unit tests,
// init/uninstall entrypoints, diagnostic harnesses).
//
// External bypasses are reported as WARNINGS, not errors — they surface
// for contributor review but do not block CI on pre-existing code. Pass
// `--strict-external` to escalate them to errors.

const strictExternal = process.argv.includes('--strict-external');
let externalBarrelWarnings = 0;

const allSourceFiles = [];
for (const consumer of EXTERNAL_CONSUMER_DIRS) {
  walkSourceFiles(consumer, allSourceFiles);
}

function checkImportLine(filePath, lineNumber, line, regex, dynamic) {
  for (const match of line.matchAll(regex)) {
    const importPath = match[2];
    const domain = match[3];
    if (!DOMAINS.includes(domain)) continue;

    // Barrel imports are fine: path ends in /domain/index.js or /domain/
    if (importPath.endsWith(`/${domain}/index.js`)) continue;
    if (importPath.endsWith(`/${domain}/`)) continue;
    if (importPath.endsWith('/core/config.js')) continue;

    if (isExternalBypassAllowed(filePath, domain)) continue;

    externalBarrelWarnings++;
    if (strictExternal) barrelViolations++;
    const tag = dynamic ? `${domain}] (dynamic)` : `${domain}]`;
    const level = strictExternal ? 'error' : 'warn';
    console[level === 'error' ? 'error' : 'warn'](
      `BARREL BYPASS [${tag}: ${filePath}:${lineNumber}:${line.trim()}`
    );
    if (showHints) {
      const suggestion = dynamic
        ? `import('core/${domain}/index.js')`
        : `import from 'core/${domain}/index.js'`;
      console.warn(`  → ${suggestion} instead`);
    }
  }
}

for (const filePath of allSourceFiles) {
  let contents;
  try {
    contents = readFileSync(filePath, 'utf-8');
  } catch {
    continue;
  }
  const lines = contents.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('core/')) continue;
    // Reset regex state since .matchAll advances lastIndex on /g regexes
    checkImportLine(filePath, i + 1, line, new RegExp(STATIC_IMPORT_REGEX.source, 'g'), false);
    checkImportLine(filePath, i + 1, line, new RegExp(DYNAMIC_IMPORT_REGEX.source, 'g'), true);
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

if (internalBarrelViolations > 0) {
  console.error(`\n${internalBarrelViolations} internal barrel bypass(es) within core/.`);
}
if (externalBarrelWarnings > 0) {
  const label = strictExternal ? 'external barrel bypass(es)' : 'external barrel bypass warning(s)';
  console.warn(`${externalBarrelWarnings} ${label}.`);
  if (!showHints) {
    console.warn('Run with --fix-hints for migration suggestions.');
  }
  if (!strictExternal) {
    console.warn('Run with --strict-external to escalate these to CI errors.');
  }
}

const totalViolations = violations + barrelViolations;
// Internal barrel bypasses + (non-strict) external bypasses are warnings
const totalWarnings = internalBarrelViolations
  + (strictExternal ? 0 : externalBarrelWarnings);

if (totalViolations > 0) {
  console.error(`\n${totalViolations} violation(s) found.`);
  if (totalWarnings > 0) console.error(`${totalWarnings} warning(s) (barrel bypasses).`);
  process.exit(1);
} else {
  console.log('\nAll domain boundaries clean.');
  console.log(`Checked: ${DOMAINS.length} domains, ${FORBIDDEN.length} direction rules, barrel-only enforcement (external + internal).`);
  if (totalWarnings > 0) {
    const intNote = internalBarrelViolations > 0 ? `${internalBarrelViolations} internal` : '';
    const extNote = (!strictExternal && externalBarrelWarnings > 0) ? `${externalBarrelWarnings} external` : '';
    const parts = [intNote, extNote].filter(Boolean).join(', ');
    console.log(`${parts} barrel bypass warning(s) — not blocking.`);
  }
  process.exit(0);
}

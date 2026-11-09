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

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const DOMAINS = [
  'embedding', 'graph', 'indexing', 'infrastructure',
  'query', 'ranking', 'search', 'vector-store', 'vocabulary',
  'prompt-optimization', 'agent-tools', 'incremental-indexing',
];

// These two folders have no index.js barrel. They take part in the direction
// rules and the exception limits, not in the barrel-only checks.
const NO_BARREL_DOMAINS = ['agent-tools', 'incremental-indexing'];
const BARREL_DOMAINS = DOMAINS.filter(d => !NO_BARREL_DOMAINS.includes(d));

// ── Section 1: Forbidden dependency direction ────────────────────────────────
//
// `prompt-optimization/` is appended to every runtime-domain forbidden list
// because no runtime domain may import from this build-time context (the
// runtime engine has zero dependency on prompt-optimization — only
// scripts/init.js consumes its output artifact). See
// docs/DDD_ARCHITECTURE.md "Dependency Matrix" and the prompt-optimization
// rule below for its outgoing forbidden list (allowed: infrastructure;
// search barrel only via exception 4; ranking barrel only via exception 5).

const FORBIDDEN = [
  { from: 'core/infrastructure/', to: ['embedding/', 'indexing/', 'search/', 'ranking/', 'graph/', 'vocabulary/', 'vector-store/', 'query/', 'prompt-optimization/', 'agent-tools/'], label: 'infrastructure → domain' },
  { from: 'core/vector-store/', to: ['embedding/', 'indexing/', 'search/', 'ranking/', 'graph/', 'vocabulary/', 'query/', 'prompt-optimization/', 'agent-tools/'], label: 'vector-store → domain' },
  { from: 'core/embedding/', to: ['search/', 'ranking/', 'indexing/', 'query/', 'graph/', 'vocabulary/', 'vector-store/', 'prompt-optimization/', 'agent-tools/'], label: 'embedding → higher' },
  { from: 'core/query/', to: ['search/', 'ranking/', 'indexing/', 'embedding/', 'graph/', 'vocabulary/', 'vector-store/', 'prompt-optimization/', 'agent-tools/'], label: 'query → forbidden' },
  { from: 'core/ranking/', to: ['search/', 'indexing/', 'query/', 'graph/', 'vocabulary/', 'vector-store/', 'embedding/', 'prompt-optimization/', 'agent-tools/'], label: 'ranking → higher' },
  { from: 'core/indexing/', to: ['search/', 'query/', 'prompt-optimization/', 'agent-tools/'], label: 'indexing → higher' },
  { from: 'core/graph/', to: ['search/', 'indexing/', 'vocabulary/', 'vector-store/', 'embedding/', 'prompt-optimization/', 'agent-tools/'], label: 'graph → forbidden' },
  { from: 'core/vocabulary/', to: ['search/', 'ranking/', 'indexing/', 'query/', 'vector-store/', 'prompt-optimization/', 'agent-tools/'], label: 'vocabulary → forbidden' },
  { from: 'core/search/', to: ['prompt-optimization/'], label: 'search → prompt-optimization (forbidden — no runtime → build-time)' },
  // prompt-optimization is a build-time context. It MAY import infrastructure
  // (any depth, like other domains) and the search/ranking barrels via
  // declared exceptions 4/5 (max 2 sites each, barrel-only). Imports of any
  // other domain — or non-barrel internals of search/ranking — are forbidden.
  { from: 'core/prompt-optimization/', to: ['indexing/', 'query/', 'graph/', 'vocabulary/', 'vector-store/', 'embedding/'], label: 'prompt-optimization → forbidden runtime domain' },
  // agent-tools/ (the ss-* tool host) is the top application layer: it may
  // import search, indexing and infrastructure. It must not reach into the
  // build-time contexts.
  { from: 'core/agent-tools/', to: ['prompt-optimization/', 'training/'], label: 'agent-tools → build-time context' },
  // incremental-indexing/ (the incremental build) sits beside indexing/ and
  // below the query side. Imports of indexing/ are bounded by exception.
  { from: 'core/incremental-indexing/', to: ['search/', 'query/', 'prompt-optimization/', 'agent-tools/'], label: 'incremental-indexing → higher' },
];

const EXCEPTIONS = [
  // indexing → ranking: LI build path needs LateInteractionIndex (static) +
  // runtime helpers in late-interaction-model.js (static + dynamic fallback
  // in hybrid dispatcher, worker entrypoint, pool inline fallback). Count
  // includes both static `from` and dynamic `import()` forms (2026-04-15 fix).
  // Raised to 7 on 2026-04-17 for the new `model-pool.js` lifecycle manager
  // (it imports unloadLateInteractionModel/getLateInteractionPipeline/
  // encodeDocumentsCpu from late-interaction-model.js to warm ORT CPU on
  // query arm-down — same build-time direction, legitimate addition).
  // Raised to 8 on 2026-10-23 for `encoder-host.mjs`, the query encoder child
  // (26d0ce7c): it encodes LI queries and documents with the same
  // late-interaction-model.js helpers.
  { from: 'core/indexing/', to: 'ranking/', label: 'indexing → ranking (late-interaction build)', max: 8 },
  // query-router-catboost imports trained model from core/training/query-router/ — declared build-time artifact dependency
  { from: 'core/query/', to: 'training/query-router/', label: 'query → training (CatBoost model artifact)', max: 2 },
  // indexing → search: the worktree-index and RSS-budget modules talk to the
  // search daemon (registry, client, server identity). Declared so the
  // forbidden direction cannot grow beyond these sites.
  { from: 'core/indexing/', to: 'search/', label: 'indexing → search (daemon client / registry)', max: 3 },
  // search → agent-tools: core/search hosts the ss-* tool daemon route and
  // calls tools.js, chain.js and daemon-route.js of the tool host.
  { from: 'core/search/', to: 'agent-tools/', label: 'search → agent-tools (daemon route host)', max: 3 },
  // indexing <-> incremental-indexing: the two builds import each other. Both
  // directions are capped at today's count so the cycle cannot grow.
  { from: 'core/indexing/', to: 'incremental-indexing/', label: 'indexing → incremental-indexing', max: 30 },
  { from: 'core/incremental-indexing/', to: '/indexing/', label: 'incremental-indexing → indexing', max: 16 },
  // prompt-optimization → indexing: the preprocess script chunks with ASTChunker.
  { from: 'core/prompt-optimization/', to: 'indexing/', label: 'prompt-optimization → indexing (preprocess script)', max: 1 },
  // prompt-optimization → search (barrel only): embedded-MCP cross-harness
  // mode invokes the search barrel directly to drive in-process agent runs.
  // See docs/SYSTEM_PROMPT_OPT_PLAN.md Part 9 (cross-harness validation).
  { from: 'core/prompt-optimization/', to: 'search/', label: 'prompt-optimization → search (embedded-MCP cross-harness, barrel only)', max: 2 },
  // prompt-optimization → ranking (barrel only): B4 oracle-retrieval baseline
  // pre-injects gold snippets using ranking barrel helpers.
  // See docs/SYSTEM_PROMPT_OPT_PLAN.md Part 12 (four-baseline gate).
  { from: 'core/prompt-optimization/', to: 'ranking/', label: 'prompt-optimization → ranking (B4 oracle baseline, barrel only)', max: 2 },
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

// Third-party repository checkouts, benchmark corpora, run results and Python
// virtualenvs under eval/ (several GB, hundreds of thousands of files, not
// project code). They are never scanned.
const VENDORED_DIRS = new Set([
  'eval/repos',
  'eval/corpus',
  'eval/task-completion-bench/results',
  'eval/maxsim-bench/venv',
  'eval/maxsim-bench/venv-prep',
  'eval/ast-tester-probes/_repos',
]);

/**
 * Recursively collect every *.js / *.mjs file under `root`. Skips
 * `node_modules`, dot-prefixed dirs, VENDORED_DIRS, and symlinks. Returns relative paths
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
    if (VENDORED_DIRS.has(relative(repoRoot, full))) continue;
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

// ── In-process scan of core/ (checks 1-3) ────────────────────────────────────
//
// Every *.js / *.mjs under core/ is read once; checks 1-3 filter that list.
// Symlinks are not followed. Dot-directories and node_modules are scanned
// because the checks below never excluded them.

const coreFiles = [];
(function collectCoreFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  for (const entry of entries) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      collectCoreFiles(full);
    } else if (entry.isFile() && SOURCE_EXTS.some(ext => full.endsWith(ext))) {
      let text;
      try {
        text = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      coreFiles.push({ path: full, lines: text.split('\n') });
    }
  }
})('core');

/**
 * Yield `path:lineNumber:content` for every line under `prefix` that matches
 * `regex`. With `skipData`, directories named `data` are ignored (run captures
 * and sweep artifacts are data, not coupling).
 */
function* matchingLines(prefix, regex, { skipData = false } = {}) {
  for (const file of coreFiles) {
    if (!file.path.startsWith(prefix)) continue;
    if (skipData && file.path.slice(prefix.length).split('/').slice(0, -1).includes('data')) continue;
    for (let i = 0; i < file.lines.length; i++) {
      if (regex.test(file.lines[i])) yield `${file.path}:${i + 1}:${file.lines[i]}`;
    }
  }
}

// ── Check 1: Forbidden dependency direction ──────────────────────────────────
//
// An exception exempts a line only when the line sits under the exception's
// `from` folder AND the forbidden target is the exception's own `to`.

function isExcepted(line, target) {
  return EXCEPTIONS.some(exc => line.startsWith(exc.from) && exc.to === target);
}

for (const rule of FORBIDDEN) {
  for (const target of rule.to) {
    const staticRe = new RegExp(`from '.*${target}`);
    const dynamicRe = new RegExp(`import\\(.*${target}`);
    for (const line of matchingLines(rule.from, staticRe)) {
      if (line.includes('await import(') && line.includes('// CLI')) continue;
      if (isExcepted(line, target)) continue;
      console.error(`VIOLATION [${rule.label}]: ${line}`);
      violations++;
    }
    for (const line of matchingLines(rule.from, dynamicRe)) {
      if (line.includes('await import(') && line.includes('// CLI')) continue;
      if (isExcepted(line, target)) continue;
      console.error(`VIOLATION [${rule.label}] (dynamic): ${line}`);
      violations++;
    }
  }
}

// ── Check 2: Documented exception limits ─────────────────────────────────────
//
// Count BOTH static (`from '.../target'`) AND dynamic (`import('.../target')`)
// import forms. Before this fix, dynamic imports bypassed the exception
// counter, so the `indexing → ranking (late-interaction build)` allowlist
// reported 2 sites while the real coupling surface was 6 (see
// docs/reviews/ddd-compliance.md §3).
//
// Only *.js / *.mjs source files count toward the limit, and directories named
// `data` are skipped.

for (const exc of EXCEPTIONS) {
  const staticRe = new RegExp(`from '.*${exc.to}`);
  const dynamicRe = new RegExp(`import\\(.*${exc.to}`);
  let n = 0;
  for (const file of coreFiles) {
    if (!file.path.startsWith(exc.from)) continue;
    if (file.path.slice(exc.from.length).split('/').slice(0, -1).includes('data')) continue;
    for (const text of file.lines) {
      if (staticRe.test(text)) n++;
      if (dynamicRe.test(text)) n++;
    }
  }
  if (n > exc.max) {
    console.error(`EXCEPTION EXCEEDED [${exc.label}]: found ${n} imports (max ${exc.max})`);
    violations++;
  } else if (n > 0) {
    console.log(`OK [${exc.label}]: ${n} imports (within limit of ${exc.max})`);
  }
}

// ── Check 3: Barrel-only cross-domain imports WITHIN core/ ───────────────────
// For each domain, find imports of OTHER domains' internal files (not barrel).
// Within-domain and infrastructure imports are allowed. Domains without a
// barrel are not part of this check.

for (const sourceDomain of BARREL_DOMAINS) {
  for (const targetDomain of BARREL_DOMAINS) {
    if (sourceDomain === targetDomain) continue;
    if (INTERNAL_BARREL_ALLOWLIST.includes(targetDomain)) continue;

    const needle = `from '../${targetDomain}/`;
    for (const file of coreFiles) {
      if (!file.path.startsWith(`core/${sourceDomain}/`)) continue;
      for (let i = 0; i < file.lines.length; i++) {
        const text = file.lines[i];
        if (!text.includes(needle)) continue;
        const line = `${file.path}:${i + 1}:${text}`;
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
    }
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
    if (!BARREL_DOMAINS.includes(domain)) continue;

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

// ── Section 5: Sealed-1 Thresholdout-only access (§0.5, §11.4.2) ─────────────
//
// `core/prompt-optimization/data/splits/heldout_40.json` is the Sealed-1 set
// per the §0.5 dual-layer overfit-control framework. It MUST be read only via
// `core/prompt-optimization/stats/thresholdout.mjs` (the Reusable-Holdout
// oracle, Dwork et al. 2015). Any other source file that reads the path
// directly bypasses the budget log and the noise injection — that's exactly
// the failure mode §0.5.4 protects against.
//
// This check scans every file under core/ and scripts/ for the literal
// path string and flags violators. The lock-checker itself
// (scripts/check-vault-lock.mjs) is permitted to mention it, as is the
// bounded-context manifest, the barrel pending stub, and the manifest.json
// data file.

const SEALED1_PATH = 'core/prompt-optimization/data/splits/heldout_40.json';
const SEALED1_PERMITTED = new Set([
  'core/prompt-optimization/stats/thresholdout.mjs',
  'core/prompt-optimization/manifests.mjs',
  'core/prompt-optimization/data/manifest.json',
  'core/prompt-optimization/index.js',
  'core/prompt-optimization/pending.js',
  'scripts/check-boundaries.js', // self-reference (this file)
  'scripts/check-vault-lock.mjs',
]);

let sealed1Violations = 0;

function scanForSealed1Access() {
  const roots = ['core', 'scripts', 'eval', 'mcp'];
  const candidates = [];
  for (const r of roots) {
    try {
      walkSourceFiles(r, candidates);
    } catch {
      // root may not exist in all checkouts
    }
  }
  for (const filePath of candidates) {
    if (SEALED1_PERMITTED.has(filePath)) continue;
    let contents;
    try {
      contents = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    if (!contents.includes(SEALED1_PATH)) continue;
    sealed1Violations += 1;
    console.error(
      `\n[SEALED-1 BYPASS] ${filePath} reads ${SEALED1_PATH} directly.\n` +
        `  Sealed-1 access must go through core/prompt-optimization/stats/thresholdout.mjs ` +
        `(Reusable-Holdout oracle, §0.5/§11.4.2). Direct reads burn the heldout budget without ` +
        `the noise-injection guarantee. Update the caller to invoke openThresholdout() instead.`
    );
  }
}

scanForSealed1Access();

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

const totalViolations = violations + barrelViolations + sealed1Violations;
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

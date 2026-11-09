// Classifies a result path into a file kind and decides whether a chunk or file is test code.

import { isTestLikePath } from '../../infrastructure/test-paths.js';
import { hasAblation, resolveFilePath, resolveFullFileText, resolveResultName, resolveResultText } from './result-fields.js';

const DOCS_RE  = /\.md$|\.mdx$|\.rst$|(?:^|\/)docs?\//i;
// Optional leading underscore covers Go's `_examples/` build-excluded
// convention (go-chi, gin, gorilla, etc. — `go build` ignores any path
// component starting with `_`). The non-underscore form catches the
// generic `examples/`/`example/` directory shape across all languages.
// Verified across the AST-tester repo set: only `_examples/` directories
// follow the examples-pollution pattern; other leading-underscore dirs
// (Sphinx `_static`, Rust `_typeshed`, test fixture `_unrelated`, etc.)
// fall under existing docs / test demotion or are legitimate sources.
const EXAMPLES_RE = /(?:^|\/)_?examples?\//i;
// Tests directory patterns. Includes the standard tests?/spec/__tests__/__mocks__
// plus integration/, e2e/, fixtures?/, cypress/, playwright/ — common test-fixture
// directory conventions across JS/Python/Rust/Go that shipped without TESTS_RE
// catching them (e.g. fastify integration/server.js was mis-classified as
// 'implementation' until this update 2026-05-07).
// 2026-05-13: added `(?:^|/)test\.(c|cpp|cc|h|hpp|py|rb|go|rs|js|ts|java|kt|scala|php|lua|zig|dart|ex|exs)$`
// to catch bare `test.<ext>` files at repo root or any directory level
// (hiredis convention — C-005 in ast-tester probes). Restricted to code
// extensions only so `test.html`, `test.json`, `test.yaml` (legitimate
// fixtures) aren't misclassified.
const TESTS_RE = /(?:^|\/)(?:tests?|spec|integration|e2e|fixtures?|__tests__|__mocks__|cypress|playwright)\/|\.test\.[a-z0-9]+$|_test\.[a-z0-9]+$|\.spec\.[a-z0-9]+$|_spec\.[a-z0-9]+$|\.e2e\.[a-z0-9]+$|_e2e\.[a-z0-9]+$|(?:^|\/)test\.(?:c|cpp|cc|cxx|h|hpp|hh|py|rb|go|rs|js|ts|jsx|tsx|java|kt|scala|php|lua|zig|dart|ex|exs|swift|mjs|cjs|cs)$/i;
const TYPES_RE = /\.d\.ts$|(?:^|\/)types\//i;
// Ancillary files: configuration, lockfiles, CI manifests, container build
// definitions. 2026-05-07 added Dockerfile / Containerfile / .dockerignore
// after FreshStack uv UV-FLOW-2 surfaced a Dockerfile as top-1 for "what
// happens end-to-end when I run uv sync". Containerfile descriptors are not
// implementation code; demote consistently with .yaml/.toml/Cargo.lock
// siblings.
//
// NOTE: Deliberately NOT including `Makefile` / `GNUmakefile` here even
// though they are also build-orchestration. Probe S6-Q6 (gin) regressed
// PASS→PARTIAL when gin's `Makefile` was demoted: classifying it shifted
// the file-kind window's `demotableCount`, which cascaded through the
// rerank into a different gin.go top-1 chunk pick. Treating Makefile as
// implementation is the safer default — it rarely competes with real source
// for top-1 anyway. Re-evaluate if a future probe shows Makefile actually
// poisoning a top-1 result.
const ANCILLARY_RE = /(?:^|\/)\.(?:github|gitlab|circleci|vscode|cursor)\/|(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|Gemfile\.lock|Dockerfile(?:\.[\w.-]+)?|Containerfile|\.dockerignore)$|\.(?:ya?ml|jsonc?|toml|ini|cfg|conf|lock|xml|csv|dockerfile)$/i;

/**
 * Detect the file kind from a result path.
 * @returns {'docs'|'examples'|'tests'|'types'|'ancillary'|'implementation'}
 */
export function detectFileKind(filePath, opts) {
  if (!filePath || typeof filePath !== 'string') return 'implementation';
  // Only ~10-20 unique files live in a result set, so the regex scans are cached per path.
  const cache = opts && opts._fileKindCache;
  // The agent format classifies more paths as tests: one cache entry per format.
  const cacheKey = opts?.agentFormat ? `agent\u0000${filePath}` : filePath;
  if (cache && cache.has(cacheKey)) return cache.get(cacheKey);
  let kind;
  if (DOCS_RE.test(filePath))  kind = 'docs';
  else if (EXAMPLES_RE.test(filePath)) kind = 'examples';
  else if (TESTS_RE.test(filePath)) kind = 'tests';
  else if (isTestSupportFile(filePath)) kind = 'tests';
  else if (TYPES_RE.test(filePath)) kind = 'types';
  else if (ANCILLARY_RE.test(filePath)) kind = 'ancillary';
  else kind = 'implementation';
  // Agent format only (format-gated, CLAUDE.md): the shared test-path rules also know
  // `FooTests.cs` / `FooTest.java` and root `unit/`, `testing/`, `acceptance/` (ocelot's
  // test class TestLeastConnection ranked above the LeastConnection it tests).
  if (kind === 'implementation' && opts?.agentFormat && isTestLikePath(filePath)) kind = 'tests';
  if (cache) cache.set(cacheKey, kind);
  return kind;
}

// Removed (2026-05-05): the standalone tiny-ancillary-chunk floor became
// redundant once cAST sibling-merge was confirmed in tree-sitter-provider.js
// (recursiveChunk merges adjacent siblings up to MAX_CHUNK_SIZE so tiny
// chunks don't enter the index as standalone retrieval units), and the
// range-preservation invariant in applyResultDemotions stopped entity
// adoption from shrinking already-merged chunks. Kept the per-ancillary-file
// hard tiny factor (`tinyAncillaryFactor` in applyFileKindRanking) since
// that's a sub-rule of doc/test demotion, not a general size penalty.

export function isTestChunk(r, opts = {}) {
  const filePath = resolveFilePath(r);
  const verdictCache = opts._isTestChunkCache;
  let chunkKey = null;
  if (verdictCache) {
    const meta = r?.metadata || {};
    const start = r?.startLine ?? r?.start_line ?? meta.startLine ?? meta.start_line;
    const end = r?.endLine ?? r?.end_line ?? meta.endLine ?? meta.end_line ?? start;
    if (filePath && Number.isFinite(start)) {
      chunkKey = `${filePath}|${start}|${Number.isFinite(end) ? end : start}`;
      if (verdictCache.has(chunkKey)) return verdictCache.get(chunkKey);
    }
  }
  const verdict = isTestChunkUncached(r, opts, filePath);
  if (chunkKey) verdictCache.set(chunkKey, verdict);
  return verdict;
}

function isTestChunkUncached(r, opts, filePath) {
  const fileKind = detectFileKind(filePath, opts);
  if (fileKind === 'tests') return true;
  if (!hasAblation(opts.ablations, 'no-test-support-detection')) {
    // File content is immutable for one search() call. Uncached, the text scan
    // cost ~100 results × 100µs = 10ms per applyResultDemotions call.
    const verdictCache = opts._isTestSupportCache;
    let supportVerdict;
    if (verdictCache && verdictCache.has(filePath)) {
      supportVerdict = verdictCache.get(filePath);
    } else {
      supportVerdict = isTestSupportFile(
        filePath,
        () => resolveFullFileText(r, opts) || resolveResultText(r, opts),
      );
      if (verdictCache) verdictCache.set(filePath, supportVerdict);
    }
    if (supportVerdict) return true;
  }

  // One alternation regex instead of four scans (~30-100µs saved per result):
  //   #[cfg(test)] / #[test]  (Rust attribute)
  //   func Test<X>             (Go testing)
  //   def test_<X>             (Python unittest/pytest)
  //   it/test/describe(...)    (JS/TS suite frameworks)
  const text = resolveResultText(r, opts);
  if (TEST_CHUNK_BODY_RE.test(text)) return true;

  const name = resolveResultName(r);
  return TEST_CHUNK_NAME_RE.test(name);
}

const TEST_CHUNK_BODY_RE = /^\s*(?:#\[(?:cfg\s*\(\s*test\s*\)|test)\]|func\s+Test[A-Z]|def\s+test_|(?:it|test|describe)\s*\(\s*['"])/m;
const TEST_CHUNK_NAME_RE = /^(?:test_|Test[A-Z])|_test$/;

export function isTestSupportFile(filePath, content = '') {
  if (!filePath) return false;
  const pathRules = [
    /(^|\/)(testutil|test_util|test_utils|test_helper|test_helpers|testing_support|spec_helper)\.[a-z]+$/i,
    /(^|\/)(test|tests|spec|__tests__|__mocks__)\/[^/]*(util|helper|fixture|mock|stub|setup|harness)/i,
    /(^|\/)(testdata|fixtures|__fixtures__|test_data)\//i,
    /(^|\/)conftest\.py$/i,
    /\.test-d\.[tj]sx?$/i,
  ];
  if (pathRules.some(re => re.test(filePath))) return true;

  // Content may be a thunk so the file is not read when the path rules decide.
  const text = typeof content === 'function' ? content() : content;
  if (!text) return false;
  if (/^\s*#!\[cfg\s*\(\s*test\s*\)/m.test(text)) return true;

  const lines = text.split('\n').filter(line => line.trim());
  if (lines.length < 8) return false;
  const hasJsTestContext = /(^|\/)(test|tests|spec|__tests__)\//i.test(filePath)
    || /^\s*(describe|it|test)\s*\(/m.test(text);
  const assertionRe = hasJsTestContext
    ? /\b(assert!|assert_eq!|assert_ne!|expect\(|assertEqual|assertEquals|t\.Errorf|t\.Fatalf|t\.Helper\(\)|require\.\w+|assert\.\w+)\b/
    : /\b(assert!|assert_eq!|assert_ne!|assertEqual|assertEquals|t\.Errorf|t\.Fatalf|t\.Helper\(\))\b/;
  const assertLines = lines.filter(line => assertionRe.test(line)).length;
  return assertLines / lines.length > 0.30;
}

export function testNameQueryOverlap(r, queryTokens) {
  const name = resolveResultName(r).toLowerCase();
  if (!name) return 0;
  const nameTokens = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .split(/[_\W]+/)
    .filter(t => t.length >= 3);
  if (nameTokens.length === 0) return 0;

  let hits = 0;
  for (const token of nameTokens) {
    if (queryTokens.has(token)) hits++;
  }
  return hits / nameTokens.length;
}

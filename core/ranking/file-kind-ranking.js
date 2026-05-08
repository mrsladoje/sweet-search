import { readFileSync } from 'fs';
import path from 'path';
import { getNativeDemotionKernel } from './demotion-kernel-native.js';

/**
 * Intent-aware file-kind ranking (conservative variant).
 *
 * Background: real-codebase miss analysis found that documentation, test, and
 * TypeScript-declaration files often outrank the implementation file users
 * were actually looking for on multi-file codebases. The first version of
 * this rule (commit f6fcfd1) lifted graph-2hop R@1 from 47.46 % → 64.41 %
 * but catastrophically regressed GenCodeSearchNet under the dense profile
 * (full-6 000 dense run: MRR@10 84.4 % → 47.4 %, Recall@5 92.0 % → 48.4 %).
 * Root cause: the legacy LI-rerank pipeline assembles
 * `results = [...liScored, ...tail]`, where `liScored` carries MaxSim
 * scores that are sometimes *lower* (in absolute value) than the int8
 * cosine scores already on the un-reranked tail. The concatenated list is
 * therefore not globally score-monotonic. The old helper unconditionally
 * spread and re-sorted *all* results by `score`, which floated the
 * int8-only tail above the LI-reranked head and undid the rerank — even
 * when every multiplier was 1 (GenCodeSearchNet is a single-source
 * corpus, so no docs/tests/types kind ever matches there).
 *
 * Conservative variant fixes both regressions with three guards:
 *
 *   1. Confident-intent gating. `classifyFileKindIntent` now returns
 *      `'unknown'` for queries with no implementation-seeking signal. Only
 *      explicit `'implementation'` intent triggers demotion. `'unknown'`,
 *      `'docs'`, `'tests'`, `'types'` are no-ops.
 *
 *   2. Structural skip. The rule looks at the top-N candidates (default 30).
 *      If the window has zero docs/tests/types files (single-source corpus
 *      like GCSN) or zero implementation files (nothing to promote), the
 *      input is returned untouched. No re-sort, no new objects.
 *
 *   3. Window-bounded re-sort. When the rule does fire, only the top-N
 *      window is re-ranked. The tail — where the rerank/non-rerank score-
 *      scale boundary usually lives — is concatenated unchanged. This
 *      keeps mixed-scale damage contained.
 *
 * Disable at runtime with `SWEET_SEARCH_FILE_KIND_RANKING=0`. Tune the soft
 * factor with `SWEET_SEARCH_FILE_KIND_FACTOR` (default 0.85; range (0, 1]).
 * Tune the window with `SWEET_SEARCH_FILE_KIND_WINDOW` (default 30).
 */

const DOCS_RE  = /\.md$|\.mdx$|\.rst$|(?:^|\/)docs?\//i;
const EXAMPLES_RE = /(?:^|\/)examples?\//i;
// Tests directory patterns. Includes the standard tests?/spec/__tests__/__mocks__
// plus integration/, e2e/, fixtures?/, cypress/, playwright/ — common test-fixture
// directory conventions across JS/Python/Rust/Go that shipped without TESTS_RE
// catching them (e.g. fastify integration/server.js was mis-classified as
// 'implementation' until this update 2026-05-07).
const TESTS_RE = /(?:^|\/)(?:tests?|spec|integration|e2e|fixtures?|__tests__|__mocks__|cypress|playwright)\/|\.test\.[a-z0-9]+$|_test\.[a-z0-9]+$|\.spec\.[a-z0-9]+$|_spec\.[a-z0-9]+$|\.e2e\.[a-z0-9]+$|_e2e\.[a-z0-9]+$/i;
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
const DECLARATION_RE = /\b(function|class|struct|interface|enum|trait|fn\s+\w+|def\s+\w+|const\s+k[A-Z])\b|\btype\s+\w+\s*=/;
const EXECUTABLE_DECLARATION_RE = /\b(function|class|struct|interface|enum|trait|fn\s+\w+|def\s+\w+|func\s+\w+)\b/;
const STOPWORDS = new Set([
  'and', 'are', 'does', 'for', 'from', 'how', 'into', 'is', 'the', 'this',
  'that', 'what', 'when', 'where', 'which', 'with', 'why',
]);
const LANG_KEYWORDS = new Set([
  'class', 'const', 'def', 'enum', 'fn', 'function', 'impl', 'import',
  'interface', 'let', 'package', 'pub', 'struct', 'trait', 'type', 'use',
]);

const ENTITY_KIND_KEYWORDS = {
  enum: ['enum'],
  struct: ['struct'],
  interface: ['interface', 'trait'],
  trait: ['trait'],
  class: ['class'],
  type: ['type', 'typeAlias', 'enum', 'struct', 'trait', 'class', 'interface'],
};

// Strong implementation-seeking signals. A query that fires one of these is
// confidently asking for source code; anything else is treated as `'unknown'`.
// Curated to cover the validated guard-set queries plus common phrasings,
// without matching pure descriptive corpus prose like "Convert XML to URL List".
const IMPL_INTENT_RE = new RegExp(
  '\\b(' + [
    // English wh-questions about location/behaviour
    'where', 'what', 'how does', 'how do',
    'when',
    // Definition / implementation phrasing
    'implements?', 'implementation', 'defines?', 'definition', 'declared?',
    'decides?',
    // Code-structure nouns
    'function', 'functions', 'method', 'methods', 'class', 'classes',
    'constructor', 'module', 'library', 'crate', 'package',
    // Verbs that strongly signal a code unit
    'dispatch(?:es|er)?', 'handles?', 'handler', 'handlers',
    'bind(?:s|ing)?',
    'parses?', 'parsed', 'parser', 'parsers',
    'router?', 'routes?', 'routing',
    'redirect(?:s|ed|ing)?',
    'register(?:s|ed|ing)?',
    'builds?', 'builder', 'builders',
    'generat(?:es?|or|ors|ed|ing)',
    'creat(?:es?|or|ed|ion|ing)',
    'loads?', 'loader',
    'writes?', 'writer',
    'reads?', 'reader',
    'sends?', 'receives?',
    'computes?', 'computed',
    'encodes?', 'encoder', 'decodes?', 'decoder',
    'transforms?', 'transformer',
    'invokes?', 'calls?', 'returns?',
    'valid(?:ate|ates|ator|ation)',
    'serial(?:ize|izes|izer)', 'deserial(?:ize|izes|izer)',
    'wrap(?:s|per|ped|ping)?',
    'matchers?', 'matches?',
    'printers?', 'prints?',
    'searchers?', 'searches?',
    // Specific terms common in real-repo guard queries
    'callback', 'callbacks',
    'factory', 'factories',
    'controller', 'controllers',
    'middleware',
    'fallback', 'fallbacks',
    'entrypoint', 'entry-point', 'main',
    'init', 'initialise', 'initialize', 'initialiser', 'initializer',
    'kernel', 'engine',
    'wrapper', 'wrappers',
    'singleton',
    'factory',
    'decorator', 'decorators',
    'closure', 'closures',
  ].join('|') + ')\\b',
  'i',
);

const DOCS_INTENT_RE  = /\b(doc|docs|documentation|readme|guide|tutorial|reference|example)\b/i;
const TESTS_INTENT_RE = /\b(test|tests|spec|specs|fixture|fixtures|mock|mocks)\b/i;
const TYPES_INTENT_RE = /\b(types|interface|declaration|signature|typings|typedef)\b|\btype\s+(?:alias|declaration|definition|interface|signature)\b/i;
const ANCILLARY_INTENT_RE = /\b(config|configuration|manifest|workflow|ci|github action|labeler|toml|lockfile|package\.json)\b/i;

/**
 * Detect the file kind from a result path.
 * @returns {'docs'|'examples'|'tests'|'types'|'ancillary'|'implementation'}
 */
export function detectFileKind(filePath, opts) {
  if (!filePath || typeof filePath !== 'string') return 'implementation';
  // Per-call cache. Each filePath produces a deterministic kind; calling
  // 5 regex tests + an isTestSupportFile path-rule scan per result × per
  // demotion site burns cycles redundantly when only ~10-20 unique files
  // live in a result set. Cache keyed by file path; verdict reused.
  const cache = opts && opts._fileKindCache;
  if (cache && cache.has(filePath)) return cache.get(filePath);
  let kind;
  if (DOCS_RE.test(filePath))  kind = 'docs';
  else if (EXAMPLES_RE.test(filePath)) kind = 'examples';
  else if (TESTS_RE.test(filePath)) kind = 'tests';
  else if (isTestSupportFile(filePath)) kind = 'tests';
  else if (TYPES_RE.test(filePath)) kind = 'types';
  else if (ANCILLARY_RE.test(filePath)) kind = 'ancillary';
  else kind = 'implementation';
  if (cache) cache.set(filePath, kind);
  return kind;
}

/**
 * Detect file-kind intent of a query along the docs/tests/types/implementation
 * axis. Conservative: a query with no implementation-seeking signal returns
 * `'unknown'`, and the helper treats `'unknown'` as a no-op (just like the
 * docs/tests/types intents).
 *
 * @returns {'docs'|'tests'|'types'|'ancillary'|'implementation'|'unknown'}
 */
export function classifyFileKindIntent(query) {
  const q = (query || '').toLowerCase();
  if (!q) return 'unknown';
  // Type-seeking trumps test-seeking when both fire (existing convention).
  if (TYPES_INTENT_RE.test(q)) return 'types';
  if (DOCS_INTENT_RE.test(q))  return 'docs';
  if (TESTS_INTENT_RE.test(q)) return 'tests';
  if (ANCILLARY_INTENT_RE.test(q)) return 'ancillary';
  if (IMPL_INTENT_RE.test(q))  return 'implementation';
  return 'unknown';
}

function resolveFilePath(r) {
  return r?.file
    || r?.file_path
    || r?.path
    || r?.metadata?.file
    || r?.metadata?.file_path
    || r?.metadata?.path
    || '';
}

function inferLineCount(r) {
  const meta = r?.metadata || {};
  const start = r?.startLine ?? r?.start_line ?? meta.startLine ?? meta.start_line;
  const end = r?.endLine ?? r?.end_line ?? meta.endLine ?? meta.end_line;
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
    return end - start + 1;
  }

  const text = r?.text || r?.content || r?.code || r?.snippet || '';
  if (typeof text === 'string' && text.length > 0) {
    return text.split(/\r?\n/).length;
  }

  return Infinity;
}

function readResultSpan(r, opts = {}) {
  if (!opts.projectRoot) return '';
  const file = resolveFilePath(r);
  if (!file) return '';
  const meta = r?.metadata || {};
  const start = r?.startLine ?? r?.start_line ?? meta.startLine ?? meta.start_line;
  const end = r?.endLine ?? r?.end_line ?? meta.endLine ?? meta.end_line ?? start;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  try {
    const abs = path.resolve(opts.projectRoot, file);
    const root = path.resolve(opts.projectRoot);
    if (abs !== root && !abs.startsWith(root + path.sep)) return '';
    const lines = readFileSync(abs, 'utf8').split('\n');
    const contextStart = Math.max(1, start - 2);
    return lines.slice(contextStart - 1, end).join('\n');
  } catch {
    return '';
  }
}

function resolveResultText(r, opts = {}) {
  const inline = r?.content || r?.text || r?.code || r?.snippet;
  if (inline) return inline;
  // Per-call cache: this function is hit by 5+ demotion sub-rules per result
  // (bodyDensity, isTestChunk fallback, anomalousChunk, docCommentOnly,
  //  inferEntityKindFromText). Without memoization, each cache miss triggers
  // a full readFileSync + split('\n') on the chunk's source file — 5 file
  // reads per result × 100 results = ~500 disk reads per applyResultDemotions
  // call, which dominates the 6ms p50 cost.
  const cache = opts._resultTextCache;
  if (cache) {
    const file = resolveFilePath(r);
    const meta = r?.metadata || {};
    const start = r?.startLine ?? r?.start_line ?? meta.startLine ?? meta.start_line;
    const end = r?.endLine ?? r?.end_line ?? meta.endLine ?? meta.end_line ?? start;
    if (file && Number.isFinite(start)) {
      const key = `${file}|${start}|${Number.isFinite(end) ? end : start}`;
      if (cache.has(key)) return cache.get(key);
      const text = readResultSpan(r, opts);
      cache.set(key, text);
      return text;
    }
  }
  return readResultSpan(r, opts);
}

function resolveResultName(r) {
  return r?.metadata?.name || r?.name || '';
}

function resolveResultType(r) {
  return r?.metadata?.type || r?.type || '';
}

function normalizeType(type) {
  return String(type || '').toLowerCase();
}

function hasAblation(ablations, name) {
  return ablations instanceof Set ? ablations.has(name) : Array.isArray(ablations) && ablations.includes(name);
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
  // Per-chunk verdict cache. isTestChunk fires once per result inside the
  // demotion loop, but its inputs (filePath, chunk text, chunk name) are
  // immutable for a given (file, start, end). Cache the boolean to skip the
  // 4 chunk-text regexes + name regex on cache hits.
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
    // Per-file verdict cache. isTestSupportFile is deterministic in
    // (filePath, file content) and the file content is immutable for the
    // duration of one search() call. Without this cache, the text-scan
    // path (split/filter/per-line-regex over hundreds of lines) ran on
    // every result, dominated by ~100 results × 100µs = 10ms per
    // applyResultDemotions call. Cached, the verdict is computed at most
    // once per unique file path.
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

  // Combined alternation over the four prior single-pattern tests:
  //   #[cfg(test)] / #[test]  (Rust attribute)
  //   func Test<X>             (Go testing)
  //   def test_<X>             (Python unittest/pytest)
  //   it/test/describe(...)    (JS/TS suite frameworks)
  // V8 compiles a single alternation regex into one DFA pass over the text;
  // running four `.test()` calls forced four separate scans even when the
  // first three short-circuited successfully. Per result the saving is
  // ~30-100µs, which compounds across the per-call window (~100 results)
  // and is the dominant remaining cost in rule:testName after the verdict
  // caches eliminated repeats.
  //
  // Native fast-path: when SWEET_SEARCH_DEMOTIONS_NATIVE=1 and the
  // sweet-search-native addon is loaded, applyResultDemotions runs a
  // batch matcher over all chunk texts in one napi call (~10x faster
  // than V8 per-test for the common case) and prefills
  // opts._testChunkBodyMatchCache. This branch then reads the cached
  // verdict — the V8 regex below is the universal fallback.
  const text = resolveResultText(r, opts);
  const bodyMatchCache = opts._testChunkBodyMatchCache;
  if (bodyMatchCache) {
    const meta = r?.metadata || {};
    const start = r?.startLine ?? r?.start_line ?? meta.startLine ?? meta.start_line;
    const end = r?.endLine ?? r?.end_line ?? meta.endLine ?? meta.end_line ?? start;
    if (filePath && Number.isFinite(start)) {
      const k = `${filePath}|${start}|${Number.isFinite(end) ? end : start}`;
      if (bodyMatchCache.has(k)) {
        if (bodyMatchCache.get(k)) return true;
        // false → fall through to the name regex below
      } else if (TEST_CHUNK_BODY_RE.test(text)) {
        return true;
      }
    } else if (TEST_CHUNK_BODY_RE.test(text)) {
      return true;
    }
  } else if (TEST_CHUNK_BODY_RE.test(text)) {
    return true;
  }

  const name = resolveResultName(r);
  return TEST_CHUNK_NAME_RE.test(name);
}

const TEST_CHUNK_BODY_RE = /^\s*(?:#\[(?:cfg\s*\(\s*test\s*\)|test)\]|func\s+Test[A-Z]|def\s+test_|(?:it|test|describe)\s*\(\s*['"])/m;
const TEST_CHUNK_NAME_RE = /^(?:test_|Test[A-Z])|_test$/;

function resolveFullFileText(r, opts = {}) {
  if (!opts.projectRoot) return '';
  const file = resolveFilePath(r);
  if (!file) return '';
  // Per-call cache: this fires once per result × per isTestChunk site
  // (hybrid + postprocess). Without memoization a query touching N
  // distinct files reads each one fully ~2× per result that hits the
  // file. Keyed by file path — the file content is immutable for the
  // duration of one search() call.
  const cache = opts._fullFileTextCache;
  if (cache && cache.has(file)) return cache.get(file);
  try {
    const root = path.resolve(opts.projectRoot);
    const abs = path.resolve(root, file);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      if (cache) cache.set(file, '');
      return '';
    }
    const text = readFileSync(abs, 'utf8');
    if (cache) cache.set(file, text);
    return text;
  } catch {
    if (cache) cache.set(file, '');
    return '';
  }
}

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

  // Lazy content getter: caller passes a thunk to avoid reading the file
  // when path rules already determine the answer. Plain string still
  // accepted for back-compat with non-applyResultDemotions callers.
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

function queryTokenSet(query, queryTokens) {
  if (queryTokens instanceof Set) return queryTokens;
  if (Array.isArray(queryTokens)) return new Set(queryTokens.map(t => String(t).toLowerCase()));
  return new Set(String(query || '').toLowerCase().split(/[_\W]+/).filter(t => t.length >= 3));
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

export function entityKindPreferenceFromQuery(query) {
  const q = String(query || '').toLowerCase();
  for (const [bucket, keywords] of Object.entries(ENTITY_KIND_KEYWORDS)) {
    for (const keyword of keywords) {
      if (new RegExp(`\\b${keyword.toLowerCase()}\\b`, 'i').test(q)) return bucket;
    }
  }
  return null;
}

export function extractNameHints(query) {
  const tokens = String(query || '').match(/[A-Za-z_][A-Za-z0-9_]+/g) || [];
  const hints = new Set();
  for (const token of tokens) {
    if (token.length < 3) continue;
    if (LANG_KEYWORDS.has(token)) continue;
    if (STOPWORDS.has(token.toLowerCase())) continue;
    if (/[A-Z]/.test(token) || token.length >= 4) hints.add(token);
  }
  return hints;
}

function splitIdentifierName(name) {
  return String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\W]+/)
    .map(s => s.toLowerCase())
    .filter(Boolean);
}

function resolveEntityKindInfo(r, opts = {}) {
  const file = resolveFilePath(r);
  const meta = r?.metadata || {};
  const start = r?.startLine ?? r?.start_line ?? meta.startLine ?? meta.start_line;
  const end = r?.endLine ?? r?.end_line ?? meta.endLine ?? meta.end_line ?? start;
  // Intra-call memoization: this function is invoked 4-7x per result by
  // different multipliers (buildRefCountMap, entityKindMultiplier,
  // namePrecisionMultiplier, bodyDensityMultiplier, megaEntityPenalty,
  // referenceCountBoost, the main loop). With ~100 results that's
  // 400-1400 SQLite round-trips. Cache by (file, start, end).
  const cache = opts._entityKindCache;
  let cacheKey = null;
  if (cache && file && Number.isFinite(start)) {
    cacheKey = `${file}|${start}|${Number.isFinite(end) ? end : start}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
  }
  let result = null;
  if (opts.codeGraphRepo && file && Number.isFinite(start)) {
    try {
      const entity = opts.codeGraphRepo.findEnclosingEntity(file, start, Number.isFinite(end) ? end : start)
        || opts.codeGraphRepo.findEnclosingEntity(file, start, start);
      if (entity?.type) {
        result = entity;
      } else if (typeof opts.codeGraphRepo.findFirstEntityInRange === 'function' && Number.isFinite(end)) {
        const first = opts.codeGraphRepo.findFirstEntityInRange(file, start, end);
        if (first?.type) result = first;
      }
    } catch {
      // Fall through to source-span inference.
    }
  }
  if (!result) {
    const inferred = inferEntityKindFromText(resolveResultText(r, opts));
    result = inferred ? { type: inferred } : null;
  }
  if (cacheKey) cache.set(cacheKey, result);
  return result;
}

// Boost magnitudes are env-tunable so we can ablate without re-deploying.
// Defaults softened (2026-05-05) from (1.25, 0.85, 1.20, 1.05) to
// (1.10, 0.90, 1.10, 1.03) after a 16-query 3-config ablation showed
// 15 of 16 top-1 results unchanged at the lower magnitudes — less
// leverage = less interaction risk with name-precision and other
// signals, with no observed quality loss. The stronger old values
// remain reachable via env vars if a future probe shows they help.
function envFloat(name, dflt) {
  const v = process.env[name];
  if (v == null || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

function entityKindMultiplier(r, preferred, opts = {}) {
  if (!preferred) return 1;
  const kindBoost = envFloat('SWEET_SEARCH_KIND_BOOST', 1.10);
  const kindDemote = envFloat('SWEET_SEARCH_KIND_DEMOTE', 0.90);
  const wantSet = new Set((ENTITY_KIND_KEYWORDS[preferred] || []).map(normalizeType));
  const inferred = resolveEntityKindInfo(r, opts)?.type || '';
  const recorded = normalizeType(resolveResultType(r));
  const type = recorded && recorded !== 'code' && recorded !== 'chunk' ? recorded : normalizeType(inferred);
  if (wantSet.has(type) || (type === 'typealias' && preferred === 'type')) return kindBoost;
  if ((type === 'impl' || type === 'method' || type === 'function') && preferred !== 'function') return kindDemote;
  return 1;
}

function namePrecisionMultiplier(r, preferred, nameHintsLower, opts = {}) {
  if (!preferred || nameHintsLower.size === 0) return 1;
  const exactBoost = envFloat('SWEET_SEARCH_NAME_EXACT_BOOST', 1.10);
  const substrBoost = envFloat('SWEET_SEARCH_NAME_SUBSTR_BOOST', 1.03);
  const wantSet = new Set((ENTITY_KIND_KEYWORDS[preferred] || []).map(normalizeType));
  const entityInfo = resolveEntityKindInfo(r, opts);
  const recorded = normalizeType(resolveResultType(r));
  const type = recorded && recorded !== 'code' && recorded !== 'chunk'
    ? recorded
    : normalizeType(entityInfo?.type);
  if (!wantSet.has(type) && !(type === 'typealias' && preferred === 'type')) return 1;

  const name = resolveResultName(r) || entityInfo?.name || '';
  if (!name) return 1;
  if (nameHintsLower.has(name.toLowerCase())) return exactBoost;
  const nameTokens = splitIdentifierName(name);
  for (const hint of nameHintsLower) {
    if (nameTokens.includes(hint)) return substrBoost;
  }
  return 1;
}

function exactNamedEntityForResult(r, preferred, nameHints, nameHintsLower, opts = {}) {
  if (!opts.codeGraphRepo || !preferred || nameHintsLower.size === 0) return null;
  const file = resolveFilePath(r);
  if (!file) return null;
  const types = ENTITY_KIND_KEYWORDS[preferred] || [];
  try {
    const entities = (typeof opts.codeGraphRepo.findEntitiesByNamesCaseInsensitive === 'function'
      ? opts.codeGraphRepo.findEntitiesByNamesCaseInsensitive([...nameHintsLower], {
          types,
          limit: 16,
        })
      : opts.codeGraphRepo.findEntitiesByNames([...nameHints], {
          types,
          limit: 16,
        })) || [];
    const sameFile = entities.find(entity =>
      (entity.filePath || entity.file) === file && nameHintsLower.has(String(entity.name || '').toLowerCase())
    );
    return sameFile || null;
  } catch {
    return null;
  }
}

function inferEntityKindFromText(text) {
  if (!text) return '';
  if (/^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+\w+/m.test(text)) return 'enum';
  if (/^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+\w+/m.test(text)) return 'struct';
  if (/^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+\w+/m.test(text)) return 'trait';
  if (/^\s*impl(?:\s*<[^>]+>)?\s+\w+/m.test(text)) return 'impl';
  if (/^\s*(?:export\s+)?(?:abstract\s+)?class\s+\w+/m.test(text)) return 'class';
  if (/^\s*(?:export\s+)?interface\s+\w+/m.test(text)) return 'interface';
  if (/^\s*(?:export\s+)?type\s+\w+\s*=/m.test(text)) return 'typealias';
  return '';
}

// Declarative / doc-string-heavy chunk demotion (added 2026-05-05).
//
// Three narrow, independent content-shape triggers — each catches a specific
// failure shape observed in the May-05 novel-probe analysis:
//
//   T1. Declarative-entity demotion. When the chunk's primary entity type is
//       `namespace`, `interface`, or `typeAlias`, the chunk is by definition
//       a declaration block — signatures / property decls without behaviour.
//       Such chunks should not outrank `function`/`impl` chunks for
//       procedural queries. Catches the .d.ts namespace / interface case.
//
//   T2. Raw-string-dominant impl. When > 50 % of an `impl` chunk's non-blank
//       characters live inside Rust raw-string literals (`r#"..."#`,
//       `r"..."`), the chunk is mostly documentation. Catches clap-style
//       flag impls whose `doc_long()` returns a 30-line description (e.g.
//       `impl Flag for SearchZip`).
//
//   T3. Stub-impl. Multiple `fn` definitions in an `impl` chunk with avg
//       body line count < 4. Catches clap-style impls whose individual
//       `doc_long()` is small enough to escape T2 but whose methods are
//       still mostly 1-line literal returns (e.g. `impl Flag for
//       CaseSensitive`).
//
// All three triggers are intent-gated to `implementation` queries, so a
// phrasing like "what is the FastifyInstance interface" — which legitimately
// wants a declaration — is unaffected. T2/T3 are also restricted to chunks
// whose primary entity type is `impl` to avoid touching anything outside
// the Rust idiom we're targeting.
//
// Defaults are conservative. An earlier "execution density" heuristic
// (penalise any chunk with low control-flow ratio) over-fired on data-
// declaration chunks like `lib/errors.js` constant tables, which are the
// genuinely-correct answer for "how does Fastify handle errors". The
// triggers here are shape-specific instead of density-specific.
//
// Disable everything with `ablations: 'no-body-density'` or
// SWEET_SEARCH_BODY_DENSITY=0; per-trigger overrides via
// SWEET_SEARCH_DECLARATIVE_FACTOR / SWEET_SEARCH_RAWSTRING_FACTOR /
// SWEET_SEARCH_STUB_FACTOR.
const DECLARATIVE_ENTITY_TYPES = new Set(['namespace', 'interface', 'typealias']);

function envFloatRange(name, dflt) {
  const v = process.env[name];
  if (v == null || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : dflt;
}

/**
 * Detect whether a Rust `impl` chunk is a "stub impl" — fn definitions with
 * no real body. Catches two patterns:
 *
 *  (A) MULTI-METHOD stubs (original ac280d4 case): clap-style flag-arg impls
 *      where every method is a 1-line literal return (e.g. `impl Flag for
 *      CaseSensitive` whose 6 methods total ~6 body lines), independent of
 *      whether `doc_long` carries a big raw-string description.
 *
 *  (B) SINGLE-METHOD trivial-body stubs (added 2026-05-07 — FreshStack uv
 *      UV-FLOW-8 diagnosis): derive-equivalent impls like
 *      `impl Clone for X { fn clone(&self) -> Self { Self {...} } }` with a
 *      body of < 2 substantive lines. The original rule required ≥2 fns and
 *      missed these single-method derive-style impls. Worth being conservative
 *      here — Display::fmt is usually 3+ lines, From::from sometimes IS 1
 *      line and is genuinely trivial. The 1.5-line cutoff fires only on
 *      truly stub-grade single-fns (closer to derive macros than real impls).
 *
 * Returns the estimated average body line count, or `Infinity` if the chunk
 * contains no fn definitions. Lower = more stub-like.
 */
export function avgFnBodyLines(text) {
  if (typeof text !== 'string' || text.length === 0) return Infinity;
  const fnRe = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+|const\s+|unsafe\s+)*fn\s+\w+/gm;
  const matches = [];
  let m;
  while ((m = fnRe.exec(text)) !== null) matches.push(m.index);
  if (matches.length === 0) return Infinity;
  let totalBodyLines = 0;
  let counted = 0;
  for (const startIdx of matches) {
    // Find the opening `{` after this fn signature.
    const openIdx = text.indexOf('{', startIdx);
    if (openIdx === -1) continue;
    // Walk braces to find the matching close.
    let depth = 1;
    let j = openIdx + 1;
    let inString = false;
    let stringTerm = null;
    while (j < text.length && depth > 0) {
      const ch = text[j];
      if (inString) {
        if (ch === '\\') { j += 2; continue; }
        if (ch === stringTerm) inString = false;
      } else {
        if (ch === '"' || ch === "'") { inString = true; stringTerm = ch; }
        else if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
      j++;
    }
    if (depth !== 0) continue;
    const body = text.slice(openIdx + 1, j - 1);
    const bodyLines = body.split('\n').filter(l => l.trim().length > 0).length;
    totalBodyLines += bodyLines;
    counted++;
  }
  if (counted === 0) return Infinity;
  // Single-fn impls with ≤1.5 substantive body lines (1 trivial line plus
  // the closing brace, or a 1-line `Self { ... }` body) are derive-equivalent
  // stubs (UV-FLOW-8 case: `impl Clone for X { fn clone(&self) -> Self { Self {...} } }`).
  // Multi-fn impls keep the original average-body rule.
  if (counted === 1) {
    return totalBodyLines <= 1.5 ? totalBodyLines : Infinity;
  }
  return totalBodyLines / counted;
}

/**
 * Estimate the fraction of a chunk's characters that live inside Rust
 * raw-string literals. Returns a number in [0, 1].
 *
 * Heuristic: scan the text once tracking entry into `r#"`/`r"` regions and
 * exit at the matching `"#`/`"`. Counts only the inner payload chars.
 */
export function rawStringDensity(text) {
  if (typeof text !== 'string' || text.length === 0) return 0;
  let i = 0;
  let inside = 0;
  let total = 0;
  const len = text.length;
  while (i < len) {
    if (!/\s/.test(text[i])) total++;
    // Detect `r#*"` opener.
    if (text[i] === 'r' && (text[i + 1] === '"' || text[i + 1] === '#')) {
      let j = i + 1;
      let hashCount = 0;
      while (text[j] === '#') { hashCount++; j++; }
      if (text[j] === '"') {
        // We're inside a raw string. Find the matching close.
        const closeNeedle = '"' + '#'.repeat(hashCount);
        const closeAt = text.indexOf(closeNeedle, j + 1);
        if (closeAt === -1) {
          // unterminated — count rest of file as inside
          for (let k = j + 1; k < len; k++) {
            if (!/\s/.test(text[k])) { inside++; total++; }
          }
          return total === 0 ? 0 : inside / total;
        }
        for (let k = j + 1; k < closeAt; k++) {
          if (!/\s/.test(text[k])) { inside++; total++; }
        }
        i = closeAt + closeNeedle.length;
        continue;
      }
    }
    i++;
  }
  return total === 0 ? 0 : inside / total;
}

/**
 * Mega-chunk size penalty (added 2026-05-07 — 60-probe diagnosis).
 *
 * Long candidate chunks (entire 1500-line classes, 700-line module
 * functions) systematically outscore precise 30-line chunks even when the
 * latter contain the actual answer. The dense bi-encoder doesn't penalise
 * length the way BM25's `b` parameter does, so a mega-chunk that touches
 * many topics earns a moderate similarity to many queries.
 *
 * SOTA precedent: BM25 length normalization (Robertson & Zaragoza 2009),
 * subsequently incorporated as length penalties in dense rerankers
 * (ColBERTv2 token-budget caps, MS-MARCO-tuned cross-encoders). Soft
 * piecewise-linear here rather than `1/(1 + b·L/L_avg)` because (a) we
 * lack a per-corpus L_avg estimate at query time and (b) BM25-style
 * normalization is too aggressive for long behavioural-flow chunks where
 * length carries some signal.
 *
 * Tuning floor/slope to be PERMISSIVE — ONLY truly mega chunks lose score:
 *   - L ≤ 500 lines → factor 1.0 (no penalty — every reasonable function chunk)
 *   - L = 800       → ~0.91 (typical large class)
 *   - L = 1000      → ~0.85
 *   - L ≥ 1500      → 0.80 (floor — entire-file chunks)
 *
 * Tightened cutoff from 200 → 500 after S6-Q6 gin regression: a 40-line
 * `New` function had been the right top-1, but penalising 200+ chunks
 * shifted the within-file ranking. 500-line cutoff exempts every legit
 * function/method chunk and only demotes whole-class megachunks.
 *
 * Override via env: SWEET_SEARCH_MEGA_CHUNK_CUTOFF (default 500),
 * SWEET_SEARCH_MEGA_CHUNK_SLOPE (default 0.0003 per-line),
 * SWEET_SEARCH_MEGA_CHUNK_FLOOR (default 0.80). Disable via
 * SWEET_SEARCH_MEGA_CHUNK_FLOOR=1 (no-op) or
 * `ablations: ['no-mega-chunk-penalty']`.
 *
 * Diagnosed cases (60-probe new-set):
 *   - S5-Q10 flask: 1516-line `class Flask` chunk beat 30-line `abort` fn
 *   - S4-Q2 fastify: 735-line `function fastify` chunk beat 1-line
 *     `kRouteContext` symbol declaration
 */
/**
 * Symbol-exact-match boost for definition-style queries.
 *
 * Added 2026-05-07 — both diagnoses (FreshStack uv #1, 60-probe new-set #1)
 * converged on this as the highest-impact fix. When a query has the shape
 * "show me X struct/enum/class/function/...", chunks where the symbol name
 * EQUALS X (case-insensitive, after stemming s/es/ing suffixes) should
 * dominate the lexical-collision sibling chunk that the encoder happens
 * to score nearby.
 *
 * Diagnosed cases (combined): Cache vs CacheArgs (UV-DEF-1), Resolver vs
 * Resolution (UV-DEF-4), ContentTypeParser vs ContentType (S6-Q2),
 * Flask vs App (S6-Q9), buildErrorHandler vs setErrorHeaders (S6-Q3),
 * Set method vs Value method (S3-Q6), get_send_file_max_age vs
 * send_static_file (S3-Q9). 8+ failures in the new-probe set, 4 in
 * FreshStack — strong evidence of a real systematic gap.
 *
 * SOTA precedent: BM25F field-weighted boosting on the symbol field
 * (canonical IR move when one field carries decisive signal); ColBERTv2
 * "expansion-aware reranking" with identifier prior; Sourcegraph Cody's
 * "hint" tokens that bias toward exact symbol matches in graph-aware
 * retrieval (Cody arXiv 2408.05344).
 *
 * Trigger pattern (conservative — only fires on UNAMBIGUOUS definition
 * queries):
 *   /\b(show|give|find|describe|display|fetch).+?(?:the\s+)?(\w+)\s+
 *    (struct|enum|class|fn|function|method|trait|type|interface|impl|
 *     definition|signature|prototype|constructor)\b/i
 *
 * Plus a "WHAT IS X TYPE" alternate trigger:
 *   /\bwhat\s+(?:is|does)\s+(?:the\s+)?(\w+)\s+
 *    (struct|enum|class|function|method|type)\b/i
 *
 * Boost: 1.30× when chunk.symbol case-insensitive-equals the captured
 * identifier. Capped at 1.30 (mild — definition queries account for ≤25%
 * of probe traffic so a stronger boost risks breaking non-DEF queries).
 *
 * Override env: SWEET_SEARCH_SYMBOL_EXACT_BOOST (default 1.30, set to 1.0
 * to disable). `ablations: ['no-symbol-exact-boost']` also disables.
 */
// Lazy quantifier on the prefix so the capture greedily prefers an
// identifier-like noun (buildErrorHandler) over a keyword that happens
// to also be in the trailing list (function/definition). Verified
// 2026-05-07: greedy version captured "function" for
// "show me the buildErrorHandler function definition in full",
// missing the contained-entity boost on S6-Q3. But lazy also fails on
// "show me the full Engine struct" (captures "the"/"full") — which is
// why extractSymbolDefinitionTarget tries lazy first and falls back to
// greedy when the lazy capture is a stopword.
const SYMBOL_DEFN_QUERY_RE = new RegExp(
  '\\b(?:show|give|find|describe|display|fetch|see)' +
  '(?:\\s+\\w+){0,5}?\\s+' +
  '(?:the\\s+)?' +
  '(\\w+)' +
  '(?:\\s+\\w+)?\\s+' +
  '(?:struct|enum|class|fn|function|method|trait|type|interface|impl|' +
  'definition|signature|prototype|constructor)\\b',
  'i'
);
const SYMBOL_DEFN_QUERY_RE_GREEDY = new RegExp(
  '\\b(?:show|give|find|describe|display|fetch|see)' +
  '(?:\\s+\\w+){0,5}\\s+' +
  '(?:the\\s+)?' +
  '(\\w+)' +
  '(?:\\s+\\w+)?\\s+' +
  '(?:struct|enum|class|fn|function|method|trait|type|interface|impl|' +
  'definition|signature|prototype|constructor)\\b',
  'i'
);
const SYMBOL_WHATIS_QUERY_RE = new RegExp(
  '\\bwhat\\s+(?:is|does|are)\\s+(?:the\\s+)?' +
  '(\\w+)\\s+' +
  '(?:struct|enum|class|function|method|type|trait|interface|' +
  'renderer|handler|component|service|module|controller|provider|builder)\\b',
  'i'
);
// "where is the X function/method/struct" pattern — captures probe-style queries
// like S3-Q4 "where is the Default function..." and S3-Q6 "where is the Set
// method on Context...". Added 2026-05-07 after F7 trace showed extractSymbolDefinitionTarget
// returned null for these queries, missing the contained-entity boost.
const SYMBOL_WHERE_QUERY_RE = new RegExp(
  '\\bwhere\\s+(?:is|does)\\s+(?:the\\s+)?' +
  '(\\w+)\\s+' +
  '(?:struct|enum|class|fn|function|method|trait|type|interface|impl|' +
  'definition|signature|prototype|constructor)\\b',
  'i'
);

// Identifier-shape heuristic: code identifiers across all languages
// commonly use one of: uppercase letters (PascalCase / camelCase),
// underscores (snake_case), hyphens (kebab-case), or digits. Plain
// English adjectives / determiners ("the", "complete", "every") fall
// outside this shape. This is more principled than a curated stopword
// list — it generalizes to non-English languages, avoids removing
// real lowercase identifiers like Rust `lock` / Python `commit` (which
// stay as final-fallback when no identifier-shape candidate exists),
// and doesn't require maintaining a word list. Long-term, swap for a
// small POS classifier if false-positive identifier captures appear.
function looksLikeIdentifier(name) {
  if (!name || name.length < 3) return false;
  return /[A-Z_\-0-9]/.test(name);
}

function extractSymbolDefinitionTarget(query) {
  if (!query || typeof query !== 'string') return null;
  const candidates = [];
  for (const re of [SYMBOL_DEFN_QUERY_RE, SYMBOL_DEFN_QUERY_RE_GREEDY, SYMBOL_WHATIS_QUERY_RE, SYMBOL_WHERE_QUERY_RE]) {
    const m = query.match(re);
    if (m && m[1] && m[1].length >= 3) candidates.push(m[1]);
  }
  if (candidates.length === 0) return null;
  // Prefer identifier-shape captures (uppercase / underscore / digit) over
  // plain lowercase English captures. Falls back to first capture if no
  // identifier-shape candidate found (catches lowercase identifiers like
  // Rust `lock` or Python `commit`).
  const idShape = candidates.find(looksLikeIdentifier);
  return idShape || candidates[0];
}

/**
 * Path-token boost (added 2026-05-07 — 60-probe diagnosis NEW pattern).
 *
 * When a query mentions a crate / module / package name (e.g. "in globset",
 * "in render package", "from binding/json"), boost candidates whose file
 * path contains that token. Same Sourcegraph BM25F principle as the
 * symbol boost: filename matches are a strong field-level signal that
 * dense embedding alone underweights.
 *
 * SOTA: BM25F filename field weighting (Sourcegraph "Keeping it boring..."
 * April 2025). Quote: "we should be able to use these indexes to reward
 * symbol and FILENAME matches... think of contents, symbols, and filenames
 * as different 'fields' within a file." See docs/SOTA_RESEARCH_2026_FIXES.md.
 *
 * Diagnosed cases (60-probe new-set #4): ripgrep S6-Q8 (two `Glob` structs
 * in different crates — symbol-exact alone CANNOT disambiguate; the query
 * said "in globset" so paths containing /globset/ should win).
 *
 * Trigger pattern: extract bare path-like tokens after a path preposition
 *   /\b(?:in|from|inside|under|within)\s+(\w[\w/-]*)\b/gi
 *
 * Only fires on tokens of length ≥ 4 (avoid trivial "in"/"on") and not
 * common English stopwords. Boost: 1.20× when path contains the token
 * (case-insensitive substring match on the path string). Mild magnitude
 * because path tokens are softer signals than symbol-exact matches.
 *
 * Override env: SWEET_SEARCH_PATH_TOKEN_BOOST (default 1.20). Disable
 * with `ablations: ['no-path-token-boost']`.
 */
const PATH_TOKEN_QUERY_RE = /\b(?:in|from|inside|under|within|of)\s+([a-z][\w-]*(?:[\/-][\w-]+)*)\b/gi;
const PATH_TOKEN_STOPWORDS = new Set([
  'the', 'this', 'that', 'these', 'those', 'them', 'their', 'they',
  'when', 'while', 'where', 'with', 'without', 'have', 'been', 'each',
  'and', 'but', 'for', 'all', 'any', 'some', 'can', 'will', 'would',
  'fact', 'case', 'order', 'time', 'turn', 'fact',
]);

function extractPathTokens(query) {
  if (!query || typeof query !== 'string') return [];
  const tokens = [];
  let m;
  PATH_TOKEN_QUERY_RE.lastIndex = 0;
  while ((m = PATH_TOKEN_QUERY_RE.exec(query)) !== null) {
    const tok = m[1];
    if (!tok || tok.length < 4) continue;
    if (PATH_TOKEN_STOPWORDS.has(tok.toLowerCase())) continue;
    tokens.push(tok.toLowerCase());
  }
  return tokens;
}

function pathTokenBoost(result, pathTokens, opts = {}) {
  if (!pathTokens || pathTokens.length === 0) return 1.0;
  const raw = process.env.SWEET_SEARCH_PATH_TOKEN_BOOST;
  let boost = opts.pathTokenBoost ?? 1.20;
  if (raw != null && raw !== '') {
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n) && n >= 1.0 && n <= 2.0) boost = n;
  }
  if (boost === 1.0) return 1.0;
  const path = String(result?.file || result?.metadata?.file || '').toLowerCase();
  if (!path) return 1.0;
  // Match token as path component (separator-bounded) — avoid spurious
  // substring matches like "iter" matching inside "literator".
  for (const tok of pathTokens) {
    const re = new RegExp('(^|[/_-])' + tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[/_.-])');
    if (re.test(path)) return boost;
  }
  return 1.0;
}

function symbolExactMatchBoost(result, target, opts = {}) {
  if (!target) return 1.0;
  const raw = process.env.SWEET_SEARCH_SYMBOL_EXACT_BOOST;
  let boost = opts.symbolExactBoost ?? 1.30;
  if (raw != null && raw !== '') {
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n) && n >= 1.0 && n <= 2.0) boost = n;
  }
  if (boost === 1.0) return 1.0;

  const symbol = result?.name
    || result?.metadata?.name
    || result?.entity?.name
    || result?.symbol
    || '';
  const tLower = target.toLowerCase();
  const norm = (s) => s.replace(/[_-]/g, '').toLowerCase();
  if (symbol) {
    const sLower = String(symbol).toLowerCase();
    if (sLower === tLower) return boost;
    if (norm(sLower) === norm(tLower)) return boost;
  }
  // F7 (2026-05-07): chunk's labeled symbol may not match the target, but a
  // sibling entity contained inside the chunk range may match. Diagnosed from
  // S6-Q3 (fastify): chunk 103-150 contains both fallbackErrorHandler AND
  // buildErrorHandler at lines 142-150; chunker labeled it fallbackErrorHandler.
  // Query "show me the buildErrorHandler function definition" extracts target
  // "buildErrorHandler" — the contained-entity check finds it and applies the
  // same 1.30× boost so the chunk wins over adjacent setErrorHeaders chunk.
  if (opts.codeGraphRepo && typeof opts.codeGraphRepo.hasEntityWithNameInRange === 'function') {
    const filePath = resolveFilePath(result);
    const meta = result?.metadata ?? {};
    const startLine = Number(result?.startLine ?? meta.startLine);
    const endLine = Number(result?.endLine ?? meta.endLine);
    if (filePath && Number.isFinite(startLine) && Number.isFinite(endLine)) {
      try {
        if (opts.codeGraphRepo.hasEntityWithNameInRange(filePath, startLine, endLine, target)) {
          return boost;
        }
      } catch { /* fall through */ }
    }
  }
  return 1.0;
}

/**
 * Demote anomalous chunks: anonymous (symbol==null) AND symbolType==='code',
 * AND either file-header (startLine===1, e.g. file-imports leak) OR tiny
 * (span<5 lines, e.g. bare impl-header text). These chunks bypass the entity
 * DB (sparse/grep fallback or chunker leak) and shouldn't surface as top-1.
 *
 * Predicate verified 2026-05-07 against live probe + FreshStack PARTIALs:
 * legitimate symbol-mislabel cases (S3-Q2, S4-Q1, S6-Q4, S3-Q8) all have
 * span >20 lines and startLine deep in file — they pass through unaffected.
 *
 * Demote (×0.10) rather than filter so a single-anomalous-result fallback
 * still surfaces the chunk if nothing else matches.
 */
function anomalousChunkDemotion(result, opts = {}) {
  if (process.env.SWEET_SEARCH_NO_ANOMALOUS_CHUNK_DEMOTION === '1') return 1.0;
  if (hasAblation(opts.ablations, 'no-anomalous-chunk-demotion')) return 1.0;
  // Format-gated: GCSN-style NL queries hit many file-start anonymous code
  // chunks that are actually correct answers; ungated, this demotion drops
  // GCSN dev MRR by ~27pp. Agent-format queries (probes/FreshStack) don't
  // expect file-header content as the answer.
  if (!opts._isAgentFormat) return 1.0;
  const meta = result?.metadata ?? {};
  const sym = result?.symbol ?? meta.symbol ?? meta.name ?? null;
  if (sym !== null && sym !== '' && sym !== undefined) return 1.0;
  const symbolType = result?.symbolType ?? result?.type ?? meta.type ?? null;
  if (symbolType !== 'code') return 1.0;
  const startLine = Number(result?.startLine ?? meta.startLine ?? meta.line_start);
  const endLine = Number(result?.endLine ?? meta.endLine ?? meta.line_end);
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return 1.0;
  const isFileHeader = startLine === 1;
  const isTinySpan = (endLine - startLine) < 5;
  if (!isFileHeader && !isTinySpan) return 1.0;
  return opts.anomalousChunkFactor ?? 0.10;
}

/**
 * Mega-entity penalty (F1, 2026-05-07): when a chunk's enclosing entity
 * (e.g. function fastify @ 735 lines, Flask App class @ 1516 lines) exceeds
 * a configurable cap, demote the chunk's score. The fix targets the post-
 * retrieval envelope-bloat pattern from the taxonomy: small chunks score
 * highly because they're packed with token-dense surfaces from a mega-fn,
 * and presentation later expands them into a 700+ line envelope.
 *
 * Format-gated (agent only): GCSN single-function NL queries shouldn't
 * be affected by entity envelope sizes.
 *
 * Off by default (Infinity); calibrated via SWEET_SEARCH_MAX_ENVELOPE_LINES
 * env var or opts.maxEnvelopeLines.
 */
// Loop-invariant resolution of the env-controlled envelope cap. Computed
// once per applyResultDemotions call (see ruleOpts setup) and stashed on
// opts._megaEnvelopeMax to avoid the env+parseInt+default lookup per
// result. Resolver returns -1 to mean "skip the rule entirely" (when the
// env var is set to a non-positive/non-finite value).
function resolveMaxEnvelopeLines(opts) {
  if (typeof opts._megaEnvelopeMax === 'number') return opts._megaEnvelopeMax;
  const raw = process.env.SWEET_SEARCH_MAX_ENVELOPE_LINES;
  if (raw != null && raw !== '') {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
    return -1;
  }
  // Default 500: calibrated 2026-05-07 on 60-probe + FreshStack uv + GCSN dev/held-out.
  // Cap=500 yields +1 PASS on probes (S5-Q9 Flask Scaffold) and +1 FAIL→PARTIAL on
  // FreshStack uv (UV-NL-2 do_lock) with zero regression on GCSN. Smaller caps
  // regressed FreshStack; larger caps yielded no further gain.
  return opts.maxEnvelopeLines ?? 500;
}

function megaEntityPenalty(result, opts = {}) {
  if (!opts._isAgentFormat) return 1.0;
  if (hasAblation(opts.ablations, 'no-mega-entity-penalty')) return 1.0;
  const maxEnvelopeLines = resolveMaxEnvelopeLines(opts);
  if (maxEnvelopeLines <= 0 || !Number.isFinite(maxEnvelopeLines)) return 1.0;
  if (!opts.codeGraphRepo || typeof opts.codeGraphRepo.findEnclosingEntity !== 'function') {
    return 1.0;
  }
  // Route through resolveEntityKindInfo so we hit the search-scoped
  // _entityKindCache instead of going to SQLite again. The cached entity
  // carries startLine/endLine which is all this rule needs.
  const entity = resolveEntityKindInfo(result, opts);
  if (!entity || !Number.isFinite(entity.startLine) || !Number.isFinite(entity.endLine)) return 1.0;
  const entityLines = (entity.endLine - entity.startLine) + 1;
  if (entityLines <= maxEnvelopeLines) return 1.0;
  const factor = opts.megaEntityFactor ?? 0.85;
  return factor;
}

/**
 * Doc-comment-only chunk demotion (F6, 2026-05-07).
 *
 * Detects chunks whose content is predominantly doc-comments without any
 * executable type/function declarations. Diagnosed from S3-Q8 ripgrep
 * (walk.rs:434-469): the chunker split WalkBuilder's 48-line docstring
 * across two chunks; the docstring-only chunk lexically matched
 * "WalkBuilder" + "directory iterator" and out-ranked the chunk that
 * actually contained the `pub struct WalkBuilder` declaration.
 *
 * Predicate: doc-comment lines / total non-blank lines > 0.85 AND no
 * declaration keywords (pub struct/fn/impl/enum/trait/class/def/function).
 *
 * Format-gated to agent: GCSN-style queries don't reliably target docs vs
 * code, and over-demoting comment-heavy chunks could regress. Format-gated
 * keeps it safe per the CLAUDE.md format-gating principle.
 */
const DOC_COMMENT_LINE_RE = /^\s*(?:\/\/[\/!]|\/\*\*?|\*\s|"""|'''|#'\s|#\s|--\s|--\|)/;
const DECL_KEYWORD_RE = /\b(?:pub\s+)?(?:struct|enum|trait|impl|mod)\b|\bfn\s+\w|\bclass\s+\w|\bdef\s+\w|\bfunction\s+\w|\binterface\s+\w|^\s*(?:export\s+)?(?:async\s+)?function\b/;
function docCommentOnlyDemotion(result, opts = {}) {
  if (!opts._isAgentFormat) return 1.0;
  if (hasAblation(opts.ablations, 'no-doc-comment-demote')) return 1.0;
  const text = resolveResultText(result, opts);
  if (!text || text.length < 80) return 1.0;
  const lines = text.split(/\r?\n/);
  let docLines = 0;
  let nonBlankLines = 0;
  let hasDecl = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    nonBlankLines++;
    if (DOC_COMMENT_LINE_RE.test(line)) {
      docLines++;
    } else if (DECL_KEYWORD_RE.test(trimmed)) {
      hasDecl = true;
      break;
    }
  }
  if (hasDecl) return 1.0;
  if (nonBlankLines < 5) return 1.0;
  if (docLines / nonBlankLines < 0.85) return 1.0;
  return opts.docCommentOnlyFactor ?? 0.70;
}

function megaChunkSizePenalty(result, opts = {}) {
  const floor = (() => {
    const raw = process.env.SWEET_SEARCH_MEGA_CHUNK_FLOOR;
    if (raw == null || raw === '') return opts.megaChunkFloor ?? 0.80;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : (opts.megaChunkFloor ?? 0.80);
  })();
  if (floor >= 1.0) return 1.0;  // disabled
  const cutoff = (() => {
    const raw = process.env.SWEET_SEARCH_MEGA_CHUNK_CUTOFF;
    if (raw == null || raw === '') return opts.megaChunkCutoff ?? 500;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : (opts.megaChunkCutoff ?? 500);
  })();
  const slope = (() => {
    const raw = process.env.SWEET_SEARCH_MEGA_CHUNK_SLOPE;
    if (raw == null || raw === '') return opts.megaChunkSlope ?? 0.0003;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) && n >= 0 && n <= 0.01 ? n : (opts.megaChunkSlope ?? 0.0003);
  })();

  const lineCount = inferLineCount(result);
  if (!Number.isFinite(lineCount) || lineCount <= cutoff) return 1.0;
  return Math.max(floor, 1.0 - slope * (lineCount - cutoff));
}

function bodyDensityMultiplier(result, opts = {}) {
  if (process.env.SWEET_SEARCH_BODY_DENSITY === '0'
      || process.env.SWEET_SEARCH_BODY_DENSITY === 'false') {
    return 1;
  }
  // Procedural-intent gate: a query asking "what is the X interface" should
  // not penalize declaration chunks.
  const intent = opts.intent || classifyFileKindIntent(opts.query || '');
  if (intent !== 'implementation') return 1;

  // Trigger 1: declarative-entity types. Cheap — uses already-known metadata.
  const recordedType = normalizeType(resolveResultType(result));
  const inferredType = recordedType && recordedType !== 'code' && recordedType !== 'chunk'
    ? recordedType
    : normalizeType(resolveEntityKindInfo(result, opts)?.type);
  let mult = 1;
  if (DECLARATIVE_ENTITY_TYPES.has(inferredType)) {
    const declFactor = envFloatRange('SWEET_SEARCH_DECLARATIVE_FACTOR', 0.85);
    mult *= declFactor;
  }

  // Triggers 2 & 3: text-content-derived signals for `impl` chunks.
  // Both target Rust impl blocks specifically because the failure shape
  // we observed (clap-style flag-arg impls) is a Rust idiom — it doesn't
  // exist in JS/TS/Go/Python.
  //
  //   2. Raw-string-dominant — > rsThreshold of non-blank chars live inside
  //      a Rust raw-string literal. Catches impls where `doc_long()` is a
  //      large `r#"..."#` description (e.g. `impl Flag for SearchZip`).
  //
  //   3. Stub-impl — multiple fn defs with avg body line count < stubMaxLines.
  //      Catches impls where every method is a 1-line literal return
  //      (e.g. `impl Flag for CaseSensitive` whose 6 methods total ~6 body
  //      lines), independent of doc string size.
  //
  // Both apply 0.85× by default. They MAY stack on a chunk that hits both,
  // but the combined factor (~0.72) is still milder than the existing
  // doc/test demotion (0.35) so a true impl chunk that wrongly trips one
  // of these can still recover via other signals.
  if (inferredType === 'impl') {
    const text = resolveResultText(result, opts);
    if (text && text.length > 200) {
      const rsDensity = rawStringDensity(text);
      const rsThreshold = envFloatRange('SWEET_SEARCH_RAWSTRING_THRESHOLD', 0.50);
      if (rsDensity > rsThreshold) {
        const rsFactor = envFloatRange('SWEET_SEARCH_RAWSTRING_FACTOR', 0.85);
        mult *= rsFactor;
      }

      const avgBody = avgFnBodyLines(text);
      // Threshold of 4.0 catches:
      //   - CaseSensitive impl in ripgrep (avg body ≈ 2.6 incl. raw-string lines)
      //   - SearchZip impl in ripgrep      (avg body ≈ 3.8)
      //   - Other clap-style flag-arg impls with mostly 1-line literal returns
      // While leaving alone real impls — Display/Iterator/Builder typically
      // have avg body ≥ 5 lines because their core methods are non-trivial.
      const stubMax = envFloatRange('SWEET_SEARCH_STUB_MAX_LINES', 4.0);
      if (avgBody < stubMax) {
        const stubFactor = envFloatRange('SWEET_SEARCH_STUB_FACTOR', 0.85);
        mult *= stubFactor;
      }
    }
  }

  return mult;
}

// Reference-count boost (added 2026-05-05). Aider-style behavioural-graph
// signal: chunks whose primary entity is invoked from many call sites get
// a small log-scaled boost, capped low enough that it can't dominate
// embedding scores.
//
// Why this matters. The bi-encoder ranks `lib/decorate.js`'s `decorate` fn
// purely on text similarity, where doc-rich `.d.ts` namespace blocks or
// generic helpers can outrank it. The call graph encodes that `decorate`
// is invoked 41 times across the codebase while the namespace declaration
// is referenced almost exclusively from imports (4 hits). That's a strong
// behavioural signal: this entity is structurally important.
//
// Restrictions:
//   - Only fires on `function` / `method` / `impl` entities. Declarative
//     types are handled by T1 above and shouldn't compete on call count.
//   - Only fires under `intent='implementation'`. Asking "what is the
//     ConfigError type" should not promote a fn just because it's called
//     a lot.
//   - Counts `type='calls'` only — not `imports`/`uses`/`extends`. Imports
//     are noisy (every file imports a few standards) and don't reflect
//     behavioural invocation.
//   - Boost is `1 + alpha · log(1 + count)` capped at REF_BOOST_CAP. With
//     alpha=0.025 and cap=1.10, 30 calls yields ~1.085, 1000 calls hits
//     the cap. So a heavily-tested helper can't run away with the ranking.
//   - Skipped on chunks larger than REF_BOOST_LARGE_LINES (default 80) to
//     avoid worsening Cluster B (oversized parent chunks like a 700-line
//     factory function whose graph degree is naturally high).
//
// Disable with `ablations: 'no-ref-count-boost'` or
// SWEET_SEARCH_REF_BOOST_ALPHA=0. Suffix aggregation is homonym-gated in
// CodeGraphRepository (`SWEET_SEARCH_REF_SUFFIX_AGG_FANOUT_MAX`, default 12).
const REF_BOOSTABLE_TYPES = new Set(['function', 'method', 'impl']);

function referenceCountBoost(result, refCounts, opts = {}) {
  if (!refCounts || refCounts.size === 0) return 1;
  if (process.env.SWEET_SEARCH_REF_BOOST_ALPHA === '0') return 1;

  const intent = opts.intent || classifyFileKindIntent(opts.query || '');
  if (intent !== 'implementation') return 1;

  const recordedType = normalizeType(resolveResultType(result));
  const inferredType = recordedType && recordedType !== 'code' && recordedType !== 'chunk'
    ? recordedType
    : normalizeType(resolveEntityKindInfo(result, opts)?.type);
  if (!REF_BOOSTABLE_TYPES.has(inferredType)) return 1;

  const meta = result?.metadata || {};
  const start = result?.startLine ?? meta.startLine;
  const end = result?.endLine ?? meta.endLine;
  if (Number.isFinite(start) && Number.isFinite(end)) {
    const lineCount = Math.max(1, end - start + 1);
    const largeThresh = Number(process.env.SWEET_SEARCH_REF_BOOST_LARGE_LINES || 80);
    if (lineCount > largeThresh) return 1;
  }

  const name = resolveResultName(result) || resolveEntityKindInfo(result, opts)?.name;
  if (!name || name.length < 3) return 1;

  const count = refCounts.get(name) || 0;
  if (count <= 0) return 1;

  const alpha = envFloatRange('SWEET_SEARCH_REF_BOOST_ALPHA', 0.025);
  const cap = (() => {
    const v = process.env.SWEET_SEARCH_REF_BOOST_CAP;
    if (v == null || v === '') return 1.10;
    const n = Number(v);
    return Number.isFinite(n) && n >= 1.0 && n <= 1.5 ? n : 1.10;
  })();
  const boost = Math.min(cap, 1 + alpha * Math.log(1 + count));
  return boost;
}

// Pre-compute incoming-call counts for ALL candidate names in one DB query.
// Without this, the multiplier function would do N queries per result set
// (one per candidate), which adds 100-200 ms in practice.
function buildRefCountMap(results, opts = {}) {
  const repo = opts.codeGraphRepo;
  if (!repo || typeof repo.countIncomingCallsByNames !== 'function') return new Map();
  const intent = opts.intent || classifyFileKindIntent(opts.query || '');
  if (intent !== 'implementation') return new Map();
  if (process.env.SWEET_SEARCH_REF_BOOST_ALPHA === '0') return new Map();

  const names = [];
  for (const r of results) {
    const recordedType = normalizeType(resolveResultType(r));
    const inferredType = recordedType && recordedType !== 'code' && recordedType !== 'chunk'
      ? recordedType
      : normalizeType(resolveEntityKindInfo(r, opts)?.type);
    if (!REF_BOOSTABLE_TYPES.has(inferredType)) continue;
    const name = resolveResultName(r) || resolveEntityKindInfo(r, opts)?.name;
    if (name && name.length >= 3) names.push(name);
  }
  if (names.length === 0) return new Map();
  try {
    // Default: skip ref-boost for the whole query when any boostable candidate
    // bare name has >12 distinct call-graph targets (dense single-fun corpora).
    // Opt out with SWEET_SEARCH_REF_BOOST_QUERY_HOMONYM_DISABLE=0; tighten for
    // eval with =2..=8 (lifts GCSN, may trim monorepo boosts — see probes).
    const rawTh = process.env.SWEET_SEARCH_REF_BOOST_QUERY_HOMONYM_DISABLE;
    const parsed = parseInt(rawTh != null && rawTh !== '' ? rawTh : '12', 10);
    const homonymCeil = rawTh === '0'
      ? Infinity
      : (Number.isFinite(parsed) && parsed > 0 ? parsed : 12);
    if (typeof repo.relationshipBareFanout === 'function'
        && homonymCeil < Infinity
        && names.some((n) => repo.relationshipBareFanout(n) > homonymCeil)) {
      return new Map();
    }
    return repo.countIncomingCallsByNames(names);
  } catch {
    return new Map();
  }
}

// Removed (2026-05-05): file-header chunk detection became redundant
// once cAST sibling-merge was confirmed. With cAST, a chunk starting at
// line 1 of a source file naturally merges the package decl + imports
// with the first executable declaration(s), so a "lines 1-N: imports
// only" chunk shouldn't normally win retrieval. Cases where it still
// does are rare enough that the cost of the false-positive demotion
// (e.g. a `types.go` consisting purely of type aliases) outweighs the
// benefit. The per-doc `tinyAncillaryFactor` in applyFileKindRanking
// still catches tiny doc/test/example top-1 results.

/**
 * Apply content-aware result demotions/boosts before top-k truncation.
 * Catches inline test functions and explicit entity-kind queries that
 * path-only demotion cannot see. Tiny-chunk and file-header rules were
 * removed once cAST sibling-merge made them structurally redundant.
 */
export function applyResultDemotions(results, opts = {}) {
  if (!Array.isArray(results) || results.length === 0) return results;

  // Attach intra-call (and optionally cross-call) memoization for the three
  // hot lookups inside the demotion sub-rules:
  //   - _entityKindCache    : enclosing/contained entity from SQLite
  //   - _entityNameCache    : findEntityWithNameInRange (symbol-target adopt)
  //   - _resultTextCache    : readFileSync source span — biggest win, since
  //                           5+ rules call resolveResultText per result and
  //                           each cache-miss fires a full readFileSync.
  // Caller may pass pre-allocated Maps via opts to share across both
  // applyResultDemotions calls in the same search() invocation.
  opts = {
    ...opts,
    _entityKindCache: opts._entityKindCache instanceof Map ? opts._entityKindCache : new Map(),
    _entityNameCache: opts._entityNameCache instanceof Map ? opts._entityNameCache : new Map(),
    _resultTextCache: opts._resultTextCache instanceof Map ? opts._resultTextCache : new Map(),
    _fullFileTextCache: opts._fullFileTextCache instanceof Map ? opts._fullFileTextCache : new Map(),
    _isTestSupportCache: opts._isTestSupportCache instanceof Map ? opts._isTestSupportCache : new Map(),
    _isTestChunkCache: opts._isTestChunkCache instanceof Map ? opts._isTestChunkCache : new Map(),
    _fileKindCache: opts._fileKindCache instanceof Map ? opts._fileKindCache : new Map(),
    _testChunkBodyMatchCache: opts._testChunkBodyMatchCache instanceof Map ? opts._testChunkBodyMatchCache : new Map(),
  };

  const ablations = opts.ablations;
  if (hasAblation(ablations, 'no-result-demotions')) return results;

  const qTokens = queryTokenSet(opts.query || '', opts.queryTokens);
  const preferredKind = hasAblation(ablations, 'no-entity-kind-pref')
    ? null
    : entityKindPreferenceFromQuery(opts.query || '');
  const nameHints = hasAblation(ablations, 'no-name-precision')
    ? new Set()
    : extractNameHints(opts.query || '');
  const nameHintsLower = hasAblation(ablations, 'no-name-precision')
    ? new Set()
    : new Set([...nameHints].map(s => s.toLowerCase()));

  // Pre-compute incoming-call counts in a single batched query so the
  // per-result loop doesn't make N round trips to SQLite.
  const refCounts = !hasAblation(ablations, 'no-ref-count-boost')
    ? buildRefCountMap(results, opts)
    : new Map();

  // Symbol-exact-match target + path-token targets — extracted ONCE per
  // query (not per-result). BM25F SOTA pattern (Sourcegraph BM25F blog
  // April 2025, +20% on code search; Pérez-Iglesias et al. arXiv
  // 0911.5046; Robertson & Zaragoza 2009).
  //
  // CRITICAL — gated on opts.format === 'agent' (or env override) to
  // avoid −0.07pp regression on GCSN heldout MRR. GCSN-style NL queries
  // ("Sort an array of integers", "Find the index of an element") trip
  // the path-token "of X" pattern with non-path tokens like "integers"
  // / "ascending", and lightly poison ranking. The boosts are designed
  // for agent queries with explicit identifier/path hints ("show me X
  // struct", "in globset"), not for benchmark NL traffic. Probes use
  // format='agent', so their behaviour is preserved; GCSN bench uses
  // mode='auto' without format, so boosts are skipped — restoring the
  // 85.99% MRR heldout baseline.
  //
  // See docs/SOTA_RESEARCH_2026_FIXES.md for full rationale.
  const isAgentFormat = opts.format === 'agent'
    || opts.format === 'agent_full'
    || opts.format === 'agent_full_xl'
    || opts.format === 'agent_preview'
    || process.env.SWEET_SEARCH_FORCE_BM25F_BOOSTS === '1';
  const symbolExactTarget = isAgentFormat && !hasAblation(ablations, 'no-symbol-exact-boost')
    ? extractSymbolDefinitionTarget(opts.query || '')
    : null;
  const pathTokens = isAgentFormat && !hasAblation(ablations, 'no-path-token-boost')
    ? extractPathTokens(opts.query || '')
    : [];

  let changed = false;
  const window = Math.min(opts.window ?? results.length, results.length);

  // Native fast-path prefill (opt-in). When the sweet-search-native addon
  // exposes testChunkBodyMatchBatch and the env gate is on, prefill the
  // chunk-body match cache for the active window in one napi call. This
  // cuts the dominant cost in rule:testName — the per-chunk V8 regex
  // pass — by amortising napi crossing over up to `window` chunks. If the
  // addon is absent or the env gate is off, getNativeDemotionKernel()
  // returns null and the per-result loop falls through to the V8 regex.
  // STRICTLY behavior-preserving: the Rust `regex` crate compiles the
  // same alternation as TEST_CHUNK_BODY_RE; scripts/parity-demotions.js
  // asserts byte-identical verdicts on a fixed corpus.
  if (!hasAblation(ablations, 'no-test-name-overlap')) {
    const kernel = getNativeDemotionKernel();
    if (kernel) {
      const bodyMatchCache = opts._testChunkBodyMatchCache;
      const texts = new Array(window);
      const keys = new Array(window);
      let needed = 0;
      for (let i = 0; i < window; i++) {
        const r = results[i];
        const filePath = resolveFilePath(r);
        const meta = r?.metadata || {};
        const start = r?.startLine ?? r?.start_line ?? meta.startLine ?? meta.start_line;
        const end = r?.endLine ?? r?.end_line ?? meta.endLine ?? meta.end_line ?? start;
        if (!filePath || !Number.isFinite(start)) {
          keys[i] = null;
          continue;
        }
        const k = `${filePath}|${start}|${Number.isFinite(end) ? end : start}`;
        if (bodyMatchCache.has(k)) {
          keys[i] = null;
          continue;
        }
        keys[i] = k;
        texts[i] = resolveResultText(r, opts) || '';
        needed++;
      }
      if (needed > 0) {
        // Pack contiguously to avoid passing empty placeholder slots.
        const packedTexts = new Array(needed);
        const packedKeys = new Array(needed);
        let p = 0;
        for (let i = 0; i < window; i++) {
          if (keys[i] !== null) {
            packedTexts[p] = texts[i];
            packedKeys[p] = keys[i];
            p++;
          }
        }
        try {
          const verdicts = kernel.testChunkBodyMatchBatch(packedTexts);
          for (let j = 0; j < needed; j++) {
            bodyMatchCache.set(packedKeys[j], !!verdicts[j]);
          }
        } catch {
          // Native call failed — fall through to V8 regex per chunk.
        }
      }
    }
  }

  // Per-rule timers — accumulator pattern, no object allocation per call.
  // No-op in production; only fires when profile-search-stages.mjs sets
  // globalThis.__stageTimings. Adds ~1ms overhead per call when profiling
  // (12 rules × 100 results × 2 performance.now() calls), acceptable for
  // the diagnostic.
  const __profOn = !!globalThis.__stageTimings;
  const __ruleTime = __profOn ? new Float64Array(12) : null;
  let __ruleT0 = 0;
  // Hoist loop-invariant work out of the per-result map():
  //   - ruleOpts: a single spread reused across the 3 ruleOpts callsites
  //     (anomalous, docComment, megaEntity). Original allocated 3 fresh
  //     spreads per result (~15-20 keys each) × 100 results = 300 extra
  //     objects per call.
  //   - skip* flags: hasAblation() called once per result per rule otherwise.
  //   - preferredKindKeywordSet: the kind→keywords list never changes during
  //     the loop, but the original recomputed
  //     `(ENTITY_KIND_KEYWORDS[preferredKind] || []).map(normalizeType)` per
  //     result inside the entity-adoption gate.
  // Pre-resolve the envelope-cap once for ruleOpts. resolveMaxEnvelopeLines
  // does an env-var lookup + parseInt + default fallback; without this it
  // ran per result inside megaEntityPenalty.
  const ruleOpts = {
    ...opts,
    ablations,
    _isAgentFormat: isAgentFormat,
    _megaEnvelopeMax: resolveMaxEnvelopeLines(opts),
  };
  const skipTestName = hasAblation(ablations, 'no-test-name-overlap');
  const skipBodyDensity = hasAblation(ablations, 'no-body-density');
  const skipMegaChunk = hasAblation(ablations, 'no-mega-chunk-penalty');
  const skipRefCount = hasAblation(ablations, 'no-ref-count-boost');
  const skipNamePrecision = hasAblation(ablations, 'no-name-precision');
  const skipEntityKindPref = hasAblation(ablations, 'no-entity-kind-pref');
  const testNameOverlapThreshold = opts.testNameOverlapThreshold ?? 0.5;
  const testNameOverlapFactor = opts.testNameOverlapFactor ?? 0.40;
  const preferredKindKeywordSet = preferredKind
    ? new Set((ENTITY_KIND_KEYWORDS[preferredKind] || []).map(normalizeType))
    : null;

  // For-loop with a pre-allocated array. The hot path here was a `.map()`
  // callback that always allocated a `details` array per result and a fresh
  // result spread `{ ...result, _resultDemotionOrigIndex: index }` even when
  // no rule fired. With ~100 results × 2 demotion sites that's hundreds of
  // empty arrays + light spreads per query for nothing. Lazy `details`
  // allocation skips the array when the result has zero rule hits;
  // unchanged-result spreads keep going through the same shape (the caller
  // expects new references — cascade scoring writes back r.score).
  const adjusted = new Array(window);
  for (let index = 0; index < window; index++) {
    const result = results[index];
    let mult = 1;
    let details = null;

    if (!skipTestName) {
      if (__profOn) __ruleT0 = performance.now();
      if (isTestChunk(result, opts)) {
        const overlap = testNameQueryOverlap(result, qTokens);
        if (overlap >= testNameOverlapThreshold) {
          mult *= testNameOverlapFactor;
          (details ||= []).push('test-name:0.40');
        }
      }
      if (__profOn) __ruleTime[0] += performance.now() - __ruleT0;
    }

    if (__profOn) __ruleT0 = performance.now();
    const kindMult = entityKindMultiplier(result, preferredKind, opts);
    if (__profOn) __ruleTime[1] += performance.now() - __ruleT0;
    if (kindMult !== 1) {
      mult *= kindMult;
      (details ||= []).push(`kind-pref:${kindMult.toFixed(2)}`);
    }

    if (__profOn) __ruleT0 = performance.now();
    const nameMult = namePrecisionMultiplier(result, preferredKind, nameHintsLower, opts);
    if (__profOn) __ruleTime[2] += performance.now() - __ruleT0;
    if (nameMult !== 1) {
      mult *= nameMult;
      (details ||= []).push(`name-precision:${nameMult.toFixed(2)}`);
    }

    if (!skipBodyDensity) {
      if (__profOn) __ruleT0 = performance.now();
      const bodyMult = bodyDensityMultiplier(result, opts);
      if (__profOn) __ruleTime[3] += performance.now() - __ruleT0;
      if (bodyMult !== 1) {
        mult *= bodyMult;
        (details ||= []).push(`body-density:${bodyMult.toFixed(2)}`);
      }
    }

    if (!skipMegaChunk) {
      if (__profOn) __ruleT0 = performance.now();
      const megaMult = megaChunkSizePenalty(result, opts);
      if (__profOn) __ruleTime[4] += performance.now() - __ruleT0;
      if (megaMult !== 1) {
        mult *= megaMult;
        (details ||= []).push(`mega-chunk:${megaMult.toFixed(2)}`);
      }
    }

    {
      if (__profOn) __ruleT0 = performance.now();
      const anomMult = anomalousChunkDemotion(result, ruleOpts);
      if (__profOn) __ruleTime[5] += performance.now() - __ruleT0;
      if (anomMult !== 1) {
        mult *= anomMult;
        (details ||= []).push(`anomalous-chunk:${anomMult.toFixed(2)}`);
      }
    }

    {
      if (__profOn) __ruleT0 = performance.now();
      const docMult = docCommentOnlyDemotion(result, ruleOpts);
      if (__profOn) __ruleTime[6] += performance.now() - __ruleT0;
      if (docMult !== 1) {
        mult *= docMult;
        (details ||= []).push(`doc-comment-only:${docMult.toFixed(2)}`);
      }
    }

    {
      if (__profOn) __ruleT0 = performance.now();
      const entMult = megaEntityPenalty(result, ruleOpts);
      if (__profOn) __ruleTime[7] += performance.now() - __ruleT0;
      if (entMult !== 1) {
        mult *= entMult;
        (details ||= []).push(`mega-entity:${entMult.toFixed(2)}`);
      }
    }


    if (symbolExactTarget) {
      if (__profOn) __ruleT0 = performance.now();
      const symbolMult = symbolExactMatchBoost(result, symbolExactTarget, opts);
      if (__profOn) __ruleTime[8] += performance.now() - __ruleT0;
      if (symbolMult !== 1) {
        mult *= symbolMult;
        (details ||= []).push(`symbol-exact:${symbolMult.toFixed(2)}`);
      }
    }

    if (pathTokens.length > 0) {
      if (__profOn) __ruleT0 = performance.now();
      const pathMult = pathTokenBoost(result, pathTokens, opts);
      if (__profOn) __ruleTime[9] += performance.now() - __ruleT0;
      if (pathMult !== 1) {
        mult *= pathMult;
        (details ||= []).push(`path-token:${pathMult.toFixed(2)}`);
      }
    }

    if (!skipRefCount) {
      if (__profOn) __ruleT0 = performance.now();
      const refMult = referenceCountBoost(result, refCounts, opts);
      if (__profOn) __ruleTime[10] += performance.now() - __ruleT0;
      if (refMult !== 1) {
        mult *= refMult;
        (details ||= []).push(`ref-count:${refMult.toFixed(2)}`);
      }
    }

    const baseScore = typeof result.score === 'number' ? result.score : 0;
    if (__profOn) __ruleT0 = performance.now();
    // F8 (2026-05-07): when the query has an explicit symbol target (extractSymbolDefinitionTarget)
    // AND the chunk contains an entity matching that name, prefer THAT entity for labeling
    // over kind-preference / name-precision heuristics. Targets cases like S3-Q4 (chunk
    // labeled "Binding" but contains the Default function the user asked for) and parallels
    // F7's contained-entity boost (which only changes ranking, not symbol attribution).
    // Format-gated through symbolExactTarget which is set only when isAgentFormat.
    const exactSymbolTargetEntity = symbolExactTarget && opts.codeGraphRepo
      && typeof opts.codeGraphRepo.findEntityWithNameInRange === 'function'
      ? (() => {
          const fp = resolveFilePath(result);
          const meta = result?.metadata ?? {};
          const sl = Number(result?.startLine ?? meta.startLine);
          const el = Number(result?.endLine ?? meta.endLine);
          if (!fp || !Number.isFinite(sl) || !Number.isFinite(el)) return null;
          const cache = opts._entityNameCache;
          const cacheKey = cache ? `${fp}|${sl}|${el}|${symbolExactTarget}` : null;
          if (cacheKey && cache.has(cacheKey)) return cache.get(cacheKey);
          let resolved = null;
          try {
            resolved = opts.codeGraphRepo.findEntityWithNameInRange(fp, sl, el, symbolExactTarget);
          } catch { resolved = null; }
          if (cacheKey) cache.set(cacheKey, resolved);
          return resolved;
        })()
      : null;
    const exactEntity = exactSymbolTargetEntity
      || (!skipNamePrecision
          ? exactNamedEntityForResult(result, preferredKind, nameHints, nameHintsLower, opts)
          : null);
    const preferredEntity = exactEntity || (preferredKind && !skipEntityKindPref
      ? resolveEntityKindInfo(result, opts)
      : null);
    const preferredType = normalizeType(preferredEntity?.type);
    // F8 (continued): when the chunk contains an entity matching the explicit
    // symbol target (function name from "show me X function" queries), bypass
    // the kind-keyword gate. Functions/methods aren't in ENTITY_KIND_KEYWORDS
    // (which is struct/enum/class/interface/trait/type), so without bypass the
    // relabel path was gated off for "show me X function" queries — defeating
    // the purpose of having SYMBOL_DEFN_QUERY_RE recognise "function".
    const shouldAdoptViaExactTarget = !!(exactSymbolTargetEntity
      && exactSymbolTargetEntity.name
      && exactSymbolTargetEntity.startLine
      && exactSymbolTargetEntity.endLine);
    const shouldAdoptEntity = shouldAdoptViaExactTarget || !!(preferredEntity?.startLine
      && preferredEntity?.endLine
      && preferredKindKeywordSet && preferredKindKeywordSet.has(preferredType));
    const containedEntity = !shouldAdoptEntity && opts.codeGraphRepo && typeof opts.codeGraphRepo.findFirstEntityInRange === 'function'
      ? resolveEntityKindInfo(result, opts)
      : null;
    const shouldAdoptContained = !!(containedEntity?.name && containedEntity?.startLine && containedEntity?.endLine);
    const entityToAdopt = shouldAdoptEntity ? preferredEntity : shouldAdoptContained ? containedEntity : null;
    if (__profOn) __ruleTime[11] += performance.now() - __ruleT0;
    if (mult === 1 && !entityToAdopt) {
      // Unchanged: shallow copy preserves the caller-expected new-reference
      // shape (downstream cascade scoring writes back r.score) without the
      // redundant _resultDemotionOrigIndex field — V8 Array.sort is stable
      // since ES2019, so the in-place index-order tie-break is implicit.
      adjusted[index] = { ...result };
      continue;
    }
    changed = true;
    // Range-preservation invariant: adopting an entity is a *labeling*
    // operation (it tells the caller what symbol the chunk is about); it
    // must not SHRINK a well-formed retrieval chunk to a per-symbol entity
    // boundary. The cAST/sibling-merged chunk is the right unit for the
    // agent to read; the entity name + type are added as annotations.
    //
    // Concretely: a Go file's bsonBinding has a 1-line typeAlias entity
    // at line 14, but the LI chunk is lines 1-31 (typeAlias + 3 methods,
    // all merged by cAST). Adopting the entity's range used to drop 30
    // lines of content; now we keep the chunk range and just adopt the
    // name/type as labels. Range adoption only fires when the entity
    // is at least as large as the chunk (e.g. expanding a partial
    // chunk to its enclosing symbol — which is the legitimate use case).
    const chunkStart = result.metadata?.startLine ?? result.startLine ?? null;
    const chunkEnd = result.metadata?.endLine ?? result.endLine ?? null;
    const chunkRange = (chunkStart != null && chunkEnd != null)
      ? Math.max(0, chunkEnd - chunkStart + 1) : 0;
    const entityRange = entityToAdopt
      ? Math.max(0, (entityToAdopt.endLine || 0) - (entityToAdopt.startLine || 0) + 1) : 0;
    const adoptRange = !!entityToAdopt && entityRange >= chunkRange;
    const adoptedFile = entityToAdopt
      ? (entityToAdopt.file || entityToAdopt.filePath || resolveFilePath(result))
      : null;
    const baseMetadata = result.metadata || {};
    const nextMetadata = entityToAdopt
      ? {
          ...baseMetadata,
          ...(shouldAdoptEntity
            ? { name: entityToAdopt.name || baseMetadata.name || result.name || null }
            : { name: entityToAdopt.name }),
          type: entityToAdopt.type,
          ...(adoptRange ? {
            file: adoptedFile,
            startLine: entityToAdopt.startLine,
            endLine: entityToAdopt.endLine,
          } : {}),
        }
      : baseMetadata;
    adjusted[index] = {
      ...result,
      ...(entityToAdopt ? {
        name: shouldAdoptEntity
          ? (entityToAdopt.name || result.name)
          : entityToAdopt.name,
        type: entityToAdopt.type,
        ...(adoptRange ? {
          startLine: entityToAdopt.startLine,
          endLine: entityToAdopt.endLine,
        } : {}),
      } : {}),
      ...(nextMetadata ? { metadata: nextMetadata } : {}),
      score: baseScore * mult,
      _resultDemotionOrigScore: baseScore,
      _resultDemotionMult: mult,
      _resultDemotionDetails: details ?? [],
    };
  }

  // Dump per-rule timings to globalThis.__stageTimings (set by the profiler).
  // No-op in production. Labels mirror the rule names so the profiler's flat
  // table reads cleanly.
  if (__profOn && __ruleTime) {
    const labels = [
      'rule:testName', 'rule:entityKind', 'rule:namePrec', 'rule:body',
      'rule:megaChunk', 'rule:anomalous', 'rule:docComment', 'rule:megaEntity',
      'rule:symbolExact', 'rule:pathToken', 'rule:refCount', 'rule:adoptEntity',
    ];
    const buf = globalThis.__stageTimings;
    for (let i = 0; i < labels.length; i++) {
      (buf[labels[i]] = buf[labels[i]] || []).push(__ruleTime[i]);
    }
  }

  if (!changed) return results;

  // V8 Array.sort is stable (ES2019) — same-score results retain their
  // original-window order without needing the explicit _origIndex tiebreak
  // the prior implementation carried.
  adjusted.sort((a, b) => (b.score || 0) - (a.score || 0));
  return window === results.length ? adjusted : adjusted.concat(results.slice(window));
}

function envOff() {
  return process.env.SWEET_SEARCH_FILE_KIND_RANKING === '0'
      || process.env.SWEET_SEARCH_FILE_KIND_RANKING === 'false';
}

function envFactor(name, fallback) {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
}

function envWindow(name, fallback) {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const DEFAULT_FACTOR = 0.85;
const DEFAULT_WINDOW = 30;

/**
 * Apply intent-aware file-kind score multipliers, then re-sort the top-N
 * window descending. The original array is not mutated.
 *
 * Demotion fires only when:
 *   - intent === 'implementation' (confident, NOT 'unknown'), AND
 *   - the top-N window contains at least one demotable candidate, AND
 *   - the top-N window contains at least one implementation candidate.
 *
 * In every other case the original `results` array is returned unchanged
 * (same reference, no copy, no re-sort) — this is critical so the helper is
 * a structural no-op on single-source corpora (GCSN) and on cascades whose
 * top-N has no demotable competition.
 *
 * @param {Array} results - search results carrying .score and a file-path
 *                          field (.file / .file_path / .path / .metadata.*).
 * @param {Object} [opts]
 * @param {string} [opts.query]            - raw query (used to infer intent
 *                                            if opts.intent isn't supplied)
 * @param {'docs'|'tests'|'types'|'ancillary'|'implementation'|'unknown'} [opts.intent]
 *                                            - explicit intent override
 * @param {number} [opts.docFactor]        - default from env / 0.85
 * @param {number} [opts.exampleFactor]    - default from docFactor
 * @param {number} [opts.testFactor]       - default from env / 0.85
 * @param {number} [opts.typeFactor]       - default from env / 0.85
 * @param {number} [opts.ancillaryFactor]  - default from env / 0.85
 * @param {number} [opts.tinyAncillaryFactor]
 * @param {number} [opts.tinyLineThreshold]
 * @param {number} [opts.window]           - top-N window for analysis +
 *                                            bounded re-sort (default 30)
 * @returns {Array} either the original `results` (no-op) or a new array
 *                  whose head is sorted by adjusted score and whose tail is
 *                  the unchanged input tail. Stable on ties.
 */
export function applyFileKindRanking(results, opts = {}) {
  if (envOff()) return results;
  if (!Array.isArray(results) || results.length === 0) return results;

  const intent = opts.intent != null
    ? opts.intent
    : classifyFileKindIntent(opts.query || '');

  // Conservative gate: only confident 'implementation' intent fires.
  if (intent !== 'implementation') return results;

  const window = opts.window != null
    ? opts.window
    : envWindow('SWEET_SEARCH_FILE_KIND_WINDOW', DEFAULT_WINDOW);
  const windowSize = Math.min(window, results.length);

  // Per-call file-kind cache: detectFileKind is invoked for every result
  // here AND inside isTestChunk → the same file path can be classified
  // many times in one applyFileKindRanking + applyResultDemotions pass.
  // Caller may pass opts._fileKindCache to share with the demotion sites.
  const fileKindOpts = opts._fileKindCache instanceof Map
    ? opts
    : { ...opts, _fileKindCache: new Map() };

  // Walk the window once: classify kinds and check for competition.
  const kinds = new Array(windowSize);
  let demotableCount = 0;
  let implCount = 0;
  for (let i = 0; i < windowSize; i++) {
    const k = detectFileKind(resolveFilePath(results[i]), fileKindOpts);
    kinds[i] = k;
    if (k === 'docs' || k === 'examples' || k === 'tests' || k === 'types' || k === 'ancillary') demotableCount++;
    else if (k === 'implementation') implCount++;
  }

  // Structural skip: nothing to demote, or nothing to promote.
  if (demotableCount === 0 || implCount === 0) return results;

  const factor = envFactor('SWEET_SEARCH_FILE_KIND_FACTOR', DEFAULT_FACTOR);
  const docFactor  = opts.docFactor  != null ? opts.docFactor  : factor;
  const exampleFactor = opts.exampleFactor != null ? opts.exampleFactor : docFactor;
  const testFactor = opts.testFactor != null ? opts.testFactor : factor;
  const typeFactor = opts.typeFactor != null ? opts.typeFactor : factor;
  const ancillaryFactor = opts.ancillaryFactor != null ? opts.ancillaryFactor : factor;
  const tinyAncillaryFactor = opts.tinyAncillaryFactor != null
    ? opts.tinyAncillaryFactor
    : ancillaryFactor;
  const tinyLineThreshold = opts.tinyLineThreshold != null ? opts.tinyLineThreshold : 3;

  const reranked = new Array(windowSize);
  for (let i = 0; i < windowSize; i++) {
    const r = results[i];
    const kind = kinds[i];
    let mult = 1;
    if (kind === 'docs')  mult = docFactor;
    else if (kind === 'examples') mult = exampleFactor;
    else if (kind === 'tests') mult = testFactor;
    else if (kind === 'types') mult = typeFactor;
    else if (kind === 'ancillary') {
      const lineCount = inferLineCount(r);
      mult = lineCount <= tinyLineThreshold
        ? Math.min(ancillaryFactor, tinyAncillaryFactor)
        : ancillaryFactor;
    }
    const baseScore = (typeof r.score === 'number') ? r.score : 0;
    reranked[i] = {
      ...r,
      _fileKindOrigScore: baseScore,
      _fileKindMult: mult,
      _fileKindKind: kind,
      _fileKindOrigIndex: i,
      score: baseScore * mult,
    };
  }

  // Stable sort: descending score, tie-break on original index.
  reranked.sort((a, b) => {
    const d = (b.score || 0) - (a.score || 0);
    return d !== 0 ? d : a._fileKindOrigIndex - b._fileKindOrigIndex;
  });

  for (const r of reranked) delete r._fileKindOrigIndex;

  // Concatenate unchanged tail. The cascade's CE/MaxSim score-scale
  // boundary typically lives near rank `ceTopK`, so leaving rank
  // `windowSize`+ untouched contains the damage from any cross-scale
  // re-sort that might happen inside the window.
  if (windowSize === results.length) return reranked;
  return reranked.concat(results.slice(windowSize));
}

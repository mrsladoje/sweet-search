import { readFileSync } from 'fs';
import path from 'path';

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
const TESTS_RE = /(?:^|\/)tests?\/|(?:^|\/)spec\/|\.test\.[a-z0-9]+$|_test\.[a-z0-9]+$|\.spec\.[a-z0-9]+$|_spec\.[a-z0-9]+$/i;
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
export function detectFileKind(filePath) {
  if (!filePath || typeof filePath !== 'string') return 'implementation';
  if (DOCS_RE.test(filePath))  return 'docs';
  if (EXAMPLES_RE.test(filePath)) return 'examples';
  if (TESTS_RE.test(filePath)) return 'tests';
  if (isTestSupportFile(filePath)) return 'tests';
  if (TYPES_RE.test(filePath)) return 'types';
  if (ANCILLARY_RE.test(filePath)) return 'ancillary';
  return 'implementation';
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
  return r?.content || r?.text || r?.code || r?.snippet || readResultSpan(r, opts);
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
  const fileKind = detectFileKind(resolveFilePath(r));
  if (fileKind === 'tests') return true;
  if (!hasAblation(opts.ablations, 'no-test-support-detection')
      && isTestSupportFile(resolveFilePath(r), resolveFullFileText(r, opts) || resolveResultText(r, opts))) {
    return true;
  }

  const text = resolveResultText(r, opts);
  if (/^\s*#\[(cfg\s*\(\s*test\s*\)|test)\]/m.test(text)) return true;
  if (/^\s*func\s+Test[A-Z]/m.test(text)) return true;
  if (/^\s*def\s+test_/m.test(text)) return true;
  if (/^\s*(it|test|describe)\s*\(\s*['"]/m.test(text)) return true;

  const name = resolveResultName(r);
  return /^(test_|Test[A-Z])|_test$/.test(name);
}

function resolveFullFileText(r, opts = {}) {
  if (!opts.projectRoot) return '';
  const file = resolveFilePath(r);
  if (!file) return '';
  try {
    const root = path.resolve(opts.projectRoot);
    const abs = path.resolve(root, file);
    if (abs !== root && !abs.startsWith(root + path.sep)) return '';
    return readFileSync(abs, 'utf8');
  } catch {
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

  if (!content) return false;
  if (/^\s*#!\[cfg\s*\(\s*test\s*\)/m.test(content)) return true;

  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length < 8) return false;
  const hasJsTestContext = /(^|\/)(test|tests|spec|__tests__)\//i.test(filePath)
    || /^\s*(describe|it|test)\s*\(/m.test(content);
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
  if (opts.codeGraphRepo && file && Number.isFinite(start)) {
    try {
      const entity = opts.codeGraphRepo.findEnclosingEntity(file, start, Number.isFinite(end) ? end : start)
        || opts.codeGraphRepo.findEnclosingEntity(file, start, start);
      if (entity?.type) return entity;
      if (typeof opts.codeGraphRepo.findFirstEntityInRange === 'function' && Number.isFinite(end)) {
        const first = opts.codeGraphRepo.findFirstEntityInRange(file, start, end);
        if (first?.type) return first;
      }
    } catch {
      // Fall through to source-span inference.
    }
  }
  const inferred = inferEntityKindFromText(resolveResultText(r, opts));
  return inferred ? { type: inferred } : null;
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
const SYMBOL_DEFN_QUERY_RE = new RegExp(
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
  '(?:struct|enum|class|function|method|type|trait|interface)\\b',
  'i'
);

function extractSymbolDefinitionTarget(query) {
  if (!query || typeof query !== 'string') return null;
  // Try the SHOW pattern first (more permissive).
  let m = query.match(SYMBOL_DEFN_QUERY_RE);
  if (m && m[1] && m[1].length >= 3) return m[1];
  m = query.match(SYMBOL_WHATIS_QUERY_RE);
  if (m && m[1] && m[1].length >= 3) return m[1];
  return null;
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
  if (!symbol) return 1.0;
  const tLower = target.toLowerCase();
  const sLower = String(symbol).toLowerCase();
  // Exact case-insensitive match.
  if (sLower === tLower) return boost;
  // Snake_case ↔ camelCase normalisation: "missing_linker_library" matches
  // "MissingLinkerLibrary"; "decorate_reply" matches "decorateReply".
  const norm = (s) => s.replace(/[_-]/g, '').toLowerCase();
  if (norm(sLower) === norm(tLower)) return boost;
  return 1.0;
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

  // Symbol-exact-match target — extracted ONCE per query (not per-result).
  // BM25F SOTA pattern (Sourcegraph BM25F blog April 2025, +20% on code
  // search; Pérez-Iglesias et al. arXiv 0911.5046; Robertson & Zaragoza
  // 2009). See docs/SOTA_RESEARCH_2026_FIXES.md for full rationale.
  const symbolExactTarget = !hasAblation(ablations, 'no-symbol-exact-boost')
    ? extractSymbolDefinitionTarget(opts.query || '')
    : null;

  let changed = false;
  const window = Math.min(opts.window ?? results.length, results.length);
  const adjusted = results.slice(0, window).map((result, index) => {
    let mult = 1;
    const details = [];

    if (!hasAblation(ablations, 'no-test-name-overlap') && isTestChunk(result, opts)) {
      const overlap = testNameQueryOverlap(result, qTokens);
      if (overlap >= (opts.testNameOverlapThreshold ?? 0.5)) {
        mult *= opts.testNameOverlapFactor ?? 0.40;
        details.push('test-name:0.40');
      }
    }

    const kindMult = entityKindMultiplier(result, preferredKind, opts);
    if (kindMult !== 1) {
      mult *= kindMult;
      details.push(`kind-pref:${kindMult.toFixed(2)}`);
    }

    const nameMult = namePrecisionMultiplier(result, preferredKind, nameHintsLower, opts);
    if (nameMult !== 1) {
      mult *= nameMult;
      details.push(`name-precision:${nameMult.toFixed(2)}`);
    }

    if (!hasAblation(ablations, 'no-body-density')) {
      const bodyMult = bodyDensityMultiplier(result, opts);
      if (bodyMult !== 1) {
        mult *= bodyMult;
        details.push(`body-density:${bodyMult.toFixed(2)}`);
      }
    }

    if (!hasAblation(ablations, 'no-mega-chunk-penalty')) {
      const megaMult = megaChunkSizePenalty(result, opts);
      if (megaMult !== 1) {
        mult *= megaMult;
        details.push(`mega-chunk:${megaMult.toFixed(2)}`);
      }
    }

    if (symbolExactTarget) {
      const symbolMult = symbolExactMatchBoost(result, symbolExactTarget, opts);
      if (symbolMult !== 1) {
        mult *= symbolMult;
        details.push(`symbol-exact:${symbolMult.toFixed(2)}`);
      }
    }

    if (!hasAblation(ablations, 'no-ref-count-boost')) {
      const refMult = referenceCountBoost(result, refCounts, opts);
      if (refMult !== 1) {
        mult *= refMult;
        details.push(`ref-count:${refMult.toFixed(2)}`);
      }
    }

    const baseScore = typeof result.score === 'number' ? result.score : 0;
    const exactEntity = !hasAblation(ablations, 'no-name-precision')
      ? exactNamedEntityForResult(result, preferredKind, nameHints, nameHintsLower, opts)
      : null;
    const preferredEntity = exactEntity || (preferredKind && !hasAblation(ablations, 'no-entity-kind-pref')
      ? resolveEntityKindInfo(result, opts)
      : null);
    const preferredType = normalizeType(preferredEntity?.type);
    const shouldAdoptEntity = !!(preferredEntity?.startLine
      && preferredEntity?.endLine
      && (ENTITY_KIND_KEYWORDS[preferredKind] || []).map(normalizeType).includes(preferredType));
    const containedEntity = !shouldAdoptEntity && opts.codeGraphRepo && typeof opts.codeGraphRepo.findFirstEntityInRange === 'function'
      ? resolveEntityKindInfo(result, opts)
      : null;
    const shouldAdoptContained = !!(containedEntity?.name && containedEntity?.startLine && containedEntity?.endLine);
    const entityToAdopt = shouldAdoptEntity ? preferredEntity : shouldAdoptContained ? containedEntity : null;
    if (mult === 1 && !entityToAdopt) return { ...result, _resultDemotionOrigIndex: index };
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
    return {
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
      _resultDemotionDetails: details,
      _resultDemotionOrigIndex: index,
    };
  });

  if (!changed) return results;

  adjusted.sort((a, b) => {
    const d = (b.score || 0) - (a.score || 0);
    return d !== 0 ? d : a._resultDemotionOrigIndex - b._resultDemotionOrigIndex;
  });
  for (const r of adjusted) delete r._resultDemotionOrigIndex;
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

  // Walk the window once: classify kinds and check for competition.
  const kinds = new Array(windowSize);
  let demotableCount = 0;
  let implCount = 0;
  for (let i = 0; i < windowSize; i++) {
    const k = detectFileKind(resolveFilePath(results[i]));
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

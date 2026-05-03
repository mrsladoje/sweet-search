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
const TESTS_RE = /(?:^|\/)tests?\/|(?:^|\/)spec\/|\.test\.[a-z0-9]+$|_test\.[a-z0-9]+$|\.spec\.[a-z0-9]+$|_spec\.[a-z0-9]+$/i;
const TYPES_RE = /\.d\.ts$|(?:^|\/)types\//i;

// Strong implementation-seeking signals. A query that fires one of these is
// confidently asking for source code; anything else is treated as `'unknown'`.
// Curated to cover the validated guard-set queries plus common phrasings,
// without matching pure descriptive corpus prose like "Convert XML to URL List".
const IMPL_INTENT_RE = new RegExp(
  '\\b(' + [
    // English wh-questions about location/behaviour
    'where', 'how does', 'how do',
    // Definition / implementation phrasing
    'implements?', 'implementation', 'defines?', 'definition', 'declared?',
    // Code-structure nouns
    'function', 'functions', 'method', 'methods', 'class', 'classes',
    'constructor', 'module', 'library', 'crate', 'package',
    // Verbs that strongly signal a code unit
    'dispatch(?:es|er)?', 'handles?', 'handler', 'handlers',
    'parses?', 'parser', 'parsers',
    'router?', 'routes?', 'routing',
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
const TYPES_INTENT_RE = /\b(type|types|interface|declaration|signature|typings|typedef)\b/i;

/**
 * Detect the file kind from a result path.
 * @returns {'docs'|'tests'|'types'|'implementation'}
 */
export function detectFileKind(filePath) {
  if (!filePath || typeof filePath !== 'string') return 'implementation';
  if (DOCS_RE.test(filePath))  return 'docs';
  if (TESTS_RE.test(filePath)) return 'tests';
  if (TYPES_RE.test(filePath)) return 'types';
  return 'implementation';
}

/**
 * Detect file-kind intent of a query along the docs/tests/types/implementation
 * axis. Conservative: a query with no implementation-seeking signal returns
 * `'unknown'`, and the helper treats `'unknown'` as a no-op (just like the
 * docs/tests/types intents).
 *
 * @returns {'docs'|'tests'|'types'|'implementation'|'unknown'}
 */
export function classifyFileKindIntent(query) {
  const q = (query || '').toLowerCase();
  if (!q) return 'unknown';
  // Type-seeking trumps test-seeking when both fire (existing convention).
  if (TYPES_INTENT_RE.test(q)) return 'types';
  if (DOCS_INTENT_RE.test(q))  return 'docs';
  if (TESTS_INTENT_RE.test(q)) return 'tests';
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
 *   - the top-N window contains at least one docs/tests/types candidate, AND
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
 * @param {'docs'|'tests'|'types'|'implementation'|'unknown'} [opts.intent]
 *                                            - explicit intent override
 * @param {number} [opts.docFactor]        - default from env / 0.85
 * @param {number} [opts.testFactor]       - default from env / 0.85
 * @param {number} [opts.typeFactor]       - default from env / 0.85
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
    if (k === 'docs' || k === 'tests' || k === 'types') demotableCount++;
    else if (k === 'implementation') implCount++;
  }

  // Structural skip: nothing to demote, or nothing to promote.
  if (demotableCount === 0 || implCount === 0) return results;

  const factor = envFactor('SWEET_SEARCH_FILE_KIND_FACTOR', DEFAULT_FACTOR);
  const docFactor  = opts.docFactor  != null ? opts.docFactor  : factor;
  const testFactor = opts.testFactor != null ? opts.testFactor : factor;
  const typeFactor = opts.typeFactor != null ? opts.typeFactor : factor;

  const reranked = new Array(windowSize);
  for (let i = 0; i < windowSize; i++) {
    const r = results[i];
    const kind = kinds[i];
    let mult = 1;
    if (kind === 'docs')  mult = docFactor;
    else if (kind === 'tests') mult = testFactor;
    else if (kind === 'types') mult = typeFactor;
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

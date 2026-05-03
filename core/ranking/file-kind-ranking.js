/**
 * Intent-aware file-kind ranking.
 *
 * Background: real-codebase miss analysis (see eval/miss-analysis/) found that
 * documentation, test, and TypeScript-declaration files often outrank the
 * implementation file users were actually looking for. Blanket demotion of
 * those file kinds works on the graph-2hop benchmark but harms doc-, test-,
 * and type-seeking queries on the validated guard set. This helper applies a
 * conservative score multiplier ONLY when the query intent is
 * implementation-seeking, preserving baseline behaviour for the other intents.
 *
 * Validation summary (factor 0.7, 93-query guard set + 295 graph-2hop queries):
 *   - graph-2hop R@1:  47.46 % → 63.05 % (+15.59 pp), R@10 unchanged, harm 0
 *   - guard impl R@1:  30.00 % → 35.00 %  (matches blanket)
 *   - guard docs R@1:  60.00 % → 60.00 %  (blanket would regress to 15.00 %)
 *   - guard tests R@1: 60.00 % → 60.00 %  (blanket would regress to 55.00 %)
 *   - guard types R@1: 45.45 % → 45.45 %  (blanket would regress to 27.27 %)
 *
 * Disable at runtime with SWEET_SEARCH_FILE_KIND_RANKING=0. The shared
 * implementation factor can be tuned via SWEET_SEARCH_FILE_KIND_FACTOR (default
 * 0.7); larger values (closer to 1.0) make the rule softer.
 */

const DOCS_RE  = /\.md$|\.mdx$|\.rst$|(?:^|\/)docs?\//i;
const TESTS_RE = /(?:^|\/)tests?\/|(?:^|\/)spec\/|\.test\.[a-z0-9]+$|_test\.[a-z0-9]+$|\.spec\.[a-z0-9]+$|_spec\.[a-z0-9]+$/i;
const TYPES_RE = /\.d\.ts$|(?:^|\/)types\//i;

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
 * axis. Conservative: an unmarked query is treated as implementation-seeking.
 * @returns {'docs'|'tests'|'types'|'implementation'}
 */
export function classifyFileKindIntent(query) {
  const q = (query || '').toLowerCase();
  if (!q) return 'implementation';
  if (/\b(type|types|interface|declaration|signature|typings|typedef)\b/.test(q)) return 'types';
  if (/\b(doc|docs|documentation|readme|guide|tutorial|reference|example)\b/.test(q)) return 'docs';
  if (/\b(test|tests|spec|specs|fixture|fixtures|mock|mocks)\b/.test(q)) return 'tests';
  return 'implementation';
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

/**
 * Apply intent-aware file-kind score multipliers, then re-sort descending.
 * The original array is not mutated (returns a new array).
 *
 * Demotion fires only when the query intent is 'implementation'. For
 * docs/tests/types intents the result list is returned unchanged (a shallow
 * copy), preserving the invariant that doc-, test-, or type-seeking queries
 * never see their target file kind demoted.
 *
 * @param {Array} results - search results carrying .score and a file-path
 *                          field (.file / .file_path / .path / .metadata.*).
 * @param {Object} [opts]
 * @param {string} [opts.query]            - raw query (used to infer intent if
 *                                            opts.intent isn't supplied)
 * @param {'docs'|'tests'|'types'|'implementation'} [opts.intent] - explicit
 *                                            intent override
 * @param {number} [opts.docFactor]        - default from env / 0.7
 * @param {number} [opts.testFactor]       - default from env / 0.7
 * @param {number} [opts.typeFactor]       - default from env / 0.7
 * @returns {Array} new array sorted by adjusted score descending. Stable on
 *                  ties (preserves the original order).
 */
export function applyFileKindRanking(results, opts = {}) {
  if (envOff()) return results;
  if (!Array.isArray(results) || results.length === 0) return results;

  const intent = opts.intent != null
    ? opts.intent
    : classifyFileKindIntent(opts.query || '');

  if (intent !== 'implementation') return results.slice();

  const factor = envFactor('SWEET_SEARCH_FILE_KIND_FACTOR', 0.7);
  const docFactor  = opts.docFactor  != null ? opts.docFactor  : factor;
  const testFactor = opts.testFactor != null ? opts.testFactor : factor;
  const typeFactor = opts.typeFactor != null ? opts.typeFactor : factor;

  const reranked = results.map((r, idx) => {
    const filePath = resolveFilePath(r);
    const kind = detectFileKind(filePath);
    let mult = 1;
    if (kind === 'docs')  mult = docFactor;
    else if (kind === 'tests') mult = testFactor;
    else if (kind === 'types') mult = typeFactor;
    const baseScore = (typeof r.score === 'number') ? r.score : 0;
    return {
      ...r,
      _fileKindOrigScore: baseScore,
      _fileKindMult: mult,
      _fileKindKind: kind,
      _fileKindOrigIndex: idx,
      score: baseScore * mult,
    };
  });

  // Stable: tie-break on original index.
  reranked.sort((a, b) => {
    const d = (b.score || 0) - (a.score || 0);
    return d !== 0 ? d : a._fileKindOrigIndex - b._fileKindOrigIndex;
  });

  for (const r of reranked) delete r._fileKindOrigIndex;
  return reranked;
}

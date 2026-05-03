/**
 * Eval-side mirror of the file-kind ranking helper. The production helper
 * (if validation passes) lives at core/ranking/file-kind-ranking.js and
 * carries the same logic — keeping a single eval-side copy lets the
 * validator run without depending on production code yet.
 */

const DOCS_RE  = /\.md$|\.mdx$|\.rst$|(?:^|\/)docs?\//i;
const TESTS_RE = /(?:^|\/)tests?\/|(?:^|\/)spec\/|\.test\.[a-z0-9]+$|_test\.[a-z0-9]+$|\.spec\.[a-z0-9]+$|_spec\.[a-z0-9]+$/i;
const TYPES_RE = /\.d\.ts$|(?:^|\/)types\//i;

/**
 * Detect the file kind from a result path. Returns one of
 * 'docs' | 'tests' | 'types' | 'implementation'.
 */
export function detectFileKind(filePath) {
  if (!filePath) return 'implementation';
  if (DOCS_RE.test(filePath))  return 'docs';
  if (TESTS_RE.test(filePath)) return 'tests';
  if (TYPES_RE.test(filePath)) return 'types';
  return 'implementation';
}

/**
 * Naive query-intent classifier for file-kind axis.
 * Returns one of 'docs' | 'tests' | 'types' | 'implementation'.
 *
 * Conservative on purpose: a query that doesn't hit any keyword is treated
 * as implementation-seeking. Demotion only fires when the result is intent
 * 'implementation' (so doc/test/type queries leave their target file kind
 * untouched).
 */
export function classifyQueryIntent(query) {
  const q = (query || '').toLowerCase();
  if (!q) return 'implementation';
  // Order matters slightly: type-seeking trumps test-seeking when both fire.
  if (/\b(type|types|interface|declaration|signature|typings|typedef)\b/.test(q)) return 'types';
  if (/\b(doc|docs|documentation|readme|guide|tutorial|reference|example)\b/.test(q)) return 'docs';
  if (/\b(test|tests|spec|specs|fixture|fixtures|mock|mocks)\b/.test(q)) return 'tests';
  return 'implementation';
}

/**
 * Apply intent-aware file-kind score multipliers, then re-sort descending.
 *
 * Demotion ONLY fires when intent === 'implementation'. For doc/test/type
 * intents we leave scores untouched — preserving the invariant that doc-,
 * test-, and type-seeking queries never get their target file kind demoted.
 *
 * @param {Array} results - search results with .file or .file_path or .path
 * @param {Object} opts
 * @param {'docs'|'tests'|'types'|'implementation'} opts.intent
 * @param {number} [opts.docFactor=0.7]
 * @param {number} [opts.testFactor=0.7]
 * @param {number} [opts.typeFactor=0.7]
 * @returns {Array} new array sorted by adjusted score descending. Stable
 *                 within ties (insertion order preserved).
 */
export function applyFileKindRanking(results, opts = {}) {
  const {
    intent = 'implementation',
    docFactor = 0.7,
    testFactor = 0.7,
    typeFactor = 0.7,
  } = opts;
  if (!Array.isArray(results) || results.length === 0) return results;

  // No-op when query intent is anything other than implementation.
  if (intent !== 'implementation') return results.slice();

  const reranked = results.map((r, originalIndex) => {
    const filePath = resultPath(r);
    const kind = detectFileKind(filePath);
    let mult = 1;
    if (kind === 'docs')  mult = docFactor;
    else if (kind === 'tests') mult = testFactor;
    else if (kind === 'types') mult = typeFactor;
    const baseScore = (typeof r.score === 'number') ? r.score : 0;
    return {
      ...r,
      _fileKindOrig: baseScore,
      _fileKindMult: mult,
      _fileKindKind: kind,
      _origIndex: originalIndex,
      score: baseScore * mult,
    };
  });

  // Stable sort: by score desc, breaking ties on the original index.
  reranked.sort((a, b) => {
    const d = (b.score || 0) - (a.score || 0);
    return d !== 0 ? d : a._origIndex - b._origIndex;
  });

  // Drop the bookkeeping field.
  for (const r of reranked) delete r._origIndex;
  return reranked;
}

function resultPath(r) {
  return r.file
    || r.file_path
    || r.path
    || r.metadata?.file
    || r.metadata?.file_path
    || r.metadata?.path
    || '';
}

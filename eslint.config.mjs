/**
 * ESLint flat config — DDD boundary enforcement via no-restricted-imports.
 *
 * Enforces domain dependency direction at the import level.
 * Run: npx eslint core/
 */

// Each entry: [file globs, [forbidden import path prefixes], label]
//
// `prompt-optimization/` is a build-time bounded context with zero runtime
// consumers (only scripts/init.js reads its output artifact). It is appended
// to every runtime-domain forbidden list because no runtime domain may
// import from it. Its own rule forbids the runtime domains it must not reach
// (indexing/query/graph/vocabulary/vector-store/embedding); search and
// ranking are NOT in the forbidden list because barrel-only imports are
// permitted via declared exceptions 4/5 in docs/DDD_ARCHITECTURE.md
// (counts capped by scripts/check-boundaries.js).
const RULES = [
  [['core/infrastructure/*.js', 'core/infrastructure/**/*.js'], ['../embedding', '../graph', '../indexing', '../query', '../ranking', '../search', '../vector-store', '../vocabulary', '../prompt-optimization'], 'Infrastructure must not import domain code'],
  [['core/vector-store/*.js'], ['../embedding', '../graph', '../indexing', '../query', '../ranking', '../search', '../vocabulary', '../prompt-optimization'], 'Vector-store must not import domain code'],
  [['core/embedding/*.js'], ['../graph', '../indexing', '../query', '../ranking', '../search', '../vocabulary', '../vector-store', '../prompt-optimization'], 'Embedding must not import higher layers'],
  [['core/query/*.js'], ['../embedding', '../graph', '../indexing', '../ranking', '../search', '../vector-store', '../vocabulary', '../prompt-optimization'], 'Query must not import other domains'],
  [['core/ranking/*.js'], ['../graph', '../indexing', '../query', '../search', '../vector-store', '../vocabulary', '../embedding', '../prompt-optimization'], 'Ranking must not import higher layers'],
  [['core/indexing/*.js', 'core/indexing/**/*.js'], ['../search', '../query', '../prompt-optimization'], 'Indexing must not import higher layers'],
  [['core/graph/*.js'], ['../embedding', '../indexing', '../search', '../vector-store', '../vocabulary', '../prompt-optimization'], 'Graph must not import forbidden domains'],
  [['core/vocabulary/*.js', 'core/vocabulary/**/*.js'], ['../indexing', '../query', '../ranking', '../search', '../vector-store', '../prompt-optimization'], 'Vocabulary must not import forbidden domains'],
  [['core/search/*.js', 'core/search/**/*.js'], ['../prompt-optimization'], 'Search must not import build-time prompt-optimization'],
  [['core/prompt-optimization/*.js', 'core/prompt-optimization/**/*.js'], ['../embedding', '../graph', '../indexing', '../query', '../vocabulary', '../vector-store'], 'prompt-optimization must not import runtime domains (search/ranking via barrel only — see DDD exceptions 4/5)'],
];

export default [
  { ignores: ['node_modules/**', 'dist/**', '.sweet-search/**', '.agentic-qe/**'] },
  ...RULES.map(([files, prefixes, message]) => ({
    files,
    rules: {
      'no-restricted-imports': ['error', {
        patterns: prefixes.map(p => ({
          group: [`${p}/*`],
          message,
        })),
      }],
    },
  })),
];

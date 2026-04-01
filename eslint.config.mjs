/**
 * ESLint flat config — DDD boundary enforcement via no-restricted-imports.
 *
 * Enforces domain dependency direction at the import level.
 * Run: npx eslint core/
 */

// Each entry: [file globs, [forbidden import path prefixes], label]
const RULES = [
  [['core/infrastructure/*.js', 'core/infrastructure/**/*.js'], ['../embedding', '../graph', '../indexing', '../query', '../ranking', '../search', '../vector-store', '../vocabulary'], 'Infrastructure must not import domain code'],
  [['core/vector-store/*.js'], ['../embedding', '../graph', '../indexing', '../query', '../ranking', '../search', '../vocabulary'], 'Vector-store must not import domain code'],
  [['core/embedding/*.js'], ['../graph', '../indexing', '../query', '../ranking', '../search', '../vocabulary', '../vector-store'], 'Embedding must not import higher layers'],
  [['core/query/*.js'], ['../embedding', '../graph', '../indexing', '../ranking', '../search', '../vector-store', '../vocabulary'], 'Query must not import other domains'],
  [['core/ranking/*.js'], ['../graph', '../indexing', '../query', '../search', '../vector-store', '../vocabulary', '../embedding'], 'Ranking must not import higher layers'],
  [['core/indexing/*.js', 'core/indexing/**/*.js'], ['../search', '../query'], 'Indexing must not import higher layers'],
  [['core/graph/*.js'], ['../embedding', '../indexing', '../search', '../vector-store', '../vocabulary'], 'Graph must not import forbidden domains'],
  [['core/vocabulary/*.js', 'core/vocabulary/**/*.js'], ['../indexing', '../query', '../ranking', '../search', '../vector-store'], 'Vocabulary must not import forbidden domains'],
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

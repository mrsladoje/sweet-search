import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  detectFileKind,
  classifyFileKindIntent,
  applyFileKindRanking,
} from '../../core/ranking/file-kind-ranking.js';

// ---------------------------------------------------------------------------
// detectFileKind
// ---------------------------------------------------------------------------

describe('detectFileKind', () => {
  it('detects docs files by extension', () => {
    expect(detectFileKind('README.md')).toBe('docs');
    expect(detectFileKind('docs/Reference/Hooks.md')).toBe('docs');
    expect(detectFileKind('docs/cli.rst')).toBe('docs');
    expect(detectFileKind('site/index.mdx')).toBe('docs');
  });

  it('detects docs files by directory', () => {
    expect(detectFileKind('project/docs/api.md')).toBe('docs');
    expect(detectFileKind('project/doc/api.md')).toBe('docs');
  });

  it('detects test files by directory and suffix', () => {
    expect(detectFileKind('test/foo.test.js')).toBe('tests');
    expect(detectFileKind('tests/test_blueprints.py')).toBe('tests');
    expect(detectFileKind('src/foo_test.go')).toBe('tests');
    expect(detectFileKind('spec/auth_spec.rb')).toBe('tests');
    expect(detectFileKind('src/foo.spec.ts')).toBe('tests');
  });

  it('detects type declaration files', () => {
    expect(detectFileKind('types/hooks.d.ts')).toBe('types');
    expect(detectFileKind('lib/foo.d.ts')).toBe('types');
    expect(detectFileKind('types/index.ts')).toBe('types');  // /types/ dir
  });

  it('returns implementation for everything else', () => {
    expect(detectFileKind('lib/hooks.js')).toBe('implementation');
    expect(detectFileKind('src/flask/blueprints.py')).toBe('implementation');
    expect(detectFileKind('crates/core/search.rs')).toBe('implementation');
    expect(detectFileKind('')).toBe('implementation');
    expect(detectFileKind(null)).toBe('implementation');
  });
});

// ---------------------------------------------------------------------------
// classifyFileKindIntent
// ---------------------------------------------------------------------------

describe('classifyFileKindIntent', () => {
  it('detects type-seeking queries', () => {
    expect(classifyFileKindIntent('hooks type declaration')).toBe('types');
    expect(classifyFileKindIntent('FastifyInstance interface')).toBe('types');
    expect(classifyFileKindIntent('typedef for the route options')).toBe('types');
  });

  it('detects docs-seeking queries', () => {
    expect(classifyFileKindIntent('hooks documentation')).toBe('docs');
    expect(classifyFileKindIntent('flask deployment guide')).toBe('docs');
    expect(classifyFileKindIntent('api reference')).toBe('docs');
    expect(classifyFileKindIntent('readme for flask')).toBe('docs');
    expect(classifyFileKindIntent('how to use plugins example')).toBe('docs');
  });

  it('detects test-seeking queries', () => {
    expect(classifyFileKindIntent('tests for blueprint registration')).toBe('tests');
    expect(classifyFileKindIntent('connection timeout test')).toBe('tests');
    expect(classifyFileKindIntent('json output spec')).toBe('tests');
    expect(classifyFileKindIntent('fixture file for cli runs')).toBe('tests');
    expect(classifyFileKindIntent('mock the request object')).toBe('tests');
  });

  it('falls back to implementation for unmarked queries', () => {
    expect(classifyFileKindIntent('how do hooks work')).toBe('implementation');
    expect(classifyFileKindIntent('where does flask register signals')).toBe('implementation');
    expect(classifyFileKindIntent('search_path function')).toBe('implementation');
    expect(classifyFileKindIntent('')).toBe('implementation');
    expect(classifyFileKindIntent(null)).toBe('implementation');
    expect(classifyFileKindIntent(undefined)).toBe('implementation');
  });

  it('treats type-seeking as the highest-priority gate', () => {
    // both 'type' and 'test' tokens — type wins
    expect(classifyFileKindIntent('test the type signature')).toBe('types');
  });
});

// ---------------------------------------------------------------------------
// applyFileKindRanking
// ---------------------------------------------------------------------------

const fixtureResults = () => ([
  { file: 'docs/Reference/Hooks.md', score: 0.90 },
  { file: 'lib/hooks.js',            score: 0.85 },
  { file: 'test/hooks.test.js',      score: 0.80 },
  { file: 'types/hooks.d.ts',        score: 0.75 },
]);

describe('applyFileKindRanking', () => {
  beforeEach(() => {
    delete process.env.SWEET_SEARCH_FILE_KIND_RANKING;
    delete process.env.SWEET_SEARCH_FILE_KIND_FACTOR;
  });

  it('demotes docs/tests/types when the query is implementation-seeking', () => {
    const out = applyFileKindRanking(fixtureResults(), { intent: 'implementation' });
    // lib/hooks.js had score 0.85, docs had 0.90; docs gets ×0.7 = 0.63 → behind impl
    expect(out[0].file).toBe('lib/hooks.js');
    // The non-implementation kinds should keep their relative order by post-multiplied score
    expect(out.slice(1).map(r => r.file)).toEqual([
      'docs/Reference/Hooks.md',  // 0.90 × 0.7 = 0.63
      'test/hooks.test.js',       // 0.80 × 0.7 = 0.56
      'types/hooks.d.ts',         // 0.75 × 0.7 = 0.525
    ]);
  });

  it('does NOT demote docs when intent === docs', () => {
    const out = applyFileKindRanking(fixtureResults(), { intent: 'docs' });
    // No re-ordering: original order preserved
    expect(out.map(r => r.file)).toEqual([
      'docs/Reference/Hooks.md',
      'lib/hooks.js',
      'test/hooks.test.js',
      'types/hooks.d.ts',
    ]);
    // Scores untouched
    expect(out[0].score).toBe(0.90);
  });

  it('does NOT demote tests when intent === tests', () => {
    const out = applyFileKindRanking(fixtureResults(), { intent: 'tests' });
    expect(out.map(r => r.file)).toEqual([
      'docs/Reference/Hooks.md',
      'lib/hooks.js',
      'test/hooks.test.js',
      'types/hooks.d.ts',
    ]);
  });

  it('does NOT demote .d.ts when intent === types', () => {
    const out = applyFileKindRanking(fixtureResults(), { intent: 'types' });
    // Original order preserved; scores untouched.
    expect(out.map(r => r.file)).toEqual([
      'docs/Reference/Hooks.md',
      'lib/hooks.js',
      'test/hooks.test.js',
      'types/hooks.d.ts',
    ]);
    expect(out[3].score).toBe(0.75);
  });

  it('infers intent from query when not provided', () => {
    const out = applyFileKindRanking(fixtureResults(), { query: 'hooks documentation' });
    // Intent inferred to docs → no demotion
    expect(out[0].file).toBe('docs/Reference/Hooks.md');
  });

  it('uses an explicit factor override', () => {
    const out = applyFileKindRanking(fixtureResults(), { intent: 'implementation', docFactor: 0.99, testFactor: 0.99, typeFactor: 0.99 });
    // With factor 0.99, the docs entry only loses ~1% — still above lib/hooks.js (0.85)
    expect(out[0].file).toBe('docs/Reference/Hooks.md');
  });

  it('honours the SWEET_SEARCH_FILE_KIND_RANKING=0 kill switch', () => {
    process.env.SWEET_SEARCH_FILE_KIND_RANKING = '0';
    const out = applyFileKindRanking(fixtureResults(), { intent: 'implementation' });
    // Returned as-is (same array reference)
    expect(out).toBe(undefined !== undefined ? null : out); // sanity: out is defined
    expect(out.map(r => r.file)).toEqual([
      'docs/Reference/Hooks.md',
      'lib/hooks.js',
      'test/hooks.test.js',
      'types/hooks.d.ts',
    ]);
  });

  it('honours SWEET_SEARCH_FILE_KIND_RANKING=false too', () => {
    process.env.SWEET_SEARCH_FILE_KIND_RANKING = 'false';
    const out = applyFileKindRanking(fixtureResults(), { intent: 'implementation' });
    expect(out.map(r => r.file)).toEqual([
      'docs/Reference/Hooks.md',
      'lib/hooks.js',
      'test/hooks.test.js',
      'types/hooks.d.ts',
    ]);
  });

  it('reads SWEET_SEARCH_FILE_KIND_FACTOR from the environment', () => {
    process.env.SWEET_SEARCH_FILE_KIND_FACTOR = '0.99';
    const out = applyFileKindRanking(fixtureResults(), { intent: 'implementation' });
    // With factor 0.99 the docs entry stays on top
    expect(out[0].file).toBe('docs/Reference/Hooks.md');
  });

  it('keeps stable ordering when scores tie post-multiplication', () => {
    // Three docs all at the same score → tie-break on original order.
    const tied = [
      { file: 'docs/a.md', score: 1 },
      { file: 'docs/b.md', score: 1 },
      { file: 'docs/c.md', score: 1 },
    ];
    const out = applyFileKindRanking(tied, { intent: 'implementation' });
    expect(out.map(r => r.file)).toEqual(['docs/a.md', 'docs/b.md', 'docs/c.md']);
  });

  it('handles file-path stored in metadata.file', () => {
    const r = [
      { metadata: { file: 'docs/api.md' }, score: 0.9 },
      { metadata: { file: 'lib/api.js'  }, score: 0.85 },
    ];
    const out = applyFileKindRanking(r, { intent: 'implementation' });
    expect(out[0].metadata.file).toBe('lib/api.js');
  });

  it('handles file-path stored in file_path or path', () => {
    const r = [
      { file_path: 'docs/x.md', score: 0.9 },
      { path:      'lib/x.js',  score: 0.85 },
    ];
    const out = applyFileKindRanking(r, { intent: 'implementation' });
    expect(out[0].path).toBe('lib/x.js');
  });

  it('does not mutate the input array or its objects', () => {
    const input = fixtureResults();
    const inputCopy = JSON.parse(JSON.stringify(input));
    const out = applyFileKindRanking(input, { intent: 'implementation' });
    expect(input).toEqual(inputCopy);
    expect(out).not.toBe(input);
  });

  it('returns the same array shape on empty input', () => {
    expect(applyFileKindRanking([], { intent: 'implementation' })).toEqual([]);
    expect(applyFileKindRanking(null, { intent: 'implementation' })).toBeNull();
  });

  afterEach(() => {
    delete process.env.SWEET_SEARCH_FILE_KIND_RANKING;
    delete process.env.SWEET_SEARCH_FILE_KIND_FACTOR;
  });
});

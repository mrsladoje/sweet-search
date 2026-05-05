import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  detectFileKind,
  classifyFileKindIntent,
  applyFileKindRanking,
  applyResultDemotions,
  entityKindPreferenceFromQuery,
  isTestChunk,
  isTinyAncillaryChunk,
  testNameQueryOverlap,
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

  it('detects example files separately from implementation', () => {
    expect(detectFileKind('examples/hooks.js')).toBe('examples');
    expect(detectFileKind('project/example/server.js')).toBe('examples');
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
    expect(detectFileKind('types/index.ts')).toBe('types');
  });

  it('detects ancillary config and metadata files', () => {
    expect(detectFileKind('.github/labeler.yml')).toBe('ancillary');
    expect(detectFileKind('package.json')).toBe('ancillary');
    expect(detectFileKind('config/app.toml')).toBe('ancillary');
  });

  it('returns implementation for everything else', () => {
    expect(detectFileKind('lib/hooks.js')).toBe('implementation');
    expect(detectFileKind('src/flask/blueprints.py')).toBe('implementation');
    expect(detectFileKind('crates/core/search.rs')).toBe('implementation');
    expect(detectFileKind('')).toBe('implementation');
    expect(detectFileKind(null)).toBe('implementation');
  });

  // Guard: GenCodeSearchNet single-source paths must NOT misclassify as
  // docs/tests/types. The corpus layout is
  // <lang>/<safe_repo>/<func_name>_<hash>.<ext> — none of those segments
  // should trip the docs/tests/types regexes.
  it('does not misclassify GenCodeSearchNet-style source paths', () => {
    expect(detectFileKind('python/apache_airflow/_integrate_plugins_215869e2.py')).toBe('implementation');
    expect(detectFileKind('php/weiboad_kafka-php/Produce.encodeMessageSet_27f413bb.php')).toBe('implementation');
    expect(detectFileKind('javascript/jhipster_generator-jhipster/_test_lookup_e9b8c8.js')).toBe('implementation');
    expect(detectFileKind('go/spf13_cobra/_doc_string_abc12345.go')).toBe('implementation');
    expect(detectFileKind('java/elastic_elasticsearch/registerType_deadbeef.java')).toBe('implementation');
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

  it('classifies confident implementation-seeking queries', () => {
    expect(classifyFileKindIntent('how do hooks work')).toBe('implementation');
    expect(classifyFileKindIntent('where does flask register signals')).toBe('implementation');
    expect(classifyFileKindIntent('search_path function')).toBe('implementation');
    expect(classifyFileKindIntent('definition of FST_ERR_NOT_FOUND error')).toBe('implementation');
    expect(classifyFileKindIntent('central dispatcher that selects the parent prototype error function')).toBe('implementation');
    expect(classifyFileKindIntent('main entrypoint of the rg binary')).toBe('implementation');
    expect(classifyFileKindIntent('how does Fastify decide between HTTP HTTPS and HTTP/2 server creation')).toBe('implementation');
    expect(classifyFileKindIntent('how is content-type parser registered')).toBe('implementation');
    expect(classifyFileKindIntent('how does Gin bind JSON request bodies')).toBe('implementation');
    expect(classifyFileKindIntent('when does Gin redirect on trailing slash')).toBe('implementation');
    expect(classifyFileKindIntent('how are glob overrides parsed')).toBe('implementation');
  });

  it('detects ancillary-seeking queries before implementation demotion', () => {
    expect(classifyFileKindIntent('package.json scripts')).toBe('ancillary');
    expect(classifyFileKindIntent('github action workflow yaml')).toBe('ancillary');
    expect(classifyFileKindIntent('labeler config')).toBe('ancillary');
  });

  it('returns "unknown" for queries with no implementation-seeking signal', () => {
    // Pure descriptive corpus prose — these regress GenCodeSearchNet when
    // treated as implementation-seeking, so they must classify as 'unknown'.
    expect(classifyFileKindIntent('Convert XML to URL List')).toBe('unknown');
    expect(classifyFileKindIntent('Downloads Dailymotion videos by URL')).toBe('unknown');
    expect(classifyFileKindIntent('kHasBeenDecorated')).toBe('unknown');
    expect(classifyFileKindIntent('')).toBe('unknown');
    expect(classifyFileKindIntent(null)).toBe('unknown');
    expect(classifyFileKindIntent(undefined)).toBe('unknown');
  });

  it('treats type-seeking as the highest-priority gate', () => {
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
    delete process.env.SWEET_SEARCH_FILE_KIND_WINDOW;
  });

  it('demotes docs/tests/types when the query is implementation-seeking', () => {
    const out = applyFileKindRanking(fixtureResults(), { intent: 'implementation' });
    // factor 0.85: docs 0.90 → 0.765, behind lib/hooks.js (0.85).
    expect(out[0].file).toBe('lib/hooks.js');
    expect(out.slice(1).map(r => r.file)).toEqual([
      'docs/Reference/Hooks.md',
      'test/hooks.test.js',
      'types/hooks.d.ts',
    ]);
  });

  it('does NOT demote when intent === "docs"', () => {
    const input = fixtureResults();
    const out = applyFileKindRanking(input, { intent: 'docs' });
    expect(out).toBe(input);
  });

  it('does NOT demote when intent === "tests"', () => {
    const input = fixtureResults();
    const out = applyFileKindRanking(input, { intent: 'tests' });
    expect(out).toBe(input);
  });

  it('does NOT demote when intent === "types"', () => {
    const input = fixtureResults();
    const out = applyFileKindRanking(input, { intent: 'types' });
    expect(out).toBe(input);
  });

  it('does NOT demote when intent === "unknown" (conservative gate)', () => {
    const input = fixtureResults();
    const out = applyFileKindRanking(input, { intent: 'unknown' });
    expect(out).toBe(input);
    // Same array — no spread, no new objects, no re-sort.
    expect(out[0].file).toBe('docs/Reference/Hooks.md');
  });

  it('infers intent from query when not provided', () => {
    const out = applyFileKindRanking(fixtureResults(), { query: 'hooks documentation' });
    expect(out[0].file).toBe('docs/Reference/Hooks.md');
  });

  it('uses an explicit factor override', () => {
    const out = applyFileKindRanking(fixtureResults(), {
      intent: 'implementation',
      docFactor: 0.99,
      testFactor: 0.99,
      typeFactor: 0.99,
    });
    // With factor 0.99 the docs entry only loses ~1% — still above lib/hooks.js (0.85).
    expect(out[0].file).toBe('docs/Reference/Hooks.md');
  });

  it('honours the SWEET_SEARCH_FILE_KIND_RANKING=0 kill switch', () => {
    process.env.SWEET_SEARCH_FILE_KIND_RANKING = '0';
    const input = fixtureResults();
    const out = applyFileKindRanking(input, { intent: 'implementation' });
    expect(out).toBe(input);
    expect(out.map(r => r.file)).toEqual([
      'docs/Reference/Hooks.md',
      'lib/hooks.js',
      'test/hooks.test.js',
      'types/hooks.d.ts',
    ]);
  });

  it('honours SWEET_SEARCH_FILE_KIND_RANKING=false too', () => {
    process.env.SWEET_SEARCH_FILE_KIND_RANKING = 'false';
    const input = fixtureResults();
    const out = applyFileKindRanking(input, { intent: 'implementation' });
    expect(out).toBe(input);
  });

  it('reads SWEET_SEARCH_FILE_KIND_FACTOR from the environment', () => {
    process.env.SWEET_SEARCH_FILE_KIND_FACTOR = '0.99';
    const out = applyFileKindRanking(fixtureResults(), { intent: 'implementation' });
    expect(out[0].file).toBe('docs/Reference/Hooks.md');
  });

  it('keeps stable ordering when scores tie post-multiplication', () => {
    // Three docs all at the same score → they stay tied, but a single impl
    // candidate is needed for the rule to fire at all.
    const tied = [
      { file: 'docs/a.md', score: 1 },
      { file: 'docs/b.md', score: 1 },
      { file: 'docs/c.md', score: 1 },
      { file: 'lib/x.js', score: 0.5 },
    ];
    const out = applyFileKindRanking(tied, { intent: 'implementation' });
    // factor 0.85: docs scores 0.85 each, impl 0.5 — docs stay top, in
    // input order.
    expect(out.slice(0, 3).map(r => r.file)).toEqual(['docs/a.md', 'docs/b.md', 'docs/c.md']);
    expect(out[3].file).toBe('lib/x.js');
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

  it('strongly demotes tiny ancillary chunks when implementation source is present', () => {
    const r = [
      { file: '.github/labeler.yml', score: 1.0, startLine: 15, endLine: 15 },
      { file: 'lib/server.js', score: 0.20, startLine: 309, endLine: 362 },
    ];
    const out = applyFileKindRanking(r, {
      intent: 'implementation',
      ancillaryFactor: 0.15,
      tinyAncillaryFactor: 0.05,
    });

    expect(out[0].file).toBe('lib/server.js');
    expect(out[1].file).toBe('.github/labeler.yml');
    expect(out[1].score).toBeCloseTo(0.05);
  });

  it('demotes examples for implementation queries unless examples were requested', () => {
    const r = [
      { file: 'examples/hooks.js', score: 0.90 },
      { file: 'lib/hooks.js', score: 0.40 },
    ];
    const out = applyFileKindRanking(r, {
      intent: 'implementation',
      docFactor: 0.35,
    });

    expect(out[0].file).toBe('lib/hooks.js');
    expect(out[1].file).toBe('examples/hooks.js');

    const explicitExample = applyFileKindRanking(r, { query: 'hooks example' });
    expect(explicitExample).toBe(r);
  });

  it('does not demote ancillary files for explicit ancillary queries', () => {
    const input = [
      { file: '.github/labeler.yml', score: 1.0, startLine: 15, endLine: 15 },
      { file: 'lib/server.js', score: 0.20, startLine: 309, endLine: 362 },
    ];
    const out = applyFileKindRanking(input, { query: 'labeler yaml config' });
    expect(out).toBe(input);
    expect(out[0].file).toBe('.github/labeler.yml');
  });

  it('does not mutate the input array or its objects', () => {
    const input = fixtureResults();
    const inputCopy = JSON.parse(JSON.stringify(input));
    const out = applyFileKindRanking(input, { intent: 'implementation' });
    expect(input).toEqual(inputCopy);
    expect(out).not.toBe(input);
  });

  it('returns the same array on empty input', () => {
    const empty = [];
    expect(applyFileKindRanking(empty, { intent: 'implementation' })).toBe(empty);
    expect(applyFileKindRanking(null, { intent: 'implementation' })).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Safety guards added in the conservative variant
  // -------------------------------------------------------------------------

  it('is a structural no-op when the top window has no demotable kinds', () => {
    // Single-source corpus (GenCodeSearchNet shape). All implementation; no
    // docs/tests/types in the window.
    const input = [
      { file: 'python/repo/_a_1.py', score: 16.0 },
      { file: 'python/repo/_b_2.py', score: 15.5 },
      { file: 'python/repo/_c_3.py', score: 14.9 },
      { file: 'python/repo/_d_4.py', score: 12.0 },
    ];
    const out = applyFileKindRanking(input, { intent: 'implementation' });
    expect(out).toBe(input); // Same reference — no spread, no re-sort.
  });

  it('is a structural no-op when the top window has no implementation kinds', () => {
    // Pathological: only docs in top window. Nothing to promote.
    const input = [
      { file: 'docs/a.md', score: 0.9 },
      { file: 'docs/b.md', score: 0.8 },
    ];
    const out = applyFileKindRanking(input, { intent: 'implementation' });
    expect(out).toBe(input);
  });

  it('preserves the cascade tail past `window` (no cross-scale re-sort)', () => {
    // Reproduces the cascade output shape: top has CE-scored items
    // (small absolute scores), tail has MaxSim items (much larger). The
    // window-bounded re-sort must not float MaxSim-tail items above the
    // CE-scored head — this is the GenCodeSearchNet regression bug.
    const head = [
      { id: 'ce_doc',  file: 'docs/r.md',  score: 0.85 },
      { id: 'ce_imp1', file: 'src/a.py',   score: 0.80 },
      { id: 'ce_imp2', file: 'src/b.py',   score: 0.55 },
    ];
    const tail = Array.from({ length: 20 }, (_, i) => ({
      id: 'mx' + i, file: 'src/t' + i + '.py', score: 14 - i * 0.1,
    }));
    const input = [...head, ...tail];

    const out = applyFileKindRanking(input, {
      intent: 'implementation',
      window: 3, // limit re-sort to the CE head
      docFactor: 0.7, testFactor: 0.7, typeFactor: 0.7,
    });

    // Top-3 was reranked: docs demoted (0.85 × 0.7 = 0.595), impl rises.
    expect(out[0].id).toBe('ce_imp1'); // 0.80 (impl, mult 1)
    expect(out[1].id).toBe('ce_doc');  // 0.595 (docs, demoted within head)
    expect(out[2].id).toBe('ce_imp2'); // 0.55 (impl, mult 1)
    // Tail past window is unchanged — same references, in input order.
    for (let i = 0; i < tail.length; i++) {
      expect(out[3 + i]).toBe(tail[i]);
    }
  });

  it('honours SWEET_SEARCH_FILE_KIND_WINDOW from the environment', () => {
    process.env.SWEET_SEARCH_FILE_KIND_WINDOW = '2';
    const input = [
      { file: 'docs/a.md', score: 0.9 },
      { file: 'lib/a.js', score: 0.85 },
      { file: 'docs/b.md', score: 0.8 }, // outside window
      { file: 'lib/b.js', score: 0.75 }, // outside window
    ];
    const out = applyFileKindRanking(input, { intent: 'implementation' });
    // Top 2 reranked: docs/a demoted past lib/a.
    expect(out[0].file).toBe('lib/a.js');
    expect(out[1].file).toBe('docs/a.md');
    // Tail unchanged, same references.
    expect(out[2]).toBe(input[2]);
    expect(out[3]).toBe(input[3]);
  });

  afterEach(() => {
    delete process.env.SWEET_SEARCH_FILE_KIND_RANKING;
    delete process.env.SWEET_SEARCH_FILE_KIND_FACTOR;
    delete process.env.SWEET_SEARCH_FILE_KIND_WINDOW;
  });
});

describe('applyResultDemotions', () => {
  it('demotes tiny source footer chunks independent of file kind', () => {
    const footer = {
      file: 'lib/schema-controller.js',
      startLine: 163,
      endLine: 164,
      content: 'SchemaController.buildSchemaController = buildSchemaController\nmodule.exports = SchemaController',
      score: 0.60,
    };
    const schemaClass = {
      file: 'lib/schema-controller.js',
      startLine: 30,
      endLine: 100,
      content: 'class SchemaController {\n  constructor () {}\n}',
      score: 0.50,
    };

    expect(isTinyAncillaryChunk(footer)).toBe(true);
    const out = applyResultDemotions([footer, schemaClass], {
      query: 'what is kSchemaController and what does it do',
    });

    expect(out[0].file).toBe(schemaClass.file);
    expect(out[0].startLine).toBe(schemaClass.startLine);
    expect(out[1].score).toBeCloseTo(0.18);
  });

  it('does not demote tiny declarations', () => {
    const declaration = {
      file: 'lib/symbols.js',
      startLine: 10,
      endLine: 10,
      content: 'const kSchemaController = Symbol(\'schemaController\')',
      score: 0.60,
    };
    const input = [declaration];
    expect(isTinyAncillaryChunk(declaration)).toBe(false);
    expect(applyResultDemotions(input, {
      query: 'what is kSchemaController',
    })).toBe(input);
  });

  it('demotes Rust inline #[test] fn whose name overlaps query', () => {
    const r = {
      metadata: {
        file: 'crates/printer/src/standard.rs',
        startLine: 2952,
        endLine: 3001,
        name: 'max_matches_multi_line3',
      },
      content: '    #[test]\n    fn max_matches_multi_line3() {\n        ...multi_line(true)...\n    }',
      score: 0.6,
    };
    const queryTokens = new Set(['multi', 'line', 'regex', 'search']);

    expect(isTestChunk(r)).toBe(true);
    expect(testNameQueryOverlap(r, queryTokens)).toBeGreaterThanOrEqual(0.5);
    const adjusted = applyResultDemotions([r], {
      queryTokens,
      query: 'where is the multi-line regex search implemented',
    });
    expect(adjusted[0].score).toBeLessThan(0.4);
  });

  it('prefers enum declaration over impl block when query mentions enum', () => {
    const enumDecl = {
      metadata: { type: 'enum', name: 'Mode', file: 'lowargs.rs', startLine: 100, endLine: 170 },
      score: 0.50,
    };
    const implBlock = {
      metadata: { type: 'impl', name: 'Mode', file: 'lowargs.rs', startLine: 172, endLine: 267 },
      score: 0.55,
    };

    expect(entityKindPreferenceFromQuery('what enum represents output mode')).toBe('enum');
    const ranked = applyResultDemotions([implBlock, enumDecl], {
      query: 'what enum represents output mode',
    });
    expect(ranked[0].metadata.type).toBe('enum');
  });

  it('honours result-demotion ablations', () => {
    const footer = {
      file: 'lib/schema-controller.js',
      startLine: 163,
      endLine: 164,
      content: 'module.exports = SchemaController',
      score: 0.60,
    };
    const longer = { file: 'lib/schema-controller.js', startLine: 30, endLine: 100, score: 0.50 };
    const input = [footer, longer];
    const out = applyResultDemotions(input, {
      query: 'what is kSchemaController',
      ablations: new Set(['no-tiny-floor']),
    });

    expect(out).toBe(input);
  });
});

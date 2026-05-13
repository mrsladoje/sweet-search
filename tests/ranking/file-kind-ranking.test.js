import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  detectFileKind,
  classifyFileKindIntent,
  applyFileKindRanking,
  applyResultDemotions,
  entityKindPreferenceFromQuery,
  isTestChunk,
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
  // Note: the standalone tiny-chunk-floor and file-header-demotion rules
  // were removed once cAST sibling-merge in tree-sitter-provider.js was
  // confirmed in production — those rules became redundant. The only
  // small-chunk path that still fires is `tinyAncillaryFactor` inside
  // applyFileKindRanking, which is a sub-rule of doc/test demotion (not
  // a general size penalty).

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

  // anomalousChunkDemotion predicate (c) — preprocessor-dense mid-file
  // anonymous code chunks. Added 2026-05-11 to address CPP-002 regression
  // where targets.h:16-34 (anonymous `code` chunk dominated by #include +
  // #ifndef/#define lines) won top-1 for an NL query about "SIMD target
  // dispatch" because the existing (a)+(b) predicates (file-header /
  // tiny-span) don't cover mid-file (startLine=16) wider-span (18-line)
  // preprocessor walls. The new predicate (c) requires zero declarations
  // AND ≥50% preprocessor lines so it doesn't catch real code chunks that
  // happen to start with a couple of #includes.
  describe('anomalousChunkDemotion — preprocessor-dense predicate', () => {
    it('demotes anonymous mid-file chunk dominated by #include + #ifndef', () => {
      // CPP-002 actual chunk content from highway/hwy/targets.h:16-34.
      const chunk = {
        file: 'hwy/targets.h',
        startLine: 16,
        endLine: 34,
        symbolType: 'code',
        symbol: null,
        content: `#ifndef HIGHWAY_HWY_TARGETS_H_
#define HIGHWAY_HWY_TARGETS_H_

// Allows opting out of C++ standard library usage, which is not available in
// some Compiler Explorer environments.
#ifndef HWY_NO_LIBCXX
#include <vector>
#endif

// For SIMD module implementations and their callers. Defines which targets to
// generate and call.

#include "hwy/base.h"

#include "hwy/detect_targets.h"

#include "hwy/highway_export.h"

#if !defined(HWY_NO_LIBCXX)
#include <atomic>
#endif`,
        score: 0.55,
      };
      // A second, legitimate competitor chunk so the demoted one drops below it.
      const legit = {
        file: 'hwy/highway.h',
        startLine: 390,
        endLine: 431,
        symbolType: 'struct',
        symbol: 'FunctionCache',
        content: 'template <typename RetType, typename... Args> struct FunctionCache { /* body */ };',
        score: 0.50,
      };
      const out = applyResultDemotions([chunk, legit], {
        query: 'how does highway select the best available SIMD target',
        format: 'agent_full',
      });
      // The preprocessor-dense chunk should be demoted to under the legit chunk.
      expect(out[0].symbol).toBe('FunctionCache');
    });

    it('does NOT demote real code chunk that happens to start with #include', () => {
      // Legitimate function chunk preceded by 1-2 #include lines. Preprocessor
      // density is well below 50% AND the function declaration is detected.
      const chunk = {
        file: 'src/parser.c',
        startLine: 50,
        endLine: 75,
        symbolType: 'code',
        symbol: null,
        content: `#include <stdio.h>
#include <string.h>

int parse_token(const char* input, Token* out) {
  if (input == NULL) return -1;
  size_t len = strlen(input);
  for (size_t i = 0; i < len; i++) {
    // ...parsing logic...
  }
  return 0;
}`,
        score: 0.60,
      };
      const out = applyResultDemotions([chunk], {
        query: 'parse a token',
        format: 'agent_full',
      });
      // Score should be roughly preserved (no anomalous-chunk × 0.10 hit).
      expect(out[0].score).toBeGreaterThan(0.5);
    });

    it('demotes macro-wall chunk where entity adoption set symbol but content is still all #defines', () => {
      // Pattern: during context expansion, a macro entity (#define
      // HWY_BASELINE_TARGETS) gets adopted onto the chunk, setting
      // result.symbol='HWY_BASELINE_TARGETS', result.symbolType='macro'.
      // The chunk text itself remains a 47-line wall of #define + #if + #endif
      // surrounding the named #define. PATH 2 of the predicate catches this:
      // macro chunks with span>=5 AND preprocessor-density >=50%.
      const macroWall = {
        file: 'hwy/detect_targets.h',
        startLine: 706,
        endLine: 752,
        symbol: 'HWY_BASELINE_TARGETS',  // adopted from entity DB
        symbolType: 'macro',
        content: `#define HWY_BASELINE_TARGETS HWY_AVX2
#endif
#endif  // HWY_BASELINE_TARGETS

// Allow the user to override this without any guarantee of success.
#ifndef HWY_BASELINE_TARGETS
#define HWY_BASELINE_TARGETS                                               \\
  (HWY_BASELINE_SCALAR | HWY_BASELINE_WASM | HWY_BASELINE_PPC8 |           \\
   HWY_BASELINE_PPC9 | HWY_BASELINE_PPC10 | HWY_BASELINE_Z14 |             \\
   HWY_BASELINE_NEON | HWY_BASELINE_SSE2 | HWY_BASELINE_SSSE3 |            \\
   HWY_BASELINE_SSE4 | HWY_BASELINE_AVX2 | HWY_BASELINE_AVX3 |             \\
   HWY_BASELINE_RVV | HWY_BASELINE_LOONGARCH)
#endif  // HWY_BASELINE_TARGETS

#define HWY_ENABLED_BASELINE HWY_ENABLED(HWY_BASELINE_TARGETS)
#if HWY_ENABLED_BASELINE == 0
#pragma message "All baseline targets are disabled or considered broken."
#endif

#define HWY_STATIC_TARGET (HWY_ENABLED_BASELINE & -HWY_ENABLED_BASELINE)
#define HWY_TARGET HWY_STATIC_TARGET

#if 1 < (defined(HWY_COMPILE_ONLY_SCALAR))
#error "Can only define one of HWY_COMPILE_ONLY_{SCALAR|EMU128|STATIC} - bug?"
#endif`,
        score: 0.55,
      };
      const legit = {
        file: 'hwy/highway.h',
        startLine: 390,
        endLine: 431,
        symbolType: 'struct',
        symbol: 'FunctionCache',
        content: 'template <typename RetType, typename... Args> struct FunctionCache { /* body */ };',
        score: 0.50,
      };
      const out = applyResultDemotions([macroWall, legit], {
        query: 'how does highway select the best available SIMD target',
        format: 'agent_full',
      });
      expect(out[0].symbol).toBe('FunctionCache');
    });

    it('does NOT demote a small focused #define chunk (span<5, real macro definition)', () => {
      // A single-purpose #define is a legitimate, often-correct answer. The
      // PATH 2 predicate requires span>=5 so we don't demote it.
      const tinyMacro = {
        file: 'src/limits.h',
        startLine: 42,
        endLine: 44,
        symbol: 'MAX_BUFFER_SIZE',
        symbolType: 'macro',
        content: '// Maximum buffer size for token storage\n#define MAX_BUFFER_SIZE 4096',
        score: 0.60,
      };
      const out = applyResultDemotions([tinyMacro], {
        query: 'what is the maximum buffer size',
        format: 'agent_full',
      });
      expect(out[0].score).toBeGreaterThan(0.5);
    });

    it('does NOT demote when format is NOT agent (GCSN invariance)', () => {
      const chunk = {
        file: 'hwy/targets.h',
        startLine: 16,
        endLine: 34,
        symbolType: 'code',
        symbol: null,
        content: '#ifndef X\n#define X\n#include <a.h>\n#include <b.h>\n#include <c.h>\n#endif\n',
        score: 0.55,
      };
      // No format flag → NL-style query path; demotion must not fire.
      const out = applyResultDemotions([chunk], { query: 'SIMD dispatch' });
      expect(out[0].score).toBeCloseTo(0.55, 2);
    });
  });

  // Identifier-mention boost — noun-anchored complement to the verb-anchored
  // symbolExactMatchBoost. Catches probe-style queries like "Vec128 SSE
  // vector class template" where the gold symbol appears without a leading
  // verb. Strict identifier-shape filter (length ≥ 4 AND has digit /
  // underscore / internal-uppercase) keeps English nouns ("Vector", "Type",
  // "Class") and short acronyms ("SSE", "x86") out of the trigger set.
  describe('identifier-mention boost (BM25F noun-anchored)', () => {
    it('boosts chunk where symbol matches a strict-identifier mention in the query', () => {
      const target = {
        file: 'hwy/aligned_allocator.h',
        startLine: 73,
        endLine: 106,
        symbol: 'AlignedDeleter',
        symbolType: 'class',
        score: 0.45,
      };
      const competitor = {
        file: 'hwy/aligned_allocator.h',
        startLine: 130,
        endLine: 160,
        symbol: 'TypedArrayDeleter',
        symbolType: 'class',
        score: 0.50,
      };
      const out = applyResultDemotions([competitor, target], {
        query: 'AlignedDeleter RAII class that calls destructor and frees aligned memory',
        format: 'agent_full',
      });
      // AlignedDeleter was lower-scoring but the noun-anchored mention boost
      // (×1.15 on 0.45 → 0.5175) pushes it above the 0.50 competitor.
      expect(out[0].symbol).toBe('AlignedDeleter');
    });

    it('does not fire on common English nouns like Vector / Type / Class', () => {
      const target = {
        file: 'src/vector.h',
        startLine: 1,
        endLine: 100,
        symbol: 'Vector',  // literal name 'Vector' in some hypothetical lib
        symbolType: 'class',
        score: 0.45,
      };
      const competitor = {
        file: 'src/other.h',
        startLine: 1,
        endLine: 100,
        symbol: 'OtherThing',
        symbolType: 'class',
        score: 0.50,
      };
      const out = applyResultDemotions([competitor, target], {
        query: 'Vector class template for storing elements',
        format: 'agent_full',
      });
      // 'Vector' has no digit/underscore/internal-uppercase → not a mention.
      // No boost applied; competitor (higher base score) stays on top.
      expect(out[0].symbol).toBe('OtherThing');
    });

    it('skips mention if verb-anchored target already matches it', () => {
      // When both extractSymbolDefinitionTarget and extractIdentifierMentions
      // would fire on the same identifier, only the higher-precision verb-
      // anchored boost applies (×1.30, not ×1.30 × ×1.15 = ×1.495).
      const chunk = {
        file: 'src/cache.rs',
        startLine: 100,
        endLine: 150,
        symbol: 'FunctionCache',
        symbolType: 'struct',
        score: 0.50,
      };
      const out = applyResultDemotions([chunk], {
        query: 'show me the FunctionCache struct definition',
        format: 'agent_full',
      });
      // The verb-anchored boost fires (×1.30). The identifier-mention boost
      // sees `FunctionCache` matches the same target and skips. Final score
      // should be ~0.65, not ~0.75 (which would be 1.30 × 1.15).
      expect(out[0].score).toBeGreaterThan(0.6);
      expect(out[0].score).toBeLessThan(0.7);
    });

    it('does NOT fire under non-agent format (GCSN invariance)', () => {
      const chunk = {
        file: 'src/test.rs',
        startLine: 1,
        endLine: 50,
        symbol: 'BufferIter',
        symbolType: 'struct',
        score: 0.50,
      };
      const out = applyResultDemotions([chunk], {
        query: 'BufferIter struct for parsing',
        // No format flag → not agent → boost gated off.
      });
      // No boost applied; score preserved.
      expect(out[0].score).toBeCloseTo(0.50, 2);
    });

    it('extracts dotted compound identifiers (Lua/Python/Ruby style)', async () => {
      // The single-token extractor splits `tablex.deepcopy` into `tablex` and
      // `deepcopy` — neither matches the chunk's `name: 'tablex.deepcopy'`
      // verbatim. The dotted-form extractor captures the compound identifier
      // so Path 1's strict-equality check fires.
      const mod = await import('../../core/ranking/file-kind-ranking.js');
      // extractIdentifierMentions is not exported; verify behaviour through
      // identifierMentionBoost which consumes its output via applyResultDemotions.
      const target = {
        file: 'lua/pl/tablex.lua',
        startLine: 118,
        endLine: 120,
        symbol: 'tablex.deepcopy',
        symbolType: 'function',
        score: 0.45,
      };
      const competitor = {
        file: 'lua/pl/tablex.lua',
        startLine: 90,
        endLine: 110,
        symbol: 'cycle_aware_copy',
        symbolType: 'function',
        score: 0.50,
      };
      const out = mod.applyResultDemotions([competitor, target], {
        query: 'deep copy table with tablex.deepcopy',
        format: 'agent_full',
      });
      // tablex.deepcopy lower base but the dotted-form mention triggers
      // ×1.15 boost (0.45 → 0.5175 > 0.50). cycle_aware_copy stays put.
      expect(out[0].symbol).toBe('tablex.deepcopy');
    });

    it('falls back to code-graph lookup when result.name is null', async () => {
      // Some LI indexes were built without populated metadata.name (e.g. the
      // typescript ast-tester repo). When result.name is null AND a chunk
      // contains an entity matching a query mention, the boost looks up via
      // codeGraphRepo.findEntityWithNameInRange and applies the same ×1.15.
      const mod = await import('../../core/ranking/file-kind-ranking.js');
      const mockRepo = {
        findEntityWithNameInRange(filePath, sl, el, targetName) {
          if (filePath === 'lib/ai/prompts.ts' && sl <= 66 && el >= 80
              && String(targetName).toLowerCase() === 'systemprompt') {
            return { name: 'systemPrompt', type: 'arrowFunction', startLine: 66, endLine: 80 };
          }
          return null;
        },
      };
      const target = {
        file: 'lib/ai/prompts.ts',
        startLine: 47,
        endLine: 104,
        symbol: null, // null-name LI metadata (Path 1 short-circuit)
        symbolType: null,
        score: 0.40,
      };
      const competitor = {
        file: 'lib/ai/other.ts',
        startLine: 1,
        endLine: 50,
        symbol: null,
        symbolType: null,
        score: 0.45,
      };
      const out = mod.applyResultDemotions([competitor, target], {
        query: 'how does systemPrompt incorporate requestHints',
        format: 'agent_full',
        codeGraphRepo: mockRepo,
      });
      // Path 2 boost fires for target (its range contains the systemPrompt
      // entity), not for competitor (mock returns null for any other file).
      // 0.40 × 1.15 = 0.46 > 0.45 → target wins.
      expect(out[0].file).toBe('lib/ai/prompts.ts');
    });

    it('falls through from Path 1 to Path 2 when populated symbol does not match any mention', async () => {
      // cAST sibling-merge case: chunk labeled `verifyNoTypeVariable` (first
      // entity in the merge) but range [121, 168] also contains the gold's
      // `getType` at 166-168. Path 1 finds no match for `verifyNoTypeVariable`
      // against the query mention `getType`, then Path 2 looks up via
      // code-graph and finds the contained sibling → boost fires.
      const mod = await import('../../core/ranking/file-kind-ranking.js');
      const mockRepo = {
        findEntityWithNameInRange(filePath, sl, el, targetName) {
          if (filePath === 'src/TypeToken.java' && sl <= 166 && el >= 168
              && String(targetName).toLowerCase() === 'gettype') {
            return { name: 'getType', type: 'method', startLine: 166, endLine: 168 };
          }
          return null;
        },
      };
      const target = {
        file: 'src/TypeToken.java',
        startLine: 121,
        endLine: 168,
        symbol: 'verifyNoTypeVariable',   // sibling-merge labelled wrong sibling
        symbolType: 'method',
        score: 0.45,
      };
      const competitor = {
        file: 'src/Other.java',
        startLine: 1,
        endLine: 50,
        symbol: 'OtherMethod',
        symbolType: 'method',
        score: 0.50,
      };
      const out = mod.applyResultDemotions([competitor, target], {
        query: 'where is getType defined',
        format: 'agent_full',
        codeGraphRepo: mockRepo,
      });
      // target gets ×1.15 via Path 2 fall-through (0.45 → 0.5175 > 0.50).
      expect(out[0].file).toBe('src/TypeToken.java');
    });

    it('Path 2 does not fire when format is not agent (GCSN invariance)', async () => {
      const mod = await import('../../core/ranking/file-kind-ranking.js');
      const mockRepo = {
        findEntityWithNameInRange() {
          // If called, the test would fail — Path 2 must skip entirely off-format.
          throw new Error('codeGraphRepo should not be queried in non-agent format');
        },
      };
      const chunk = {
        file: 'lib/ai/prompts.ts',
        startLine: 47,
        endLine: 104,
        symbol: null,
        score: 0.50,
      };
      const out = mod.applyResultDemotions([chunk], {
        query: 'systemPrompt requestHints',
        codeGraphRepo: mockRepo,
        // No format flag → not agent → identifierMentions is null → boost skipped.
      });
      expect(out[0].score).toBeCloseTo(0.50, 2);
    });
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

  // ---------------------------------------------------------------------------
  // Range-preservation invariant: entity adoption must NEVER shrink a chunk's
  // visible line range to a smaller per-symbol entity boundary. The cAST
  // sibling-merged chunk is the right unit for the agent to read; the entity
  // name + type are added as ANNOTATIONS, not as a redrawn bounding box.
  //
  // This locks in the fix for the Gin JSON-bind regression where adoption
  // was clobbering a 31-line cAST chunk (typeAlias + 3 methods) with the
  // 1-line typeAlias entity range.
  // ---------------------------------------------------------------------------

  describe('entity adoption — range preservation', () => {
    function mockGraphRepo(entitiesByFile) {
      return {
        findEntitiesByNames(names, opts = {}) {
          const wantNames = new Set(names.map(s => s.toLowerCase()));
          const wantTypes = new Set((opts.types || []).map(s => s.toLowerCase()));
          const out = [];
          for (const [filePath, list] of Object.entries(entitiesByFile)) {
            for (const e of list) {
              const okName = wantNames.has(String(e.name || '').toLowerCase());
              const okType = !wantTypes.size || wantTypes.has(String(e.type || '').toLowerCase());
              if (okName && okType) out.push({ ...e, filePath });
            }
          }
          return out.slice(0, opts.limit ?? 8);
        },
        findEntitiesByNamesCaseInsensitive(names, opts = {}) {
          return this.findEntitiesByNames(names, opts);
        },
        findFirstEntityInRange(filePath, startLine, endLine) {
          const list = entitiesByFile[filePath] || [];
          const candidate = list
            .filter(e => e.startLine >= startLine && e.startLine <= endLine)
            .sort((a, b) => a.startLine - b.startLine
              || (a.endLine - a.startLine) - (b.endLine - b.startLine))[0];
          return candidate ? { ...candidate, filePath } : null;
        },
        findEnclosingEntity(filePath, startLine, endLine) {
          const list = entitiesByFile[filePath] || [];
          const candidate = list
            .filter(e => e.startLine <= startLine && e.endLine >= endLine)
            .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0];
          return candidate ? { ...candidate, filePath } : null;
        },
      };
    }

    it('keeps the chunk range when the adopted entity is SMALLER than the chunk', () => {
      // Canary case: cAST returned a 31-line chunk for binding/bson.go
      // (typeAlias + 3 methods merged). The bsonBinding typeAlias entity
      // is just 1 line. Adoption must annotate, not shrink.
      const repo = mockGraphRepo({
        'binding/bson.go': [
          { id: 'eBson', name: 'bsonBinding', type: 'typeAlias', startLine: 14, endLine: 14 },
        ],
      });
      const chunk = {
        file: 'binding/bson.go',
        metadata: {
          file: 'binding/bson.go', startLine: 1, endLine: 31,
          name: null, type: 'struct',
        },
        score: 0.5,
      };
      const out = applyResultDemotions([chunk], {
        query: 'how does Gin bind JSON request bodies',
        codeGraphRepo: repo,
      });
      expect(out[0].metadata.startLine).toBe(1);
      expect(out[0].metadata.endLine).toBe(31);
      // Annotation IS adopted — agent header now reads `[typeAlias: bsonBinding]`
      expect(out[0].metadata.name).toBe('bsonBinding');
      expect(out[0].metadata.type).toBe('typeAlias');
    });

    it('adopts the entity range when the entity is LARGER than the chunk (legitimate expansion)', () => {
      // The opposite case: the chunk is a partial fragment, and the
      // entity encloses it fully and adds context. Adopt away.
      const repo = mockGraphRepo({
        'src/foo.js': [
          { id: 'eBig', name: 'BigClass', type: 'class', startLine: 10, endLine: 200 },
        ],
      });
      const chunk = {
        file: 'src/foo.js',
        metadata: { file: 'src/foo.js', startLine: 50, endLine: 80, name: null, type: 'code' },
        score: 0.5,
      };
      const out = applyResultDemotions([chunk], {
        query: 'BigClass class definition',
        codeGraphRepo: repo,
      });
      expect(out[0].metadata.startLine).toBe(10);
      expect(out[0].metadata.endLine).toBe(200);
      expect(out[0].metadata.name).toBe('BigClass');
      expect(out[0].metadata.type).toBe('class');
    });

    it('preserves the original chunk range across multiple adoption candidates', () => {
      // Same property on the contained-entity (non-preferred-kind) path.
      const repo = mockGraphRepo({
        'a.go': [
          { id: 'eTiny', name: 'helper', type: 'function', startLine: 5, endLine: 7 },
        ],
      });
      const chunk = {
        file: 'a.go',
        metadata: { file: 'a.go', startLine: 1, endLine: 50, name: null, type: 'code' },
        score: 0.4,
      };
      const out = applyResultDemotions([chunk], {
        query: 'where is request handling done',
        codeGraphRepo: repo,
      });
      // No preferred-kind match for "request handling"; contained-entity path
      // may fire — but range must still be the chunk's, not the 3-line helper's.
      expect(out[0].metadata.startLine).toBe(1);
      expect(out[0].metadata.endLine).toBe(50);
    });

    it('range-preservation invariant holds for arbitrary chunk/entity pairs', () => {
      // Property test: for a sample of chunk + smaller-entity pairs, the
      // adopted metadata's line range is never strictly smaller than the
      // input chunk's line range.
      for (const [chunkSL, chunkEL, entSL, entEL] of [
        [1, 31, 14, 14],   // gin bson typeAlias (the canary)
        [1, 57, 27, 27],   // gin json typeAlias
        [50, 100, 60, 60], // arbitrary 1-line inside
        [10, 20, 15, 16],  // 2-line inside
        [1, 5, 3, 3],      // small-vs-tinier
      ]) {
        const repo = mockGraphRepo({
          'x.go': [{ id: 'e', name: 'X', type: 'typeAlias', startLine: entSL, endLine: entEL }],
        });
        const chunk = {
          file: 'x.go',
          metadata: { file: 'x.go', startLine: chunkSL, endLine: chunkEL, name: null, type: 'struct' },
          score: 0.5,
        };
        const out = applyResultDemotions([chunk], {
          query: 'X typeAlias definition',
          codeGraphRepo: repo,
        });
        const inRange = chunkEL - chunkSL + 1;
        const outRange = (out[0].metadata.endLine || 0) - (out[0].metadata.startLine || 0) + 1;
        expect(outRange, `chunk ${chunkSL}-${chunkEL}, entity ${entSL}-${entEL}: range must not shrink`).toBeGreaterThanOrEqual(inRange);
      }
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { gramsProveNoMatch, sparseGramPathFilter } from '../../core/search/search-pattern-sparse-overlay.js';
import { generateRegexMatches } from '../../core/search/search-pattern-planner.js';
import {
  buildSparseGramIndexArtifact, hasNativeSparseGramSupport, loadSparseGramIndex,
} from '../../core/infrastructure/native-sparse-gram.js';

describe('sparseGramPathFilter', () => {
  it('takes the extension keys from the index paths, as the native filter reads them', () => {
    const index = { getAllFiles: () => ['src/a.go', 'docs/README.MD', '.github/CODEOWNERS', 'Makefile', 'bin/tool', 'odd.'] };
    const filter = sparseGramPathFilter(index);
    expect(filter.extensions.sort()).toEqual(['github/codeowners', 'go', 'md']);
    expect(filter.unfilterable).toEqual(['Makefile', 'bin/tool', 'odd.']);
  });

  it('is computed once per loaded index', () => {
    let calls = 0;
    const index = { getAllFiles: () => { calls += 1; return ['a.js']; } };
    sparseGramPathFilter(index);
    sparseGramPathFilter(index);
    expect(calls).toBe(1);
  });

  it('is empty without an index', () => {
    expect(sparseGramPathFilter(null)).toEqual({ extensions: [], unfilterable: [] });
  });
});

describe('gramsProveNoMatch', () => {
  const index = (byLiteral) => ({ queryLiterals: (clause) => byLiteral[clause[0]] });

  it('is true only when every clause is eligible with zero candidates', () => {
    const idx = index({ a: { eligible: true, files: [] }, b: { eligible: true, files: ['x.go'] }, c: { eligible: false, files: [] } });
    expect(gramsProveNoMatch(idx, [['a']])).toBe(true);
    expect(gramsProveNoMatch(idx, [['a'], ['b']])).toBe(false);
    expect(gramsProveNoMatch(idx, [['c']])).toBe(false);
  });

  it('is false without literals or without an index', () => {
    expect(gramsProveNoMatch(index({}), [])).toBe(false);
    expect(gramsProveNoMatch(index({}), [[]])).toBe(false);
    expect(gramsProveNoMatch(null, [['a']])).toBe(false);
  });
});

describe.runIf(hasNativeSparseGramSupport())('unified grep over a grep-corpus index', () => {
  let root;
  let searcher;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ss-grep-unified-'));
    const files = {
      Makefile: 'all:\n\tgo build -tags zlintPoisonMarker ./...\n',
      'README.md': 'The zlintPoisonMarker flag is documented here.\n',
      'vendor/x509/x509.go': 'package x509\n// zlintPoisonMarker\n',
    };
    for (let i = 0; i < 12; i++) files[`src/file${i}.go`] = `package src\nfunc Helper${i}() int { return ${i} }\n`;
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(join(root, rel, '..'), { recursive: true });
      writeFileSync(join(root, rel), content);
    }
    const indexPath = join(root, 'sparse.idx');
    buildSparseGramIndexArtifact({ projectRoot: root, files: Object.keys(files), outputPath: indexPath });
    searcher = { sparseGramIndex: loadSparseGramIndex(indexPath), sparseGramIndexPath: indexPath, projectRoot: root };
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('returns hits in extensionless, doc and vendored files on a gram-narrowed query', async () => {
    const result = await generateRegexMatches(searcher, 'zlintPoisonMarker', root, {});
    expect(result.stats.grepStrategy).toBe('unified_gram_grep');
    expect(result.matchingFiles.sort()).toEqual(['Makefile', 'README.md', 'vendor/x509/x509.go']);
  });

  it('answers a literal no file contains without grepping every file', async () => {
    const result = await generateRegexMatches(searcher, 'absentLiteralNowhere', root, {});
    expect(result.indexedMatches).toEqual([]);
    expect(result.stats.plannerRoute).toBe('empty_gram_candidates');
    expect(result.stats.filesScanned).toBe(0);
  });

  it('greps extensionless files once on a grep-all query', async () => {
    const result = await generateRegexMatches(searcher, 'go', root, {});
    expect(result.stats.grepStrategy).toBe('unified_grep_all');
    const makefileHits = result.indexedMatches.filter((m) => m.file === 'Makefile');
    expect(makefileHits).toHaveLength(1);
  });
});

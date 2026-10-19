import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { bareGrep } from '../../core/search/search-pattern.js';
import { _resetChangedGrepFilesCache } from '../../core/indexing/grep-corpus.js';

// The index holds the call site in src/a.go; the definition in src/b.go waits in the
// maintainer's queue, so its grams are stale and the indexed search does not return it.
describe('bareGrep with files waiting in the reindex queue', () => {
  let root;
  beforeEach(() => {
    _resetChangedGrepFilesCache();
    root = mkdtempSync(join(tmpdir(), 'ss-queued-grep-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, '.sweet-search'));
    writeFileSync(join(root, 'src/a.go'), 'func Use() { Fresh() }\n');
    writeFileSync(join(root, 'src/b.go'), 'func Fresh() {}\n// Fresh again\n// Fresh third\n');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function searcher({ totals = false } = {}) {
    const hit = { file: 'src/a.go', line: 1, column: 14, matchText: 'Fresh', content: 'func Use() { Fresh() }' };
    const result = () => ({
      matches: [hit],
      ...(totals ? { fileTotals: [['src/a.go', 1]] } : {}),
      candidateFiles: 1, totalFiles: 2, scannedFiles: 1,
    });
    return {
      projectRoot: root,
      _manifestStateDir: join(root, '.sweet-search'),
      sparseGramIndexPath: join(root, 'absent-sparse.idx'),
      sparseGramIndex: { searchFull: result, searchLines: result, getAllFiles: () => ['src/a.go', 'src/b.go'] },
      _readReconcileManifest: () => ({ epoch: 1 }),
    };
  }

  function queue(...files) {
    writeFileSync(join(root, '.sweet-search/index-maintainer-queue.jsonl'),
      files.map((f, i) => JSON.stringify({ file_path: f, timestamp: 1000 + i, source: 'scan' })).join('\n') + '\n');
  }

  it('adds the hits of a queued file the indexed search did not return', async () => {
    queue('src/b.go');
    const out = await bareGrep.call(searcher(), 'Fresh', null, {});
    expect(out.results.map((r) => `${r.file}:${r.line}`)).toEqual(['src/a.go:1', 'src/b.go:1', 'src/b.go:2', 'src/b.go:3']);
    expect(out.stats).toMatchObject({ unindexedFallbackFiles: 1, unindexedFallbackMatches: 3, totalMatches: 4 });
  });

  it('keeps a capped list capped and counts the queued file in full', async () => {
    queue('src/b.go');
    const out = await bareGrep.call(searcher({ totals: true }), 'Fresh', null, { perFileCap: 2, maxFiles: 10 });
    expect(out.results.map((r) => `${r.file}:${r.line}`)).toEqual(['src/a.go:1', 'src/b.go:1', 'src/b.go:2']);
    expect(out.stats.totalMatches).toBe(4);
    expect(out.fileSummary.files).toEqual([
      { file: 'src/a.go', total: 1, kept: 1 },
      { file: 'src/b.go', total: 3, kept: 2 },
    ]);
  });

  it('does not grep a queued file the indexed search returned, nor anything when the queue is empty', async () => {
    queue('src/a.go');
    const out = await bareGrep.call(searcher(), 'Fresh', null, {});
    expect(out.results.map((r) => r.file)).toEqual(['src/a.go']);
    expect(out.stats.unindexedFallbackFiles).toBeUndefined();

    rmSync(join(root, '.sweet-search/index-maintainer-queue.jsonl'));
    _resetChangedGrepFilesCache();
    const none = await bareGrep.call(searcher(), 'Fresh', null, {});
    expect(none.results.map((r) => r.file)).toEqual(['src/a.go']);
  });

  it('asks the code graph nothing about a queued file it found on disk', async () => {
    writeFileSync(join(root, 'src/b.go'), 'func Fresh() {}\n');
    execFileSync('git', ['add', 'src'], { cwd: root });
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'x'], { cwd: root });
    queue('src/b.go');
    const calls = [];
    const codeGraphRepo = new Proxy({}, { get: (_, name) => (...args) => { calls.push([name, args[0]]); return []; } });
    const s = { ...searcher(), codeGraphRepo };
    const empty = () => ({ matches: [], candidateFiles: 0, totalFiles: 2, scannedFiles: 0 });
    s.sparseGramIndex = { ...s.sparseGramIndex, searchFull: empty, searchLines: empty };
    const out = await bareGrep.call(s, 'Fresh', null, { _isAgentFormat: true });
    expect(out.results.map((r) => r.file)).toEqual(['src/b.go']);
    expect(out.siblingLine).toBeUndefined();
    expect(calls.filter(([, file]) => file === 'src/b.go')).toEqual([]);
  });

  it('applies the --in scope to queued files', async () => {
    queue('src/b.go');
    const out = await bareGrep.call(searcher(), 'Fresh', null, { fileFilter: 'src/a.go' });
    expect(out.results.map((r) => r.file)).toEqual(['src/a.go']);
  });
});

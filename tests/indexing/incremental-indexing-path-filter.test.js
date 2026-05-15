/**
 * Tests for core/incremental-indexing/infrastructure/path-filter.mjs
 *
 * Plan § 11 / § 22.9 / § 14.2.7.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadIgnoreFile,
  buildPathFilter,
  evaluateRepoSizeCap,
  DEFAULT_REPO_SIZE_CAP,
} from '../../core/incremental-indexing/infrastructure/path-filter.mjs';

describe('path-filter / defaults', () => {
  it('rejects common build / dependency dirs', () => {
    const f = buildPathFilter();
    expect(f('node_modules/foo/bar.js')).toBe(true);
    expect(f('dist/index.js')).toBe(true);
    expect(f('.git/config')).toBe(true);
    expect(f('vendor/dep.go')).toBe(true);
  });

  it('rejects compiled / artifact extensions', () => {
    const f = buildPathFilter();
    expect(f('out/main.min.js')).toBe(true);
    expect(f('build/main.map')).toBe(true);
    expect(f('src/wasm/lib.wasm')).toBe(true);
    expect(f('package-lock.json'.replace(/\.json$/, '.lock'))).toBe(true);
  });

  it('accepts ordinary source files', () => {
    const f = buildPathFilter();
    expect(f('src/index.js')).toBe(false);
    expect(f('lib/foo.ts')).toBe(false);
    expect(f('crates/bar/src/main.rs')).toBe(false);
  });
});

describe('path-filter / ignore file', () => {
  let dir;
  let ignorePath;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweet-search-pf-'));
    ignorePath = path.join(dir, '.sweet-search-ignore');
    fs.writeFileSync(ignorePath, [
      '# comment',
      'fixtures/',
      '**/*.snapshot.json',
      'reports/*.html',
    ].join('\n'));
  });
  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('loadIgnoreFile drops comments + blanks', () => {
    expect(loadIgnoreFile(ignorePath)).toEqual([
      'fixtures/', '**/*.snapshot.json', 'reports/*.html',
    ]);
  });

  it('buildPathFilter applies project ignore patterns', () => {
    const f = buildPathFilter({ ignoreFile: ignorePath });
    expect(f('fixtures/big-fixture.txt')).toBe(true);
    expect(f('tests/sample.snapshot.json')).toBe(true);
    expect(f('reports/index.html')).toBe(true);
    expect(f('src/index.js')).toBe(false);
  });

  it('extraPatterns merge with the ignore file', () => {
    const f = buildPathFilter({ ignoreFile: ignorePath, extraPatterns: ['logs/'] });
    expect(f('logs/today.log')).toBe(true);
    expect(f('src/index.js')).toBe(false);
  });

  it('allowSweetSearchDir lifts the .sweet-search exclusion (for daemon self-paths)', () => {
    const f = buildPathFilter({ allowSweetSearchDir: true });
    expect(f('.sweet-search/state.json')).toBe(false);
  });
});

describe('repo-size cap', () => {
  it('reports ok=true under 50 % of cap', () => {
    const r = evaluateRepoSizeCap(1000);
    expect(r.ok).toBe(true);
    expect(r.warn).toBe(false);
  });

  it('warns past 50 % of cap', () => {
    const r = evaluateRepoSizeCap(Math.floor(DEFAULT_REPO_SIZE_CAP * 0.7));
    expect(r.ok).toBe(true);
    expect(r.warn).toBe(true);
  });

  it('fails past the hard cap', () => {
    const r = evaluateRepoSizeCap(DEFAULT_REPO_SIZE_CAP + 1);
    expect(r.ok).toBe(false);
    expect(r.warn).toBe(true);
  });

  it('honours custom cap', () => {
    const r = evaluateRepoSizeCap(500, { cap: 100 });
    expect(r.ok).toBe(false);
    expect(r.warn).toBe(true);
  });
});

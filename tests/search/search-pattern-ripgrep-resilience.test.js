/**
 * Regression: ripgrep candidate-file resilience under concurrent deletion.
 *
 * bareGrep narrows to a candidate file list via the sparse-gram index, then
 * hands that list to `rg`. During the incremental-reconcile window a candidate
 * can be deleted on disk before `rg` opens it — `rg` then exits code 2. The
 * search path must tolerate that (resolve with matches from the files that DO
 * exist) instead of rejecting the whole query, while still surfacing genuine
 * errors (e.g. an invalid regex).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isRipgrepAvailable,
  runRipgrepFilesWithMatches,
  runRipgrepJson,
  runRipgrepJsonStreaming,
} from '../../core/search/search-pattern-ripgrep.js';

const rgAvailable = isRipgrepAvailable();
const d = rgAvailable ? describe : describe.skip;

d('search-pattern-ripgrep — missing candidate resilience', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweet-search-rgresil-'));
    fs.writeFileSync(path.join(dir, 'real.js'), 'const TOKEN_ABC = 1;\n');
  });
  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('runRipgrepFilesWithMatches tolerates a deleted candidate', async () => {
    const out = await runRipgrepFilesWithMatches(['TOKEN_ABC'], dir, {
      files: ['real.js', 'vanished.js'], fixedString: true,
    });
    expect(out.some((f) => f.includes('real.js'))).toBe(true);
  });

  it('runRipgrepJson tolerates a deleted candidate', async () => {
    const out = await runRipgrepJson('TOKEN_ABC', dir, {
      files: ['real.js', 'vanished.js'],
    });
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });

  it('runRipgrepJsonStreaming tolerates a deleted candidate', async () => {
    const out = await runRipgrepJsonStreaming('TOKEN_ABC', dir, {
      files: ['real.js', 'vanished.js'],
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].file).toContain('real.js');
  });

  it('tolerates ALL candidates missing (resolves empty, no throw)', async () => {
    const out = await runRipgrepJson('TOKEN_ABC', dir, {
      files: ['gone1.js', 'gone2.js'],
    });
    expect(out).toEqual([]);
  });

  it('still rejects a genuine error (invalid regex keeps stderr)', async () => {
    // An unterminated group is a pattern-syntax error: ripgrep exits 2 with a
    // non-empty stderr even under --no-messages, so we must still reject.
    await expect(
      runRipgrepJson('(unterminated', dir, { files: ['real.js'] }),
    ).rejects.toThrow(/ripgrep failed/);
  });
});

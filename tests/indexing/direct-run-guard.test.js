/**
 * Direct-run guard regression test for `core/indexing/index-codebase-v21.js`.
 *
 * The 2.5.1 guard `import.meta.url === \`file://${process.argv[1]}\``
 * silently no-op'd under three conditions:
 *   1. file install (`npm install ../sweet-search`) which symlinks
 *      `node_modules/sweet-search/` to the source — process.argv[1] is
 *      the symlink path while import.meta.url is the realpath.
 *   2. paths with spaces / unicode (URL encodes, raw string doesn't).
 *   3. mixed slash separators on Windows.
 *
 * 2.5.2 replaces it with `realpathSync(fileURLToPath(import.meta.url))
 * === realpathSync(process.argv[1])`. This test uses the symlink case
 * because it's the realistic local-install regression: we create a
 * symlink to the real indexer and assert that running the symlinked
 * path still triggers `main()` (proxied via `--help` which is an
 * immediate exit-0 with stdout we can grep).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const INDEXER = join(REPO_ROOT, 'core', 'indexing', 'index-codebase-v21.js');

let sandbox;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'ss-direct-run-'));
});

afterEach(() => {
  try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('index-codebase-v21.js — direct-run guard handles symlinks', () => {
  it('runs main() when invoked through a symlinked path (file-install layout)', () => {
    // Mirror the layout `npm install ../sweet-search` produces: the
    // installed node_modules entry is a symlink to the source. Here we
    // symlink just the indexer file rather than the whole package
    // tree — the guard cares about the file path, not its parents.
    const symlink = join(sandbox, 'symlinked-indexer.js');
    symlinkSync(INDEXER, symlink);

    const r = spawnSync(process.execPath, [symlink, '--help'], {
      encoding: 'utf-8',
      timeout: 10_000,
    });

    expect(r.status).toBe(0);
    // Pinned strings from the indexer's help block — proves main()
    // ran. With the old guard this output was absent (silent no-op).
    expect(r.stdout).toContain('--graph-only');
    expect(r.stdout).toContain('.sweet-search/code-graph.db');
  });

  it('runs main() when invoked through the real path (no symlink)', () => {
    // Sanity baseline — the canonical path must still work.
    const r = spawnSync(process.execPath, [INDEXER, '--help'], {
      encoding: 'utf-8',
      timeout: 10_000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('--graph-only');
  });
});

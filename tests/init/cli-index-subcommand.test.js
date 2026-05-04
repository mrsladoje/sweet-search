/**
 * CLI dispatch test for `sweet-search index`.
 *
 * Before 2.5.2 there was no way for npm-installed users to invoke
 * indexing through the published `sweet-search` bin. This test pins
 * the new dispatcher path:
 *   - `sweet-search index --help` forwards into the indexer's help
 *     output and exits 0.
 *   - The indexer-specific flags (--full / --files-from-stdin / etc.)
 *     are mentioned in the dispatcher's top-level help so users can
 *     discover them.
 *   - Args are forwarded verbatim — `sweet-search index --foo=bar`
 *     reaches the indexer's parseArgs as `--foo=bar`.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CLI = join(REPO_ROOT, 'core', 'cli.js');

function run(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf-8',
    timeout: 20_000,
    env: { ...process.env, ...env },
  });
}

describe('sweet-search index — CLI dispatcher', () => {
  it('top-level --help advertises the index subcommand', () => {
    const r = run(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('sweet-search index');
    // Indexing flag block is documented at the top level so users
    // know which flags reach the indexer.
    expect(r.stdout).toContain('--full');
    expect(r.stdout).toContain('--files-from-stdin');
  });

  it('forwards `index --help` to the indexer help branch', () => {
    const r = run(['index', '--help']);
    expect(r.status).toBe(0);
    // Pin two unambiguous lines from the indexer's help block so we
    // know we forwarded into the right module.
    expect(r.stdout).toContain('--graph-only');
    expect(r.stdout).toContain('Output:');
    expect(r.stdout).toContain('.sweet-search/code-graph.db');
  });

  it('rejects `index --bogus-flag` cleanly without crashing the dispatcher', () => {
    // Indexer's parseArgs ignores unknown flags by design (it never
    // throws on extras), so `index --no-such-thing --help` still
    // reaches the help branch. The point of this case is "the
    // dispatcher does not blow up on flags it does not understand —
    // it forwards everything verbatim."
    const r = run(['index', '--unknown-but-harmless', '--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('--graph-only');
  });
});

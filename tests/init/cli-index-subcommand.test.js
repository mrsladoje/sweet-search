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

import { afterEach, describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentHashSync } from '../../core/incremental-indexing/infrastructure/hashing.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CLI = join(REPO_ROOT, 'core', 'cli.js');
let tempRoot = null;

afterEach(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

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
    expect(r.stdout).toContain('sweet-search index --add <path>');
    expect(r.stdout).toContain('sweet-search reconcile status');
    expect(r.stdout).toContain('sweet-search reconcile pause|resume');
    expect(r.stdout).toContain('sweet-search rebuild status');
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

describe('sweet-search reconcile/rebuild — CLI dispatcher', () => {
  function makeState() {
    tempRoot = mkdtempSync(join(tmpdir(), 'ss-cli-reconcile-'));
    const stateDir = join(tempRoot, '.sweet-search');
    mkdirSync(stateDir, { recursive: true });
    return { projectRoot: tempRoot, stateDir };
  }

  it('reports reconcile status from real state files', () => {
    const { projectRoot, stateDir } = makeState();
    writeFileSync(join(stateDir, 'reconcile-manifest.json'), JSON.stringify({
      epoch: 7,
      publishedAt: '2026-05-17T00:00:00.000Z',
    }));
    writeFileSync(join(stateDir, 'index-maintainer-queue.jsonl'), JSON.stringify({
      file_path: 'src/a.js',
      timestamp: 1,
    }) + '\n');
    writeFileSync(join(stateDir, 'rebuild-queue.jsonl'), JSON.stringify({
      tier: 'sparse_gram',
      reason: 'delta_size_ratio',
      epoch: 7,
    }) + '\n');

    const r = run(['reconcile', 'status', '--json', '--project-root', projectRoot]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.manifest.epoch).toBe(7);
    expect(parsed.dirty.pending).toBe(1);
    expect(parsed.pause.paused).toBe(false);
    expect(parsed.rebuild.pending).toBe(1);
    expect(parsed.rebuild.byTier.sparse_gram).toBe(1);
  });

  it('inspects queued files and reports hash/stat diffs against merkle state', () => {
    const { projectRoot, stateDir } = makeState();
    mkdirSync(join(projectRoot, 'src'));
    const filePath = join(projectRoot, 'src', 'a.js');
    writeFileSync(filePath, 'export const value = 1;\n');
    const oldStat = statSync(filePath, { bigint: true });
    const oldHash = contentHashSync(readFileSync(filePath));
    writeFileSync(join(stateDir, 'merkle-state.json'), JSON.stringify({
      lastIndex: '2026-05-17T00:00:00.000Z',
      files: {
        'src/a.js': {
          hash: oldHash,
          size: oldStat.size.toString(),
          mtime_ns: oldStat.mtimeNs.toString(),
          inode: oldStat.ino.toString(),
        },
      },
    }));
    writeFileSync(join(stateDir, 'reconcile-manifest.json'), JSON.stringify({ epoch: 3 }));
    writeFileSync(join(stateDir, 'index-maintainer-queue.jsonl'), JSON.stringify({
      file_path: 'src/a.js',
      timestamp: 2,
    }) + '\n');
    writeFileSync(filePath, 'export const value = 12345;\n');

    const r = run([
      'reconcile', 'inspect', 'src/a.js', '--json',
      '--project-root', projectRoot,
      '--state-dir', stateDir,
    ]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.relativePath).toBe('src/a.js');
    expect(parsed.reasons).toContain('queued');
    expect(parsed.reasons).toContain('hash_diff');
    expect(parsed.reasons).toContain('stat_tuple_diff');
    expect(parsed.state.hashDiff).toBe(true);
  });

  it('queues explicit rebuild maintenance jobs', () => {
    const { stateDir } = makeState();
    const r = run(['rebuild', 'force', 'sparse-gram', '--json', '--state-dir', stateDir]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.job.tier).toBe('sparse_gram');

    const queue = readFileSync(join(stateDir, 'rebuild-queue.jsonl'), 'utf-8').trim().split('\n').map(JSON.parse);
    expect(queue).toHaveLength(1);
    expect(queue[0].tier).toBe('sparse_gram');
    expect(queue[0].reason).toBe('operator_force');
  });

  it('queues index --add dirty hints without running the indexer', () => {
    const { projectRoot, stateDir } = makeState();
    mkdirSync(join(projectRoot, 'src'));
    writeFileSync(join(projectRoot, 'src', 'add.js'), 'export const added = true;\n');

    const r = run(['index', '--add', 'src/add.js', '--json', '--project-root', projectRoot]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.relativePath).toBe('src/add.js');
    expect(parsed.stateDir).toMatch(/\.sweet-search$/);

    const queue = readFileSync(join(stateDir, 'index-maintainer-queue.jsonl'), 'utf-8').trim().split('\n').map(JSON.parse);
    expect(queue).toHaveLength(1);
    expect(queue[0].file_path).toBe('src/add.js');
    expect(queue[0].source).toBe('cli');
  });

  it('rejects index --add paths outside the project root', () => {
    const { projectRoot } = makeState();
    const r = run(['index', '--add', '../outside-ss-add.js', '--json', '--project-root', projectRoot]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('path is outside project root');
  });

  it('pauses and resumes automatic reconcile work through real state files', () => {
    const { projectRoot, stateDir } = makeState();
    const pause = run(['reconcile', 'pause', '--json', '--project-root', projectRoot]);
    expect(pause.status).toBe(0);
    const pausePayload = JSON.parse(pause.stdout);
    expect(pausePayload.pause.paused).toBe(true);
    expect(existsSync(join(stateDir, 'reconcile-pause.json'))).toBe(true);

    const status = run(['reconcile', 'status', '--json', '--project-root', projectRoot]);
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout).pause.paused).toBe(true);

    const resume = run(['reconcile', 'resume', '--json', '--project-root', projectRoot]);
    expect(resume.status).toBe(0);
    const resumePayload = JSON.parse(resume.stdout);
    expect(resumePayload.removed).toBe(true);
    expect(resumePayload.pause.paused).toBe(false);
    expect(existsSync(join(stateDir, 'reconcile-pause.json'))).toBe(false);
  });

  it('runs one production reconcile tick without invoking the legacy indexer', () => {
    const { projectRoot, stateDir } = makeState();
    const r = run(['reconcile', 'tick', '--json', '--project-root', projectRoot, '--state-dir', stateDir]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.kind).toBe('tick');
    expect(parsed.counters.epoch).toBe(1);
    expect(parsed.counters.dirty_paths_seen).toBe(0);
    expect(parsed.counters.files_processed).toBe(0);
    expect(existsSync(join(stateDir, 'reconcile-manifest.json'))).toBe(true);
    expect(existsSync(join(stateDir, 'index-maintainer-queue.processing.jsonl'))).toBe(false);
  });

  it('routes SWEET_SEARCH_RECONCILE_V2 maintainer --once through the production tick', () => {
    const { projectRoot, stateDir } = makeState();
    const maintainer = join(REPO_ROOT, 'core', 'indexing', 'index-maintainer.mjs');
    const r = spawnSync(process.execPath, [maintainer, '--once'], {
      encoding: 'utf-8',
      timeout: 20_000,
      env: {
        ...process.env,
        SWEET_SEARCH_RECONCILE_V2: '1',
        SWEET_SEARCH_PROJECT_ROOT: projectRoot,
        SWEET_SEARCH_STATE_DIR: stateDir,
      },
    });

    expect(r.status).toBe(0);
    expect(r.stderr).toContain('SWEET_SEARCH_RECONCILE_V2 enabled');
    expect(readFileSync(join(stateDir, 'reconcile-manifest.json'), 'utf-8')).toContain('"epoch": 1');
    expect(existsSync(join(stateDir, 'index-maintainer-queue.processing.jsonl'))).toBe(false);
  });
});

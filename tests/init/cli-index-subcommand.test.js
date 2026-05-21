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
import Database from 'better-sqlite3';
import { contentHashSync } from '../../core/incremental-indexing/infrastructure/hashing.mjs';
import { createVectorSchema } from '../../core/indexing/indexer-build.js';

/**
 * Seed a complete baseline so a default-on reconcile tick is allowed to run.
 * Mirrors what the full indexer's final phase produces: a published manifest,
 * a merkle-state carrying a `config_fingerprint` (the marker the reconciler
 * never writes itself), and a real vectors DB. Without this, the baseline gate
 * keeps reconcile dormant (`waiting_for_initial_index`).
 */
function seedBaseline(stateDir, epoch = 1) {
  writeFileSync(join(stateDir, 'reconcile-manifest.json'), JSON.stringify({
    epoch,
    publishedAt: new Date().toISOString(),
    vectors: { path: 'codebase.db', epoch },
  }));
  writeFileSync(join(stateDir, 'merkle-state.json'), JSON.stringify({
    version: '2.4',
    config_fingerprint: { provider: 'test', model: 'fake', dimension: 8, hnswDimension: 8, pipelineVersion: 2 },
    files: {},
    lastIndex: new Date().toISOString(),
    stats: { totalFiles: 0 },
  }));
  const db = new Database(join(stateDir, 'codebase.db'));
  try { createVectorSchema(db); } finally { db.close(); }
}

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
    // Default-on health guardrails are surfaced in status.
    expect(parsed.reconcile).toBeDefined();
    expect(typeof parsed.reconcile.enabled).toBe('boolean');
    expect(typeof parsed.reconcile.source).toBe('string');
    expect(parsed.reconcile.interval.ms).toBeGreaterThan(0);
    expect(typeof parsed.reconcile.interval.source).toBe('string');
    // No maintainer lock written → reported absent (not stale, not crashed).
    expect(parsed.lock.present).toBe(false);
  });

  it('reports reconcile disabled + interval-override source under opt-out', () => {
    const { projectRoot, stateDir } = makeState();
    const r = run(
      ['reconcile', 'status', '--json', '--project-root', projectRoot, '--state-dir', stateDir],
      { SWEET_SEARCH_RECONCILE_V2: '0', SWEET_SEARCH_RECONCILE_INTERVAL_MS: '45000' },
    );
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.reconcile.enabled).toBe(false);
    expect(parsed.reconcile.source).toBe('env-disabled');
    expect(parsed.reconcile.disabledReason).toContain('0');
    expect(parsed.reconcile.interval.ms).toBe(45000);
    expect(parsed.reconcile.interval.source).toBe('env-override-ms');
  });

  it('surfaces a live maintainer lock, and flags a dead one as stale', () => {
    const { projectRoot, stateDir } = makeState();

    writeFileSync(join(stateDir, 'index-maintainer.lock'), JSON.stringify({
      pid: process.pid,
      timestamp: Date.now(),
    }));
    const live = run(['reconcile', 'status', '--json', '--project-root', projectRoot, '--state-dir', stateDir]);
    expect(live.status).toBe(0);
    const liveParsed = JSON.parse(live.stdout);
    expect(liveParsed.lock.present).toBe(true);
    expect(liveParsed.lock.pid).toBe(process.pid);
    expect(liveParsed.lock.alive).toBe(true);
    expect(liveParsed.lock.stale).toBe(false);

    // A very high PID unlikely to be in use → reported present but stale.
    writeFileSync(join(stateDir, 'index-maintainer.lock'), JSON.stringify({
      pid: 2147483600,
      timestamp: Date.now(),
    }));
    const dead = run(['reconcile', 'status', '--json', '--project-root', projectRoot, '--state-dir', stateDir]);
    expect(dead.status).toBe(0);
    const deadParsed = JSON.parse(dead.stdout);
    expect(deadParsed.lock.present).toBe(true);
    expect(deadParsed.lock.alive).toBe(false);
    expect(deadParsed.lock.stale).toBe(true);
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
    seedBaseline(stateDir); // baseline gate: a tick only runs once a baseline exists
    const r = run(['reconcile', 'tick', '--json', '--project-root', projectRoot, '--state-dir', stateDir]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.kind).toBe('tick');
    expect(parsed.counters.epoch).toBe(2); // bumped from the seeded baseline epoch 1
    expect(parsed.counters.dirty_paths_seen).toBe(0);
    expect(parsed.counters.files_processed).toBe(0);
    expect(existsSync(join(stateDir, 'reconcile-manifest.json'))).toBe(true);
    expect(existsSync(join(stateDir, 'index-maintainer-queue.processing.jsonl'))).toBe(false);
  });

  it('refuses a reconcile tick before a baseline exists (waiting_for_initial_index)', () => {
    const { projectRoot, stateDir } = makeState();
    const r = run(['reconcile', 'tick', '--json', '--project-root', projectRoot, '--state-dir', stateDir]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.kind).toBe('tick');
    expect(parsed.skipped).toBe(true);
    expect(parsed.reason).toBe('waiting_for_initial_index');
    // No partial index built by the reconciler.
    expect(existsSync(join(stateDir, 'reconcile-manifest.json'))).toBe(false);
    expect(existsSync(join(stateDir, 'codebase.db'))).toBe(false);
  });

  it('routes SWEET_SEARCH_RECONCILE_V2 maintainer --once through the production tick', () => {
    const { projectRoot, stateDir } = makeState();
    seedBaseline(stateDir);
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
    expect(readFileSync(join(stateDir, 'reconcile-manifest.json'), 'utf-8')).toContain('"epoch": 2');
    expect(existsSync(join(stateDir, 'index-maintainer-queue.processing.jsonl'))).toBe(false);
  });

  it('maintainer --once stays dormant before a baseline (no partial index)', () => {
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
    expect(r.stderr).toContain('waiting_for_initial_index');
    // The reconciler never became the first index builder.
    expect(existsSync(join(stateDir, 'reconcile-manifest.json'))).toBe(false);
    expect(existsSync(join(stateDir, 'codebase.db'))).toBe(false);
    expect(existsSync(join(stateDir, 'code-graph.db'))).toBe(false);
  });
});

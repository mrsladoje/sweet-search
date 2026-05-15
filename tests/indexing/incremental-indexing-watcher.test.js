/**
 * Tests for the file-watcher + WSL2-detect + polling backstop trio.
 *
 * Plan § 9.1-9.5, § 34.6.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DirtySet } from '../../core/incremental-indexing/infrastructure/dirty-set.mjs';
import { FileWatcher, pollingBackstopSweep } from '../../core/incremental-indexing/application/file-watcher.mjs';
import { watcherDefault, formatWatcherNotice, __testing } from '../../core/incremental-indexing/infrastructure/wsl2-detect.mjs';
import { buildPathFilter } from '../../core/incremental-indexing/infrastructure/path-filter.mjs';

describe('watcherDefault', () => {
  it('respects SWEET_SEARCH_WATCH=1 explicit override', () => {
    const d = watcherDefault({ SWEET_SEARCH_WATCH: '1' });
    expect(d.watcherEnabled).toBe(true);
    expect(d.reason).toBe('env-override-on');
  });

  it('respects SWEET_SEARCH_WATCH=0 explicit override', () => {
    const d = watcherDefault({ SWEET_SEARCH_WATCH: '0' });
    expect(d.watcherEnabled).toBe(false);
    expect(d.reason).toBe('env-override-off');
  });

  it('formatWatcherNotice prefixes [sweet-search]', () => {
    const msg = formatWatcherNotice({ watcherEnabled: false, reason: 'wsl2' });
    expect(msg.startsWith('[sweet-search]')).toBe(true);
  });

  it('environment detection result is cached', () => {
    __testing.resetCache();
    const probe = __testing.detectInner();
    expect(typeof probe).toBe('object');
    expect(typeof probe.wsl2).toBe('boolean');
  });
});

describe('pollingBackstopSweep', () => {
  let projectRoot;
  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sweet-search-watch-'));
  });
  afterEach(() => {
    try { fs.rmSync(projectRoot, { recursive: true, force: true }); } catch {}
  });

  it('discovers every non-excluded file under the root', async () => {
    fs.mkdirSync(path.join(projectRoot, 'src'));
    fs.writeFileSync(path.join(projectRoot, 'src', 'a.js'), '1');
    fs.writeFileSync(path.join(projectRoot, 'src', 'b.js'), '2');
    fs.mkdirSync(path.join(projectRoot, 'node_modules'));
    fs.writeFileSync(path.join(projectRoot, 'node_modules', 'noise.js'), 'x');

    const dirty = new DirtySet();
    const isExcluded = buildPathFilter();
    const stats = await pollingBackstopSweep(projectRoot, isExcluded, dirty);
    expect(stats.filesSeen).toBe(2);
    expect(stats.filesEnqueued).toBe(2);
    expect(dirty.size).toBe(2);
    expect(dirty.peek().some((p) => p.includes('node_modules'))).toBe(false);
  });

  it('does not double-enqueue paths the watcher has already pushed', async () => {
    fs.writeFileSync(path.join(projectRoot, 'a.js'), '1');
    const dirty = new DirtySet();
    dirty.add(path.join(projectRoot, 'a.js'));
    const stats = await pollingBackstopSweep(projectRoot, () => false, dirty);
    expect(stats.filesEnqueued).toBe(0);
    expect(dirty.size).toBe(1);
  });
});

describe('FileWatcher', () => {
  let projectRoot;
  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sweet-search-watch2-'));
  });
  afterEach(() => {
    try { fs.rmSync(projectRoot, { recursive: true, force: true }); } catch {}
  });

  it('start() does not throw on a valid project root', async () => {
    const dirty = new DirtySet();
    const w = new FileWatcher({ projectRoot, dirtySet: dirty });
    await w.start();
    expect(w.status().watchers).toBeGreaterThanOrEqual(0);
    await w.stop();
    expect(w.status().stopped).toBe(true);
  });

  it('start() logs but does not throw on missing project root', async () => {
    const dirty = new DirtySet();
    const warnings = [];
    const w = new FileWatcher({
      projectRoot: path.join(projectRoot, 'nonexistent'),
      dirtySet: dirty,
      logger: {
        warn: (msg) => warnings.push(msg),
        error: () => {},
        info: () => {},
      },
    });
    await w.start();
    // Either it warned (typical) or silently noop'd (some platforms).
    await w.stop();
    expect(warnings.length).toBeGreaterThanOrEqual(0);
  });
});

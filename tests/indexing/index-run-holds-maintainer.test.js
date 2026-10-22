import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { holdMaintainerForIndexRun, reconcilePaused, pauseHolds } from '../../core/indexing/maintainer-launcher.mjs';

// `sweet-search index` and the maintainer wrote merkle-state.json, the manifest and the
// stores at the same time, with no exclusion. The index run now pauses the maintainer,
// stops a running one, and lifts only its own pause.
describe('holdMaintainerForIndexRun', () => {
  let stateDir;
  beforeEach(() => { stateDir = mkdtempSync(join(tmpdir(), 'ss-index-hold-')); });
  afterEach(() => { rmSync(stateDir, { recursive: true, force: true }); });

  it('pauses, stops the running maintainer, and removes only its own pause', async () => {
    const fake = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    writeFileSync(join(stateDir, 'index-maintainer.lock'), JSON.stringify({ pid: fake.pid, timestamp: Date.now() }));
    const exited = new Promise((r) => fake.once('exit', r));

    const release = await holdMaintainerForIndexRun(stateDir, { timeoutMs: 5_000 });
    expect(reconcilePaused(stateDir)).toBe(true);
    await exited;
    release();
    expect(existsSync(join(stateDir, 'reconcile-pause.json'))).toBe(false);
  });

  it('keeps a pause that already held (a frozen benchmark index)', async () => {
    writeFileSync(join(stateDir, 'reconcile-pause.json'), JSON.stringify({ paused: true, reason: 'frozen bench' }));
    const release = await holdMaintainerForIndexRun(stateDir);
    release();
    expect(JSON.parse(readFileSync(join(stateDir, 'reconcile-pause.json'), 'utf8')).reason).toBe('frozen bench');
  });

  it('ignores a pause whose holder process is gone', () => {
    expect(pauseHolds({ paused: true, holderPid: 2 ** 22 + 12345 })).toBe(false);
    expect(pauseHolds({ paused: true, holderPid: process.pid })).toBe(true);
    expect(pauseHolds({ paused: true })).toBe(true);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEAD_LEGACY_ARTIFACTS, removeDeadLegacyArtifacts } from '../../core/indexing/legacy-artifact-sweep.js';

describe('removeDeadLegacyArtifacts', () => {
  let stateDir;
  beforeEach(() => { stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-legacy-sweep-')); });
  afterEach(() => { fs.rmSync(stateDir, { recursive: true, force: true }); });

  it('deletes every dead legacy artifact and keeps live files', () => {
    for (const name of DEAD_LEGACY_ARTIFACTS) fs.writeFileSync(path.join(stateDir, name), 'x');
    const live = ['codebase.db', 'codebase-binary-hnsw.idx', 'reconcile-manifest.json', 'merkle-state.json'];
    for (const name of live) fs.writeFileSync(path.join(stateDir, name), 'x');

    const removed = removeDeadLegacyArtifacts(stateDir);

    expect(removed.sort()).toEqual([...DEAD_LEGACY_ARTIFACTS].sort());
    expect(fs.readdirSync(stateDir).sort()).toEqual(live.sort());
  });

  it('is a no-op on a clean or missing state dir', () => {
    expect(removeDeadLegacyArtifacts(stateDir)).toEqual([]);
    expect(removeDeadLegacyArtifacts(path.join(stateDir, 'absent'))).toEqual([]);
  });
});

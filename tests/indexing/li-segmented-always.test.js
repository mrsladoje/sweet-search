import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LateInteractionIndex } from '../../core/ranking/late-interaction-index.js';
import { hasCompleteBaseIndex, baselineStatus, LI_FORMAT_OUTDATED } from '../../core/incremental-indexing/infrastructure/baseline-readiness.mjs';
import { buildConfigFingerprint } from '../../core/indexing/config-fingerprint.js';

// Below one segment of documents the LI index was one JSON file (~4x larger), and the
// incremental path rewrote all of it for every edited file (167 MB, 1.6 s per file at 2,000
// documents). The writer now always writes segments; an older JSON index needs a rebuild.
const DIM = 128;
const tokens = (seed, n = 6) => Array.from({ length: n }, (_, t) => Float32Array.from({ length: DIM }, (_, k) => Math.sin(seed * 7 + t * 13 + k)));

describe('LI index format', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ss-li-seg-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('writes a segmented index even for a few documents, and reads it back', async () => {
    const indexPath = join(dir, 'codebase-late-interaction.db');
    const index = new LateInteractionIndex({ indexPath, loadExisting: false, tokenDim: DIM, maxTokens: 64, useInt8: true, quantBits: 4, modelId: 'lateon-code' });
    await index.init();
    for (const [i, id] of ['a', 'b', 'c'].entries()) await index.add(id, tokens(i), { file: `${id}.js` });
    await index.save();

    const stub = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(stub.format).toBe('segmented');
    const back = new LateInteractionIndex({ indexPath, loadExisting: true });
    await back.init();
    expect([...back.documents.keys()].sort()).toEqual(['a', 'b', 'c']);
  });

  it('holds the maintainer off a single-file JSON index until a full rebuild', () => {
    // A baseline the gate otherwise accepts.
    const stateDir = join(dir, '.sweet-search');
    mkdirSync(stateDir);
    writeFileSync(join(stateDir, 'reconcile-manifest.json'), JSON.stringify({ epoch: 1 }));
    writeFileSync(join(stateDir, 'codebase.db'), '');
    writeFileSync(join(stateDir, 'merkle-state.json'), JSON.stringify({ version: '2.4', config_fingerprint: buildConfigFingerprint(), files: {} }));
    writeFileSync(join(stateDir, 'codebase-late-interaction.db'), JSON.stringify({ version: '3.0', format: 'segmented', segmentDir: 'x' }, null, 2));
    expect(hasCompleteBaseIndex(stateDir)).toEqual({ ready: true, reason: 'ready' });

    writeFileSync(join(stateDir, 'codebase-late-interaction.db'), '{"version":"2.1","modelId":"lateon-code","documents":[]}');
    expect(hasCompleteBaseIndex(stateDir)).toEqual({ ready: false, reason: LI_FORMAT_OUTDATED });
    expect(baselineStatus(stateDir).state).toBe('index_rebuild_required');
  });
});

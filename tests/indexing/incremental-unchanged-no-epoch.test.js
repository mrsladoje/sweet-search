import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import { readIndexedFiles } from '../helpers/file-state.js';

// A tick whose files were all unchanged (a touch, a branch switched back) still published a
// new epoch, and every search daemon reloaded every artifact for nothing. Now it publishes
// no epoch, but the merkle stat refresh still lands so the scan stops requeueing the file.
const MODEL_INFO = Object.freeze({ provider: 'test', model: 'fake', dimension: 8, hnswDimension: 8 });
const vectorEncoder = async (texts) => texts.map((t, i) => Float32Array.from({ length: 8 }, (_, k) => ((t.length + i + k * 13) % 97) / 97));
const liEncoder = async (texts) => texts.map((t) => [Float32Array.from({ length: 8 }, (_, k) => Math.sin(t.length + k))]);

describe('a tick with only unchanged files', () => {
  let projectRoot;
  let stateDir;
  const rel = 'src/a.js';
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-unchanged-'));
    stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(projectRoot, rel), 'export function alpha(x) {\n  return x;\n}\n');
  });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  async function tick() {
    writeFileSync(join(stateDir, 'index-maintainer-queue.jsonl'), `${JSON.stringify({ file_path: rel })}\n`);
    return runProductionReconcileTick({
      projectRoot, stateDir, vectorEncoder, liEncoder, modelInfo: MODEL_INFO,
      logger: { info() {}, warn() {}, error() {} }, config: { filesPerTick: 10, cpuBudgetMs: 10_000 },
    });
  }
  const epoch = () => JSON.parse(readFileSync(join(stateDir, 'reconcile-manifest.json'), 'utf8')).epoch;
  const merkleEntry = () => readIndexedFiles(stateDir)[rel];

  it('publishes no epoch, and records the new stat', async () => {
    await tick();
    const first = epoch();
    const before = merkleEntry();

    const later = new Date(Date.now() + 60_000);
    utimesSync(join(projectRoot, rel), later, later);
    const counters = await tick();

    expect(counters.content_unchanged).toBe(1);
    expect(epoch()).toBe(first);
    const after = merkleEntry();
    expect(after.hash).toBe(before.hash);
    expect(after.mtime_ns).not.toBe(before.mtime_ns);
    expect(existsSync(join(stateDir, 'index-maintainer-queue.processing.jsonl'))).toBe(false);
  });
});

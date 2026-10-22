import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runProductionReconcileTick, resetResidentState, __testing } from '../../core/incremental-indexing/application/production-reconciler.mjs';

// Every tick built a new import resolver over every indexed file (104 ms at 100k files) and
// read every indexed path. A tick that only edits existing files now keeps both.
describe('import resolver kept across maintainer ticks', () => {
  let projectRoot;
  let stateDir;
  beforeEach(() => {
    resetResidentState();
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-resident-'));
    stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
  });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); resetResidentState(); });

  async function tick(...files) {
    writeFileSync(join(stateDir, 'index-maintainer-queue.jsonl'), files.map((f) => `${JSON.stringify({ file_path: f })}\n`).join(''));
    await runProductionReconcileTick({
      projectRoot, stateDir,
      vectorEncoder: async (t) => t.map((s) => Float32Array.from({ length: 8 }, (_, k) => ((s.length + k) % 7) / 7)),
      liEncoder: async (t) => t.map(() => [Float32Array.from([1, 2, 3, 4])]),
      modelInfo: { provider: 'test', model: 'fake', dimension: 8, hnswDimension: 8 },
      logger: { info() {}, warn() {}, error() {} }, config: { filesPerTick: 10, cpuBudgetMs: 10_000 },
    });
  }
  const resolver = () => __testing.residentResolvers.get(projectRoot);

  it('reuses it for edits to existing files and rebuilds it when the file set changes', async () => {
    writeFileSync(join(projectRoot, 'src/a.ts'), "import { b } from './b';\nexport const a = b;\n");
    writeFileSync(join(projectRoot, 'src/b.ts'), 'export const b = 1;\n');
    await tick('src/a.ts', 'src/b.ts');
    writeFileSync(join(projectRoot, 'src/a.ts'), "import { b } from './b';\nexport const a = b + 1;\n");
    await tick('src/a.ts');
    const first = resolver();
    expect(first).toBeTruthy();

    writeFileSync(join(projectRoot, 'src/a.ts'), "import { b } from './b';\nexport const a = b + 2;\n");
    await tick('src/a.ts');
    expect(resolver()).toBe(first);

    writeFileSync(join(projectRoot, 'src/c.ts'), 'export const c = 3;\n');
    await tick('src/c.ts');
    const second = resolver();
    expect(second).not.toBe(first);

    writeFileSync(join(projectRoot, 'src/c.ts'), 'export const c = 4;\n');
    await tick('src/c.ts');
    expect(resolver()).toBe(second);
  });
});

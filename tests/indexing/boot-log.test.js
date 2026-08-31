import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootLog, isBootQuiet } from '../../core/infrastructure/boot-log.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('bootLog gate', () => {
  it('is silent when SS_QUIET_BOOT=1 and logs otherwise', () => {
    const seen = [];
    const orig = console.log;
    console.log = (...a) => seen.push(a.join(' '));
    try {
      const prev = process.env.SS_QUIET_BOOT;
      process.env.SS_QUIET_BOOT = '1';
      bootLog('should not appear'); expect(isBootQuiet()).toBe(true);
      delete process.env.SS_QUIET_BOOT;
      bootLog('should appear'); expect(isBootQuiet()).toBe(false);
      if (prev === undefined) delete process.env.SS_QUIET_BOOT; else process.env.SS_QUIET_BOOT = prev;
    } finally { console.log = orig; }
    expect(seen).toEqual(['should appear']);
  });
});

// Guard: the modules that emit engine load/boot banners must route them through
// bootLog, never raw console.log — otherwise an in-process cold-start leaks them
// onto an ss-* tool's stdout (the agent's captured result). This test fails if a
// raw console.log of a boot-banner pattern is re-introduced.
describe('no raw console.log boot banners in engine-load modules', () => {
  const FILES = [
    'core/ranking/late-interaction-index.js',
    'core/ranking/late-interaction-model.js',
    'core/vector-store/binary-hnsw-index.js',
    'core/embedding/embedding-service.js',
    'core/embedding/embedding-local-model.js',
    'core/embedding/embedding-cache.js',
    'core/infrastructure/config/embedding.js',
  ];
  // Unambiguous load-banner markers (not bare "Provider:", which the incremental
  // reconcile diagnostics legitimately print elsewhere).
  const BANNER = /console\.log\([^\n]*(BinaryHNSW: Loaded|LateInteraction|Loading local model|Loading lateon|Warming up embedding|Warmup complete|\[ORT\] Direct session|Local model loaded in|ONNX output|SemanticCache\] (Loading|Local model))/;
  for (const rel of FILES) {
    it(`${rel} uses bootLog for load banners`, () => {
      const src = readFileSync(path.join(REPO, rel), 'utf8');
      const offenders = src.split('\n')
        .map((l, i) => [i + 1, l])
        .filter(([, l]) => BANNER.test(l) && !/process\.env\.DEBUG/.test(l));
      expect(offenders, `raw console.log boot banner(s) — use bootLog:\n${offenders.map(([n, l]) => `  ${rel}:${n}  ${l.trim()}`).join('\n')}`).toEqual([]);
    });
  }
});

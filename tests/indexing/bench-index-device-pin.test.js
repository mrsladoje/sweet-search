/**
 * Every script that starts the indexer for a benchmark or eval index must
 * pin SWEET_SEARCH_INDEX_DEVICE (or call eval/lib/bench-index-device.mjs), so
 * a benchmark index is never moved to the CPU by the index-device speed test.
 * A new script that starts index-codebase-v21.js without the pin fails here.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DIRS = ['eval', 'scripts', 'core/prompt-optimization'];
const EXT = /\.(sh|js|mjs|cjs|py)$/;

// Files that name the indexer but never start a benchmark build.
const EXEMPT = new Map([
  ['eval/agent-read-workflows/bin/_ss-helpers.mjs', 'agent tool: prints an index hint, output mirrored by the native lane'],
  ['scripts/benchmark.js', 'starts the indexer with --dry-run only (no models, no speed test)'],
]);

function trackedScripts() {
  const out = execFileSync('git', ['ls-files', '-z', '--', ...DIRS], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return out.split('\0').filter((f) => EXT.test(f));
}

describe('benchmark indexer launches pin the index device', () => {
  it('every script that starts index-codebase-v21.js sets SWEET_SEARCH_INDEX_DEVICE', () => {
    const missing = [];
    for (const rel of trackedScripts()) {
      if (EXEMPT.has(rel)) continue;
      let text;
      try { text = readFileSync(path.join(ROOT, rel), 'utf8'); } catch { continue; }
      if (!text.includes('index-codebase-v21')) continue;
      if (!/SWEET_SEARCH_INDEX_DEVICE|benchIndexDevice/.test(text)) missing.push(rel);
    }
    expect(missing).toEqual([]);
  });
});

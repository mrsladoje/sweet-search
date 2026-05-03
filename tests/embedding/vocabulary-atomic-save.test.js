/**
 * Regression tests for atomic vocabulary persistence.
 *
 * Background: under benchmark load (concurrency=12) the previous direct
 * `fs.writeFile` call inside `Vocabulary.save()` could overlap with itself,
 * producing invalid JSON in `query-vocabulary.json`. The corrupted file then
 * poisoned every subsequent `.load()` call. The fix serialises saves through
 * an in-instance queue and writes via tmp-file-and-rename. These tests pin
 * that contract.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Vocabulary, QueryStats } from '../../core/embedding/embedding-cache.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vocab-atomic-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function listLeftoverTmpFiles(dir, baseName) {
  const entries = await fs.readdir(dir).catch(() => []);
  return entries.filter((e) => e.startsWith(`${baseName}.tmp.`));
}

describe('Vocabulary atomic persistence', () => {
  it('produces valid JSON under 50 concurrent save() calls', async () => {
    const vocabPath = path.join(tmpDir, 'query-vocabulary.json');
    const vocab = new Vocabulary(vocabPath);

    const N = 50;
    for (let i = 0; i < N; i++) {
      vocab.set(`term-${i}`, [i, i + 1, i + 2]);
    }

    // Fire N save() calls concurrently. Each save reads the *current* state at
    // the moment its turn comes up, so the final file should always parse and
    // contain at least the terms that existed when the last save started.
    await Promise.all(Array.from({ length: N }, () => vocab.save()));

    const raw = await fs.readFile(vocabPath, 'utf-8');
    const parsed = JSON.parse(raw); // would throw if interleaved
    expect(parsed.terms).toBeTruthy();
    expect(Object.keys(parsed.terms)).toHaveLength(N);
    expect(parsed.terms['term-0']).toEqual([0, 1, 2]);
    expect(parsed.terms['term-49']).toEqual([49, 50, 51]);
    // Schema version was bumped to 3 (added model + dimension fields)
    // alongside the safety guards in `vocabulary-safety.test.js`.
    expect(parsed.metadata.schemaVersion).toBe(3);
  });

  it('coalesces saves: a burst of 100 calls does not write 100 times', async () => {
    const vocabPath = path.join(tmpDir, 'query-vocabulary.json');
    const vocab = new Vocabulary(vocabPath);
    vocab.set('initial', [1, 2, 3]);

    // Monkey-patch fs/promises.writeFile (the binding embedding-cache.js holds)
    // to count actual disk writes. The fix should coalesce a 100-call burst
    // into at most 2 underlying writes.
    const fsp = await import('fs/promises');
    const originalWrite = fsp.default.writeFile;
    let writes = 0;
    fsp.default.writeFile = (...args) => { writes++; return originalWrite(...args); };

    try {
      await Promise.all(Array.from({ length: 100 }, () => vocab.save()));
    } finally {
      fsp.default.writeFile = originalWrite;
    }

    // At most one in-flight + one pending = ≤2 underlying writes. Allow 3 to
    // give the queue a tick of slack on slow CI workers.
    expect(writes).toBeGreaterThanOrEqual(1);
    expect(writes).toBeLessThanOrEqual(3);

    const parsed = JSON.parse(await fs.readFile(vocabPath, 'utf-8'));
    expect(parsed.terms.initial).toEqual([1, 2, 3]);
  });

  it('leaves no temp files after successful saves', async () => {
    const vocabPath = path.join(tmpDir, 'query-vocabulary.json');
    const vocab = new Vocabulary(vocabPath);
    vocab.set('alpha', [1]);
    await vocab.save();

    vocab.set('beta', [2]);
    await Promise.all([vocab.save(), vocab.save(), vocab.save()]);

    const leftover = await listLeftoverTmpFiles(tmpDir, 'query-vocabulary.json');
    expect(leftover).toEqual([]);
  });

  it('round-trips through save/load preserving terms', async () => {
    const vocabPath = path.join(tmpDir, 'query-vocabulary.json');
    const writer = new Vocabulary(vocabPath);
    writer.set('GraphSearch', new Array(8).fill(0).map((_, i) => i * 0.1));
    writer.set('Cascade', [0.5, -0.5, 0.25]);
    await writer.save();

    const reader = new Vocabulary(vocabPath);
    await reader.load();
    expect(reader.size()).toBe(2);
    expect(reader.get('GraphSearch')).toBeTruthy();
    expect(reader.get('Cascade')).toEqual([0.5, -0.5, 0.25]);
    expect(reader.has('graphsearch')).toBe(true); // case-insensitive normalize
  });

  it('subsequent save observes the latest state, not the state at schedule time', async () => {
    const vocabPath = path.join(tmpDir, 'query-vocabulary.json');
    const vocab = new Vocabulary(vocabPath);
    vocab.set('first', [1]);

    // Kick off one save (will start writing immediately) and a second pending
    // one, then mutate state and fire a third save *while* the first is still
    // running. The final file must contain `mid` even though it was added
    // after the very first save() call.
    const p1 = vocab.save();
    vocab.set('mid', [2]);
    const p2 = vocab.save();
    vocab.set('late', [3]);
    const p3 = vocab.save();
    await Promise.all([p1, p2, p3]);

    const parsed = JSON.parse(await fs.readFile(vocabPath, 'utf-8'));
    expect(parsed.terms.first).toEqual([1]);
    expect(parsed.terms.mid).toEqual([2]);
    expect(parsed.terms.late).toEqual([3]);
  });
});

describe('QueryStats atomic persistence', () => {
  it('produces valid JSON under concurrent saves', async () => {
    const statsPath = path.join(tmpDir, 'query-vocabulary-stats.json');
    const stats = new QueryStats(statsPath);
    stats.increment('hello');
    stats.increment('world');

    await Promise.all(Array.from({ length: 30 }, () => stats.save()));

    const parsed = JSON.parse(await fs.readFile(statsPath, 'utf-8'));
    expect(parsed.queries.hello).toBe(1);
    expect(parsed.queries.world).toBe(1);
  });

  it('skips writes when not dirty', async () => {
    const statsPath = path.join(tmpDir, 'query-vocabulary-stats.json');
    const stats = new QueryStats(statsPath);

    await stats.save(); // not dirty → no file
    expect(await fs.access(statsPath).then(() => true, () => false)).toBe(false);

    stats.increment('hello');
    await stats.save();
    expect(await fs.access(statsPath).then(() => true, () => false)).toBe(true);

    // After a clean save, dirty is false again — second save is a no-op.
    const mtime1 = (await fs.stat(statsPath)).mtimeMs;
    await new Promise((r) => setTimeout(r, 5));
    await stats.save();
    const mtime2 = (await fs.stat(statsPath)).mtimeMs;
    expect(mtime2).toBe(mtime1);
  });

  it('leaves no temp files behind', async () => {
    const statsPath = path.join(tmpDir, 'query-vocabulary-stats.json');
    const stats = new QueryStats(statsPath);
    for (let i = 0; i < 10; i++) stats.increment(`q-${i}`);
    await Promise.all(Array.from({ length: 10 }, () => stats.save()));

    const leftover = await listLeftoverTmpFiles(tmpDir, 'query-vocabulary-stats.json');
    expect(leftover).toEqual([]);
  });
});

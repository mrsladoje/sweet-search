/**
 * The ss-grep speed work keeps every answer: each fast path here is checked against the
 * slower path it replaces.
 *   - readSparseGramDeltaRecordsSince (reads only appended bytes) vs a full read
 *   - the cached delta overlay vs a fresh load
 *   - per-file totals over a capped match list vs the full list (file selection)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readSparseGramDeltaRecordsSince,
  resolveLatestSparseGramDeltaRecords,
} from '../../core/infrastructure/sparse-gram-delta-reader.js';
import {
  _resetSparseDeltaOverlayCache,
  applySparseDeltaOverlay,
  liveOverlayFiles,
  loadSparseDeltaOverlay,
} from '../../core/search/search-pattern-sparse-overlay.js';
import { applyGrepFileDiversity } from '../../core/search/grep-output-shaping.js';

const WEIGHTS = 'w1';

function record(fileId, filePath, grams, extra = {}) {
  return JSON.stringify({ fileId, filePath, deleted: false, symbolMask: 0, weightsId: WEIGHTS, grams, ...extra });
}

describe('incremental sparse-gram delta reading', () => {
  let dir;
  let base;
  let seg;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-delta-inc-'));
    base = path.join(dir, 'codebase-sparse-grams.idx');
    fs.mkdirSync(`${base}.deltas`);
    seg = `${base}.deltas/5-1.ssgrmdelta`;
    _resetSparseDeltaOverlayCache();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Replays the reader's callbacks into a Map, as the overlay cache does.
  function follow(cursor, latest) {
    return readSparseGramDeltaRecordsSince(base, { segments: [seg, '5-1.ssgrmdelta'] }, cursor, {
      onReset: () => latest.clear(),
      onRecord: (r) => latest.set(r.fileId, r),
    });
  }
  const full = () => new Map([...resolveLatestSparseGramDeltaRecords(base, { segments: [seg] })].map(([k, v]) => [k, v.record]));

  it('equals a full read after appends, a torn last line and replacements', () => {
    const latest = new Map();
    fs.writeFileSync(seg, `${record('a', 'a.js', ['abc'])}\n${record('b', 'b.js', ['bcd'])}\n${record('c', 'c.js', ['x']).slice(0, 20)}`);
    let cursor = follow(null, latest);
    expect([...latest]).toEqual([...full()]);
    fs.appendFileSync(seg, `${record('c', 'c.js', ['x']).slice(20)}\n${record('a', 'a2.js', ['zzz'])}\n`);
    cursor = follow(cursor, latest);
    expect([...latest]).toEqual([...full()]);
    expect([...latest.keys()]).toEqual(['a', 'b', 'c']); // a replaced record keeps its place
    fs.appendFileSync(seg, `${record('b', 'b.js', [], { deleted: true })}`); // complete, no newline yet
    cursor = follow(cursor, latest);
    expect([...latest]).toEqual([...full()]);
    fs.appendFileSync(seg, `\n${record('d', 'd.js', ['q'])}\n`);
    follow(cursor, latest);
    expect([...latest]).toEqual([...full()]);
  });

  it('reads everything again when a segment is replaced (compaction) or rewritten in place', () => {
    const latest = new Map();
    fs.writeFileSync(seg, `${record('a', 'a.js', ['abc'])}\n${record('b', 'b.js', ['bcd'])}\n`);
    let cursor = follow(null, latest);
    fs.writeFileSync(`${seg}.tmp`, `${record('c', 'c.js', ['c'])}\n`);
    fs.renameSync(`${seg}.tmp`, seg);
    cursor = follow(cursor, latest);
    expect([...latest]).toEqual([...full()]);
    fs.writeFileSync(seg, `${record('e', 'e.js', ['e'])}\n${record('f', 'f.js', ['ffff'])}\n`);
    follow(cursor, latest);
    expect([...latest]).toEqual([...full()]);
  });

  it('a cached overlay answers as a fresh load does', () => {
    const searcher = { projectRoot: dir, sparseGramIndexPath: base, sparseGramDeltas: [seg], sparseGramWeightsId: WEIGHTS };
    const lines = [];
    for (let i = 0; i < 40; i++) lines.push(record(`f${i}`, `src/f${i}.js`, [[`g${i % 7}`, 1], [`h${i % 3}`, 1], 'common']));
    lines.push(record('f3', 'src/f3.js', [], { deleted: true }));
    lines.push(record('f4', 'src/f4.js', ['other'], { weightsId: 'old' }));
    fs.writeFileSync(seg, `${lines.join('\n')}\n`);
    const check = () => {
      const cached = loadSparseDeltaOverlay(searcher);
      _resetSparseDeltaOverlayCache();
      const fresh = loadSparseDeltaOverlay(searcher);
      expect([...cached.hidden]).toEqual([...fresh.hidden]);
      for (const literals of [null, ['g1'], ['common'], ['g2', 'h1'], ['absent']]) {
        expect(liveOverlayFiles(cached, 0, literals, null)).toEqual(liveOverlayFiles(fresh, 0, literals, null));
        expect(applySparseDeltaOverlay(['src/f1.js', 'src/f3.js', 'lib/x.js'], cached, 0, dir, literals, null))
          .toEqual(applySparseDeltaOverlay(['src/f1.js', 'src/f3.js', 'lib/x.js'], fresh, 0, dir, literals, null));
      }
    };
    loadSparseDeltaOverlay(searcher);
    check();
    fs.appendFileSync(seg, `${record('f9', 'src/f9.js', ['g1', 'new'])}\n${record('f50', 'src/f50.js', ['g1'])}\n`);
    loadSparseDeltaOverlay(searcher); // warm the cache through the append
    check();
  });
});

describe('file selection from per-file totals', () => {
  // Files with 1..60 hits; the capped list keeps the first `cap` of each, in line order.
  const files = ['a.js', 'b.test.js', 'c.js', 'dist/d.js', 'e.js', 'f.spec.js', 'g.js'];
  const full = [];
  files.forEach((file, i) => {
    for (let line = 1; line <= [60, 3, 25, 9, 1, 40, 7][i]; line++) full.push({ file, line, column: 1 });
  });
  const capOf = (cap) => {
    const totals = new Map();
    const capped = [];
    for (const m of full) {
      const n = (totals.get(m.file) || 0) + 1;
      totals.set(m.file, n);
      if (n <= cap) capped.push(m);
    }
    return { capped, totals };
  };

  for (const opts of [
    { perFileCap: 5, maxFiles: 3 },
    { perFileCap: 20, maxFiles: 20 },
    { perFileCap: 1, maxFiles: 2, hiddenSampleSize: 2 },
  ]) {
    it(`keeps the same files, lines and counts (${JSON.stringify(opts)})`, () => {
      const { capped, totals } = capOf(opts.perFileCap);
      expect(applyGrepFileDiversity(capped, { ...opts, totals })).toEqual(applyGrepFileDiversity(full, opts));
    });
  }
});

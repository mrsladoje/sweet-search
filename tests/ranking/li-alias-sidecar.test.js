/**
 * Alias sidecar persistence (NDJSON v2 + v1 back-compat).
 *
 * The sidecar used to be one monolithic JSON.stringify — on extreme-dedup
 * repos the payload string crossed V8's ~512 MB hard cap and save threw
 * "Invalid string length" (libsql golden rebuild, 2026-07). It is now
 * written as NDJSON in bounded batches; these tests pin the roundtrip,
 * the v1 back-compat read, the orphan guard, stale-sidecar removal, and —
 * critically — the header-count truncation guard: NDJSON cut at a line
 * boundary is valid prefix NDJSON, so without the count check a crash
 * mid-save would load a silent subset of aliases.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { LateInteractionIndex } from '../../core/ranking/late-interaction-index.js';

let TMP;

function makeIndex(name = 'li.db') {
  return new LateInteractionIndex({
    tokenDim: 128,
    quantBits: 8,
    indexPath: path.join(TMP, name),
    loadExisting: false,
  });
}

beforeEach(() => {
  TMP = mkdtempSync(path.join(tmpdir(), 'ss-alias-sidecar-'));
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('alias sidecar NDJSON roundtrip', () => {
  it('saves v2 NDJSON and loads it back exactly', async () => {
    const idx = makeIndex();
    // 50k aliases forces multiple write batches (batch size is 20k lines).
    for (let i = 0; i < 50000; i++) {
      idx.addAlias(`alias-${i}`, `exemplar-${i % 100}`, i % 7, { file: `src/f${i}.js` });
      idx.documents.set(`exemplar-${i % 100}`, { numTokens: 1 });
    }
    await idx._saveAliasSidecar();

    const sidecar = readFileSync(idx._aliasSidecarPath(), 'utf-8');
    const lines = sidecar.trimEnd().split('\n');
    expect(JSON.parse(lines[0])).toEqual({ version: 2, count: 50000 });
    expect(lines.length).toBe(50001);

    const loaded = makeIndex();
    for (let i = 0; i < 100; i++) loaded.documents.set(`exemplar-${i}`, { numTokens: 1 });
    await loaded._loadAliasSidecar(idx.indexPath);
    expect(loaded.aliasPointers.size).toBe(50000);
    expect(loaded.aliasPointers.get('alias-123')).toEqual({
      exemplarId: 'exemplar-23',
      clusterId: 123 % 7,
      metadata: { file: 'src/f123.js' },
    });
  });

  it('still reads a legacy v1 monolithic sidecar', async () => {
    const idx = makeIndex();
    idx.documents.set('ex-1', { numTokens: 1 });
    const v1 = {
      version: 1,
      count: 2,
      aliases: [
        { aliasId: 'a-1', exemplarId: 'ex-1', clusterId: 3, metadata: { file: 'x.js' } },
        { aliasId: 'a-2', exemplarId: 'ex-gone', clusterId: 4, metadata: {} },
      ],
    };
    writeFileSync(idx._aliasSidecarPath(), JSON.stringify(v1));
    await idx._loadAliasSidecar();
    // a-1 loads; a-2 is dropped by the orphan guard (exemplar not in documents).
    expect(idx.aliasPointers.size).toBe(1);
    expect(idx.aliasPointers.get('a-1')).toEqual({ exemplarId: 'ex-1', clusterId: 3, metadata: { file: 'x.js' } });
  });

  it('applies the orphan guard on v2 loads', async () => {
    const idx = makeIndex();
    idx.addAlias('a-live', 'ex-live', 1, {});
    idx.addAlias('a-orphan', 'ex-gone', 2, {});
    idx.documents.set('ex-live', { numTokens: 1 });
    idx.documents.set('ex-gone', { numTokens: 1 });
    await idx._saveAliasSidecar();

    const loaded = makeIndex();
    loaded.documents.set('ex-live', { numTokens: 1 }); // ex-gone absent
    await loaded._loadAliasSidecar(idx.indexPath);
    expect(loaded.aliasPointers.size).toBe(1);
    expect(loaded.aliasPointers.has('a-live')).toBe(true);
  });

  it('rejects a v2 sidecar truncated exactly at a line boundary (silent-subset guard)', async () => {
    // The dangerous truncation: a partial NDJSON file cut at a newline is
    // syntactically valid line-by-line, so without the header-count check it
    // would load a silent subset. Simulate a crash mid-save: header says 3,
    // only 2 alias lines made it to disk.
    const idx = makeIndex();
    idx.documents.set('ex-1', { numTokens: 1 });
    writeFileSync(idx._aliasSidecarPath(),
      '{"version":2,"count":3}\n' +
      '{"aliasId":"a-1","exemplarId":"ex-1","clusterId":1,"metadata":{}}\n' +
      '{"aliasId":"a-2","exemplarId":"ex-1","clusterId":2,"metadata":{}}\n');
    await idx._loadAliasSidecar();
    expect(idx.aliasPointers.size).toBe(0);
  });

  it('rejects a v2 sidecar with more lines than the header count', async () => {
    const idx = makeIndex();
    idx.documents.set('ex-1', { numTokens: 1 });
    writeFileSync(idx._aliasSidecarPath(),
      '{"version":2,"count":1}\n' +
      '{"aliasId":"a-1","exemplarId":"ex-1","clusterId":1,"metadata":{}}\n' +
      '{"aliasId":"a-2","exemplarId":"ex-1","clusterId":2,"metadata":{}}\n');
    await idx._loadAliasSidecar();
    expect(idx.aliasPointers.size).toBe(0);
  });

  it('does NOT trip the count guard on orphan-dropped aliases (parsed lines, not kept)', async () => {
    // count=2 with both lines present but one orphaned: the orphan guard
    // drops it, and the truncation guard must count PARSED lines so the
    // legitimate alias survives.
    const idx = makeIndex();
    idx.documents.set('ex-live', { numTokens: 1 });
    writeFileSync(idx._aliasSidecarPath(),
      '{"version":2,"count":2}\n' +
      '{"aliasId":"a-live","exemplarId":"ex-live","clusterId":1,"metadata":{}}\n' +
      '{"aliasId":"a-orphan","exemplarId":"ex-gone","clusterId":2,"metadata":{}}\n');
    await idx._loadAliasSidecar();
    expect(idx.aliasPointers.size).toBe(1);
    expect(idx.aliasPointers.has('a-live')).toBe(true);
  });

  it('rejects a v2 header with a missing or non-numeric count', async () => {
    const idx = makeIndex();
    idx.documents.set('ex-1', { numTokens: 1 });
    writeFileSync(idx._aliasSidecarPath(),
      '{"version":2}\n' +
      '{"aliasId":"a-1","exemplarId":"ex-1","clusterId":1,"metadata":{}}\n');
    await idx._loadAliasSidecar();
    expect(idx.aliasPointers.size).toBe(0);
  });

  it('treats a malformed sidecar as absent', async () => {
    const idx = makeIndex();
    idx.documents.set('ex-1', { numTokens: 1 });
    writeFileSync(idx._aliasSidecarPath(), '{"version":2,"count":1}\nnot-json-at-all\n');
    await idx._loadAliasSidecar();
    expect(idx.aliasPointers.size).toBe(0);
  });

  it('removes a stale sidecar when there are no aliases', async () => {
    const idx = makeIndex();
    writeFileSync(idx._aliasSidecarPath(), '{"version":2,"count":0}\n');
    await idx._saveAliasSidecar();
    expect(existsSync(idx._aliasSidecarPath())).toBe(false);
  });
});

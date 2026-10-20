import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createEncoderClient, encoderIdleMs, encoderProcessEnabled } from '../../core/indexing/encoder-client.mjs';
import { takeProvenance } from '../../core/indexing/inference-provenance.js';

// A stand-in for encoder-host.mjs: same protocol, no models.
const FAKE_HOST = `
process.on('message', (msg) => {
  const { id, op, texts } = msg;
  if (texts[0] === 'crash') process.exit(3);
  if (op === 'dense') {
    process.send({ id, progress: true });
    process.send({ id, ok: true, result: texts.map((t) => ({ embedding: Float32Array.from([t.length]) })),
      provenance: { dense: { 'ort-q8/cpu': texts.length }, li: {} }, rss: texts[0] === 'fat' ? 1e12 : 1 });
  } else if (op === 'count') {
    process.send({ id, ok: true, result: texts.map((t) => t.length), provenance: { dense: {}, li: {} }, rss: 1 });
  } else {
    process.send({ id, ok: false, error: 'bad op' });
  }
});
process.on('disconnect', () => process.exit(0));
`;

describe('encoder client', () => {
  let dir;
  let client;
  const make = (opts = {}) => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-encoder-client-'));
    const hostPath = path.join(dir, 'host.mjs');
    fs.writeFileSync(hostPath, FAKE_HOST);
    client = createEncoderClient({ hostPath, idleMs: 60_000, ...opts });
    return client;
  };
  afterEach(() => {
    client?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    takeProvenance();
  });

  it('encodes in a child, forwards progress and records the provenance the child reports', async () => {
    const c = make();
    takeProvenance();
    let progress = 0;
    const out = await c.dense(['ab', 'abc'], { onProgress: () => { progress += 1; } });
    expect(out.map((r) => Array.from(r.embedding))).toEqual([[2], [3]]);
    expect(out[0].embedding).toBeInstanceOf(Float32Array);
    expect(progress).toBe(1);
    expect(takeProvenance().dense).toEqual({ 'ort-q8/cpu': 2 });
    expect(await c.li.countTokens(['abcd'])).toEqual([4]);
    expect(c.li.provenanceLabel).toBe('ort/cpu');
    expect(c.spawns).toBe(1);
  });

  it('stops the child when idle and starts a new one on the next request', async () => {
    const c = make({ idleMs: 50 });
    await c.dense(['a']);
    const first = c.pid;
    expect(first).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 300));
    expect(c.pid).toBeNull();
    await c.dense(['b']);
    expect(c.pid).not.toBe(first);
    expect(c.spawns).toBe(2);
  });

  it('fails the pending request when the child dies, then recovers', async () => {
    const c = make();
    await expect(c.dense(['crash'])).rejects.toThrow(/encoder process exited/);
    expect((await c.dense(['ok']))[0].embedding[0]).toBe(2);
    expect(c.spawns).toBe(2);
  });

  it('replaces a child whose RSS passes the cap, after its reply', async () => {
    const c = make({ rssMaxBytes: 1e9 });
    await c.dense(['fat']);
    expect(c.pid).toBeNull();
    await c.dense(['x']);
    expect(c.spawns).toBe(2);
  });

  it('rejects an error reply without killing the child', async () => {
    const c = make();
    await expect(c.li(['x'])).rejects.toThrow(/bad op/);
    expect(c.pid).toBeGreaterThan(0);
  });
});

describe('encoder client config', () => {
  it('runs encoders in a child unless switched off; idle defaults to 60 s', () => {
    expect(encoderProcessEnabled({})).toBe(true);
    expect(encoderProcessEnabled({ SWEET_SEARCH_MAINTAINER_ENCODER_PROCESS: '0' })).toBe(false);
    expect(encoderIdleMs({})).toBe(60_000);
    expect(encoderIdleMs({ SWEET_SEARCH_ENCODER_IDLE_MS: '5000' })).toBe(5_000);
    expect(encoderIdleMs({ SWEET_SEARCH_ENCODER_IDLE_MS: '-1' })).toBe(60_000);
  });
});

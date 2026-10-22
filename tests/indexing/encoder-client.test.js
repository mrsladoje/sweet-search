import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createEncoderClient, encoderIdleMs } from '../../core/indexing/encoder-client.mjs';
import { takeProvenance } from '../../core/indexing/inference-provenance.js';

// A stand-in for encoder-host.mjs: same protocol, no models.
const FAKE_HOST = `
process.on('message', (msg) => {
  const { id, op, texts } = msg;
  if (texts[0] === 'crash') process.exit(3);
  if (texts[0] === 'hang') return;
  if (op === 'dense') {
    process.send({ id, progress: true });
    process.send({ id, ok: true, result: texts.map((t) => ({ embedding: Float32Array.from([t.length]) })),
      provenance: { dense: { 'ort-q8/cpu': texts.length }, li: {} }, rss: texts[0] === 'fat' ? 1e12 : 1 });
  } else if (op === 'warm') {
    process.send({ id, ok: true, result: null, provenance: { dense: {}, li: {} }, rss: 1 });
  } else if (op === 'count') {
    process.send({ id, ok: true, result: texts.map((t) => t.length), provenance: { dense: {}, li: {} }, rss: 1 });
  } else {
    process.send({ id, ok: false, error: 'bad op', rss: texts[0] === 'fat' ? 1e12 : 1 });
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

  // The first edit after idle waited for the process start plus both model loads in
  // sequence; warm() starts it early and later requests reuse that process.
  it('warm() starts the process once, and requests reuse it', async () => {
    const c = make();
    c.warm();
    expect(c.spawns).toBe(1);
    expect(c.pid).toBeGreaterThan(0);
    c.warm();
    await c.dense(['ab']);
    expect(c.spawns).toBe(1);
  });

  // A cold start (process + both models) cost seconds, 13 s under load, after every
  // idle minute. A process needed again soon after its idle exit stays longer.
  it('doubles the idle period when work returns soon after an idle exit, up to the cap', async () => {
    const c = make({ idleMs: 40, maxIdleMs: 160 });
    const exited = async () => { const t0 = Date.now(); while (c.pid !== null && Date.now() - t0 < 5_000) await new Promise((r) => setTimeout(r, 10)); };
    await c.dense(['a']);
    expect(c.idleMs).toBe(40);
    await exited();
    await c.dense(['a']);
    expect(c.idleMs).toBe(80);
    await exited();
    await c.dense(['a']);
    expect(c.idleMs).toBe(160);
    await exited();
    await c.dense(['a']);
    expect(c.idleMs).toBe(160);
  });

  it('announces the child pid on start and null once it is gone', async () => {
    const seen = [];
    const c = make({ idleMs: 50, onChildChange: (pid) => seen.push(pid) });
    await c.dense(['a']);
    const pid = c.pid;
    for (let i = 0; i < 40 && seen.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
    expect(seen).toEqual([pid, null]);
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
    await expect(c.dense(['crash'])).rejects.toThrow(/encoder process (exited|disconnected)/);
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

  it('kills a child that goes silent on a request, then recovers', async () => {
    // Start-up gets a long grace (a loaded host can take seconds to start a child); the
    // 200 ms silence limit then applies to a child that is up and goes quiet mid-request.
    const c = make({ requestTimeoutMs: 200, startupGraceMs: 60_000 });
    await c.dense(['warm']);
    const hungPid = c.pid;
    await expect(c.dense(['hang'])).rejects.toThrow(/timed out after 200 ms/);
    expect(c.pid).toBeNull();
    await new Promise((r) => setTimeout(r, 100));
    expect(() => process.kill(hungPid, 0)).toThrow();
    expect((await c.dense(['ok']))[0].embedding[0]).toBe(2);
  }, 120_000);

  // An MCP server searches in-process and speaks its protocol on stdout; model loading in
  // the query child logs to stdout. childStdout: 2 sends the child's stdout to our stderr.
  it('can send the child\'s stdout to this process\'s stderr', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-encoder-client-'));
    const hostPath = path.join(dir, 'host.mjs');
    fs.writeFileSync(hostPath, `console.log('MODEL-LOAD-NOISE');\n${FAKE_HOST}`);
    const script = path.join(dir, 'parent.mjs');
    const clientUrl = new URL('../../core/indexing/encoder-client.mjs', import.meta.url).href;
    fs.writeFileSync(script, `import { createEncoderClient } from '${clientUrl}';
const c = createEncoderClient({ hostPath: '${hostPath}', childStdout: 2 });
await c.dense(['ok']);
c.close();
process.stdout.write('PROTOCOL');`);
    const { spawnSync } = await import('node:child_process');
    const run = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 60_000 });
    expect(run.stdout).toBe('PROTOCOL');
    expect(run.stderr).toContain('MODEL-LOAD-NOISE');
  }, 90_000);

  it('kills a new child that sends nothing within the start-up grace', async () => {
    const c = make({ requestTimeoutMs: 100, startupGraceMs: 300 });
    await expect(c.dense(['hang'])).rejects.toThrow(/timed out after 300 ms/);
    expect(c.pid).toBeNull();
  });

  it('kills the child at once on close, even mid-request', async () => {
    const c = make();
    await c.dense(['warm']);
    const pid = c.pid;
    const hung = c.dense(['hang']);
    c.close();
    await expect(hung).rejects.toThrow(/encoder process (exited|disconnected)/);
    const gone = () => { try { process.kill(pid, 0); return false; } catch { return true; } };
    for (let i = 0; i < 40 && !gone(); i++) await new Promise((r) => setTimeout(r, 50));
    expect(gone()).toBe(true);
  });

  it('fails a request at once when the child cannot start', async () => {
    const c = make({ execPath: path.join(os.tmpdir(), 'no-such-node-binary') });
    const t = Date.now();
    await expect(c.dense(['a'])).rejects.toThrow(/encoder process (error|exited|disconnected)/);
    expect(Date.now() - t).toBeLessThan(5_000);
  });

  it('rejects with the progress callback\'s own error and drops the child', async () => {
    const c = make();
    const cancel = Object.assign(new Error('shutdown requested'), { name: 'MaintainerLifecycleAbort' });
    await expect(c.dense(['a'], { onProgress: () => { throw cancel; } })).rejects.toBe(cancel);
    expect(c.pid).toBeNull();
    expect((await c.dense(['b']))[0].embedding[0]).toBe(1);
  });

  it('applies the RSS cap after an error reply too', async () => {
    const c = make({ rssMaxBytes: 1e9 });
    await expect(c.li(['fat'])).rejects.toThrow(/bad op/);
    expect(c.pid).toBeNull();
  });

  it('rejects an error reply without killing the child', async () => {
    const c = make();
    await expect(c.li(['x'])).rejects.toThrow(/bad op/);
    expect(c.pid).toBeGreaterThan(0);
  });
});

describe('encoder client config', () => {
  it('idle defaults to 60 s', () => {
    expect(encoderIdleMs({})).toBe(60_000);
    expect(encoderIdleMs({ SWEET_SEARCH_ENCODER_IDLE_MS: '5000' })).toBe(5_000);
    expect(encoderIdleMs({ SWEET_SEARCH_ENCODER_IDLE_MS: '-1' })).toBe(60_000);
  });
});

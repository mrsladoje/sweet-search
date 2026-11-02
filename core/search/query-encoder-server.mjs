/**
 * One query-model process shared by every search daemon with the same model setup.
 *
 * Each daemon used to start its own query-model child (query-encoder.mjs), ~950 MB while
 * warm. With several checkouts in use at once (linked worktrees: Claude Code makes one
 * per session) that is the same two models loaded several times. This server holds them
 * once and answers every daemon whose setup has the same key (shared-query-encoder.mjs
 * queryEncoderKey) over a Unix domain socket.
 *
 * Wire: a frame is a 4-byte big-endian length and a v8-serialized value (typed arrays
 * pass as-is, as over the advanced-serialization IPC the child uses).
 *   request  { id, op, texts, options }      ops: encoder-ops.mjs, query role
 *   reply    { id, ok: true, result } | { id, ok: false, error }
 *
 * Lifecycle: started detached by the first daemon that finds no server. It binds the
 * socket before it loads any model, exits after `idleMs` with no request in flight from
 * any daemon, and after a reply that leaves it over the memory cap (the next request
 * starts a new one). A second server for the same socket exits at once.
 *
 * Run as: node query-encoder-server.mjs --socket=<path> --idle-ms=<ms>
 */

import fs from 'node:fs';
import net from 'node:net';
import v8 from 'node:v8';
import { setProcessTitle } from '../infrastructure/process-title.js';

export const MAX_FRAME_BYTES = 256 * 1024 * 1024;

export function encodeFrame(value) {
  const body = v8.serialize(value);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  return Buffer.concat([head, body]);
}

/** Splits a byte stream into frames; calls `onFrame(value)` for each. Throws on a bad frame. */
export function createFrameReader(onFrame) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (buf.length >= 4) {
      const len = buf.readUInt32BE(0);
      if (len > MAX_FRAME_BYTES) throw new Error(`frame of ${len} bytes is over the limit`);
      if (buf.length < 4 + len) break;
      const body = buf.subarray(4, 4 + len);
      buf = buf.subarray(4 + len);
      onFrame(v8.deserialize(body));
    }
  };
}

/** Is a server answering on `socketPath`? */
export function socketAnswers(socketPath, timeoutMs = 500) {
  return new Promise((resolve) => {
    const s = net.connect(socketPath);
    const done = (v) => { clearTimeout(t); s.destroy(); resolve(v); };
    const t = setTimeout(() => done(false), timeoutMs);
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

async function main() {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || '';
  const socketPath = arg('socket');
  const idleMs = Number(arg('idle-ms')) || 15 * 60_000;
  const rssMaxBytes = Number(process.env.SWEET_SEARCH_QUERY_MODEL_RSS_MAX_MB) * 1024 * 1024 || 6 * 1024 ** 3;
  if (!socketPath) process.exit(2);
  setProcessTitle('sweet-search-query-encoder');

  // Another server already answers: this one is not needed. A socket file nobody answers
  // on is left over from a server that died; take its place.
  if (await socketAnswers(socketPath)) process.exit(0);
  try { fs.unlinkSync(socketPath); } catch { /* none */ }

  // SWEET_SEARCH_QUERY_ENCODER_OPS: a test seam (a module with the same runEncoderOp).
  const { runEncoderOp } = await import(process.env.SWEET_SEARCH_QUERY_ENCODER_OPS || '../indexing/encoder-ops.mjs');
  const projectRoot = process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd();
  let inflight = 0;
  let lastActivity = Date.now();
  let stopping = false;

  const server = net.createServer((conn) => {
    const reader = createFrameReader(async (msg) => {
      const { id, op, texts, options } = msg || {};
      inflight += 1;
      lastActivity = Date.now();
      let reply;
      try {
        reply = { id, ok: true, result: await runEncoderOp(op, texts, { projectRoot, options }) };
      } catch (err) {
        reply = { id, ok: false, error: String(err?.stack || err?.message || err) };
      }
      inflight -= 1;
      lastActivity = Date.now();
      if (!conn.destroyed) conn.write(encodeFrame(reply));
      // Over the cap: stop taking work and exit once the replies are out. The daemons
      // reconnect, and the first of them starts a fresh server.
      if (process.memoryUsage.rss() > rssMaxBytes) stop('rss over the cap');
    });
    conn.on('data', (chunk) => {
      try { reader(chunk); } catch { conn.destroy(); }
    });
    conn.on('error', () => {});
  });

  function stop(reason) {
    if (stopping) return;
    stopping = true;
    server.close();
    try { if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath); } catch { /* gone */ }
    const finish = () => {
      if (inflight > 0) { setTimeout(finish, 50); return; }
      process.stderr.write(`[query-encoder-server] exiting: ${reason}\n`);
      process.exit(0);
    };
    finish();
  }

  server.on('error', (err) => {
    // Lost the race to another new server: it serves.
    if (err?.code === 'EADDRINUSE') process.exit(0);
    process.stderr.write(`[query-encoder-server] ${err?.message || err}\n`);
    process.exit(1);
  });
  server.listen(socketPath, () => {
    try { fs.chmodSync(socketPath, 0o600); } catch { /* best effort */ }
  });

  const idleTimer = setInterval(() => {
    if (inflight === 0 && Date.now() - lastActivity > idleMs) stop('idle');
    // The socket file was removed or replaced (a newer server took over): leave.
    else if (!stopping) {
      try {
        if (!fs.existsSync(socketPath)) stop('socket removed');
      } catch { /* keep serving */ }
    }
  }, Math.min(10_000, Math.max(100, Math.floor(idleMs / 4))));
  idleTimer.unref?.();
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname)) {
  main();
}

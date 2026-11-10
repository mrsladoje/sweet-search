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
import { fileURLToPath } from 'node:url';
import { setProcessTitle } from '../infrastructure/process-title.js';
import { takeStartLock, dropStartLock as dropLock, socketAnswers } from '../infrastructure/socket-claim.js';

const MAX_FRAME_BYTES = 256 * 1024 * 1024;

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

async function main() {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || '';
  const socketPath = arg('socket');
  const idleMs = Number(arg('idle-ms')) || 15 * 60_000;
  const rssMaxBytes = Number(process.env.SWEET_SEARCH_QUERY_MODEL_RSS_MAX_MB) * 1024 * 1024 || 6 * 1024 ** 3;
  if (!socketPath) process.exit(2);
  setProcessTitle('sweet-search-query-encoder');

  // One starting server per socket: two that probed an empty path at once would each
  // remove the other's socket. The start lock is created atomically (write, then link);
  // a lock whose holder is gone is taken over.
  const startLock = `${socketPath}.start`;
  if (!takeStartLock(startLock)) process.exit(0);
  const dropStartLock = () => dropLock(startLock);
  // Another server already answers: this one is not needed. A socket file nobody answers
  // on is left over from a server that died; take its place.
  if (await socketAnswers(socketPath)) { dropStartLock(); process.exit(0); }
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
      // The fleet registry is one shared file: refresh this entry at most every 30 s.
      if (registration && lastActivity - lastTouch >= 30_000) {
        lastTouch = lastActivity;
        registration.touch(lastActivity).catch(() => {});
      }
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

  let socketIno = null; // the socket file this server bound
  let lastTouch = 0;
  let registration = null; // the fleet memory budget's entry (rss-budget.mjs)
  function stop(reason) {
    if (stopping) return;
    stopping = true;
    // Closing a Unix-socket server makes Node remove the socket PATH, whatever file is
    // there by then. A newer server may have taken the path over: then this one only stops
    // answering and exits, and leaves the path alone.
    let ownPath = false;
    try { ownPath = socketIno !== null && fs.statSync(socketPath).ino === socketIno; } catch { ownPath = false; }
    if (ownPath) server.close();
    registration?.unregister().catch(() => {});
    const finish = () => {
      if (inflight > 0) { setTimeout(finish, 50); return; }
      process.stderr.write(`[query-encoder-server] exiting: ${reason}\n`);
      process.exit(0);
    };
    finish();
  }

  server.on('error', (err) => {
    // Lost the race to another new server: it serves.
    if (err?.code === 'EADDRINUSE') { dropStartLock(); process.exit(0); }
    process.stderr.write(`[query-encoder-server] ${err?.message || err}\n`);
    process.exit(1);
  });
  server.listen(socketPath, () => {
    try { fs.chmodSync(socketPath, 0o600); } catch { /* best effort */ }
    try { socketIno = fs.statSync(socketPath).ino; } catch { /* checked again on stop */ }
    dropStartLock();
    // Counted in the fleet memory budget like the daemons it serves (the per-daemon child
    // was counted as its daemon's child; this process belongs to no single daemon).
    import('../indexing/rss-budget.mjs')
      .then((mod) => mod.registerDaemon({ pid: process.pid, stateDir: null, kind: 'query-encoder' }))
      .then((r) => { registration = r; if (stopping) r.unregister().catch(() => {}); })
      .catch(() => { /* best effort: not counted */ });
  });

  const idleTimer = setInterval(() => {
    if (inflight === 0 && Date.now() - lastActivity > idleMs) stop('idle');
    // The socket file was removed or replaced (a newer server took over): leave.
    else if (!stopping && socketIno !== null) {
      let ino = null;
      try { ino = fs.statSync(socketPath).ino; } catch { ino = null; }
      if (ino !== socketIno) stop('socket removed or replaced');
    }
  }, Math.min(10_000, Math.max(100, Math.floor(idleMs / 4))));
  idleTimer.unref?.();
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

const isMain = (() => {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain) main();

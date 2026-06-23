// Guard + repo-isolation unit tests for the /trace and /read daemon handlers.
// The happy path (byte-identical output vs the in-process CLI) is covered
// end-to-end against the fresh m2crb index; these lock the cheap guards that
// keep the daemon endpoints unix-socket-only and repo-isolated, mirroring the
// /read-semantic contract.
import { describe, it, expect } from 'vitest';
import { realpathSync } from 'node:fs';
import {
  buildTraceDaemonResponse,
  buildReadDaemonResponse,
} from '../../core/search/search-server.js';

const root = realpathSync.native(process.cwd());
const enc = encodeURIComponent;

describe('buildTraceDaemonResponse guards', () => {
  it('403 when the request is not over a unix socket', async () => {
    const r = await buildTraceDaemonResponse(`/trace?symbol=x&projectRoot=${enc(root)}`, {
      isUnixSocket: false, serverReady: true, searcher: { projectRoot: root },
    });
    expect(r.status).toBe(403);
  });

  it('503 when the server is not ready', async () => {
    const r = await buildTraceDaemonResponse('/trace?symbol=x', {
      isUnixSocket: true, serverReady: false,
    });
    expect(r.status).toBe(503);
  });

  it('400 when the symbol is missing', async () => {
    const r = await buildTraceDaemonResponse(`/trace?projectRoot=${enc(root)}`, {
      isUnixSocket: true, serverReady: true, searcher: { projectRoot: root },
    });
    expect(r.status).toBe(400);
  });

  it('409 on project-root mismatch (repo isolation)', async () => {
    const r = await buildTraceDaemonResponse(`/trace?symbol=x&projectRoot=${enc('/some/other/root')}`, {
      isUnixSocket: true, serverReady: true, searcher: { projectRoot: root },
    });
    expect(r.status).toBe(409);
  });
});

describe('buildReadDaemonResponse guards', () => {
  it('403 when the request is not over a unix socket', async () => {
    const r = await buildReadDaemonResponse(`/read?path=a.py&projectRoot=${enc(root)}`, {
      isUnixSocket: false, serverReady: true, searcher: { projectRoot: root },
    });
    expect(r.status).toBe(403);
  });

  it('400 when no path is given', async () => {
    const r = await buildReadDaemonResponse(`/read?projectRoot=${enc(root)}`, {
      isUnixSocket: true, serverReady: true, searcher: { projectRoot: root },
    });
    expect(r.status).toBe(400);
  });

  it('400 when --lines is combined with multiple paths', async () => {
    const r = await buildReadDaemonResponse(
      `/read?path=a.py&path=b.py&startLine=1&projectRoot=${enc(root)}`,
      { isUnixSocket: true, serverReady: true, searcher: { projectRoot: root } },
    );
    expect(r.status).toBe(400);
  });

  it('409 on project-root mismatch (repo isolation)', async () => {
    const r = await buildReadDaemonResponse(`/read?path=a.py&projectRoot=${enc('/some/other/root')}`, {
      isUnixSocket: true, serverReady: true, searcher: { projectRoot: root },
    });
    expect(r.status).toBe(409);
  });

  it('does NOT 503 when the server is not yet ready — read needs no index (Codex fix)', async () => {
    // /read returns file bytes from node:fs and never touches the searcher, so
    // it must serve during the cold-start init window. With serverReady:false it
    // now falls through to normal validation (400 for a missing path) instead of
    // the gratuitous 503 that made the native client exit on a freshly-spawned
    // daemon. (read-semantic/trace keep their gate + a bounded readiness wait.)
    const r = await buildReadDaemonResponse(`/read?projectRoot=${enc(root)}`, {
      isUnixSocket: true, serverReady: false, initError: null, searcher: { projectRoot: root },
    });
    expect(r.status).not.toBe(503);
    expect(r.status).toBe(400); // validation runs (the readiness gate is gone)
  });
});

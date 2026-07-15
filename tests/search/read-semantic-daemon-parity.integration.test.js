/**
 * HARD-CONSTRAINT lock: daemon `/read-semantic` is BYTE-IDENTICAL to the
 * in-process read-semantic path.
 *
 * The pre-existing helper tests cover per-aspect behaviour (403/409/injection/
 * disk-reread/staleness) but never a full-body diff and never a real socket
 * round-trip. This file closes both gaps:
 *
 *   (1) HERMETIC body-construction parity (always runs): for a non-LI fallback
 *       fixture, the daemon handler (buildReadSemanticDaemonResponse) body must
 *       deep-equal the in-process formatReadSemanticResult(await readSemantic())
 *       body for JSON, and equal the agent text modulo the single trailing
 *       newline the handler appends. Both code paths call the same readSemantic
 *       + formatReadSemanticResult, so this proves the handler adds nothing.
 *
 *   (2) REAL SOCKET round-trip on the LI-indexed eval/corpus/m2crb fixture
 *       (OPT-IN — needs the corpus/index AND SWEET_SEARCH_PARITY_SOCKET_TEST=1
 *       or SWEET_SEARCH_EXTRA_TESTS=1; otherwise skipped, because daemon LI-init
 *       takes tens of seconds under the contended full suite). Start an ISOLATED
 *       unix-socket daemon (unique SWEET_SEARCH_SOCKET_PATH + SWEET_SEARCH_PID_FILE
 *       under /tmp, same projectRoot to satisfy the 409 same-project guard),
 *       fetch GET /read-semantic, and assert the JSON body deep-equals
 *       in-process modulo timings.totalMs, and the agent text equals modulo the
 *       trailing newline + the timings telemetry. The shared m2crb daemon
 *       (default per-project socket) is NEVER touched; /stop only hits the
 *       agent-owned isolated socket and the daemon is force-killed in afterEach.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import {
  readSemantic,
  formatReadSemanticResult,
  __resetReadSemanticCachesForTests,
} from '../../core/search/search-read-semantic.js';
import {
  buildReadSemanticDaemonResponse,
  queryReadSemanticServer,
  queryServer,
} from '../../core/search/search-server.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = join(REPO_ROOT, 'core', 'cli.js');
const M2CRB = join(REPO_ROOT, 'eval', 'corpus', 'm2crb');
const M2CRB_LI_DB = join(M2CRB, '.sweet-search', 'codebase-late-interaction.db');

/** Drop the two documented, allowed sources of variance. */
function stripTotalMs(obj) {
  const clone = JSON.parse(JSON.stringify(obj));
  if (clone.timings && 'totalMs' in clone.timings) delete clone.timings.totalMs;
  return clone;
}

// ===========================================================================
// (1) Hermetic body-construction parity (no daemon process).
// ===========================================================================
describe('read-semantic daemon parity — hermetic body construction', () => {
  let TMP;

  beforeEach(() => {
    __resetReadSemanticCachesForTests();
    TMP = mkdtempSync(join(tmpdir(), 'ss-rsem-parity-'));
  });
  afterEach(() => {
    try { rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
    __resetReadSemanticCachesForTests();
  });

  function routeUrl(params) {
    return `/read-semantic?${new URLSearchParams(params).toString()}`;
  }

  it('JSON: daemon handler body deep-equals in-process body (fallback fixture)', async () => {
    const rel = 'src/widget.js';
    const body = 'export function widget() {\n  return 42;\n}\n\n// trailing comment\n';
    mkdirSync(join(TMP, 'src'), { recursive: true });
    writeFileSync(join(TMP, rel), body);

    const query = 'how does widget compute its value';

    // In-process path (the ground truth).
    const ipResult = await readSemantic({ path: rel, query, projectRoot: TMP });
    const ipBody = formatReadSemanticResult(ipResult, 'json');

    // Daemon handler path (same projectRoot satisfies the 409 guard).
    const daemonResp = await buildReadSemanticDaemonResponse(
      routeUrl({ path: rel, q: query, projectRoot: TMP, format: 'json' }),
      { isUnixSocket: true, serverReady: true, searcher: { projectRoot: TMP } },
    );
    expect(daemonResp.status).toBe(200);
    expect(daemonResp.contentType).toBe('application/json');

    // JSON content type → NO trailing newline appended; bodies are identical
    // modulo timings.totalMs telemetry.
    expect(stripTotalMs(JSON.parse(daemonResp.body)))
      .toEqual(stripTotalMs(JSON.parse(ipBody)));
  });

  it('agent: daemon handler text equals in-process text modulo the single trailing newline', async () => {
    const rel = 'a.py';
    const body = 'def compute():\n    return sum(range(10))\n';
    writeFileSync(join(TMP, rel), body);
    const query = 'compute the sum';

    const ipText = formatReadSemanticResult(
      await readSemantic({ path: rel, query, projectRoot: TMP }), 'agent',
    );
    const daemonResp = await buildReadSemanticDaemonResponse(
      routeUrl({ path: rel, q: query, projectRoot: TMP, format: 'agent' }),
      { isUnixSocket: true, serverReady: true, searcher: { projectRoot: TMP } },
    );
    expect(daemonResp.status).toBe(200);
    expect(daemonResp.contentType).toBe('text/plain; charset=utf-8');
    // The handler appends exactly one '\n' for the agent/plain wire format.
    expect(daemonResp.body).toBe(`${ipText}\n`);
    // And nothing else differs.
    expect(daemonResp.body.replace(/\n$/, '')).toBe(ipText);
  });
});

describe('warm-daemon JSON clients', () => {
  let dir;
  let socketPath;
  let server;
  let previousSocket;
  let requests;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ss-client-sock-'));
    socketPath = join(dir, 'daemon.sock');
    previousSocket = process.env.SWEET_SEARCH_SOCKET_PATH;
    process.env.SWEET_SEARCH_SOCKET_PATH = socketPath;
    requests = [];
    server = http.createServer((req, res) => {
      requests.push(new URL(req.url, 'http://localhost'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url.startsWith('/read-semantic?')) {
        res.end(JSON.stringify({ ok: true, file: 'src/a b.js', spans: [] }));
      } else {
        res.end(JSON.stringify({ results: [], stats: {}, fileSummary: { files: [] } }));
      }
    });
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(socketPath, resolveListen);
    });
  });

  afterEach(async () => {
    await new Promise(resolveClose => server.close(resolveClose));
    if (previousSocket == null) delete process.env.SWEET_SEARCH_SOCKET_PATH;
    else process.env.SWEET_SEARCH_SOCKET_PATH = previousSocket;
    rmSync(dir, { recursive: true, force: true });
  });

  it('forwards grep shaping, project identity, and span-tracking controls', async () => {
    const response = await queryServer('needle', {
      mode: 'grep', regex: 'needle', fileFilter: 'src/a b.js',
      perFileCap: 7, maxFiles: 9, projectRoot: '/repo with space',
      trackAgentSpans: false, _isAgentFormat: true,
    });
    expect(response.fileSummary).toEqual({ files: [] });
    const params = requests[0].searchParams;
    expect(params.get('fileFilter')).toBe('src/a b.js');
    expect(params.get('perFileCap')).toBe('7');
    expect(params.get('maxFiles')).toBe('9');
    expect(params.get('projectRoot')).toBe('/repo with space');
    expect(params.get('trackAgentSpans')).toBe('false');
    expect(params.get('agent')).toBe('true');
  });

  it('requests semantic JSON with the existing exact maxChars budget', async () => {
    const response = await queryReadSemanticServer({
      path: 'src/a b.js', query: 'how it works', projectRoot: '/repo', maxChars: 2400,
    });
    expect(response.ok).toBe(true);
    const request = requests[0];
    expect(request.pathname).toBe('/read-semantic');
    expect(request.searchParams.get('format')).toBe('json');
    expect(request.searchParams.get('maxChars')).toBe('2400');
    expect(request.searchParams.get('path')).toBe('src/a b.js');
  });
});

// ===========================================================================
// (2) Real socket round-trip on the LI-indexed m2crb fixture.
// ===========================================================================
const hasM2crbLi = (() => {
  try { return existsSync(M2CRB_LI_DB) && statSync(M2CRB_LI_DB).size > 1_000_000; }
  catch { return false; }
})();

// A real source file + a query that lands on an LI span (verified during dev).
const M2CRB_FILE = 'python/m2crb-es/EstimationModel.convert_velocity_from_pixels_frames_46f13f37.py';
const M2CRB_QUERY = 'convert velocity from pixels';

// The real-socket round-trip starts a daemon that loads the heavy LI index
// (~5-10s on a quiet box, but tens of seconds when the daemon-init competes for
// CPU inside the full parallel `npm test`). It is OPT-IN — like the heavy ORT
// tests in vitest.config.js — so the contended default suite stays green and
// this byte-parity lock runs in isolation:
//   SWEET_SEARCH_PARITY_SOCKET_TEST=1 npm test -- --run <this file>
//   (SWEET_SEARCH_EXTRA_TESTS=1 also enables it.)
// The cheap, deterministic HERMETIC body-construction parity above ALWAYS runs
// and already proves the daemon handler adds nothing but the trailing newline.
const runSocketParity = hasM2crbLi
  && (process.env.SWEET_SEARCH_PARITY_SOCKET_TEST === '1'
    || process.env.SWEET_SEARCH_EXTRA_TESTS === '1');

(runSocketParity ? describe : describe.skip)(
  'read-semantic daemon parity — real socket round-trip (m2crb LI index)',
  () => {
    let dir;
    let socketPath;
    let pidFile;
    let child;
    let childExited;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function httpGet(path, { timeoutMs = 8000 } = {}) {
      return new Promise((res) => {
        const req = http.request({ socketPath, path, method: 'GET' }, (r) => {
          let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => res({ status: r.statusCode, body: b }));
        });
        req.on('error', () => res(null));
        req.setTimeout(timeoutMs, () => { req.destroy(); res(null); });
        req.end();
      });
    }

    async function waitForReady(deadlineMs = 120_000) {
      const end = Date.now() + deadlineMs;
      while (Date.now() < end) {
        const r = await httpGet('/health', { timeoutMs: 1000 });
        if (r && r.status === 200) {
          try { if (JSON.parse(r.body).status === 'ready') return true; } catch { /* keep polling */ }
        }
        await sleep(500);
      }
      return false;
    }

    beforeEach(() => {
      __resetReadSemanticCachesForTests();
      dir = mkdtempSync(join(tmpdir(), 'ss-rsem-parity-sock-'));
      socketPath = join(dir, 'd.sock');
      pidFile = join(dir, 'd.pid');
      child = null;
    });

    afterEach(async () => {
      // Only ever kill the agent-owned isolated daemon.
      if (child && child.exitCode === null && child.signalCode === null) {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        await Promise.race([childExited, sleep(2000)]);
      }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      __resetReadSemanticCachesForTests();
    });

    function startIsolatedDaemon() {
      const env = {
        ...process.env,
        SWEET_SEARCH_SOCKET_PATH: socketPath,
        SWEET_SEARCH_PID_FILE: pidFile,
        SWEET_SEARCH_PROJECT_ROOT: M2CRB,
        SWEET_SEARCH_RECONCILE_V2: '0',   // no maintainer
        SWEET_SEARCH_TCP_PORT: '',        // unix socket only
        SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '0', // never idle-evict mid-test
      };
      delete env.SWEET_SEARCH_DAEMON_REGISTRY; // never enumerate shared peers
      child = spawn(process.execPath, [CLI, '--serve'], { env, cwd: M2CRB, stdio: 'ignore' });
      childExited = new Promise((res) => child.once('exit', (code, signal) => res({ code, signal })));
    }

    it('JSON body is byte-identical to in-process (modulo timings.totalMs)', async () => {
      startIsolatedDaemon();
      expect(await waitForReady()).toBe(true);

      const params = new URLSearchParams({
        path: M2CRB_FILE, q: M2CRB_QUERY, projectRoot: M2CRB, format: 'json', k: '3',
      });
      const daemon = await httpGet(`/read-semantic?${params}`);
      expect(daemon?.status).toBe(200);

      const ipBody = formatReadSemanticResult(
        await readSemantic({ path: M2CRB_FILE, query: M2CRB_QUERY, projectRoot: M2CRB, topK: 3 }),
        'json',
      );

      const dParsed = JSON.parse(daemon.body);
      const pParsed = JSON.parse(ipBody);
      // This is a real LI hit, not a fallback — the whole point of the parity lock.
      expect(dParsed.indexed).toBe(true);
      expect(dParsed.fellBack).toBe(false);
      expect(stripTotalMs(dParsed)).toEqual(stripTotalMs(pParsed));
    }, 180_000);

    it('agent text is byte-identical modulo trailing newline + timings telemetry', async () => {
      startIsolatedDaemon();
      expect(await waitForReady()).toBe(true);

      const params = new URLSearchParams({
        path: M2CRB_FILE, q: M2CRB_QUERY, projectRoot: M2CRB, format: 'agent', k: '3',
      });
      const daemon = await httpGet(`/read-semantic?${params}`);
      expect(daemon?.status).toBe(200);

      const ipText = formatReadSemanticResult(
        await readSemantic({ path: M2CRB_FILE, query: M2CRB_QUERY, projectRoot: M2CRB, topK: 3 }),
        'agent',
      );

      // Strip the single trailing newline the handler appends; the agent format
      // carries no per-call timings line, so the remaining bytes must match.
      expect(daemon.body.replace(/\n$/, '')).toBe(ipText);
    }, 180_000);
  },
);

/**
 * Tests for core/cli.js read-semantic dispatch (commit d168ead) + envFalsey.
 *
 * cli.js routes `read-semantic` to the native Unix-socket client by default so
 * the warm daemon serves LI scoring without per-call model startup, and falls
 * back to the in-process handleReadSemanticCli when
 * SWEET_SEARCH_SEMANTIC_VIA_DAEMON is falsey ('0'/'false'/'off'/'no').
 *
 * cli.js is a top-level-await script that runs on import and envFalsey is
 * module-private, so we exercise the REAL dispatch via subprocess and assert on
 * which branch produced the output. The two branches emit unmistakably
 * different bytes for an un-indexed project:
 *   - in-process fallback: pretty-printed JSON with "fellBack": true + the
 *     "file not indexed" reason (handleReadSemanticCli → formatReadSemanticResult).
 *   - native (default) path: the native client's single-line daemon error
 *     ("Server initialization failed: No search indexes found").
 * No daemon is started and an isolated tmp project root is used, so the shared
 * m2crb index and the user's working-repo daemons are never touched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, execSync } from 'node:child_process';
import {
  mkdtempSync, writeFileSync, rmSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../../core/cli.js');

// Under Rosetta (x64 emulated on Apple Silicon — the CI darwin-x64 leg), the
// native daemon binary does not spawn a working server, so read-semantic
// silently takes the in-process fallback. That defeats the "native path"
// assertions below, which check the dispatch *branch* (native vs in-process),
// not search results. Skip those only under translation; real Apple Silicon and
// real Intel Macs run them normally.
const isRosetta = (() => {
  if (process.platform !== 'darwin') return false;
  try {
    return execSync('sysctl -n sysctl.proc_translated', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === '1';
  } catch { return false; }
})();

let projectRoot;
let socketPath;
let pidFile;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'ss-cli-rsem-'));
  socketPath = join(projectRoot, 'isolated.sock');
  pidFile = join(projectRoot, 'isolated.pid');
});

afterEach(async () => {
  // The DEFAULT dispatch path runs the native binary, which auto-spawns a warm
  // daemon (core/start-server.js) on our isolated socket when none is reachable.
  // We feed those subprocesses a short idle-TTL (below) so they self-evict, but
  // belt-and-suspenders: synchronously SIGKILL anything still holding our
  // agent-owned isolated socket so no daemon swarm survives the test. We NEVER
  // touch the shared m2crb daemon or the user's working-repo daemons — only
  // processes bound to this unique /tmp socket path.
  try {
    const out = execSync(`lsof -U 2>/dev/null | grep ${JSON.stringify(socketPath)} || true`, {
      encoding: 'utf-8',
    });
    const pids = [...new Set(out.split('\n').map((l) => l.trim().split(/\s+/)[1]).filter(Boolean))];
    for (const pid of pids) {
      if (/^\d+$/.test(pid)) { try { process.kill(Number(pid), 'SIGKILL'); } catch { /* gone */ } }
    }
  } catch { /* lsof unavailable — the short idle-TTL still reaps them */ }
  try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

/**
 * Run `node core/cli.js read-semantic <args>` in the isolated un-indexed
 * project root. Forces a unique socket/pidfile so even the (default) native
 * path can never reach a shared daemon — with no index + no daemon it falls
 * straight through to the daemon-init error, which is exactly the marker we
 * key on.
 */
function runReadSemantic(args, extraEnv = {}) {
  return new Promise((res) => {
    const env = {
      ...process.env,
      SWEET_SEARCH_PROJECT_ROOT: projectRoot,
      SWEET_SEARCH_SOCKET_PATH: socketPath,
      SWEET_SEARCH_PID_FILE: pidFile,
      SWEET_SEARCH_TCP_PORT: '',
      // Any daemon the native default-path auto-spawns inherits this short
      // idle-TTL and self-evicts within a few seconds instead of lingering.
      SWEET_SEARCH_DAEMON_IDLE_TTL_MS: '1200',
      SWEET_SEARCH_DAEMON_IDLE_CHECK_MS: '300',
      // No registry participation — never enumerate/evict shared peers.
      SWEET_SEARCH_MAX_DAEMONS: '',
      ...extraEnv,
    };
    delete env.SWEET_SEARCH_DAEMON_REGISTRY;
    const p = spawn(process.execPath, [CLI, 'read-semantic', ...args], {
      env, cwd: projectRoot, stdio: 'pipe',
    });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('exit', (code) => res({ code, stdout, stderr }));
  });
}

const isInProcessFallback = (out) =>
  out.includes('"fellBack": true') && out.includes('file not indexed');
const isNativeDaemonPath = (out) =>
  out.includes('Server initialization failed') || out.includes('No search indexes found');

// ---------------------------------------------------------------------------
// envFalsey truth table, observed through the dispatch branch it selects.
// ---------------------------------------------------------------------------
describe('cli.js read-semantic — envFalsey routing', () => {
  it("'0' forces the in-process fallback (debug escape hatch)", async () => {
    writeFileSync(join(projectRoot, 'a.js'), 'export const A = 1;\n');
    const r = await runReadSemantic(['a.js', 'A', '--format=json'], {
      SWEET_SEARCH_SEMANTIC_VIA_DAEMON: '0',
    });
    expect(isInProcessFallback(r.stdout)).toBe(true);
    expect(isNativeDaemonPath(r.stdout)).toBe(false);
  });

  it.each(['false', 'off', 'no', 'FALSE', 'Off'])(
    "'%s' is treated as falsey → in-process fallback",
    async (val) => {
      writeFileSync(join(projectRoot, 'a.js'), 'export const A = 1;\n');
      const r = await runReadSemantic(['a.js', 'A', '--format=json'], {
        SWEET_SEARCH_SEMANTIC_VIA_DAEMON: val,
      });
      expect(isInProcessFallback(r.stdout)).toBe(true);
    },
  );

  it.skipIf(isRosetta).each(['1', 'true', 'yes', 'anything-else'])(
    "'%s' is NOT falsey → default native path (no in-process fallback bytes)",
    async (val) => {
      writeFileSync(join(projectRoot, 'a.js'), 'export const A = 1;\n');
      const r = await runReadSemantic(['a.js', 'A', '--format=json'], {
        SWEET_SEARCH_SEMANTIC_VIA_DAEMON: val,
      });
      // The default path dispatched to the native client (which, with no index
      // + no reachable daemon, returns the daemon-init error), NOT the JS
      // in-process fallback.
      expect(isInProcessFallback(r.stdout)).toBe(false);
      expect(isNativeDaemonPath(r.stdout)).toBe(true);
    },
  );

  it.skipIf(isRosetta)('unset flag (production default) takes the native path, not in-process', async () => {
    writeFileSync(join(projectRoot, 'a.js'), 'export const A = 1;\n');
    // Explicitly clear any ambient value the runner might carry.
    const r = await runReadSemantic(['a.js', 'A', '--format=json'], {
      SWEET_SEARCH_SEMANTIC_VIA_DAEMON: '',
    });
    expect(isInProcessFallback(r.stdout)).toBe(false);
    expect(isNativeDaemonPath(r.stdout)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// In-process fallback body — disk-exact, daemon-free.
// ---------------------------------------------------------------------------
describe('cli.js read-semantic — in-process fallback body (flag=0)', () => {
  it('emits the handleReadSemanticCli fallback JSON for an existing file', async () => {
    const body = 'export const A = 1;\n';
    writeFileSync(join(projectRoot, 'a.js'), body);
    const r = await runReadSemantic(['a.js', 'how does A work', '--format=json'], {
      SWEET_SEARCH_SEMANTIC_VIA_DAEMON: '0',
    });
    // Un-indexed but the file exists → whole-file fallback: ok=true, exit 0,
    // fellBack/indexed flags as emitted, disk-exact bytes in the single span.
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.file).toBe('a.js');
    expect(parsed.fellBack).toBe(true);
    expect(parsed.indexed).toBe(false);
    expect(parsed.ok).toBe(true);
    expect(parsed.spans).toHaveLength(1);
    expect(parsed.spans[0].text).toBe(body); // disk-exact, incl. trailing newline
  });

  it('emits the ok=false fallback (exit 1) for a missing file', async () => {
    const r = await runReadSemantic(['does-not-exist.js', 'anything', '--format=json'], {
      SWEET_SEARCH_SEMANTIC_VIA_DAEMON: '0',
    });
    expect(r.code).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.fellBack).toBe(true);
    expect(parsed.spans).toHaveLength(0);
  });

  it('does NOT require a daemon: no socket/pidfile is created by the in-process path', async () => {
    writeFileSync(join(projectRoot, 'b.js'), 'const B = 2;\n');
    const r = await runReadSemantic(['b.js', 'B', '--format=json'], {
      SWEET_SEARCH_SEMANTIC_VIA_DAEMON: '0',
    });
    expect(isInProcessFallback(r.stdout)).toBe(true);
    expect(existsSync(socketPath)).toBe(false);
    expect(existsSync(pidFile)).toBe(false);
  });
});

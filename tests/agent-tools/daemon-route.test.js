/**
 * POST /agent-tool (core/agent-tools/daemon-route.js). Any status but 200 means the tool
 * did not run, and the native client runs it in a fresh process instead — so the route
 * must refuse BEFORE the tool starts, never after.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildAgentToolDaemonResponse, validateAgentToolPayload } from '../../core/agent-tools/daemon-route.js';

const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ss-route-')));
const call = (over = {}) => ({ v: 1, tool: 'read', args: ['a.js'], cwd: root, env: { X: '1' }, pid: 4242, ...over });
const deps = (over = {}) => ({ isUnixSocket: true, searcher: { projectRoot: root }, isReady: () => true, ...over });
const body = (r) => JSON.parse(r.body);

describe('/agent-tool', () => {
  it('runs the tool with the caller env, cwd and pid, and returns its output', async () => {
    const r = await buildAgentToolDaemonResponse(call({ args: ['x', 'y'] }), deps({
      runTool: async (sub, args, host) => {
        process.stdout.write(`${sub} ${args.join(',')} X=${process.env.X} cwd=${process.cwd()}\n`);
        process.stderr.write('meta\n');
        expect(host.getSearcher()).toEqual({ projectRoot: root });
        process.exit(1);
      },
    }));
    expect(r.status).toBe(200);
    expect(body(r)).toEqual({ v: 1, code: 1, stdout: `read x,y X=1 cwd=${root}\n`, stderr: 'meta\n' });
  });

  it('refuses TCP and malformed calls without running anything', async () => {
    const runTool = async () => { throw new Error('must not run'); };
    expect((await buildAgentToolDaemonResponse(call(), deps({ isUnixSocket: false, runTool }))).status).toBe(403);
    for (const bad of [null, call({ v: 2 }), call({ tool: 'batch' }), call({ args: 'a' }), call({ args: [1] }),
      call({ cwd: 'rel' }), call({ env: { A: 1 } }), call({ env: [] }), call({ pid: 0 })]) {
      expect((await buildAgentToolDaemonResponse(bad, deps({ runTool }))).status).toBe(400);
    }
    expect(() => validateAgentToolPayload(call())).not.toThrow();
  });

  it('answers 503 for a search tool while loading, after a bounded wait', async () => {
    let waited = 0;
    const r = await buildAgentToolDaemonResponse(call({ tool: 'grep' }), deps({
      isReady: () => false,
      waitForServerReady: async (ms) => { waited++; expect(ms).toBe(60_000); },
      runTool: async () => { throw new Error('must not run'); },
    }));
    expect(r.status).toBe(503);
    expect(waited).toBe(1);
  });

  it('runs ss-read and ss-trace without waiting for the indexes', async () => {
    for (const tool of ['read', 'trace']) {
      const r = await buildAgentToolDaemonResponse(call({ tool }), deps({
        isReady: () => false,
        waitForServerReady: async () => { throw new Error('must not wait'); },
        runTool: async () => { process.stdout.write('ok'); },
      }));
      expect(body(r).stdout).toBe('ok');
    }
  });

  it("answers 409 for another repository's call before the tool records anything", async () => {
    const r = await buildAgentToolDaemonResponse(call(), deps({
      runTool: async (_s, _a, host) => {
        host.assertProjectRoot('/somewhere/else');
        process.stdout.write('recorded');
      },
    }));
    expect(r.status).toBe(409);
    expect(body(r).serverProjectRoot).toBe(root);
    const ok = await buildAgentToolDaemonResponse(call(), deps({
      runTool: async (_s, _a, host) => { host.assertProjectRoot(root); process.stdout.write('mine'); },
    }));
    expect(body(ok).stdout).toBe('mine');
  });

  it('gives each call a private copy of the caller env', async () => {
    const env = { KEEP: 'x' };
    await buildAgentToolDaemonResponse(call({ env }), deps({ runTool: async () => { process.env.KEEP = 'changed'; } }));
    expect(env.KEEP).toBe('x');
  });
});

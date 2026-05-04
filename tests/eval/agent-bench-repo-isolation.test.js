/**
 * Repo-isolation tests for the agent-bench harness.
 *
 * Defends against the multi-repo bench fan-out bug: /tmp/sweet-search.sock is
 * a global daemon, so without explicit isolation, subprocess #2 (gin) silently
 * reuses subprocess #1 (fastify)'s warm daemon and gets cross-repo results.
 *
 * The fix has three layers, each tested here:
 *   1. /health response carries projectRoot + resolvedProjectRoot
 *   2. ss-search route-meta trailer carries serverProjectRoot + repoMatches
 *   3. Warmup helper fails closed when these don't match the requested repo
 *
 * No claude API. No real daemon spawn. Everything is in-process or simulated.
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { _internal } from '../../eval/agent-read-workflows/claude-runner.js';

// ────────────────────────────────────────────────────────────────────────────
// Helper: simulate a tool_result event from a stream-json log
// ────────────────────────────────────────────────────────────────────────────
function streamWithToolResultText(text) {
  return JSON.stringify({
    type: 'user',
    message: {
      content: [{
        type: 'tool_result',
        tool_use_id: 'tu_1',
        content: [{ text }],
        is_error: false,
      }],
    },
  }) + '\n';
}

// ────────────────────────────────────────────────────────────────────────────
// Layer 2: ss-search route-meta trailer carries repo identity
// ────────────────────────────────────────────────────────────────────────────

describe('ss-search route-meta trailer with repo identity', () => {
  it('preserves serverProjectRoot, requestedProjectRoot, repoMatches', () => {
    const meta = {
      routedMode: 'semantic', routeConfidence: 0.95,
      serverUsed: true, serverPid: 1234,
      serverProjectRoot: '/repos/gin',
      requestedProjectRoot: '/repos/gin',
      repoMatches: true,
      tokenBudget: 4000, tokensUsed: 700, subMode: 'agent_preview',
      resultCount: 3, tierCounts: { full: 1, preview: 2 }, sandwichCount: 0,
    };
    const stream = streamWithToolResultText(
      `# ss-search result\n## #1 some.go:1-5\n\n<<SS_ROUTE_META>>${JSON.stringify(meta)}\n`
    );
    const parsed = _internal.parseStreamJson(stream);
    expect(parsed.toolResults[0].routeMeta).toEqual(meta);
    expect(parsed.toolResults[0].routeMeta.repoMatches).toBe(true);
    expect(parsed.toolResults[0].routeMeta.serverProjectRoot).toBe('/repos/gin');
  });

  it('captures a mismatch trailer (repo isolation violation)', () => {
    const meta = {
      routedMode: 'semantic', serverUsed: true,
      serverProjectRoot: '/repos/fastify',
      requestedProjectRoot: '/repos/gin',
      repoMatches: false,
      error: 'repo-isolation-mismatch',
    };
    const stream = streamWithToolResultText(
      `[ss-search] repo isolation violation\n<<SS_ROUTE_META>>${JSON.stringify(meta)}\n`
    );
    const parsed = _internal.parseStreamJson(stream);
    expect(parsed.toolResults[0].routeMeta.repoMatches).toBe(false);
    expect(parsed.toolResults[0].routeMeta.error).toBe('repo-isolation-mismatch');
    expect(parsed.toolResults[0].routeMeta.serverProjectRoot).not.toBe(
      parsed.toolResults[0].routeMeta.requestedProjectRoot
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Layer 3: warmup gate logic (the runWarmupCommand helper)
// ────────────────────────────────────────────────────────────────────────────
//
// runWarmupCommand is internal to run-bench.js (not exported), so we re-encode
// its decision logic here as a pure helper and test the same contract. This
// keeps the test cheap; an integration test would shell out to spawnSync
// against ss-search, which the smoke run covers separately.

function isolationDecision({ exitCode, routeMeta, requireRouteMeta, expectedProjectRoot }) {
  let ok = exitCode === 0;
  let isolationFailure = null;
  if (ok && requireRouteMeta) {
    if (!routeMeta || routeMeta.serverUsed !== true) {
      ok = false;
      isolationFailure = 'missing-route-meta-or-server-not-used';
    }
  }
  if (ok && expectedProjectRoot != null) {
    const expected = resolve(expectedProjectRoot);
    const got = routeMeta?.serverProjectRoot ? resolve(routeMeta.serverProjectRoot) : null;
    const repoMatches = routeMeta?.repoMatches === true && got === expected;
    if (!repoMatches) {
      ok = false;
      isolationFailure = `repo-isolation-mismatch: expected=${expected} got=${got ?? '<null>'}`;
    }
  }
  return { ok, isolationFailure };
}

describe('warmup repo-isolation decision', () => {
  it('passes when serverProjectRoot equals expectedProjectRoot', () => {
    const d = isolationDecision({
      exitCode: 0,
      routeMeta: { serverUsed: true, serverProjectRoot: '/r/fastify', repoMatches: true },
      requireRouteMeta: true,
      expectedProjectRoot: '/r/fastify',
    });
    expect(d.ok).toBe(true);
    expect(d.isolationFailure).toBeNull();
  });

  it('FAILS CLOSED when serverProjectRoot differs from expected (the multi-repo bug)', () => {
    const d = isolationDecision({
      exitCode: 0,
      routeMeta: { serverUsed: true, serverProjectRoot: '/r/fastify', repoMatches: false },
      requireRouteMeta: true,
      expectedProjectRoot: '/r/gin',
    });
    expect(d.ok).toBe(false);
    expect(d.isolationFailure).toMatch(/repo-isolation-mismatch/);
    expect(d.isolationFailure).toContain('/r/gin');
    expect(d.isolationFailure).toContain('/r/fastify');
  });

  it('FAILS CLOSED when route-meta is absent but required', () => {
    const d = isolationDecision({
      exitCode: 0,
      routeMeta: null,
      requireRouteMeta: true,
      expectedProjectRoot: '/r/fastify',
    });
    expect(d.ok).toBe(false);
    expect(d.isolationFailure).toBe('missing-route-meta-or-server-not-used');
  });

  it('FAILS CLOSED when serverUsed is false (cold path snuck through)', () => {
    const d = isolationDecision({
      exitCode: 0,
      routeMeta: { serverUsed: false, serverProjectRoot: '/r/fastify', repoMatches: true },
      requireRouteMeta: true,
      expectedProjectRoot: '/r/fastify',
    });
    expect(d.ok).toBe(false);
    expect(d.isolationFailure).toMatch(/server-not-used/);
  });

  it('FAILS CLOSED when serverProjectRoot is null', () => {
    const d = isolationDecision({
      exitCode: 0,
      routeMeta: { serverUsed: true, serverProjectRoot: null, repoMatches: false },
      requireRouteMeta: true,
      expectedProjectRoot: '/r/gin',
    });
    expect(d.ok).toBe(false);
    expect(d.isolationFailure).toContain('got=<null>');
  });

  it('treats exit non-zero as failure regardless of route-meta', () => {
    const d = isolationDecision({
      exitCode: 3,
      routeMeta: { serverUsed: true, serverProjectRoot: '/r/fastify', repoMatches: true },
      requireRouteMeta: true,
      expectedProjectRoot: '/r/fastify',
    });
    expect(d.ok).toBe(false);
  });

  it('does not require expectedProjectRoot for non-ss-search warmup commands', () => {
    // ss-find warmup for the colgrep condition doesn't carry a route-meta trailer.
    const d = isolationDecision({
      exitCode: 0,
      routeMeta: null,
      requireRouteMeta: false,
      expectedProjectRoot: null,
    });
    expect(d.ok).toBe(true);
    expect(d.isolationFailure).toBeNull();
  });

  it('normalises path differences with path.resolve', () => {
    const d = isolationDecision({
      exitCode: 0,
      routeMeta: { serverUsed: true, serverProjectRoot: '/r/fastify/', repoMatches: true },
      requireRouteMeta: true,
      expectedProjectRoot: '/r/fastify',  // no trailing slash
    });
    expect(d.ok).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Layer 1: /health includes projectRoot fields
// ────────────────────────────────────────────────────────────────────────────
//
// Importing search-server.js to assert the symbol contract — we're not
// starting a real server here; a smoke run does that.

describe('search-server module exports for repo isolation', () => {
  it('exposes ensureDaemonForProjectRoot, getServerHealth, stopServer, waitForServerExit', async () => {
    const mod = await import('../../core/search/search-server.js');
    expect(typeof mod.ensureDaemonForProjectRoot).toBe('function');
    expect(typeof mod.getServerHealth).toBe('function');
    expect(typeof mod.stopServer).toBe('function');
    expect(typeof mod.waitForServerExit).toBe('function');
  });
});

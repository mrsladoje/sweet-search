// Guard + repo-isolation unit tests for the /trace and /read daemon handlers.
// The happy path (byte-identical output vs the in-process CLI) is covered
// end-to-end against the fresh m2crb index; these lock the cheap guards that
// keep the daemon endpoints unix-socket-only and repo-isolated, mirroring the
// /read-semantic contract.
import { describe, it, expect } from 'vitest';
import { realpathSync } from 'node:fs';
import {
  buildAgentSpanDaemonResponse,
  buildReadSemanticDaemonResponse,
  buildTraceDaemonResponse,
  buildReadDaemonResponse,
} from '../../core/search/search-server.js';
import {
  AgentSpanLedger,
  hashShownLines,
  hashShownText,
} from '../../core/search/agent-span-ledger.js';

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

  it('omits only an agent-formatted exact reread and force restores the body', async () => {
    const ledger = new AgentSpanLedger();
    const params = new URLSearchParams({
      path: 'package.json',
      projectRoot: root,
      format: 'agent',
      metadata: 'false',
      startLine: '1',
      endLine: '2',
      exactRereadOmission: 'true',
      agentSessionId: 'daemon-read-session',
    });
    const opts = {
      isUnixSocket: true,
      serverReady: true,
      searcher: { projectRoot: root },
      agentSpanLedger: ledger,
    };

    const first = await buildReadDaemonResponse(`/read?${params}`, opts);
    expect(first.body).toContain('"name": "sweet-search"');
    const second = await buildReadDaemonResponse(`/read?${params}`, opts);
    expect(second.body).not.toContain('"name": "sweet-search"');
    expect(second.body).toContain('unchanged reread omitted');

    params.set('force', 'true');
    const forced = await buildReadDaemonResponse(`/read?${params}`, opts);
    expect(forced.body).toContain('"name": "sweet-search"');
  });

  it.each(['json', 'raw'])('never touches receipts for %s output', async (format) => {
    const ledger = new AgentSpanLedger();
    const params = new URLSearchParams({
      path: 'package.json',
      projectRoot: root,
      format,
      metadata: 'false',
      startLine: '1',
      endLine: '2',
      exactRereadOmission: 'true',
      agentSessionId: 'non-agent-session',
    });
    const opts = {
      isUnixSocket: true,
      serverReady: true,
      searcher: { projectRoot: root },
      agentSpanLedger: ledger,
    };

    await buildReadDaemonResponse(`/read?${params}`, opts);
    await buildReadDaemonResponse(`/read?${params}`, opts);
    expect(ledger.stats()).toEqual({ sessions: 0, receipts: 0 });
  });

  it.each([null, 'false'])('requires an explicitly enabled daemon parameter (%s)', async (flag) => {
    const ledger = new AgentSpanLedger();
    const params = new URLSearchParams({
      path: 'package.json',
      projectRoot: root,
      format: 'agent',
      metadata: 'false',
      startLine: '1',
      endLine: '2',
      agentSessionId: 'disabled-session',
    });
    if (flag != null) params.set('exactRereadOmission', flag);
    const opts = {
      isUnixSocket: true,
      serverReady: true,
      searcher: { projectRoot: root },
      agentSpanLedger: ledger,
    };

    const first = await buildReadDaemonResponse(`/read?${params}`, opts);
    const second = await buildReadDaemonResponse(`/read?${params}`, opts);
    expect(first.body).toContain('"name": "sweet-search"');
    expect(second.body).toContain('"name": "sweet-search"');
    expect(ledger.stats()).toEqual({ sessions: 0, receipts: 0 });
  });
});

describe('buildReadSemanticDaemonResponse receipts', () => {
  it('ages once and records complete agent-formatted semantic spans', async () => {
    const ledger = new AgentSpanLedger();
    const params = new URLSearchParams({
      path: 'src/a.js',
      q: 'middle line',
      projectRoot: root,
      format: 'agent',
      exactRereadOmission: 'true',
      agentSessionId: 'semantic-session',
    });
    const result = {
      ok: true,
      file: 'src/a.js',
      spans: [{ startLine: 10, endLine: 12, text: 'a\nb\nc' }],
    };
    const response = await buildReadSemanticDaemonResponse(`/read-semantic?${params}`, {
      isUnixSocket: true,
      serverReady: true,
      searcher: { projectRoot: root },
      readSemanticFn: async () => result,
      formatReadSemanticResultFn: () => 'semantic body',
      agentSpanLedger: ledger,
    });
    expect(response.status).toBe(200);

    const containedText = 'b';
    const read = buildAgentSpanDaemonResponse({
      operation: 'read',
      sessionId: 'semantic-session',
      spans: [{
        file: 'src/a.js',
        startLine: 11,
        endLine: 11,
        hash: hashShownText(containedText),
        lineHashes: hashShownLines(containedText),
      }],
    }, { isUnixSocket: true, ledger });
    expect(JSON.parse(read.body)).toMatchObject({
      call: 2,
      decisions: [{ omit: true, callsAgo: 1 }],
    });
  });
});

describe('buildAgentSpanDaemonResponse', () => {
  const receipt = {
    file: 'src/a.js', startLine: 1, endLine: 2, hash: hashShownText('a\nb'),
  };

  it('is unix-socket-only and rejects structurally invalid receipt batches', () => {
    const ledger = new AgentSpanLedger();
    expect(buildAgentSpanDaemonResponse({}, { isUnixSocket: false, ledger }).status).toBe(403);
    expect(buildAgentSpanDaemonResponse({
      operation: 'observe', sessionId: 's', spans: null,
    }, { isUnixSocket: true, ledger }).status).toBe(400);
    expect(buildAgentSpanDaemonResponse({
      operation: 'observe', sessionId: 's', spans: Array.from({ length: 21 }, () => receipt),
    }, { isUnixSocket: true, ledger }).status).toBe(400);
  });

  it('ticks once and preserves decision alignment for mixed valid and invalid spans', () => {
    const ledger = new AgentSpanLedger();
    const invalid = { ...receipt, hash: 'bad' };
    const observe = buildAgentSpanDaemonResponse({
      operation: 'observe', sessionId: 'mixed', spans: [invalid, receipt],
    }, { isUnixSocket: true, ledger });
    expect(observe.status).toBe(200);
    expect(JSON.parse(observe.body).call).toBe(1);

    const read = buildAgentSpanDaemonResponse({
      operation: 'read', sessionId: 'mixed', spans: [invalid, receipt],
    }, { isUnixSocket: true, ledger });
    const body = JSON.parse(read.body);
    expect(body.call).toBe(2);
    expect(body.decisions).toHaveLength(2);
    expect(body.decisions[0]).toEqual({ omit: false });
    expect(body.decisions[1]).toMatchObject({ omit: true, callsAgo: 1 });
  });

  it('observes, matches, and resets a session without persistent state', () => {
    const ledger = new AgentSpanLedger();
    const observe = buildAgentSpanDaemonResponse({
      operation: 'observe', sessionId: 's', spans: [receipt],
    }, { isUnixSocket: true, ledger });
    expect(observe.status).toBe(200);

    const read = buildAgentSpanDaemonResponse({
      operation: 'read', sessionId: 's', spans: [receipt],
    }, { isUnixSocket: true, ledger });
    expect(JSON.parse(read.body).decisions[0]).toMatchObject({ omit: true, callsAgo: 1 });

    expect(buildAgentSpanDaemonResponse({
      operation: 'reset', sessionId: 's', spans: [],
    }, { isUnixSocket: true, ledger }).status).toBe(200);
    expect(ledger.stats()).toEqual({ sessions: 0, receipts: 0 });
  });
});

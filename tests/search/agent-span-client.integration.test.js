import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AgentSpanLedger,
  hashShownLines,
  hashShownText,
} from '../../core/search/agent-span-ledger.js';
import { sendAgentSpanOperation } from '../../core/search/agent-span-client.js';
import { buildAgentSpanDaemonResponse } from '../../core/search/search-server.js';

let root;
let socketPath;
let server;
let ledger;
let previousSocket;

function startLedgerServer(ledger) {
  return new Promise((resolve) => {
    const httpServer = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const response = buildAgentSpanDaemonResponse(JSON.parse(body), {
          isUnixSocket: true,
          ledger,
        });
        res.writeHead(response.status, { 'content-type': response.contentType });
        res.end(response.body);
      });
    });
    httpServer.listen(socketPath, () => resolve(httpServer));
  });
}

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'ss-agent-span-client-'));
  socketPath = path.join(root, 'daemon.sock');
  previousSocket = process.env.SWEET_SEARCH_SOCKET_PATH;
  process.env.SWEET_SEARCH_SOCKET_PATH = socketPath;
  ledger = new AgentSpanLedger();
  server = await startLedgerServer(ledger);
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (previousSocket == null) delete process.env.SWEET_SEARCH_SOCKET_PATH;
  else process.env.SWEET_SEARCH_SOCKET_PATH = previousSocket;
  rmSync(root, { recursive: true, force: true });
});

describe('agent-span Unix-socket client', () => {
  it('round-trips exact receipts', async () => {
    const receipt = { file: 'a.js', startLine: 1, endLine: 1, hash: hashShownText('a') };
    expect(await sendAgentSpanOperation({ operation: 'observe', sessionId: 's', spans: [receipt] })).toMatchObject({ ok: true });
    const read = await sendAgentSpanOperation({ operation: 'read', sessionId: 's', spans: [receipt] });
    expect(read.decisions[0]).toMatchObject({ omit: true, callsAgo: 1 });
  });

  it('drops only enough line evidence to fit the bounded request', async () => {
    const receipts = Array.from({ length: 7 }, (_, index) => {
      const text = Array.from({ length: 256 }, (__, line) => `file-${index}-line-${line + 1}`).join('\n');
      return {
        file: `src/f${index}.js`,
        startLine: 1,
        endLine: 256,
        hash: hashShownText(text),
        lineHashes: hashShownLines(text),
      };
    });
    const observed = await sendAgentSpanOperation({
      operation: 'observe', sessionId: 'large', spans: receipts,
    });
    expect(observed).toMatchObject({ ok: true, call: 1 });
    expect(receipts[0].lineHashes).toBeTruthy();

    const containedText = (fileIndex) => Array.from(
      { length: 10 },
      (_, offset) => `file-${fileIndex}-line-${offset + 11}`,
    ).join('\n');
    const read = await sendAgentSpanOperation({
      operation: 'read',
      sessionId: 'large',
      spans: [
        {
          file: 'src/f0.js', startLine: 11, endLine: 20,
          hash: hashShownText(containedText(0)), lineHashes: hashShownLines(containedText(0)),
        },
        {
          file: 'src/f6.js', startLine: 11, endLine: 20,
          hash: hashShownText(containedText(6)), lineHashes: hashShownLines(containedText(6)),
        },
        receipts[0],
      ],
    });

    expect(read.decisions[0].omit).toBe(false);
    expect(read.decisions[1]).toMatchObject({ omit: true, callsAgo: 1 });
    expect(read.decisions[2]).toMatchObject({ omit: true, callsAgo: 1 });
  });

  it('fails open before sending when even exact-only receipts exceed 64 KiB', async () => {
    const spans = Array.from({ length: 20 }, (_, index) => ({
      file: `${index}-${'x'.repeat(4090)}`,
      startLine: 1,
      endLine: 1,
      hash: hashShownText(String(index)),
    }));
    expect(await sendAgentSpanOperation({
      operation: 'observe', sessionId: 'too-large', spans,
    })).toBeNull();
    expect(ledger.stats()).toEqual({ sessions: 0, receipts: 0 });
  });
});

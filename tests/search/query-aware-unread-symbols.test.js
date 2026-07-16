import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  __resetReadCachesForTests,
  formatReadResults,
  readFile,
  renderUnreadBelow,
} from '../../core/search/search-read.js';
import { AgentSpanLedger } from '../../core/search/agent-span-ledger.js';
import { buildReadDaemonResponse } from '../../core/search/search-server.js';

let projectRoot;

beforeEach(() => {
  __resetReadCachesForTests();
  projectRoot = mkdtempSync(path.join(tmpdir(), 'ss-query-unread-'));
});

afterEach(() => {
  __resetReadCachesForTests();
  rmSync(projectRoot, { recursive: true, force: true });
});

function writeScalametaShapedFixture() {
  const file = 'src/ScannerTokens.scala';
  const absolute = path.join(projectRoot, file);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(
    absolute,
    Array.from({ length: 100 }, (_, index) => `// source line ${index + 1}`).join('\n') + '\n',
  );

  const stateDir = path.join(projectRoot, '.sweet-search');
  mkdirSync(stateDir, { recursive: true });
  const db = new Database(path.join(stateDir, 'codebase.db'));
  try {
    db.exec('CREATE TABLE vectors (id TEXT PRIMARY KEY, file_path TEXT, text TEXT, metadata TEXT)');
    const insert = db.prepare(
      'INSERT INTO vectors (id, file_path, text, metadata) VALUES (?, ?, ?, ?)',
    );
    for (let index = 0; index < 63; index++) {
      const symbol = index === 0
        ? 'countIndentAndNewlineIndex'
        : index === 58 ? 'isLeadingInfixArg' : `scannerHelper${index}`;
      insert.run(`symbol-${index}`, file, `// ${symbol}`, JSON.stringify({
        language: 'scala',
        symbol,
        chunk_type: 'method',
        line_start: 20 + index,
        line_end: 20 + index,
      }));
    }
  } finally {
    db.close();
  }
  return file;
}

const QUERY_EVIDENCE = {
  anchors: ['isLeadingInfixArg'],
  subtokens: ['leading', 'infix'],
};

describe('query-aware unread-symbol trailer', () => {
  it('uses one of the existing five slots for a query-matching late symbol', async () => {
    const file = writeScalametaShapedFixture();
    const result = await readFile({
      path: file,
      startLine: 1,
      endLine: 10,
      projectRoot,
    });

    const baseline = renderUnreadBelow(result);
    expect(baseline).toContain('countIndentAndNewlineIndex');
    expect(baseline).toContain('+58 more');
    expect(baseline).not.toContain('isLeadingInfixArg');

    const ranked = renderUnreadBelow(result, { queryEvidence: QUERY_EVIDENCE });
    expect(ranked).toContain(': isLeadingInfixArg, countIndentAndNewlineIndex');
    expect(ranked).toContain('+58 more');
    expect(renderUnreadBelow(result)).toBe(baseline);
    expect(result.unreadBelow.symbols).toHaveLength(5);
    expect(result.unreadBelow.symbols.map(({ symbol }) => symbol)).not.toContain('isLeadingInfixArg');
  });

  it('preserves positional output without relevant evidence and for non-agent formats', async () => {
    const file = writeScalametaShapedFixture();
    const result = await readFile({
      path: file,
      startLine: 1,
      endLine: 10,
      projectRoot,
    });
    const baseline = renderUnreadBelow(result);

    const json = JSON.parse(formatReadResults(
      { files: [result], totalMs: 1 },
      'json',
      { queryEvidence: QUERY_EVIDENCE },
    ));
    expect(json.files[0].unreadBelow.symbols[0].symbol).toBe('countIndentAndNewlineIndex');
    expect(json.files[0].unreadBelow.symbols.some(
      ({ symbol }) => symbol === 'isLeadingInfixArg',
    )).toBe(false);

    expect(renderUnreadBelow(result, {
      queryEvidence: { anchors: ['unrelatedIdentifier'], subtokens: ['unrelated'] },
    })).toBe(baseline);
  });

  it('applies the session evidence only on the agent daemon read path', async () => {
    const file = writeScalametaShapedFixture();
    const ledger = new AgentSpanLedger();
    const rememberedAt = ledger.beginCall('scalameta-session');
    ledger.rememberQueryAtCall(
      'scalameta-session',
      rememberedAt,
      'isLeadingInfixArg double newline handling',
    );
    const baseParams = new URLSearchParams({
      path: file,
      projectRoot,
      metadata: 'true',
      startLine: '1',
      endLine: '10',
      exactRereadOmission: 'true',
      agentSessionId: 'scalameta-session',
    });
    const options = {
      isUnixSocket: true,
      serverReady: true,
      searcher: { projectRoot },
      agentSpanLedger: ledger,
    };

    baseParams.set('format', 'agent');
    const agent = await buildReadDaemonResponse(`/read?${baseParams}`, options);
    expect(agent.status).toBe(200);
    expect(agent.body).toContain('isLeadingInfixArg');
    expect(agent.body).toContain('+58 more');

    baseParams.set('format', 'json');
    const json = await buildReadDaemonResponse(`/read?${baseParams}`, options);
    const parsed = JSON.parse(json.body);
    expect(parsed.files[0].unreadBelow.symbols[0].symbol).toBe('countIndentAndNewlineIndex');
    expect(parsed.files[0].unreadBelow.symbols.some(
      ({ symbol }) => symbol === 'isLeadingInfixArg',
    )).toBe(false);
  });
});

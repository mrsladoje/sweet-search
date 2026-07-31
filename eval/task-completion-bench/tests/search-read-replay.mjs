#!/usr/bin/env node
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  cacheKey,
  classifyCurrentElimination,
  extractHistoricalReadPayloads,
  extractSearchReadCandidates,
  formatExecutionError,
  parseReplayArgs,
  parseSafeSearchOperations,
  selectHistoricalSessions,
} from '../stats/search-read-replay.mjs';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
}

function fixtureDb() {
  const db = new Database(':memory:');
  db.exec(`
    create table session(id text, directory text, time_created integer);
    create table message(id text, session_id text, time_created integer, data text);
    create table part(id text, message_id text, data text);
  `);
  db.prepare('insert into session values (?,?,?)').run(
    's-short', '/root/.ss-eval/runs/acme__repo-1__sweet__r0__1', 1_785_100_000_000,
  );
  db.prepare('insert into session values (?,?,?)').run(
    's-long', '/root/.ss-eval/runs/acme__repo-1__sweet__r0__2', 1_785_100_000_001,
  );
  const insertMessage = (id, session, created, role = 'assistant') => {
    db.prepare('insert into message values (?,?,?,?)').run(id, session, created, JSON.stringify({ role }));
  };
  insertMessage('short-1', 's-short', 1);
  insertMessage('lead', 's-long', 1);
  insertMessage('read', 's-long', 2);
  const insertPart = (id, message, tool, command, output) => {
    db.prepare('insert into part values (?,?,?)').run(id, message, JSON.stringify({
      type: 'tool', tool, state: { input: { command }, output },
    }));
  };
  insertPart('p1', 'lead', 'bash', 'ss-grep "needle" -k 20', 'src/a.js:1: needle');
  insertPart(
    'p2', 'read', 'bash',
    'ss-read src/a.js 1 2 && ss-read src/missing.js 1 2',
    '# ss-read src/a.js (lines 1-2)\n```js\nconst a = 1;\nconst b = 2;\n```\n' +
      '# ss-read src/missing.js (lines 1-2)\n```js\nconst c = 3;\nconst d = 4;\n```\n',
  );
  return db;
}

test('selects the duplicate session with the most assistant messages', () => {
  const db = fixtureDb();
  const selected = selectHistoricalSessions(db, ['acme__repo-1']);
  assert.equal(selected.get('acme__repo-1').sessionId, 's-long');
  db.close();
});

test('reproduces the historical first-read-only loose admission rule', () => {
  const db = fixtureDb();
  const selected = selectHistoricalSessions(db, ['acme__repo-1']);
  const candidates = extractSearchReadCandidates(db, selected);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].targets, ['a.js']);
  db.close();
});

test('safe operation parser ignores non-ss segments and shell pipelines', () => {
  const parsed = parseSafeSearchOperations([
    'ss-grep "a b" -k 20 | head -5; rm -rf /; ss-find "why" --regex "x"',
  ]);
  assert.deepEqual(parsed.operations, [
    { command: 'ss-grep', args: ['a b', '-k', '20'] },
    { command: 'ss-find', args: ['why', '--regex', 'x'] },
  ]);
});

test('extracts every historical read payload in a fused read envelope', () => {
  const db = fixtureDb();
  const candidate = extractSearchReadCandidates(
    db, selectHistoricalSessions(db, ['acme__repo-1']),
  )[0];
  assert.equal(extractHistoricalReadPayloads(candidate.reads).length, 2);
  db.close();
});

test('requires every actual read payload for an eliminated verdict', () => {
  const db = fixtureDb();
  const candidate = extractSearchReadCandidates(
    db, selectHistoricalSessions(db, ['acme__repo-1']),
  )[0];
  assert.equal(classifyCurrentElimination(candidate, 'const a = 1;\nconst b = 2;').verdict, 'partial');
  assert.equal(classifyCurrentElimination(
    candidate,
    'const a = 1;\nconst b = 2;\n...\nconst c = 3;\nconst d = 4;',
  ).verdict, 'eliminated');
  assert.equal(classifyCurrentElimination(candidate, '', ['timeout']).verdict, 'uncertain');
  db.close();
});

test('golden cache keys reject path traversal at the task-file boundary', () => {
  assert.equal(
    cacheKey({ repo: 'acme/repo.js', base_commit: '0123456789abcdef' }),
    'acme__repo.js@0123456789abcdef',
  );
  assert.throws(
    () => cacheKey({ repo: '../../etc/passwd', base_commit: '0123456789abcdef' }),
    /unsafe or invalid task repo/,
  );
  assert.throws(
    () => cacheKey({ repo: 'acme/repo', base_commit: '../escape' }),
    /unsafe or invalid base commit/,
  );
});

test('CLI boundary rejects unknown and valueless options', () => {
  assert.throws(() => parseReplayArgs(['--wat']), /unknown option/);
  assert.throws(() => parseReplayArgs(['--db', '--tasks', 'tasks.jsonl']), /missing value/);
});

test('execution errors retain status and the diagnostic tail', () => {
  const formatted = formatExecutionError(
    { command: 'ss-grep' },
    { status: 1, signal: null, stderr: `${'warmup '.repeat(100)}fatal-tail` },
  );
  assert.match(formatted, /status=1 signal=none/);
  assert.match(formatted, /fatal-tail$/);
  assert.ok(formatted.length < 550);
});

console.log(`1..${passed}`);

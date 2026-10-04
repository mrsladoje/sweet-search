// Regression tests for opencode subagent (child-session) cost accounting (2026-10-04).
//
// THE DEFECT: the opencode row ledger was built from `opencode run --format json`, which streams
// only the MAIN session. A `task` subagent (explore / general) runs in a CHILD session
// (session.parent_id = caller), so its requests, tokens, cost and tool calls never reached the row.
// Final run: native composer-07's explore child alone was $0.148, 2.3x the main session.
//
// THE FIX: read the child sessions back from opencode's session DB and price main + children with
// one function (opencodeRowCosts → costsFromTurns per context → addSidechainCostsChecked), the
// sidechain-inclusive definition Claude Code rows already use. Main-only numbers stay on the row.
//
// Standalone: `node eval/task-completion-bench/tests/opencode-subagent-cost.mjs` — exit 1 on fail.
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseOpencodeStream, opencodeChildSessionSets, readOpencodeChildSessions, opencodeRowCosts,
} from '../harness/opencode-task-runner.mjs';
import { costsFromTurns, priceFor } from '../harness/agent-runner-shared.mjs';

let ok = true;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` ${detail}`}`);
  if (!cond) ok = false;
};
const near = (a, b) => a != null && b != null && Math.abs(a - b) < 1e-6;
const PRICE = priceFor('openai/gpt-6.1-sol'); // { in: 2, cache: 0.1, out: 10 } $/M
// OpenAI charges no cache write: realized = uncached input + cached input + output (incl. reasoning).
const realized = (ts) => ts.reduce((a, t) => a + ((t.in - t.cached) * PRICE.in + t.cached * PRICE.cache + t.out * PRICE.out) / 1e6, 0);
const naive = (ts) => ts.reduce((a, t) => a + (t.in * PRICE.in + t.out * PRICE.out) / 1e6, 0);

const sf = (input, read, output, reasoning = 0) => ({ type: 'step-finish', reason: 'tool-calls', tokens: { input, output, reasoning, cache: { read, write: 0 } }, cost: 0 });
const tool = (name, input) => ({ type: 'tool', tool: name, callID: `c-${Math.random()}`, state: { status: 'completed', input, output: 'x' } });

// ── fixture: one rollout (MAIN) that delegates to explore (CHILD), which delegates again
// (GRANDCHILD), plus a concurrent rollout (OTHER) of the same arm with its own child. ──
const MAIN = 'ses_main', CHILD = 'ses_child', GRAND = 'ses_grand', OTHER = 'ses_other', OTHER_KID = 'ses_other_kid';
const sessions = [
  { id: MAIN, parent_id: null, agent: 'build', title: 'q', time_created: 100 },
  { id: CHILD, parent_id: MAIN, agent: 'explore', title: 'trace (@explore subagent)', time_created: 110 },
  { id: GRAND, parent_id: CHILD, agent: 'general', title: 'deeper (@general subagent)', time_created: 120 },
  { id: OTHER, parent_id: null, agent: 'build', title: 'other', time_created: 105 },
  { id: OTHER_KID, parent_id: OTHER, agent: 'explore', title: 'other kid', time_created: 115 },
];
const parts = [
  // main session: 2 requests, the first calls task
  { session_id: MAIN, data: tool('task', { subagent_type: 'explore', prompt: 'find it' }) },
  { session_id: MAIN, data: sf(5000, 0, 100, 50) },
  { session_id: MAIN, data: sf(1000, 5000, 400) },
  // child: 3 requests, 4 tool calls (glob, read, grep, task)
  { session_id: CHILD, data: tool('glob', { pattern: 'src/**/*.php' }) },
  { session_id: CHILD, data: sf(2600, 0, 115) },
  { session_id: CHILD, data: tool('read', { filePath: 'src/A.php' }) },
  { session_id: CHILD, data: tool('grep', { pattern: 'cleanup' }) },
  { session_id: CHILD, data: sf(3000, 2600, 200, 30) },
  { session_id: CHILD, data: tool('task', { subagent_type: 'general' }) },
  { session_id: CHILD, data: sf(500, 5600, 300) },
  // grandchild: 1 request, 1 tool call
  { session_id: GRAND, data: tool('read', { filePath: 'src/B.php' }) },
  { session_id: GRAND, data: sf(4000, 0, 80) },
  // the other rollout's child must never be charged to MAIN
  { session_id: OTHER_KID, data: sf(99999, 0, 9999) },
  { session_id: OTHER_KID, data: tool('read', { filePath: 'x' }) },
];
const messages = [
  ...[1, 2].map(() => ({ session_id: MAIN, role: 'assistant' })),
  { session_id: CHILD, role: 'user' }, ...[1, 2, 3].map(() => ({ session_id: CHILD, role: 'assistant' })),
  { session_id: GRAND, role: 'user' }, { session_id: GRAND, role: 'assistant' },
  { session_id: OTHER_KID, role: 'assistant' },
];
const T = (input, read, output, reasoning = 0) => ({ in: input + read, cached: read, cacheWrite: 0, out: output + reasoning });
const mainTurns = [T(5000, 0, 100, 50), T(1000, 5000, 400)];
const childTurns = [T(2600, 0, 115), T(3000, 2600, 200, 30), T(500, 5600, 300)];
const grandTurns = [T(4000, 0, 80)];

// 1. the stream parser sees the main session only (the defect's surface)
const stream = [
  { type: 'step_start', sessionID: MAIN, part: { type: 'step-start' } },
  { type: 'tool_use', sessionID: MAIN, part: { ...tool('task', { subagent_type: 'explore' }), callID: 'c1', sessionID: MAIN } },
  { type: 'step_finish', sessionID: MAIN, part: sf(5000, 0, 100, 50) },
  { type: 'step_finish', sessionID: MAIN, part: sf(1000, 5000, 400) },
  { type: 'text', sessionID: MAIN, part: { type: 'text', text: 'answer' } },
].map(e => JSON.stringify(e)).join('\n');
const p = parseOpencodeStream(stream);
check('stream: session id is the main session', p.sessionID === MAIN, p.sessionID);
check('stream: turns = main requests only', JSON.stringify(p.turns) === JSON.stringify(mainTurns), JSON.stringify(p.turns));

// 2. pure set builder: descendants only, depth-first, with turns / calls / completeness
const sets = opencodeChildSessionSets({ sessions, messages, parts }, MAIN);
check('sets: child and grandchild, not the other rollout\'s child', JSON.stringify(sets.map(s => s.name)) === JSON.stringify([CHILD, GRAND]), JSON.stringify(sets.map(s => s.name)));
check('sets: child turns', JSON.stringify(sets[0].turns) === JSON.stringify(childTurns), JSON.stringify(sets[0].turns));
check('sets: child tool calls and kinds', sets[0].toolCalls === 4 && sets[0].toolKinds.nativeGrep === 2 && sets[0].toolKinds.nativeRead === 1, JSON.stringify(sets[0]));
check('sets: grandchild depth 2', sets[1].depth === 2 && sets[1].agent === 'general');
check('sets: complete when every assistant message has a step-finish', sets.every(s => s.instrumentationComplete));
check('sets: no main session → none', opencodeChildSessionSets({ sessions, messages, parts }, null).length === 0);

// 3. the DB reader returns the same sets from a real opencode-shaped SQLite file
const dir = mkdtempSync(join(tmpdir(), 'oc-subagent-cost-'));
try {
  const Database = createRequire(import.meta.url)('better-sqlite3');
  const dbPath = join(dir, 'opencode.db');
  const db = new Database(dbPath);
  db.exec(`create table session (id text primary key, project_id text not null default 'p', parent_id text, slug text not null default '', directory text not null default '/r', title text not null, version text not null default '1.18.4', agent text, time_created integer not null, time_updated integer not null default 0);
           create table message (id text primary key, session_id text not null, time_created integer not null, time_updated integer not null default 0, data text not null);
           create table part (id text primary key, message_id text not null, session_id text not null, time_created integer not null, time_updated integer not null default 0, data text not null);`);
  const insS = db.prepare('insert into session (id, parent_id, title, agent, time_created) values (?, ?, ?, ?, ?)');
  for (const s of sessions) insS.run(s.id, s.parent_id, s.title, s.agent, s.time_created);
  messages.forEach((m, i) => db.prepare('insert into message (id, session_id, time_created, data) values (?, ?, ?, ?)').run(`msg_${i}`, m.session_id, i, JSON.stringify({ role: m.role })));
  parts.forEach((q, i) => db.prepare('insert into part (id, message_id, session_id, time_created, data) values (?, ?, ?, ?, ?)').run(`prt_${String(i).padStart(3, '0')}`, 'm', q.session_id, 1000 + i, JSON.stringify(q.data)));
  db.close();
  const fromDb = readOpencodeChildSessions(dbPath, MAIN);
  check('db: same sets as the pure builder', JSON.stringify(fromDb.map(({ name, turns, toolCalls, depth }) => ({ name, turns, toolCalls, depth })))
    === JSON.stringify(sets.map(({ name, turns, toolCalls, depth }) => ({ name, turns, toolCalls, depth }))));
  check('db: unknown main session → no children', readOpencodeChildSessions(dbPath, 'ses_none').length === 0);
  let threw = false; try { readOpencodeChildSessions(join(dir, 'missing.db'), MAIN); } catch { threw = true; }
  check('db: missing DB throws (caller fails closed)', threw);
} finally { rmSync(dir, { recursive: true, force: true }); }

// 4. row costs: main + every child under ONE definition; main-only kept beside it
const { costs, fields } = opencodeRowCosts({ mainTurns, childSets: sets, price: PRICE });
const all = [...mainTurns, ...childTurns, ...grandTurns];
check('row: billed = main + child + grandchild', near(fields.costRealizedUsd, realized(all)), `${fields.costRealizedUsd} vs ${realized(all)}`);
check('row: no-cache = main + child + grandchild', near(fields.costNaiveUsd, naive(all)), `${fields.costNaiveUsd} vs ${naive(all)}`);
check('row: main-only billed = the old ledger', near(fields.costRealizedMainOnlyUsd, costsFromTurns(mainTurns, PRICE).costRealizedUsd) && near(fields.costRealizedMainOnlyUsd, realized(mainTurns)));
check('row: main-only no-cache', near(fields.costNaiveMainOnlyUsd, naive(mainTurns)));
check('row: sidechain spend', near(fields.costSidechainUsd, realized([...childTurns, ...grandTurns])));
check('row: usage inclusive', fields.usage.turns === 6 && fields.usage.in === all.reduce((a, t) => a + t.in, 0) && fields.usage.out === all.reduce((a, t) => a + t.out, 0), JSON.stringify(fields.usage));
check('row: usage main-only', fields.usageMainOnly.turns === 2 && fields.usageMainOnly.in === 11000, JSON.stringify(fields.usageMainOnly));
check('row: subagent calls / turns / contexts', fields.subagentCalls === 5 && fields.subagentTurns === 4 && fields.subagentContexts === 2, JSON.stringify(fields));
check('row: complete', fields.costAccountingComplete === true && near(fields.costRealizedLowerBoundUsd, fields.costRealizedUsd));
check('row: ledger columns inclusive', near(costs.costRealizedFlat125Usd, realized(all)));

// 5. no children → identical to the old main-only ledger
const none = opencodeRowCosts({ mainTurns, childSets: [], price: PRICE }).fields;
check('no child: billed unchanged', near(none.costRealizedUsd, costsFromTurns(mainTurns, PRICE).costRealizedUsd) && none.subagentCalls === 0 && none.usage.turns === 2);

// 6. fail closed: an aborted child request, or an unreadable DB
const broken = opencodeChildSessionSets({ sessions, parts, messages: [...messages, { session_id: CHILD, role: 'assistant' }] }, MAIN);
const inc = opencodeRowCosts({ mainTurns, childSets: broken, price: PRICE }).fields;
check('aborted child request: inclusive null, lower bound = main + measured', inc.costRealizedUsd === null && inc.costAccountingComplete === false
  && near(inc.costRealizedLowerBoundUsd, realized(all)), JSON.stringify(inc));
const unread = opencodeRowCosts({ mainTurns, childSets: null, price: PRICE }).fields;
check('unreadable DB: inclusive null, lower bound = main', unread.costRealizedUsd === null && unread.costNaiveUsd === null
  && unread.costAccountingComplete === false && near(unread.costRealizedLowerBoundUsd, realized(mainTurns)) && unread.subagentSessionsRead === false);

console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);

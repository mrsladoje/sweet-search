#!/usr/bin/env node
// recompute-subagent-cost.mjs — fold opencode subagent (child-session) spend into the saved
// final-run rows, offline, from opencode's session DBs. $0: no model or judge call.
//
//   node core/prompt-optimization/data/final-run/recompute-subagent-cost.mjs [--check] [--tag final]
//
// THE DEFECT (fixed in scripts/retrieval-bench-282.mjs runOpencode, 2026-10-04): the opencode row
// ledger was built from `opencode run --format json`, which streams only the MAIN session. A `task`
// subagent runs in a child session (session.parent_id) that the stream never shows, so its
// requests, tokens, cost and tool calls were off the row. The bench's cost definition is
// sidechain-inclusive, as for Claude Code.
//
// For every row of r282-oc-sol61-high-<tag>-r<rep>/runs.jsonl:
//   1. find its main session in ~/.ss-eval/r282/oc-sol61-high-<tag>-r<rep>/oc-data-<arm>/opencode.db:
//      a parent-less session that started inside the row's wall-time window AND whose step-finish
//      turns reproduce the row's usage (turns, in, out) exactly; exactly one must match.
//   2. gate: the main-session turns, priced by the bench's own function, must reproduce the row's
//      costRealizedUsd and costNaiveUsd to $0.000001 (else the script stops and writes nothing).
//   3. price main + child sessions with opencodeRowCosts (the function the bench now uses).
// The first run keeps the original file as runs.orig.jsonl; later runs always start from it.
// --check: print the per-arm changes, write nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const H = path.join(ROOT, 'eval/task-completion-bench/harness');
const { opencodeStepFinishTurn, readOpencodeChildSessions, opencodeRowCosts } = await import(path.join(H, 'opencode-task-runner.mjs'));
const { costsFromTurns, priceFor } = await import(path.join(H, 'agent-runner-shared.mjs'));
const Database = createRequire(import.meta.url)('better-sqlite3');

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const TAG = argv.includes('--tag') ? argv[argv.indexOf('--tag') + 1] : 'final';
const RESULTS = path.join(ROOT, 'core/prompt-optimization/data/results');
const STATE = path.join(os.homedir(), '.ss-eval/r282');
const CELL = 'oc-sol61-high';
const PRICE = priceFor('openai/gpt-6.1-sol'); // CELLS['oc-sol61-high'].price in the bench
const OC_DIR = { sweet: 'sweet', before: 'before', native: 'native' };
const near = (a, b) => a != null && b != null && Math.abs(a - b) <= 1e-6;

function mainSessions(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const sessions = db.prepare('select id, directory, time_created from session where parent_id is null').all();
    const parts = db.prepare(`select session_id, data from part where json_extract(data, '$.type') = 'step-finish' order by time_created, id`).all();
    const turns = new Map(sessions.map(s => [s.id, []]));
    for (const p of parts) turns.get(p.session_id)?.push(opencodeStepFinishTurn(JSON.parse(p.data)));
    return sessions.map(s => ({ ...s, turns: turns.get(s.id) }));
  } finally { db.close(); }
}
const sum = (ts, k) => ts.reduce((a, t) => a + t[k], 0);

const dirs = fs.readdirSync(RESULTS).filter(d => d.startsWith(`r282-${CELL}-${TAG}-r`)).sort();
if (!dirs.length) { console.error(`no ${CELL} ${TAG} runs under ${RESULTS}`); process.exit(2); }
const report = [];
const writes = [];
for (const d of dirs) {
  const rep = /-r(\d+)$/.exec(d)[1];
  const orig = path.join(RESULTS, d, 'runs.orig.jsonl'), cur = path.join(RESULTS, d, 'runs.jsonl');
  const src = fs.existsSync(orig) ? orig : cur;
  const rows = fs.readFileSync(src, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const byArm = new Map();
  const out = rows.map((r) => {
    if (r.error || r.harness !== 'opencode') return r;
    const dbPath = path.join(STATE, `${CELL}-${TAG}-r${rep}`, `oc-data-${OC_DIR[r.arm]}`, 'opencode.db');
    if (!byArm.has(r.arm)) byArm.set(r.arm, { dbPath, mains: mainSessions(dbPath), used: new Set() });
    const A = byArm.get(r.arm);
    const t0 = r.startedAtMs, t1 = r.startedAtMs + r.wallMs;
    const cands = A.mains.filter(s => s.time_created >= t0 - 1000 && s.time_created <= t1 && !A.used.has(s.id)
      && s.turns.length === r.usage.turns && sum(s.turns, 'in') === r.usage.in && sum(s.turns, 'out') === r.usage.out);
    if (cands.length !== 1) throw new Error(`${d} ${r.arm} ${r.id}: ${cands.length} main sessions match the row (need 1)`);
    const s = cands[0]; A.used.add(s.id);
    const main = costsFromTurns(s.turns, PRICE);
    if (!near(main.costRealizedUsd, r.costRealizedUsd) || !near(main.costNaiveUsd, r.costNaiveUsd)) {
      throw new Error(`${d} ${r.arm} ${r.id}: main session does not reproduce the row cost (${main.costRealizedUsd} vs ${r.costRealizedUsd}, naive ${main.costNaiveUsd} vs ${r.costNaiveUsd})`);
    }
    const children = readOpencodeChildSessions(A.dbPath, s.id);
    const { costs, fields } = opencodeRowCosts({ mainTurns: s.turns, childSets: children, price: PRICE });
    const callsMainOnly = r.callsMainOnly ?? r.calls;
    const nr = {
      ...r, sessionID: s.id,
      ledgerBasis: costs.ledgerBasis ?? r.ledgerBasis, costRealizedFlat125Usd: costs.costRealizedFlat125Usd ?? null,
      cacheWriteTokens: costs.cacheWriteTokens ?? null, cacheWriteTokens5m: costs.cacheWriteTokens5m ?? null,
      cacheWriteTokens1h: costs.cacheWriteTokens1h ?? null, cacheWriteUnsplitTokens: costs.cacheWriteUnsplitTokens ?? null,
      ...fields, costSource: 'step_finish+child_sessions',
      calls: callsMainOnly + (fields.subagentCalls || 0), callsMainOnly,
      costRecomputed: { at: new Date().toISOString(), by: 'final-run/recompute-subagent-cost.mjs', from: path.basename(src) },
    };
    const k = `${d}|${r.arm}`;
    const e = report.find(x => x.k === k) || (report.push({ k, dir: d, arm: r.arm, rows: 0, changed: 0, billedOld: 0, billedNew: 0, naiveOld: 0, naiveNew: 0, callsOld: 0, callsNew: 0, ids: [] }), report.at(-1));
    e.rows++; e.billedOld += r.costRealizedUsd; e.billedNew += nr.costRealizedUsd; e.naiveOld += r.costNaiveUsd; e.naiveNew += nr.costNaiveUsd;
    e.callsOld += r.calls; e.callsNew += nr.calls;
    if (!near(nr.costRealizedUsd, r.costRealizedUsd) || nr.calls !== r.calls) {
      e.changed++; e.ids.push(`${r.id} (+$${(nr.costRealizedUsd - r.costRealizedUsd).toFixed(4)} billed, +$${(nr.costNaiveUsd - r.costNaiveUsd).toFixed(4)} no-cache, +${nr.calls - r.calls} calls, ${fields.subagentContexts} child ${fields.subagentAgents.join('+')})`);
    }
    return nr;
  });
  writes.push({ d, orig, cur, src, out });
}

console.log('| run | arm | rows | rows changed | billed sum old → new | no-cache sum old → new | calls old → new |');
console.log('|---|---|---:|---:|---|---|---|');
for (const e of report) console.log(`| ${e.dir} | ${e.arm} | ${e.rows} | ${e.changed} | $${e.billedOld.toFixed(4)} → $${e.billedNew.toFixed(4)} (${(100 * (e.billedNew / e.billedOld - 1)).toFixed(1)}%) | $${e.naiveOld.toFixed(4)} → $${e.naiveNew.toFixed(4)} (${(100 * (e.naiveNew / e.naiveOld - 1)).toFixed(1)}%) | ${e.callsOld} → ${e.callsNew} |`);
for (const e of report) for (const id of e.ids) console.log(`  ${e.dir} ${e.arm}: ${id}`);
if (CHECK) { console.log('--check: nothing written'); process.exit(0); }
for (const w of writes) {
  if (!fs.existsSync(w.orig)) fs.copyFileSync(w.cur, w.orig);
  fs.writeFileSync(w.cur, w.out.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(`wrote ${path.relative(ROOT, w.cur)} (original: ${path.relative(ROOT, w.orig)})`);
}

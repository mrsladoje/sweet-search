#!/usr/bin/env node
/**
 * packaging-recompute.mjs — READ-ONLY archival measurement.
 *
 * Recomputes both arms of a completed run at ENVELOPE level (what the harness counts,
 * `calls = toolCalls.length`) and at RETRIEVAL-AND-TEST OPERATION level, using the SAME
 * `analyzeToolEnvelope` meter the A/B gate uses, so operation and envelope
 * categories can never drift apart.
 *
 * Establishes how much of an apparent calls/turn gap is packaging rather than work.
 *
 * Usage:
 *   node stats/packaging-recompute.mjs <path/to/opencode.db> [--json]
 *
 * The DB is copied (db + WAL + shm) to a scratch dir and the copy is read, so the source
 * store is never opened for write.
 */
import { execFileSync } from 'node:child_process';
import { analyzeToolEnvelope } from './probe-count.mjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const inputs = args.filter(arg => arg !== '--json');
const db = inputs[0];
const unknownFlag = args.find(arg => arg.startsWith('--') && arg !== '--json');
if (!db || inputs.length !== 1 || unknownFlag) {
  console.error('usage: node stats/packaging-recompute.mjs <opencode.db> [--json]');
  process.exit(2);
}

const py = `
import sqlite3, shutil, tempfile, os, json
src = ${JSON.stringify(db)}
tmp = tempfile.mkdtemp(); dst = os.path.join(tmp, "c.db")
for suf in ("", "-wal", "-shm"):
    if os.path.exists(src + suf):
        shutil.copyfile(src + suf, dst + suf)
try:
    c = sqlite3.connect(dst)
    sess = {sid: d for sid, d in c.execute(
        "select id,directory from session where directory like '/root/.ss-eval/runs/%'")}
    rows = []
    for sid, mid, data in c.execute(
            "select session_id,message_id,data from part "
            "where json_extract(data,'$.type')='tool'"):
        if sid not in sess: continue
        d = json.loads(data)
        rows.append([sess[sid], sid, mid, d.get("tool"),
                     (d.get("state", {}).get("input") or {}).get("command", "") or ""])
    assistant = list(c.execute(
        "select s.directory,m.session_id,m.id from message m join session s on s.id=m.session_id "
        "where s.directory like '/root/.ss-eval/runs/%' and json_extract(m.data,'$.role')='assistant'"))
    print(json.dumps({"tools": rows, "assistant": assistant}))
finally:
    shutil.rmtree(tmp, ignore_errors=True)
`;

const extracted = JSON.parse(execFileSync('python3', ['-c', py], {
  encoding: 'utf8', maxBuffer: 1 << 29,
}));

const agg = {};
for (const [dir, sid, mid, tool, cmd] of extracted.tools) {
  const arm = dir.includes('__sweet__') ? 'sweet' : dir.includes('__native__') ? 'native' : null;
  if (!arm) continue;
  const a = (agg[arm] ||= {
    totalEnvelopes: 0,
    retrievalEnvelopes: 0,
    testEnvelopes: 0,
    editEnvelopes: 0,
    operations: 0,
    toolBearingTurns: new Set(),
    modelTurns: new Set(),
    fusedEnvelopes: 0,
  });
  const envelope = analyzeToolEnvelope(tool, cmd);
  a.totalEnvelopes++;
  a.retrievalEnvelopes += Number(envelope.retrievalEnvelope);
  a.testEnvelopes += Number(envelope.testEnvelope);
  a.editEnvelopes += Number(envelope.editEnvelope);
  a.operations += envelope.operations;
  a.toolBearingTurns.add(`${sid}|${mid}`);
  if (envelope.operations > 1) a.fusedEnvelopes++;
}
for (const [dir, sid, mid] of extracted.assistant) {
  const arm = dir.includes('__sweet__') ? 'sweet' : dir.includes('__native__') ? 'native' : null;
  if (arm && agg[arm]) agg[arm].modelTurns.add(`${sid}|${mid}`);
}

const out = {};
for (const [arm, a] of Object.entries(agg)) {
  const turns = a.toolBearingTurns.size;
  const modelTurns = a.modelTurns.size;
  const missingToolTurns = [...a.toolBearingTurns].filter(turn => !a.modelTurns.has(turn));
  if (missingToolTurns.length) {
    console.error(`${arm}: ${missingToolTurns.length} tool-bearing turn(s) have no assistant ` +
      'message row; message-table extraction is incomplete');
    process.exit(1);
  }
  out[arm] = {
    modelTurns,
    toolBearingTurns: turns,
    totalEnvelopes: a.totalEnvelopes,
    retrievalEnvelopes: a.retrievalEnvelopes,
    testEnvelopes: a.testEnvelopes,
    editEnvelopes: a.editEnvelopes,
    operations: a.operations,
    operationsPerRetrievalEnvelope: +(a.operations / a.retrievalEnvelopes).toFixed(3),
    totalEnvelopesPerTurn: +(a.totalEnvelopes / turns).toFixed(3),
    retrievalEnvelopesPerTurn: +(a.retrievalEnvelopes / turns).toFixed(3),
    operationsPerTurn: +(a.operations / turns).toFixed(3),
    retrievalEnvelopesPerModelTurn: +(a.retrievalEnvelopes / modelTurns).toFixed(3),
    operationsPerModelTurn: +(a.operations / modelTurns).toFixed(3),
    multiOpEnvelopes: a.fusedEnvelopes,
    // Compatibility aliases retain the historical tool-bearing-turn denominator
    // used for the frozen 8.4% packaging result. `modelTurns` above is the actual
    // completed-assistant-step count and must be used for new work.
    turns,
    envelopes: a.totalEnvelopes,
    opsPerEnvelope: +(a.operations / a.totalEnvelopes).toFixed(3),
    envelopesPerTurn: +(a.totalEnvelopes / turns).toFixed(3),
  };
}
if (out.sweet && out.native) {
  out.gap = {
    turns: +((out.sweet.turns / out.native.turns - 1) * 100).toFixed(1),
    envelopesPerTurn: +((out.sweet.envelopesPerTurn / out.native.envelopesPerTurn - 1) * 100).toFixed(1),
    operationsPerTurn: +((out.sweet.operationsPerTurn / out.native.operationsPerTurn - 1) * 100).toFixed(1),
  };
  const envDef = 1 - out.sweet.envelopesPerTurn / out.native.envelopesPerTurn;
  const opDef = 1 - out.sweet.operationsPerTurn / out.native.operationsPerTurn;
  out.gap.packagingShareOfGapPct = +((1 - opDef / envDef) * 100).toFixed(0);
}

if (asJson) console.log(JSON.stringify(out, null, 2));
else {
  for (const [arm, v] of Object.entries(out)) {
    if (arm === 'gap') continue;
    console.log(`${arm.padEnd(7)} model-turns=${String(v.modelTurns).padStart(5)} ` +
      `tool-turns=${String(v.toolBearingTurns).padStart(5)} ` +
      `ret-env=${String(v.retrievalEnvelopes).padStart(5)} test-env=${String(v.testEnvelopes).padStart(5)} ` +
      `edit-env=${String(v.editEnvelopes).padStart(5)} ops=${String(v.operations).padStart(6)} ` +
      `ops/ret-env=${v.operationsPerRetrievalEnvelope.toFixed(2)} ` +
      `ret-env/model-turn=${v.retrievalEnvelopesPerModelTurn.toFixed(3)} ` +
      `ops/model-turn=${v.operationsPerModelTurn.toFixed(3)} ` +
      `ops/tool-turn=${v.operationsPerTurn.toFixed(3)} ` +
      `multiOpEnv=${v.multiOpEnvelopes}`);
  }
  if (out.gap) {
    console.log(`\nsweet vs native: turns ${out.gap.turns > 0 ? '+' : ''}${out.gap.turns}% | ` +
      `envelopes/turn ${out.gap.envelopesPerTurn}% | operations/turn ${out.gap.operationsPerTurn}%`);
    console.log(`packaging share of the envelopes/turn gap: ${out.gap.packagingShareOfGapPct}%`);
  }
}

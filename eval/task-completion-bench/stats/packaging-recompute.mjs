#!/usr/bin/env node
/**
 * packaging-recompute.mjs — READ-ONLY archival measurement.
 *
 * Recomputes both arms of a completed run at ENVELOPE level (what the harness counts,
 * `calls = toolCalls.length`) and at RETRIEVAL-AND-TEST OPERATION level, using the SAME
 * `countProbes` the A/B gate uses, so the two can never drift apart.
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
import { countProbes } from './probe-count.mjs';

const db = process.argv[2];
const asJson = process.argv.includes('--json');
if (!db) {
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
    print(json.dumps(rows))
finally:
    shutil.rmtree(tmp, ignore_errors=True)
`;

const rows = JSON.parse(execFileSync('python3', ['-c', py], {
  encoding: 'utf8', maxBuffer: 1 << 29,
}));

const NATIVE_TOOLS = new Set(['read', 'grep', 'glob', 'list']);
const agg = {};
for (const [dir, sid, mid, tool, cmd] of rows) {
  const arm = dir.includes('__sweet__') ? 'sweet' : dir.includes('__native__') ? 'native' : null;
  if (!arm) continue;
  const a = (agg[arm] ||= { env: 0, ops: 0, turns: new Set(), fused: 0 });
  a.env++;
  a.turns.add(`${sid}|${mid}`);
  if (tool === 'bash' || tool === 'shell') {
    const k = countProbes(cmd);
    a.ops += k;
    if (k > 1) a.fused++;
  } else if (NATIVE_TOOLS.has(String(tool))) {
    a.ops += 1;
  }
}

const out = {};
for (const [arm, a] of Object.entries(agg)) {
  const t = a.turns.size;
  out[arm] = {
    turns: t, envelopes: a.env, operations: a.ops,
    opsPerEnvelope: +(a.ops / a.env).toFixed(3),
    envelopesPerTurn: +(a.env / t).toFixed(3),
    operationsPerTurn: +(a.ops / t).toFixed(3),
    multiOpEnvelopes: a.fused,
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
    console.log(`${arm.padEnd(7)} turns=${String(v.turns).padStart(5)} env=${String(v.envelopes).padStart(5)} ` +
      `ops=${String(v.operations).padStart(6)} ops/env=${v.opsPerEnvelope.toFixed(2)} ` +
      `env/turn=${v.envelopesPerTurn.toFixed(3)} ops/turn=${v.operationsPerTurn.toFixed(3)} ` +
      `multiOpEnv=${v.multiOpEnvelopes}`);
  }
  if (out.gap) {
    console.log(`\nsweet vs native: turns ${out.gap.turns > 0 ? '+' : ''}${out.gap.turns}% | ` +
      `envelopes/turn ${out.gap.envelopesPerTurn}% | operations/turn ${out.gap.operationsPerTurn}%`);
    console.log(`packaging share of the envelopes/turn gap: ${out.gap.packagingShareOfGapPct}%`);
  }
}

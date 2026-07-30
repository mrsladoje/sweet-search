#!/usr/bin/env node
/**
 * probe-count.mjs — PREDECLARED DIAGNOSTIC for the turn-economy A/B.
 *
 * The harness counts `calls = toolCalls.length` (opencode-task-runner.mjs:178) — i.e. tool
 * ENVELOPES, not retrieval operations. `classifyShell` is prefix-anchored, so
 *   `ss-grep A && ss-grep B && ss-read C`   counts as ONE `ss` call, and
 *   `ls && ss-grep A`                       counts as ONE `bash` call with the probe invisible.
 *
 * A turn-economy treatment could therefore ADD probes, fuse them into one bash envelope, and
 * still pass a calls/task gate defined on envelopes. That makes the envelope metric unable to
 * validate the block's "never a probe you had not planned" clause on its own.
 *
 * This script recovers the underlying count by splitting fused shell strings on `;`, `&&`, `||`
 * and newlines (respecting quotes) and counting `ss-*` / `run_tests` occurrences per segment.
 * READ-ONLY: it reads each rollout's private OpenCode store and writes nothing.
 *
 * Usage:
 *   node stats/probe-count.mjs <results/<RUN_ID>/agent-state>  [--json]
 *
 * Reports, per rollout and per arm:
 *   envelopes            tool calls as the harness counts them
 *   probes               underlying ss-* / run_tests operations
 *   probesPerEnvelope    the packaging factor the envelope metric hides
 *   turns                assistant messages carrying >=1 tool call
 *   envelopesPerTurn     comparable to the 1.14 v 1.76 figure
 *   probesPerTurn        what that figure MEANS once fusion is undone
 */
import { readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// SYMMETRIC retrieval/test operation set — the same buckets `classifyShell` uses
// (ss / nativeGrep / nativeRead / test). Sweet's `ss-read` and native's `cat`/`sed` are
// counted alike; pure edits and non-retrieval shell (`git log`, `npm i`, `cd`) count 0 on
// BOTH arms. An asymmetric set (ss-* only) biases hard against the native arm.
const SS = /^(ss[-_](search|grep|find|read|semantic|trace)|sweet-search|run_tests|cat|head|tail|nl|bat|less|sed\s+(-n|')|rg|grep|ag|ack|git\s+grep|find|ls)\b/;

/** Split a shell string into top-level segments on ; && || and newlines, honouring quotes. */
export function splitShell(cmd) {
  const out = [];
  let cur = '', q = null, depth = 0;
  const s = String(cmd || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === q && s[i - 1] !== '\\') q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if (c === '(') { depth++; cur += c; continue; }
    if (c === ')') { depth--; cur += c; continue; }
    if (depth === 0) {
      if (c === ';' || c === '\n') { out.push(cur); cur = ''; continue; }
      if ((c === '&' && s[i + 1] === '&') || (c === '|' && s[i + 1] === '|')) {
        out.push(cur); cur = ''; i++; continue;
      }
    }
    cur += c;
  }
  out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}

/** Count `ss-` and `run_tests` operations inside one shell string. */
export function countProbes(cmd) {
  return splitShell(cmd).filter(seg => SS.test(seg)).length;
}

function findDb(dir) {
  const hits = [];
  const walk = (d, depth = 0) => {
    if (depth > 4) return;
    let ents = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name.endsWith('.db')) hits.push(p);
    }
  };
  walk(dir);
  return hits.sort((a, b) => statSync(b).size - statSync(a).size)[0];
}

/**
 * Read tool parts via python3's sqlite3 (the box has no `sqlite3` CLI and Node 20 has no
 * `node:sqlite`). The db + WAL + shm are copied to a scratch dir first, so the run's own
 * store is never opened for write and an un-checkpointed WAL is not lost.
 */
function readToolParts(db) {
  const py = `
import sqlite3, shutil, tempfile, os, json, sys
src = ${JSON.stringify(db)}
tmp = tempfile.mkdtemp()
dst = os.path.join(tmp, "c.db")
for suf in ("", "-wal", "-shm"):
    if os.path.exists(src + suf):
        shutil.copyfile(src + suf, dst + suf)
try:
    c = sqlite3.connect(dst)
    rows = c.execute(
        "select message_id, json_extract(data,'$.tool'), "
        "coalesce(json_extract(data,'$.state.input.command'),'') "
        "from part where json_extract(data,'$.type')='tool'").fetchall()
    c.close()
    print(json.dumps(rows))
finally:
    shutil.rmtree(tmp, ignore_errors=True)
`;
  const out = execFileSync('python3', ['-c', py], { encoding: 'utf8', maxBuffer: 1 << 28 });
  return JSON.parse(out);
}

function analyzeRollout(dir) {
  const db = findDb(dir);
  if (!db) return null;
  let rows;
  try { rows = readToolParts(db); } catch (e) {
    console.error(`  [skip] ${dir}: ${String(e.message).slice(0, 120)}`);
    return null;
  }

  const turns = new Set();
  let envelopes = 0, probes = 0, fused = 0;
  for (const [mid, tool, cmd] of rows) {
    envelopes++;
    turns.add(mid);
    if (tool === 'bash' || tool === 'shell') {
      const n = countProbes(cmd);
      probes += n;
      if (n > 1) fused++;
    } else if (['read', 'grep', 'glob', 'list'].includes(String(tool))) {
      probes += 1;                          // native retrieval tool = one operation
    }
  }
  return { envelopes, probes, turns: turns.size, fused };
}

const root = process.argv[2];
const asJson = process.argv.includes('--json');
if (!root || !existsSync(root)) {
  console.error('usage: node stats/probe-count.mjs <results/<RUN_ID>/agent-state> [--json]');
  process.exit(2);
}

const perArm = {};
const rollouts = [];
for (const name of readdirSync(root).sort()) {
  const dir = path.join(root, name);
  if (!statSync(dir).isDirectory()) continue;
  const r = analyzeRollout(dir);
  if (!r) continue;
  const arm = name.endsWith('-sweet') ? 'sweet' : name.endsWith('-native') ? 'native' : 'other';
  rollouts.push({ rollout: name, arm, ...r });
  (perArm[arm] ||= { envelopes: 0, probes: 0, turns: 0, n: 0 });
  perArm[arm].envelopes += r.envelopes;
  perArm[arm].probes += r.probes;
  perArm[arm].turns += r.turns;
  perArm[arm].n++;
}

if (asJson) {
  console.log(JSON.stringify({ rollouts, perArm }, null, 2));
} else {
  console.log('rollout'.padEnd(44), 'env'.padStart(6), 'probe'.padStart(6),
              'p/env'.padStart(6), 'turns'.padStart(6), 'env/t'.padStart(6), 'p/t'.padStart(6));
  for (const r of rollouts) {
    console.log(r.rollout.padEnd(44), String(r.envelopes).padStart(6), String(r.probes).padStart(6),
                (r.probes / (r.envelopes || 1)).toFixed(2).padStart(6), String(r.turns).padStart(6),
                (r.envelopes / (r.turns || 1)).toFixed(2).padStart(6),
                (r.probes / (r.turns || 1)).toFixed(2).padStart(6));
  }
  console.log('\n=== per arm ===');
  for (const [arm, a] of Object.entries(perArm)) {
    console.log(`${arm.padEnd(8)} n=${a.n}  envelopes=${a.envelopes}  probes=${a.probes}  ` +
      `probes/envelope=${(a.probes / (a.envelopes || 1)).toFixed(2)}  ` +
      `envelopes/turn=${(a.envelopes / (a.turns || 1)).toFixed(2)}  ` +
      `probes/turn=${(a.probes / (a.turns || 1)).toFixed(2)}`);
  }
}

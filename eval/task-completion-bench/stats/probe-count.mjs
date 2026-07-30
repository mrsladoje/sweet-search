#!/usr/bin/env node
/**
 * probe-count.mjs — PREDECLARED DIAGNOSTIC for the turn-economy A/B.
 *
 * WHAT IT COUNTS: **retrieval-and-test operations** — `ss-*`, `run_tests`, native
 * retrieval shell (`cat`/`sed -n`/`grep`/`rg`/`find`/`ls`…), and the harness's native
 * read/grep/glob/list tools. Edits and non-retrieval shell (`git log`, `npm i`, `cd`)
 * count ZERO on BOTH arms. It is deliberately NOT "all operations"; it is the
 * anti-shotgun metric, and it keeps that precise name everywhere it is reported.
 *
 * WHY IT EXISTS: the harness counts `calls = toolCalls.length`
 * (opencode-task-runner.mjs:178) — tool ENVELOPES, not operations. `classifyShell` is
 * prefix-anchored, so
 *   `ss-grep A && ss-grep B && ss-read C`   counts as ONE `ss` call, and
 *   `ls && ss-grep A`                       counts as ONE `bash` call, probe invisible.
 * A treatment could therefore ADD probes, fuse them into one envelope, and still pass a
 * calls/task gate defined on envelopes. This recovers the underlying count.
 *
 * PARSER SCOPE (locked by tests/probe-count.mjs — read it before trusting a number):
 *   handled  — `;` `&&` `||` newline separation; quotes; `( … )` and `{ … }` groups
 *              (recursively); leading env assignments (`X=1 cmd`); wrapper commands
 *              (`timeout N`, `env`, `command`, `nice`, `time`, `stdbuf …`); `$( … )`
 *              command substitution (recursively); pipelines count as one operation
 *              (`ss-grep A | head` is one retrieval).
 *   NOT handled — backgrounding semantics, `eval`-constructed commands, aliases,
 *              here-doc bodies. If a pilot rollout uses those, audit it by hand.
 *
 * READ-ONLY: copies each rollout's OpenCode store (db + WAL + shm) to a scratch dir and
 * reads the copy, so no run artifact is ever opened for write.
 *
 * Usage:
 *   node stats/probe-count.mjs <results/<RUN_ID>/agent-state> [--json]
 */
import { readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Head-of-command matcher for a retrieval-or-test operation. */
const OP = /^(ss[-_](search|grep|find|read|semantic|trace)|sweet-search|run_tests|cat|head|tail|nl|bat|less|sed|rg|grep|ag|ack|find|ls)$/;
/** Leading wrappers that delegate to a real command; strip then re-inspect the head. */
const WRAPPER = /^(timeout|env|command|nice|time|stdbuf|nohup|ionice)$/;

/** Split a shell string into top-level segments on ; && || and newlines, honouring
 *  quotes, parens and braces. Pipes are NOT split: a pipeline is one operation. */
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
    if (c === '(' || c === '{') { depth++; cur += c; continue; }
    if (c === ')' || c === '}') { depth--; cur += c; continue; }
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

/** Extract the bodies of every `$( … )` substitution NOT inside single quotes.
 *  Single quotes suppress substitution in POSIX shells; double quotes do not. */
function substitutions(seg) {
  const out = [];
  let q = null;                                  // "'" suppresses; '"' does not
  for (let i = 0; i < seg.length - 1; i++) {
    const c = seg[i];
    if (q === "'") { if (c === "'") q = null; continue; }
    if (q === '"') {
      if (c === '"' && seg[i - 1] !== '\\') { q = null; continue; }
    } else {
      if (c === "'") { q = "'"; continue; }
      if (c === '"') { q = '"'; continue; }
    }
    if (c === '$' && seg[i + 1] === '(') {
      let d = 1, j = i + 2, body = '';
      while (j < seg.length && d > 0) {
        if (seg[j] === '(') d++;
        else if (seg[j] === ')') { d--; if (!d) break; }
        body += seg[j]; j++;
      }
      out.push(body);
      i = j;
    }
  }
  return out;
}

/** Split a segment into words, honouring quotes (so `X='a b' cmd` is two words). */
function tokenize(seg) {
  const toks = [];
  let cur = '', q = null, started = false;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (q) {
      if (c === q && seg[i - 1] !== '\\') q = null; else cur += c;
      continue;
    }
    if (c === "'" || c === '"') { q = c; started = true; continue; }
    if (/\s/.test(c)) { if (cur || started) { toks.push(cur); cur = ''; started = false; } continue; }
    cur += c;
  }
  if (cur || started) toks.push(cur);
  return toks;
}

/** Strip leading `VAR=val` assignments and wrapper commands, return the effective head. */
function effectiveHead(seg) {
  let toks = tokenize(seg);
  for (;;) {
    if (!toks.length) return '';
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[0])) { toks = toks.slice(1); continue; }
    const base = path.basename(toks[0]);
    if (WRAPPER.test(base)) {
      toks = toks.slice(1);
      // drop the wrapper's own options/operands (e.g. `timeout 60`, `stdbuf -o0`)
      while (toks.length && /^(-|\d+(\.\d+)?[smhd]?$)/.test(toks[0])) toks = toks.slice(1);
      continue;
    }
    return base;
  }
}

/** Count retrieval-and-test operations inside one shell string. Recursive. */
export function countProbes(cmd) {
  let n = 0;
  for (const seg of splitShell(cmd)) {
    // Recurse into ( … ) and { … } groups rather than treating them as one command.
    const grouped = seg.match(/^[({]([\s\S]*)[)}]$/);
    if (grouped) { n += countProbes(grouped[1]); continue; }
    for (const sub of substitutions(seg)) n += countProbes(sub);
    if (OP.test(effectiveHead(seg))) n += 1;
  }
  return n;
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

export function analyzeRollout(dir) {
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

// CLI entry — guarded so the parser above can be imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
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
}

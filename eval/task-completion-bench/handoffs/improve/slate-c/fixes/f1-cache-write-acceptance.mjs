#!/usr/bin/env node
// F1 acceptance — does the SHIPPED code, with cacheWrite emitted by the codex and opencode
// runners, reproduce the register's G17 numbers (opencode +2.52%, codex +0.06% against
// native) on the fresh-pool usage?
//
// Read-only. Imports the real parsers so this measures the fix, not a re-derivation of it:
//   codex     ideal-cost.mjs turnsFromRollout   (cache_write_input_tokens)
//   opencode  opencode-task-runner.mjs parseOpencodeStream (tokens.cache.write)
// and prices both through costFromTurns, the single source of truth.
//
// Usage: node f1-acceptance.mjs <harness-dir> <results-dir> <repair-tasks.txt> <tcb-root>
import fs from 'node:fs';
import path from 'node:path';

const HARNESS = process.argv[2];
const RES = process.argv[3];
const REPAIR_FILE = process.argv[4];
const TCB_ROOT = process.argv[5];   // resolves openCodeRawAttempts' repo-relative stdout paths

const { turnsFromRollout, costFromTurns } = await import(path.join(HARNESS, 'ideal-cost.mjs'));
const { parseOpencodeStream } = await import(path.join(HARNESS, 'opencode-task-runner.mjs'));

const PRICE = { in: 0.10, cache: 0.01, out: 0.60 };   // openai/gpt-5.6-luna, USD per 1e6 tok
const repair = new Set(fs.readFileSync(REPAIR_FILE, 'utf8').trim().split('\n').map(s => s.trim()).filter(Boolean));
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

function rowsOf(runId) {
  const p = path.join(RES, runId, 'rows.json');
  if (!fs.existsSync(p)) { console.error('MISSING', runId); return []; }
  return JSON.parse(fs.readFileSync(p, 'utf8')).map(r => ({ ...r, runId }));
}

// Same cell rule the register used (p1-stats.mjs cellRows): the opencode sweet cell takes
// the repair pass for repaired tasks and the original run for the rest; the native cell
// never takes the repair pass.
function opencodeCell(arm) {
  const all = [...rowsOf('fp-opencode-tab-20260826'), ...rowsOf('rp-oc-tab-20260827')];
  return all.filter(r => r.arm === arm
    && (arm === 'native' ? !r.runId.startsWith('rp-')
      : (repair.has(r.taskId) ? r.runId.startsWith('rp-') : !r.runId.startsWith('rp-'))));
}

function priceRow(turns) {
  const now = costFromTurns(turns, PRICE);
  const legacy = costFromTurns(turns.map(t => ({ ...t, cacheWrite: 0 })), PRICE);
  return {
    now: now.realFromTurnsUsd,
    legacy: legacy.realFromTurnsUsd,
    cw: turns.reduce((a, t) => a + (Number(t.cacheWrite) || 0), 0),
  };
}

function codexTurnsFor(r) {
  const f = r.rolloutFile;
  if (!f) return [];
  // C-3 merged rollouts record a comma-joined list; the fresh pool has one file per row.
  return f.split(',').flatMap(x => turnsFromRollout(x));
}

function opencodeTurnsFor(r) {
  const at = r.openCodeRawAttempts || [];
  if (!at.length) return [];
  const f = path.join(TCB_ROOT, at[at.length - 1].stdout);
  if (!fs.existsSync(f)) return [];
  return parseOpencodeStream(fs.readFileSync(f, 'utf8')).turns;
}

const cells = {
  codex: {
    native: rowsOf('fp-codex-tab-20260826').filter(r => r.arm === 'native'),
    sweet: rowsOf('fp-codex-tab-20260826').filter(r => r.arm === 'sweet'),
    turns: codexTurnsFor,
  },
  opencode: {
    native: opencodeCell('native'),
    sweet: opencodeCell('sweet'),
    turns: opencodeTurnsFor,
  },
};

const TARGET = { codex: 0.06, opencode: 2.52 };
const PUBLISHED = { codex: 0.35, opencode: 3.31 };
let allPass = true;

for (const [h, cell] of Object.entries(cells)) {
  const out = {};
  for (const arm of ['native', 'sweet']) {
    const priced = cell[arm].map(r => priceRow(cell.turns(r)));
    const withTurns = priced.filter(p => p.now > 0);
    out[arm] = {
      n: cell[arm].length, nPriced: withTurns.length,
      now: mean(withTurns.map(p => p.now)),
      legacy: mean(withTurns.map(p => p.legacy)),
      cw: mean(withTurns.map(p => p.cw)),
    };
  }
  const pct = (n, s) => 100 * (s - n) / n;
  const nowPct = pct(out.native.now, out.sweet.now);
  const legacyPct = pct(out.native.legacy, out.sweet.legacy);
  console.log(`\n=== ${h} ===`);
  console.log(`  rows: native ${out.native.nPriced}/${out.native.n}  sweet ${out.sweet.nPriced}/${out.sweet.n}`);
  console.log(`  cache-write tok/rollout: native ${Math.round(out.native.cw)}  sweet ${Math.round(out.sweet.cw)}`);
  console.log(`  legacy basis (cache-write-1.25x-claudecode-only): native $${out.native.legacy.toFixed(6)}  sweet $${out.sweet.legacy.toFixed(6)}  sweet ${legacyPct >= 0 ? '+' : ''}${legacyPct.toFixed(2)}%   [published ${PUBLISHED[h]}%]`);
  console.log(`  new basis (cache-write-1.25x-all-harnesses):      native $${out.native.now.toFixed(6)}  sweet $${out.sweet.now.toFixed(6)}  sweet ${nowPct >= 0 ? '+' : ''}${nowPct.toFixed(2)}%   [target ${TARGET[h]}%]`);
  const ok = Math.abs(nowPct - TARGET[h]) <= 0.05;
  const okLegacy = Math.abs(legacyPct - PUBLISHED[h]) <= 0.05;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} new basis reproduces ${TARGET[h]}% (|Δ| ${Math.abs(nowPct - TARGET[h]).toFixed(3)} pp, bar 0.05)`);
  console.log(`  ${okLegacy ? 'PASS' : 'FAIL'} legacy basis reproduces the published ${PUBLISHED[h]}% (|Δ| ${Math.abs(legacyPct - PUBLISHED[h]).toFixed(3)} pp, bar 0.05)`);
  if (!ok || !okLegacy) allPass = false;
}
console.log(`\n${allPass ? 'ACCEPTANCE PASS' : 'ACCEPTANCE FAIL'}`);
process.exit(allPass ? 0 : 1);

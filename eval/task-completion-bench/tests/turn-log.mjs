// Unit tests for P7 measurement hygiene (PLAN.md §3 B1/B4, §6 lever P7):
//   - turn-log.mjs: the per-rollout {in,cached,out} archive that makes the next
//     forensics pass exact instead of algebraic
//   - costsFromTurns: the UNIFIED four-column cost contract every adapter emits
// Standalone: `node tests/turn-log.mjs` — exit 1 on fail.
import { persistTurns, readTurnLog, turnsDir } from '../harness/turn-log.mjs';
import { costsFromTurns } from '../harness/agent-runner-shared.mjs';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';

process.env.RUN_ID = `test-turnlog-${process.pid}`;
const DIR = turnsDir();

let ok = true;
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const assert = (c, name, extra = '') => { console.log((c ? '  ✓ ' : '  ✗ ') + name + (c ? '' : '  ' + extra)); if (!c) ok = false; };

console.log('turn-log persistence:');
const turns = [
  { in: 1000, cached: 0, out: 100 },
  { in: 1500, cached: 800, out: 50 },
  { in: 2200, cached: 1500, out: 30 },
];
const rel = persistTurns('acme__widget-42-sweet', turns, {
  task: 'acme__widget-42', arm: 'sweet', harness: 'opencode',
  model: 'x-ai/grok-4.5', price: { in: 2, cache: 0.3, out: 6 }, source: 'stream',
});
assert(typeof rel === 'string' && rel.endsWith('.jsonl'), 'persistTurns returns a relative .jsonl path', String(rel));
const back = readTurnLog(rel);
assert(back.turns.length === 3, 'round-trips every turn', `got ${back.turns.length}`);
assert(back.turns[1].in === 1500 && back.turns[1].cached === 800 && back.turns[1].out === 50, 'round-trips {in,cached,out} exactly');
assert(back.meta?.turns === 3 && back.meta?.source === 'stream' && back.meta?.arm === 'sweet', 'meta line carries count + source + arm', JSON.stringify(back.meta));
// The meta line must NOT be counted as a turn — an off-by-one here would silently
// inflate every turn count in the next forensics pass.
assert(!back.turns.some(t => t.in === 0 && t.cached === 0 && t.out === 0), 'meta line is not read back as a turn');

// A crash mid-write is the documented reason this is JSONL and not a JSON array
// (the last run's c1/rows.json was truncated mid-object and needed hand repair).
const abs = path.join(DIR, 'acme__widget-42-sweet.jsonl');
const full = readFileSync(abs, 'utf8');
writeFileSync(abs, full.slice(0, full.length - 12));      // shear the final record
const torn = readTurnLog(abs);
assert(torn.meta?.turns === 3 && torn.turns.length === 2, 'a truncated tail loses ONE turn, not the file', `got ${torn.turns.length}`);

// Nothing to persist must not create an empty file that later reads as "0 turns measured".
assert(persistTurns('empty-native', [], { source: 'stream' }) === null, 'empty turns → null, no file written');
assert(!existsSync(path.join(DIR, 'empty-native.jsonl')), 'no file for an empty rollout');
// Labels become filenames; a task id with a slash must not escape the turns dir.
const esc = persistTurns('../../etc/pwned-sweet', turns, { source: 'stream' });
assert(!!esc && path.dirname(esc) === path.dirname(rel) && existsSync(path.join(DIR, path.basename(esc))),
  'a label with path separators stays inside the turns dir', String(esc));
assert(readTurnLog('does/not/exist.jsonl').turns.length === 0, 'missing file → empty, never throws');

console.log('\nunified cost columns (PLAN.md §3 B4):');
const price = { in: 5.0, cache: 0.5, out: 30.0 };
const c = costsFromTurns(turns, price);
// naive  = every input token at full rate:  (1000+1500+2200)*5 + (100+50+30)*30
const naive = ((1000 + 1500 + 2200) * 5 + 180 * 30) / 1e6;
// content = each token charged ONCE (1000 new, 500 new, 700 new) + output
const content = ((1000 + 500 + 700) * 5 + 180 * 30) / 1e6;
// ideal  = content + re-sent prefix (1000 + 1500) at the cache rate
const ideal = content + (1000 + 1500) * 0.5 / 1e6;
// real   = actual cache reads (0, 800, 1500); the rest of the prefix at full rate
const real = ((1000 * 5) + (700 * 5 + 800 * 0.5) + (700 * 5 + 1500 * 0.5) + 180 * 30) / 1e6;
assert(approx(c.costNaiveUsd, +naive.toFixed(6)), `costNaiveUsd = no-cache = ${naive.toFixed(6)}`, `got ${c.costNaiveUsd}`);
assert(approx(c.costContentUsd, +content.toFixed(6)), `costContentUsd = unique context = ${content.toFixed(6)}`, `got ${c.costContentUsd}`);
assert(approx(c.idealCostUsd, +ideal.toFixed(6)), `idealCostUsd = ${ideal.toFixed(6)}`, `got ${c.idealCostUsd}`);
assert(approx(c.costRealizedUsd, +real.toFixed(6)), `costRealizedUsd = ${real.toFixed(6)}`, `got ${c.costRealizedUsd}`);
assert(c.idealTurns === 3, 'idealTurns = turn count');
// The ordering that makes the columns interpretable at a glance. content ≤ ideal because
// ideal adds the re-sent prefix; ideal ≤ real because ideal assumes a perfect cache;
// real ≤ naive because naive assumes no cache at all.
assert(c.costContentUsd <= c.idealCostUsd + 1e-12, 'content ≤ ideal');
assert(c.idealCostUsd <= c.costRealizedUsd + 1e-12, 'ideal ≤ realized');
assert(c.costRealizedUsd <= c.costNaiveUsd + 1e-12, 'realized ≤ naive');
// REGRESSION GUARD for the actual B4 defect: the opencode adapter used to publish the
// CONTENT number under the name costNaiveUsd, so cross-harness cost comparison compared
// two different quantities (codex read $602 "content" against $144 realized). On any
// trajectory that re-sends context these two must differ.
assert(c.costNaiveUsd > c.costContentUsd + 1e-9, 'costNaiveUsd is NOT the old content number');
assert(costsFromTurns([], price).costNaiveUsd === 0, 'empty turns → $0 across the board');

rmSync(path.join(DIR, '..'), { recursive: true, force: true });
console.log(ok ? '\nALL PASS' : '\nFAILED');
process.exit(ok ? 0 : 1);

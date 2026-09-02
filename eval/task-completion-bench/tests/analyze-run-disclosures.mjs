// F3 / slate C §4.1: the claude-code ledger disclosures.
// Standalone: `node tests/analyze-run-disclosures.mjs` — exit 1 on fail.
//
// No claude-code cost figure is readable without four facts, so the analyzer must print them
// or print nothing. The regression this guards is silence: the runner writes harness
// `claudecode` while every report, run id and register row says `claude-code`, and a filter
// that matches only one of those spellings makes the whole block vanish from exactly the runs
// that need it. That failed once during development and produced a clean-looking report.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ANALYZER = fileURLToPath(new URL('../harness/analyze-run.mjs', import.meta.url));
let ok = true;
const assert = (c, name, extra = '') => { console.log((c ? '  ✓ ' : '  ✗ ') + name + (c ? '' : '  ' + extra)); if (!c) ok = false; };

const dir = mkdtempSync(path.join(tmpdir(), 'analyze-disc-'));
const usage = (mult) => ({
  input_tokens: 100 * mult, cache_creation_input_tokens: 20000 * mult,
  cache_read_input_tokens: 200000 * mult, output_tokens: 1500 * mult,
});
function mkRows(harness) {
  const rows = [];
  for (const task of ['a__one-1', 'b__two-2', 'c__three-3']) {
    for (const arm of ['native', 'sweet']) {
      for (const rep of [0, 1]) {
        rows.push({
          taskId: task, arm, rep, harness, model: 'openai/gpt-5.6-luna',
          resolved: true, gradeable: true, noTestEvidence: false,
          // native rep 1 has no inclusive cost, exactly the shape the disclosure counts
          costRealizedUsd: (arm === 'native' && rep === 1) ? null : 0.02,
          costRealizedMainOnlyUsd: 0.016,
          sidechainAccountingComplete: !(arm === 'native' && rep === 1),
          sidechainCount: 1, sidechainMissingRequests: (arm === 'native' && rep === 1) ? 7 : 0,
          usage: usage(arm === 'sweet' ? 1.1 : 1.0),
        });
      }
    }
  }
  return rows;
}
const run = (rows) => {
  const f = path.join(dir, `rows-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, JSON.stringify(rows));
  return execFileSync(process.execPath, [ANALYZER, f, '--boot', '200'], { encoding: 'utf8' });
};

console.log('claude-code disclosures fire on both spellings of the harness name:');
for (const harness of ['claudecode', 'claude-code']) {
  const out = run(mkRows(harness));
  assert(out.includes('CLAUDE-CODE LEDGER DISCLOSURES'), `harness "${harness}" prints the disclosure block`);
  assert(/construction: ROW-MATCHED/.test(out), `harness "${harness}" names the construction`);
  assert(/dearest-3/.test(out), `harness "${harness}" names the other construction it must not be compared with`);
  // 3 of 6 native rows are null in the fixture (one per task at rep 1); sweet has none.
  assert(/native: 3\/6 row\(s\) have NO inclusive cost \(3 with an incomplete delegated transcript\)/.test(out),
    `harness "${harness}" counts the null rows and their cause per arm`, out.slice(out.indexOf('CLAUDE-CODE LEDGER')).slice(0, 700));
  assert(/sweet: 0\/6 row\(s\) have NO inclusive cost/.test(out), `harness "${harness}" reports a clean arm as clean`);
  // 3 null native rows x 7 unrecorded delegated requests each.
  assert(/LOWER BOUND/.test(out) && /21 delegated request\(s\) carry no usage record/.test(out), `harness "${harness}" flags the lower bound with its missing-request count`);
  assert(/`pages` ASYMMETRY/.test(out), `harness "${harness}" discloses the pages asymmetry`);
  assert(/PRICE-VECTOR SENSITIVITY/.test(out), `harness "${harness}" prints the sensitivity row`);
  // All five named vectors, each with an interval beside its point estimate.
  for (const v of ['luna as shipped', 'no cache-write surcharge', 'Opus 5 five-minute', 'Opus 5 one-hour', 'Fable-5.1-like']) {
    assert(out.includes(v), `harness "${harness}" prices the "${v}" vector`);
  }
  assert((out.match(/95% CI \[/g) || []).length >= 5, `harness "${harness}" gives every vector its own bootstrap interval`);
  // The 0.2x subagent repricing must be named as a real-user sensitivity and never as a
  // bill correction or a ledger defect. It reprices what the pinned runner actually ran.
  assert(/REAL-USER SENSITIVITY/.test(out), `harness "${harness}" labels the 0.2x subagent repricing a real-user sensitivity`);
  assert(!/bill correction(?!,| and never)/.test(out.replace(/never a bill correction[^\n]*/g, '')), `harness "${harness}" never calls it a bill correction`);
}

console.log('\nnon-claude runs print no claude-code disclosures:');
{
  const out = run(mkRows('codex'));
  assert(!out.includes('CLAUDE-CODE LEDGER DISCLOSURES'), 'a codex run does not print the claude-code block');
  assert(out.includes('ledger basis:'), 'but every run still names its ledger basis');
}

console.log('\nthe ledger basis label is honest about mixed and unlabelled rows:');
{
  const unlabelled = run(mkRows('codex'));
  assert(/UNLABELLED ROWS/.test(unlabelled), 'rows with no ledgerBasis are called unlabelled, not assumed current');
  const mixed = mkRows('codex');
  mixed.forEach((r, i) => { r.ledgerBasis = i % 2 ? 'cache-write-1.25x-all-harnesses' : 'cache-write-1.25x-claudecode-only'; });
  assert(/MIXED .* NOT COMPARABLE/.test(run(mixed)), 'a run that pools two bases is called NOT COMPARABLE');
  const clean = mkRows('codex').map(r => ({ ...r, ledgerBasis: 'cache-write-1.25x-all-harnesses' }));
  assert(/ledger basis: cache-write-1\.25x-all-harnesses/.test(run(clean)), 'a consistent run names its basis plainly');
}

console.log('\nthe legacy basis is reachable and changes the numbers it should:');
{
  const rows = mkRows('codex').map(r => ({
    ...r, ledgerBasis: 'cache-write-1.25x-all-harnesses',
    costRealizedUsd: r.costRealizedUsd == null ? null : 0.02,
    costRealizedNoCacheWriteUsd: r.costRealizedUsd == null ? null : 0.018,
  }));
  const f = path.join(dir, 'rows-legacy.json');
  writeFileSync(f, JSON.stringify(rows));
  const legacy = execFileSync(process.execPath, [ANALYZER, f, '--boot', '200', '--ledger-basis', 'legacy-cachewrite-claudecode-only'], { encoding: 'utf8' });
  assert(/LEGACY, disclosure only/.test(legacy), 'the legacy basis labels itself as disclosure-only');
  // 6 sweet rows x $0.018 legacy = $0.108, against $0.120 on the current basis.
  assert(legacy.includes('$0.108000') && !legacy.includes('$0.120000'),
    'the legacy basis sums the legacy column, not the current one', legacy.slice(legacy.indexOf('sweet:'), legacy.indexOf('sweet:') + 60));
  let rejected = false;
  try { execFileSync(process.execPath, [ANALYZER, f, '--ledger-basis', 'nonsense'], { encoding: 'utf8', stdio: 'pipe' }); } catch { rejected = true; }
  assert(rejected, 'an unknown --ledger-basis is refused rather than silently ignored');
}

rmSync(dir, { recursive: true, force: true });
console.log(ok ? '\nALL PASS' : '\nFAILED');
process.exit(ok ? 0 : 1);

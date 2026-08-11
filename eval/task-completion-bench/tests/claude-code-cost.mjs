// Regression tests for the claude-code cost columns (2026-08-11).
//
// THE DEFECT: through OpenRouter's Anthropic-Messages skin, Claude Code's streamed
// assistant events carry ZEROED usage. The adapter therefore fell back to an aggregate,
// published idealCost = realized, and emitted NO breakPriced column at all. In a
// cross-harness cost table that silently reads as a cache-lucky number, which is exactly
// the column this bench forbids in an A/B.
//
// THE FIX: Claude Code's own session transcript keeps the real per-response usage — that
// is where its final aggregate comes from. Verified against the provider on 2026-08-11:
// every transcript row's (input + cache_read + cache_creation) equals OpenRouter's
// native_tokens_prompt for the matching generation, and output_tokens equals
// native_tokens_completion (reasoning already folded in, so it must NOT be re-added).
//
// Standalone: `node tests/claude-code-cost.mjs` — exit 1 on fail.
import { turnsFromTranscript } from '../harness/claude-code-task-runner.mjs';
import { costsFromTurns } from '../harness/agent-runner-shared.mjs';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let ok = true;
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const assert = (c, name, extra = '') => { console.log((c ? '  ✓ ' : '  ✗ ') + name + (c ? '' : '  ' + extra)); if (!c) ok = false; };

const ROOT = join(tmpdir(), `cc-cost-test-${process.pid}`);
const SESSION = 'a0b31403-fb2f-4dfe-a4c4-df3b76af6db2';
const projDir = join(ROOT, 'projects', '-tmp-run-acme__widget-42-sweet-r0');
mkdirSync(projDir, { recursive: true });

// A faithful transcript slice: the SAME assistant message is written once per content
// block (3x, then 2x, then 1x — this is what the real file looks like), interleaved with
// user tool_result rows that carry no usage, plus one all-zero row.
const row = (id, input, cRead, cCreate, out) => JSON.stringify({
  type: 'assistant', message: { id, role: 'assistant', usage: { input_tokens: input, cache_read_input_tokens: cRead, cache_creation_input_tokens: cCreate, output_tokens: out } },
});
writeFileSync(join(projDir, `${SESSION}.jsonl`), [
  row('gen-1', 3, 0, 16365, 68), row('gen-1', 3, 0, 16365, 68), row('gen-1', 3, 0, 16365, 68),
  JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }),
  row('gen-2', 3, 14963, 1488, 94), row('gen-2', 3, 14963, 1488, 94),
  row('gen-3', 3, 16451, 61, 38),
  row('gen-zero', 0, 0, 0, 0),                      // a zeroed row recovers nothing
  '', 'not json',
].join('\n') + '\n');

console.log('transcript recovery:');
const turns = turnsFromTranscript(ROOT, SESSION);
assert(turns.length === 3, 'one turn per DISTINCT message id, not per content block', `got ${turns.length}`);
// in = the FULL context at that turn: fresh + cache_read + cache_creation.
assert(turns[0].in === 16368 && turns[0].cached === 0 && turns[0].out === 68, 'turn 1 = fresh+read+create, cached=read', JSON.stringify(turns[0]));
assert(turns[1].in === 16454 && turns[1].cached === 14963 && turns[1].out === 94, 'turn 2 folds cache_creation into `in`', JSON.stringify(turns[1]));
assert(turns[2].in === 16515 && turns[2].cached === 16451, 'turn 3 context keeps growing', JSON.stringify(turns[2]));
assert(!turns.some(t => t.in === 0 && t.out === 0), 'an all-zero row is dropped, never logged as a real turn');
// The growing prefix is what makes cache-normalization meaningful at all.
assert(turns[0].in < turns[1].in && turns[1].in < turns[2].in, 'recovered turns form a growing prefix');

console.log('\nmissing inputs degrade, never throw:');
assert(turnsFromTranscript(ROOT, 'no-such-session').length === 0, 'unknown session id → empty');
assert(turnsFromTranscript(join(ROOT, 'nope'), SESSION).length === 0, 'missing claude home → empty');
assert(turnsFromTranscript(null, null).length === 0, 'null inputs → empty');

console.log('\nbreakPriced is published by the shared contract:');
const price = { in: 5.0, cache: 0.5, out: 30.0 };
const append = [{ in: 1000, cached: 0, out: 100 }, { in: 1500, cached: 800, out: 50 }, { in: 2200, cached: 1500, out: 30 }];
const c = costsFromTurns(append, price);
assert(c.breakPricedCostUsd != null, 'breakPricedCostUsd is present (was missing for opencode + claude-code)');
assert(c.contextRewrites === 0, 'append-only trajectory reports 0 context rewrites');
// Append-only can never break the prefix cache, so the two columns coincide BY CONSTRUCTION.
assert(approx(c.breakPricedCostUsd, c.idealCostUsd), 'append-only: breakPriced == ideal', `${c.breakPricedCostUsd} vs ${c.idealCostUsd}`);

// A shrinking context means something was deleted/reordered: every token after the hole
// re-pays the FULL input rate. idealCost cannot see this — that blindness nearly shipped
// an eviction lever that measured +7.7% saved while actually losing 12.3%.
const shrink = [{ in: 1000, cached: 0, out: 100 }, { in: 1500, cached: 800, out: 50 }, { in: 900, cached: 0, out: 30 }];
const s = costsFromTurns(shrink, price);
const expBrk = ((1000 * 5 + 100 * 30) + (500 * 5 + 1000 * 0.5 + 50 * 30) + (900 * 5 + 30 * 30)) / 1e6;
const expIdeal = ((1000 * 5 + 100 * 30) + (500 * 5 + 1000 * 0.5 + 50 * 30) + (900 * 0.5 + 30 * 30)) / 1e6;
assert(approx(s.breakPricedCostUsd, +expBrk.toFixed(6)), `shrunk context: breakPriced = ${expBrk.toFixed(6)}`, `got ${s.breakPricedCostUsd}`);
assert(approx(s.idealCostUsd, +expIdeal.toFixed(6)), `shrunk context: ideal = ${expIdeal.toFixed(6)}`, `got ${s.idealCostUsd}`);
assert(s.contextRewrites === 1, 'a shrunk context is counted as a rewrite', `got ${s.contextRewrites}`);
assert(s.breakPricedCostUsd > s.idealCostUsd, 'breakPriced exceeds ideal once the cache is broken — the whole point of the column');

rmSync(ROOT, { recursive: true, force: true });
console.log(ok ? '\nALL PASS' : '\nFAILED');
process.exit(ok ? 0 : 1);

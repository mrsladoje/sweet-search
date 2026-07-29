// Unit tests for idealCost recovery (ideal-cost.mjs) — the first-class rows.json
// cost column. Standalone: `node tests/ideal-cost.mjs` — exit 1 on fail.
// Covers: the per-turn cost math (shared with analyze-ab-smoke), rollout parsing,
// exact-cwd rollout matching with the mtime gate, and the no-rollout fallback.
import { costFromTurns, turnsFromRollout, rolloutCwd, findRolloutForRundir, recoverIdealCost, PRICE, MODEL_PRICES, priceFor } from '../harness/ideal-cost.mjs';
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let ok = true;
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const assert = (c, name, extra = '') => { console.log((c ? '  ✓ ' : '  ✗ ') + name + (c ? '' : '  ' + extra)); if (!c) ok = false; };

console.log('costFromTurns (per-turn ideal vs realized):');
// Turn1: 1000 all-new + 100 out. Turn2: context 1500 (500 new, 1000 re-sent), 800 cached, 50 out.
const turns = [{ in: 1000, cached: 0, out: 100 }, { in: 1500, cached: 800, out: 50 }];
// ideal: (1000*5 + 0*0.5 + 100*30)/1e6 + (500*5 + 1000*0.5 + 50*30)/1e6 = 0.008 + 0.0045 = 0.0125
// real : (1000*5 + 0*0.5 + 100*30)/1e6 + (700*5 + 800*0.5 + 50*30)/1e6 = 0.008 + 0.0054 = 0.0134
const c = costFromTurns(turns);
assert(approx(c.idealUsd, 0.0125), 'ideal = 0.0125', `got ${c.idealUsd}`);
assert(approx(c.realFromTurnsUsd, 0.0134), 'real  = 0.0134', `got ${c.realFromTurnsUsd}`);
// ideal never exceeds real when cache is imperfect (real charges uncached prefix at $5/M)
assert(c.idealUsd <= c.realFromTurnsUsd + 1e-12, 'ideal ≤ real (cache-normalized ≤ realized)');
// empty trajectory → zero
assert(costFromTurns([]).idealUsd === 0, 'empty turns → $0');
// PRICE surface intact
assert(PRICE.in === 5 && PRICE.cache === 0.5 && PRICE.out === 30, 'PRICE = {5, 0.5, 30}');

// --- per-model pricing (multi-backbone held-out run, 2026-07-17) ---
// Default arg keeps every existing call site on gpt-5.5 rates.
assert(costFromTurns(turns).idealUsd === costFromTurns(turns, PRICE).idealUsd, 'default price arg == PRICE');
// Sonnet 5 list rates: ideal = (1000*3 + 0*0.3 + 100*15)/1e6 + (500*3 + 1000*0.3 + 50*15)/1e6
//                            = 0.0045 + 0.00255 = 0.00705
const s5 = costFromTurns(turns, MODEL_PRICES['claude-sonnet-5']);
assert(approx(s5.idealUsd, 0.00705), 'sonnet-5 ideal = 0.00705', `got ${s5.idealUsd}`);
// ideal <= real must hold under ANY price vector (cache read is never dearer than input)
assert(s5.idealUsd <= s5.realFromTurnsUsd + 1e-12, 'sonnet-5 ideal <= real');
// Registered backbones price by name; cache read is 0.1x input for Anthropic models
assert(priceFor('claude-sonnet-5').in === 3.0 && priceFor('claude-sonnet-5').out === 15.0, 'sonnet-5 = $3/$15 per MTok');
assert(approx(priceFor('claude-sonnet-5').cache, 0.3), 'sonnet-5 cache read = 0.1x input');
// An UNREGISTERED backbone must throw, never silently inherit gpt-5.5's rates —
// mispriced idealCost distorts the efficiency-at-parity headline it feeds.
// (Use a name that cannot become a real backbone — this assertion previously used
// `x-ai/grok-4.5` and went red the day that model was registered.)
let threw = false;
try { priceFor('acme/not-a-real-backbone'); } catch { threw = true; }
assert(threw, 'unregistered model throws instead of defaulting');
// ...and every backbone we actually run must be priced.
for (const m of ['x-ai/grok-4.5', 'openai/gpt-5.5', 'anthropic/claude-sonnet-5', 'openai/gpt-5.6-luna']) {
  let priced = true; try { priceFor(m); } catch { priced = false; }
  assert(priced, `${m} is registered in MODEL_PRICES`);
}

console.log('\nrollout parsing + exact-cwd matching:');
const dir = mkdtempSync(path.join(tmpdir(), 'ic-')) ;
const sess = path.join(dir, 'sessions', '2026', '07', '09');
mkdirSync(sess, { recursive: true });
const rundir = '/root/.ss-eval/runs/foo__sweet__r0__7';
// a matching rollout with session_meta + two token_count events
const mk = (cwd, ts) => [
  JSON.stringify({ timestamp: '2026-07-09T00:00:00Z', type: 'session_meta', payload: { type: 'session_meta', cwd } }),
  JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100, reasoning_output_tokens: 0 } } } }),
  JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 1500, cached_input_tokens: 800, output_tokens: 40, reasoning_output_tokens: 10 } } } }),
].join('\n') + '\n';
const match = path.join(sess, 'rollout-match.jsonl');
writeFileSync(match, mk(rundir));
const other = path.join(sess, 'rollout-other.jsonl');
writeFileSync(other, mk('/root/.ss-eval/runs/bar__native__r0__3'));
// a stale file with the SAME cwd but modified BEFORE sinceMs — must be excluded by the mtime gate
const stale = path.join(sess, 'rollout-stale.jsonl');
writeFileSync(stale, mk(rundir));
const t0 = Date.now();
utimesSync(stale, new Date(t0 - 3600_000), new Date(t0 - 3600_000)); // 1h old

assert(rolloutCwd(match) === rundir, 'rolloutCwd reads session_meta.cwd');
// REGRESSION GUARD: the real session_meta line embeds the full agent system prompt
// (tens of KB) AFTER cwd — a truncated JSON.parse of a bounded read would fail, so
// rolloutCwd must regex cwd out of the (huge) first line without full parse.
const bigCwd = '/root/.ss-eval/runs/bigheader__sweet__r0__9';   // distinct cwd → won't collide with the match-selection test
const bigLine = JSON.stringify({ timestamp: 'x', type: 'session_meta', payload: { id: 'z', cwd: bigCwd, base_instructions: { text: 'You are Codex. ' + 'x'.repeat(80000) } } }) + '\n' +
  JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 500, cached_input_tokens: 0, output_tokens: 10 } } } }) + '\n';
const big = path.join(sess, 'rollout-biglineheader.jsonl');
writeFileSync(big, bigLine);
assert(rolloutCwd(big) === bigCwd, 'rolloutCwd handles a >64KB session_meta first line (system-prompt embed)');
const tp = turnsFromRollout(match);
assert(tp.length === 2 && tp[1].out === 50, 'turnsFromRollout: 2 turns, out folds reasoning (40+10=50)');
const found = findRolloutForRundir(rundir, { sinceMs: t0 - 60_000, sessionsDir: path.join(dir, 'sessions') });
assert(found === match, 'findRolloutForRundir picks exact-cwd, fresh file (not the other cwd, not the stale one)', `got ${found}`);
const rec = recoverIdealCost(rundir, { sinceMs: t0 - 60_000, sessionsDir: path.join(dir, 'sessions') });
assert(approx(rec.idealCostUsd, 0.0125) && rec.turns === 2 && rec.rolloutFile === match, 'recoverIdealCost matches costFromTurns + reports rolloutFile', JSON.stringify(rec));
// no rollout for an unknown rundir → graceful nulls (never throws)
const none = recoverIdealCost('/root/.ss-eval/runs/nope__sweet__r9__99', { sinceMs: t0 - 60_000, sessionsDir: path.join(dir, 'sessions') });
assert(none.idealCostUsd === null && none.rolloutFile === null, 'no rollout → null idealCost (fallback to realized)');

rmSync(dir, { recursive: true, force: true });
console.log(ok ? '\nALL PASS' : '\nFAILED');
process.exit(ok ? 0 : 1);

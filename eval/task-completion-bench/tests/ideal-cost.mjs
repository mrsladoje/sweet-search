// Unit tests for idealCost recovery (ideal-cost.mjs) — the first-class rows.json
// cost column. Standalone: `node tests/ideal-cost.mjs` — exit 1 on fail.
// Covers: the per-turn cost math (shared with analyze-ab-smoke), rollout parsing,
// exact-cwd rollout matching with the mtime gate, and the no-rollout fallback.
import { costFromTurns, turnsFromRollout, rolloutCwd, findRolloutForRundir, recoverIdealCost, PRICE, MODEL_PRICES, priceFor, LEDGER_BASIS, LEDGER_BASIS_LEGACY } from '../harness/ideal-cost.mjs';
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

// --- breakPricedUsd: cache-normalized AND aware that caching is a PREFIX cache (2026-08-10) ---
// Append-only context (every real run to date): identical to ideal, by construction. This is what
// makes the column safe to print by default — it can only differ once a lever rewrites context.
assert(approx(c.breakPricedUsd, c.idealUsd), 'append-only: breakPriced == ideal', `got ${c.breakPricedUsd}`);
assert(c.contextRewrites === 0, 'append-only: 0 context rewrites');

// A turn whose context SHRANK with no reported hole position: nothing is provably still cached,
// so the whole prefix re-prices at the full input rate. Deliberately pessimistic — an unreported
// rewrite must look expensive, not free.
const shrunk = costFromTurns([{ in: 1000, cached: 0, out: 0 }, { in: 600, cached: 500, out: 0 }]);
// ideal: (1000*5)/1e6 + (0*5 + 600*0.5)/1e6 = 0.005 + 0.0003 = 0.0053
// break: (1000*5)/1e6 + (600*5 + 0*0.5)/1e6 = 0.005 + 0.003  = 0.008
assert(approx(shrunk.idealUsd, 0.0053), 'shrunk: ideal = 0.0053', `got ${shrunk.idealUsd}`);
assert(approx(shrunk.breakPricedUsd, 0.008), 'shrunk: breakPriced = 0.0080 (whole prefix re-priced)', `got ${shrunk.breakPricedUsd}`);
assert(shrunk.breakPricedUsd > shrunk.idealUsd, 'shrunk: breakPriced > ideal (the cost ideal cannot see)');
assert(shrunk.contextRewrites === 1, 'shrunk: 1 context rewrite flagged');

// With holeAt reported, the surviving prefix before the hole stays cached and the cost is exact.
const holed = costFromTurns([{ in: 1000, cached: 0, out: 0 }, { in: 600, cached: 500, out: 0, holeAt: 400 }]);
// break: 0.005 + ((600-400)*5 + 400*0.5)/1e6 = 0.005 + 0.0012 = 0.0062
assert(approx(holed.breakPricedUsd, 0.0062), 'holeAt=400: breakPriced = 0.0062 (prefix before the hole survives)', `got ${holed.breakPricedUsd}`);
assert(holed.breakPricedUsd < shrunk.breakPricedUsd, 'reporting holeAt is cheaper than not reporting it');

// A hole can exist even when the context still GREW (evict 5k, append 8k) — the trigger is the
// hole, not the shrink. This is the eviction case that scored +7.7% on ideal while losing 12.3%.
const grewWithHole = costFromTurns([{ in: 1000, cached: 0, out: 0 }, { in: 1200, cached: 900, out: 0, holeAt: 300 }]);
assert(grewWithHole.breakPricedUsd > grewWithHole.idealUsd, 'grew-but-holed: breakPriced > ideal (hole, not shrink, is the trigger)');
assert(grewWithHole.contextRewrites === 1, 'grew-but-holed: rewrite flagged even though context grew');

// recoverIdealCost must carry the column through to the row (the default collection path).

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
assert(approx(rec.breakPricedCostUsd, 0.0125) && rec.contextRewrites === 0, 'recoverIdealCost emits breakPricedCostUsd + contextRewrites', JSON.stringify(rec));
// no rollout for an unknown rundir → graceful nulls (never throws)
const none = recoverIdealCost('/root/.ss-eval/runs/nope__sweet__r9__99', { sinceMs: t0 - 60_000, sessionsDir: path.join(dir, 'sessions') });
assert(none.idealCostUsd === null && none.rolloutFile === null && none.breakPricedCostUsd === null, 'no rollout → null idealCost AND null breakPriced (fallback to realized)');

// --- F1 / register G17: the cache-write surcharge, on all three runner shapes -------------
// The provider bills prompt-cache CREATION at 1.25x input. Before 2026-09-02 only the
// claude-code accounting module supplied a `cacheWrite` field, so codex and opencode paid
// plain input rate for the same tokens. Charging it everywhere moved the measured fresh-pool
// gap from +3.31% to +2.52% (opencode) and +0.35% to +0.06% (codex) — a quarter of the gap
// under discussion, so a runner that stops emitting the field is a silent ledger regression.
console.log('\ncache-write surcharge (G17), all three runner turn shapes:');
{
  // One turn, 1000 in, none cached, all of it a cache write. real should be 1000*5*1.25.
  const one = costFromTurns([{ in: 1000, cached: 0, cacheWrite: 1000, out: 0 }]);
  assert(approx(one.realFromTurnsUsd, 1000 * 5 * 1.25 / 1e6), 'all-new turn: real = in * 1.25x', `got ${one.realFromTurnsUsd}`);
  // ideal is cache-NORMALIZED and must not move: that is the whole point of the column.
  const base = costFromTurns([{ in: 1000, cached: 0, out: 0 }]);
  assert(approx(one.idealUsd, base.idealUsd), 'ideal is unchanged by cacheWrite (cache-normalized by construction)');
  assert(one.realFromTurnsUsd > base.realFromTurnsUsd, 'real IS changed by cacheWrite');
  assert(approx(one.breakPricedUsd, base.breakPricedUsd), 'breakPriced is unchanged by cacheWrite');

  // The three shapes each runner produces. Same numbers by construction: the surcharge is
  // 0.25 * price.in * cacheWrite over the no-surcharge basis, whatever the source field was.
  const shapes = {
    // codex: token_count -> last_token_usage.cache_write_input_tokens
    codex: [{ in: 2000, cached: 0, cacheWrite: 2000, out: 50 }, { in: 3000, cached: 1900, cacheWrite: 1100, out: 30 }],
    // opencode: step_finish -> tokens.cache.write, folded into `in` AND published separately
    opencode: [{ in: 2000, cached: 0, cacheWrite: 2000, out: 50 }, { in: 3000, cached: 1900, cacheWrite: 1100, out: 30 }],
    // claude-code: usage.cache_creation_input_tokens (already supplied since 2026-08)
    claudeCode: [{ in: 2000, cached: 0, cacheWrite: 2000, out: 50 }, { in: 3000, cached: 1900, cacheWrite: 1100, out: 30 }],
  };
  for (const [name, turns] of Object.entries(shapes)) {
    const withCw = costFromTurns(turns);
    const withoutCw = costFromTurns(turns.map(t => ({ ...t, cacheWrite: 0 })));
    const cwTok = turns.reduce((a, t) => a + t.cacheWrite, 0);
    const expected = withoutCw.realFromTurnsUsd + cwTok * PRICE.in * 0.25 / 1e6;
    assert(approx(withCw.realFromTurnsUsd, expected), `${name} shape: real = legacy + 0.25 * in-rate * cacheWrite`, `got ${withCw.realFromTurnsUsd} want ${expected}`);
  }

  // A runner that over-reports cache writes must not be able to bill more than the
  // uncached prompt: costFromTurns clamps cacheWrite to (in - cached) per turn.
  const over = costFromTurns([{ in: 1000, cached: 900, cacheWrite: 5000, out: 0 }]);
  const clamped = costFromTurns([{ in: 1000, cached: 900, cacheWrite: 100, out: 0 }]);
  assert(approx(over.realFromTurnsUsd, clamped.realFromTurnsUsd), 'cacheWrite is clamped to (in - cached), so an over-report cannot inflate the bill');
  // ...and a negative one cannot discount it.
  const neg = costFromTurns([{ in: 1000, cached: 0, cacheWrite: -500, out: 0 }]);
  assert(approx(neg.realFromTurnsUsd, base.realFromTurnsUsd), 'a negative cacheWrite is floored at 0');
}

// turnsFromRollout must carry codex's own cache-creation count through, or the codex arm
// silently sits on the old ledger while the other two sit on the new one.
{
  const cwDir = mkdtempSync(path.join(tmpdir(), 'ic-cw-'));
  const f = path.join(cwDir, 'rollout-cw.jsonl');
  writeFileSync(f, JSON.stringify({ type: 'session_meta', payload: { cwd: '/x' } }) + '\n'
    + JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 1200, cached_input_tokens: 200, cache_write_input_tokens: 900, output_tokens: 10 } } } }) + '\n');
  const t = turnsFromRollout(f);
  assert(t.length === 1 && t[0].cacheWrite === 900, 'turnsFromRollout carries cache_write_input_tokens', JSON.stringify(t));
  // absent field → 0, never undefined (an undefined would read as NaN downstream)
  const f2 = path.join(cwDir, 'rollout-nocw.jsonl');
  writeFileSync(f2, JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 1 } } } }) + '\n');
  assert(turnsFromRollout(f2)[0].cacheWrite === 0, 'absent cache_write_input_tokens → 0, not undefined');
  rmSync(cwDir, { recursive: true, force: true });
}

// LEDGER_BASIS is printed beside every cost figure; the two labels must stay distinct.
assert(LEDGER_BASIS === 'cache-write-1.25x-all-harnesses', 'LEDGER_BASIS names the current basis', LEDGER_BASIS);
assert(LEDGER_BASIS_LEGACY !== LEDGER_BASIS, 'the legacy basis label is distinct from the current one');

rmSync(dir, { recursive: true, force: true });
console.log(ok ? '\nALL PASS' : '\nFAILED');
process.exit(ok ? 0 : 1);

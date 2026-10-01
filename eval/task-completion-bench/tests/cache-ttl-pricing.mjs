// Cache-write pricing by TTL (ledger basis 'cache-write-by-ttl', 2026-10-01).
// Standalone: `node tests/cache-ttl-pricing.mjs` — exit 1 on fail. No model calls, no network.
//
// Anthropic bills a 5-minute cache write at 1.25x input and a 1-hour cache write at 2.0x. A Claude
// Code subscription writes at the 1-hour TTL, so the old flat 1.25x under-priced it. These tests
// pin: the split is priced per TTL; a record WITHOUT a split falls back to 1.25x and says so;
// the previous flat basis stays reproducible from the same turns; the split survives every hop
// from a usage record to a row (stream, transcript, aggregate, sidechains, turn log).
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  costFromTurns, cacheWriteSplit, cacheCreationSplit, LEDGER_BASIS, LEDGER_BASIS_FLAT_125, LEDGER_BASIS_LEGACY,
  CACHE_WRITE_MULT_5M, CACHE_WRITE_MULT_1H, priceFor,
} from '../harness/ideal-cost.mjs';
import { costsFromTurns } from '../harness/agent-runner-shared.mjs';
import {
  transcriptMetricsFromFile, claudeCosts, aggregateTurn, addSidechainCostsChecked, selectClaudeMainCosts,
} from '../harness/claude-code-accounting.mjs';
import { parseClaudeStream } from '../harness/claude-code-task-runner.mjs';
import { persistTurns, readTurnLog, turnsDir } from '../harness/turn-log.mjs';

let ok = true;
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const assert = (c, name, extra = '') => { console.log((c ? '  ✓ ' : '  ✗ ') + name + (c ? '' : '  ' + extra)); if (!c) ok = false; };

const P = priceFor('claude-opus-5-5');   // $4 in / $0.20 read / $20 out per 1M
assert(P.in === 4 && P.cache === 0.2 && P.out === 20, 'Opus 5.5 list price is $4 / $0.20 / $20', JSON.stringify(P));
assert(CACHE_WRITE_MULT_5M === 1.25 && CACHE_WRITE_MULT_1H === 2.0, 'multipliers: 5m = 1.25x, 1h = 2.0x');
assert(LEDGER_BASIS === 'cache-write-by-ttl', 'current ledger basis is cache-write-by-ttl', LEDGER_BASIS);
assert(new Set([LEDGER_BASIS, LEDGER_BASIS_FLAT_125, LEDGER_BASIS_LEGACY]).size === 3, 'the three basis labels are distinct');

console.log('\nper-turn pricing, 10000 written tokens, no cache read, no output:');
const turn = (extra) => [{ in: 10000, cached: 0, out: 0, ...extra }];
{
  const m5 = costFromTurns(turn({ cacheWrite: 10000, cacheWrite5m: 10000, cacheWrite1h: 0 }), P);
  assert(approx(m5.realFromTurnsUsd, 10000 * 4 * 1.25 / 1e6), '5m write = 1.25 x input = $0.05', String(m5.realFromTurnsUsd));
  assert(m5.cacheWriteTokens5m === 10000 && m5.cacheWriteTokens1h === 0 && m5.cacheWriteUnsplitTokens === 0, '5m write reports a clean split');

  const h1 = costFromTurns(turn({ cacheWrite: 10000, cacheWrite5m: 0, cacheWrite1h: 10000 }), P);
  assert(approx(h1.realFromTurnsUsd, 10000 * 4 * 2.0 / 1e6), '1h write = 2.0 x input = $0.08', String(h1.realFromTurnsUsd));
  assert(h1.cacheWriteTokens1h === 10000 && h1.cacheWriteUnsplitTokens === 0, '1h write reports 10000 1h tokens, 0 unsplit');
  assert(h1.realFromTurnsUsd > m5.realFromTurnsUsd, '1h costs more than 5m for the same tokens');
  assert(approx(h1.realFlat125Usd, m5.realFromTurnsUsd), 'the previous flat 1.25x basis is reproducible from a 1h row', String(h1.realFlat125Usd));

  const mix = costFromTurns(turn({ cacheWrite: 10000, cacheWrite5m: 3000, cacheWrite1h: 7000 }), P);
  assert(approx(mix.realFromTurnsUsd, (3000 * 4 * 1.25 + 7000 * 4 * 2.0) / 1e6), 'mixed split prices each part at its own rate', String(mix.realFromTurnsUsd));
  assert(mix.cacheWriteTokens5m === 3000 && mix.cacheWriteTokens1h === 7000, 'mixed split is counted per TTL');
}

console.log('\nfallback when the record has no split:');
{
  const none = costFromTurns(turn({ cacheWrite: 10000 }), P);
  assert(approx(none.realFromTurnsUsd, 10000 * 4 * 1.25 / 1e6), 'no split -> 1.25x', String(none.realFromTurnsUsd));
  assert(none.cacheWriteUnsplitTokens === 10000, 'no split -> all 10000 tokens flagged as unsplit', String(none.cacheWriteUnsplitTokens));
  assert(approx(none.realFlat125Usd, none.realFromTurnsUsd), 'no split -> by-TTL and flat 1.25x agree');

  const part = costFromTurns(turn({ cacheWrite: 10000, cacheWrite5m: 0, cacheWrite1h: 6000 }), P);
  assert(part.cacheWriteUnsplitTokens === 4000 && part.cacheWriteTokens1h === 6000, 'split that covers 6000 of 10000 flags the other 4000 as unsplit', JSON.stringify(part));
  assert(approx(part.realFromTurnsUsd, (6000 * 4 * 2.0 + 4000 * 4 * 1.25) / 1e6), 'the unsplit remainder is priced at 1.25x', String(part.realFromTurnsUsd));

  const nocw = costFromTurns(turn({}), P);
  assert(nocw.cacheWriteUnsplitTokens === 0 && approx(nocw.realFromTurnsUsd, 10000 * 4 / 1e6), 'a turn with no cache write at all is plain input, nothing flagged');

  const split = cacheWriteSplit({ in: 10000, cached: 9000, cacheWrite: 5000, cacheWrite1h: 5000 });
  assert(split.total === 1000, 'cache write is clamped to the uncached part of the context', JSON.stringify(split));
}

console.log('\nread and output are unchanged by the basis:');
{
  const t = [{ in: 20000, cached: 12000, cacheWrite: 8000, cacheWrite1h: 8000, out: 500 }];
  const c = costFromTurns(t, P);
  assert(approx(c.realFromTurnsUsd, (12000 * 0.2 + 8000 * 4 * 2.0 + 500 * 20) / 1e6), 'read at the cache rate, write at 2.0x, output at the output rate', String(c.realFromTurnsUsd));
  const flat = costFromTurns([{ ...t[0], cacheWrite1h: undefined }], P);
  assert(approx(c.idealUsd, flat.idealUsd) && approx(c.breakPricedUsd, flat.breakPricedUsd), 'ideal and breakPriced columns do not move with the write TTL');
}

console.log('\nrow columns (costsFromTurns):');
{
  const t = [
    { in: 18000, cached: 0, cacheWrite: 18000, cacheWrite5m: 0, cacheWrite1h: 18000, out: 100 },
    { in: 19000, cached: 18000, cacheWrite: 1000, cacheWrite5m: 1000, cacheWrite1h: 0, out: 50 },
    { in: 20000, cached: 19000, cacheWrite: 1000, out: 50 },   // an unsplit record
  ];
  const c = costsFromTurns(t, P);
  assert(c.ledgerBasis === 'cache-write-by-ttl', 'row names the by-ttl basis');
  assert(c.cacheWriteTokens === 20000 && c.cacheWriteTokens1h === 18000 && c.cacheWriteTokens5m === 1000 && c.cacheWriteUnsplitTokens === 1000,
    'row carries the total, the split and the unsplit remainder', JSON.stringify(c));
  assert(c.costRealizedUsd > c.costRealizedFlat125Usd, 'by-TTL realized cost exceeds the flat 1.25x restatement when 1h writes exist');
  assert(c.costRealizedFlat125Usd > c.costRealizedNoCacheWriteUsd, 'the flat restatement exceeds the legacy no-write-surcharge column');
  // legacy basis still reproducible: cacheWrite zeroed means plain input rate on those tokens
  const legacy = costsFromTurns(t.map(x => ({ ...x, cacheWrite: 0, cacheWrite5m: 0, cacheWrite1h: 0 })), P);
  assert(approx(c.costRealizedNoCacheWriteUsd, legacy.costRealizedUsd), 'costRealizedNoCacheWriteUsd still reproduces the claudecode-only basis');
}

console.log('\nfrom a usage record to a priced turn:');
{
  const dir = mkdtempSync(path.join(tmpdir(), 'cache-ttl-'));
  const usage = (extra = {}) => ({ input_tokens: 2, cache_creation_input_tokens: 7692, cache_read_input_tokens: 9942, output_tokens: 73,
    cache_creation: { ephemeral_1h_input_tokens: 7692, ephemeral_5m_input_tokens: 0 }, ...extra });
  assert(JSON.stringify(cacheCreationSplit(usage())) === JSON.stringify({ cacheWrite5m: 0, cacheWrite1h: 7692 }), 'cacheCreationSplit reads the split');
  assert(cacheCreationSplit({ cache_creation_input_tokens: 5 }) === null, 'cacheCreationSplit is null when the record has no split');

  // transcript: a real Claude Code record shape (two records for one request id, one zeroed)
  const f = path.join(dir, 's.jsonl');
  writeFileSync(f, [
    { message: { role: 'assistant', id: 'm1', content: [{ type: 'thinking', thinking: '' }], usage: { input_tokens: 0, output_tokens: 0 } } },
    { message: { role: 'assistant', id: 'm1', content: [{ type: 'text', text: 'ok' }], usage: usage() } },
    { message: { role: 'assistant', id: 'm2', content: [{ type: 'text', text: 'done' }],
      usage: { input_tokens: 3, cache_creation_input_tokens: 100, cache_read_input_tokens: 17634, output_tokens: 9 } } },   // no split
  ].map(o => JSON.stringify(o)).join('\n') + '\n');
  const m = transcriptMetricsFromFile(f);
  assert(m.turns.length === 2, 'transcript yields one turn per request id', String(m.turns.length));
  assert(m.turns[0].cacheWrite1h === 7692 && m.turns[0].cacheWrite5m === 0, 'transcript turn carries the 1h split', JSON.stringify(m.turns[0]));
  assert(m.turns[1].cacheWrite1h === undefined, 'a record without a split carries none (no invented split)');
  const c = costsFromTurns(m.turns, P);
  assert(c.cacheWriteTokens1h === 7692 && c.cacheWriteUnsplitTokens === 100, 'transcript row: 7692 1h tokens, 100 unsplit', JSON.stringify(c));

  // stream-json: assistant event usage
  const ev = JSON.stringify({ type: 'assistant', session_id: 's', message: { id: 'a', role: 'assistant', content: [{ type: 'text', text: 'hi' }], usage: usage() } });
  const parsed = parseClaudeStream(ev);
  assert(parsed.turns[0]?.cacheWrite1h === 7692 && parsed.turns[0]?.cacheWrite === 7692, 'stream turn carries the 1h split', JSON.stringify(parsed.turns[0]));

  // aggregate-only (no per-turn record): the split in result.usage is honoured too
  const agg = { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 5000, output_tokens: 100,
    cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 4000 } };
  const ac = claudeCosts(agg, P);
  assert(approx(ac.costRealizedUsd, (10 * 4 + 1000 * 4 * 1.25 + 4000 * 4 * 2.0 + 1000 * 0.2 + 100 * 20) / 1e6), 'aggregate-only cost prices the split by TTL', String(ac.costRealizedUsd));
  const noSplit = claudeCosts({ ...agg, cache_creation: undefined }, P);
  assert(approx(noSplit.costRealizedUsd, (10 * 4 + 5000 * 4 * 1.25 + 1000 * 0.2 + 100 * 20) / 1e6), 'aggregate-only cost with no split falls back to 1.25x', String(noSplit.costRealizedUsd));
  assert(aggregateTurn(agg)[0].cacheWrite1h === 4000, 'aggregateTurn persists the split');

  // sidechains: the new columns add across contexts
  const mainTurns = [{ in: 1000, cached: 0, cacheWrite: 1000, cacheWrite1h: 1000, out: 10 }];
  const sideTurns = [{ in: 2000, cached: 0, cacheWrite: 2000, cacheWrite5m: 2000, out: 10 }];
  const sel = selectClaudeMainCosts({ streamTurns: mainTurns, transcriptTurns: [], price: P,
    resultUsage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 1000, output_tokens: 10 } });
  const total = addSidechainCostsChecked(sel.costs, [{ name: 's.jsonl', turns: sideTurns, instrumentationComplete: true, assistantMessages: 1, usageMessages: 1 }], P);
  assert(total.cacheWriteTokens1h === 1000 && total.cacheWriteTokens5m === 2000 && total.cacheWriteTokens === 3000, 'sidechain inclusive row sums the TTL split', JSON.stringify(total));
  assert(approx(total.costRealizedFlat125Usd, (1000 * 4 * 1.25 + 10 * 20 + 2000 * 4 * 1.25 + 10 * 20) / 1e6), 'sidechain inclusive flat restatement sums both contexts', String(total.costRealizedFlat125Usd));

  // turn log round trip keeps the split so later repricing is exact
  process.env.RUN_ID = `cache-ttl-test-${process.pid}`;
  const file = persistTurns('x', mainTurns.concat(sideTurns), { source: 'test' });
  const back = readTurnLog(file).turns;
  assert(back[0].cacheWrite1h === 1000 && back[1].cacheWrite5m === 2000 && back[0].cacheWrite5m === undefined, 'turn log keeps the split and adds none that was absent', JSON.stringify(back));
  try { rmSync(path.dirname(turnsDir()), { recursive: true, force: true }); } catch { /* */ }
  rmSync(dir, { recursive: true, force: true });
}

console.log(ok ? '\nALL PASS' : '\nFAILED');
process.exit(ok ? 0 : 1);

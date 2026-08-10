// $0 EXPOSURE GATE for the tool-doc trim (preamble-trim lever, half 1 of 2).
// Standalone: `node tests/tooldoc-trim-gate.mjs` — exit 1 on fail. Spends nothing.
//
// CONTEXT. The lever-#3 eviction gate found that the sweet arm's re-sent preamble is exactly
// +1457 tokens larger than native's, carried on EVERY request = 4.1% of the sweet arm's ideal
// spend. That block is the memory-file M±: ~87% ss-* TOOL DOCS, ~13% the general `## Fix
// discipline` guidance. Only the tool docs are in scope here. The guidance block is deliberately
// general and tuned; it is NOT trimmed, and this gate asserts it is byte-identical to the parent.
//
// WHAT THIS GATE PROVES ($0, before any live cell):
//   1. the trimmed doc renders through the REAL harness path (FRAME_OPEN + M± + FRAME_CLOSE)
//   2. every ss-* tool still has a usable signature AND a concrete example
//   3. no tool, mode or flag was removed — the user-facing product shape is untouched
//   4. no behavioural rule was dropped — every rule in the inventory still matches
//   5. `## Fix discipline` is byte-identical
//   6. the honest token/$ delta, using the tokenizer slope measured from real rollouts
//
// WHAT IT CANNOT PROVE: that shorter docs do not degrade tool use. That is a SOLVE-safety
// question and needs a live smoke with zero solve regression in both arms. This gate is the
// precondition for authorising that smoke, never a substitute for it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRAME_OPEN } from '../harness/codex-task-runner.mjs';
import { FRAME_CLOSE } from '../harness/api-task-runner.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const BASE = path.join(ROOT, 'core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md');
const TRIM = path.join(ROOT, 'core/prompt-optimization/data/p7-turnfix-variants/sweet-search-system-prompt.trim1-tooldocs.md');

// tokens/byte for agent-text, fitted from 692 real turn-deltas across 68 codex rollouts
// (stats/resend-census.mjs calibration: agentB = 0.2254 tok/B). Not a 4-chars-per-token guess.
const TOK_PER_BYTE = 0.2254;
const LUNA = { in: 0.10e-6, cache: 0.01e-6 };
const MEAN_REQS_PER_ROLLOUT = 11.6;      // measured, postfix-screen17 sweet arm
const SWEET_IDEAL_PER_ROLLOUT = 0.24949 / 34;

let ok = true;
const assert = (c, name, extra = '') => { console.log((c ? '  ✓ ' : '  ✗ ') + name + (c && !extra ? '' : '  ' + extra)); if (!c) ok = false; };

const strip = s => s.replace(/^---\n[\s\S]*?\n---\n/, '');
const baseText = strip(readFileSync(BASE, 'utf8'));
const trimText = strip(readFileSync(TRIM, 'utf8'));

// ---------------------------------------------------------------- 1. real render path
// Exactly what codex-task-runner.mjs appends to <rundir>/AGENTS.md for the sweet arm.
const render = (mpp) => `${FRAME_OPEN}\n\n${mpp}\n\n${FRAME_CLOSE}`;
const baseRender = render(baseText), trimRender = render(trimText);
console.log('1. renders through the real harness path (FRAME_OPEN + M± + FRAME_CLOSE):');
assert(baseRender.includes(FRAME_OPEN) && baseRender.includes(FRAME_CLOSE), 'baseline renders inside the frame');
assert(trimRender.includes(FRAME_OPEN) && trimRender.includes(FRAME_CLOSE), 'trimmed renders inside the frame');
assert(trimRender.includes('# Sweet-search — code search tool guide'), 'trimmed M± body present in the rendered file');
// the frame must still own task completion (it brackets M± for exactly that reason)
assert(trimRender.indexOf(FRAME_CLOSE) > trimRender.indexOf('# Sweet-search'), 'FRAME_CLOSE still follows M± (completion authority preserved)');

// ---------------------------------------------------------------- 2+3. tools intact
const TOOLS = [
  { name: 'ss-search', sig: /^- `ss-search "<query>" \[-k N\]`/m, example: /`ss-search "[^"]+"`/ },
  { name: 'ss-find', sig: /^- `ss-find "<query>" --regex "<regex>" \[-k N\]`/m, example: /`ss-find "[^"]+" --regex "[^`]+"`/ },
  { name: 'ss-grep', sig: /^- `ss-grep "<regex>" \[-k N\]`/m, example: /`ss-grep "[^"]+"`/ },
  { name: 'ss-semantic', sig: /^- `ss-semantic <file> "<query>"`/m, example: /`ss-semantic \S+ "[^"]+"`/ },
  { name: 'ss-trace', sig: /^- `ss-trace <symbol> \[callers\|callees\|impact\] \[--in <file>\]`/m, example: /`ss-trace \w+ (callers|callees|impact)`/ },
  { name: 'ss-read', sig: /^- `ss-read <file> \[start\] \[end\]`/m, example: /`ss-read \S+ \d+ \d+`/ },
];
console.log('\n2. every tool keeps a usable signature AND a concrete example:');
for (const t of TOOLS) {
  assert(t.sig.test(trimText), `${t.name}: signature present and unchanged`);
  assert(t.example.test(trimText), `${t.name}: concrete example present`);
}
console.log('\n3. product shape untouched (no tool/mode/flag removed):');
const baseTools = [...baseText.matchAll(/\bss-[a-z]+\b/g)].map(m => m[0]);
const trimTools = [...trimText.matchAll(/\bss-[a-z]+\b/g)].map(m => m[0]);
const missing = [...new Set(baseTools)].filter(t => !trimTools.includes(t));
assert(missing.length === 0, 'no ss-* tool disappeared', missing.join(','));
assert(/\[callers\|callees\|impact\]/.test(trimText), 'ss-trace keeps all three modes');
for (const flag of ['-k N', '--regex', '--in']) assert(trimText.includes(flag), `flag "${flag}" retained`);

// ---------------------------------------------------------------- 4. no behavioural rule dropped
// One entry per behavioural instruction the parent doc issues. Wording may change; the RULE
// must still be expressed. A dropped rule is a product change, not a trim.
const RULES = [
  ['search rules never decide task completion', /never decide when the task is done/],
  ['apply the edit, never describe it', /never a description of the fix in place of the fix/],
  ['index covers the working tree incl. uncommitted', /indexes the working tree \(uncommitted edits too\)/],
  ['use ss-* for all search/navigation', /Use the `ss-\*` tools for all code search and navigation/],
  ['raw shell only for seconds-old edits', /too recent to be reconciled \(seconds old\)/],
  ['never re-run an ss-* hit as raw grep', /Never re-run an `ss-\*` hit as raw grep/],
  ['sub-agents inherit this prompt verbatim', /sub-agent you delegate to must use these `ss-\*` tools/],
  ['exact token -> one ss-grep/ss-find, trust top hit', /Trust the top hit and stop/],
  ['autogenerated top hit -> follow to real source', /follow it to the real source it is generated from/],
  ['concept -> one ss-search, then anchor', /one `ss-search` in natural language[\s\S]{0,60}?then anchor on the symbol that surfaces/],
  ['query shaping by language', /short and interrogative for JS\/TS\/Dart/],
  ['flow/impact -> anchor then ss-trace', /then `ss-trace` it — one call returns callers, callees and impact/],
  ['prefer callees over impact', /Prefer callees over impact/],
  ['sparse trace -> anchor downstream, do not hand-crawl', /rather than retrying or hand-crawling/],
  ['ss-trace is not the spine of multi-file search', /never make `ss-trace` the spine of a multi-file search/],
  ['sufficient=YES -> trust outright, at most one ss-read', /On `sufficient=YES`, trust the top ranked result outright/],
  ['otherwise scan the pack before re-searching', /scan the rest of the pack you already have/],
  ['winner is often rank 2-3', /the winner is often rank 2-3/],
  ['multi-file: chain inside the tools', /Chain inside the tools/],
  ['trace complete when the link is nameable', /The trace is COMPLETE the moment you can name the link/],
  ['do not chase leaf bodies / next hop', /Leaf bodies, macro expansions, and the next hop down are not the answer/],
  ['absence settled by TWO complementary empty probes', /absence is settled once TWO complementary index probes come back empty/],
  ['plausible-but-off-target result is a decoy', /is the decoy, not a lead/],
  ['state the negative and stop, no third synonym', /no third synonym/],
  ['state_summary before the third probe', /output a `<state_summary>` block/],
  ['stop the instant evidence answers the question', /Stop searching the instant your evidence answers/],
  ['name files+symbols or no-match', /or `no-match`/],
  ['siblings -> ONE mapping call before editing', /spend ONE mapping call/],
  ['read the edited function to its end', /Read the function you edit to its end/],
  ['single-site edits skip the mapping call', /Single-site edits skip this/],
];
console.log(`\n4. behavioural rule inventory (${RULES.length} rules, each must survive the trim):`);
let dropped = 0;
for (const [label, re] of RULES) {
  const inBase = re.test(baseText), inTrim = re.test(trimText);
  if (!inBase) { assert(false, `RULE INVENTORY STALE — not in parent: ${label}`); continue; }
  if (!inTrim) { dropped++; assert(false, `DROPPED: ${label}`); }
}
assert(dropped === 0, `all ${RULES.length} rules survive`, dropped ? `${dropped} dropped` : '');

// ---------------------------------------------------------------- 5. guidance block untouched
console.log('\n5. `## Fix discipline` (the general M± guidance) is byte-identical:');
const fixOf = t => { const i = t.indexOf('## Fix discipline'); return i < 0 ? null : t.slice(i).trim(); };
const bFix = fixOf(baseText), tFix = fixOf(trimText);
assert(bFix != null && tFix != null, 'Fix discipline block present in both');
assert(bFix === tFix, 'Fix discipline byte-identical (NOT trimmed, by instruction)',
  bFix === tFix ? '' : `base ${bFix?.length}B vs trim ${tFix?.length}B`);

// ---------------------------------------------------------------- 6. the honest delta
const bB = Buffer.byteLength(baseText, 'utf8'), tB = Buffer.byteLength(trimText, 'utf8');
const bTok = bB * TOK_PER_BYTE, tTok = tB * TOK_PER_BYTE;
const savedTok = bTok - tTok;
// carried once at the new-token rate, then re-sent every subsequent request of the rollout
const savedPerRollout = savedTok * LUNA.in + savedTok * (MEAN_REQS_PER_ROLLOUT - 1) * LUNA.cache;
const pctOfSweet = 100 * savedPerRollout / SWEET_IDEAL_PER_ROLLOUT;
console.log('\n6. measured delta (tokenizer slope fitted from 692 real turn-deltas):');
console.log(`   baseline ${bB} B ≈ ${Math.round(bTok)} tok   trimmed ${tB} B ≈ ${Math.round(tTok)} tok`);
console.log(`   saved ${Math.round(savedTok)} tok = ${(100 * savedTok / bTok).toFixed(1)}% of the M± block`);
console.log(`   projected: $${savedPerRollout.toFixed(6)}/rollout = ${pctOfSweet.toFixed(2)}% of the sweet arm's ideal spend`);
console.log(`   (the whole M± block is worth 4.1%; the un-evictable frame tax it sits in is 18.0%)`);
// decompose: the gate REQUIRES a concrete example per tool, which costs bytes back. Report both
// halves so the saving is not overstated.
const exampleBytes = [...trimText.matchAll(/ — [^\n]*?\. (`ss-[^`]+`)$/gm)].reduce((a, m) => a + Buffer.byteLength(m[1], 'utf8') + 2, 0);
const redundancyBytes = (bB - tB) + exampleBytes;
console.log(`   decomposition: redundancy removed ${redundancyBytes} B (${Math.round(redundancyBytes * TOK_PER_BYTE)} tok)`
  + `, concrete examples added back ${exampleBytes} B (${Math.round(exampleBytes * TOK_PER_BYTE)} tok)`);
const ceilingTok = redundancyBytes * TOK_PER_BYTE;
const ceilingPct = 100 * (ceilingTok * LUNA.in + ceilingTok * (MEAN_REQS_PER_ROLLOUT - 1) * LUNA.cache) / SWEET_IDEAL_PER_ROLLOUT;
console.log(`   CEILING if the examples were skipped entirely: ${ceilingPct.toFixed(2)}% of the sweet arm's ideal spend`);
console.log(`   NOISE FLOOR for comparison: aggregate cost is +-37% at n~19. Both figures are ~2 orders below it.`);
assert(savedTok > 0, 'trim is a net reduction', `${Math.round(savedTok)} tok`);

console.log(ok ? '\nGATE PASS' : '\nGATE FAIL');
process.exit(ok ? 0 : 1);

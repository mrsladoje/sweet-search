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
import {
  turnsFromTranscript, sidechainTurnSets, addSidechainCosts,
  addSidechainCostsChecked, aggregateUsageFromTurns, recoveredTurnsMatchAggregate,
  recoveredTurnsCoverAggregate,
  buildClaudeCliArgs, installClaudeReadPagesNormalizer, parseClaudeStream,
  selectClaudeMainCosts, READ_PAGES_TOOL_NOTE,
} from '../harness/claude-code-task-runner.mjs';
import { transcriptMetricsFromFile, repOfSlug } from '../harness/claude-code-accounting.mjs';
import { normalizeReadInput, readHookDecision } from '../harness/claude-read-pages-hook.mjs';
import { costsFromTurns } from '../harness/agent-runner-shared.mjs';
import { readTurnLog } from '../harness/turn-log.mjs';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
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
const row = (id, input, cRead, cCreate, out, content = []) => JSON.stringify({
  type: 'assistant', message: { id, role: 'assistant', content,
    usage: { input_tokens: input, cache_read_input_tokens: cRead, cache_creation_input_tokens: cCreate, output_tokens: out } },
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
assert(turns[0].cacheWrite === 16365 && turns[1].cacheWrite === 1488,
  'cache creation remains a first-class per-turn field', JSON.stringify(turns.slice(0, 2)));
assert(turns[2].in === 16515 && turns[2].cached === 16451, 'turn 3 context keeps growing', JSON.stringify(turns[2]));
assert(!turns.some(t => t.in === 0 && t.out === 0), 'an all-zero row is dropped, never logged as a real turn');
// The growing prefix is what makes cache-normalization meaningful at all.
assert(turns[0].in < turns[1].in && turns[1].in < turns[2].in, 'recovered turns form a growing prefix');

// ---------------------------------------------------------------------------
// THE SPLIT-RECORD DEFECT (found 2026-08-13, invisible to the fixture above).
//
// The slice above writes the SAME usage on every record of a message, so reading only the
// first record happened to be right. Real transcripts do not look like that: the first
// record is frequently a `redacted_thinking` block carrying ZEROED usage, and a LATER
// record for the same id carries the real numbers. First-record-wins therefore dropped the
// whole request — 76 of 235 and 67 of 156 delegated requests on the two retained claude
// runs — and one dropped delegated request nulls a row's entire inclusive cost.
//
// Verified before this fix shipped: across 1,939 ids with more than one non-zero record,
// ZERO disagreed on any token category, so taking the usage-bearing record is exact.
// ---------------------------------------------------------------------------
console.log('\nsplit-record usage recovery:');
const blockRow = (id, content, usage) => JSON.stringify({
  type: 'assistant', message: { id, role: 'assistant', content, usage },
});
const ZERO = { input_tokens: 0, cache_read_input_tokens: null, cache_creation_input_tokens: null, output_tokens: 0 };
const REAL = { input_tokens: 3, cache_read_input_tokens: 900, cache_creation_input_tokens: 100, output_tokens: 55 };
const splitDir = join(ROOT, 'projects', '-tmp-run-split');
mkdirSync(splitDir, { recursive: true });
const SPLIT = 'b1c2d3e4-0000-4000-8000-000000000001';
writeFileSync(join(splitDir, `${SPLIT}.jsonl`), [
  // zeroed FIRST, real usage on a later record for the same id
  blockRow('gen-split', [{ type: 'redacted_thinking', data: 'xxxx' }], ZERO),
  blockRow('gen-split', [{ type: 'text', text: 'twelve chars' }], ZERO),
  blockRow('gen-split', [{ type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'ls -la' } }], REAL),
  // every record zeroed — genuinely unrecoverable, must stay excluded
  blockRow('gen-dark', [{ type: 'redacted_thinking', data: 'yyyy' }], ZERO),
  blockRow('gen-dark', [{ type: 'text', text: 'seven!!' }], ZERO),
].join('\n') + '\n');
const split = transcriptMetricsFromFile(join(splitDir, `${SPLIT}.jsonl`));
assert(split.turns.length === 1,
  'a request whose usage arrives on a LATER record is recovered, not dropped', JSON.stringify(split.turns));
assert(split.turns[0]?.in === 1003 && split.turns[0]?.out === 55 && split.turns[0]?.cacheWrite === 100,
  'the recovered turn carries the real token counts', JSON.stringify(split.turns[0]));
assert(split.assistantMessages === 2 && split.usageMessages === 1,
  'the all-zero request still counts as a request with no usage', JSON.stringify(split));
assert(split.instrumentationComplete === false,
  'a genuinely unrecoverable request still fails instrumentation closed');
assert(split.retainedOutputChars === 12 + 6 + 7,
  'content is unioned across every record of a request, not read from the first only',
  `got ${split.retainedOutputChars}`);
assert(split.payloads.includes('ls -la'),
  'a tool payload written on a later record still reaches the degeneration detector');
assert(split.repeatedToolUseBlocks === 0, 'append-only writer trips no cumulative-format tripwire');
// The tripwire itself: a cumulative writer repeating a tool_use id must not double-count.
writeFileSync(join(splitDir, 'cumulative.jsonl'), [
  blockRow('gen-cum', [{ type: 'tool_use', id: 'tu-9', name: 'Bash', input: { command: 'echo hi' } }], REAL),
  blockRow('gen-cum', [{ type: 'tool_use', id: 'tu-9', name: 'Bash', input: { command: 'echo hi' } },
    { type: 'text', text: 'tail' }], REAL),
].join('\n') + '\n');
const cum = transcriptMetricsFromFile(join(splitDir, 'cumulative.jsonl'));
assert(cum.repeatedToolUseBlocks === 1, 'a repeated tool_use id trips the cumulative-format tripwire');
assert(cum.retainedOutputChars === 'echo hi'.length + 'tail'.length,
  'a repeated block is counted once, so a format change cannot silently double the totals',
  `got ${cum.retainedOutputChars}`);

// ---------------------------------------------------------------------------
// RUN-DIRECTORY NAMING (2026-08-13). The rundir IS the agent's cwd and the harness puts it
// in the system prompt, so its name is a string the model must transcribe exactly whenever a
// tool wants an absolute path. The old `<task>__<arm>__r<rep>__<n>` form cost 12.66% of
// native's claude spend and 5.29% of sweet's in `File does not exist` retries — 45 of 54
// failures carried a mangled run-directory segment and only 1 was a path any tool had
// printed, so both arms were INVENTING it. It also leaked the arm into the agent's own cwd.
// The name is now short and arm-blind; BOTH slug forms must still resolve, because retained
// runs keep the old one.
// ---------------------------------------------------------------------------
console.log('\nrun-directory slug decoding:');
assert(repOfSlug('-root--ss-eval-runs-pytask-dev--pytask-210--sweet--r0--51') === 0,
  'retained long-form slug still yields its rep');
assert(repOfSlug('-root--ss-eval-runs-akinsho--nvim-bufferline-lua-173--native--r1--26') === 1,
  'retained long-form slug with hyphenated task still yields its rep');
assert(repOfSlug('-root--ss-eval-runs-r0-51') === 0, 'short arm-blind slug yields its rep');
assert(repOfSlug('-root--ss-eval-runs-r1-7') === 1, 'short arm-blind slug, second rep');
assert(repOfSlug('-root--ss-eval-runs-r12-345') === 12, 'multi-digit rep and counter decode');
assert(repOfSlug('-root--ss-eval-runs-nonsense') === null, 'an undecodable slug yields null, never 0');
assert(repOfSlug(undefined) === null, 'a missing slug yields null, never throws');
// The whole point of the rename: nothing in the path may tell a rollout which arm it is.
const shortName = (rep, n) => `r${rep}-${n}`;
assert(!/sweet|native/i.test(shortName(0, 51)),
  'the run-directory name never reveals the arm — an arm-conditioned agent is forbidden');
assert(shortName(0, 51).length <= 8,
  'the run-directory name stays short enough to transcribe', shortName(0, 51));

console.log('\nmissing inputs degrade, never throw:');
assert(turnsFromTranscript(ROOT, 'no-such-session').length === 0, 'unknown session id → empty');
assert(turnsFromTranscript(join(ROOT, 'nope'), SESSION).length === 0, 'missing claude home → empty');
assert(turnsFromTranscript(null, null).length === 0, 'null inputs → empty');

console.log('\nauthoritative aggregate output accounting:');
const streamed = [
  JSON.stringify({ type: 'assistant', session_id: SESSION, message: {
    usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 },
    content: [{ type: 'text', text: 'retained' }],
  } }),
  JSON.stringify({ type: 'result', session_id: SESSION, subtype: 'success', num_turns: 1,
    usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30, output_tokens: 777 } }),
].join('\n');
const parsedStream = parseClaudeStream(streamed);
assert(parsedStream.billedOutputTokens === 777,
  'final result aggregate supplies billed output when assistant usage is zero', JSON.stringify(parsedStream));
assert(parsedStream.billedOutputSource === 'result-aggregate',
  'output accounting records the authoritative aggregate source');
const mismatchedStream = parseClaudeStream([
  JSON.stringify({ type: 'assistant', message: { usage: {
    input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 5,
  }, content: [] } }),
  JSON.stringify({ type: 'result', usage: { output_tokens: 17 } }),
].join('\n'));
assert(mismatchedStream.billedOutputTokens === 17,
  'final aggregate overrides a partial non-zero assistant-event sum');

const aggregateAllCosts = (u) => (
  (u.input_tokens * 5 + u.cache_creation_input_tokens * 5 * 1.25
   + u.cache_read_input_tokens * 0.5 + u.output_tokens * 30) / 1e6);

console.log('\nper-turn recovery completeness:');
const completeUsage = aggregateUsageFromTurns(turns);
assert(recoveredTurnsMatchAggregate(turns, completeUsage),
  'exact per-turn category totals reproduce the final aggregate');
assert(!recoveredTurnsMatchAggregate(turns.slice(0, 2), completeUsage),
  'partial non-zero turn recovery fails closed');
assert(!recoveredTurnsMatchAggregate(turns, { ...completeUsage, output_tokens: completeUsage.output_tokens + 1 }),
  'an output mismatch fails closed');
assert(!recoveredTurnsMatchAggregate(turns, { output_tokens: completeUsage.output_tokens }),
  'missing aggregate categories fail closed');
const exactSelection = selectClaudeMainCosts({
  streamTurns: turns, transcriptTurns: [], resultUsage: completeUsage, price: { in: 5, cache: 0.5, out: 30 },
});
assert(exactSelection.source === 'stream' && exactSelection.costs.idealCostUsd != null,
  'complete stream recovery keeps normalized per-turn pricing');
const transcriptSelection = selectClaudeMainCosts({
  streamTurns: turns.slice(0, 1), transcriptTurns: turns, resultUsage: completeUsage,
  price: { in: 5, cache: 0.5, out: 30 },
});
assert(transcriptSelection.source === 'transcript' && transcriptSelection.costs.idealCostUsd != null,
  'a partial stream falls through to an exact transcript');
// --- the aggregate omits a served request (measured 2026-08-12) ---
// harness-smoke-20260812: Claude Code's aggregate dropped exactly one request
// per rollout. Subtracting it from the transcript reproduced the aggregate on
// all four categories in BOTH arms. Trusting the aggregate under-charged native
// 4.1% and sweet 11.1% — an arm-asymmetric under-charge, which a cost benchmark
// must never make. Coverage licenses the per-request record.
const droppedOne = aggregateUsageFromTurns(turns.slice(0, -1));
assert(!recoveredTurnsMatchAggregate(turns, droppedOne),
  'a superset is not exact parity');
assert(recoveredTurnsCoverAggregate(turns, droppedOne),
  'the per-request record COVERS an aggregate that dropped a request');
assert(!recoveredTurnsCoverAggregate(turns.slice(0, 2), completeUsage),
  'an INCOMPLETE record never counts as coverage — it must fail closed');
assert(!recoveredTurnsCoverAggregate(turns, completeUsage),
  'exact parity is not "coverage" (handled by the earlier, preferred branch)');
const supersetSelection = selectClaudeMainCosts({
  streamTurns: [], transcriptTurns: turns, resultUsage: droppedOne,
  price: { in: 5, cache: 0.5, out: 30 },
});
assert(supersetSelection.source === 'transcript-superset',
  'a superset transcript is used, not discarded', supersetSelection.source);
assert(supersetSelection.costs.idealCostUsd != null && supersetSelection.costs.breakPricedCostUsd != null,
  'the cache-normalized columns survive — an A/B can still be read');
assert(supersetSelection.costs.costRealizedUsd > aggregateAllCosts(droppedOne),
  'the superset charges MORE than the aggregate that dropped a request');

const aggregateSelection = selectClaudeMainCosts({
  streamTurns: turns.slice(0, 1), transcriptTurns: turns.slice(0, 2), resultUsage: completeUsage,
  price: { in: 5, cache: 0.5, out: 30 },
});
assert(aggregateSelection.source === 'aggregate'
    && aggregateSelection.costs.costRealizedUsd != null
    && aggregateSelection.costs.idealCostUsd === null
    && aggregateSelection.costs.breakPricedCostUsd === null,
  'partial stream and transcript recover only aggregate realized cost; normalized columns stay null',
  JSON.stringify(aggregateSelection));
const unavailableSelection = selectClaudeMainCosts({
  streamTurns: [], transcriptTurns: [], resultUsage: { output_tokens: 9 },
  price: { in: 5, cache: 0.5, out: 30 },
});
assert(unavailableSelection.source === 'unavailable'
    && unavailableSelection.costs.costRealizedUsd === null
    && unavailableSelection.costs.costNaiveUsd === null,
  'missing aggregate usage categories make cost unavailable instead of $0');

console.log('\nprompt argument construction:');
const subagentAppended = {};
for (const sweet of [false, true]) {
  const argv = buildClaudeCliArgs({ prompt: 'issue', rundir: '/tmp/repo', sweet, claudeModelId: 'model' });
  const appendIndexes = argv.flatMap((v, i) => v === '--append-system-prompt' ? [i] : []);
  assert(appendIndexes.length === 1, `${sweet ? 'sweet' : 'native'} emits exactly one append-system-prompt flag`, JSON.stringify(argv));
  const appended = argv[appendIndexes[0] + 1];
  assert(appended.includes(READ_PAGES_TOOL_NOTE), `${sweet ? 'sweet' : 'native'} receives the byte-identical pages note`);
  assert(sweet === appended.includes('sweet-search guidance'),
    `${sweet ? 'sweet' : 'native'} appended value has the expected routing override`, appended);

  // F2: `--append-system-prompt` never reaches a Task-tool subagent, so subagents on both
  // arms kept sending the invalid empty `pages` value. The note must therefore go out on
  // the subagent flag too, and it must be BYTE-IDENTICAL between arms — the sweet tool
  // guide must not ride along, or a shared repair becomes a retrieval treatment.
  const subIndexes = argv.flatMap((v, i) => v === '--append-subagent-system-prompt' ? [i] : []);
  assert(subIndexes.length === 1, `${sweet ? 'sweet' : 'native'} emits exactly one append-subagent-system-prompt flag`, JSON.stringify(argv));
  const sub = argv[subIndexes[0] + 1];
  assert(sub === READ_PAGES_TOOL_NOTE, `${sweet ? 'sweet' : 'native'} subagent prompt is the pages note and nothing else`, sub);
  assert(!sub.includes('sweet-search guidance'), `${sweet ? 'sweet' : 'native'} subagent prompt carries no sweet routing override`);
  subagentAppended[sweet ? 'sweet' : 'native'] = sub;
}
assert(subagentAppended.native === subagentAppended.sweet,
  'the subagent pages note is byte-identical across arms (zero head-to-head differential)');

console.log('\ndeterministic Read pages normalization:');
assert(!Object.hasOwn(normalizeReadInput({ file_path: '/repo/a.js', pages: '' }), 'pages'),
  'empty pages is removed from a source-file Read');
assert(!Object.hasOwn(normalizeReadInput({ file_path: '/repo/a.js', pages: '1-2', offset: 4 }), 'pages'),
  'pages is removed from non-PDF reads even when non-empty');
assert(normalizeReadInput({ file_path: '/repo/a.PDF', pages: '1-2' }).pages === '1-2',
  'a valid PDF page range is preserved');
const invalidHookDecision = readHookDecision({ tool_name: 'Read', tool_input: {
  file_path: '/repo/a.ts', pages: '', offset: 2,
} });
assert(invalidHookDecision.hookSpecificOutput.permissionDecision === 'allow'
    && invalidHookDecision.hookSpecificOutput.updatedInput.offset === 2
    && !Object.hasOwn(invalidHookDecision.hookSpecificOutput.updatedInput, 'pages'),
  'PreToolUse output preserves other Read fields while removing invalid pages');
const hookHome = join(ROOT, 'hook-user');
const privateClaudeHome = join(hookHome, '.claude');
const installed = installClaudeReadPagesNormalizer(privateClaudeHome, hookHome);
const hookSettings = JSON.parse(readFileSync(installed.settingsPath, 'utf8'));
assert(hookSettings.hooks.PreToolUse.filter(group => group.matcher === 'Read').length === 1
    && hookSettings.hooks.PreToolUse[0].hooks[0].command.includes('normalize-read-pages.mjs'),
  'each private Claude home installs exactly one Read normalizer hook');
installClaudeReadPagesNormalizer(privateClaudeHome, hookHome);
const reinstalledSettings = JSON.parse(readFileSync(installed.settingsPath, 'utf8'));
assert(reinstalledSettings.hooks.PreToolUse.filter(group =>
  (group.hooks || []).some(hook => hook.command?.includes('normalize-read-pages.mjs'))).length === 1,
  'Read normalizer installation is idempotent');
const hookRun = spawnSync(process.execPath, [installed.installedHook], {
  input: JSON.stringify({ tool_name: 'Read', tool_input: {
    file_path: '/repo/source.mjs', pages: '', limit: 12,
  } }),
  encoding: 'utf8',
});
let hookOutput = null;
try { hookOutput = JSON.parse(hookRun.stdout); } catch { /* asserted below */ }
assert(hookRun.status === 0
    && hookOutput?.hookSpecificOutput?.permissionDecision === 'allow'
    && hookOutput.hookSpecificOutput.updatedInput.limit === 12
    && !Object.hasOwn(hookOutput.hookSpecificOutput.updatedInput, 'pages'),
  'installed hook executable emits the Claude PreToolUse updatedInput contract',
  `${hookRun.stderr || hookRun.stdout}`);
const malformedHookRun = spawnSync(process.execPath, [installed.installedHook], {
  input: '{not-json', encoding: 'utf8',
});
let malformedHookOutput = null;
try { malformedHookOutput = JSON.parse(malformedHookRun.stdout); } catch { /* asserted below */ }
assert(malformedHookRun.status === 0
    && malformedHookOutput?.hookSpecificOutput?.permissionDecision === 'allow'
    && !Object.hasOwn(malformedHookOutput.hookSpecificOutput, 'updatedInput'),
  'malformed hook input fails open without inventing replacement arguments');
const quotedHome = join(ROOT, "hook'user");
const quotedInstall = installClaudeReadPagesNormalizer(join(quotedHome, '.claude'), quotedHome);
const quotedSettings = JSON.parse(readFileSync(quotedInstall.settingsPath, 'utf8'));
const quotedCommand = quotedSettings.hooks.PreToolUse[0].hooks[0].command;
const quotedHookRun = spawnSync('/bin/sh', ['-c', quotedCommand], {
  input: JSON.stringify({ tool_name: 'Read', tool_input: {
    file_path: '/repo/source.js', pages: '',
  } }),
  encoding: 'utf8',
});
let quotedHookOutput = null;
try { quotedHookOutput = JSON.parse(quotedHookRun.stdout); } catch { /* asserted below */ }
assert(quotedHookRun.status === 0
    && !Object.hasOwn(quotedHookOutput?.hookSpecificOutput?.updatedInput || {}, 'pages'),
  'hook command safely handles a private-home path containing a quote',
  `${quotedHookRun.stderr || quotedHookRun.stdout}`);

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

// --- D-2: delegated subagents must be priced (2026-08-12) ---
// Claude Code writes each subagent's conversation to <session-id>/subagents/agent-*.jsonl,
// NOT into the main transcript, and its aggregate `result` usage excludes them too. Every
// delegated request was billed by the provider and recorded at zero. Native delegated in
// 11 of 34 rows on the 2026-08-11 Claude run and sweet in 3, so the omission moved the
// comparison in sweet's favour — an accounting exploit, not a product win.
console.log('\nsidechain pricing (D-2):');
const subDir = join(projDir, SESSION, 'subagents');
mkdirSync(subDir, { recursive: true });
writeFileSync(join(subDir, 'agent-aaa.jsonl'), [
  row('sub-1', 400, 0, 100, 40), row('sub-1', 400, 0, 100, 40),   // repeated content blocks again
  row('sub-2', 100, 500, 0, 20),
].join('\n') + '\n');
writeFileSync(join(subDir, 'agent-bbb.jsonl'), [row('sub-3', 250, 0, 50, 10, [
  { type: 'tool_use', name: 'MultiEdit', input: {
    file_path: 'src/b.js', edits: [{ old_string: 'old', new_string: 'new' }],
  } },
])].join('\n') + '\n');
// A non-transcript file in the same directory must not be mistaken for one.
writeFileSync(join(subDir, 'notes.txt'), 'ignore me\n');

const sets = sidechainTurnSets(ROOT, SESSION);
assert(sets.length === 2, 'one turn set per subagent transcript', `got ${sets.length}`);
assert(sets[0].turns.length === 2 && sets[1].turns.length === 1, 'subagent turns deduped by message id',
  JSON.stringify(sets.map(s => s.turns.length)));
assert(sets.every(s => s.instrumentationComplete),
  'sidechain transcripts expose complete per-message accounting');
assert(sets.reduce((sum, s) => sum + s.billedOutputTokens, 0) === 70
  && sets.flatMap(s => s.payloads).includes('new'),
  'sidechain output and payload signals are available to full-rollout degeneration classification');
const multiEditMetrics = sets.find(s => s.name === 'agent-bbb.jsonl');
assert(multiEditMetrics.payloads.join('|') === 'src/b.js|old|new'
    && multiEditMetrics.retainedOutputChars === 'src/b.jsoldnew'.length,
  'nested edit fields contribute to degeneration signals exactly once',
  JSON.stringify({ payloads: multiEditMetrics.payloads, retainedOutputChars: multiEditMetrics.retainedOutputChars }));
assert(turnsFromTranscript(ROOT, SESSION).length === 3, 'main-context recovery is unchanged by the subagent files');

const mainCosts = costsFromTurns(turns, price);
const expectedMainReal = [
  { input: 3, read: 0, write: 16365, out: 68 },
  { input: 3, read: 14963, write: 1488, out: 94 },
  { input: 3, read: 16451, write: 61, out: 38 },
].reduce((sum, u) => sum
  + (u.input * price.in + u.read * price.cache + u.write * price.in * 1.25 + u.out * price.out) / 1e6, 0);
assert(approx(mainCosts.costRealizedUsd, +expectedMainReal.toFixed(6)),
  'transcript realized cost matches aggregate cache-read/cache-write arithmetic',
  `${mainCosts.costRealizedUsd} vs ${expectedMainReal}`);
const subCosts = sets.map(s => costsFromTurns(s.turns, price));
const total = addSidechainCosts(mainCosts, subCosts);
const expReal = +(mainCosts.costRealizedUsd + subCosts.reduce((a, c) => a + c.costRealizedUsd, 0)).toFixed(6);
assert(approx(total.costRealizedUsd, expReal), 'realized = main + every subagent context', `${total.costRealizedUsd} vs ${expReal}`);
assert(total.costRealizedUsd > mainCosts.costRealizedUsd, 'inclusive cost is strictly above main-only');
assert(approx(total.costRealizedMainOnlyUsd, mainCosts.costRealizedUsd), 'main-only cost is retained beside the total — the reproduction check for the old ledger');
assert(total.sidechainCount === 2, 'delegated context count is published', `got ${total.sidechainCount}`);
assert(approx(total.costSidechainUsd, +subCosts.reduce((a, c) => a + c.costRealizedUsd, 0).toFixed(6)), 'delegated spend is published on its own');
const expectedSideReal = [
  { input: 400, read: 0, write: 100, out: 40 },
  { input: 100, read: 500, write: 0, out: 20 },
  { input: 250, read: 0, write: 50, out: 10 },
].reduce((sum, u) => sum
  + (u.input * price.in + u.read * price.cache + u.write * price.in * 1.25 + u.out * price.out) / 1e6, 0);
assert(approx(total.costSidechainUsd, +expectedSideReal.toFixed(6)),
  'sidechain realized cost obeys the same aggregate pricing contract');
// Each subagent is its own growing prefix; folding them into the main sequence would make
// the prefix diff meaningless, so breakPriced is summed per context, never re-derived.
assert(approx(total.breakPricedCostUsd, +(mainCosts.breakPricedCostUsd + subCosts.reduce((a, c) => a + c.breakPricedCostUsd, 0)).toFixed(6)),
  'breakPriced is summed per context, not recomputed over a merged sequence');
// An absent column must stay absent: a partial sum is worse than an honest null.
const nullMain = { ...mainCosts, breakPricedCostUsd: null };
assert(addSidechainCosts(nullMain, subCosts).breakPricedCostUsd === null, 'a null main column stays null after adding subagents');
assert(addSidechainCosts(mainCosts, []).costRealizedUsd === mainCosts.costRealizedUsd, 'no subagents leaves every column byte-identical');
const checkedTotal = addSidechainCostsChecked(mainCosts, sets, price);
assert(checkedTotal.sidechainAccountingComplete && approx(checkedTotal.costRealizedUsd, total.costRealizedUsd),
  'checked sidechain pricing preserves the exact complete path');
const incompleteTotal = addSidechainCostsChecked(mainCosts, [
  ...sets, { name: 'agent-truncated.jsonl', turns: [], instrumentationComplete: false },
], price);
assert(incompleteTotal.sidechainAccountingComplete === false
    && incompleteTotal.costRealizedUsd === null
    && incompleteTotal.costSidechainUsd === null
    && incompleteTotal.incompleteSidechains.join() === 'agent-truncated.jsonl',
  'an incomplete sidechain makes inclusive cost unavailable instead of $0/partial',
  JSON.stringify(incompleteTotal));

// A null inclusive cost is correct but it is ALSO a trap: subagent use is arm-asymmetric,
// so summing the column treats every native null as $0 and can flip the sign of a headline.
// The lower bound has to be present, labelled, and never mistakable for the total.
const boundCase = addSidechainCostsChecked(mainCosts, [
  { name: 'agent-partial.jsonl', turns: [{ in: 1000, cached: 0, out: 100 }],
    instrumentationComplete: false, assistantMessages: 5, usageMessages: 3 },
], price);
assert(boundCase.costRealizedUsd === null,
  'the inclusive total stays null when a delegated transcript is incomplete');
assert(boundCase.costRealizedLowerBoundUsd != null
    && boundCase.costRealizedLowerBoundUsd > (mainCosts.costRealizedUsd ?? 0),
  'a labelled LOWER BOUND is published alongside the nulls, and it exceeds main-only',
  JSON.stringify({ bound: boundCase.costRealizedLowerBoundUsd, main: mainCosts.costRealizedUsd }));
assert(boundCase.sidechainMissingRequests === 2,
  'the count of delegated requests with no usage record is reported',
  String(boundCase.sidechainMissingRequests));
assert(boundCase.costSidechainMeasuredUsd > 0,
  'the measured part of delegated spend is reported separately from the unknown part');

// The same keys must exist on the COMPLETE path, so a consumer never branches on presence.
const completeChecked = addSidechainCostsChecked(mainCosts, sets, price);
assert('costRealizedLowerBoundUsd' in completeChecked && 'sidechainMissingRequests' in completeChecked
    && completeChecked.sidechainMissingRequests === 0
    && completeChecked.costRealizedLowerBoundUsd === completeChecked.costRealizedUsd,
  'complete accounting carries the same keys, with bound === total',
  JSON.stringify({ b: completeChecked.costRealizedLowerBoundUsd, t: completeChecked.costRealizedUsd }));

// Turn-log reader must retain cache-write accounting. Use the existing temp root
// rather than the benchmark results tree.
const turnLogPath = join(ROOT, 'turns.jsonl');
writeFileSync(turnLogPath, [
  JSON.stringify({ kind: 'meta', source: 'unit', turns: 1 }),
  JSON.stringify({ t: 1, in: 100, cached: 20, cacheWrite: 30, out: 4 }),
].join('\n') + '\n');
assert(readTurnLog(turnLogPath).turns[0].cacheWrite === 30,
  'turn-log reader preserves cacheWrite for later repricing');

// D-4: the shared tool-argument note must stay arm-symmetric and content-free. If it ever
// carries retrieval or strategy advice it stops being a harness repair and becomes an
// unmeasured prompt lever handed to both arms.
console.log('\nshared tool-argument note (D-4):');
assert(/pages/.test(READ_PAGES_TOOL_NOTE), 'the note names the parameter it repairs');
assert(!/(ss-|sweet|search first|grep|retriev)/i.test(READ_PAGES_TOOL_NOTE), 'the note carries no retrieval or strategy content', READ_PAGES_TOOL_NOTE);

rmSync(ROOT, { recursive: true, force: true });
console.log(ok ? '\nALL PASS' : '\nFAILED');
process.exit(ok ? 0 : 1);

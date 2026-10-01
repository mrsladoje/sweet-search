// Equal prompt-cache warmth (cache-warmup.mjs, 2026-10-01).
// Standalone: `node tests/cache-warmup.mjs` — exit 1 on fail. No model calls, no network: the
// "model" is a stub that records when it was called.
//
// Pins: (1) both Claude Code launchers force the 5-minute TTL; (2) each arm is warmed ONCE, and
// the warm-up has FINISHED before any scored rollout of that arm starts, even when workers race;
// (3) a warm-up never reaches the scored rows or their cost, only warmups.jsonl; (4) a warm-up
// that cannot run stops the arm before scored work; (5) the fairness check flags one arm cold and
// the other warm, and ignores warm-up and error rows.
import { mkdtempSync, readFileSync, rmSync, existsSync, appendFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  WARMUP_ID, WARMUP_QUESTION, warmupEnabled, isWarmupRow, excludeWarmups, applyClaudeCacheTtl,
  CLAUDE_CACHE_TTL_ENV, firstRequestCacheFields, createWarmupGate, cacheFairness, fairnessBanner,
  cacheIsDeterministic, isWarmupLabel,
} from '../harness/cache-warmup.mjs';

let ok = true;
const assert = (c, name, extra = '') => { console.log((c ? '  ✓ ' : '  ✗ ') + name + (c ? '' : '  ' + extra)); if (!c) ok = false; };
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'cache-warmup-'));
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const quiet = () => {};

console.log('claude cache TTL env:');
{
  const env = applyClaudeCacheTtl({ PATH: '/bin', ENABLE_PROMPT_CACHING_1H: '1', CLAUDE_CODE_PROMPT_CACHE_TTL: '1h', CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL: '1h' });
  assert(env.FORCE_PROMPT_CACHING_5M === '1', 'FORCE_PROMPT_CACHING_5M=1 is set');
  assert(env.ENABLE_PROMPT_CACHING_1H === undefined && env.CLAUDE_CODE_PROMPT_CACHE_TTL === undefined && env.CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL === undefined,
    'inherited 1h overrides are removed');
  assert(env.PATH === '/bin', 'unrelated env is untouched');
  assert(Object.isFrozen(CLAUDE_CACHE_TTL_ENV), 'the env constant cannot be mutated');
  // The name must exist in the installed CLI. Skipped when the pinned binary is not on this machine.
  const bin = path.join(process.env.HOME || '', '.ss-eval/bin-claude-2.1.281/claude');
  if (existsSync(bin) && statSync(bin).size > 1e6) {
    const g = spawnSync('grep', ['-a', '-c', 'FORCE_PROMPT_CACHING_5M', bin], { encoding: 'utf8' });
    assert(Number(g.stdout.trim()) > 0, 'FORCE_PROMPT_CACHING_5M exists in the pinned Claude Code 2.1.281 bundle', g.stdout + g.stderr);
  } else console.log('  - pinned claude binary not present; bundle check skipped');
  // Both launchers must call it (a structural guard: a launcher that forgets it silently pays 1h writes).
  const retrieval = readFileSync(path.join(here, '../../../scripts/retrieval-bench-282.mjs'), 'utf8');
  const taskRunner = readFileSync(path.join(here, '../harness/claude-code-task-runner.mjs'), 'utf8');
  assert(/applyClaudeCacheTtl\(env\)/.test(retrieval), 'retrieval bench launches Claude Code with the 5m TTL');
  assert(/applyClaudeCacheTtl\(env\)/.test(taskRunner), 'task bench launches Claude Code with the 5m TTL');
}

console.log('\nwarm-up switch and row exclusion:');
{
  assert(warmupEnabled({}) === true && warmupEnabled({ SS_CACHE_WARMUP: '1' }) === true && warmupEnabled({ SS_CACHE_WARMUP: '0' }) === false, 'SS_CACHE_WARMUP=0 is the only off switch');
  assert(isWarmupRow({ warmup: true }) && isWarmupRow({ id: WARMUP_ID }) && isWarmupRow({ taskId: WARMUP_ID }) && !isWarmupRow({ id: 'go-005' }), 'warm-up rows are recognised by flag or id');
  const rows = [{ id: 'a', costRealizedUsd: 0.1 }, { id: WARMUP_ID, costRealizedUsd: 9 }, { taskId: WARMUP_ID, costRealizedUsd: 9 }, { id: 'b', warmup: true, costRealizedUsd: 9 }, { id: 'c', costRealizedUsd: 0.2 }];
  const kept = excludeWarmups(rows);
  assert(kept.length === 2 && kept.reduce((s, r) => s + r.costRealizedUsd, 0) === 0.30000000000000004, 'excludeWarmups drops every warm-up row and its cost');
  assert(excludeWarmups(undefined).length === 0, 'excludeWarmups tolerates no rows');
  const f = firstRequestCacheFields([{ in: 17800, cached: 0, cacheWrite: 17800 }, { in: 18000, cached: 17800 }]);
  assert(f.firstRequestCacheRead === 0 && f.firstRequestCacheWrite === 17800 && f.firstRequestInputTokens === 17800, 'first request fields come from turn 1, not later turns', JSON.stringify(f));
  assert(firstRequestCacheFields([]).firstRequestCacheRead === null && firstRequestCacheFields(null).firstRequestCacheRead === null, 'no per-request record -> null, never 0');
}

console.log('\nwarm-up gate, a bench-shaped run (3 workers, 2 arms, warm-up cost 9, scored cost 1 each):');
{
  const logFile = path.join(tmp, 'warmups.jsonl');
  const events = [];                       // ordered facts: who started and finished when
  let warmCalls = { native: 0, sweet: 0 };
  const gate = createWarmupGate({ logFile, meta: { cell: 'test' }, log: quiet });
  const runWarm = (arm) => async () => {
    warmCalls[arm]++; events.push(`warm-start:${arm}`);
    await delay(40);                      // the warm-up takes real time; scored work must wait for it
    events.push(`warm-end:${arm}`);
    return { id: WARMUP_ID, costRealizedUsd: 9, firstRequestCacheRead: 0, usage: { input_tokens: 5 } };
  };
  const rows = [];
  const runOne = async (probe, arm) => {
    await gate.ensure(arm, runWarm(arm));
    events.push(`scored-start:${arm}:${probe}`);
    await delay(5);
    const row = { arm, id: probe, costRealizedUsd: 1, startedAtMs: Date.now(), firstRequestCacheRead: 10202 };
    rows.push(row);
    events.push(`scored-end:${arm}:${probe}`);
    return row;
  };
  // arm by arm, like retrieval-bench-282: native fully, then sweet; 3 workers pull a shared queue.
  for (const arm of ['native', 'sweet']) {
    const queue = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']; let i = 0;
    await Promise.all([0, 1, 2].map(async () => { while (i < queue.length) await runOne(queue[i++], arm); }));
  }
  assert(warmCalls.native === 1 && warmCalls.sweet === 1, 'each arm is warmed exactly once, though 3 workers raced for it', JSON.stringify(warmCalls));
  for (const arm of ['native', 'sweet']) {
    const end = events.indexOf(`warm-end:${arm}`);
    const firstScored = events.findIndex(e => e.startsWith(`scored-start:${arm}:`));
    assert(end !== -1 && firstScored > end, `${arm}: the warm-up FINISHED before the first scored rollout started`, events.join(' | '));
  }
  const lastNativeEnd = Math.max(...events.map((e, k) => (e.startsWith('scored-end:native') ? k : -1)));
  assert(events.indexOf('warm-start:sweet') > lastNativeEnd, 'the sweet arm is warmed lazily, right before its own first rollout (not at run start)', events.join(' | '));
  assert(events.indexOf('warm-start:sweet') > events.indexOf('warm-end:native'), 'arms are warmed one after the other, each before its own first question');
  assert(rows.length === 12 && rows.every(r => !isWarmupRow(r)), 'scored rows contain only scored rollouts (12), no warm-up row');
  assert(rows.reduce((s, r) => s + r.costRealizedUsd, 0) === 12, 'scored cost is 12: the $9 warm-up cost is NOT in it');
  const log = readFileSync(logFile, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert(log.length === 2 && log.every(e => e.kind === 'warmup' && e.warmup === true && e.ok && e.costRealizedUsd === 9 && e.cell === 'test'), 'warm-up tokens and cost are logged separately, one entry per arm', JSON.stringify(log));
  assert(new Set(log.map(e => e.arm)).size === 2, 'the log names each arm');
  assert(gate.entries().length === 2 && gate.warmedArms().join() === 'native,sweet', 'gate reports what it warmed');
  const scoredFile = path.join(tmp, 'runs.jsonl');
  rows.forEach(r => appendFileSync(scoredFile, `${JSON.stringify(r)}\n`));
  assert(!readFileSync(scoredFile, 'utf8').includes(WARMUP_ID), 'a runs file written from the scored rows has no warm-up in it');
  const f = cacheFairness(rows, { wave: 3, deterministic: true });
  assert(f.status === 'ok', 'the stub run passes the fairness check', JSON.stringify(f));
}

console.log('\nwarm-up failure and the off switch:');
{
  let calls = 0;
  const gate = createWarmupGate({ logFile: path.join(tmp, 'fail.jsonl'), retries: 1, log: quiet });
  const bad = async () => { calls++; throw new Error('claude exited 1'); };
  let err = null;
  try { await gate.ensure('sweet', bad); } catch (e) { err = e; }
  assert(err && err.fatal === true && err.warmupFailed === true && /cache warm-up failed for arm "sweet" after 2 attempt/.test(err.message), 'a warm-up that fails twice is a fatal error naming the arm', String(err?.message));
  assert(calls === 2, 'the failed warm-up was retried exactly once', String(calls));
  let err2 = null;
  try { await gate.ensure('sweet', async () => { calls++; return {}; }); } catch (e) { err2 = e; }
  assert(err2 && calls === 2, 'every later scored rollout of that arm is refused without a new attempt');
  const lines = readFileSync(path.join(tmp, 'fail.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert(lines.length === 2 && lines.every(l => l.ok === false && /claude exited 1/.test(l.error)), 'both failed attempts are logged');

  let n = 0;
  const flaky = createWarmupGate({ logFile: path.join(tmp, 'flaky.jsonl'), retries: 1, log: quiet });
  const entry = await flaky.ensure('native', async () => { if (++n === 1) throw new Error('transient'); return { costRealizedUsd: 0.01 }; });
  assert(entry.ok && entry.attempt === 1 && n === 2, 'a transient failure is absorbed by the retry');

  const fatalGate = createWarmupGate({ logFile: null, retries: 3, log: quiet });
  let fcalls = 0;
  try { await fatalGate.ensure('native', async () => { fcalls++; throw Object.assign(new Error('account limit'), { fatal: true }); }); } catch { /* expected */ }
  assert(fcalls === 1, 'an account-fatal error is not retried');

  let offCalls = 0;
  const off = createWarmupGate({ enabled: false });
  const r = await off.ensure('native', async () => { offCalls++; return {}; });
  assert(r === null && offCalls === 0, 'a disabled gate never calls the warm-up');
}

console.log('\nfairness assertion:');
{
  const row = (arm, startedAtMs, firstRequestCacheRead, extra = {}) => ({ arm, id: `${arm}-${startedAtMs}`, startedAtMs, firstRequestCacheRead, ...extra });
  // the r282 defect: native started warm (10202), sweet started fully cold (0)
  const unfair = [
    row('native', 1, 10202), row('native', 1, 10202), row('native', 1, 10202), row('native', 9, 12000),
    row('sweet', 100, 0), row('sweet', 100, 0), row('sweet', 100, 0), row('sweet', 140, 12000),
  ];
  const f = cacheFairness(unfair, { wave: 3, deterministic: true });
  assert(f.status === 'violation', 'native warm + sweet cold in the first wave is a VIOLATION', JSON.stringify(f));
  assert(/CACHE UNFAIR/.test(f.message) && /sweet/.test(f.message) && /native/.test(f.message), 'the message names both arms', f.message);
  assert(f.arms.sweet.status === 'cold' && f.arms.native.status === 'warm', 'per-arm status is recorded', JSON.stringify(f.arms));
  assert(/!!!!/.test(fairnessBanner(f)), 'a violation prints a loud banner');

  // the same run AFTER the warm-up: every first request reads the shared prefix
  const fixed = unfair.map(r => (r.firstRequestCacheRead === 0 ? { ...r, firstRequestCacheRead: 10202 } : r));
  assert(cacheFairness(fixed, { wave: 3, deterministic: true }).status === 'ok', 'both arms warm -> ok');
  assert(cacheFairness(unfair.filter(r => r.arm === 'native').map(r => ({ ...r })).concat(unfair.filter(r => r.arm === 'sweet').map(r => ({ ...r, firstRequestCacheRead: 0 }))), { wave: 3, deterministic: true }).status === 'violation',
    'a sweet arm that never reads from cache is flagged against a warm native arm');
  assert(cacheFairness([row('native', 1, 0), row('sweet', 2, 0)], { deterministic: true }).status === 'ok', 'both arms cold is equal treatment, not a violation');

  // only the first wave counts: a later cold request does not flip a warm arm
  const later = [row('native', 1, 10202), row('native', 2, 10202), row('native', 3, 10202), row('native', 50, 0),
    row('sweet', 1, 10202), row('sweet', 2, 10202), row('sweet', 3, 10202), row('sweet', 60, 0)];
  assert(cacheFairness(later, { wave: 3, deterministic: true }).status === 'ok', 'only the first wave of each arm is compared');
  // order is by start time, not array order
  const shuffled = [row('sweet', 140, 12000), row('sweet', 100, 0), row('native', 9, 12000), row('native', 1, 10202), row('sweet', 100, 0), row('native', 1, 10202), row('sweet', 100, 0), row('native', 1, 10202)];
  assert(cacheFairness(shuffled, { wave: 3, deterministic: true }).status === 'violation', 'the first wave is chosen by start time, not by row order');

  // warm-up rows and error rows are not scored requests
  const withWarm = [...fixed, { arm: 'sweet', id: WARMUP_ID, startedAtMs: 0, firstRequestCacheRead: 0, warmup: true }];
  assert(cacheFairness(withWarm, { wave: 3, deterministic: true }).status === 'ok', 'a warm-up row never counts as a first scored request');
  const withErr = [...fixed, { arm: 'sweet', id: 'e', startedAtMs: 0, error: 'boom', firstRequestCacheRead: 0 }];
  assert(cacheFairness(withErr, { wave: 3, deterministic: true }).status === 'ok', 'an errored row never counts as a first scored request');

  // the first WAVE is the unit, not one request: one cold request among three concurrent ones
  const mixed = [row('native', 1, 10202), row('native', 1, 10202), row('native', 1, 10202),
    row('sweet', 100, 10202), row('sweet', 100, 0), row('sweet', 100, 0)];
  const fm = cacheFairness(mixed, { wave: 3, deterministic: true });
  assert(fm.status === 'violation' && fm.arms.sweet.status === 'mixed' && fm.arms.sweet.coldRequests === 2,
    'one warm request cannot hide two cold ones in the same first wave (deterministic)', JSON.stringify(fm.arms));
  assert(cacheFairness(mixed, { wave: 1, deterministic: true }).status === 'ok', 'with wave 1 that same run would look fair: why the wave is the run concurrency');
  const both = [row('native', 1, 0), row('native', 1, 10202), row('native', 1, 10202), row('sweet', 100, 10202), row('sweet', 100, 0), row('sweet', 100, 10202)];
  assert(cacheFairness(both, { wave: 3, deterministic: true }).status === 'ok', 'equal cold share in both arms is equal treatment');

  // best-effort caches (codex, opencode, OpenRouter): a mismatch is recorded, never fatal
  const fb = cacheFairness(unfair, { wave: 3 });
  assert(fb.status === 'warning' && fb.enforced === false && fb.mode === 'best-effort', 'best-effort is the default and a mismatch there is a WARNING, not a violation', JSON.stringify(fb));
  assert(/WARNING/.test(fairnessBanner(fb)) && !/!!!!/.test(fairnessBanner(fb)), 'a warning prints a plain warning block, not the violation banner');
  assert(f.enforced === true && f.mode === 'deterministic', 'the strict result says it was enforced');
  assert(cacheIsDeterministic({ harness: 'cc' }) === true, 'retrieval bench Claude Code (subscription) is deterministic');
  assert(cacheIsDeterministic({ harness: 'claudecode', provider: 'anthropic' }) === true, 'task bench Claude Code direct to Anthropic is deterministic');
  assert(cacheIsDeterministic({ harness: 'claudecode', provider: 'openrouter' }) === false, 'Claude Code through OpenRouter is best-effort');
  assert(['codex', 'opencode', 'api', undefined].every(h => cacheIsDeterministic({ harness: h, provider: 'openai' }) === false), 'codex, opencode and the rest are best-effort');

  // unmeasured arms cannot cause a violation
  const unm = [row('native', 1, 10202), row('sweet', 2, null), row('sweet', 3, undefined)];
  const fu = cacheFairness(unm, { wave: 3, deterministic: true });
  assert(fu.status === 'incomplete' && fu.arms.sweet.status === 'unavailable', 'an arm with no per-request cache record is unavailable and never a violation', JSON.stringify(fu));
  assert(cacheFairness([], { wave: 3, deterministic: true }).status === 'incomplete', 'no rows -> incomplete, not a crash');
  assert(cacheFairness([{ arm: 'native', firstRequestCacheRead: 5 }, { arm: 'sweet', firstRequestCacheRead: 0 }], { deterministic: true }).status === 'incomplete', 'rows with no start time cannot form a first wave');
}

console.log('\nthe bench launchers gate every scored rollout on the warm-up:');
{
  const retrieval = readFileSync(path.join(here, '../../../scripts/retrieval-bench-282.mjs'), 'utf8');
  const i = retrieval.indexOf('await GATE.ensure(arm');
  const j = retrieval.indexOf('    base.startedAtMs = Date.now();\n    run = await launch(probe, arm)');
  assert(i !== -1 && j !== -1 && i < j, 'retrieval bench awaits the arm warm-up before launching a scored rollout');
  assert(/WARMUPS = path\.join\(OUT, 'warmups\.jsonl'\)/.test(retrieval) && !/appendFileSync\(RUNS[^)]*warm/i.test(retrieval), 'retrieval bench logs warm-ups to warmups.jsonl, not runs.jsonl');
  const pilot = readFileSync(path.join(here, '../harness/run-pilot.mjs'), 'utf8');
  const a = pilot.indexOf('await WARM_GATE.ensure(arm');
  const b = pilot.indexOf('const rundir = makeRunDir(golden.dir, rep, sweet);');
  assert(a !== -1 && b !== -1 && a < b, 'task bench awaits the arm warm-up before preparing a scored rollout');
  assert(/deterministic: CACHE_DETERMINISTIC/.test(retrieval) && /CACHE_DETERMINISTIC = cacheIsDeterministic\(\{ harness: CELL\.harness \}\)/.test(retrieval),
    'retrieval bench enforces the fairness check only for a deterministic cache');
  assert(/deterministic: cacheIsDeterministic\(\{ harness: HARNESS, provider: PROVIDER \}\)/.test(pilot), 'task bench enforces the fairness check only for a deterministic cache');
  const all = readFileSync(path.join(here, '../../../scripts/retrieval-bench-282-all.sh'), 'utf8');
  assert(/\|\| rc=\$\?/.test(all) && /CACHE FAIRNESS VIOLATION/.test(all), 'the all-cells driver names a fairness stop');
  assert(WARMUP_QUESTION.includes('READY') && /Do not use any tools/.test(WARMUP_QUESTION), 'the warm-up question is tool-free');
}

console.log('\nwarm-up per-rollout files stay out of the scored result dirs:');
{
  assert(isWarmupLabel(`${WARMUP_ID}-sweet`) && isWarmupLabel(`${WARMUP_ID}-native`) && !isWarmupLabel('django__django-1-sweet') && !isWarmupLabel(undefined), 'warm-up labels are recognised by the warm-up id');
  const prev = process.env.RUN_ID; process.env.RUN_ID = `cw-test-${process.pid}`;
  try {
    const { rolloutStateDir } = await import('../harness/agent-jail.mjs');
    const { persistTurns } = await import('../harness/turn-log.mjs');
    const { dedupLogPathFor } = await import('../harness/rt-dedup.mjs');
    const runRoot = path.join(here, '..', 'results', process.env.RUN_ID);
    try {
      const ws = rolloutStateDir(`${WARMUP_ID}-sweet`, 'claude-home');
      const ss = rolloutStateDir('task1-sweet', 'claude-home');
      assert(ws === path.join(runRoot, 'warmup', 'agent-state', `${WARMUP_ID}-sweet`, 'claude-home'), 'a warm-up state dir is under results/<run>/warmup/agent-state', ws);
      assert(ss === path.join(runRoot, 'agent-state', 'task1-sweet', 'claude-home'), 'a scored state dir is unchanged', ss);
      const wt = persistTurns(`${WARMUP_ID}-native`, [{ in: 10, cached: 0, cacheWrite: 10, out: 1 }]);
      const st = persistTurns('task1-native', [{ in: 10, cached: 0, cacheWrite: 10, out: 1 }]);
      assert(wt && path.normalize(wt).includes(path.join('warmup', 'turns')) && st && !st.includes('warmup') && st.includes(`${path.sep}turns${path.sep}`), 'a warm-up turn log goes to warmup/turns, a scored one to turns/', `${wt} | ${st}`);
      assert(dedupLogPathFor(`${WARMUP_ID}-sweet`).includes(path.join('warmup', 'rt-dedup')) && !dedupLogPathFor('t-sweet').includes('warmup'), 'a warm-up rt-dedup log goes to warmup/rt-dedup');
    } finally { rmSync(runRoot, { recursive: true, force: true }); }
  } finally { if (prev === undefined) delete process.env.RUN_ID; else process.env.RUN_ID = prev; }
}

rmSync(tmp, { recursive: true, force: true });
console.log(ok ? '\nALL PASS' : '\nFAILED');
process.exit(ok ? 0 : 1);

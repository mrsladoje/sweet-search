// Equal prompt-cache warmth for the sweet arm and the native arm (2026-10-01).
//
// THE DEFECT THIS REMOVES. Provider prompt caches outlive a process. A rollout that happens to
// start while an earlier run's cache entry is still alive reads its shared prefix (tools +
// system prompt) at the cache-read rate, and a rollout that starts cold pays a full cache write
// for the same bytes. On the r282 Claude Code cells the native runs started warm (an earlier
// native run had written the prefix inside the TTL) and the sweet runs started cold, so the
// first three questions of each sweet run paid ~17.8k tokens of cache write that native did not.
// One question lost $0.048 of a $0.117 gap to it. Which arm went first decided who paid.
//
// THE REPAIR. Before the first SCORED rollout of each arm, send ONE unscored warm-up request
// with that arm's exact launch config and wait for it to finish. The gate below does that:
//   - once per arm, lazily, immediately before that arm's first scored rollout. Lazily matters
//     when arms are interleaved (task bench): a warm-up fired for every arm at the start would
//     expire before the second arm's first scored rollout.
//   - concurrent first callers of the same arm share ONE warm-up and all wait for it.
//   - a failed warm-up is retried once, then fails the whole arm before any scored work starts.
//     An arm that silently skipped its warm-up is exactly the unfairness this file exists to stop.
//
// WHAT A WARM-UP CAN WARM. The shared prefix: tool definitions and the system prompt, which are
// byte-identical across repos for one arm. It runs from its OWN working directory (a clone of the
// first repo under a different path), so the PER-REPO part of the prompt (cwd, memory path,
// git status) is not warmed. The first question in each repo therefore stays cold on that part in
// BOTH arms. That is fair and it is what a user opening a new repo sees. Measured on r282:
// fully cold = cache_read 0; shared prefix warm = ~10k read; shared + per-repo warm = ~12-14k.
// After the warm-up, every first question should read ~10k, in both arms.
//
// WHAT IS EXCLUDED. A warm-up never produces a row. Its tokens and cost go to a SEPARATE log
// (warmups.jsonl), are never added to runs.jsonl / rows.json / any aggregate, and every consumer
// that reads rows drops anything `isWarmupRow` recognises.
//
// FAIRNESS ASSERTION. `cacheFairness(rows)` compares what each arm's first scored request read from
// cache. If one arm started cold (read 0) and the other warm (read > 0) the run is UNFAIR: it is
// reported loudly and recorded in the run summary.
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const WARMUP_ID = '__warmup__';

/** The unscored request. Short, tool-free, so it costs a few cents and writes the shared prefix. */
export const WARMUP_QUESTION = 'This is an unscored cache warm-up. Reply with the single word READY. Do not use any tools.';

/** SS_CACHE_WARMUP=0 turns the warm-up off (legacy runs, or a harness that cannot warm). */
export function warmupEnabled(env = process.env) {
  return String(env.SS_CACHE_WARMUP ?? '1') !== '0';
}

export const isWarmupRow = (row) => !!row && (row.warmup === true || row.id === WARMUP_ID || row.taskId === WARMUP_ID);

/** Every consumer that aggregates rows calls this first. */
export const excludeWarmups = (rows) => (rows || []).filter(r => !isWarmupRow(r));

/**
 * Claude Code env for the real-API-key cache TTL. Claude Code picks the 1-hour TTL for a
 * subscriber and the 5-minute TTL for an API-key user. The bench runs on a subscription, so it
 * must force the API-key behaviour in BOTH arms or its cache-write bill is not what a paying
 * user's would be. FORCE_PROMPT_CACHING_5M is read first in Claude Code's TTL order, ahead of
 * CLAUDE_CODE_PROMPT_CACHE_TTL, the promptCacheTtl setting and ENABLE_PROMPT_CACHING_1H
 * (verified against the 2.1.281 bundle). The other knobs are removed so nothing inherited from the
 * operator's shell can contradict it.
 */
export const CLAUDE_CACHE_TTL_ENV = Object.freeze({ FORCE_PROMPT_CACHING_5M: '1' });
export function applyClaudeCacheTtl(env) {
  Object.assign(env, CLAUDE_CACHE_TTL_ENV);
  for (const k of ['ENABLE_PROMPT_CACHING_1H', 'ENABLE_PROMPT_CACHING_1H_BEDROCK',
    'CLAUDE_CODE_PROMPT_CACHE_TTL', 'CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL']) delete env[k];
  return env;
}

/** What the first request of a rollout read and wrote. Nulls when the harness gives no per-request record. */
export function firstRequestCacheFields(turns) {
  const t = Array.isArray(turns) ? turns[0] : null;
  if (!t || !Number.isFinite(Number(t.in))) {
    return { firstRequestCacheRead: null, firstRequestCacheWrite: null, firstRequestInputTokens: null };
  }
  return {
    firstRequestCacheRead: Number(t.cached) || 0,
    firstRequestCacheWrite: Number(t.cacheWrite) || 0,
    firstRequestInputTokens: Number(t.in) || 0,
  };
}

/**
 * One warm-up per arm, run on first use.
 *
 *   const gate = createWarmupGate({ logFile, meta: { cell } });
 *   await gate.ensure('sweet', () => runWarmupRequest('sweet'));   // before each scored rollout
 *
 * `warm()` is the arm's real launch with WARMUP_QUESTION; its return value (usage, cost, ...) is
 * logged to `logFile` and returned by `ensure`, never to a results file. `warm` runs only for the
 * first caller of an arm.
 */
export function createWarmupGate({ logFile = null, meta = {}, retries = 1, enabled = true, now = Date.now, log = console.error } = {}) {
  const arms = new Map();   // arm -> Promise<entry>
  const entries = [];       // every entry written, in order
  const record = (entry) => {
    entries.push(entry);
    if (!logFile) return;
    try {
      mkdirSync(path.dirname(logFile), { recursive: true });
      appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
    } catch { /* the log must never fail a run */ }
  };
  async function runOnce(arm, warm) {
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const startedAtMs = now();
      try {
        const result = await warm(attempt);
        const entry = { kind: 'warmup', warmup: true, arm, attempt, ok: true, startedAtMs, endedAtMs: now(), ...meta, ...(result || {}) };
        record(entry);
        return entry;
      } catch (e) {
        lastErr = e;
        record({ kind: 'warmup', warmup: true, arm, attempt, ok: false, startedAtMs, endedAtMs: now(), ...meta, error: String(e?.message || e).slice(0, 300) });
        log(`  [warmup] ${arm} attempt ${attempt + 1}/${retries + 1} FAILED: ${String(e?.message || e).slice(0, 160)}`);
        if (e?.fatal) break;
      }
    }
    const err = new Error(`cache warm-up failed for arm "${arm}" after ${retries + 1} attempt(s): ${String(lastErr?.message || lastErr).slice(0, 200)} (run-wide: no scored rollout may start without its arm warm-up)`);
    err.fatal = true; err.warmupFailed = true;
    throw err;
  }
  return {
    /** Resolves when the arm's warm-up has FINISHED (or immediately when disabled). */
    ensure(arm, warm) {
      if (!enabled) return Promise.resolve(null);
      let p = arms.get(arm);
      if (!p) { p = runOnce(arm, warm); arms.set(arm, p); }
      return p;
    },
    entries: () => entries.slice(),
    warmedArms: () => [...arms.keys()],
  };
}

/**
 * Run-level fairness check. `rows` are scored rows carrying { arm, startedAtMs,
 * firstRequestCacheRead }. For each arm take its first `wave` rollouts by start time (the
 * rollouts launched together at the start of the arm) and ask whether ANY of them read from cache.
 *   cold arm = every first-wave first request read 0
 *   warm arm = at least one read > 0
 * One arm cold and the other warm = VIOLATION. An arm with no measurable first request is
 * 'unavailable' and never causes a violation (the check cannot see it).
 */
export function cacheFairness(rows, { wave = 3 } = {}) {
  const scored = excludeWarmups(rows).filter(r => r && !r.error);
  const byArm = new Map();
  for (const r of scored) {
    if (!r.arm) continue;
    if (!byArm.has(r.arm)) byArm.set(r.arm, []);
    byArm.get(r.arm).push(r);
  }
  const arms = {};
  for (const [arm, list] of byArm) {
    const first = list
      .filter(r => Number.isFinite(Number(r.startedAtMs)))
      .sort((a, b) => a.startedAtMs - b.startedAtMs)
      .slice(0, Math.max(1, wave));
    const measured = first.filter(r => r.firstRequestCacheRead != null && Number.isFinite(Number(r.firstRequestCacheRead)));
    if (!measured.length) { arms[arm] = { status: 'unavailable', wave: first.length, measured: 0 }; continue; }
    const reads = measured.map(r => Number(r.firstRequestCacheRead));
    arms[arm] = {
      status: Math.max(...reads) > 0 ? 'warm' : 'cold',
      wave: first.length, measured: measured.length,
      firstRequestCacheRead: reads, coldRequests: reads.filter(x => x === 0).length,
    };
  }
  const known = Object.entries(arms).filter(([, a]) => a.status === 'warm' || a.status === 'cold');
  const cold = known.filter(([, a]) => a.status === 'cold').map(([k]) => k);
  const warm = known.filter(([, a]) => a.status === 'warm').map(([k]) => k);
  let status, message;
  if (known.length < 2) {
    status = 'incomplete';
    message = `cache fairness: cannot compare (${known.length} arm(s) with a measured first request: ${Object.keys(arms).map(a => `${a}=${arms[a].status}`).join(', ') || 'none'})`;
  } else if (cold.length && warm.length) {
    status = 'violation';
    message = `CACHE UNFAIR: arm(s) ${cold.join(',')} started COLD (first request read 0 from cache) while arm(s) ${warm.join(',')} started WARM. Cost columns of this run are not comparable.`;
  } else {
    status = 'ok';
    message = `cache fairness ok: every arm started ${warm.length ? 'warm' : 'cold'} (${known.map(([k, a]) => `${k} reads [${a.firstRequestCacheRead.join(',')}]`).join('; ')})`;
  }
  return { status, message, wave, arms };
}

/** A banner a human cannot miss. */
export function fairnessBanner(f) {
  if (f.status !== 'violation') return f.message;
  const bar = '!'.repeat(78);
  return `\n${bar}\n*** ${f.message}\n*** per arm: ${JSON.stringify(f.arms)}\n${bar}\n`;
}

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
// that reads rows drops anything `isWarmupRow` recognises. The task bench's per-rollout files
// (agent-state/, turns/, rt-dedup/) of a warm-up go under results/<run>/warmup/ instead
// (`isWarmupLabel`), so scripts that glob those directories never see a warm-up.
//
// FAIRNESS ASSERTION. `cacheFairness(rows)` compares what each arm's FIRST WAVE of scored requests
// read from cache. Strict (a violation, exit 3) only where the cache is deterministic (Claude Code
// on Anthropic). A warning, never fatal, on best-effort caches (codex, opencode, OpenRouter).
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const WARMUP_ID = '__warmup__';

/** The unscored request. Short, tool-free, so it costs a few cents and writes the shared prefix. */
export const WARMUP_QUESTION = 'This is an unscored cache warm-up. Reply with the single word READY. Do not use any tools.';

/** SS_CACHE_WARMUP=0 turns the warm-up off (legacy runs, or a harness that cannot warm). */
export function warmupEnabled(env = process.env) {
  return String(env.SS_CACHE_WARMUP ?? '1') !== '0';
}

/** A warm-up's rollout label (`<task id>-<arm>`, task id = WARMUP_ID). Its per-rollout files go
 * under results/<run>/warmup/, never beside the scored rollouts' agent-state/, turns/ or
 * rt-dedup/, which analysis scripts glob (probe-count, reprice-openrouter-generations). */
export const isWarmupLabel = (label) => String(label ?? '').startsWith(WARMUP_ID);

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
 * Is this route's prompt cache DETERMINISTIC? Only Anthropic's own API (Claude Code on a Claude
 * subscription or an Anthropic key, no base-URL override): a prefix that a FINISHED request wrote
 * at an explicit cache_control breakpoint is read by the next request with that prefix. Every
 * other route is BEST-EFFORT: OpenAI-style automatic prefix caching (codex, opencode on OpenAI
 * or DeepSeek) and Claude Code through OpenRouter can read 0 even right after a warm-up, because
 * prompt_cache_key / provider routing decides which machine sees the request.
 */
export function cacheIsDeterministic({ harness, provider } = {}) {
  if (harness === 'cc') return true;                                  // retrieval bench: subscription only
  if (harness === 'claudecode') return provider === 'anthropic';      // task bench: the direct route only
  return false;
}

/**
 * Run-level fairness check. `rows` are scored rows carrying { arm, startedAtMs,
 * firstRequestCacheRead }. The unit is each arm's FIRST WAVE: its first `wave` rollouts by start
 * time, i.e. the rollouts launched together when the arm starts (pass the run's concurrency).
 * One request is the wrong unit: concurrent rollouts each pay their own cold write (r282: all
 * three first-wave requests of a cold arm read 0), so one warm request can hide two cold ones.
 *   coldRequests = first-wave first requests that read 0 from cache; coldShare = cold / measured
 *   arm status   = 'cold' (all 0), 'warm' (none 0), 'mixed'
 * MISMATCH = arms with a different coldShare.
 *   deterministic: true  (Claude Code on Anthropic) -> status 'violation'. After a warm-up every
 *     first-wave request must read the shared prefix; a cold one means its arm was not warmed
 *     like the other.
 *   deterministic: false (codex, opencode, OpenRouter; the default) -> status 'warning'. Recorded
 *     and printed, never fatal: such a cache can read 0 after a warm-up for routing reasons alone.
 * An arm with no measurable first request is 'unavailable' and never causes a mismatch.
 */
export function cacheFairness(rows, { wave = 3, deterministic = false } = {}) {
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
    const coldRequests = reads.filter(x => x === 0).length;
    arms[arm] = {
      status: coldRequests === reads.length ? 'cold' : coldRequests === 0 ? 'warm' : 'mixed',
      wave: first.length, measured: measured.length,
      firstRequestCacheRead: reads, coldRequests, coldShare: +(coldRequests / reads.length).toFixed(4),
    };
  }
  const known = Object.entries(arms).filter(([, a]) => a.status !== 'unavailable');
  const mode = deterministic ? 'deterministic' : 'best-effort';
  const desc = known.map(([k, a]) => `${k} ${a.coldRequests}/${a.measured} cold, reads [${a.firstRequestCacheRead.join(',')}]`).join('; ');
  let status, message;
  if (known.length < 2) {
    status = 'incomplete';
    message = `cache fairness: cannot compare (${known.length} arm(s) with a measured first request: ${Object.keys(arms).map(a => `${a}=${arms[a].status}`).join(', ') || 'none'})`;
  } else if (new Set(known.map(([, a]) => a.coldShare)).size > 1) {
    status = deterministic ? 'violation' : 'warning';
    message = deterministic
      ? `CACHE UNFAIR: the arms' first waves started with different cache state (${desc}). Cost columns of this run are not comparable.`
      : `cache fairness WARNING (best-effort cache, not fatal): the arms' first waves read the cache differently (${desc}). Provider routing alone can do this; read the cost columns with it in mind.`;
  } else {
    status = 'ok';
    message = `cache fairness ok (${mode}): every arm's first wave had the same cold share (${desc})`;
  }
  return { status, mode, enforced: deterministic, message, wave, arms };
}

/** A banner a human cannot miss. A best-effort mismatch prints a plain warning block. */
export function fairnessBanner(f) {
  if (f.status === 'warning') return `\n*** ${f.message}\n*** per arm: ${JSON.stringify(f.arms)}\n`;
  if (f.status !== 'violation') return f.message;
  const bar = '!'.repeat(78);
  return `\n${bar}\n*** ${f.message}\n*** per arm: ${JSON.stringify(f.arms)}\n${bar}\n`;
}

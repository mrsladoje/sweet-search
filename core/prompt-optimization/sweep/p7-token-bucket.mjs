/**
 * Phase 7 — TPM-aware token-bucket scheduler (§7.7).
 *
 * CRITICAL: RPM-only concurrency math is wrong.  TPM is typically the binding
 * constraint at lower tiers.  GPT-5.5 Tier 1: 500 RPM but only 30,000 TPM.
 * At ~12K in / 2K out per agent run, naive RPM=500 would allow 30 concurrent
 * calls — 30 × 12K = 360K tokens in flight = 12× over the 30K TPM ceiling.
 * That storms minute-one with 429s.
 *
 * Correct formula (§7.7):
 *   max_calls_per_min = floor(min(RPM, ITPM/estIn, OTPM/estOut))
 *   max_concurrent    = ceil(max_calls_per_min × avg_call_seconds / 60)
 *
 * `createTokenBucket` maintains rolling 1-min windows for requests AND
 * tokens.  `acquire` blocks (await) until both budgets allow the call.
 * An injected `now()` clock + overridable `_setSleep` make it testable
 * without real sleeping.
 *
 * Rate tables are exported as `RATE_LIMITS` (§14).
 */

import { EVENT_KINDS } from './p7-shared.mjs';

// ─── rate tables (§14) ───────────────────────────────────────────────────────

/**
 * §14.1 Anthropic Sonnet 4.6 tiers.
 * §14.2 OpenAI GPT-5.5-instant tiers.
 *
 * Keys: 1-based tier numbers matching the published qualification ladder.
 * Anthropic has separate itpm/otpm; OpenAI uses a single tpm for both.
 */
export const RATE_LIMITS = Object.freeze({
  anthropic_sonnet_4_6: Object.freeze({
    1: Object.freeze({ rpm: 50,    itpm: 30_000,      otpm: 8_000 }),
    2: Object.freeze({ rpm: 1_000, itpm: 450_000,     otpm: 90_000 }),
    3: Object.freeze({ rpm: 2_000, itpm: 800_000,     otpm: 160_000 }),
    4: Object.freeze({ rpm: 4_000, itpm: 2_000_000,   otpm: 400_000 }),
  }),
  openai_gpt5_5: Object.freeze({
    1: Object.freeze({ rpm: 500,    tpm: 30_000 }),
    2: Object.freeze({ rpm: 5_000,  tpm: 450_000 }),
    3: Object.freeze({ rpm: 5_000,  tpm: 800_000 }),
    4: Object.freeze({ rpm: 10_000, tpm: 2_000_000 }),
    5: Object.freeze({ rpm: 10_000, tpm: 30_000_000 }),
  }),
});

// ─── pure sizing math ────────────────────────────────────────────────────────

/**
 * Compute the maximum number of calls per minute given the rate limits and
 * estimated token sizes per call.  `otpm` / `estOut` are optional — when
 * absent the output-token constraint is not applied.
 *
 * Pure function: no side-effects, no I/O.
 *
 * @param {{ rpm: number, itpm: number, otpm?: number, estIn: number, estOut?: number }} p
 * @returns {number}
 */
export function maxCallsPerMin({ rpm, itpm, otpm, estIn, estOut }) {
  if (!estIn || estIn <= 0) throw new RangeError('maxCallsPerMin: estIn must be a positive number');

  const candidates = [rpm];

  if (itpm !== undefined && itpm > 0) {
    candidates.push(itpm / estIn);
  }
  if (otpm !== undefined && otpm > 0 && estOut !== undefined && estOut > 0) {
    candidates.push(otpm / estOut);
  }

  return Math.floor(Math.min(...candidates));
}

/**
 * Given calls/min and average call duration in seconds, compute the maximum
 * number of concurrent in-flight calls so we don't exceed the rate limit.
 *
 * Pure function.
 *
 * @param {{ callsPerMin: number, avgCallSeconds: number }} p
 * @returns {number}
 */
export function maxConcurrent({ callsPerMin, avgCallSeconds }) {
  return Math.ceil(callsPerMin * avgCallSeconds / 60);
}

// ─── token bucket factory ────────────────────────────────────────────────────

/**
 * Create a rolling-window token bucket that enforces both RPM and TPM limits.
 *
 * Injectable seams:
 *   - `now` — time source; defaults to `Date.now`.  Override for testing.
 *   - `_setSleep(fn)` — replace the internal sleep used for blocking.
 *     Injected fn receives `ms` and should advance the fake clock.
 *   - `onThrottle(event)` — called when a throttle pause is needed.
 *
 * @param {{
 *   rpm?: number,
 *   itpm?: number,
 *   otpm?: number,
 *   estIn?: number,
 *   estOut?: number,
 *   now?: () => number,
 *   onThrottle?: (ev: object) => void,
 * }} opts
 */
export function createTokenBucket({
  rpm,
  itpm,
  otpm,
  estIn = 12_000,
  estOut = 2_000,
  now = () => Date.now(),
  onThrottle,
} = {}) {
  const WINDOW_MS = 60_000;

  // Append-only log of consumed capacity; oldest entries first.
  // Each entry: { ts: number, requests: 1, inTokens: number, outTokens: number }
  let entries = [];

  let throttledMs = 0;
  let _sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Filter entries to the active rolling window ending at `nowTs`. */
  function activeEntries(nowTs) {
    const cutoff = nowTs - WINDOW_MS;
    // prune stale entries in-place for memory efficiency
    entries = entries.filter((e) => e.ts > cutoff);
    return entries;
  }

  /**
   * Compute how many ms we must wait before this call can proceed.
   * Returns 0 if all budgets are available now.
   */
  function computeWait(nowTs, inTokens, outTokens) {
    // Guard: if a single call cannot fit even a completely empty window
    // (e.g. inTokens > itpm), waiting would never help — proceed immediately
    // rather than deadlock.  Such an oversized call is a config/sizing error
    // that the caller surfaces elsewhere; the bucket must not hang on it.
    if (
      (rpm && 1 > rpm) ||
      (itpm && inTokens > itpm) ||
      (otpm && outTokens > otpm)
    ) {
      return 0;
    }

    const active = activeEntries(nowTs);

    let rReq = 0;
    let rIn = 0;
    let rOut = 0;
    for (const e of active) {
      rReq += e.requests;
      rIn  += e.inTokens;
      rOut += e.outTokens;
    }

    const fits = () =>
      (!rpm  || rReq + 1    <= rpm)  &&
      (!itpm || rIn  + inTokens  <= itpm) &&
      (!otpm || rOut + outTokens <= otpm);

    if (fits()) return 0;

    // Walk entries oldest-first; each time we remove one, check if we can
    // proceed once it rolls off the window.
    for (const e of active) {
      rReq -= e.requests;
      rIn  -= e.inTokens;
      rOut -= e.outTokens;

      if (fits()) {
        // We can proceed after this entry's timestamp exits the window.
        return Math.max(1, e.ts + WINDOW_MS - nowTs);
      }
    }

    // Worst case: the entire window must clear.
    return WINDOW_MS;
  }

  /**
   * Block asynchronously until both token and request budgets allow the call,
   * then record consumption.
   *
   * The recorded entry initially holds the *estimated* token counts (or whatever
   * `inTokens`/`outTokens` the caller passed). After the real API call returns,
   * the caller SHOULD invoke `reconcile({ inTokens, outTokens })` to swap the
   * estimate for the measured actuals so the rolling-window accounting reflects
   * reality (see M3). Usage pattern:
   *
   *     await bucket.acquire({ inTokens: estIn, outTokens: estOut, target });
   *     const usage = await runCall(...);
   *     bucket.reconcile({ inTokens: usage.input_tokens, outTokens: usage.output_tokens });
   *
   * @param {{ inTokens?: number, outTokens?: number, target?: string }} opts
   * @returns {{ ts: number, requests: number, inTokens: number, outTokens: number }}
   *   The recorded entry reference (also the bucket's most-recent entry, which
   *   `reconcile` adjusts in place).
   */
  async function acquire({ inTokens = estIn, outTokens = estOut, target } = {}) {
    let wait = computeWait(now(), inTokens, outTokens);
    while (wait > 0) {
      throttledMs += wait;
      if (onThrottle) {
        onThrottle({ _kind: EVENT_KINDS.RATE_LIMIT_THROTTLED, target, wait_ms: wait });
      }
      await _sleep(wait);
      wait = computeWait(now(), inTokens, outTokens);
    }
    // Record this call's consumption at the current timestamp.
    const entry = { ts: now(), requests: 1, inTokens, outTokens };
    entries.push(entry);
    return entry;
  }

  /**
   * M3 — actuals reconciliation. Adjust the MOST-RECENTLY-recorded entry's
   * token counts from the static estimate charged at `acquire` time to the
   * measured actuals returned by the API call. This keeps the rolling-window
   * TPM accounting honest: heavy multi-file probes that under-count at estimate
   * time get corrected upward (so the next `acquire` throttles appropriately),
   * and light probes get corrected downward (so we don't over-throttle).
   *
   * Operates on the entry passed in `entry` (the value `acquire` returned) —
   * REQUIRED for correctness under concurrency, where the last-pushed entry may
   * belong to another in-flight call. When `entry` is omitted it falls back to
   * the last entry pushed (back-compatible with the sequential caller). Guarded
   * against no prior `acquire`: empty/absent → no-op returning `null` (never throws).
   *
   * Either token field may be omitted to leave that dimension unchanged.
   *
   * @param {{ inTokens?: number, outTokens?: number, entry?: object }} actuals
   * @returns {{ ts: number, requests: number, inTokens: number, outTokens: number } | null}
   *   The adjusted entry, or `null` if there was no entry to reconcile.
   */
  function reconcile({ inTokens, outTokens, entry = null } = {}) {
    const target = entry ?? (entries.length === 0 ? null : entries[entries.length - 1]);
    if (!target) return null;
    if (inTokens !== undefined && inTokens !== null) target.inTokens = inTokens;
    if (outTokens !== undefined && outTokens !== null) target.outTokens = outTokens;
    return target;
  }

  /** Return rolling-window stats at the current instant. */
  function stats() {
    const nowTs = now();
    const active = activeEntries(nowTs);
    let windowRequests = 0;
    let windowInTokens = 0;
    let windowOutTokens = 0;
    for (const e of active) {
      windowRequests  += e.requests;
      windowInTokens  += e.inTokens;
      windowOutTokens += e.outTokens;
    }
    return { windowRequests, windowInTokens, windowOutTokens, throttledMs };
  }

  /** Override the internal sleep function.  Used exclusively in unit tests. */
  function _setSleep(fn) {
    _sleep = fn;
  }

  /**
   * M2 — serialize the rolling-window state to a JSON-safe snapshot so a
   * resumed run can re-seed in-flight token accounting (else a fresh bucket
   * believes it has a full budget and bursts `max_concurrent` immediately →
   * the §7.7 Tier-1 "429-storm minute one").
   *
   * Prunes stale entries first so the snapshot only carries entries still
   * inside the active window at serialize time. Returns a deep copy — mutating
   * the snapshot does not affect the live bucket.
   *
   * @returns {{ entries: Array<{ ts: number, requests: number, inTokens: number, outTokens: number }>, throttledMs: number }}
   */
  function serialize() {
    const active = activeEntries(now());
    return {
      entries: active.map((e) => ({
        ts: e.ts,
        requests: e.requests,
        inTokens: e.inTokens,
        outTokens: e.outTokens,
      })),
      throttledMs,
    };
  }

  /**
   * M2 — restore rolling-window state from a `serialize()` snapshot. Re-seeds
   * `entries` (and `throttledMs`), pruning anything already outside the window
   * relative to the current `now()` (timestamps from the persisted run may be
   * old). Replaces any existing state.
   *
   * Tolerant of partial/missing snapshots: a falsy `state`, or one lacking
   * `entries`, is treated as an empty restore (no throw).
   *
   * @param {{ entries?: Array<{ ts: number, requests?: number, inTokens?: number, outTokens?: number }>, throttledMs?: number }} state
   */
  function restore(state) {
    const cutoff = now() - WINDOW_MS;
    const incoming = (state && Array.isArray(state.entries)) ? state.entries : [];
    entries = incoming
      .filter((e) => e && typeof e.ts === 'number' && e.ts > cutoff)
      .map((e) => ({
        ts: e.ts,
        requests: e.requests ?? 1,
        inTokens: e.inTokens ?? 0,
        outTokens: e.outTokens ?? 0,
      }));
    if (state && typeof state.throttledMs === 'number') {
      throttledMs = state.throttledMs;
    }
  }

  /**
   * M2 — pessimistic resume guard. Fills the current rolling window with
   * synthetic max load (at `now()`) sufficient that the next `acquire` is
   * throttled for ~one `WINDOW_MS`. This is the safe default the resume caller
   * invokes when no serialized state is available (or in addition to it): a
   * resumed run is forced into a one-window cooldown so it cannot burst
   * `max_concurrent` against limits that may already be consumed by the
   * interrupted run's in-flight calls.
   *
   * The synthetic load saturates whichever limits are configured (rpm / itpm /
   * otpm) so that a single subsequent `acquire(estIn/estOut)` cannot fit until
   * these entries roll off the window. All synthetic entries are stamped at the
   * current `now()`, so they expire exactly `WINDOW_MS` later.
   *
   * Additive to whatever entries already exist; does not clear prior state.
   */
  function primeForResume() {
    const ts = now();
    // Saturate each configured limit so the next normal-sized acquire must wait
    // for these entries to age out (~WINDOW_MS).
    const synthRequests = rpm && rpm > 0 ? rpm : 1;
    const synthIn = itpm && itpm > 0 ? itpm : 0;
    const synthOut = otpm && otpm > 0 ? otpm : 0;
    entries.push({
      ts,
      requests: synthRequests,
      inTokens: synthIn,
      outTokens: synthOut,
    });
  }

  return { acquire, reconcile, stats, serialize, restore, primeForResume, _setSleep };
}

// ─── convenience: recommendConcurrency ──────────────────────────────────────

/**
 * Compute recommended concurrency for a known provider + tier combination.
 *
 * @param {{
 *   provider: 'anthropic' | 'openai',
 *   tier: number,
 *   estIn?: number,
 *   estOut?: number,
 *   avgCallSeconds?: number,
 * }} opts
 * @returns {{ callsPerMin: number, concurrent: number }}
 */
export function recommendConcurrency({
  provider,
  tier,
  estIn = 12_000,
  estOut = 2_000,
  avgCallSeconds = 15,
} = {}) {
  if (provider === 'anthropic') {
    const limits = RATE_LIMITS.anthropic_sonnet_4_6[tier];
    if (!limits) throw new RangeError(`recommendConcurrency: unknown Anthropic tier ${tier}`);
    const callsPerMin = maxCallsPerMin({
      rpm: limits.rpm,
      itpm: limits.itpm,
      otpm: limits.otpm,
      estIn,
      estOut,
    });
    return { callsPerMin, concurrent: maxConcurrent({ callsPerMin, avgCallSeconds }) };
  }

  if (provider === 'openai') {
    const limits = RATE_LIMITS.openai_gpt5_5[tier];
    if (!limits) throw new RangeError(`recommendConcurrency: unknown OpenAI tier ${tier}`);
    // OpenAI uses a single tpm for both input and output; bind on input tokens.
    const callsPerMin = maxCallsPerMin({ rpm: limits.rpm, itpm: limits.tpm, estIn });
    return { callsPerMin, concurrent: maxConcurrent({ callsPerMin, avgCallSeconds }) };
  }

  throw new RangeError(`recommendConcurrency: unknown provider "${provider}" (anthropic|openai)`);
}

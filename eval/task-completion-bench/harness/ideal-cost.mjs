// idealCost recovery — single source of truth (2026-07-09).
// Cache-normalized cost recovered from codex per-turn `token_count` events:
//   newly-seen input $5/M + re-sent prefix $0.5/M + output $30/M.
// idealCost normalizes OUT cache-TTL luck (all re-sent prefix charged at the
// cache-hit rate regardless of whether the provider cache actually hit), so A/B
// cost deltas reflect trajectory shape, not cache fortune. Both the collection
// path (codex-task-runner) AND the smoke analyzer (analyze-ab-smoke) import from
// here, so the first-class rows.json column can NEVER drift from the analyzer.
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const PRICE = { in: 5.0, cache: 0.5, out: 30.0 };  // openai/gpt-5.5 (OpenRouter)

// Per-model USD/MTok. `cache` is the cache-READ (hit) rate — idealCost charges
// every re-sent prefix token at that rate by construction, so a model's
// cache-WRITE rate never enters this math.
//
// The delta between arms is NOT price-invariant: ideal weights newIn/resent/out
// by this vector, so pricing one backbone at another's rates silently distorts
// the efficiency-at-parity headline (a model with pricier output penalizes the
// more verbose arm). Register a backbone here before running it.
export const MODEL_PRICES = {
  'openai/gpt-5.5': { in: 5.0, cache: 0.5, out: 30.0 },   // OpenRouter, 2026-06-02
  // Anthropic list pricing (cache read = 0.1x input). NOTE: $2/$10 introductory
  // pricing runs through 2026-08-31 — list is used here so published cost
  // figures stay valid past the promo window; disclose if intro rates are used.
  'claude-sonnet-5': { in: 3.0, cache: 0.3, out: 15.0 },
  // Held-out-run backbones, priced at the ACTUAL OpenRouter rates we pay (all four route
  // via OpenRouter — realized cost must reflect the paid rate). Fetched from OpenRouter
  // /api/v1/models 2026-07-23 (prompt / completion / input_cache_read, $ per 1M tokens).
  'anthropic/claude-sonnet-5': { in: 2.0, cache: 0.20, out: 10.0 },   // OpenRouter intro ($2/$10) — what we pay via the Anthropic skin
  'x-ai/grok-4.5': { in: 2.0, cache: 0.30, out: 6.0 },
  'meta/muse-spark-1.1': { in: 1.25, cache: 0.15, out: 4.25 },
  // Re-fetched from OpenRouter /api/v1/models 2026-08-04 after OpenAI's 2026-07-30
  // 80% Luna cut (announced $0.20/$1.20; OpenRouter serves $0.10/$0.60).
  'openai/gpt-5.6-luna': { in: 0.10, cache: 0.01, out: 0.60 },
};

// Fail loudly rather than silently billing an unregistered backbone at gpt-5.5's
// rates — an unpriced model is a bench defect, not a default.
export function priceFor(model) {
  const p = MODEL_PRICES[model];
  if (!p) throw new Error(`ideal-cost: no pricing registered for model "${model}" — add it to MODEL_PRICES before running it`);
  return p;
}

// Per-turn cost recovery. `turns` = [{in, cached, out, holeAt?}] in trajectory order, where
// `in` is the FULL context size at that turn (the growing prefix). newIn is the
// positive delta (context added this turn); the remainder is prior context re-sent.
//
// THREE COLUMNS, and picking the wrong one has already nearly shipped a loss:
//
//   idealUsd       cache-NORMALIZED. Charges every re-sent token at the cache rate by
//                  construction, so provider cache luck (TTL, replica routing, run timing)
//                  cannot pollute an A/B. Correct for any lever that only APPENDS to context.
//   realFromTurns  what the provider actually billed. Polluted by cache luck at smoke scale.
//   breakPricedUsd cache-normalized AND aware that prompt caching is a PREFIX cache.
//
// WHY breakPricedUsd EXISTS (measured 2026-08-10, lever #3 eviction $0 gate). Deleting or
// reordering anything mid-conversation invalidates every cached token after it, so the next
// request re-pays the FULL input rate for the whole surviving suffix — 10x the cache-read rate
// on Luna. idealUsd cannot see that: it charges the re-send at the cache rate no matter what
// happened to the prefix. On a 32K-cap eviction replay idealUsd scored **+7.7% saved** while the
// policy actually **lost 12.3%**. Read on idealUsd alone, that lever ships as a win.
//
// So: ANY lever that deletes, evicts, reorders, compacts or rewrites prior context must be read
// on breakPricedUsd. Append-only levers (prompt/frame/format/retrieval-payload changes) are
// unaffected — the two columns are identical there, by construction, which is why this is safe
// to print by default.
//
// `holeAt` is the token position of the EARLIEST place the context was changed this turn. A lever
// that rewrites context should report it; the cost is then exact. Without it, a turn whose context
// shrank is priced pessimistically (nothing provably survived the cache), which is deliberate — it
// makes an unreported rewrite look expensive rather than free.
export function costFromTurns(turns, price = PRICE) {
  let ideal = 0, real = 0, breakPriced = 0, prevIn = 0, rewrites = 0;
  for (const tu of turns) {
    const newIn = Math.max(0, tu.in - prevIn);   // context added this turn
    const resent = tu.in - newIn;                // prior context re-sent
    ideal += (newIn * price.in + resent * price.cache + tu.out * price.out) / 1e6;   // ideal cache
    real += ((tu.in - tu.cached) * price.in + tu.cached * price.cache + tu.out * price.out) / 1e6;  // actual cache

    // longest prefix PROVABLY still cache-valid after whatever happened to the context
    let cacheable;
    if (tu.holeAt != null) { cacheable = Math.min(tu.holeAt, tu.in); rewrites++; }
    else if (tu.in < prevIn) { cacheable = 0; rewrites++; }   // shrank, position unreported
    else cacheable = Math.min(prevIn, tu.in);                 // append-only: same as ideal
    breakPriced += ((tu.in - cacheable) * price.in + cacheable * price.cache + tu.out * price.out) / 1e6;

    prevIn = tu.in;
  }
  return { idealUsd: ideal, realFromTurnsUsd: real, breakPricedUsd: breakPriced, contextRewrites: rewrites };
}

// Per-turn token usage from a codex rollout jsonl (token_count → last_token_usage).
export function turnsFromRollout(file) {
  const turns = [];
  let lines; try { lines = readFileSync(file, 'utf8').split('\n'); } catch { return turns; }
  for (const l of lines) {
    if (!l) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    const p = o.payload || {}; const t = p.type || o.type;
    if (t === 'token_count' && p.info?.last_token_usage) {
      const u = p.info.last_token_usage;
      turns.push({ in: u.input_tokens || 0, cached: u.cached_input_tokens || 0, out: (u.output_tokens || 0) + (u.reasoning_output_tokens || 0) });
    }
  }
  return turns;
}

// session_meta.cwd — bounded read of the FIRST line (session_meta is line 1) so
// scanning many rollout files stays cheap. The real session_meta line embeds the
// full agent system prompt (base_instructions.text) and can be tens of KB, so a
// full JSON.parse of a truncated read fails; instead regex-extract the first
// "cwd":"…" key, which the payload emits BEFORE base_instructions (~byte 150).
// Reads up to 64 KB — enough to reach cwd on any real rollout. Returns '' on miss.
export function rolloutCwd(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(65536);
    const n = readSync(fd, buf, 0, buf.length, 0);
    let chunk = buf.slice(0, n).toString('utf8');
    const nl = chunk.indexOf('\n');
    if (nl !== -1) chunk = chunk.slice(0, nl);        // stay within the first line
    const m = chunk.match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    return m ? m[1].replace(/\\(["\\/])/g, '$1') : '';
  } catch { return ''; }
  finally { if (fd !== undefined) { try { closeSync(fd); } catch { /* */ } } }
}

export function sessionsDirDefault() {
  return process.env.CODEX_SESSIONS || path.join(os.homedir(), '.codex/sessions');
}

// Find the rollout jsonl whose session_meta.cwd === rundir (exact), newest match,
// restricted to files modified at/after sinceMs. With sinceMs = run-start the
// mtime filter usually leaves exactly this run's file, so the cwd read is O(1).
export function findRolloutForRundir(rundir, { sinceMs = 0, sessionsDir } = {}) {
  const root = sessionsDir || sessionsDirDefault();
  let best = null, bestM = -1;
  const walk = (d) => {
    let ents; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const pth = path.join(d, e.name);
      if (e.isDirectory()) { walk(pth); continue; }
      if (!e.name.endsWith('.jsonl')) continue;
      let s; try { s = statSync(pth); } catch { continue; }
      if (s.mtimeMs < sinceMs) continue;
      if (s.mtimeMs > bestM && rolloutCwd(pth) === rundir) { best = pth; bestM = s.mtimeMs; }
    }
  };
  walk(root);
  return best;
}

// Recover idealCost for a completed run directory. Returns nulls (never throws)
// when no rollout is found, so a missing session degrades gracefully to the
// existing realized-cost column instead of aborting collection.
//
// `turns` stays a COUNT for backwards compatibility with the existing row column;
// `turnList` is the array itself, which the caller persists (PLAN.md §3 B1 / P7) —
// the rollout jsonl lives in a per-rollout codex home that is deleted with the run,
// so this is the only chance to keep it.
export function recoverIdealCost(rundir, { sinceMs = 0, sessionsDir, price = PRICE } = {}) {
  const rolloutFile = findRolloutForRundir(rundir, { sinceMs, sessionsDir });
  if (!rolloutFile) return { idealCostUsd: null, realFromTurnsUsd: null, breakPricedCostUsd: null, contextRewrites: 0, rolloutFile: null, turns: 0, turnList: [] };
  const turns = turnsFromRollout(rolloutFile);
  const { idealUsd, realFromTurnsUsd, breakPricedUsd, contextRewrites } = costFromTurns(turns, price);
  return {
    idealCostUsd: +idealUsd.toFixed(6), realFromTurnsUsd: +realFromTurnsUsd.toFixed(6),
    breakPricedCostUsd: +breakPricedUsd.toFixed(6), contextRewrites,
    rolloutFile, turns: turns.length, turnList: turns,
  };
}

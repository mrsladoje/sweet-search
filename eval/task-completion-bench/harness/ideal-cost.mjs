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

// Per-turn cost recovery. `turns` = [{in, cached, out}] in trajectory order, where
// `in` is the FULL context size at that turn (the growing prefix). newIn is the
// positive delta (context added this turn); the remainder is prior context re-sent.
export function costFromTurns(turns) {
  let ideal = 0, real = 0, prevIn = 0;
  for (const tu of turns) {
    const newIn = Math.max(0, tu.in - prevIn);   // context added this turn
    const resent = tu.in - newIn;                // prior context re-sent
    ideal += (newIn * PRICE.in + resent * PRICE.cache + tu.out * PRICE.out) / 1e6;   // ideal cache
    real += ((tu.in - tu.cached) * PRICE.in + tu.cached * PRICE.cache + tu.out * PRICE.out) / 1e6;  // actual cache
    prevIn = tu.in;
  }
  return { idealUsd: ideal, realFromTurnsUsd: real };
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
export function recoverIdealCost(rundir, { sinceMs = 0, sessionsDir } = {}) {
  const rolloutFile = findRolloutForRundir(rundir, { sinceMs, sessionsDir });
  if (!rolloutFile) return { idealCostUsd: null, realFromTurnsUsd: null, rolloutFile: null, turns: 0 };
  const turns = turnsFromRollout(rolloutFile);
  const { idealUsd, realFromTurnsUsd } = costFromTurns(turns);
  return { idealCostUsd: +idealUsd.toFixed(6), realFromTurnsUsd: +realFromTurnsUsd.toFixed(6), rolloutFile, turns: turns.length };
}

// Per-turn token accounting — PLAN.md §3 B1 / §6 lever P7 (measurement hygiene).
//
// WHY THIS EXISTS: every adapter already computes a `turns` array of
// {in, cached, cacheWrite, out} on its way to a cost column, and every adapter then threw it
// away, keeping only four scalars. The 2026-07 held-out forensics therefore had to
// recover the re-sent prefix R and the cache-read total C *algebraically* from
// (naive, ideal, real) — which works, but leaves fresh input and output entangled
// inside the single `naive` term. Separating them required reading the raw OpenCode
// SQLite DB after the fact. Persisting the array costs a few KB per rollout and makes
// the next forensics pass exact instead of algebraic.
//
// FORMAT — one JSONL file per rollout, at
//   results/<RUN_ID>/turns/<task>-<arm>.jsonl
// Line 1 is a meta record; lines 2..n are one record per model turn, in trajectory
// order. JSONL (not a JSON array) on purpose: the last run's `c1/rows.json` was
// truncated mid-object by a crash and had to be hand-repaired (§3 B2). A line-oriented
// file loses at most the final turn.
//
//   {"kind":"meta","label":"…","task":"…","arm":"sweet","harness":"opencode",
//    "model":"x-ai/grok-4.5","price":{"in":2,"cache":0.3,"out":6},
//    "source":"stream|rollout-jsonl|aggregate","turns":97}
//   {"t":1,"in":12043,"cached":0,"cacheWrite":1024,"out":312}
//
// FIELD SEMANTICS (identical in all adapters — this is the contract forensics reads):
//   in     = FULL input context at that turn (the growing prefix), cached tokens INCLUDED
//   cached = the part of `in` the provider served from cache (a cache READ)
//   cacheWrite = the part of `in` written to provider cache (billed at the
//                provider's write premium; zero when the provider omits it)
//   out    = output + reasoning tokens
// `source` records how the numbers were obtained, because they are not equally exact:
//   stream        — per-turn usage events from the agent CLI's own stream (exact)
//   rollout-jsonl — per-turn token_count events from a codex rollout file (exact)
//   aggregate     — no per-turn data available; ONE synthetic record carrying the
//                   run total. Do not treat an aggregate log as a turn distribution.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BENCH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const safe = (s) => String(s || 'rollout').replace(/[^\w.@-]/g, '_');

/** results/<RUN_ID>/turns — flat, one file per rollout, cheap to glob in analysis. */
export function turnsDir() {
  return path.join(BENCH_DIR, 'results', process.env.RUN_ID || 'adhoc', 'turns');
}

/**
 * Write one rollout's per-turn usage. Best-effort by construction: measurement
 * plumbing must never be able to fail a rollout that otherwise completed.
 * Returns the path relative to the bench dir (for the row's `turnsFile`), or null.
 */
export function persistTurns(label, turns, meta = {}) {
  const list = Array.isArray(turns) ? turns : [];
  if (!list.length) return null;
  try {
    const dir = turnsDir();
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${safe(label)}.jsonl`);
    const lines = [JSON.stringify({ kind: 'meta', label, ...meta, turns: list.length })];
    list.forEach((tu, i) => lines.push(JSON.stringify({
      t: i + 1, in: tu.in || 0, cached: tu.cached || 0,
      cacheWrite: tu.cacheWrite || 0, out: tu.out || 0,
    })));
    writeFileSync(file, lines.join('\n') + '\n');
    return path.relative(BENCH_DIR, file);
  } catch { return null; }
}

/** Read a turn log back. Returns {meta, turns:[{in,cached,cacheWrite,out}]}; never throws. */
export function readTurnLog(file) {
  const abs = path.isAbsolute(file) ? file : path.join(BENCH_DIR, file);
  let text; try { text = readFileSync(abs, 'utf8'); } catch { return { meta: null, turns: [] }; }
  let meta = null; const turns = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }   // tolerate a truncated tail
    if (o.kind === 'meta') { meta = o; continue; }
    turns.push({ in: o.in || 0, cached: o.cached || 0,
      cacheWrite: o.cacheWrite || 0, out: o.out || 0 });
  }
  return { meta, turns };
}

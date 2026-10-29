// The search daemon's start history: .sweet-search/daemon-starts.jsonl. The daemon appends
// one line when its index load ends (ready or failed), so `sweet-search status` can show how
// often the daemon started again and how long each start took. Many starts in a day mean
// something stops the daemon (on WSL: the distribution shuts down when no terminal is open).

import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const DAEMON_STARTS_FILE = 'daemon-starts.jsonl';
/** The file keeps the last KEEP_STARTS lines. */
export const KEEP_STARTS = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Append one start record; best-effort (a read-only state dir only loses the history). */
export function recordDaemonStart(stateDir, entry) {
  const file = path.join(stateDir, DAEMON_STARTS_FILE);
  try {
    appendFileSync(file, `${JSON.stringify(entry)}\n`);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    if (lines.length > KEEP_STARTS * 2) {
      // A new file, renamed over the old one: a reader never sees a half-written file.
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, `${lines.slice(-KEEP_STARTS).join('\n')}\n`);
      renameSync(tmp, file);
    }
  } catch { /* best-effort */ }
}

export function readDaemonStarts(stateDir) {
  let text = '';
  try { text = readFileSync(path.join(stateDir, DAEMON_STARTS_FILE), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const e = JSON.parse(line);
      if (Number.isFinite(e?.startedAt)) out.push(e);
    } catch { /* torn line */ }
  }
  return out.slice(-KEEP_STARTS);
}

/** Starts in the last 24 hours and their index-load times. Pure. */
export function summarizeDaemonStarts(entries, nowMs = Date.now()) {
  const recent = entries.filter((e) => nowMs - e.startedAt <= DAY_MS);
  const loads = recent.map((e) => e.loadMs).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    startsLast24h: recent.length,
    failedLast24h: recent.filter((e) => e.ok === false).length,
    medianLoadMs: loads.length ? loads[Math.floor((loads.length - 1) / 2)] : null,
    slowestLoadMs: loads.length ? loads[loads.length - 1] : null,
  };
}

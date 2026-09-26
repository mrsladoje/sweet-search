// Proposed runner helper (both arms): opencode's `run --format json` stream carries only the
// MAIN session's step_finish events; a task-tool subagent runs in a child session whose steps
// reach the session DB only. Read them so the cost basis is sidechain-inclusive (the same rule
// the Claude Code ledger follows). Read-only; a missing/locked DB returns [] (row then says so).
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function opencodeSubagentTurns(ocData, mainSessionID) {
  const file = path.join(ocData, 'opencode.db');
  if (!mainSessionID || !existsSync(file)) return { turns: [], sessions: [], error: 'no-db' };
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    // descendants of the main session (a subagent may itself delegate)
    const sessions = db.prepare(`WITH RECURSIVE d(id, agent) AS (
        SELECT id, agent FROM session WHERE parent_id = ?
        UNION ALL SELECT s.id, s.agent FROM session s JOIN d ON s.parent_id = d.id)
      SELECT id, agent FROM d`).all(mainSessionID);
    const turns = [];
    const q = db.prepare(`SELECT data FROM part WHERE session_id = ? AND json_extract(data, '$.type') = 'step-finish' ORDER BY time_created, id`);
    for (const s of sessions) {
      for (const { data } of q.all(s.id)) {
        const tk = JSON.parse(data).tokens || {};
        const cache = tk.cache || {};
        const cRead = cache.read || 0, cWrite = cache.write || 0;
        turns.push({ in: (tk.input || 0) + cRead + cWrite, cached: cRead, cacheWrite: cWrite,
          out: (tk.output || 0) + (tk.reasoning || 0), sidechain: true, agent: s.agent });
      }
    }
    return { turns, sessions: sessions.map(s => s.agent) };
  } catch (e) {
    return { turns: [], sessions: [], error: String(e.message || e).slice(0, 200) };
  } finally { try { db?.close(); } catch {} }
}

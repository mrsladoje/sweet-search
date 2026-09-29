/**
 * Opt-in pid ledger for the resident processes a benchmark harness causes to start.
 *
 * WHY. The warm search daemon (`sweet-search-daemon`) and the reconcile maintainer
 * (`sweet-search-maintainer`) are spawned DETACHED (own session, ppid 1 once the
 * parent exits), so killing an agent's process tree never reaches them. On macOS
 * the harness cannot find them afterwards either: both retitle themselves, which
 * overwrites the argv/environ block, so `ps -E` shows no SWEET_SEARCH_PROJECT_ROOT
 * and there is no /proc/<pid>/environ. The only remaining per-run signal — which
 * files a process holds open — is absent for a daemon that has not finished
 * loading its index, and a maintainer spawned after the harness took its process
 * snapshot is missed outright. Both leaked maintainers into later bench cells.
 *
 * WHAT. When `SWEET_SEARCH_SPAWN_LEDGER_DIR` is set (only the bench sets it), every
 * daemon/maintainer records its pid in `<dir>/<hash of project root>.pids`:
 *   - the PARENT records the child pid right after `spawn()` returns, and
 *   - the child records ITSELF at startup,
 * so a process is on the ledger whichever of the two gets there first. The env var
 * is inherited down the whole chain (harness → ss-* shim → daemon → maintainer →
 * successor maintainer), so no spawn site needs to know about the bench.
 *
 * Unset (every non-bench use), every function here is a no-op: nothing is written,
 * nothing is read, and behaviour is unchanged.
 */
import { appendFileSync, mkdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const SPAWN_LEDGER_ENV = 'SWEET_SEARCH_SPAWN_LEDGER_DIR';

function canonicalRoot(root) {
  const resolved = path.resolve(String(root));
  try { return realpathSync(resolved); } catch { return resolved; }
}

/** The ledger file for one project root inside a ledger dir. */
export function spawnLedgerFile(dir, projectRoot) {
  if (!projectRoot) return path.join(dir, '_noroot.pids');
  const key = createHash('sha256').update(canonicalRoot(projectRoot)).digest('hex').slice(0, 16);
  return path.join(dir, `${key}.pids`);
}

/**
 * Pid namespace of this process (Linux), or null. Recorded so a reaper outside a
 * pid-namespaced jail never acts on a pid that only means something inside it.
 */
export function currentPidNamespace() {
  if (process.platform !== 'linux') return null;
  try { return readlinkSync('/proc/self/ns/pid'); } catch { return null; }
}

/**
 * Append one pid to the ledger. Never throws; a no-op unless the env var is set.
 *
 * @param {{ pid: number, role: string, projectRoot?: string, env?: NodeJS.ProcessEnv }} entry
 */
export function recordSpawn({ pid, role, projectRoot, env = process.env }) {
  const dir = env?.[SPAWN_LEDGER_ENV];
  if (!dir || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    const root = projectRoot || env.SWEET_SEARCH_PROJECT_ROOT || '';
    mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ pid, role, by: process.pid, ns: currentPidNamespace(), root, t: Date.now() });
    appendFileSync(spawnLedgerFile(dir, root), line + '\n');
    return true;
  } catch {
    return false;
  }
}

/** Parse a ledger file; malformed lines are skipped. Missing file → []. */
export function readSpawnLedger(file) {
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (Number.isInteger(e?.pid) && e.pid > 0) out.push(e);
    } catch { /* torn or foreign line */ }
  }
  return out;
}

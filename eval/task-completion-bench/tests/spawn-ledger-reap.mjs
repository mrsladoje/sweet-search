// Regression coverage for the leaked-maintainer teardown fix (2026-09-29, hc-queue3).
// Standalone, zero spend, no model: `node tests/spawn-ledger-reap.mjs`.
//
// Real processes: a detached maintainer started through core's own launchMaintainer (the
// parent-side ledger record), a detached self-recording process whose parent is gone
// (ppid 1, cwd elsewhere — the exact shape of the orphan), and an "owner" daemon started
// WITHOUT the ledger env, which must survive. Stubbed: the in-flight spawn race, the
// pid-reuse guard and the pid-namespace guard.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchMaintainer } from '../../../core/indexing/maintainer-launcher.mjs';
import { recordSpawn, readSpawnLedger } from '../../../core/infrastructure/spawn-ledger.js';
import {
  SPAWN_LEDGER_ENV, spawnLedgerFile, reapSpawnLedger, reapSpawnLedgerSync, reapLedgerDir, processComm,
} from '../harness/spawn-ledger-reap.mjs';

const LEDGER_MOD = fileURLToPath(new URL('../../../core/infrastructure/spawn-ledger.js', import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), 'ss-spawn-ledger-'));
let ok = true;
const assert = (c, name, detail = '') => { console.log(`${c ? '  ✓' : '  ✗'} ${name}${c ? '' : `  ${detail}`}`); if (!c) ok = false; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(50); } return fn(); }
const cleanup = [];

try {
  const ledgerDir = path.join(dir, 'ledger');
  const rundir = path.join(dir, 'runs', 'r0-1');
  mkdirSync(path.join(rundir, '.sweet-search'), { recursive: true });
  const file = spawnLedgerFile(ledgerDir, rundir);
  const benchEnv = { ...process.env, [SPAWN_LEDGER_ENV]: ledgerDir, SWEET_SEARCH_PROJECT_ROOT: rundir, SWEET_SEARCH_MAINTAINER_BG_PRIORITY: '0' };

  // 1. Unset env → no-op (every non-bench use).
  const noEnv = { ...process.env }; delete noEnv[SPAWN_LEDGER_ENV];
  assert(recordSpawn({ pid: process.pid, role: 'x', env: noEnv }) === false, 'recordSpawn is a no-op without the env var');

  // 2. Parent-side record from core's real launcher.
  const fakeMaint = path.join(dir, 'fake-maintainer.mjs');
  writeFileSync(fakeMaint, "process.title='sweet-search-maintainer'; setInterval(()=>{},1000);\n");
  const res = launchMaintainer({ env: benchEnv, cwd: rundir, maintainerEntry: fakeMaint });
  assert(res.spawned && Number.isInteger(res.pid), 'launchMaintainer spawned the (fake) maintainer', JSON.stringify({ reason: res.reason }));
  if (res.pid) cleanup.push(res.pid);
  assert(readSpawnLedger(file).some((e) => e.pid === res.pid && e.role === 'maintainer'), 'launcher recorded the child pid under the rundir ledger');

  // 3. Orphan shape: detached, parent exits, child self-records then retitles, cwd elsewhere.
  const orphanScript = path.join(dir, 'orphan.mjs');
  writeFileSync(orphanScript, `import { recordSpawn } from ${JSON.stringify(LEDGER_MOD)};\nprocess.title='sweet-search-maintainer';\nrecordSpawn({ pid: process.pid, role: 'maintainer-self' });\nsetInterval(()=>{},1000);\n`);
  const orphan = spawn(process.execPath, [orphanScript], { detached: true, stdio: 'ignore', cwd: dir, env: benchEnv });
  orphan.unref(); cleanup.push(orphan.pid);
  await waitFor(() => readSpawnLedger(file).some((e) => e.pid === orphan.pid));
  assert(readSpawnLedger(file).some((e) => e.pid === orphan.pid), 'detached child self-recorded under the rundir ledger');

  // 4. Owner daemon: same title, NO ledger env → never listed, must survive.
  const ownerScript = path.join(dir, 'owner.mjs');
  writeFileSync(ownerScript, "process.title='sweet-search-daemon'; setInterval(()=>{},1000);\n");
  const owner = spawn(process.execPath, [ownerScript], { detached: true, stdio: 'ignore', env: noEnv });
  owner.unref(); cleanup.push(owner.pid);
  await waitFor(() => processComm(owner.pid) === 'sweet-search-daemon');

  await waitFor(() => processComm(res.pid) === 'sweet-search-maintainer' && processComm(orphan.pid) === 'sweet-search-maintainer');
  const killed = await reapSpawnLedger(file, { settleMs: 100 });
  await waitFor(() => !alive(res.pid) && !alive(orphan.pid));
  assert(!alive(res.pid), 'reap killed the launcher-spawned maintainer');
  assert(!alive(orphan.pid), 'reap killed the self-recorded orphan');
  assert(alive(owner.pid), "reap left the owner's (unlisted) daemon alive");
  assert(killed.length === 2, 'reap reports exactly the two bench processes', JSON.stringify(killed));

  // 5. In-flight spawn: a pid appended DURING teardown (after the first read) is still reaped.
  const f2 = spawnLedgerFile(ledgerDir, path.join(dir, 'runs', 'r0-2'));
  mkdirSync(ledgerDir, { recursive: true });
  appendFileSync(f2, JSON.stringify({ pid: 111111, role: 'daemon', ns: null }) + '\n');
  const k5 = []; let slept = 0;
  await reapSpawnLedger(f2, {
    comm: () => 'sweet-search-daemon', kill: (pid) => k5.push(pid),
    sleep: async () => { if (slept++ === 0) appendFileSync(f2, JSON.stringify({ pid: 222222, role: 'maintainer', ns: null }) + '\n'); },
  });
  assert(k5.includes(111111) && k5.includes(222222), 'a maintainer recorded mid-teardown is reaped on the re-read', JSON.stringify(k5));

  // 6. Pid-reuse guard + namespace guard.
  const f3 = path.join(ledgerDir, 'guards.pids');
  writeFileSync(f3, [
    JSON.stringify({ pid: 333333, role: 'daemon', ns: null }),
    JSON.stringify({ pid: 444444, role: 'daemon', ns: 'pid:[4026531836-other]' }),
    'not json',
  ].join('\n') + '\n');
  const k6 = [];
  reapSpawnLedgerSync(f3, { comm: (pid) => (pid === 333333 ? 'zsh' : 'sweet-search-daemon'), kill: (pid) => k6.push(pid) });
  assert(k6.length === 0, 'reused pid (foreign comm) and foreign-namespace pid are both left alone', JSON.stringify(k6));

  // 7. End-of-pool sweep removes the ledger dir.
  await reapLedgerDir(ledgerDir, { comm: () => null, kill: () => {}, sleep: async () => {} });
  let gone = false; try { readSpawnLedger(file); gone = readSpawnLedger(file).length === 0; } catch { gone = true; }
  assert(gone, 'end-of-pool sweep drops the ledger dir');
} finally {
  for (const pid of cleanup) { try { process.kill(pid, 'SIGKILL'); } catch { /* */ } }
  rmSync(dir, { recursive: true, force: true });
}
console.log(ok ? 'spawn-ledger-reap: ALL PASS' : 'spawn-ledger-reap: FAIL');
process.exit(ok ? 0 : 1);

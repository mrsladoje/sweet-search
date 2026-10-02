// Coverage for the retrieval-bench teardown (2026-10-03): stop the ss-* daemons and maintainers
// whose project root is one of a run's clone dirs, and nothing else.
// Standalone, zero spend, no model:
//   node eval/task-completion-bench/tests/reap-clone-roots.mjs                 # unit checks
//   node eval/task-completion-bench/tests/reap-clone-roots.mjs --live <repo>   # + real warm-up daemons
//   ... --live <repo> --no-ledger   # the open-file matcher alone (a daemon started without the ledger env)
// --live clones <repo> (APFS clone, index included) into a temp dir, starts its daemon through the
// bench's own warm-up path (`ss-search warmup -k 1`, ledger env set), calls reapRoots for that clone
// only, and checks that no daemon/maintainer of the clone is left while every other one stays alive.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SPAWN_LEDGER_ENV, rootOwningOpenFiles, reapByOpenFiles, reapRoots, listOurDaemons,
} from '../harness/spawn-ledger-reap.mjs';

let ok = true;
const assert = (c, name, detail = '') => { console.log(`${c ? '  ✓' : '  ✗'} ${name}${c ? '' : `  ${detail}`}`); if (!c) ok = false; };

// 1. Root matching (pure).
{
  const roots = ['/x/r282-repos/cell-tag/eval__repos__gin', '/x/r282-repos/cell-tag/__warmup__'];
  const lsof = (...paths) => ['p123', 'fcwd', 'n/', ...paths.flatMap(p => ['f12', `n${p}`])].join('\n');
  assert(rootOwningOpenFiles(lsof('/x/r282-repos/cell-tag/eval__repos__gin/.sweet-search/meta.db'), roots) === roots[0], 'a file in the clone index matches its root');
  assert(rootOwningOpenFiles(lsof('/x/r282-repos/cell-tag/__warmup__/.sweet-search/vectors.db'), roots) === roots[1], 'the warm-up clone matches too');
  assert(rootOwningOpenFiles(lsof('/x/r282-repos/cell-tag/eval__repos__gin2/.sweet-search/meta.db'), roots) === null, 'a sibling dir with the same prefix does not match');
  assert(rootOwningOpenFiles(lsof('/x/r282-repos/cell-tag-other/eval__repos__gin/.sweet-search/meta.db'), ['/x/r282-repos/cell-tag']) === null, 'another tag of the same cell does not match its clone root');
  assert(rootOwningOpenFiles(lsof('/x/r282-repos/cell-tag/eval__repos__gin/.sweet-search/meta.db'), ['/x/r282-repos/cell-tag']) === '/x/r282-repos/cell-tag', 'the clone root itself owns every clone below it');
  assert(rootOwningOpenFiles(lsof('/Users/u/project/.sweet-search/meta.db', '/usr/lib/libc.dylib'), roots) === null, "the owner's daemon of another project does not match");
  assert(rootOwningOpenFiles('', roots) === null && rootOwningOpenFiles(null, roots) === null, 'no lsof output (process gone) matches nothing');
  assert(rootOwningOpenFiles(`p1\nn${roots[0]}`, roots) === roots[0], 'an open handle on the root dir itself matches');
}

// 2. reapByOpenFiles kills only matching pids (stubbed processes).
{
  const procs = [{ pid: 11, comm: 'sweet-search-daemon' }, { pid: 12, comm: 'sweet-search-maintainer' }, { pid: 13, comm: 'sweet-search-maintainer' }];
  const files = { 11: 'n/run/a/.sweet-search/x.db', 12: 'n/other/.sweet-search/x.db', 13: 'n/run/b/.sweet-search/hnsw.bin' };
  const killedPids = [];
  const killed = reapByOpenFiles(['/run/a', '/run/b'], { list: () => procs, openFiles: (pid) => files[pid], kill: (pid) => killedPids.push(pid) });
  assert(JSON.stringify(killedPids) === '[11,13]', 'only the processes under the run roots are killed', JSON.stringify(killedPids));
  assert(killed.every(k => k.root && k.comm), 'each kill reports its root and command name');
}

// 3. Live: the bench warm-up path on one temp clone.
const liveIdx = process.argv.indexOf('--live');
if (liveIdx !== -1) {
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const src = path.resolve(process.argv[liveIdx + 1] || '');
  const dir = mkdtempSync(path.join(tmpdir(), 'ss-reap-live-'));
  const clone = path.join(dir, 'clone');
  const ledgerDir = path.join(dir, 'ledger');
  mkdirSync(ledgerDir);
  const othersBefore = listOurDaemons().map(p => p.pid);
  try {
    execFileSync('cp', ['-c', '-p', '-R', src, clone]);
    const SS_BIN = path.join(REPO, 'eval/agent-read-workflows/bin');
    const env = { ...process.env, [SPAWN_LEDGER_ENV]: ledgerDir, SWEET_SEARCH_PROJECT_ROOT: clone, SWEET_SEARCH_OFFLINE: '1', PATH: `${SS_BIN}:${process.env.PATH}` };
    const t0 = Date.now();
    try { execFileSync(path.join(SS_BIN, 'ss-search'), ['warmup', '-k', '1'], { cwd: clone, env, stdio: 'ignore', timeout: 180000 }); } catch (e) { console.log(`  (warm-up exited: ${e.message.split('\n')[0]})`); }
    console.log(`  warm-up took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    await new Promise(r => setTimeout(r, 3000)); // let the daemon start its maintainer
    const ours = () => listOurDaemons().filter(p => !othersBefore.includes(p.pid));
    const started = ours();
    console.log(`  started for the clone: ${started.map(p => `${p.comm}(${p.pid})`).join(', ') || 'none'}`);
    assert(started.length > 0, 'the warm-up started at least one daemon/maintainer for the clone');
    const noLedger = process.argv.includes('--no-ledger');
    const killed = await reapRoots({ ledgerDir: noLedger ? null : ledgerDir, roots: [clone] });
    console.log(`  reaped: ${killed.map(k => `${k.comm}(${k.pid})`).join(', ') || 'none'}`);
    await new Promise(r => setTimeout(r, 1500));
    const left = ours();
    assert(left.length === 0, 'no daemon or maintainer of the clone is left', JSON.stringify(left));
    const othersAfter = listOurDaemons().map(p => p.pid);
    const othersGone = othersBefore.filter(pid => !othersAfter.includes(pid));
    assert(othersGone.every(pid => !killed.some(k => k.pid === pid)), `processes of other roots were not touched (${othersBefore.length} before)`, JSON.stringify(othersGone));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);

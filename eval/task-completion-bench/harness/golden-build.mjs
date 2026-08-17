#!/usr/bin/env node
// golden-build.mjs — standalone golden-template builder for the AGENT-FREE
// lockdown-off window (bench-net-lockdown.sh's documented golden pre-warm flow;
// run-pilot can't do this itself: SS_BENCH_ALLOW_NET=1 would flip the env-ledger
// fingerprint to legacy-open and fail pre-flight). Mirrors run-pilot.mjs
// prepareGolden EXACTLY — same cache key, same validity check, same fresh-init
// and indexer invocation — so the shard run gets pure golden-cache hits.
// Sequential by design (indexer discipline: one repo at a time per machine).
// Usage: node golden-build.mjs --tasks <specs.json> --ids id1,id2 [--min-free-gb 15]
import { execSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBaseCommit, writeProvenance, verifyGolden, provenanceNote, provenanceIsFatal } from './golden-provenance.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const INDEXER = path.join(ROOT, 'core/indexing/index-codebase-v21.js');
const GOLDEN_DIR = path.join(process.env.HOME, '.ss-eval', 'golden');
const MIN_FREE_GB = +arg('min-free-gb', 15);
const TASKS = arg('tasks'); const IDS = (arg('ids', '') || '').split(',').map(s => s.trim()).filter(Boolean);
if (!TASKS || !IDS.length) { console.error('usage: golden-build.mjs --tasks <specs.json> --ids id1,id2'); process.exit(2); }

const specs = JSON.parse(readFileSync(TASKS, 'utf8'));
const cacheKeyFor = (t) => `${t.repo.replace('/', '__')}@${t.base_commit}`;
const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
const freeGb = () => { try { return +execSync("df -BG --output=avail / | tail -1", { encoding: 'utf8' }).replace(/[^0-9]/g, ''); } catch { return 0; } };

// --clone-only: clone/checkout/fresh-init, no indexing (fast; needs the lockdown-off
// window). --index-existing: index a dir already cloned via --clone-only (no network;
// safe to run with the lockdown armed, even alongside an agent run — inline golden
// indexing during runs is run-pilot's original design).
const CLONE_ONLY = process.argv.includes('--clone-only');
const INDEX_EXISTING = process.argv.includes('--index-existing');
let built = 0, cached = 0, failed = [];
for (const id of IDS) {
  const t = specs.find(s => s.instance_id === id);
  if (!t) { console.error(`[golden-build] ${id}: not in tasks file`); failed.push(id); continue; }
  const key = cacheKeyFor(t);
  const gdir = path.join(GOLDEN_DIR, key);
  if (existsSync(`${gdir}/.sweet-search/codebase.db`) && existsSync(`${gdir}/.git`)) {
    // A cache hit used to be decided by the DIRECTORY NAME alone. The name encodes the base
    // commit, so any directory under the right name was served as that task's base tree
    // whatever was inside it. Check the stamp before trusting it.
    const v = verifyGolden(GOLDEN_DIR, key, { baseCommit: t.base_commit, gdir });
    console.log(`[golden-build] ${id}: cached — ${provenanceNote(v)}`);
    if (provenanceIsFatal(v)) { console.error(`[golden-build] ${id}: REFUSING the cached golden — rebuild it`); failed.push(id); continue; }
    cached++; continue;
  }
  const free = freeGb();
  if (free < MIN_FREE_GB) { console.error(`[golden-build] STOP: disk ${free}G < ${MIN_FREE_GB}G before ${id}`); failed.push(id); break; }
  const t0 = Date.now();
  try {
    if (!INDEX_EXISTING) {
      console.log(`[golden-build] ${id}: cloning (${t.repo}@${t.base_commit.slice(0, 8)}, disk ${free}G free)`);
      rmSync(gdir, { recursive: true, force: true }); mkdirSync(gdir, { recursive: true });
      sh(`git clone --quiet https://github.com/${t.repo}.git ${gdir}`);
      sh(`git -C ${gdir} checkout --quiet ${t.base_commit}`);
      // Assert BEFORE the fresh-init below, which is the only window in which the answer is
      // knowable: `rm -rf .git` destroys every trace of which commit this tree came from.
      const sourceTreeHash = assertBaseCommit(gdir, t.base_commit);
      // fresh-init: drop history so no future-fix commit/ref is reachable by the agent
      sh(`rm -rf ${gdir}/.git && git -C ${gdir} init -q && printf '.sweet-search/\\n' > ${gdir}/.git/info/exclude && git -C ${gdir} add -A && git -C ${gdir} -c user.email=a@b.c -c user.name=bench commit -q -m base`);
      writeProvenance(GOLDEN_DIR, key, { repo: t.repo, baseCommit: t.base_commit, sourceTreeHash, gdir });
    }
    if (CLONE_ONLY) { console.log(`[golden-build] ${id}: cloned in ${((Date.now() - t0) / 60000).toFixed(1)}m (index deferred)`); built++; continue; }
    if (INDEX_EXISTING && !existsSync(`${gdir}/.git`)) throw new Error('no cloned dir to index (run --clone-only first)');
    console.log(`[golden-build] ${id}: indexing (disk ${free}G free)`);
    const idxTimeout = Number(process.env.GOLDEN_TIMEOUT_MS) || 5400000;
    execFileSync('node', [INDEXER, '--full', '--sqlite-fast', '--concurrency=1'],
      { env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: gdir, SWEET_SEARCH_RECONCILE_V2: '0', SWEET_SEARCH_WATCH: '0' }, stdio: 'ignore', timeout: idxTimeout });
    console.log(`[golden-build] ${id}: built in ${((Date.now() - t0) / 60000).toFixed(1)}m`);
    built++;
  } catch (e) {
    // keep the clone on an index failure when indexing in place (retryable);
    // a failed CLONE leaves nothing behind
    if (!INDEX_EXISTING) rmSync(gdir, { recursive: true, force: true });
    else rmSync(path.join(gdir, '.sweet-search'), { recursive: true, force: true });
    console.error(`[golden-build] ${id}: FAILED — ${String(e.message).slice(0, 160)}`);
    failed.push(id);
  }
}
console.log(`[golden-build] DONE: ${built} built, ${cached} cached, ${failed.length} failed${failed.length ? ' (' + failed.join(', ') + ')' : ''}`);
process.exit(failed.length ? 1 : 0);

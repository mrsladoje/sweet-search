#!/usr/bin/env node
// Put the task's installed dependencies on disk, where a real checkout would have them.
//
// WHY THIS EXISTS. The agent works on a bare git checkout. `site-packages`, `node_modules`
// and friends live only inside the `run_tests` container, which the agent never reads. So
// when a rollout reasons "the contract is defined in pytest, let me go look", the answer is
// simply not on the filesystem — the recorded `ModuleNotFoundError` in codex/pytask/native r0
// is that, exactly. Both arms are affected, and it makes the whole question of dependency
// reach untestable: you cannot measure whether an agent consults installed source when the
// source is absent.
//
// This is REALISM RESTORATION, not a treatment. A developer's tree has its dependencies in
// it. So it runs for BOTH arms or neither — handing sweet a corpus native physically cannot
// see would manufacture the fake differential the slate forbids.
//
// TWO RULES THE IMPLEMENTATION FOLLOWS.
//
//   1. ASK THE TOOLCHAIN, NEVER GUESS A PATH. The P1 gate found the pytask image carries
//      SEVEN `site-packages` roots — the task's own plus six conda toolchain trees — and a
//      path-walking probe buried the real dependency in the toolchain that happens to share
//      its extension. `site.getsitepackages()` returns exactly one root, the right one.
//      Every ecosystem has that call; a hardcoded path list is how this goes wrong.
//
//   2. LAND THEM WHERE THE ECOSYSTEM PUTS THEM. Python goes to `.venv/lib/pythonX.Y/
//      site-packages`, Node to `node_modules/` at the repo root. Those are the layouts an
//      ordinary `grep -r` and an ordinary developer both expect, so nothing has to be told
//      about a bespoke directory.
//
// NEITHER THE INDEX NOR THE PATCH SEES THEM. The paths are written to `.git/info/exclude`,
// which `git check-ignore` honours — so the sweet indexer skips them through its normal
// gitignore alignment, and `git diff HEAD` never reports them (they are untracked anyway).
// The graded patch is unchanged by construction.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DOCKER_HOST = process.env.DOCKER_HOST || '';
const dockerEnv = () => ({ ...process.env, ...(DOCKER_HOST ? { DOCKER_HOST } : {}) });

// One extraction per image, reused by every arm and rep of that task.
const CACHE = process.env.SS_DEPS_CACHE || path.join(process.env.HOME || '/root', '.ss-eval/dep-cache');

// Discovery runs INSIDE the image with no network. Each recipe prints `dest<TAB>src` lines:
// where the tree should land inside the checkout, and where it lives in the image.
const RECIPES = {
  python: String.raw`
    P=$(command -v python3 || command -v python) || exit 0
    "$P" - <<'PY' 2>/dev/null
import site, sys, os
v = f"python{sys.version_info.major}.{sys.version_info.minor}"
for p in dict.fromkeys(site.getsitepackages() + [site.getusersitepackages()]):
    if os.path.isdir(p) and os.path.basename(p) == "site-packages":
        print(f".venv/lib/{v}/site-packages\t{p}")
        break
PY`,
  node: String.raw`
    for d in "$PWD/node_modules" /workspace/node_modules /app/node_modules; do
      [ -d "$d" ] && { echo -e "node_modules\t$d"; break; }
    done`,
};

const ECOSYSTEM = { python: 'python', js: 'node', ts: 'node' };

function discover(image, workdir) {
  const eco = ECOSYSTEM[String(workdir.lang || '').toLowerCase()];
  if (!eco) return { eco: null, roots: [], why: `no recipe for language "${workdir.lang}"` };
  let out = '';
  try {
    out = execFileSync('docker', [
      'run', '--rm', '--network', 'none', '-w', workdir.dir || '/', image, 'bash', '-lc', RECIPES[eco],
    ], { env: dockerEnv(), encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { return { eco, roots: [], why: 'discovery failed: ' + String(e.message).split('\n')[0] }; }
  const roots = out.trim().split('\n').filter(Boolean).map((l) => {
    const [dest, src] = l.split('\t');
    return dest && src ? { dest: dest.trim(), src: src.trim() } : null;
  }).filter(Boolean);
  return { eco, roots, why: roots.length ? '' : 'toolchain reported no dependency root' };
}

// Extract once per image into the cache. `docker cp` from a stopped container is the only
// copy that needs no network and no shell inside the image.
function extract(image, roots) {
  const key = image.replace(/[^A-Za-z0-9._-]/g, '_');
  const dir = path.join(CACHE, key);
  if (existsSync(path.join(dir, '.complete'))) return dir;
  mkdirSync(dir, { recursive: true });
  let cid = '';
  try {
    cid = execFileSync('docker', ['create', image, 'true'], { env: dockerEnv(), encoding: 'utf8' }).trim();
    for (const r of roots) {
      const target = path.join(dir, r.dest);
      mkdirSync(path.dirname(target), { recursive: true });
      // `docker cp <cid>:<src>/. <target>` copies the CONTENTS, so the destination keeps the
      // name we chose rather than inheriting the image's own directory name.
      execFileSync('docker', ['cp', `${cid}:${r.src}/.`, target], { env: dockerEnv(), stdio: 'ignore', timeout: 600000 });
    }
    appendFileSync(path.join(dir, '.complete'), roots.map(r => r.dest).join('\n') + '\n');
  } finally {
    if (cid) { try { execFileSync('docker', ['rm', '-f', cid], { env: dockerEnv(), stdio: 'ignore' }); } catch { /* */ } }
  }
  return dir;
}

// `.git/info/exclude` and not `.gitignore`: the latter is tracked, so appending to it would
// show up in the graded diff and change a file the task owns.
function excludeFromGitAndIndex(rundir, dests) {
  const info = path.join(rundir, '.git', 'info');
  if (!existsSync(path.dirname(info))) return;               // native arm still has .git; be safe
  mkdirSync(info, { recursive: true });
  const f = path.join(info, 'exclude');
  const have = existsSync(f) ? readFileSync(f, 'utf8') : '';
  const add = dests.map(d => `/${d.replace(/\/+$/, '')}/`).filter(l => !have.includes(l));
  if (add.length) appendFileSync(f, `\n# installed dependencies, materialised by the bench\n${add.join('\n')}\n`);
}

/**
 * @returns {{ok:boolean, eco:string|null, dests:string[], why:string}}
 */
export function materialiseDeps(task, rundir, { log = () => {} } = {}) {
  const image = task.image_name;
  if (!image) return { ok: false, eco: null, dests: [], why: 'task has no image_name' };
  const { eco, roots, why } = discover(image, { lang: task.language, dir: task.workdir });
  if (!roots.length) { log(`[deps] ${task.instance_id}: ${why}`); return { ok: false, eco, dests: [], why }; }

  const cached = extract(image, roots);
  const dests = [];
  for (const r of roots) {
    const from = path.join(cached, r.dest);
    if (!existsSync(from)) continue;
    const to = path.join(rundir, r.dest);
    mkdirSync(path.dirname(to), { recursive: true });
    execFileSync('cp', ['-a', from, to]);
    dests.push(r.dest);
  }
  excludeFromGitAndIndex(rundir, dests);
  log(`[deps] ${task.instance_id}: ${eco} → ${dests.join(', ') || '(nothing)'}`);
  return { ok: dests.length > 0, eco, dests, why: dests.length ? '' : 'cache empty after extract' };
}

// CLI: materialise into a directory and report, for the $0 verification pass.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [tasksFile, instanceId, dest] = process.argv.slice(2);
  if (!tasksFile || !instanceId || !dest) {
    console.error('usage: dep-materialise.mjs <tasks.json> <instance_id> <dest-dir>');
    process.exit(2);
  }
  const t = JSON.parse(readFileSync(tasksFile, 'utf8')).find(x => x.instance_id === instanceId);
  if (!t) { console.error(`no such task: ${instanceId}`); process.exit(2); }
  console.log(JSON.stringify(materialiseDeps(t, dest, { log: console.log }), null, 1));
}

/**
 * ss-* on the agent's PATH for a project-local install.
 *
 * A global install links the ss-* commands into npm's global bin directory, which is on
 * every shell's PATH. A local install (`npm i -D sweet-search`, then `npx sweet-search
 * init`) links them into `<project>/node_modules/.bin`, which an agent's shell does not
 * have — so the rules told the agent to run commands it could not find.
 *
 * The fix: `init` copies the native binary into a user bin directory that is already on
 * PATH (`~/.local/bin`, then `~/bin`; `SWEET_SEARCH_BIN_DIR` overrides), once per name. The
 * binary dispatches on its name and finds the package from the cwd upward
 * (`<ancestor>/node_modules/sweet-search`), then through the `sweet-search` command on
 * PATH, so one set of copies serves every project on the machine at native speed. When no
 * package is reachable it prints one line and exits 127 — never a hang, never a daemon.
 *
 * Why not the harness configs: Claude Code `env`, Codex `shell_environment_policy.set`
 * and opencode take literal values, so a PATH there would replace the user's PATH instead
 * of extending it. Why not npm's global bin directory: a later `npm i -g sweet-search`
 * would then fail with EEXIST on the files we put there.
 *
 * Ownership: every file written is recorded (path, device, inode, SHA-256) in
 * ~/.cache/sweet-search/user-shims.json. A file is replaced or removed only when it still
 * matches its record, so a user's own `ss-grep` is never touched.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AGENT_TOOLS } from '../core/agent-tools/tools.js';

const MANIFEST_VERSION = 1;

export function shimManifestPath(home = os.homedir()) {
  return path.join(home, '.cache', 'sweet-search', 'user-shims.json');
}

function real(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * The PATH an agent's shell sees. npm and npx put `node_modules/.bin` directories on the
 * PATH of the process they run (this one, under `npx sweet-search init`); an agent's
 * shell has none of them.
 */
export function agentPathDirs(env = process.env) {
  return String(env.PATH || '').split(path.delimiter).filter(Boolean)
    .filter((d) => !/(^|[\\/])node_modules[\\/]\.bin[\\/]?$/.test(d));
}

/** The first file named `name` on `dirs`, or null. */
export function whichOnPath(name, dirs) {
  for (const d of dirs) {
    const p = path.join(d, name);
    try { if (fs.statSync(p).isFile()) return p; } catch { /* not here */ }
  }
  return null;
}

export function readShimManifest(home = os.homedir()) {
  try {
    const m = JSON.parse(fs.readFileSync(shimManifestPath(home), 'utf8'));
    if (m?.version === MANIFEST_VERSION && Array.isArray(m.shims)) return m;
  } catch { /* none, or unreadable: nothing is provably ours */ }
  return { version: MANIFEST_VERSION, shims: [] };
}

function writeShimManifest(home, manifest) {
  const file = shimManifestPath(home);
  if (manifest.shims.length === 0) { fs.rmSync(file, { force: true }); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

/** True when `file` is still exactly the file recorded in `entry`. */
function matchesRecord(file, entry) {
  try {
    const st = fs.lstatSync(file);
    return st.isFile() && st.ino === entry.ino && st.dev === entry.dev && sha256(file) === entry.sha256;
  } catch { return false; }
}

function recordFor(file) {
  const st = fs.statSync(file);
  return { path: file, dev: st.dev, ino: st.ino, sha256: sha256(file) };
}

/** The user bin directory on PATH that takes the copies, or null. */
export function pickUserBinDir({ env = process.env, home = os.homedir() } = {}) {
  if (env.SWEET_SEARCH_BIN_DIR) return path.resolve(env.SWEET_SEARCH_BIN_DIR);
  const onPath = new Set(agentPathDirs(env).map(real));
  for (const dir of [path.join(home, '.local', 'bin'), path.join(home, 'bin')]) {
    if (onPath.has(real(dir))) return dir;
  }
  return null;
}

/**
 * Put the ss-* commands on the agent's PATH when only a local install has them.
 *
 * @param {object} opts
 * @param {string} opts.binary   the verified native binary (speaks the ss-* protocol)
 * @param {string} [opts.packageRoot]  the installed package; an `npx` cache copy is not
 *   one a later shell can find, so it gets no copies
 * @returns {{status: 'not-needed'|'current'|'installed'|'no-dir'|'skipped'|'failed',
 *            dir: string|null, detail: string, conflicts: string[]}}
 */
export function installUserShims({
  binary,
  packageRoot = '',
  env = process.env,
  home = os.homedir(),
  names = Object.keys(AGENT_TOOLS),
} = {}) {
  const manifest = readShimManifest(home);
  const ours = new Map(manifest.shims.map((e) => [e.path, e]));
  const isOurs = (file) => ours.has(file) && matchesRecord(file, ours.get(file));
  const dirs = agentPathDirs(env);
  // Global install (or the user's own commands): every name resolves to a file that is
  // not ours. Nothing to do.
  const firstHits = names.map((n) => whichOnPath(n, dirs));
  if (firstHits.every((hit) => hit && !isOurs(hit))) {
    return { status: 'not-needed', dir: null, detail: 'on PATH', conflicts: [] };
  }
  if (packageRoot.split(path.sep).includes('_npx')) {
    return { status: 'skipped', dir: null, conflicts: [],
      detail: 'an npx run leaves no package an agent\'s shell can use: install sweet-search (npm i -D sweet-search, or -g)' };
  }
  const dir = pickUserBinDir({ env, home });
  if (!dir) {
    return { status: 'no-dir', dir: null, conflicts: [],
      detail: `no user bin directory on PATH (looked for ${path.join(home, '.local', 'bin')} and ${path.join(home, 'bin')})` };
  }
  const want = sha256(binary);
  const conflicts = [];
  let changed = 0;
  let source = null;   // the first copy written in `dir`; the other names hard-link to it
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const name of names) {
      const target = path.join(dir, name);
      const exists = fs.existsSync(target) || (() => { try { fs.lstatSync(target); return true; } catch { return false; } })();
      if (exists && !isOurs(target)) { conflicts.push(target); continue; }
      if (exists && ours.get(target).sha256 === want) { source ??= target; continue; }
      const tmp = `${target}.sweet-search-${process.pid}`;
      fs.rmSync(tmp, { force: true });
      if (source) {
        try { fs.linkSync(source, tmp); } catch { fs.copyFileSync(binary, tmp); }
      } else {
        fs.copyFileSync(binary, tmp);
      }
      fs.chmodSync(tmp, 0o755);
      fs.renameSync(tmp, target);   // atomic: a running agent sees the old file or the new
      source ??= target;
      changed++;
      ours.set(target, recordFor(target));
    }
    // Hard links share an inode: refresh every record so each matches the file on disk.
    for (const name of names) {
      const target = path.join(dir, name);
      if (ours.has(target) && !conflicts.includes(target)) ours.set(target, recordFor(target));
    }
  } catch (err) {
    writeShimManifest(home, { version: MANIFEST_VERSION, shims: [...ours.values()].filter((e) => fs.existsSync(e.path)) });
    return { status: 'failed', dir, conflicts, detail: `${err?.code || err?.message || err} writing ${dir}` };
  }
  writeShimManifest(home, { version: MANIFEST_VERSION, shims: [...ours.values()] });
  const status = changed === 0 ? 'current' : 'installed';
  const detail = conflicts.length
    ? `${dir} (left your own ${conflicts.map((c) => path.basename(c)).join(', ')} in place)`
    : dir;
  return { status, dir, detail, conflicts };
}

/** The recorded copies that are still ours (for the uninstall report). */
export function planUserShimRemovals({ home = os.homedir() } = {}) {
  return readShimManifest(home).shims.filter((e) => matchesRecord(e.path, e)).map((e) => e.path);
}

/**
 * Remove the copies init made. A recorded path whose file changed (the user replaced it)
 * is left in place and forgotten. Returns what was removed and what was kept.
 */
export function removeUserShims({ home = os.homedir(), dryRun = false } = {}) {
  const removed = [];
  const kept = [];
  for (const entry of readShimManifest(home).shims) {
    if (!matchesRecord(entry.path, entry)) {
      try { fs.lstatSync(entry.path); kept.push(entry.path); } catch { /* already gone */ }
      continue;
    }
    if (!dryRun) {
      try { fs.unlinkSync(entry.path); } catch { kept.push(entry.path); continue; }
    }
    removed.push(entry.path);
  }
  if (!dryRun) writeShimManifest(home, { version: MANIFEST_VERSION, shims: [] });
  return { removed, kept };
}

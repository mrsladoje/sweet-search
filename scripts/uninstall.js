#!/usr/bin/env node

/**
 * Sweet Search uninstall — reverses everything `sweet-search init` created.
 *
 * Removes .sweet-search/ config directory and init-managed model cache
 * contents for the current project. Does not touch user source code,
 * indexes, or database files outside of .sweet-search/.
 *
 * Usage:
 *   sweet-search uninstall [--dry-run] [--keep-models] [--purge] [--force]
 */

import { existsSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { getCoremlCascadeRoot, getCoremlCascadeState } from '../core/infrastructure/coreml-cascade.js';
import { PREWARM_HOOK_FILENAME } from './init.js';
import { removeAgentInstructions } from './inject-agent-instructions.js';
import { removeClaudeRules } from './write-claude-rules.js';
import { removePromptReminderHook } from './install-prompt-reminders.js';
import { removeToolEnforcement } from './install-tool-enforcement.js';

// Default paths for the running daemon. Env-overridable so both the prewarm
// hook, the CLI, and this module agree on where to look. Tests pass custom
// values to `stopRunningDaemon` for isolation.
const DEFAULT_PID_FILE = process.env.SWEET_SEARCH_PID_FILE || '/tmp/sweet-search-server.pid';
const DEFAULT_SOCKET_PATH = process.env.SWEET_SEARCH_SOCKET_PATH || '/tmp/sweet-search.sock';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');
const DATA_DIR_NAME = '.sweet-search';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args) {
  const result = { dryRun: false, keepModels: false, purge: false, force: false, help: false };
  for (const arg of args) {
    if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--keep-models') result.keepModels = true;
    else if (arg === '--purge') result.purge = true;
    else if (arg === '--force') result.force = true;
    else if (arg === '--help' || arg === '-h') result.help = true;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Size helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dirSize(dirPath) {
  if (!existsSync(dirPath)) return 0;
  let total = 0;
  try {
    for (const entry of readdirSync(dirPath, { withFileTypes: true, recursive: true })) {
      if (entry.isFile()) {
        try {
          total += statSync(join(entry.parentPath || entry.path, entry.name)).size;
        } catch { /* skip unreadable files */ }
      }
    }
  } catch { /* skip unreadable dirs */ }
  return total;
}

// ---------------------------------------------------------------------------
// Project root detection (same logic as init.js)
// ---------------------------------------------------------------------------

function detectProjectRoot(cwd = process.cwd()) {
  let dir = cwd;
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return cwd;
}

// ---------------------------------------------------------------------------
// Model cache resolution (same defaults as core/config.js)
// ---------------------------------------------------------------------------

import { homedir } from 'node:os';

function resolveModelCacheRoot() {
  if (process.env.SWEET_SEARCH_MODEL_CACHE) {
    return process.env.SWEET_SEARCH_MODEL_CACHE;
  }
  return join(homedir(), '.cache', 'sweet-search', 'models');
}

function getModelCacheDirs(initConfig) {
  const cacheRoot = resolveModelCacheRoot(initConfig);
  const dirs = [];

  if (!initConfig || !initConfig.models) return dirs;

  // Collect cache dirs for models that init managed
  for (const [key, info] of Object.entries(initConfig.models)) {
    if (info.cacheDir && existsSync(info.cacheDir)) {
      dirs.push({ key, path: info.cacheDir, size: dirSize(info.cacheDir) });
    }
  }

  return dirs;
}

/**
 * Collect the CoreML cascade cache dir for removal. Unlike model
 * cache dirs (which are per-hfId under the managed root), the
 * cascade lives at a single managed location
 * `{modelCacheRoot}/coreml-cascade/` and contains:
 *   - embed/   (six .mlpackage dirs + six sibling .mlmodelc caches)
 *   - li/      (six .mlpackage dirs + six sibling .mlmodelc caches)
 *
 * rm -rf'ing the cascade root cleans everything including the
 * compiled .mlmodelc siblings that `coreml_shim.m` wrote next to
 * each source `.mlpackage`.
 *
 * If the cascade was never built (common: ineligible hardware,
 * --skip-coreml-cascade, opt-out) the root doesn't exist and we
 * return an empty array — uninstall doesn't print a "removing 0 B"
 * line.
 */
export function getCoremlCascadeRemovals() {
  const removals = [];
  try {
    const root = getCoremlCascadeRoot();
    if (existsSync(root)) {
      const state = getCoremlCascadeState();
      // Sum across all advertised families — embed + standard LI + LI-edge.
      // The earlier label only counted embed + standard LI (12 on the
      // shipping spec) which contradicted init's "18 variants ready"
      // (6 embed + 6 LI + 6 LI-edge). `liEdgeTotal` is 0 on hosts whose
      // spec doesn't advertise the edge family, so older specs still
      // collapse to the prior 12-count behaviour without ceremony.
      const totalAll = state.embedTotal + state.liTotal + state.liEdgeTotal;
      const presentAll = state.embedPresent + state.liPresent + state.liEdgePresent;
      const label = state.complete
        ? `coreml cascade (${totalAll} variants complete)`
        : `coreml cascade (${presentAll}/${totalAll} variants partial)`;
      removals.push({ label, path: root, size: dirSize(root), type: 'coreml-cascade' });
    }
  } catch {
    // Cascade module failed to load — no cascade to remove. Silent.
  }
  return removals;
}

/**
 * Stop any daemon that an earlier SessionStart prewarm hook spawned.
 *
 * Strategy:
 *   1. Best-effort graceful stop via `node core/cli.js --stop`. If a daemon
 *      is listening on the socket and the CLI can reach it, it shuts down.
 *   2. Robust fallback: if the PID file exists and its PID is still alive,
 *      SIGKILL it directly. This covers stuck daemons, mismatched CLI
 *      versions, and any failure mode where the graceful path silently
 *      doesn't work.
 *   3. Unlink the PID file and socket file regardless, so the next hook
 *      invocation starts from a clean state.
 *
 * Returns `{ gracefulAttempted, killed, pidFileRemoved, socketRemoved }`.
 * Never throws — every branch swallows errors (daemon may simply not exist).
 */
export function stopRunningDaemon({
  projectRoot,
  pidFile = DEFAULT_PID_FILE,
  socketPath = DEFAULT_SOCKET_PATH,
} = {}) {
  const result = { gracefulAttempted: false, killed: false, pidFileRemoved: false, socketRemoved: false };

  // 1. Graceful stop via CLI. Use an absolute path to core/cli.js so this
  // works for npm-installed users (their projectRoot has no core/cli.js —
  // only the package root does).
  const cliPath = join(PACKAGE_ROOT, 'core', 'cli.js');
  if (existsSync(cliPath)) {
    try {
      execSync(`node ${JSON.stringify(cliPath)} --stop`, {
        cwd: projectRoot || PACKAGE_ROOT,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
        env: { ...process.env, SWEET_SEARCH_SOCKET_PATH: socketPath },
      });
      result.gracefulAttempted = true;
    } catch {
      // Daemon not running, CLI not reachable, timeout — all fine.
    }
  }

  // 2. Fallback: SIGKILL via PID file.
  if (existsSync(pidFile)) {
    try {
      const pid = Number(readFileSync(pidFile, 'utf-8').trim());
      if (Number.isFinite(pid) && pid > 0) {
        try {
          process.kill(pid, 0); // probe — throws if dead
          process.kill(pid, 'SIGKILL');
          result.killed = true;
        } catch { /* already dead */ }
      }
    } catch { /* unreadable pid file */ }
    try { unlinkSync(pidFile); result.pidFileRemoved = true; } catch { /* ignore */ }
  }

  // 3. Remove stale socket file.
  if (existsSync(socketPath)) {
    try { unlinkSync(socketPath); result.socketRemoved = true; } catch { /* ignore */ }
  }

  return result;
}

const MAINTAINER_LOCK_FILENAME = 'index-maintainer.lock';

/** Synchronous sleep (uninstall is one-shot; a sub-second block is fine). */
function sleepSyncMs(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* ignore */ }
}

/** Is this pid alive right now? EPERM (foreign owner) counts as alive. */
function pidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

/**
 * Stop a reconcile-v2 incremental-index maintainer that an earlier SessionStart
 * prewarm hook auto-launched. The maintainer records its pid in
 * `<stateDir>/index-maintainer.lock`.
 *
 * Strategy:
 *   1. SIGTERM for a clean shutdown (the daemon flushes + releases its lock).
 *   2. Escalate to SIGKILL if it is still alive after a short grace. Its tick
 *      interval can be up to 5 minutes — far longer than uninstall can wait —
 *      so we do not block for graceful exit. Maintainer writes are atomic
 *      temp+rename, so a SIGKILL is crash-safe (validated by the RC soak +
 *      crash probe).
 *   3. Remove the lock file so the next start is clean.
 *
 * Never throws — every branch swallows errors (the daemon may not be running).
 *
 * Returns `{ present, pid, signalled, killed, lockRemoved }`.
 */
export function stopRunningMaintainer({
  projectRoot,
  stateDir = projectRoot ? join(projectRoot, DATA_DIR_NAME) : null,
} = {}) {
  const result = { present: false, pid: null, signalled: false, killed: false, lockRemoved: false };
  if (!stateDir) return result;
  const lockFile = join(stateDir, MAINTAINER_LOCK_FILENAME);
  if (!existsSync(lockFile)) return result;
  result.present = true;

  let pid = null;
  try { pid = Number(JSON.parse(readFileSync(lockFile, 'utf-8')).pid); } catch { pid = null; }

  if (pidAlive(pid)) {
    result.pid = pid;
    try { process.kill(pid, 'SIGTERM'); result.signalled = true; } catch { /* ignore */ }
    sleepSyncMs(300);
    if (pidAlive(pid)) {
      try { process.kill(pid, 'SIGKILL'); result.killed = true; } catch { /* ignore */ }
    }
  }

  try { unlinkSync(lockFile); result.lockRemoved = true; } catch { /* ignore */ }
  return result;
}

/**
 * Remove the index-maintainer daemon hook init copied into
 * `.claude/hooks/index-maintainer.mjs`. Only removes the file when it
 * matches the bytes init shipped — never deletes a user-modified file
 * we don't own. The marker is the source path: init does
 * `copyFileSync(<pkg>/core/indexing/index-maintainer.mjs, dest)`, so
 * we compare destination bytes to the package source.
 *
 * Returns `{ status, detail }`:
 *   not-found  — file absent (nothing to do)
 *   removed    — file removed (matched shipped bytes)
 *   skipped    — file present but contents differ (user-modified) — left intact
 *   dry-run    — found the file but skipped the delete
 *   error      — rm or read failed; uninstall continues
 */
export function removeIndexMaintainerHook(projectRoot, { dryRun = false } = {}) {
  const hookPath = join(projectRoot, '.claude', 'hooks', 'index-maintainer.mjs');
  if (!existsSync(hookPath)) {
    return { status: 'not-found', detail: 'no .claude/hooks/index-maintainer.mjs' };
  }

  // Only remove when the bytes match the version init shipped — refuses to
  // delete a hook the user has customized. Failing the byte compare is a
  // soft skip, not an error.
  const shippedPath = join(PACKAGE_ROOT, 'core', 'indexing', 'index-maintainer.mjs');
  let bytesMatch = false;
  try {
    if (existsSync(shippedPath)) {
      const a = readFileSync(hookPath);
      const b = readFileSync(shippedPath);
      bytesMatch = a.length === b.length && a.equals(b);
    }
  } catch {
    // Read errored on either side — treat as "don't remove, surface the
    // file path so the user can clean up manually if they want to".
    return { status: 'skipped', detail: `cannot compare bytes (${hookPath})` };
  }

  if (!bytesMatch) {
    return {
      status: 'skipped',
      detail: `${hookPath} differs from shipped version — leaving in place (delete manually if intended)`,
    };
  }

  if (dryRun) {
    return { status: 'dry-run', detail: hookPath };
  }

  try {
    unlinkSync(hookPath);
    // Best-effort: prune the parent .claude/hooks/ if it's now empty (we
    // own the file, not the directory; only delete if WE made it empty).
    try {
      const parent = dirname(hookPath);
      const entries = readdirSync(parent);
      if (entries.length === 0) rmdirSync(parent);
    } catch { /* ignore — sibling files exist or rmdir failed */ }
    return { status: 'removed', detail: hookPath };
  } catch (err) {
    return { status: 'error', detail: err.message };
  }
}

/**
 * Remove the sweet-search /sweet-index skill from `.claude/skills/sweet-index/`.
 * Only removes the directory we created — leaves `.claude/skills/` and `.claude/`
 * untouched even if they're empty afterwards, because the user may add other
 * skills/hooks/settings to `.claude/` over time and we don't own that root.
 *
 * Returns `{ status, detail, skillPath? }`:
 *   not-found  — directory absent (nothing to do)
 *   removed    — rm -rf on the sweet-index/ subtree succeeded
 *   dry-run    — found the directory but skipped the delete
 *   error      — rm failed (permissions, etc.); uninstall continues
 */
export function removeSweetIndexSkill(projectRoot, { dryRun = false } = {}) {
  const skillDir = join(projectRoot, '.claude', 'skills', 'sweet-index');
  if (!existsSync(skillDir)) {
    return { status: 'not-found', detail: 'no .claude/skills/sweet-index/' };
  }
  if (dryRun) {
    return { status: 'dry-run', detail: skillDir, skillPath: skillDir };
  }
  try {
    rmSync(skillDir, { recursive: true, force: true });
    return { status: 'removed', detail: skillDir, skillPath: skillDir };
  } catch (err) {
    return { status: 'error', detail: err.message };
  }
}

/**
 * Best-effort cleanup of empty parent directories left behind after rm -rf'ing
 * the per-model cache dirs and the CoreML cascade root.
 *
 * Walks up from `start` toward `stopAt` (exclusive) and removes each directory
 * iff it's empty. rmdirSync naturally fails on non-empty dirs, so this is
 * inherently safe — we never delete a directory that has files we didn't put
 * there. Stops at the first non-empty dir or when `stopAt` is reached.
 *
 * Used to clean ~/.cache/sweet-search/{models,coreml-cascade}/ → ~/.cache/sweet-search/
 * after their contents are removed. Without this, uninstall leaves an empty
 * sweet-search directory dangling under the user's cache root.
 */
function pruneEmptyAncestors(start, stopAt) {
  let dir = start;
  while (dir && dir !== stopAt && dir !== dirname(dir)) {
    if (!existsSync(dir)) {
      dir = dirname(dir);
      continue;
    }
    try {
      const entries = readdirSync(dir);
      if (entries.length > 0) return; // non-empty — stop walking
      rmdirSync(dir);
    } catch {
      return; // permission / race / non-empty — stop walking
    }
    dir = dirname(dir);
  }
}

/**
 * Remove the sweet-search-owned SessionStart entry from `.claude/settings.json`,
 * preserving every other hook, permission, and top-level key. Detection is
 * filename-based (see PREWARM_HOOK_FILENAME) — only entries whose command
 * references the sweet-search preheat script are removed.
 *
 * Returns `{ status, detail }`:
 *   not-found  — no settings.json, or no matching entry (nothing to do)
 *   removed    — entry spliced out and settings.json rewritten
 *   dry-run    — found a matching entry but skipped the write
 *   error      — non-fatal (settings.json unreadable, etc.); uninstall continues
 */
export function removePrewarmSessionStartHook(projectRoot, { dryRun = false } = {}) {
  const settingsPath = join(projectRoot, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) {
    return { status: 'not-found', detail: 'no .claude/settings.json' };
  }

  let raw;
  try {
    raw = readFileSync(settingsPath, 'utf-8');
  } catch (err) {
    return { status: 'error', detail: `read failed: ${err.message}` };
  }

  let settings;
  try {
    settings = JSON.parse(raw);
  } catch (err) {
    return { status: 'error', detail: `settings.json is not valid JSON: ${err.message}` };
  }

  const sessionStart = settings?.hooks?.SessionStart;
  if (!Array.isArray(sessionStart) || sessionStart.length === 0) {
    return { status: 'not-found', detail: 'no SessionStart entries' };
  }

  const filtered = sessionStart.filter((group) =>
    !(Array.isArray(group?.hooks) &&
      group.hooks.some((h) => typeof h?.command === 'string' && h.command.includes(PREWARM_HOOK_FILENAME)))
  );

  if (filtered.length === sessionStart.length) {
    return { status: 'not-found', detail: 'no matching entry' };
  }

  if (dryRun) {
    return { status: 'dry-run', detail: `would remove ${sessionStart.length - filtered.length} entry` };
  }

  if (filtered.length === 0) {
    delete settings.hooks.SessionStart;
    if (settings.hooks && Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }
  } else {
    settings.hooks.SessionStart = filtered;
  }

  try {
    const tmpPath = settingsPath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, settingsPath);
  } catch (err) {
    return { status: 'error', detail: `write failed: ${err.message}` };
  }

  return { status: 'removed', detail: `spliced out ${sessionStart.length - filtered.length} entry` };
}

/**
 * Remove the Codex CLI SessionStart hook entry that `--codex` init wrote into
 * `.codex/hooks.json`. Mirrors `removePrewarmSessionStartHook`: only the
 * sweet-search-owned entry (matched by the launcher filename) is spliced out;
 * other events/entries are preserved. When our entry was the only content the
 * file is deleted rather than left as an empty shell. The `codex_hooks` feature
 * flag in config.toml is intentionally left in place — it's harmless and may be
 * shared with other tooling.
 *
 * Returns `{ status, detail }`:
 *   removed    — our entry was spliced out (file rewritten or deleted)
 *   not-found  — no .codex/hooks.json, no SessionStart, or no matching entry
 *   dry-run    — would remove (no write)
 *   error      — non-fatal (unreadable / invalid JSON / write failed)
 */
export function removeCodexSessionStartHook(projectRoot, { dryRun = false } = {}) {
  const hooksPath = join(projectRoot, '.codex', 'hooks.json');
  if (!existsSync(hooksPath)) {
    return { status: 'not-found', detail: 'no .codex/hooks.json' };
  }

  let raw;
  try {
    raw = readFileSync(hooksPath, 'utf-8');
  } catch (err) {
    return { status: 'error', detail: `read failed: ${err.message}` };
  }

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return { status: 'error', detail: `.codex/hooks.json is not valid JSON: ${err.message}` };
  }

  const sessionStart = doc?.hooks?.SessionStart;
  if (!Array.isArray(sessionStart) || sessionStart.length === 0) {
    return { status: 'not-found', detail: 'no SessionStart entries' };
  }

  const filtered = sessionStart.filter((group) =>
    !(Array.isArray(group?.hooks) &&
      group.hooks.some((h) => typeof h?.command === 'string' && h.command.includes(PREWARM_HOOK_FILENAME)))
  );

  if (filtered.length === sessionStart.length) {
    return { status: 'not-found', detail: 'no matching entry' };
  }

  if (dryRun) {
    return { status: 'dry-run', detail: `would remove ${sessionStart.length - filtered.length} entry` };
  }

  if (filtered.length === 0) {
    delete doc.hooks.SessionStart;
    if (doc.hooks && Object.keys(doc.hooks).length === 0) {
      delete doc.hooks;
    }
  } else {
    doc.hooks.SessionStart = filtered;
  }

  try {
    if (doc && Object.keys(doc).length === 0) {
      // Our hook was the only content — remove the file rather than leave `{}`.
      unlinkSync(hooksPath);
    } else {
      const tmpPath = hooksPath + '.tmp';
      writeFileSync(tmpPath, JSON.stringify(doc, null, 2) + '\n', 'utf-8');
      renameSync(tmpPath, hooksPath);
    }
  } catch (err) {
    return { status: 'error', detail: `write failed: ${err.message}` };
  }

  return { status: 'removed', detail: `spliced out ${sessionStart.length - filtered.length} entry` };
}

// ---------------------------------------------------------------------------
// Optional native package list (derived from package.json)
// ---------------------------------------------------------------------------

/**
 * Return the list of `@sweet-search/native-*` packages declared as
 * `optionalDependencies` in package.json. `--purge` walks this list so
 * additions (e.g. CUDA variants) are picked up automatically without
 * having to keep two hand-maintained lists in sync.
 *
 * Falls back to a hard-coded list if package.json is unreadable, so a
 * partial install still gets best-effort purge coverage.
 */
export function getOptionalNativePackageNames() {
  try {
    const pkgPath = join(PACKAGE_ROOT, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const deps = pkg.optionalDependencies || {};
    const out = Object.keys(deps).filter((n) => n.startsWith('@sweet-search/'));
    if (out.length > 0) return out;
  } catch { /* fall through to baseline */ }
  // Baseline keeps the prior behaviour PLUS the CUDA variants that were
  // missing from the pre-Phase-7 hand-maintained list.
  return [
    '@sweet-search/native-darwin-arm64',
    '@sweet-search/native-darwin-x64',
    '@sweet-search/native-linux-arm64-gnu',
    '@sweet-search/native-linux-arm64-gnu-cuda',
    '@sweet-search/native-linux-x64-gnu',
    '@sweet-search/native-linux-x64-gnu-cuda',
  ];
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
Sweet Search uninstall — remove local state created by init

Usage:
  sweet-search uninstall [options]

Options:
  --dry-run        Show what would be removed without deleting
  --keep-models    Preserve the model cache AND the CoreML cascade
                   (both are large/expensive; use this flag to
                   preserve both when only removing .sweet-search/)
  --purge          Also run \`npm uninstall sweet-search\` and remove @sweet-search/* packages
  --force          Skip confirmation prompt (for CI/scripted use)
  --help, -h       Show this help

What gets removed:
  - .sweet-search/ config directory and all generated config
  - Init-managed model cache for this project's profile
  - CoreML variant cascade (if built) — includes ~1.8 GB of .mlpackage
    artifacts AND the sibling .mlmodelc compiled cache files next to
    each variant. Skipped by --keep-models.
  - .claude/skills/sweet-index/ (the per-project /sweet-index skill copy)
  - .claude/hooks/index-maintainer.mjs (init-installed). User-modified
    copies are detected via a byte-compare and left in place.
  - daemon-prewarm SessionStart entry inside .claude/settings.json

What is NOT removed:
  - User source code, indexes, or database files outside .sweet-search/
  - .claude/ itself or any other hooks/skills/settings the user owns
  - The npm package itself (unless --purge)
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runUninstall(args) {
  const parsed = parseArgs(args);
  if (parsed.help) { printHelp(); return; }

  const projectRoot = detectProjectRoot();
  const dataDir = join(projectRoot, DATA_DIR_NAME);

  // Load existing init config (if any)
  let initConfig = null;
  const configPath = join(dataDir, 'config.json');
  if (existsSync(configPath)) {
    try { initConfig = JSON.parse(readFileSync(configPath, 'utf-8')); } catch { /* corrupted config */ }
  }

  // Collect what to remove
  const removals = [];
  let totalBytes = 0;

  // 1. .sweet-search/ directory
  if (existsSync(dataDir)) {
    const size = dirSize(dataDir);
    removals.push({ label: DATA_DIR_NAME + '/', path: dataDir, size, type: 'config' });
    totalBytes += size;
  }

  // 2. Model cache (unless --keep-models)
  if (!parsed.keepModels) {
    const modelDirs = getModelCacheDirs(initConfig);
    for (const md of modelDirs) {
      removals.push({ label: `model cache: ${md.key}`, path: md.path, size: md.size, type: 'model' });
      totalBytes += md.size;
    }

    // CoreML cascade. Cleaned alongside models — same --keep-models flag
    // gates both because the cascade is part of the model delivery
    // strategy, not a separate opt-in. Users who want to preserve
    // the cascade specifically can use --keep-models.
    const cascadeRemovals = getCoremlCascadeRemovals();
    for (const cr of cascadeRemovals) {
      removals.push(cr);
      totalBytes += cr.size;
    }
  }

  // Check for the SessionStart hook entry so we can report/clean it even
  // when .sweet-search/ was already deleted by hand.
  const hookPreview = removePrewarmSessionStartHook(projectRoot, { dryRun: true });
  const hasHookEntry = hookPreview.status === 'dry-run';

  // Check for the /sweet-index skill so we can report it even when
  // .sweet-search/ was already deleted by hand.
  const skillPreview = removeSweetIndexSkill(projectRoot, { dryRun: true });
  const hasSkillEntry = skillPreview.status === 'dry-run';

  // Check for the index-maintainer daemon hook init copies into
  // `.claude/hooks/index-maintainer.mjs`.  Same dry-run pattern.
  const indexMaintainerPreview = removeIndexMaintainerHook(projectRoot, { dryRun: true });
  const hasIndexMaintainerHook = indexMaintainerPreview.status === 'dry-run';
  const indexMaintainerSkippedReason =
    indexMaintainerPreview.status === 'skipped' ? indexMaintainerPreview.detail : null;

  // P1: agent-instruction files (AGENTS.md / CLAUDE.md / GEMINI.md /
  // .cursor/rules/sweet-search.mdc) and the .claude/rules/sweet-search.md
  // sentinel file. The marker block contract guarantees we only strip
  // sweet-search-managed content; user prose outside the marker is preserved.
  const agentInstructionsPreview = removeAgentInstructions({ projectRoot, dryRun: true });
  const agentInstructionsTouched = Object.values(agentInstructionsPreview.harnesses ?? {})
    .some(s => s === 'dry-run');
  const claudeRulesPreview = removeClaudeRules({ projectRoot, dryRun: true });
  const hasClaudeRules = claudeRulesPreview === 'dry-run';

  // P2: UserPromptSubmit reminder hook (.claude/hooks/sweet-search-remind-tools.mjs
  // + the matching settings.json entry).
  const promptReminderPreview = removePromptReminderHook({ projectRoot, dryRun: true });
  const hasPromptReminder = promptReminderPreview.status === 'dry-run';

  // P3: Tool enforcement (Grep deny + PreToolUse hint hook for Read).
  const toolEnforcementPreview = removeToolEnforcement({ projectRoot, dryRun: true });
  const hasToolEnforcement = toolEnforcementPreview.status === 'dry-run';

  // Codex CLI SessionStart hook (.codex/hooks.json), written by `init --codex`.
  const codexHookPreview = removeCodexSessionStartHook(projectRoot, { dryRun: true });
  const hasCodexHook = codexHookPreview.status === 'dry-run';

  // Nothing to remove?
  if (
    removals.length === 0 && !hasHookEntry && !hasSkillEntry && !hasIndexMaintainerHook
    && !agentInstructionsTouched && !hasClaudeRules
    && !hasPromptReminder && !hasToolEnforcement && !hasCodexHook
  ) {
    console.log('Nothing to remove — Sweet Search is not initialized in this project.');
    return;
  }

  // Report
  console.log('');
  console.log(`Sweet Search uninstall${parsed.dryRun ? ' (dry run)' : ''}`);
  console.log(`  Project: ${projectRoot}`);
  console.log('');
  console.log('  Will remove:');
  for (const r of removals) {
    console.log(`    ${r.label} (${formatBytes(r.size)})`);
  }
  if (hasHookEntry) {
    console.log(`    daemon-prewarm SessionStart hook in .claude/settings.json`);
  }
  if (hasSkillEntry) {
    console.log(`    /sweet-index skill (.claude/skills/sweet-index/)`);
  }
  if (hasIndexMaintainerHook) {
    console.log(`    index-maintainer hook (.claude/hooks/index-maintainer.mjs)`);
  } else if (indexMaintainerSkippedReason) {
    console.log(`    [skipped] ${indexMaintainerSkippedReason}`);
  }
  if (agentInstructionsTouched) {
    const targets = Object.entries(agentInstructionsPreview.harnesses)
      .filter(([, v]) => v === 'dry-run').map(([k]) => k).join(', ');
    console.log(`    agent-instruction marker blocks (${targets})`);
  }
  if (hasClaudeRules) {
    console.log(`    .claude/rules/sweet-search.md`);
  }
  if (hasPromptReminder) {
    console.log(`    UserPromptSubmit reminder hook (${promptReminderPreview.detail})`);
  }
  if (hasToolEnforcement) {
    console.log(`    tool-enforcement strict mode (${toolEnforcementPreview.detail})`);
  }
  if (hasCodexHook) {
    console.log(`    Codex SessionStart hook (.codex/hooks.json)`);
  }
  console.log(`  Total: ${formatBytes(totalBytes)}`);
  if (parsed.keepModels) {
    console.log('  Model cache: kept (--keep-models)');
  }
  console.log('');

  if (parsed.dryRun) {
    const dryHook = removePrewarmSessionStartHook(projectRoot, { dryRun: true });
    if (dryHook.status === 'dry-run') {
      console.log(`  Would also remove: prewarm SessionStart hook (.claude/settings.json — ${dryHook.detail})`);
    }
    const drySkill = removeSweetIndexSkill(projectRoot, { dryRun: true });
    if (drySkill.status === 'dry-run') {
      console.log(`  Would also remove: /sweet-index skill (${drySkill.detail})`);
    }
    const dryMaintainer = removeIndexMaintainerHook(projectRoot, { dryRun: true });
    if (dryMaintainer.status === 'dry-run') {
      console.log(`  Would also remove: index-maintainer hook (${dryMaintainer.detail})`);
    } else if (dryMaintainer.status === 'skipped') {
      console.log(`  Would skip: index-maintainer hook — ${dryMaintainer.detail}`);
    }
    const dryCodex = removeCodexSessionStartHook(projectRoot, { dryRun: true });
    if (dryCodex.status === 'dry-run') {
      console.log(`  Would also remove: Codex SessionStart hook (.codex/hooks.json — ${dryCodex.detail})`);
    }
    console.log('Dry run — nothing was removed.');
    return;
  }

  // Confirmation (unless --force)
  if (!parsed.force && process.stdin.isTTY) {
    process.stdout.write('Proceed? [y/N] ');
    const { createInterface } = await import('node:readline');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => {
      rl.question('', a => { rl.close(); resolve(a.trim().toLowerCase()); });
    });
    if (answer !== 'y' && answer !== 'yes') {
      console.log('Cancelled.');
      return;
    }
  }

  // Stop the running daemon + maintainer BEFORE deleting .sweet-search/. The
  // maintainer records its pid in .sweet-search/index-maintainer.lock; if we
  // removed the state dir first, stopRunningMaintainer() would have no pid to
  // signal — the maintainer would leak and, because its tick loop recreates the
  // state dir (mkdirSync), resurrect the very directory we just deleted. So this
  // must run after the confirmation/dry-run gates but before any removal.
  const daemonResult = stopRunningDaemon({ projectRoot });
  if (daemonResult.killed) {
    console.log('  Stopped: running prewarm daemon (SIGKILL via PID file)');
  } else if (daemonResult.gracefulAttempted) {
    console.log('  Stopped: running prewarm daemon (graceful via CLI)');
  }
  // If neither happened, daemon wasn't running — silent.

  const maintainerResult = stopRunningMaintainer({ projectRoot });
  if (maintainerResult.killed) {
    console.log(`  Stopped: incremental-index maintainer (SIGKILL after grace, pid ${maintainerResult.pid})`);
  } else if (maintainerResult.signalled) {
    console.log(`  Stopped: incremental-index maintainer (SIGTERM, pid ${maintainerResult.pid})`);
  } else if (maintainerResult.lockRemoved) {
    console.log('  Cleared: stale incremental-index maintainer lock');
  }
  // If none happened, the maintainer wasn't running — silent.

  // Remove
  let removed = 0;
  let kept = 0;
  for (const r of removals) {
    try {
      rmSync(r.path, { recursive: true, force: true });
      console.log(`  Removed: ${r.label}`);
      removed++;
    } catch (err) {
      console.log(`  Failed to remove ${r.label}: ${err.message}`);
      kept++;
    }
  }

  // Prune empty parent directories left behind under the model cache root
  // (~/.cache/sweet-search/{models,coreml-cascade}/ → ~/.cache/sweet-search/).
  // rmdirSync naturally fails on non-empty dirs, so this only deletes
  // directories we've effectively emptied. Stops before $HOME/.cache.
  if (!parsed.keepModels) {
    const cacheRoot = resolveModelCacheRoot();          // .../sweet-search/models
    const sweetSearchCacheRoot = dirname(cacheRoot);    // .../sweet-search
    const userCacheRoot = dirname(sweetSearchCacheRoot); // .../.cache (do not touch)
    pruneEmptyAncestors(cacheRoot, userCacheRoot);
  }

  // Remove the per-project /sweet-index skill init copied into .claude/.
  // Non-fatal — a failure here just leaves the SKILL.md stub behind.
  const skillResult = removeSweetIndexSkill(projectRoot, { dryRun: parsed.dryRun });
  if (skillResult.status === 'removed') {
    console.log(`  Removed: /sweet-index skill (${skillResult.detail})`);
    removed++;
  } else if (skillResult.status === 'error') {
    console.log(`  Failed to remove /sweet-index skill: ${skillResult.detail}`);
    kept++;
  }
  // 'not-found' and 'dry-run' are silent in the main output.

  // Reverse the Claude Code daemon-prewarm SessionStart entry init added to
  // .claude/settings.json. Non-fatal — a failure here doesn't leave the
  // user in a worse state than before uninstall ran.
  const hookResult = removePrewarmSessionStartHook(projectRoot, { dryRun: parsed.dryRun });
  if (hookResult.status === 'removed') {
    console.log(`  Removed: daemon-prewarm SessionStart hook (.claude/settings.json — ${hookResult.detail})`);
    removed++;
  } else if (hookResult.status === 'error') {
    console.log(`  Failed to remove daemon-prewarm SessionStart hook: ${hookResult.detail}`);
    kept++;
  }
  // 'not-found' and 'dry-run' are silent in the main output.

  // Reverse the index-maintainer daemon hook init copied into
  // .claude/hooks/index-maintainer.mjs. Bytes-match check inside the
  // helper guarantees we never delete a user-customised file.
  const indexMaintainerResult = removeIndexMaintainerHook(projectRoot, { dryRun: parsed.dryRun });
  if (indexMaintainerResult.status === 'removed') {
    console.log(`  Removed: index-maintainer hook (${indexMaintainerResult.detail})`);
    removed++;
  } else if (indexMaintainerResult.status === 'skipped') {
    console.log(`  Kept: index-maintainer hook — ${indexMaintainerResult.detail}`);
    kept++;
  } else if (indexMaintainerResult.status === 'error') {
    console.log(`  Failed to remove index-maintainer hook: ${indexMaintainerResult.detail}`);
    kept++;
  }

  // Reverse the Codex SessionStart hook written by `init --codex`. The
  // config.toml feature flag is left in place (harmless, possibly shared).
  const codexHookResult = removeCodexSessionStartHook(projectRoot, { dryRun: parsed.dryRun });
  if (codexHookResult.status === 'removed') {
    console.log(`  Removed: Codex SessionStart hook (.codex/hooks.json — ${codexHookResult.detail})`);
    removed++;
  } else if (codexHookResult.status === 'error') {
    console.log(`  Failed to remove Codex SessionStart hook: ${codexHookResult.detail}`);
    kept++;
  }
  // 'not-found' and 'dry-run' are silent in the main output.

  // P1: strip agent-instruction marker blocks across all five harness files.
  // The marker contract guarantees we never delete user prose outside of it.
  const agentInstructionsResult = removeAgentInstructions({ projectRoot, dryRun: parsed.dryRun });
  for (const [harness, status] of Object.entries(agentInstructionsResult.harnesses)) {
    if (status === 'removed') {
      console.log(`  Removed: ${harness} agent-instruction block`);
      removed++;
    } else if (status === 'file-deleted') {
      console.log(`  Removed: ${harness} agent-instruction file (wholly sweet-search-managed)`);
      removed++;
    }
    // 'not-found' / 'not-our-symlink' / 'dry-run' are silent.
  }

  // Remove the .claude/rules/sweet-search.md sentinel file. CLAUDE.md import
  // line was already stripped by removeAgentInstructions above (it lived
  // inside the agent-instructions marker).
  const claudeRulesResult = removeClaudeRules({ projectRoot, dryRun: parsed.dryRun });
  if (claudeRulesResult === 'removed') {
    console.log(`  Removed: .claude/rules/sweet-search.md`);
    removed++;
  } else if (claudeRulesResult === 'preserved-user-file') {
    console.log(`  Kept: .claude/rules/sweet-search.md — no sweet-search sentinel (user-edited)`);
    kept++;
  }
  // 'not-found' / 'dry-run' are silent.

  // P2: strip the UserPromptSubmit reminder hook + settings entry.
  const promptReminderResult = removePromptReminderHook({ projectRoot, dryRun: parsed.dryRun });
  if (promptReminderResult.status === 'removed') {
    console.log(`  Removed: UserPromptSubmit reminder hook (${promptReminderResult.detail})`);
    removed++;
  } else if (promptReminderResult.status === 'error') {
    console.log(`  Failed to remove UserPromptSubmit reminder hook: ${promptReminderResult.detail}`);
    kept++;
  }

  // P3: strip the tool-enforcement Grep deny + PreToolUse hook + hook file.
  const toolEnforcementResult = removeToolEnforcement({ projectRoot, dryRun: parsed.dryRun });
  if (toolEnforcementResult.status === 'removed') {
    console.log(`  Removed: tool-enforcement (${toolEnforcementResult.detail})`);
    removed++;
  } else if (toolEnforcementResult.status === 'error') {
    console.log(`  Failed to remove tool-enforcement: ${toolEnforcementResult.detail}`);
    kept++;
  }

  // Purge npm packages
  if (parsed.purge) {
    console.log('');
    console.log('  Purging npm packages...');
    try {
      const pkgs = ['sweet-search', ...getOptionalNativePackageNames()];
      // Use shell-form so non-installed packages don't abort the whole
      // command (npm exits non-zero per missing pkg). The OR-true keeps
      // the script alive across npm exit codes from a partially-installed
      // host (e.g. a Linux box without the darwin-* packages).
      const cmd = `npm uninstall ${pkgs.join(' ')} 2>/dev/null || true`;
      execSync(cmd, {
        cwd: projectRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      console.log(`  npm packages removed (${pkgs.length} candidates).`);
    } catch {
      console.log('  npm uninstall failed (packages may not be installed).');
    }
  }

  // Summary
  console.log('');
  console.log(`Uninstall complete: ${removed} removed, ${kept} failed.`);
  if (!parsed.purge) {
    console.log('  Note: The sweet-search npm package is still installed. Use --purge to remove it.');
  }
}

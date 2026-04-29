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
function getCoremlCascadeRemovals() {
  const removals = [];
  try {
    const root = getCoremlCascadeRoot();
    if (existsSync(root)) {
      const state = getCoremlCascadeState();
      const label = state.complete
        ? `coreml cascade (${state.embedTotal + state.liTotal} variants complete)`
        : `coreml cascade (${state.embedPresent + state.liPresent}/${state.embedTotal + state.liTotal} variants partial)`;
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

  // Nothing to remove?
  if (removals.length === 0 && !hasHookEntry && !hasSkillEntry) {
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

  // Stop any daemon that an earlier SessionStart hook spawned. Otherwise the
  // old daemon keeps running and holding the socket after uninstall, which
  // surprises users. Never throws — `stopRunningDaemon` swallows every error.
  const daemonResult = stopRunningDaemon({ projectRoot });
  if (daemonResult.killed) {
    console.log('  Stopped: running prewarm daemon (SIGKILL via PID file)');
  } else if (daemonResult.gracefulAttempted) {
    console.log('  Stopped: running prewarm daemon (graceful via CLI)');
  }
  // If neither happened, daemon wasn't running — silent.

  // Purge npm packages
  if (parsed.purge) {
    console.log('');
    console.log('  Purging npm packages...');
    try {
      execSync('npm uninstall sweet-search @sweet-search/native-darwin-arm64 @sweet-search/native-darwin-x64 @sweet-search/native-linux-x64-gnu @sweet-search/native-linux-arm64-gnu 2>/dev/null || true', {
        cwd: projectRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      console.log('  npm packages removed.');
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

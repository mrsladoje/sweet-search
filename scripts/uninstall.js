#!/usr/bin/env node

/**
 * Sweet Search uninstall — reverses everything `sweet-search init` created.
 *
 * Default: removes .sweet-search/ and the agent wiring from the current repo
 * only; the shared model cache stays for the user's other repos. `--all`
 * removes sweet-search from the machine: every repo recorded by init
 * (scripts/repo-registry.js), the shared model cache, and the npm package.
 * Never touches user source code or user-authored files.
 *
 * Usage:
 *   sweet-search uninstall [--all] [--dry-run] [--force]
 */

import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { getCoremlCascadeRoot, getCoremlCascadeState } from '../core/infrastructure/coreml-cascade.js';
import { PREWARM_HOOK_FILENAME, readCreatedPaths } from './init.js';
import { removeAgentInstructions } from './inject-agent-instructions.js';
import { removeClaudeRules } from './write-claude-rules.js';
import { removeClaudeSystemPrompt } from './install-claude-system-prompt.js';
import { removeClaudeLeanHarness } from './install-claude-lean-harness.js';
import { removeMcpServer } from './install-mcp-server.js';
import { removeCodexHarness } from './install-codex-harness.js';
import { removeOpencodeHarness } from './install-opencode-harness.js';
import { removePromptReminderHook } from './install-prompt-reminders.js';
import { removeToolEnforcement } from './install-tool-enforcement.js';
import { projectSocketPath, projectPidFile } from '../core/search/server-identity.js';
import { existingRegisteredRepos, unregisterRepos } from './repo-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');
const DATA_DIR_NAME = '.sweet-search';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args) {
  const result = { dryRun: false, all: false, force: false, help: false };
  for (const arg of args) {
    if (arg === '--dry-run') result.dryRun = true;
    // --purge is the pre-2.9 name for --all; --keep-models is now the default
    // behaviour and accepted as a no-op so old scripts keep working.
    else if (arg === '--all' || arg === '--purge') result.all = true;
    else if (arg === '--keep-models') { /* default since 2.9 */ }
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
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
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
  // Per-project socket/pidfile (C3) — derived from this project's root so
  // uninstalling project A never stops project B's server. Honors explicit
  // SWEET_SEARCH_SOCKET_PATH / SWEET_SEARCH_PID_FILE overrides. Tests pass
  // explicit values for isolation.
  pidFile = projectPidFile(process.env, projectRoot || process.cwd()),
  socketPath = projectSocketPath(process.env, projectRoot || process.cwd()),
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
 * Remove the sweet-search-owned SessionStart and SessionEnd entries from `.claude/settings.json`,
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

  const changes = [];
  for (const event of ['SessionStart', 'SessionEnd']) {
    const groups = settings?.hooks?.[event];
    if (!Array.isArray(groups)) continue;
    const filtered = groups.filter((group) =>
      !(Array.isArray(group?.hooks) &&
        group.hooks.some((h) => typeof h?.command === 'string' && h.command.includes(PREWARM_HOOK_FILENAME)))
    );
    if (filtered.length !== groups.length) changes.push({ event, groups, filtered });
  }

  if (changes.length === 0) {
    return { status: 'not-found', detail: 'no matching entry' };
  }

  const removedCount = changes.reduce((sum, change) => sum + change.groups.length - change.filtered.length, 0);

  if (dryRun) {
    return { status: 'dry-run', detail: `would remove ${removedCount} entries` };
  }

  for (const { event, filtered } of changes) {
    if (filtered.length === 0) delete settings.hooks[event];
    else settings.hooks[event] = filtered;
  }
  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  try {
    const tmpPath = settingsPath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, settingsPath);
  } catch (err) {
    return { status: 'error', detail: `write failed: ${err.message}` };
  }

  return { status: 'removed', detail: `spliced out ${removedCount} entries` };
}

/**
 * Remove the Codex CLI SessionStart hook entry that `--codex` init wrote into
 * `.codex/hooks.json`. Mirrors `removePrewarmSessionStartHook`: only the
 * sweet-search-owned entry (matched by the launcher filename) is spliced out;
 * other events/entries are preserved. When our entry was the only content the
 * file is deleted rather than left as an empty shell. The `[features] hooks`
 * feature flag in config.toml is `removeCodexHarness`'s job: it goes only when
 * the Codex harness manifest shows init added it (it may be shared with other
 * tooling otherwise).
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
 * `optionalDependencies` in package.json. Kept for the package contract test so
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
    // bg-priority base package (its per-platform optionalDeps cascade-remove with it)
    '@sweet-search/bg-priority',
  ];
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
Sweet Search uninstall — remove what init created

Usage:
  sweet-search uninstall          Remove sweet-search from this repo
  sweet-search uninstall --all    Remove sweet-search from this machine

Options:
  --all            Every repo where init ran, the shared model cache, and the
                   sweet-search npm package itself
  --dry-run        Show what would be removed without deleting
  --force          Skip confirmation prompt (for CI/scripted use)
  --help, -h       Show this help

Removed from each repo:
  - .sweet-search/ (config, index, and daemon state)
  - Claude Code wiring: output style + selection, .claude/rules/sweet-search.md,
    the /sweet-index skill, the index-maintainer and prewarm hooks, optional
    tool-enforcement and reminder hooks
  - Sweet-search-owned blocks/files in AGENTS.md, GEMINI.md, CLAUDE.md
    (legacy installs), and .cursor/rules/sweet-search.mdc
  - The Codex SessionStart hook and the MCP server registration
  - Codex wiring: the config.toml keys init added (model_instructions_file,
    developer_instructions, and [features] hooks when init added it),
    .codex/sweet-search-instructions.md
  - opencode wiring: .opencode/sweet-search.md, the prompt file, the plugin
    files (tool descriptions, per-repo OpenAI cache key), and the keys init added to .opencode/opencode.json (the file and the
    .opencode directory go too when nothing of yours is left)

Also removed by --all:
  - The shared model cache (~/.cache/sweet-search), including the CoreML cascade
  - The sweet-search npm package (global or project-local install)

Never removed:
  - Your source code, and any hooks, skills, settings or prose you wrote
  - User-modified copies of sweet-search files (detected and left in place)
  - A Codex [features] hooks = true flag that was there before init
  - A .claude/ settings file or directory that init did not create, or that
    still holds anything
`);
}

// ---------------------------------------------------------------------------
// Per-repo plan + execution
// ---------------------------------------------------------------------------

function loadProjectConfig(projectRoot) {
  const configPath = join(projectRoot, DATA_DIR_NAME, 'config.json');
  if (!existsSync(configPath)) return null;
  try { return JSON.parse(readFileSync(configPath, 'utf-8')); } catch { return null; }
}

/**
 * Detect everything init left in one repo, without changing anything.
 * Returns `{ projectRoot, initConfig, removals, totalBytes, lines, empty }` —
 * `lines` is the human-readable "will remove" list.
 */
export function planProjectUninstall(projectRoot) {
  const dataDir = join(projectRoot, DATA_DIR_NAME);
  const initConfig = loadProjectConfig(projectRoot);
  const removals = [];
  let totalBytes = 0;
  const lines = [];

  if (existsSync(dataDir)) {
    const size = dirSize(dataDir);
    removals.push({ label: DATA_DIR_NAME + '/', path: dataDir, size, type: 'config' });
    totalBytes += size;
    lines.push(`${DATA_DIR_NAME}/ (${formatBytes(size)})`);
  }

  if (removePrewarmSessionStartHook(projectRoot, { dryRun: true }).status === 'dry-run') {
    lines.push('daemon-prewarm SessionStart hook in .claude/settings.json');
  }
  if (removeSweetIndexSkill(projectRoot, { dryRun: true }).status === 'dry-run') {
    lines.push('/sweet-index skill (.claude/skills/sweet-index/)');
  }
  const maintainerHook = removeIndexMaintainerHook(projectRoot, { dryRun: true });
  if (maintainerHook.status === 'dry-run') {
    lines.push('index-maintainer hook (.claude/hooks/index-maintainer.mjs)');
  } else if (maintainerHook.status === 'skipped') {
    lines.push(`[skipped] ${maintainerHook.detail}`);
  }
  // Agent-instruction files, the Claude project rule, and any legacy CLAUDE.md
  // marker. The marker/sentinel contracts preserve user-authored content.
  const agentInstructions = removeAgentInstructions({ projectRoot, dryRun: true });
  const agentTargets = Object.entries(agentInstructions.harnesses ?? {})
    .filter(([, v]) => v === 'dry-run').map(([k]) => k);
  if (agentTargets.length > 0) lines.push(`agent-instruction marker blocks (${agentTargets.join(', ')})`);
  if (removeClaudeRules({ projectRoot, dryRun: true }) === 'dry-run') {
    lines.push('.claude/rules/sweet-search.md');
  }
  const systemPrompt = removeClaudeSystemPrompt({ projectRoot, dryRun: true });
  if (systemPrompt.status === 'dry-run') lines.push(`Claude system-prompt output style (${systemPrompt.detail})`);
  const lean = removeClaudeLeanHarness({ projectRoot, dryRun: true });
  if (lean.status === 'dry-run') lines.push(`Claude lean harness (${lean.detail})`);
  const reminder = removePromptReminderHook({ projectRoot, dryRun: true });
  if (reminder.status === 'dry-run') lines.push(`UserPromptSubmit reminder hook (${reminder.detail})`);
  const enforcement = removeToolEnforcement({ projectRoot, dryRun: true });
  if (enforcement.status === 'dry-run') lines.push(`tool-enforcement strict mode (${enforcement.detail})`);
  if (removeCodexSessionStartHook(projectRoot, { dryRun: true }).status === 'dry-run') {
    lines.push('Codex SessionStart hook (.codex/hooks.json)');
  }
  const codexHarness = removeCodexHarness({ projectRoot, dryRun: true });
  if (codexHarness.status === 'dry-run') lines.push(`Codex harness (${codexHarness.detail})`);
  const opencodeHarness = removeOpencodeHarness({ projectRoot, dryRun: true });
  if (opencodeHarness.status === 'dry-run') lines.push(`opencode harness (${opencodeHarness.detail})`);
  if (removeMcpServer({ projectRoot, dryRun: true }) === 'dry-run') {
    lines.push('MCP server registration (.mcp.json — mcpServers.sweet-search)');
  }

  // Read now: the record lives in .sweet-search/, which goes first.
  const createdPaths = readCreatedPaths(projectRoot);

  return { projectRoot, initConfig, removals, totalBytes, lines, empty: lines.length === 0, createdPaths };
}

/**
 * After every remover ran: delete what is left of the paths init created — a
 * settings.json that is now `{}`, and directories that are now empty (deepest
 * first). A path init did not create, or one that still holds anything, stays.
 * Returns the removed paths (relative).
 */
const INIT_CLAUDE_DIRS = ['.claude/skills', '.claude/hooks', '.claude/agents', '.claude/rules', '.claude/output-styles', '.claude'];

export function pruneCreatedPaths(projectRoot, createdPaths = [], { dryRun = false } = {}) {
  const removed = [];
  const created = new Set(createdPaths);
  const settingsRel = '.claude/settings.json';
  if (created.has(settingsRel)) {
    const path = join(projectRoot, settingsRel);
    try {
      const value = JSON.parse(readFileSync(path, 'utf-8'));
      if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
        if (!dryRun) unlinkSync(path);
        removed.push(settingsRel);
      }
    } catch { /* absent or not JSON: keep */ }
  }
  // Older inits did not record created paths: also offer the .claude/
  // directories any init writes into. Only EMPTY directories are removed, so no
  // content can be lost.
  const dirs = [...new Set([...created, ...INIT_CLAUDE_DIRS])].filter((rel) => rel !== settingsRel)
    .sort((a, b) => b.split('/').length - a.split('/').length);
  for (const rel of dirs) {
    const path = join(projectRoot, rel);
    try {
      if (!statSync(path).isDirectory() || readdirSync(path).length > 0) continue;
      if (!dryRun) rmdirSync(path);
      removed.push(rel);
    } catch { /* absent or not removable: keep */ }
  }
  return removed;
}

/** Remove everything `planProjectUninstall` found. Returns `{ removed, kept }`. */
function executeProjectUninstall(plan) {
  const { projectRoot } = plan;
  let removed = 0;
  let kept = 0;

  // Stop the running daemon + maintainer BEFORE deleting .sweet-search/. The
  // maintainer records its pid in .sweet-search/index-maintainer.lock; if we
  // removed the state dir first, stopRunningMaintainer() would have no pid to
  // signal — the maintainer would leak and, because its tick loop recreates the
  // state dir (mkdirSync), resurrect the very directory we just deleted.
  const daemonResult = stopRunningDaemon({ projectRoot });
  if (daemonResult.killed) {
    console.log('  Stopped: running prewarm daemon (SIGKILL via PID file)');
  } else if (daemonResult.gracefulAttempted) {
    console.log('  Stopped: running prewarm daemon (graceful via CLI)');
  }
  const maintainerResult = stopRunningMaintainer({ projectRoot });
  if (maintainerResult.killed) {
    console.log(`  Stopped: incremental-index maintainer (SIGKILL after grace, pid ${maintainerResult.pid})`);
  } else if (maintainerResult.signalled) {
    console.log(`  Stopped: incremental-index maintainer (SIGTERM, pid ${maintainerResult.pid})`);
  } else if (maintainerResult.lockRemoved) {
    console.log('  Cleared: stale incremental-index maintainer lock');
  }

  for (const r of plan.removals) {
    try {
      rmSync(r.path, { recursive: true, force: true });
      console.log(`  Removed: ${r.label}`);
      removed++;
    } catch (err) {
      console.log(`  Failed to remove ${r.label}: ${err.message}`);
      kept++;
    }
  }

  const report = (result, { ok = ['removed'], label, keptWhen = [] }) => {
    if (ok.includes(result.status)) {
      console.log(`  Removed: ${label}${result.detail ? ` (${result.detail})` : ''}`);
      removed++;
    } else if (keptWhen.includes(result.status)) {
      console.log(`  Kept: ${label} — ${result.detail}`);
      kept++;
    } else if (result.status === 'error') {
      console.log(`  Failed to remove ${label}: ${result.detail}`);
      kept++;
    }
  };

  report(removeSweetIndexSkill(projectRoot), { label: '/sweet-index skill' });
  report(removePrewarmSessionStartHook(projectRoot), { label: 'daemon-prewarm SessionStart hook' });
  // Bytes-match check inside the helper guarantees we never delete a
  // user-customised file.
  report(removeIndexMaintainerHook(projectRoot), { label: 'index-maintainer hook', keptWhen: ['skipped'] });
  report(removeCodexSessionStartHook(projectRoot), { label: 'Codex SessionStart hook' });
  // Only what the Codex / opencode harness manifests record as added and unchanged since
  // (the config.toml hooks flag only when init added it). After the hook, so an emptied
  // .codex/ directory can go too.
  for (const [label, result] of [
    ['Codex harness', removeCodexHarness({ projectRoot })],
    ['opencode harness', removeOpencodeHarness({ projectRoot })],
  ]) {
    report(result, { label });
    for (const k of result.kept ?? []) {
      console.log(`  Kept: ${k}`);
      kept++;
    }
  }

  const agentInstructionsResult = removeAgentInstructions({ projectRoot });
  for (const [harness, status] of Object.entries(agentInstructionsResult.harnesses)) {
    if (status === 'removed') {
      console.log(`  Removed: ${harness} agent-instruction block`);
      removed++;
    } else if (status === 'file-deleted') {
      console.log(`  Removed: ${harness} agent-instruction file (wholly sweet-search-managed)`);
      removed++;
    }
  }

  const claudeRulesResult = removeClaudeRules({ projectRoot });
  if (claudeRulesResult === 'removed') {
    console.log('  Removed: .claude/rules/sweet-search.md');
    removed++;
  } else if (claudeRulesResult === 'preserved-user-file') {
    console.log('  Kept: .claude/rules/sweet-search.md — no sweet-search sentinel (user-edited)');
    kept++;
  }

  // Only removes the sentinel-tagged style, and clears outputStyle only when it
  // still selects that owned style.
  const systemPromptResult = removeClaudeSystemPrompt({ projectRoot });
  report(systemPromptResult, { label: 'Claude system-prompt output style' });
  if (systemPromptResult.status === 'not-found' && systemPromptResult.detail === 'output style is user-authored') {
    console.log('  Kept: Claude output style — no sweet-search sentinel (user-authored)');
    kept++;
  }

  // Only what the lean-harness manifest records as added and unchanged since.
  report(removeClaudeLeanHarness({ projectRoot }), { label: 'Claude lean harness' });
  report(removePromptReminderHook({ projectRoot }), { label: 'UserPromptSubmit reminder hook' });
  report(removeToolEnforcement({ projectRoot }), { label: 'tool-enforcement' });

  const mcpServerResult = removeMcpServer({ projectRoot });
  if (mcpServerResult === 'removed') {
    console.log('  Removed: MCP server registration (.mcp.json — mcpServers.sweet-search)');
    removed++;
  } else if (mcpServerResult === 'file-deleted') {
    console.log('  Removed: .mcp.json (wholly sweet-search-managed)');
    removed++;
  }

  // Last: what is left of the settings file and directories init created.
  const pruned = pruneCreatedPaths(projectRoot, plan.createdPaths);
  if (pruned.length) {
    console.log(`  Removed: now-empty paths init created (${pruned.join(', ')})`);
    removed++;
  }

  return { removed, kept };
}

// ---------------------------------------------------------------------------
// Machine-wide plan (--all)
// ---------------------------------------------------------------------------

function sweetSearchCacheRoot() {
  return join(homedir(), '.cache', 'sweet-search');
}

/**
 * The shared caches `--all` removes. With the default layout that is the whole
 * ~/.cache/sweet-search directory (models, CoreML cascade, optimized ONNX
 * copies, repo record). A custom SWEET_SEARCH_MODEL_CACHE is never removed
 * wholesale — the user may have pointed it at a shared directory — only the
 * model dirs init recorded, plus the cascade inside it.
 */
function planSharedCacheRemovals(plans) {
  const removals = [];
  const cacheRoot = sweetSearchCacheRoot();
  const modelRoot = resolveModelCacheRoot();
  if (!modelRoot.startsWith(cacheRoot + '/')) {
    const seen = new Set();
    for (const plan of plans) {
      for (const md of getModelCacheDirs(plan.initConfig)) {
        if (seen.has(md.path)) continue;
        seen.add(md.path);
        removals.push({ label: `model cache: ${md.key}`, path: md.path, size: md.size });
      }
    }
    removals.push(...getCoremlCascadeRemovals());
  }
  if (existsSync(cacheRoot)) {
    removals.push({ label: 'shared model cache (~/.cache/sweet-search)', path: cacheRoot, size: dirSize(cacheRoot) });
  }
  return removals;
}

/**
 * How this copy of sweet-search was installed, so `--all` can remove it the
 * same way: `{ kind: 'global' }`, `{ kind: 'local', cwd }` for a project
 * dependency, or `{ kind: 'none' }` for a source checkout (never removed).
 */
export function detectPackageInstall(packageRoot = PACKAGE_ROOT, globalRoot = npmGlobalRoot()) {
  const real = (p) => { try { return realpathSync(p); } catch { return p; } };
  const pkg = real(packageRoot);
  const parent = dirname(pkg);
  if (basename(parent) !== 'node_modules') return { kind: 'none' };
  // An `npx sweet-search` run lives in npm's own cache; nothing to uninstall.
  if (pkg.split('/').includes('_npx')) return { kind: 'none' };
  if (globalRoot && real(globalRoot) === parent) return { kind: 'global' };
  // Project-local only when that project's package.json declares us. Anything
  // else (pnpm/yarn/bun stores, unusual layouts) is 'other': we say how to
  // finish rather than guess an npm command in the wrong directory.
  const projectDir = dirname(parent);
  try {
    const manifest = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'));
    const declared = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies };
    if (declared['sweet-search']) return { kind: 'local', cwd: projectDir };
  } catch { /* no readable manifest */ }
  return { kind: 'other', path: pkg };
}

function npmGlobalRoot() {
  try {
    return execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).toString().trim();
  } catch {
    return null;
  }
}

function removePackage(install) {
  const cmd = install.kind === 'global' ? 'npm uninstall -g sweet-search' : 'npm uninstall sweet-search';
  try {
    execSync(cmd, { cwd: install.cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    console.log(`  Removed: sweet-search npm package (${cmd})`);
    return true;
  } catch {
    console.log(`  Failed: ${cmd} — run it yourself to finish.`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runUninstall(args) {
  const parsed = parseArgs(args);
  if (parsed.help) { printHelp(); return; }

  const currentRoot = detectProjectRoot();
  const roots = parsed.all
    ? [...new Set([currentRoot, ...existingRegisteredRepos()])]
    : [currentRoot];
  const plans = roots.map(planProjectUninstall).filter((p) => !p.empty);
  const sharedRemovals = parsed.all ? planSharedCacheRemovals(plans) : [];
  const install = parsed.all ? detectPackageInstall() : { kind: 'none' };

  if (plans.length === 0 && sharedRemovals.length === 0 && !['global', 'local'].includes(install.kind)) {
    console.log(parsed.all
      ? 'Nothing to remove — Sweet Search is not installed on this machine.'
      : 'Nothing to remove — Sweet Search is not initialized in this project.');
    return;
  }

  // Report
  console.log('');
  console.log(`Sweet Search uninstall${parsed.all ? ' --all' : ''}${parsed.dryRun ? ' (dry run)' : ''}`);
  for (const plan of plans) {
    console.log('');
    console.log(`  Repo: ${plan.projectRoot}`);
    for (const line of plan.lines) console.log(`    ${line}`);
  }
  if (parsed.all && (sharedRemovals.length > 0 || ['global', 'local'].includes(install.kind))) {
    console.log('');
    console.log('  This machine:');
    for (const r of sharedRemovals) console.log(`    ${r.label} (${formatBytes(r.size)})`);
    if (install.kind === 'global') console.log('    sweet-search npm package (global)');
    if (install.kind === 'local') console.log(`    sweet-search npm package (local, in ${install.cwd})`);
  }
  console.log('');

  if (parsed.dryRun) {
    console.log('Dry run — nothing was removed.');
    return;
  }

  // --all is machine-wide: without a terminal to confirm on (an agent's shell,
  // a script), require an explicit --force instead of proceeding silently.
  if (parsed.all && !parsed.force && !process.stdin.isTTY) {
    console.log('Refusing to run --all without confirmation. Re-run with --force to proceed.');
    process.exitCode = 1;
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

  let removed = 0;
  let kept = 0;
  // Forget a repo only once it is clean, so a failed removal can still be
  // found by a later `uninstall --all`. Repos with nothing left count as clean.
  const cleaned = roots.filter((root) => !plans.some((p) => p.projectRoot === root));
  for (const plan of plans) {
    if (plans.length > 1) console.log(`  [${plan.projectRoot}]`);
    const result = executeProjectUninstall(plan);
    removed += result.removed;
    kept += result.kept;
    if (result.kept === 0 && !existsSync(join(plan.projectRoot, DATA_DIR_NAME))) cleaned.push(plan.projectRoot);
  }
  unregisterRepos(cleaned);

  if (parsed.all) {
    for (const r of sharedRemovals) {
      try {
        rmSync(r.path, { recursive: true, force: true });
        console.log(`  Removed: ${r.label}`);
        removed++;
      } catch (err) {
        console.log(`  Failed to remove ${r.label}: ${err.message}`);
        kept++;
      }
    }
    // Last: this deletes the running CLI's own files.
    if (install.kind === 'global' || install.kind === 'local') {
      if (removePackage(install)) removed++; else kept++;
    } else if (install.kind === 'other') {
      console.log(`  Note: remove the sweet-search package (${install.path}) with the package manager you installed it with.`);
    }
  }

  console.log('');
  console.log(`Uninstall complete: ${removed} removed, ${kept} failed.`);
  if (!parsed.all) {
    const cacheRoot = sweetSearchCacheRoot();
    const size = dirSize(cacheRoot);
    if (size > 0) {
      console.log(`  Shared models (${formatBytes(size)}) kept for your other repos.`);
    }
    console.log('  To remove sweet-search completely: sweet-search uninstall --all');
  }
}

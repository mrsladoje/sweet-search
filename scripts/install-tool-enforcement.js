/**
 * Install / remove sweet-search Claude-specific tool-enforcement.
 *
 * Plan reference: §4D / §10 step 17. Opt-in via `--enforce-tools` because
 * strict enforcement is opinionated and Claude-specific. Universally gated
 * by `--no-claude` (handled in init.js — when --no-claude, never called).
 *
 * Two-part install (per §4D):
 *   1. Deny native `Grep` in `.claude/settings.json::permissions.deny`.
 *      Sweet-search wants `ss-grep` to be the default; denying Grep
 *      forces the agent toward the indexed path.
 *   2. PreToolUse hint hook for `Read` — *hints*, never blocks. Edit
 *      workflows require Read before Edit, so a deny would break tooling.
 *
 * Removable cleanly: tracks the deny entry by exact value match and the
 * hook entry by filename match (same pattern as prewarm SessionStart hook).
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';

export const INTERCEPT_READ_HOOK_FILENAME = 'sweet-search-intercept-read.mjs';
const SOURCE_REL = ['scripts', 'hooks', 'intercept-read.mjs'];
const GREP_DENY_VALUE = 'Grep';

/**
 * Install the strict-mode enforcement: Grep deny + Read hint hook.
 * Idempotent. Never throws — surfaces errors via the status object.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string} args.packageRoot
 * @param {boolean} [args.skipped=false]  — set when --enforce-tools is OFF
 * @returns {{ status: string, detail: string, hookPath?: string }}
 *   status ∈ { installed, skipped, error }
 */
export function installToolEnforcement({ projectRoot, packageRoot, skipped = false } = {}) {
  if (skipped) return { status: 'skipped', detail: '--enforce-tools not set' };
  if (!projectRoot) return { status: 'error', detail: 'install-tool-enforcement: projectRoot is required' };
  if (!packageRoot) return { status: 'error', detail: 'install-tool-enforcement: packageRoot is required' };

  // Hook source must exist in the package (covered by package.json files).
  const hookSrcAbs = join(packageRoot, ...SOURCE_REL);
  if (!existsSync(hookSrcAbs)) {
    return { status: 'error', detail: `hook source missing: ${hookSrcAbs}` };
  }

  const hookDestAbs = join(projectRoot, '.claude', 'hooks', INTERCEPT_READ_HOOK_FILENAME);
  const hookRelFromProject = relative(projectRoot, hookDestAbs);
  if (hookRelFromProject.startsWith('..') || isAbsolute(hookRelFromProject)) {
    return { status: 'error', detail: 'hook destination escapes projectRoot' };
  }

  try {
    mkdirSync(dirname(hookDestAbs), { recursive: true });
    copyFileSync(hookSrcAbs, hookDestAbs);
  } catch (err) {
    return { status: 'error', detail: `hook copy failed: ${err.message}` };
  }

  const settingsResult = upsertSettings({
    projectRoot,
    addDeny: GREP_DENY_VALUE,
    addPreToolUseHook: {
      matcher: 'Read',
      command: `node ${hookRelFromProject}`,
      ownershipFilename: INTERCEPT_READ_HOOK_FILENAME,
    },
  });
  if (settingsResult.status !== 'installed') return settingsResult;
  return { ...settingsResult, hookPath: hookRelFromProject };
}

/**
 * Reverse `installToolEnforcement`. Removes the Grep deny entry (only
 * when present), the PreToolUse hook entry (by filename match), and the
 * hook script file. Other denies / hooks are preserved.
 *
 * @returns {{ status: string, detail: string }} status ∈
 *   { removed, not-found, dry-run, error }
 */
export function removeToolEnforcement({ projectRoot, dryRun = false } = {}) {
  if (!projectRoot) return { status: 'error', detail: 'remove-tool-enforcement: projectRoot is required' };

  const hookDestAbs = join(projectRoot, '.claude', 'hooks', INTERCEPT_READ_HOOK_FILENAME);
  const settingsPath = join(projectRoot, '.claude', 'settings.json');

  const hookExists = existsSync(hookDestAbs);
  const denyExists = settingsHasDeny(settingsPath, GREP_DENY_VALUE);
  const hookEntryExists = settingsHasPreToolUseHook(settingsPath, INTERCEPT_READ_HOOK_FILENAME);

  if (!hookExists && !denyExists && !hookEntryExists) {
    return { status: 'not-found', detail: 'no enforcement to undo' };
  }
  if (dryRun) {
    const parts = [
      hookExists && 'hook file',
      denyExists && 'Grep deny',
      hookEntryExists && 'PreToolUse entry',
    ].filter(Boolean);
    return { status: 'dry-run', detail: parts.join(' + ') };
  }

  const removed = [];
  if (hookExists) {
    try { unlinkSync(hookDestAbs); removed.push('hook file'); }
    catch (err) { return { status: 'error', detail: `failed to remove hook: ${err.message}` }; }
  }
  if (denyExists || hookEntryExists) {
    const r = upsertSettings({
      projectRoot,
      removeDeny: denyExists ? GREP_DENY_VALUE : null,
      removePreToolUseHook: hookEntryExists ? INTERCEPT_READ_HOOK_FILENAME : null,
    });
    if (r.status === 'error') return r;
    if (denyExists) removed.push('Grep deny');
    if (hookEntryExists) removed.push('PreToolUse entry');
  }
  return { status: 'removed', detail: removed.join(' + ') };
}

// ─── Settings.json upsert (read → mutate → atomic write) ────────────────────

function upsertSettings({
  projectRoot,
  addDeny = null,
  removeDeny = null,
  addPreToolUseHook = null,
  removePreToolUseHook = null,
}) {
  const settingsDir = join(projectRoot, '.claude');
  const settingsPath = join(settingsDir, 'settings.json');

  let settings = {};
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); }
    catch (err) { return { status: 'error', detail: `settings.json invalid: ${err.message}` }; }
  }

  // Permissions deny.
  if (addDeny) {
    settings.permissions = settings.permissions || {};
    const deny = Array.isArray(settings.permissions.deny) ? settings.permissions.deny : [];
    if (!deny.includes(addDeny)) deny.push(addDeny);
    settings.permissions.deny = deny;
  }
  if (removeDeny) {
    const deny = Array.isArray(settings?.permissions?.deny) ? settings.permissions.deny : [];
    const next = deny.filter((v) => v !== removeDeny);
    if (next.length === 0) {
      if (settings.permissions) delete settings.permissions.deny;
    } else {
      settings.permissions.deny = next;
    }
    if (settings.permissions && Object.keys(settings.permissions).length === 0) delete settings.permissions;
  }

  // PreToolUse hook entry.
  if (addPreToolUseHook) {
    settings.hooks = settings.hooks || {};
    const arr = Array.isArray(settings.hooks.PreToolUse) ? settings.hooks.PreToolUse : [];
    const entry = {
      matcher: addPreToolUseHook.matcher,
      hooks: [
        { type: 'command', command: addPreToolUseHook.command, timeout: 4000, continueOnError: true },
      ],
    };
    const ownedIdx = arr.findIndex(group =>
      Array.isArray(group?.hooks)
      && group.hooks.some(h => typeof h?.command === 'string' && h.command.includes(addPreToolUseHook.ownershipFilename)),
    );
    if (ownedIdx >= 0) arr[ownedIdx] = entry;
    else arr.push(entry);
    settings.hooks.PreToolUse = arr;
  }
  if (removePreToolUseHook) {
    const arr = Array.isArray(settings?.hooks?.PreToolUse) ? settings.hooks.PreToolUse : [];
    const next = arr.filter(group =>
      !Array.isArray(group?.hooks)
      || !group.hooks.some(h => typeof h?.command === 'string' && h.command.includes(removePreToolUseHook)),
    );
    if (next.length === 0) {
      if (settings.hooks) delete settings.hooks.PreToolUse;
    } else {
      settings.hooks.PreToolUse = next;
    }
    if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  }

  try {
    mkdirSync(settingsDir, { recursive: true });
    const tmp = settingsPath + '.tmp';
    writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    renameSync(tmp, settingsPath);
  } catch (err) {
    return { status: 'error', detail: err.message };
  }
  return { status: 'installed', detail: 'permissions + PreToolUse updated' };
}

function settingsHasDeny(settingsPath, value) {
  if (!existsSync(settingsPath)) return false;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const deny = Array.isArray(settings?.permissions?.deny) ? settings.permissions.deny : [];
    return deny.includes(value);
  } catch { return false; }
}

function settingsHasPreToolUseHook(settingsPath, ownershipFilename) {
  if (!existsSync(settingsPath)) return false;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const arr = Array.isArray(settings?.hooks?.PreToolUse) ? settings.hooks.PreToolUse : [];
    return arr.some(group =>
      Array.isArray(group?.hooks)
      && group.hooks.some(h => typeof h?.command === 'string' && h.command.includes(ownershipFilename)),
    );
  } catch { return false; }
}

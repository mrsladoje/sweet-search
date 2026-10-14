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
 * The hook command is `sweet-search-hook --read-hint` (scripts/hooks/hook.mjs): the
 * native binary runs it with the node that installed the package, so it needs no node
 * on Claude Code's PATH and holds no path in the (often committed) settings.json.
 *
 * Removable cleanly: tracks the deny entry by exact value match and the
 * hook entry by its command (same pattern as prewarm SessionStart hook).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const READ_HINT_HOOK_COMMAND = 'sweet-search-hook --read-hint';
const GREP_DENY_VALUE = 'Grep';

/**
 * Install the strict-mode enforcement: Grep deny + Read hint hook.
 * Idempotent. Never throws — surfaces errors via the status object.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {boolean} [args.skipped=false]  — set when --enforce-tools is OFF
 * @returns {{ status: string, detail: string }}
 *   status ∈ { installed, skipped, error }
 */
export function installToolEnforcement({ projectRoot, skipped = false } = {}) {
  if (skipped) return { status: 'skipped', detail: '--enforce-tools not set' };
  if (!projectRoot) return { status: 'error', detail: 'install-tool-enforcement: projectRoot is required' };

  return upsertSettings({
    projectRoot,
    addDeny: GREP_DENY_VALUE,
    addPreToolUseHook: {
      matcher: 'Read',
      command: READ_HINT_HOOK_COMMAND,
      ownershipMarker: READ_HINT_HOOK_COMMAND,
    },
  });
}

/**
 * Reverse `installToolEnforcement`. Removes the Grep deny entry (only
 * when present) and the PreToolUse hook entry (by its command). Other
 * denies / hooks are preserved.
 *
 * @returns {{ status: string, detail: string }} status ∈
 *   { removed, not-found, dry-run, error }
 */
export function removeToolEnforcement({ projectRoot, dryRun = false } = {}) {
  if (!projectRoot) return { status: 'error', detail: 'remove-tool-enforcement: projectRoot is required' };

  const settingsPath = join(projectRoot, '.claude', 'settings.json');

  const denyExists = settingsHasDeny(settingsPath, GREP_DENY_VALUE);
  const hookEntryExists = settingsHasPreToolUseHook(settingsPath, READ_HINT_HOOK_COMMAND);

  if (!denyExists && !hookEntryExists) {
    return { status: 'not-found', detail: 'no enforcement to undo' };
  }
  const removed = [denyExists && 'Grep deny', hookEntryExists && 'PreToolUse entry'].filter(Boolean);
  if (dryRun) return { status: 'dry-run', detail: removed.join(' + ') };

  const r = upsertSettings({
    projectRoot,
    removeDeny: denyExists ? GREP_DENY_VALUE : null,
    removePreToolUseHook: hookEntryExists ? READ_HINT_HOOK_COMMAND : null,
  });
  if (r.status === 'error') return r;
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
        // `timeout` is in seconds; a failed hint never blocks the Read.
        { type: 'command', command: addPreToolUseHook.command, timeout: 5 },
      ],
    };
    const ownedIdx = arr.findIndex(group =>
      Array.isArray(group?.hooks)
      && group.hooks.some(h => typeof h?.command === 'string' && h.command.includes(addPreToolUseHook.ownershipMarker)),
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

function settingsHasPreToolUseHook(settingsPath, ownershipMarker) {
  if (!existsSync(settingsPath)) return false;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const arr = Array.isArray(settings?.hooks?.PreToolUse) ? settings.hooks.PreToolUse : [];
    return arr.some(group =>
      Array.isArray(group?.hooks)
      && group.hooks.some(h => typeof h?.command === 'string' && h.command.includes(ownershipMarker)),
    );
  } catch { return false; }
}

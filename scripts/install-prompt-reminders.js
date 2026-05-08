/**
 * Install / remove the sweet-search UserPromptSubmit reminder hook.
 *
 * Plan reference: §4C / §10 step 16. Default-on; `--no-prompt-reminders`
 * opts out. Universally gated by `--no-claude` (handled in init.js — when
 * --no-claude, this installer is never called).
 *
 * Mirrors the existing prewarm SessionStart pattern in init.js
 * (registerPrewarmSessionStartHook): sweet-search-owned by filename match,
 * so re-running init updates the entry rather than appending duplicates.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';

// Filename doubles as the ownership marker — settings.json entries are
// matched by `command.includes(PROMPT_REMINDER_HOOK_FILENAME)`.
export const PROMPT_REMINDER_HOOK_FILENAME = 'sweet-search-remind-tools.mjs';
const SOURCE_REL = ['scripts', 'hooks', 'remind-tools.mjs'];

/**
 * Copy the hook script into `.claude/hooks/` and register a
 * `hooks.UserPromptSubmit` entry in `.claude/settings.json`. Idempotent.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string} args.packageRoot       — sweet-search install root (for source resolution)
 * @param {boolean} [args.skipped=false]  — set when --no-prompt-reminders
 * @returns {{ status: string, detail: string, hookPath?: string }}
 *   status ∈ { registered, skipped, error }
 */
export function installPromptReminderHook({ projectRoot, packageRoot, skipped = false } = {}) {
  if (skipped) return { status: 'skipped', detail: '--no-prompt-reminders flag' };
  if (!projectRoot) return { status: 'error', detail: 'install-prompt-reminders: projectRoot is required' };
  if (!packageRoot) return { status: 'error', detail: 'install-prompt-reminders: packageRoot is required' };

  const hookSrcAbs = join(packageRoot, ...SOURCE_REL);
  if (!existsSync(hookSrcAbs)) {
    return { status: 'error', detail: `hook source missing: ${hookSrcAbs}` };
  }

  const hookDestAbs = join(projectRoot, '.claude', 'hooks', PROMPT_REMINDER_HOOK_FILENAME);
  const hookRelFromProject = relative(projectRoot, hookDestAbs);
  if (hookRelFromProject.startsWith('..') || isAbsolute(hookRelFromProject)) {
    // Defensive — hookDestAbs is constructed from projectRoot so this can't
    // happen, but the same guardrail used by registerPrewarmSessionStartHook
    // catches anyone refactoring the join() above incorrectly.
    return { status: 'error', detail: 'hook destination escapes projectRoot' };
  }

  try {
    mkdirSync(dirname(hookDestAbs), { recursive: true });
    copyFileSync(hookSrcAbs, hookDestAbs);
  } catch (err) {
    return { status: 'error', detail: `hook copy failed: ${err.message}` };
  }

  const command = `node ${hookRelFromProject}`;
  const settingsResult = writeUserPromptSubmitEntry({
    projectRoot,
    command,
    ownershipFilename: PROMPT_REMINDER_HOOK_FILENAME,
  });
  if (settingsResult.status !== 'registered') return settingsResult;
  return { ...settingsResult, hookPath: hookRelFromProject };
}

/**
 * Reverse `installPromptReminderHook`. Removes the hook file and the
 * UserPromptSubmit settings entry sweet-search owns. Never touches other
 * UserPromptSubmit entries the user added.
 *
 * @returns {{ status: string, detail: string }} — status ∈
 *   { removed, not-found, dry-run, error }
 */
export function removePromptReminderHook({ projectRoot, dryRun = false } = {}) {
  if (!projectRoot) return { status: 'error', detail: 'remove-prompt-reminders: projectRoot is required' };

  const hookDestAbs = join(projectRoot, '.claude', 'hooks', PROMPT_REMINDER_HOOK_FILENAME);
  const settingsPath = join(projectRoot, '.claude', 'settings.json');

  const hookExists = existsSync(hookDestAbs);
  const entryExists = settingsHasOurEntry(settingsPath, PROMPT_REMINDER_HOOK_FILENAME);

  if (!hookExists && !entryExists) return { status: 'not-found', detail: 'no hook file, no settings entry' };
  if (dryRun) {
    return {
      status: 'dry-run',
      detail: [hookExists && 'hook file', entryExists && 'settings entry'].filter(Boolean).join(' + '),
    };
  }

  const removedParts = [];
  if (hookExists) {
    try { unlinkSync(hookDestAbs); removedParts.push('hook file'); }
    catch (err) { return { status: 'error', detail: `failed to remove hook: ${err.message}` }; }
  }
  if (entryExists) {
    const r = removeUserPromptSubmitEntry({ projectRoot, ownershipFilename: PROMPT_REMINDER_HOOK_FILENAME });
    if (r.status === 'error') return r;
    if (r.status === 'removed') removedParts.push('settings entry');
  }
  return { status: 'removed', detail: removedParts.join(' + ') };
}

// ─── Shared helpers (factored so install-tool-enforcement.js can reuse) ─────

/**
 * Write or update a `.claude/settings.json` `hooks.UserPromptSubmit` entry
 * sweet-search owns. Find-by-filename so re-running never duplicates.
 */
export function writeUserPromptSubmitEntry({ projectRoot, command, ownershipFilename }) {
  const settingsDir = join(projectRoot, '.claude');
  const settingsPath = join(settingsDir, 'settings.json');

  let settings = {};
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); }
    catch (err) { return { status: 'error', detail: `existing settings.json is not valid JSON: ${err.message}` }; }
  }
  settings.hooks = settings.hooks || {};
  const arr = Array.isArray(settings.hooks.UserPromptSubmit) ? settings.hooks.UserPromptSubmit : [];

  const entry = {
    hooks: [
      { type: 'command', command, timeout: 4000, continueOnError: true },
    ],
  };
  const ownedIdx = arr.findIndex(group =>
    Array.isArray(group?.hooks)
    && group.hooks.some(h => typeof h?.command === 'string' && h.command.includes(ownershipFilename)),
  );
  let detail;
  if (ownedIdx >= 0) { arr[ownedIdx] = entry; detail = 'updated existing entry'; }
  else { arr.push(entry); detail = 'added new entry'; }
  settings.hooks.UserPromptSubmit = arr;

  try {
    mkdirSync(settingsDir, { recursive: true });
    const tmp = settingsPath + '.tmp';
    writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    renameSync(tmp, settingsPath);
  } catch (err) {
    return { status: 'error', detail: err.message };
  }
  return { status: 'registered', detail };
}

export function removeUserPromptSubmitEntry({ projectRoot, ownershipFilename }) {
  const settingsPath = join(projectRoot, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) return { status: 'not-found', detail: 'no settings.json' };
  let settings;
  try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); }
  catch (err) { return { status: 'error', detail: `settings.json invalid: ${err.message}` }; }
  const arr = Array.isArray(settings?.hooks?.UserPromptSubmit) ? settings.hooks.UserPromptSubmit : [];
  const next = arr.filter(group =>
    !Array.isArray(group?.hooks)
    || !group.hooks.some(h => typeof h?.command === 'string' && h.command.includes(ownershipFilename)),
  );
  if (next.length === arr.length) return { status: 'not-found', detail: 'no sweet-search entry' };
  if (next.length === 0) {
    if (settings.hooks) delete settings.hooks.UserPromptSubmit;
  } else {
    settings.hooks.UserPromptSubmit = next;
  }
  // Drop empty `hooks` to keep settings.json tidy.
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  try {
    const tmp = settingsPath + '.tmp';
    writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    renameSync(tmp, settingsPath);
  } catch (err) {
    return { status: 'error', detail: err.message };
  }
  return { status: 'removed', detail: 'stripped UserPromptSubmit entry' };
}

function settingsHasOurEntry(settingsPath, ownershipFilename) {
  if (!existsSync(settingsPath)) return false;
  let settings;
  try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); }
  catch { return false; }
  const arr = Array.isArray(settings?.hooks?.UserPromptSubmit) ? settings.hooks.UserPromptSubmit : [];
  return arr.some(group =>
    Array.isArray(group?.hooks)
    && group.hooks.some(h => typeof h?.command === 'string' && h.command.includes(ownershipFilename)),
  );
}

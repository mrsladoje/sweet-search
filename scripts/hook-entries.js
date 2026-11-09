/**
 * The `sweet-search-hook` entries init writes into `.claude/settings.json` and `.codex/hooks.json`,
 * and the one definition of "this hook group is ours": its command contains the marker.
 *
 * The hook command is the `sweet-search-hook` command (core/agent-tools/tools.js
 * NODE_ENTRY_COMMANDS): the native binary runs the launcher (scripts/hooks/hook.mjs) with the
 * node that installed the package. No `node` (the harness may start without node on PATH) and no
 * path (settings files are often committed). Its name doubles as the ownership marker.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { writeViaTmp } from './install-fs.js';

export const HOOK_BIN = 'sweet-search-hook';

/** The flags scripts/hooks/hook.mjs reads. */
export const HOOK_FLAGS = Object.freeze({
  sessionStart: '--agent-session-hook',
  sessionDrop: '--agent-session-drop',
  readHint: '--read-hint',
  sessionTitle: '--session-title',
});

export const hookCommand = (flag) => `${HOOK_BIN} ${flag}`;

/**
 * True when a hook group holds a command that contains `marker`. An array of markers
 * means the command must contain all of them.
 */
export function hasOwnedHook(group, marker) {
  const markers = Array.isArray(marker) ? marker : [marker];
  return Array.isArray(group?.hooks)
    && group.hooks.some((h) => typeof h?.command === 'string' && markers.every((m) => h.command.includes(m)));
}

/** `groups` without the groups that are ours. */
export function removeOwnedGroups(groups, marker) {
  return groups.filter((group) => !hasOwnedHook(group, marker));
}

/**
 * Replace our group in `groups` with `entry`, or append it. Changes `groups` in place.
 * Returns the index of the group that was replaced, or -1 when `entry` was appended.
 */
export function upsertOwnedGroup(groups, entry, marker) {
  const at = groups.findIndex((group) => hasOwnedHook(group, marker));
  if (at >= 0) groups[at] = entry;
  else groups.push(entry);
  return at;
}

/**
 * Register (or update) our SessionStart entry in a hook settings file, `<dir>/<fileName>`.
 * With `sessionEnd`, also our SessionEnd entry (Claude Code has a real SessionEnd event; the entry
 * drops the session's bounded receipt bucket instead of waiting for daemon/session LRU eviction).
 * Non-destructive and idempotent: other hooks and keys stay, our entry is replaced, not repeated.
 *
 * `label` names the file in the "not valid JSON" error. Returns `{ status, detail }`:
 *   registered  — entry written (new or updated)
 *   error       — file unreadable as JSON, or write failed
 */
export function registerSessionHooks({ dir, fileName, label, sessionEnd = false }) {
  const path = join(dir, fileName);

  let doc = {};
  if (existsSync(path)) {
    try {
      doc = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (err) {
      return { status: 'error', detail: `existing ${label} is not valid JSON: ${err.message}` };
    }
  }

  doc.hooks = doc.hooks || {};
  const sessionStart = Array.isArray(doc.hooks.SessionStart) ? doc.hooks.SessionStart : [];

  // `timeout` is in seconds. A failed hook never blocks the session; the launcher detaches and
  // returns in well under a second. Start/resume prewarm the daemon; clear/compact also reset
  // shown-span receipts for the new context epoch.
  const entry = {
    matcher: 'startup|resume|clear|compact',
    hooks: [
      {
        type: 'command',
        command: hookCommand(HOOK_FLAGS.sessionStart),
        timeout: 10,
      },
    ],
  };
  const at = upsertOwnedGroup(sessionStart, entry, HOOK_BIN);
  doc.hooks.SessionStart = sessionStart;

  if (sessionEnd) {
    const endGroups = Array.isArray(doc.hooks.SessionEnd) ? doc.hooks.SessionEnd : [];
    const endEntry = {
      hooks: [
        {
          type: 'command',
          command: hookCommand(HOOK_FLAGS.sessionDrop),
          // SessionEnd hooks share a 1.5 s budget in Claude Code.
          timeout: 2,
        },
      ],
    };
    upsertOwnedGroup(endGroups, endEntry, [HOOK_BIN, HOOK_FLAGS.sessionDrop]);
    doc.hooks.SessionEnd = endGroups;
  }

  try {
    mkdirSync(dir, { recursive: true });
    writeViaTmp(path, JSON.stringify(doc, null, 2) + '\n');
  } catch (err) {
    return { status: 'error', detail: err.message };
  }

  return {
    status: 'registered',
    detail: at >= 0 ? 'updated existing entry' : 'added new entry',
  };
}

/**
 * Remove the sweet-search-owned SessionStart and SessionEnd entries from `.claude/settings.json`,
 * preserving every other hook, permission, and top-level key. Detection is
 * by command name (see HOOK_BIN) — only entries whose command
 * runs `sweet-search-hook` are removed.
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
    const filtered = removeOwnedGroups(groups, HOOK_BIN);
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
    writeViaTmp(settingsPath, JSON.stringify(settings, null, 2) + '\n');
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

  const filtered = removeOwnedGroups(sessionStart, HOOK_BIN);

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
      writeViaTmp(hooksPath, JSON.stringify(doc, null, 2) + '\n');
    }
  } catch (err) {
    return { status: 'error', detail: `write failed: ${err.message}` };
  }

  return { status: 'removed', detail: `spliced out ${sessionStart.length - filtered.length} entry` };
}

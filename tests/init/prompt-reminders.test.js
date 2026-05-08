/**
 * Unit tests for `scripts/install-prompt-reminders.js` (P2 — UserPromptSubmit
 * reminder hook). Plan reference: §4C / §10 step 16.
 *
 * Each test runs in an isolated tmpdir. The packageRoot is the real
 * sweet-search repo (so the hook source resolves) — we just write the
 * destination tree under the tmpdir.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, fileURLToPath, join } from 'node:url';
import { dirname as dn, join as joinPath } from 'node:path';

import {
  PROMPT_REMINDER_HOOK_FILENAME,
  installPromptReminderHook,
  removePromptReminderHook,
  writeUserPromptSubmitEntry,
  removeUserPromptSubmitEntry,
} from '../../scripts/install-prompt-reminders.js';
import { parseInitArgs } from '../../scripts/init.js';

const __dirname = dn(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = joinPath(__dirname, '..', '..');

let tmpRoot;
beforeEach(() => {
  tmpRoot = mkdtempSync(joinPath(tmpdir(), 'sweet-search-p2-test-'));
});
afterEach(() => {
  if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

const SETTINGS_REL = '.claude/settings.json';
const HOOK_REL = `.claude/hooks/${PROMPT_REMINDER_HOOK_FILENAME}`;
const readSettings = () => JSON.parse(readFileSync(joinPath(tmpRoot, SETTINGS_REL), 'utf8'));

describe('installPromptReminderHook', () => {
  it('copies hook + writes UserPromptSubmit settings entry on fresh install', () => {
    const r = installPromptReminderHook({ projectRoot: tmpRoot, packageRoot: PACKAGE_ROOT });
    expect(r.status).toBe('registered');
    expect(r.detail).toContain('added');
    expect(existsSync(joinPath(tmpRoot, HOOK_REL))).toBe(true);

    const settings = readSettings();
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    const entry = settings.hooks.UserPromptSubmit[0];
    expect(entry.hooks[0].command).toContain(PROMPT_REMINDER_HOOK_FILENAME);
    expect(entry.hooks[0].type).toBe('command');
    expect(entry.hooks[0].timeout).toBe(4000);
  });

  it('is idempotent — second run updates the same entry instead of duplicating', () => {
    installPromptReminderHook({ projectRoot: tmpRoot, packageRoot: PACKAGE_ROOT });
    const r2 = installPromptReminderHook({ projectRoot: tmpRoot, packageRoot: PACKAGE_ROOT });
    expect(r2.status).toBe('registered');
    expect(r2.detail).toContain('updated');
    expect(readSettings().hooks.UserPromptSubmit).toHaveLength(1);
  });

  it('preserves user-added UserPromptSubmit entries on install', () => {
    mkdirSync(joinPath(tmpRoot, '.claude'), { recursive: true });
    writeFileSync(joinPath(tmpRoot, SETTINGS_REL), JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo my-own-hook' }] }],
      },
    }, null, 2));
    installPromptReminderHook({ projectRoot: tmpRoot, packageRoot: PACKAGE_ROOT });
    const settings = readSettings();
    expect(settings.hooks.UserPromptSubmit).toHaveLength(2);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe('echo my-own-hook');
  });

  it('skips when --no-prompt-reminders is set', () => {
    const r = installPromptReminderHook({ projectRoot: tmpRoot, packageRoot: PACKAGE_ROOT, skipped: true });
    expect(r.status).toBe('skipped');
    expect(existsSync(joinPath(tmpRoot, HOOK_REL))).toBe(false);
    expect(existsSync(joinPath(tmpRoot, SETTINGS_REL))).toBe(false);
  });

  it('returns error on missing projectRoot / packageRoot', () => {
    expect(installPromptReminderHook({}).status).toBe('error');
    expect(installPromptReminderHook({ projectRoot: tmpRoot }).status).toBe('error');
  });

  it('returns error when the source hook is missing from packageRoot', () => {
    const fakePackage = mkdtempSync(joinPath(tmpdir(), 'fake-pkg-'));
    const r = installPromptReminderHook({ projectRoot: tmpRoot, packageRoot: fakePackage });
    expect(r.status).toBe('error');
    expect(r.detail).toContain('hook source missing');
    rmSync(fakePackage, { recursive: true, force: true });
  });
});

describe('removePromptReminderHook', () => {
  it('round-trip: install → remove leaves no trace', () => {
    installPromptReminderHook({ projectRoot: tmpRoot, packageRoot: PACKAGE_ROOT });
    const r = removePromptReminderHook({ projectRoot: tmpRoot });
    expect(r.status).toBe('removed');
    expect(existsSync(joinPath(tmpRoot, HOOK_REL))).toBe(false);
    expect(readSettings().hooks).toBeUndefined();
  });

  it('preserves user-added UserPromptSubmit entries on uninstall', () => {
    installPromptReminderHook({ projectRoot: tmpRoot, packageRoot: PACKAGE_ROOT });
    const settings = readSettings();
    settings.hooks.UserPromptSubmit.push({ hooks: [{ type: 'command', command: 'echo other' }] });
    writeFileSync(joinPath(tmpRoot, SETTINGS_REL), JSON.stringify(settings, null, 2));

    removePromptReminderHook({ projectRoot: tmpRoot });
    const after = readSettings();
    expect(after.hooks.UserPromptSubmit).toHaveLength(1);
    expect(after.hooks.UserPromptSubmit[0].hooks[0].command).toBe('echo other');
  });

  it('dry-run does not modify anything', () => {
    installPromptReminderHook({ projectRoot: tmpRoot, packageRoot: PACKAGE_ROOT });
    const before = readFileSync(joinPath(tmpRoot, SETTINGS_REL), 'utf8');
    const r = removePromptReminderHook({ projectRoot: tmpRoot, dryRun: true });
    expect(r.status).toBe('dry-run');
    expect(readFileSync(joinPath(tmpRoot, SETTINGS_REL), 'utf8')).toBe(before);
    expect(existsSync(joinPath(tmpRoot, HOOK_REL))).toBe(true);
  });

  it('returns not-found when nothing was installed', () => {
    expect(removePromptReminderHook({ projectRoot: tmpRoot }).status).toBe('not-found');
  });
});

describe('writeUserPromptSubmitEntry / removeUserPromptSubmitEntry (low-level)', () => {
  it('handles missing settings.json by creating one', () => {
    const r = writeUserPromptSubmitEntry({
      projectRoot: tmpRoot,
      command: 'node my-hook.mjs',
      ownershipFilename: 'my-hook.mjs',
    });
    expect(r.status).toBe('registered');
    expect(readSettings().hooks.UserPromptSubmit).toHaveLength(1);
  });

  it('rejects malformed existing settings.json', () => {
    mkdirSync(joinPath(tmpRoot, '.claude'), { recursive: true });
    writeFileSync(joinPath(tmpRoot, SETTINGS_REL), '{ malformed JSON');
    const r = writeUserPromptSubmitEntry({
      projectRoot: tmpRoot,
      command: 'x',
      ownershipFilename: 'x',
    });
    expect(r.status).toBe('error');
  });

  it('removeUserPromptSubmitEntry returns not-found when absent', () => {
    const r = removeUserPromptSubmitEntry({ projectRoot: tmpRoot, ownershipFilename: 'nope.mjs' });
    expect(r.status).toBe('not-found');
  });
});

describe('parseInitArgs — --no-prompt-reminders', () => {
  it('default: prompt reminders enabled', () => {
    expect(parseInitArgs([]).skipPromptReminders).toBe(false);
  });
  it('--no-prompt-reminders flips the flag', () => {
    expect(parseInitArgs(['--no-prompt-reminders']).skipPromptReminders).toBe(true);
  });
});

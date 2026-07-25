/**
 * Unit tests for the legacy UserPromptSubmit reminder lifecycle helper.
 * Production init no longer installs this duplicate guidance, but re-init and
 * uninstall must still remove artifacts created by older releases safely.
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

  it('supports a legacy caller opt-out', () => {
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

describe('remind-tools.mjs hook script (Claude Code UserPromptSubmit contract)', async () => {
  // UserPromptSubmit hooks: plain stdout text is automatically added to
  // the model's prompt context (per Claude Code hooks docs — verified
  // 2026-05-09). No JSON wrapping needed for a passive reminder. This
  // test spawns the actual hook and verifies the output shape.
  const { spawnSync } = await import('node:child_process');
  const HOOK_PATH = joinPath(PACKAGE_ROOT, 'scripts', 'hooks', 'remind-tools.mjs');

  it('emits the tool-routing reminder on stdout and exits 0', () => {
    const result = spawnSync(process.execPath, [HOOK_PATH], {
      input: '{}', // UserPromptSubmit passes JSON on stdin (we ignore it)
      encoding: 'utf8',
      timeout: 4000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('<sweet-search-reminder>');
    expect(result.stdout).toContain('</sweet-search-reminder>');
    expect(result.stdout).toContain('ss-grep');
    expect(result.stdout).toContain('ss-find');
    expect(result.stdout).toContain('ss-read');
    expect(result.stdout).toContain('ss-semantic');
    expect(result.stdout).toContain('STOP');
  });

  it('reminder length stays within ~80-token budget (plan §4C)', () => {
    const result = spawnSync(process.execPath, [HOOK_PATH], {
      input: '',
      encoding: 'utf8',
      timeout: 4000,
    });
    // Rough char→token approximation (4 chars/token). Plan §4C wants the
    // reminder cheap because it fires every prompt; a hard cap catches
    // accidental bloat in future edits.
    const approxTokens = result.stdout.length / 4;
    expect(approxTokens).toBeLessThan(200);
  });
});

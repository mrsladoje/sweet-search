/**
 * Unit tests for `scripts/install-tool-enforcement.js` (P3 — opt-in
 * --enforce-tools strict mode). Plan reference: §4D / §10 step 17.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname as dn, join as joinPath } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  READ_HINT_HOOK_COMMAND,
  installToolEnforcement,
  removeToolEnforcement,
} from '../../scripts/install-tool-enforcement.js';
import { parseInitArgs } from '../../scripts/init.js';

const __dirname = dn(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = joinPath(__dirname, '..', '..');

let tmpRoot;
beforeEach(() => {
  tmpRoot = mkdtempSync(joinPath(tmpdir(), 'sweet-search-p3-test-'));
});
afterEach(() => {
  if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

const SETTINGS_REL = '.claude/settings.json';
const readSettings = () => JSON.parse(readFileSync(joinPath(tmpRoot, SETTINGS_REL), 'utf8'));

describe('installToolEnforcement', () => {
  it('on fresh install: writes Grep deny + PreToolUse Read hint, and copies no file', () => {
    const r = installToolEnforcement({ projectRoot: tmpRoot });
    expect(r.status).toBe('installed');
    expect(existsSync(joinPath(tmpRoot, '.claude', 'hooks'))).toBe(false);

    const settings = readSettings();
    expect(settings.permissions.deny).toContain('Grep');
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    const entry = settings.hooks.PreToolUse[0];
    expect(entry.matcher).toBe('Read');
    // The native `sweet-search-hook` command: no `node`, no path.
    expect(entry.hooks[0]).toEqual({ type: 'command', command: READ_HINT_HOOK_COMMAND, timeout: 5 });
  });

  it('idempotent: second run does not duplicate Grep deny or PreToolUse entry', () => {
    installToolEnforcement({ projectRoot: tmpRoot });
    installToolEnforcement({ projectRoot: tmpRoot });
    const settings = readSettings();
    expect(settings.permissions.deny.filter(v => v === 'Grep')).toHaveLength(1);
    expect(settings.hooks.PreToolUse).toHaveLength(1);
  });

  it('preserves user-added permissions denies on install', () => {
    mkdirSync(joinPath(tmpRoot, '.claude'), { recursive: true });
    writeFileSync(joinPath(tmpRoot, SETTINGS_REL), JSON.stringify({
      permissions: { deny: ['Bash(rm -rf /)'] },
    }, null, 2));
    installToolEnforcement({ projectRoot: tmpRoot });
    expect(readSettings().permissions.deny).toEqual(['Bash(rm -rf /)', 'Grep']);
  });

  it('preserves user-added PreToolUse entries on install', () => {
    mkdirSync(joinPath(tmpRoot, '.claude'), { recursive: true });
    writeFileSync(joinPath(tmpRoot, SETTINGS_REL), JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo audit' }] }],
      },
    }, null, 2));
    installToolEnforcement({ projectRoot: tmpRoot });
    expect(readSettings().hooks.PreToolUse).toHaveLength(2);
  });

  it('skips when --enforce-tools not set (skipped: true)', () => {
    const r = installToolEnforcement({ projectRoot: tmpRoot, skipped: true });
    expect(r.status).toBe('skipped');
    expect(existsSync(joinPath(tmpRoot, SETTINGS_REL))).toBe(false);
  });

  it('returns error on missing projectRoot', () => {
    expect(installToolEnforcement({}).status).toBe('error');
  });
});

describe('removeToolEnforcement', () => {
  it('round-trip: install → remove leaves no trace', () => {
    installToolEnforcement({ projectRoot: tmpRoot });
    const r = removeToolEnforcement({ projectRoot: tmpRoot });
    expect(r.status).toBe('removed');
    const settings = readSettings();
    expect(settings.permissions).toBeUndefined();
    expect(settings.hooks).toBeUndefined();
  });

  it('preserves user-added denies + PreToolUse on uninstall', () => {
    installToolEnforcement({ projectRoot: tmpRoot });
    const settings = readSettings();
    settings.permissions.deny.push('Bash(rm -rf /)');
    settings.hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo audit' }] });
    writeFileSync(joinPath(tmpRoot, SETTINGS_REL), JSON.stringify(settings, null, 2));

    removeToolEnforcement({ projectRoot: tmpRoot });
    const after = readSettings();
    expect(after.permissions.deny).toEqual(['Bash(rm -rf /)']);
    expect(after.hooks.PreToolUse).toHaveLength(1);
    expect(after.hooks.PreToolUse[0].matcher).toBe('Bash');
  });

  it('dry-run reports artifacts without modifying anything', () => {
    installToolEnforcement({ projectRoot: tmpRoot });
    const before = readFileSync(joinPath(tmpRoot, SETTINGS_REL), 'utf8');
    const r = removeToolEnforcement({ projectRoot: tmpRoot, dryRun: true });
    expect(r.status).toBe('dry-run');
    expect(r.detail).toContain('Grep deny');
    expect(r.detail).toContain('PreToolUse entry');
    expect(readFileSync(joinPath(tmpRoot, SETTINGS_REL), 'utf8')).toBe(before);
  });

  it('returns not-found when nothing was installed', () => {
    expect(removeToolEnforcement({ projectRoot: tmpRoot }).status).toBe('not-found');
  });
});

describe('parseInitArgs — --enforce-tools', () => {
  it('default: enforcement off', () => {
    expect(parseInitArgs([]).enforceTools).toBe(false);
  });
  it('--enforce-tools enables strict mode', () => {
    expect(parseInitArgs(['--enforce-tools']).enforceTools).toBe(true);
  });
});

describe('sweet-search-hook --read-hint (Claude Code PreToolUse contract)', async () => {
  // The hook surfaces a hint to the model via JSON stdout — stderr alone
  // doesn't reach the model. This test spawns the script `sweet-search-hook`
  // runs (scripts/hooks/hook.mjs) with a mock PreToolUse JSON payload on stdin
  // and verifies the output contract. Anchored to claude-code-guide audit
  // (2026-05-09): plan §4D.
  const { spawnSync } = await import('node:child_process');
  const HOOK_PATH = joinPath(PACKAGE_ROOT, 'scripts', 'hooks', 'hook.mjs');

  it('emits valid JSON with hookSpecificOutput.additionalContext on stdout', () => {
    const stdinPayload = JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: '/some/file.js' },
    });
    const result = spawnSync(process.execPath, [HOOK_PATH, '--read-hint'], {
      input: stdinPayload,
      encoding: 'utf8',
      timeout: 4000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBeTruthy();
    let parsed;
    expect(() => { parsed = JSON.parse(result.stdout); }).not.toThrow();
    expect(parsed.hookSpecificOutput).toBeDefined();
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('allow');
    expect(parsed.hookSpecificOutput.additionalContext).toMatch(/ss-read/);
    expect(parsed.hookSpecificOutput.additionalContext).toMatch(/ss-semantic/);
  });

  it('exits 0 (never blocks) — Read always proceeds even when hint fires', () => {
    const result = spawnSync(process.execPath, [HOOK_PATH, '--read-hint'], {
      input: '{}',
      encoding: 'utf8',
      timeout: 4000,
    });
    expect(result.status).toBe(0);
  });
});

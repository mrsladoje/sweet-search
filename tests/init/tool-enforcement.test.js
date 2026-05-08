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
  INTERCEPT_READ_HOOK_FILENAME,
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
const HOOK_REL = `.claude/hooks/${INTERCEPT_READ_HOOK_FILENAME}`;
const readSettings = () => JSON.parse(readFileSync(joinPath(tmpRoot, SETTINGS_REL), 'utf8'));

describe('installToolEnforcement', () => {
  it('on fresh install: writes Grep deny + PreToolUse Read hint + hook file', () => {
    const r = installToolEnforcement({ projectRoot: tmpRoot, packageRoot: PACKAGE_ROOT });
    expect(r.status).toBe('installed');
    expect(existsSync(joinPath(tmpRoot, HOOK_REL))).toBe(true);

    const settings = readSettings();
    expect(settings.permissions.deny).toContain('Grep');
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    const entry = settings.hooks.PreToolUse[0];
    expect(entry.matcher).toBe('Read');
    expect(entry.hooks[0].command).toContain(INTERCEPT_READ_HOOK_FILENAME);
  });

  it('idempotent: second run does not duplicate Grep deny or PreToolUse entry', () => {
    installToolEnforcement({ projectRoot: tmpRoot, packageRoot: PACKAGE_ROOT });
    installToolEnforcement({ projectRoot: tmpRoot, packageRoot: PACKAGE_ROOT });
    const settings = readSettings();
    expect(settings.permissions.deny.filter(v => v === 'Grep')).toHaveLength(1);
    expect(settings.hooks.PreToolUse).toHaveLength(1);
  });

  it('preserves user-added permissions denies on install', () => {
    mkdirSync(joinPath(tmpRoot, '.claude'), { recursive: true });
    writeFileSync(joinPath(tmpRoot, SETTINGS_REL), JSON.stringify({
      permissions: { deny: ['Bash(rm -rf /)'] },
    }, null, 2));
    installToolEnforcement({ projectRoot: tmpRoot, packageRoot: PACKAGE_ROOT });
    expect(readSettings().permissions.deny).toEqual(['Bash(rm -rf /)', 'Grep']);
  });

  it('preserves user-added PreToolUse entries on install', () => {
    mkdirSync(joinPath(tmpRoot, '.claude'), { recursive: true });
    writeFileSync(joinPath(tmpRoot, SETTINGS_REL), JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo audit' }] }],
      },
    }, null, 2));
    installToolEnforcement({ projectRoot: tmpRoot, packageRoot: PACKAGE_ROOT });
    expect(readSettings().hooks.PreToolUse).toHaveLength(2);
  });

  it('skips when --enforce-tools not set (skipped: true)', () => {
    const r = installToolEnforcement({ projectRoot: tmpRoot, packageRoot: PACKAGE_ROOT, skipped: true });
    expect(r.status).toBe('skipped');
    expect(existsSync(joinPath(tmpRoot, HOOK_REL))).toBe(false);
    expect(existsSync(joinPath(tmpRoot, SETTINGS_REL))).toBe(false);
  });

  it('returns error on missing projectRoot / packageRoot', () => {
    expect(installToolEnforcement({}).status).toBe('error');
    expect(installToolEnforcement({ projectRoot: tmpRoot }).status).toBe('error');
  });
});

describe('removeToolEnforcement', () => {
  it('round-trip: install → remove leaves no trace', () => {
    installToolEnforcement({ projectRoot: tmpRoot, packageRoot: PACKAGE_ROOT });
    const r = removeToolEnforcement({ projectRoot: tmpRoot });
    expect(r.status).toBe('removed');
    expect(existsSync(joinPath(tmpRoot, HOOK_REL))).toBe(false);
    const settings = readSettings();
    expect(settings.permissions).toBeUndefined();
    expect(settings.hooks).toBeUndefined();
  });

  it('preserves user-added denies + PreToolUse on uninstall', () => {
    installToolEnforcement({ projectRoot: tmpRoot, packageRoot: PACKAGE_ROOT });
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
    installToolEnforcement({ projectRoot: tmpRoot, packageRoot: PACKAGE_ROOT });
    const before = readFileSync(joinPath(tmpRoot, SETTINGS_REL), 'utf8');
    const r = removeToolEnforcement({ projectRoot: tmpRoot, dryRun: true });
    expect(r.status).toBe('dry-run');
    expect(r.detail).toContain('Grep deny');
    expect(r.detail).toContain('PreToolUse entry');
    expect(r.detail).toContain('hook file');
    expect(readFileSync(joinPath(tmpRoot, SETTINGS_REL), 'utf8')).toBe(before);
  });

  it('returns not-found when nothing was installed', () => {
    expect(removeToolEnforcement({ projectRoot: tmpRoot }).status).toBe('not-found');
  });

  it('handles partial state: hook file exists but settings entry stripped', () => {
    installToolEnforcement({ projectRoot: tmpRoot, packageRoot: PACKAGE_ROOT });
    // Manually wipe settings.json to simulate user re-init / partial cleanup.
    rmSync(joinPath(tmpRoot, SETTINGS_REL));
    const r = removeToolEnforcement({ projectRoot: tmpRoot });
    expect(r.status).toBe('removed');
    expect(r.detail).toBe('hook file');
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

describe('intercept-read.mjs hook script (Claude Code PreToolUse contract)', async () => {
  // The hook surfaces a hint to the model via JSON stdout — stderr alone
  // doesn't reach the model. This test spawns the actual script with a
  // mock PreToolUse JSON payload on stdin and verifies the output contract.
  // Anchored to claude-code-guide audit (2026-05-09): plan §4D.
  const { spawnSync } = await import('node:child_process');
  const HOOK_PATH = joinPath(PACKAGE_ROOT, 'scripts', 'hooks', 'intercept-read.mjs');

  it('emits valid JSON with hookSpecificOutput.additionalContext on stdout', () => {
    const stdinPayload = JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: '/some/file.js' },
    });
    const result = spawnSync(process.execPath, [HOOK_PATH], {
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
    const result = spawnSync(process.execPath, [HOOK_PATH], {
      input: '{}',
      encoding: 'utf8',
      timeout: 4000,
    });
    expect(result.status).toBe(0);
  });
});

/**
 * Tests for the Claude Code SessionStart prewarm hook install/remove logic.
 *
 * Covers the contract documented in scripts/init.js::registerPrewarmSessionStartHook
 * and scripts/uninstall.js::removePrewarmSessionStartHook:
 *   - merge is non-destructive (preserves other hooks, permissions, env)
 *   - idempotent re-install updates in place (does not duplicate)
 *   - command-name marker detection (no shell-comment trick)
 *   - the command is `sweet-search-hook`: no `node`, no path
 *   - uninstall removes only sweet-search-owned entries
 *   - dry-run and not-found paths do not touch the file
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { registerPrewarmSessionStartHook, PREWARM_HOOK_COMMAND } from '../../scripts/init.js';
import { removePrewarmSessionStartHook } from '../../scripts/uninstall.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let projectRoot;
let settingsPath;

function writeSettings(obj) {
  mkdirSync(join(projectRoot, '.claude'), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(obj, null, 2), 'utf-8');
}

function readSettings() {
  return JSON.parse(readFileSync(settingsPath, 'utf-8'));
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'ss-preheat-proj-'));
  settingsPath = join(projectRoot, '.claude', 'settings.json');
});

afterEach(() => {
  try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// registerPrewarmSessionStartHook
// ---------------------------------------------------------------------------

describe('registerPrewarmSessionStartHook', () => {
  it('creates settings.json with a SessionStart entry when none exists', () => {
    const result = registerPrewarmSessionStartHook({ projectRoot });

    expect(result.status).toBe('registered');
    expect(result.detail).toContain('added');

    const s = readSettings();
    expect(s.hooks.SessionStart).toHaveLength(1);
    expect(s.hooks.SessionStart[0].matcher).toBe('startup|resume|clear|compact');
    // The native `sweet-search-hook` command: no `node` (the harness may have none on
    // PATH), no path (settings.json is often committed).
    expect(s.hooks.SessionStart[0].hooks[0].command).toBe(`${PREWARM_HOOK_COMMAND} --agent-session-hook`);
    expect(s.hooks.SessionEnd).toHaveLength(1);
    expect(s.hooks.SessionEnd[0].hooks[0].command).toBe(`${PREWARM_HOOK_COMMAND} --agent-session-drop`);
  });

  it('is idempotent: re-running updates in place, never duplicates', () => {
    registerPrewarmSessionStartHook({ projectRoot });
    registerPrewarmSessionStartHook({ projectRoot });
    const result = registerPrewarmSessionStartHook({ projectRoot });

    expect(result.status).toBe('registered');
    expect(result.detail).toContain('updated');

    const s = readSettings();
    expect(s.hooks.SessionStart).toHaveLength(1);
    expect(s.hooks.SessionEnd).toHaveLength(1);
  });

  it('preserves pre-existing SessionStart entries from other tools', () => {
    writeSettings({
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'npx agentic-qe hooks session-start --json' }] },
        ],
      },
    });

    registerPrewarmSessionStartHook({ projectRoot });

    const s = readSettings();
    expect(s.hooks.SessionStart).toHaveLength(2);
    expect(s.hooks.SessionStart[0].hooks[0].command).toContain('agentic-qe');
    expect(s.hooks.SessionStart[1].hooks[0].command).toContain(PREWARM_HOOK_COMMAND);
  });

  it('preserves other top-level keys (permissions, env, PreToolUse)', () => {
    writeSettings({
      hooks: {
        PreToolUse: [{ matcher: '^Write$', hooks: [{ type: 'command', command: 'echo pre' }] }],
      },
      permissions: { allow: ['Bash(npx foo:*)'] },
      env: { FOO: 'bar' },
    });

    registerPrewarmSessionStartHook({ projectRoot });

    const s = readSettings();
    expect(s.hooks.PreToolUse).toHaveLength(1);
    expect(s.hooks.PreToolUse[0].hooks[0].command).toBe('echo pre');
    expect(s.permissions.allow).toEqual(['Bash(npx foo:*)']);
    expect(s.env.FOO).toBe('bar');
    expect(s.hooks.SessionStart).toHaveLength(1);
  });

  it('short-circuits when skipped=true and does not touch settings.json', () => {
    const result = registerPrewarmSessionStartHook({ projectRoot, skipped: true });

    expect(result.status).toBe('skipped');
    expect(existsSync(settingsPath)).toBe(false);
  });

  it('returns error when existing settings.json is not valid JSON', () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(settingsPath, '{ this is not json', 'utf-8');

    const result = registerPrewarmSessionStartHook({ projectRoot });

    expect(result.status).toBe('error');
    expect(result.detail).toContain('JSON');
  });

});

// ---------------------------------------------------------------------------
// removePrewarmSessionStartHook
// ---------------------------------------------------------------------------

describe('removePrewarmSessionStartHook', () => {
  it('returns not-found when settings.json does not exist', () => {
    const result = removePrewarmSessionStartHook(projectRoot);

    expect(result.status).toBe('not-found');
  });

  it('returns not-found when no SessionStart section exists', () => {
    writeSettings({ permissions: { allow: [] } });

    const result = removePrewarmSessionStartHook(projectRoot);

    expect(result.status).toBe('not-found');
  });

  it('returns not-found when no entry matches the marker command', () => {
    writeSettings({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'npx agentic-qe hooks session-start' }] }] },
    });

    const result = removePrewarmSessionStartHook(projectRoot);

    expect(result.status).toBe('not-found');
    // File left untouched.
    const s = readSettings();
    expect(s.hooks.SessionStart).toHaveLength(1);
  });

  it('removes only the sweet-search-owned entry, preserves the rest', () => {
    writeSettings({
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'npx agentic-qe hooks session-start --json' }] },
          { hooks: [{ type: 'command', command: `${PREWARM_HOOK_COMMAND} --agent-session-hook` }] },
          { hooks: [{ type: 'command', command: 'node .claude/helpers/brain-checkpoint.cjs verify' }] },
        ],
        PreToolUse: [{ matcher: '^Write$', hooks: [{ type: 'command', command: 'echo pre' }] }],
      },
      permissions: { allow: ['Bash(npx foo:*)'] },
    });

    const result = removePrewarmSessionStartHook(projectRoot);

    expect(result.status).toBe('removed');

    const s = readSettings();
    expect(s.hooks.SessionStart).toHaveLength(2);
    const cmds = s.hooks.SessionStart.map((g) => g.hooks[0].command);
    expect(cmds.some((c) => c.includes('agentic-qe'))).toBe(true);
    expect(cmds.some((c) => c.includes('brain-checkpoint'))).toBe(true);
    expect(cmds.some((c) => c.includes(PREWARM_HOOK_COMMAND))).toBe(false);
    // Sibling sections untouched.
    expect(s.hooks.PreToolUse).toHaveLength(1);
    expect(s.permissions.allow).toEqual(['Bash(npx foo:*)']);
  });

  it('removes the paired SessionEnd receipt cleanup hook', () => {
    registerPrewarmSessionStartHook({ projectRoot });
    const before = readSettings();
    expect(before.hooks.SessionEnd).toHaveLength(1);

    removePrewarmSessionStartHook(projectRoot);

    const after = readSettings();
    expect(after.hooks?.SessionStart).toBeUndefined();
    expect(after.hooks?.SessionEnd).toBeUndefined();
  });

  it('cleans up empty SessionStart array when sweet-search was the sole entry', () => {
    writeSettings({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `${PREWARM_HOOK_COMMAND} --agent-session-hook` }] }] },
    });

    removePrewarmSessionStartHook(projectRoot);

    const s = readSettings();
    // SessionStart key deleted when empty, hooks obj deleted when empty.
    expect(s.hooks?.SessionStart).toBeUndefined();
  });

  it('dry-run reports the entry exists but does not write', () => {
    writeSettings({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `${PREWARM_HOOK_COMMAND} --agent-session-hook` }] }] },
    });
    const beforeMtime = readFileSync(settingsPath, 'utf-8');

    const result = removePrewarmSessionStartHook(projectRoot, { dryRun: true });

    expect(result.status).toBe('dry-run');
    expect(readFileSync(settingsPath, 'utf-8')).toBe(beforeMtime);
  });

  it('returns error when settings.json is not valid JSON', () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(settingsPath, 'not json at all', 'utf-8');

    const result = removePrewarmSessionStartHook(projectRoot);

    expect(result.status).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// Round-trip: register then remove must leave settings.json identical
// ---------------------------------------------------------------------------

describe('register + remove round-trip', () => {
  it('restores settings.json to its pre-registration state', () => {
    const preExisting = {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'npx agentic-qe hooks session-start --json' }] }],
        PreToolUse: [{ matcher: '^Write$', hooks: [{ type: 'command', command: 'echo pre' }] }],
      },
      permissions: { allow: ['Bash(npx foo:*)'] },
      env: { DEBUG: '1' },
    };
    writeSettings(preExisting);
    const original = readFileSync(settingsPath, 'utf-8');

    registerPrewarmSessionStartHook({ projectRoot });
    // After register, settings differs.
    expect(readFileSync(settingsPath, 'utf-8')).not.toBe(original);

    removePrewarmSessionStartHook(projectRoot);
    // After remove, the file's structural content should match the original.
    const restored = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(restored).toEqual(preExisting);
  });
});

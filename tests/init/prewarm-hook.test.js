/**
 * Tests for the Claude Code SessionStart prewarm hook install/remove logic.
 *
 * Covers the contract documented in scripts/init.js::registerPrewarmSessionStartHook
 * and scripts/uninstall.js::removePrewarmSessionStartHook:
 *   - merge is non-destructive (preserves other hooks, permissions, env)
 *   - idempotent re-install updates in place (does not duplicate)
 *   - filename-based marker detection (no shell-comment trick)
 *   - refuses to write machine-specific absolute paths
 *   - uninstall removes only sweet-search-owned entries
 *   - dry-run and not-found paths do not touch the file
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { registerPrewarmSessionStartHook, PREWARM_HOOK_FILENAME } from '../../scripts/init.js';
import { removePrewarmSessionStartHook } from '../../scripts/uninstall.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let projectRoot;
let packageRoot;     // Default: inside projectRoot (realistic npm install).
let externalRoot;    // For tests exercising the "outside projectRoot" refusal.
let settingsPath;

function writeSettings(obj) {
  mkdirSync(join(projectRoot, '.claude'), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(obj, null, 2), 'utf-8');
}

function readSettings() {
  return JSON.parse(readFileSync(settingsPath, 'utf-8'));
}

function seedHookScript(pkgRoot) {
  const hookDir = join(pkgRoot, 'core', 'search');
  mkdirSync(hookDir, { recursive: true });
  writeFileSync(join(hookDir, PREWARM_HOOK_FILENAME), '// test fixture', 'utf-8');
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'ss-preheat-proj-'));
  // Realistic install: package lives at projectRoot/node_modules/sweet-search
  packageRoot = join(projectRoot, 'node_modules', 'sweet-search');
  seedHookScript(packageRoot);
  externalRoot = mkdtempSync(join(tmpdir(), 'ss-preheat-ext-'));
  seedHookScript(externalRoot);
  settingsPath = join(projectRoot, '.claude', 'settings.json');
});

afterEach(() => {
  for (const d of [projectRoot, externalRoot]) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// registerPrewarmSessionStartHook
// ---------------------------------------------------------------------------

describe('registerPrewarmSessionStartHook', () => {
  it('creates settings.json with a SessionStart entry when none exists', () => {
    const result = registerPrewarmSessionStartHook({ projectRoot, packageRoot });

    expect(result.status).toBe('registered');
    expect(result.detail).toContain('added');

    const s = readSettings();
    expect(s.hooks.SessionStart).toHaveLength(1);
    expect(s.hooks.SessionStart[0].matcher).toBe('startup|resume|clear|compact');
    const cmd = s.hooks.SessionStart[0].hooks[0].command;
    expect(cmd).toContain(PREWARM_HOOK_FILENAME);
    expect(cmd).toContain('--agent-session-hook');
    // Filename alone is the marker — no shell-comment trick.
    expect(cmd).not.toContain('#');
    expect(cmd.startsWith('node ')).toBe(true);
    expect(s.hooks.SessionEnd).toHaveLength(1);
    expect(s.hooks.SessionEnd[0].hooks[0].command).toContain('--agent-session-drop');
  });

  it('is idempotent: re-running updates in place, never duplicates', () => {
    registerPrewarmSessionStartHook({ projectRoot, packageRoot });
    registerPrewarmSessionStartHook({ projectRoot, packageRoot });
    const result = registerPrewarmSessionStartHook({ projectRoot, packageRoot });

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

    registerPrewarmSessionStartHook({ projectRoot, packageRoot });

    const s = readSettings();
    expect(s.hooks.SessionStart).toHaveLength(2);
    expect(s.hooks.SessionStart[0].hooks[0].command).toContain('agentic-qe');
    expect(s.hooks.SessionStart[1].hooks[0].command).toContain(PREWARM_HOOK_FILENAME);
  });

  it('preserves other top-level keys (permissions, env, PreToolUse)', () => {
    writeSettings({
      hooks: {
        PreToolUse: [{ matcher: '^Write$', hooks: [{ type: 'command', command: 'echo pre' }] }],
      },
      permissions: { allow: ['Bash(npx foo:*)'] },
      env: { FOO: 'bar' },
    });

    registerPrewarmSessionStartHook({ projectRoot, packageRoot });

    const s = readSettings();
    expect(s.hooks.PreToolUse).toHaveLength(1);
    expect(s.hooks.PreToolUse[0].hooks[0].command).toBe('echo pre');
    expect(s.permissions.allow).toEqual(['Bash(npx foo:*)']);
    expect(s.env.FOO).toBe('bar');
    expect(s.hooks.SessionStart).toHaveLength(1);
  });

  it('short-circuits when skipped=true and does not touch settings.json', () => {
    const result = registerPrewarmSessionStartHook({ projectRoot, packageRoot, skipped: true });

    expect(result.status).toBe('skipped');
    expect(existsSync(settingsPath)).toBe(false);
  });

  it('returns error when existing settings.json is not valid JSON', () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(settingsPath, '{ this is not json', 'utf-8');

    const result = registerPrewarmSessionStartHook({ projectRoot, packageRoot });

    expect(result.status).toBe('error');
    expect(result.detail).toContain('JSON');
  });

  it('returns error when hook script is missing from packageRoot', () => {
    rmSync(join(packageRoot, 'core', 'search', PREWARM_HOOK_FILENAME));

    const result = registerPrewarmSessionStartHook({ projectRoot, packageRoot });

    expect(result.status).toBe('error');
    expect(result.detail).toContain('missing');
  });

  it('refuses to write absolute path when package lives outside projectRoot', () => {
    // externalRoot is a separate tmpdir — simulates hoisted pnpm /
    // npm-linked / globally-installed sweet-search, which used to
    // leak an absolute path into the committed settings.json.
    const result = registerPrewarmSessionStartHook({ projectRoot, packageRoot: externalRoot });

    expect(result.status).toBe('skipped');
    expect(result.detail).toMatch(/outside projectRoot|hoisted|linked/i);
    expect(existsSync(settingsPath)).toBe(false);
  });

  it('writes a relative node_modules/ path in a realistic install layout', () => {
    const result = registerPrewarmSessionStartHook({ projectRoot, packageRoot });

    expect(result.status).toBe('registered');
    expect(result.hookPath.startsWith('node_modules/')).toBe(true);
    expect(result.hookPath).not.toMatch(/^\//);
    expect(result.hookPath).not.toContain('..');
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

  it('returns not-found when no entry matches the marker filename', () => {
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
          { hooks: [{ type: 'command', command: `node core/search/${PREWARM_HOOK_FILENAME}` }] },
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
    expect(cmds.some((c) => c.includes(PREWARM_HOOK_FILENAME))).toBe(false);
    // Sibling sections untouched.
    expect(s.hooks.PreToolUse).toHaveLength(1);
    expect(s.permissions.allow).toEqual(['Bash(npx foo:*)']);
  });

  it('removes the paired SessionEnd receipt cleanup hook', () => {
    registerPrewarmSessionStartHook({ projectRoot, packageRoot });
    const before = readSettings();
    expect(before.hooks.SessionEnd).toHaveLength(1);

    removePrewarmSessionStartHook(projectRoot);

    const after = readSettings();
    expect(after.hooks?.SessionStart).toBeUndefined();
    expect(after.hooks?.SessionEnd).toBeUndefined();
  });

  it('cleans up empty SessionStart array when sweet-search was the sole entry', () => {
    writeSettings({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `node ${PREWARM_HOOK_FILENAME}` }] }] },
    });

    removePrewarmSessionStartHook(projectRoot);

    const s = readSettings();
    // SessionStart key deleted when empty, hooks obj deleted when empty.
    expect(s.hooks?.SessionStart).toBeUndefined();
  });

  it('dry-run reports the entry exists but does not write', () => {
    writeSettings({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `node ${PREWARM_HOOK_FILENAME}` }] }] },
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

    registerPrewarmSessionStartHook({ projectRoot, packageRoot });
    // After register, settings differs.
    expect(readFileSync(settingsPath, 'utf-8')).not.toBe(original);

    removePrewarmSessionStartHook(projectRoot);
    // After remove, the file's structural content should match the original.
    const restored = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(restored).toEqual(preExisting);
  });
});

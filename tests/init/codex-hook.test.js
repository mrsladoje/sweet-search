/**
 * Tests for the `init --codex` wiring: the Codex CLI SessionStart hook
 * (.codex/hooks.json), the `codex_hooks` feature-flag editor for config.toml,
 * and the uninstall counterpart.
 *
 * Mirrors tests/init/prewarm-hook.test.js (the Claude prewarm equivalent):
 *   - merge is non-destructive (preserves other events/entries)
 *   - idempotent re-install updates in place (no duplicate)
 *   - filename-based marker detection (the shared launcher filename)
 *   - refuses to write a machine-specific absolute path
 *   - feature-flag editor is comment-preserving + append-if-absent
 *   - uninstall removes only the sweet-search-owned entry
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  registerCodexSessionStartHook,
  ensureCodexHooksFeatureFlag,
  CODEX_HOOKS_FILENAME,
  PREWARM_HOOK_FILENAME,
} from '../../scripts/init.js';
import { removeCodexSessionStartHook } from '../../scripts/uninstall.js';

let projectRoot;
let packageRoot;
let externalRoot;
let hooksPath;

function readHooks() {
  return JSON.parse(readFileSync(hooksPath, 'utf-8'));
}

function seedHookScript(pkgRoot) {
  const hookDir = join(pkgRoot, 'core', 'search');
  mkdirSync(hookDir, { recursive: true });
  writeFileSync(join(hookDir, PREWARM_HOOK_FILENAME), '// test fixture', 'utf-8');
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'ss-codex-proj-'));
  packageRoot = join(projectRoot, 'node_modules', 'sweet-search');
  seedHookScript(packageRoot);
  externalRoot = mkdtempSync(join(tmpdir(), 'ss-codex-ext-'));
  seedHookScript(externalRoot);
  hooksPath = join(projectRoot, '.codex', CODEX_HOOKS_FILENAME);
});

afterEach(() => {
  for (const d of [projectRoot, externalRoot]) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// registerCodexSessionStartHook
// ---------------------------------------------------------------------------

describe('registerCodexSessionStartHook', () => {
  it('creates .codex/hooks.json with a SessionStart entry when none exists', () => {
    const result = registerCodexSessionStartHook({ projectRoot, packageRoot });

    expect(result.status).toBe('registered');
    expect(result.detail).toContain('added');

    const doc = readHooks();
    expect(doc.hooks.SessionStart).toHaveLength(1);
    const group = doc.hooks.SessionStart[0];
    // Matcher mirrors the official Codex SessionStart example (start/resume).
    expect(group.matcher).toBe('startup|resume');
    const handler = group.hooks[0];
    expect(handler.type).toBe('command');
    expect(handler.command).toContain(PREWARM_HOOK_FILENAME);
    expect(typeof handler.timeout).toBe('number');
    // Resolves from the git root (not a bare relative path) per the Codex
    // docs, and invokes node.
    expect(handler.command).toContain('git rev-parse --show-toplevel');
    expect(handler.command).toContain('node ');
    // No shell-comment marker trick.
    expect(handler.command).not.toContain('#');
  });

  it('is idempotent: re-running updates in place, never duplicates', () => {
    registerCodexSessionStartHook({ projectRoot, packageRoot });
    registerCodexSessionStartHook({ projectRoot, packageRoot });
    const result = registerCodexSessionStartHook({ projectRoot, packageRoot });

    expect(result.status).toBe('registered');
    expect(result.detail).toContain('updated');
    expect(readHooks().hooks.SessionStart).toHaveLength(1);
  });

  it('preserves pre-existing SessionStart entries and other events from other tools', () => {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    writeFileSync(hooksPath, JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'echo other-session-start' }] },
        ],
        Stop: [
          { hooks: [{ type: 'command', command: 'echo done' }] },
        ],
      },
    }, null, 2), 'utf-8');

    registerCodexSessionStartHook({ projectRoot, packageRoot });

    const doc = readHooks();
    expect(doc.hooks.SessionStart).toHaveLength(2);
    expect(doc.hooks.SessionStart[0].hooks[0].command).toContain('other-session-start');
    expect(doc.hooks.SessionStart[1].hooks[0].command).toContain(PREWARM_HOOK_FILENAME);
    // Sibling event untouched.
    expect(doc.hooks.Stop).toHaveLength(1);
    expect(doc.hooks.Stop[0].hooks[0].command).toContain('done');
  });

  it('short-circuits when skipped=true and does not touch the file', () => {
    const result = registerCodexSessionStartHook({ projectRoot, packageRoot, skipped: true });
    expect(result.status).toBe('skipped');
    expect(existsSync(hooksPath)).toBe(false);
  });

  it('returns error when existing hooks.json is not valid JSON', () => {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    writeFileSync(hooksPath, '{ not json', 'utf-8');

    const result = registerCodexSessionStartHook({ projectRoot, packageRoot });
    expect(result.status).toBe('error');
    expect(result.detail).toContain('JSON');
  });

  it('returns error when the hook script is missing from packageRoot', () => {
    rmSync(join(packageRoot, 'core', 'search', PREWARM_HOOK_FILENAME));

    const result = registerCodexSessionStartHook({ projectRoot, packageRoot });
    expect(result.status).toBe('error');
    expect(result.detail).toContain('missing');
  });

  it('refuses to write an absolute path when the package lives outside projectRoot', () => {
    const result = registerCodexSessionStartHook({ projectRoot, packageRoot: externalRoot });
    expect(result.status).toBe('skipped');
    expect(result.detail).toMatch(/outside projectRoot|hoisted|linked/i);
    expect(existsSync(hooksPath)).toBe(false);
  });

  it('writes a relative node_modules/ path in a realistic install layout', () => {
    const result = registerCodexSessionStartHook({ projectRoot, packageRoot });
    expect(result.status).toBe('registered');
    expect(result.hookPath.startsWith('node_modules/')).toBe(true);
    expect(result.hookPath).not.toMatch(/^\//);
    expect(result.hookPath).not.toContain('..');
  });
});

// ---------------------------------------------------------------------------
// ensureCodexHooksFeatureFlag
// ---------------------------------------------------------------------------

describe('ensureCodexHooksFeatureFlag', () => {
  let configPath;

  beforeEach(() => {
    configPath = join(projectRoot, '.codex', 'config.toml');
  });

  it('creates config.toml with the [features] block when absent and create=true', () => {
    const result = ensureCodexHooksFeatureFlag(configPath, { create: true });
    expect(result.status).toBe('created');
    const text = readFileSync(configPath, 'utf-8');
    expect(text).toMatch(/\[features\]/);
    expect(text).toMatch(/codex_hooks\s*=\s*true/);
  });

  it('reports absent without writing when the file is missing and create=false', () => {
    const result = ensureCodexHooksFeatureFlag(configPath, { create: false });
    expect(result.status).toBe('absent');
    expect(existsSync(configPath)).toBe(false);
  });

  it('is a no-op when codex_hooks=true is already present', () => {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    const original = '# my config\n[features]\ncodex_hooks = true\n';
    writeFileSync(configPath, original, 'utf-8');

    const result = ensureCodexHooksFeatureFlag(configPath, { create: true });
    expect(result.status).toBe('already');
    expect(readFileSync(configPath, 'utf-8')).toBe(original);
  });

  it('treats the legacy `hooks = true` flag as already-enabled', () => {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    writeFileSync(configPath, '[features]\nhooks = true\n', 'utf-8');

    const result = ensureCodexHooksFeatureFlag(configPath, { create: true });
    expect(result.status).toBe('already');
  });

  it('leaves an explicit non-true value alone (no duplicate key)', () => {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    const original = '[features]\ncodex_hooks = false\n';
    writeFileSync(configPath, original, 'utf-8');

    const result = ensureCodexHooksFeatureFlag(configPath, { create: true });
    expect(result.status).toBe('present-other');
    expect(readFileSync(configPath, 'utf-8')).toBe(original);
  });

  it('inserts under an existing [features] table, preserving comments and other keys', () => {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    writeFileSync(configPath, '# top comment\n[features]\nweb_search = true # inline comment\n', 'utf-8');

    const result = ensureCodexHooksFeatureFlag(configPath, { create: true });
    expect(result.status).toBe('added');
    const text = readFileSync(configPath, 'utf-8');
    expect(text).toContain('# top comment');
    expect(text).toContain('web_search = true # inline comment');
    expect(text).toMatch(/\[features\]\s*\ncodex_hooks = true/);
  });

  it('appends a new [features] block when none exists, preserving prior content', () => {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    const original = '# header comment\nmodel = "gpt-5"\n\n[tui]\nnotifications = true\n';
    writeFileSync(configPath, original, 'utf-8');

    const result = ensureCodexHooksFeatureFlag(configPath, { create: true });
    expect(result.status).toBe('added');
    const text = readFileSync(configPath, 'utf-8');
    expect(text.startsWith(original)).toBe(true);          // prior content intact
    expect(text).toContain('# header comment');
    expect(text).toMatch(/\[features\]\ncodex_hooks = true/);
  });
});

// ---------------------------------------------------------------------------
// removeCodexSessionStartHook
// ---------------------------------------------------------------------------

describe('removeCodexSessionStartHook', () => {
  it('returns not-found when .codex/hooks.json does not exist', () => {
    expect(removeCodexSessionStartHook(projectRoot).status).toBe('not-found');
  });

  it('returns not-found when no entry matches the marker filename', () => {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    writeFileSync(hooksPath, JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo other' }] }] },
    }), 'utf-8');

    const result = removeCodexSessionStartHook(projectRoot);
    expect(result.status).toBe('not-found');
    expect(readHooks().hooks.SessionStart).toHaveLength(1);
  });

  it('removes only the sweet-search-owned entry, preserving the rest', () => {
    registerCodexSessionStartHook({ projectRoot, packageRoot });
    // Add a foreign entry alongside ours.
    const doc = readHooks();
    doc.hooks.SessionStart.unshift({ hooks: [{ type: 'command', command: 'echo other' }] });
    doc.hooks.Stop = [{ hooks: [{ type: 'command', command: 'echo done' }] }];
    writeFileSync(hooksPath, JSON.stringify(doc, null, 2), 'utf-8');

    const result = removeCodexSessionStartHook(projectRoot);
    expect(result.status).toBe('removed');

    const after = readHooks();
    expect(after.hooks.SessionStart).toHaveLength(1);
    expect(after.hooks.SessionStart[0].hooks[0].command).toContain('other');
    expect(after.hooks.Stop).toHaveLength(1); // sibling event untouched
  });

  it('deletes the file when our entry was the only content', () => {
    registerCodexSessionStartHook({ projectRoot, packageRoot });
    expect(existsSync(hooksPath)).toBe(true);

    const result = removeCodexSessionStartHook(projectRoot);
    expect(result.status).toBe('removed');
    expect(existsSync(hooksPath)).toBe(false);
  });

  it('dry-run reports the entry exists but does not write', () => {
    registerCodexSessionStartHook({ projectRoot, packageRoot });
    const before = readFileSync(hooksPath, 'utf-8');

    const result = removeCodexSessionStartHook(projectRoot, { dryRun: true });
    expect(result.status).toBe('dry-run');
    expect(readFileSync(hooksPath, 'utf-8')).toBe(before);
  });

  it('returns error when hooks.json is not valid JSON', () => {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    writeFileSync(hooksPath, 'not json at all', 'utf-8');

    expect(removeCodexSessionStartHook(projectRoot).status).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe('register + remove round-trip', () => {
  it('restores .codex/ to its pre-registration state (file deleted) when ours was the only entry', () => {
    registerCodexSessionStartHook({ projectRoot, packageRoot });
    removeCodexSessionStartHook(projectRoot);
    expect(existsSync(hooksPath)).toBe(false);
  });

  it('leaves foreign entries intact after a register+remove cycle', () => {
    mkdirSync(join(projectRoot, '.codex'), { recursive: true });
    const foreign = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo other' }] }] } };
    writeFileSync(hooksPath, JSON.stringify(foreign, null, 2), 'utf-8');

    registerCodexSessionStartHook({ projectRoot, packageRoot });
    removeCodexSessionStartHook(projectRoot);

    const after = readHooks();
    expect(after.hooks.SessionStart).toHaveLength(1);
    expect(after.hooks.SessionStart[0].hooks[0].command).toContain('other');
  });
});

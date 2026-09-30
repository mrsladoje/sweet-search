/**
 * Codex harness (scripts/install-codex-harness.js): what `sweet-search init --codex` writes into
 * the project `.codex/` layer, and what `sweet-search uninstall` takes back.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CODEX_CONFIG_REL, CODEX_INSTRUCTIONS_REL, CODEX_MANIFEST_REL, buildCodexConfigBlock,
  installCodexHarness, removeCodexHarness, removeCodexHooksFlagText, tomlRulesString,
} from '../../scripts/install-codex-harness.js';
import { codexInstructions } from '../../scripts/harness-prompts/index.js';
import { CANONICAL_POLICY_BODY, getMcpPolicyBody } from '../../scripts/inject-agent-instructions.js';

let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ss-codex-harness-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const read = rel => readFileSync(join(root, rel), 'utf8');
const write = (rel, text) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text); };
const manifest = () => JSON.parse(read(CODEX_MANIFEST_REL));
const RULES = CANONICAL_POLICY_BODY;

// Parse with a real TOML parser when one is available (python3 >= 3.11 tomllib).
const HAS_TOMLLIB = spawnSync('python3', ['-c', 'import tomllib'], { encoding: 'utf8' }).status === 0;
function parseToml(text) {
  const r = spawnSync('python3', ['-c', 'import sys, tomllib, json; print(json.dumps(tomllib.loads(sys.stdin.read())))'],
    { input: text, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`invalid TOML: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

describe('installCodexHarness', () => {
  it('writes the instructions file, the two top-level keys and the hooks flag; no AGENTS.md', () => {
    const r = installCodexHarness({ projectRoot: root, rules: RULES });
    expect(r.status).toBe('installed');
    expect(read(CODEX_INSTRUCTIONS_REL)).toBe(codexInstructions());
    const cfg = read(CODEX_CONFIG_REL);
    expect(cfg.startsWith('# >>> sweet-search')).toBe(true);
    expect(cfg).toContain('model_instructions_file = "sweet-search-instructions.md"');
    expect(cfg).toMatch(/^\[features\]\nhooks = true$/m);
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false);
    expect(manifest()).toMatchObject({ createdConfig: true, addedHooksFlag: true, addedFeaturesTable: true });
    if (HAS_TOMLLIB) {
      const parsed = parseToml(cfg);
      expect(parsed.developer_instructions).toBe(`${RULES.trimEnd()}\n`);
      expect(parsed.model_instructions_file).toBe('sweet-search-instructions.md');
      expect(parsed.features).toEqual({ hooks: true });
    }
  });

  it('is idempotent', () => {
    installCodexHarness({ projectRoot: root, rules: RULES });
    const before = [read(CODEX_CONFIG_REL), read(CODEX_INSTRUCTIONS_REL), read(CODEX_MANIFEST_REL)];
    expect(installCodexHarness({ projectRoot: root, rules: RULES }).status).toBe('unchanged');
    expect([read(CODEX_CONFIG_REL), read(CODEX_INSTRUCTIONS_REL), read(CODEX_MANIFEST_REL)]).toEqual(before);
  });

  it('keeps the user config: prepends the block, never records a flag the user had', () => {
    const user = '# mine\nmodel = "gpt-5.5"\n\n[features]\nhooks = true\n\n[mcp_servers.x]\ncommand = "x"\n';
    write(CODEX_CONFIG_REL, user);
    installCodexHarness({ projectRoot: root, rules: RULES });
    const cfg = read(CODEX_CONFIG_REL);
    expect(cfg.endsWith(user)).toBe(true);
    expect(manifest()).toMatchObject({ createdConfig: false, addedHooksFlag: false, addedFeaturesTable: false });
    if (HAS_TOMLLIB) expect(parseToml(cfg)).toMatchObject({ model: 'gpt-5.5', mcp_servers: { x: { command: 'x' } } });
    expect(removeCodexHarness({ projectRoot: root }).status).toBe('removed');
    expect(read(CODEX_CONFIG_REL)).toBe(user);
  });

  it('adds the hooks flag to an existing [features] table and removes only that line', () => {
    const user = 'model = "m"\n\n[features]\nweb_search = true\n';
    write(CODEX_CONFIG_REL, user);
    installCodexHarness({ projectRoot: root, rules: RULES });
    expect(manifest()).toMatchObject({ addedHooksFlag: true, addedFeaturesTable: false });
    removeCodexHarness({ projectRoot: root });
    expect(read(CODEX_CONFIG_REL)).toBe(user);
  });

  it('appends a [features] table to a config without one and removes it again', () => {
    const user = 'model = "m"\n';
    write(CODEX_CONFIG_REL, user);
    installCodexHarness({ projectRoot: root, rules: RULES });
    expect(manifest()).toMatchObject({ addedHooksFlag: true, addedFeaturesTable: true });
    removeCodexHarness({ projectRoot: root });
    expect(read(CODEX_CONFIG_REL)).toBe(user);
  });

  it('never duplicates a top-level key the user set', () => {
    write(CODEX_CONFIG_REL, 'developer_instructions = "mine"\n');
    const r = installCodexHarness({ projectRoot: root, rules: RULES });
    expect(r.warning).toMatch(/already sets developer_instructions/);
    const cfg = read(CODEX_CONFIG_REL);
    expect(cfg.match(/^developer_instructions/gm)).toHaveLength(1);
    expect(cfg).toContain('model_instructions_file');
    if (HAS_TOMLLIB) expect(parseToml(cfg).developer_instructions).toBe('mine');
  });

  it('--no-cli form: MCP rules only, Codex keeps its own base instructions', () => {
    installCodexHarness({ projectRoot: root, rules: RULES });
    const r = installCodexHarness({ projectRoot: root, rules: getMcpPolicyBody(), prompt: false });
    expect(r.status).toBe('installed');
    expect(existsSync(join(root, CODEX_INSTRUCTIONS_REL))).toBe(false);
    const cfg = read(CODEX_CONFIG_REL);
    expect(cfg).not.toContain('model_instructions_file');
    if (HAS_TOMLLIB) expect(parseToml(cfg).developer_instructions).toBe(`${getMcpPolicyBody().trimEnd()}\n`);
  });

  it('keeps a user-authored instructions file and does not point Codex at it', () => {
    write(CODEX_INSTRUCTIONS_REL, 'my own instructions\n');
    const r = installCodexHarness({ projectRoot: root, rules: RULES });
    expect(r.warning).toMatch(/user-authored/);
    expect(read(CODEX_INSTRUCTIONS_REL)).toBe('my own instructions\n');
    expect(read(CODEX_CONFIG_REL)).not.toContain('model_instructions_file');
  });
});

describe('removeCodexHarness', () => {
  it('removes everything init added and the .codex directory it created', () => {
    installCodexHarness({ projectRoot: root, rules: RULES });
    const r = removeCodexHarness({ projectRoot: root });
    expect(r.status).toBe('removed');
    expect(existsSync(join(root, '.codex'))).toBe(false);
    expect(removeCodexHarness({ projectRoot: root }).status).toBe('not-found');
  });

  it('keeps hand-edited content and reports it', () => {
    installCodexHarness({ projectRoot: root, rules: RULES });
    write(CODEX_INSTRUCTIONS_REL, `${read(CODEX_INSTRUCTIONS_REL)}\nmy addition\n`);
    write(CODEX_CONFIG_REL, read(CODEX_CONFIG_REL).replace('developer_instructions = ', '# note\ndeveloper_instructions = '));
    const r = removeCodexHarness({ projectRoot: root });
    expect(r.status).toBe('removed');
    expect(r.kept.join(' ')).toMatch(/sweet-search block/);
    expect(r.kept.join(' ')).toMatch(/sweet-search-instructions\.md/);
    expect(read(CODEX_INSTRUCTIONS_REL)).toContain('my addition');
    expect(read(CODEX_CONFIG_REL)).toContain('# note');
    // The hooks flag init added still goes.
    expect(read(CODEX_CONFIG_REL)).not.toMatch(/^hooks = true/m);
  });

  it('dry run changes nothing', () => {
    installCodexHarness({ projectRoot: root, rules: RULES });
    const before = read(CODEX_CONFIG_REL);
    expect(removeCodexHarness({ projectRoot: root, dryRun: true }).status).toBe('dry-run');
    expect(read(CODEX_CONFIG_REL)).toBe(before);
  });
});

describe('TOML helpers', () => {
  it('rules string round-trips through a TOML parser (literal and basic forms)', () => {
    for (const text of [`${RULES}\n`, "a '''quoted''' b\n", 'tab\there\n', "ends with '"]) {
      const block = `x = ${tomlRulesString(text)}\n`;
      if (HAS_TOMLLIB) expect(parseToml(block).x).toBe(text);
    }
    expect(tomlRulesString('plain\n')).toBe("'''\nplain\n'''");
  });

  it('the block holds only the requested keys', () => {
    expect(buildCodexConfigBlock({ instructionsFile: true })).not.toContain('developer_instructions');
    expect(buildCodexConfigBlock({ rules: 'r' })).not.toContain('model_instructions_file');
  });

  it('removeCodexHooksFlagText leaves other tables alone', () => {
    const text = 'a = 1\n\n[features]\nhooks = true\n\n[x]\ny = 2\n';
    expect(removeCodexHooksFlagText(text, { dropEmptyTable: true })).toBe('a = 1\n\n[x]\ny = 2\n');
    expect(removeCodexHooksFlagText('[features]\nhooks = false\n')).toBeNull();
  });
});

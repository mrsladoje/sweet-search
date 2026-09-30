/**
 * Codex harness (scripts/install-codex-harness.js): what `sweet-search init --codex` writes into
 * the project `.codex/` layer, and what `sweet-search uninstall` takes back.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CODEX_CONFIG_REL, CODEX_INSTRUCTIONS_REL, CODEX_MANIFEST_REL, buildCodexConfigBlock,
  ensureCodexHooksFeatureFlag, installCodexHarness, parseCodexProjectTrust, readCodexProjectTrust,
  removeCodexHarness, removeCodexHooksFlagText, tomlRulesString,
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

describe('[features] header with a trailing comment', () => {
  for (const header of ['[features] # mine', '[features]   ', '[ features ]  # spaced']) {
    it(`"${header}": adds the flag inside it, never a second [features] table`, () => {
      const user = `model = "m"\n\n${header}\nweb_search = true\n\n[x]\ny = 1\n`;
      write(CODEX_CONFIG_REL, user);
      installCodexHarness({ projectRoot: root, rules: RULES });
      const cfg = read(CODEX_CONFIG_REL);
      expect(cfg.match(/^\s*\[\s*features\s*\]/gm)).toHaveLength(1);
      expect(manifest()).toMatchObject({ addedHooksFlag: true, addedFeaturesTable: false });
      if (HAS_TOMLLIB) expect(parseToml(cfg)).toMatchObject({ features: { hooks: true, web_search: true }, x: { y: 1 } });
      removeCodexHarness({ projectRoot: root });
      expect(read(CODEX_CONFIG_REL)).toBe(user);
    });
  }

  it('ensureCodexHooksFeatureFlag: every branch reads a commented header', () => {
    const cases = [
      ['[features] # mine\nhooks = true\n', 'already'],
      ['[features] # mine\nhooks = false\n', 'present-other'],
      ['[features] # mine\ncodex_hooks = true\n', 'migrated'],
      ['[features] # mine\nhooks = true\ncodex_hooks = true\n', 'migrated'],
      ['[features] # mine\n', 'added'],
    ];
    for (const [text, status] of cases) {
      write(CODEX_CONFIG_REL, text);
      expect(ensureCodexHooksFeatureFlag(join(root, CODEX_CONFIG_REL)).status, text).toBe(status);
      const out = read(CODEX_CONFIG_REL);
      expect(out.match(/^\[features\]/gm), out).toHaveLength(1);
      if (HAS_TOMLLIB && status !== 'present-other') expect(parseToml(out).features).toEqual({ hooks: true });
    }
  });

  it('a hooks key in another table is not the flag', () => {
    write(CODEX_CONFIG_REL, '[other]\nhooks = true\n');
    expect(ensureCodexHooksFeatureFlag(join(root, CODEX_CONFIG_REL)).status).toBe('added');
    if (HAS_TOMLLIB) expect(parseToml(read(CODEX_CONFIG_REL))).toEqual({ other: { hooks: true }, features: { hooks: true } });
  });

  it('a features table defined with dotted keys is left alone (no second definition)', () => {
    write(CODEX_CONFIG_REL, 'features.web_search = true\n');
    expect(ensureCodexHooksFeatureFlag(join(root, CODEX_CONFIG_REL)).status).toBe('present-other');
    expect(read(CODEX_CONFIG_REL)).toBe('features.web_search = true\n');
  });
});

describe('hooks flag only with a hook', () => {
  it('hooksFlag false adds no [features] table', () => {
    installCodexHarness({ projectRoot: root, rules: RULES, hooksFlag: false });
    expect(read(CODEX_CONFIG_REL)).not.toContain('[features]');
    expect(manifest()).toMatchObject({ addedHooksFlag: false, addedFeaturesTable: false });
  });

  it('hooksFlag false takes back a flag an earlier install added', () => {
    installCodexHarness({ projectRoot: root, rules: RULES });
    const r = installCodexHarness({ projectRoot: root, rules: RULES, hooksFlag: false });
    expect(r.detail).toMatch(/hooks flag removed/);
    expect(read(CODEX_CONFIG_REL)).not.toContain('[features]');
    removeCodexHarness({ projectRoot: root });
    expect(existsSync(join(root, '.codex'))).toBe(false);
  });
});

describe('upgrade from an init older than the manifest', () => {
  for (const legacy of ['[features]\nhooks = true\n', '[features]\ncodex_hooks = true\n']) {
    it(`adopts a config.toml that is exactly ${JSON.stringify(legacy)}`, () => {
      write(CODEX_CONFIG_REL, legacy);
      installCodexHarness({ projectRoot: root, rules: RULES });
      expect(manifest()).toMatchObject({ createdConfig: true, addedHooksFlag: true, addedFeaturesTable: true });
      removeCodexHarness({ projectRoot: root });
      expect(existsSync(join(root, '.codex'))).toBe(false);
    });
  }

  it('does not adopt a config.toml with anything else in it', () => {
    const user = '[features]\nhooks = true\nweb_search = true\n';
    write(CODEX_CONFIG_REL, user);
    installCodexHarness({ projectRoot: root, rules: RULES });
    expect(manifest()).toMatchObject({ createdConfig: false, addedHooksFlag: false });
    removeCodexHarness({ projectRoot: root });
    expect(read(CODEX_CONFIG_REL)).toBe(user);
  });
});

describe('Codex project trust (read only)', () => {
  let codexHome;
  beforeEach(() => { codexHome = mkdtempSync(join(tmpdir(), 'ss-codex-home-')); });
  afterEach(() => { rmSync(codexHome, { recursive: true, force: true }); });
  const trust = (toml) => {
    writeFileSync(join(codexHome, 'config.toml'), toml);
    return readCodexProjectTrust({ projectRoot: root, env: { CODEX_HOME: codexHome } });
  };

  it('no config or no entry = untrusted', () => {
    expect(readCodexProjectTrust({ projectRoot: root, env: { CODEX_HOME: codexHome } })).toMatchObject({ trusted: false, level: null });
    expect(trust('model = "m"\n').trusted).toBe(false);
  });

  it('matches the key after resolving symlinks and dropping a trailing slash', () => {
    const real = realpathSync(root);
    expect(trust(`[projects.${JSON.stringify(`${real}/`)}]\ntrust_level = "trusted"\n`).trusted).toBe(true);
    expect(trust(`[projects.${JSON.stringify(`${root}//`)}] # note\ntrust_level = "trusted"\n`).trusted).toBe(true);
    const link = join(codexHome, 'link');
    symlinkSync(root, link);
    expect(trust(`[projects.${JSON.stringify(link)}]\ntrust_level = "trusted"\n`).trusted).toBe(true);
  });

  it('literal-string keys and the inline [projects] form', () => {
    expect(trust(`[projects.'${realpathSync(root)}']\ntrust_level = 'trusted'\n`).trusted).toBe(true);
    expect(trust(`[projects]\n${JSON.stringify(realpathSync(root))} = { trust_level = "trusted" }\n`).trusted).toBe(true);
  });

  it('an explicit untrusted level and a trust_level in another table do not count', () => {
    expect(trust(`[projects.${JSON.stringify(root)}]\ntrust_level = "untrusted"\n`)).toMatchObject({ trusted: false, level: 'untrusted' });
    expect(trust(`[other]\ntrust_level = "trusted"\n`).trusted).toBe(false);
  });

  it('parseCodexProjectTrust reads every entry', () => {
    const m = parseCodexProjectTrust('[projects."/a/b"]\ntrust_level = "trusted"\n[projects."/c"]\nx = 1\ntrust_level = "untrusted"\n');
    expect(m.get('/a/b')).toBe('trusted');
    expect(m.get('/c')).toBe('untrusted');
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

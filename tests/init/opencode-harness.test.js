/**
 * opencode harness (scripts/install-opencode-harness.js): what `sweet-search init --opencode`
 * writes into the project `.opencode/` layer, and what `sweet-search uninstall` takes back.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  OPENCODE_CONFIG_REL, OPENCODE_MANIFEST_REL, OPENCODE_PLUGIN_REL, OPENCODE_PLUGIN_SPEC, OPENCODE_PROMPT_REF,
  OPENCODE_PROMPT_REL, OPENCODE_RULES_ENTRY, OPENCODE_RULES_REL, installOpencodeHarness, removeOpencodeHarness,
} from '../../scripts/install-opencode-harness.js';
import { OPENCODE_TOOL_EDITS, OPENCODE_TRIM_PLUGIN_SOURCE, opencodePrompt } from '../../scripts/harness-prompts/index.js';
import { CANONICAL_POLICY_BODY, getMcpPolicyBody } from '../../scripts/inject-agent-instructions.js';

let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ss-opencode-harness-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const read = rel => readFileSync(join(root, rel), 'utf8');
const write = (rel, text) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text); };
const config = () => JSON.parse(read(OPENCODE_CONFIG_REL));
const RULES = CANONICAL_POLICY_BODY;

describe('installOpencodeHarness', () => {
  it('writes the rules, prompt and plugin files and the config that references them', () => {
    const r = installOpencodeHarness({ projectRoot: root, rules: RULES });
    expect(r.status).toBe('installed');
    expect(read(OPENCODE_RULES_REL)).toBe(`${RULES.trimEnd()}\n`);
    expect(read(OPENCODE_PROMPT_REL)).toBe(opencodePrompt());
    expect(read(OPENCODE_PLUGIN_REL)).toBe(readFileSync(OPENCODE_TRIM_PLUGIN_SOURCE, 'utf8'));
    expect(config()).toEqual({
      $schema: 'https://opencode.ai/config.json',
      instructions: [OPENCODE_RULES_ENTRY],
      plugin: [[OPENCODE_PLUGIN_SPEC, { edits: JSON.parse(JSON.stringify(OPENCODE_TOOL_EDITS)) }]],
      tools: { grep: false },
      agent: {
        build: { prompt: OPENCODE_PROMPT_REF },
        general: { prompt: OPENCODE_PROMPT_REF },
        explore: { disable: true },
      },
    });
    // No AGENTS.md and no root opencode.json.
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(root, 'opencode.json'))).toBe(false);
  });

  it('the prompt reference re-adds the one trailing newline opencode trims from {file:}', () => {
    // opencode trims a {file:} file; the stock prompt it replaces ends with exactly one newline.
    expect(opencodePrompt().endsWith('.\n') && !opencodePrompt().endsWith('\n\n')).toBe(true);
    expect(OPENCODE_PROMPT_REF).toBe('{file:./sweet-search-prompt.txt}\n');
  });

  it('is idempotent', () => {
    installOpencodeHarness({ projectRoot: root, rules: RULES });
    const before = [OPENCODE_CONFIG_REL, OPENCODE_MANIFEST_REL, OPENCODE_PROMPT_REL].map(read);
    expect(installOpencodeHarness({ projectRoot: root, rules: RULES }).status).toBe('unchanged');
    expect([OPENCODE_CONFIG_REL, OPENCODE_MANIFEST_REL, OPENCODE_PROMPT_REL].map(read)).toEqual(before);
  });

  it('merges into a user config and keeps settings the user made', () => {
    const user = {
      model: 'x/y', instructions: ['docs/rules.md'], plugin: ['my-plugin'],
      agent: { build: { prompt: 'my prompt', temperature: 0.1 } }, tools: { grep: true },
    };
    write(OPENCODE_CONFIG_REL, JSON.stringify(user, null, 2));
    const r = installOpencodeHarness({ projectRoot: root, rules: RULES });
    expect(r.warning).toMatch(/agent\.build\.prompt/);
    expect(r.warning).toMatch(/tools\.grep/);
    const cfg = config();
    expect(cfg.model).toBe('x/y');
    expect(cfg.instructions).toEqual(['docs/rules.md', OPENCODE_RULES_ENTRY]);
    expect(cfg.plugin[0]).toBe('my-plugin');
    expect(cfg.agent.build).toEqual({ prompt: 'my prompt', temperature: 0.1 });
    expect(cfg.tools.grep).toBe(true);
    expect(cfg.$schema).toBeUndefined();
    // Uninstall restores the user's config exactly.
    expect(removeOpencodeHarness({ projectRoot: root }).status).toBe('removed');
    expect(config()).toEqual(user);
    expect(existsSync(join(root, OPENCODE_RULES_REL))).toBe(false);
  });

  it('--no-cli form: MCP rules only, opencode keeps its own prompt and tools', () => {
    installOpencodeHarness({ projectRoot: root, rules: RULES });
    installOpencodeHarness({ projectRoot: root, rules: getMcpPolicyBody(), prompt: false });
    expect(read(OPENCODE_RULES_REL)).toBe(`${getMcpPolicyBody().trimEnd()}\n`);
    expect(existsSync(join(root, OPENCODE_PROMPT_REL))).toBe(false);
    expect(existsSync(join(root, OPENCODE_PLUGIN_REL))).toBe(false);
    expect(config()).toEqual({ $schema: 'https://opencode.ai/config.json', instructions: [OPENCODE_RULES_ENTRY] });
  });

  it('refuses to touch an invalid opencode.json', () => {
    write(OPENCODE_CONFIG_REL, '{ // comment\n}');
    expect(installOpencodeHarness({ projectRoot: root, rules: RULES }).status).toBe('error');
    expect(read(OPENCODE_CONFIG_REL)).toBe('{ // comment\n}');
  });
});

describe('removeOpencodeHarness', () => {
  it('removes everything, including the .opencode dir init created and opencode\'s own install files', () => {
    installOpencodeHarness({ projectRoot: root, rules: RULES });
    // What opencode writes into a config dir that lists a plugin.
    write('.opencode/.gitignore', 'node_modules\npackage.json\npackage-lock.json\nbun.lock\n.gitignore');
    write('.opencode/package.json', JSON.stringify({ dependencies: { '@opencode-ai/plugin': '1.18.4' } }));
    write('.opencode/node_modules/x/index.js', '');
    expect(removeOpencodeHarness({ projectRoot: root }).status).toBe('removed');
    expect(existsSync(join(root, '.opencode'))).toBe(false);
    expect(removeOpencodeHarness({ projectRoot: root }).status).toBe('not-found');
  });

  it('keeps a .opencode dir that holds user content, and hand-edited files', () => {
    write('.opencode/agent/mine.md', 'my agent');
    installOpencodeHarness({ projectRoot: root, rules: RULES });
    write(OPENCODE_RULES_REL, 'my edit\n');
    const r = removeOpencodeHarness({ projectRoot: root });
    expect(r.kept.join(' ')).toMatch(/sweet-search\.md/);
    expect(read('.opencode/agent/mine.md')).toBe('my agent');
    expect(read(OPENCODE_RULES_REL)).toBe('my edit\n');
    expect(existsSync(join(root, OPENCODE_CONFIG_REL))).toBe(false);
    expect(existsSync(join(root, OPENCODE_PROMPT_REL))).toBe(false);
    expect(existsSync(join(root, OPENCODE_PLUGIN_REL))).toBe(false);
  });

  it('keeps a user-created opencode.json even when it ends up empty', () => {
    write(OPENCODE_CONFIG_REL, '{}');
    installOpencodeHarness({ projectRoot: root, rules: RULES });
    removeOpencodeHarness({ projectRoot: root });
    expect(config()).toEqual({});
  });
});

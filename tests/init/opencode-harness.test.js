/**
 * opencode harness (scripts/install-opencode-harness.js): what `sweet-search init --opencode`
 * writes into the project `.opencode/` layer, and what `sweet-search uninstall` takes back.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  OPENCODE_CACHE_PLUGIN_REL, OPENCODE_CACHE_PLUGIN_SPEC,
  OPENCODE_CONFIG_JSONC_REL, OPENCODE_CONFIG_REL, OPENCODE_MANIFEST_REL, OPENCODE_PLUGIN_REL, OPENCODE_PLUGIN_SPEC, OPENCODE_PROMPT_REF,
  OPENCODE_PROMPT_REL, OPENCODE_RULES_ENTRY, OPENCODE_RULES_REL, installOpencodeHarness, opencodeCacheKeyOffByEnv,
  removeOpencodeHarness,
} from '../../scripts/install-opencode-harness.js';
import {
  OPENCODE_CACHE_KEY_PLUGIN_SOURCE, OPENCODE_TOOL_EDITS, OPENCODE_TRIM_PLUGIN_SOURCE, opencodePrompt,
} from '../../scripts/harness-prompts/index.js';
import { CANONICAL_POLICY_BODY, getMcpPolicyBody } from '../../scripts/inject-agent-instructions.js';

let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ss-opencode-harness-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const read = rel => readFileSync(join(root, rel), 'utf8');
const write = (rel, text) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text); };
const config = () => JSON.parse(read(OPENCODE_CONFIG_REL));
const RULES = CANONICAL_POLICY_BODY;
const TRIM_ENTRY = [OPENCODE_PLUGIN_SPEC, { edits: JSON.parse(JSON.stringify(OPENCODE_TOOL_EDITS)) }];

describe('installOpencodeHarness', () => {
  it('writes the rules, prompt and plugin files and the config that references them', () => {
    const r = installOpencodeHarness({ projectRoot: root, rules: RULES });
    expect(r.status).toBe('installed');
    expect(read(OPENCODE_RULES_REL)).toBe(`${RULES.trimEnd()}\n`);
    expect(read(OPENCODE_PROMPT_REL)).toBe(opencodePrompt());
    expect(read(OPENCODE_PLUGIN_REL)).toBe(readFileSync(OPENCODE_TRIM_PLUGIN_SOURCE, 'utf8'));
    expect(read(OPENCODE_CACHE_PLUGIN_REL)).toBe(readFileSync(OPENCODE_CACHE_KEY_PLUGIN_SOURCE, 'utf8'));
    expect(config()).toEqual({
      $schema: 'https://opencode.ai/config.json',
      instructions: [OPENCODE_RULES_ENTRY],
      // The tool-description plugin stays first (the task bench reads plugin[0]).
      plugin: [TRIM_ENTRY, OPENCODE_CACHE_PLUGIN_SPEC],
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
    const files = [OPENCODE_CONFIG_REL, OPENCODE_MANIFEST_REL, OPENCODE_PROMPT_REL, OPENCODE_CACHE_PLUGIN_REL];
    const before = files.map(read);
    expect(installOpencodeHarness({ projectRoot: root, rules: RULES }).status).toBe('unchanged');
    expect(files.map(read)).toEqual(before);
  });

  it('merges into a user config and keeps settings the user made', () => {
    const user = {
      model: 'x/y', instructions: ['docs/rules.md'], plugin: ['my-plugin'],
      agent: { build: { prompt: 'my prompt', temperature: 0.1 } }, tools: { grep: true },
    };
    const userText = JSON.stringify(user, null, 2);
    write(OPENCODE_CONFIG_REL, userText);
    const r = installOpencodeHarness({ projectRoot: root, rules: RULES });
    expect(r.warning).toMatch(/agent\.build\.prompt/);
    expect(r.warning).toMatch(/tools\.grep/);
    const cfg = config();
    expect(cfg.model).toBe('x/y');
    expect(cfg.instructions).toEqual(['docs/rules.md', OPENCODE_RULES_ENTRY]);
    expect(cfg.plugin).toEqual(['my-plugin', TRIM_ENTRY, OPENCODE_CACHE_PLUGIN_SPEC]);
    expect(cfg.agent.build).toEqual({ prompt: 'my prompt', temperature: 0.1 });
    expect(cfg.tools.grep).toBe(true);
    expect(cfg.$schema).toBeUndefined();
    // Uninstall restores the user's config exactly.
    expect(removeOpencodeHarness({ projectRoot: root }).status).toBe('removed');
    expect(read(OPENCODE_CONFIG_REL)).toBe(userText);
    expect(existsSync(join(root, OPENCODE_RULES_REL))).toBe(false);
  });

  it('--no-cli form: MCP rules only, opencode keeps its own prompt and tools; the cache-key plugin stays', () => {
    installOpencodeHarness({ projectRoot: root, rules: RULES });
    installOpencodeHarness({ projectRoot: root, rules: getMcpPolicyBody(), prompt: false });
    expect(read(OPENCODE_RULES_REL)).toBe(`${getMcpPolicyBody().trimEnd()}\n`);
    expect(existsSync(join(root, OPENCODE_PROMPT_REL))).toBe(false);
    expect(existsSync(join(root, OPENCODE_PLUGIN_REL))).toBe(false);
    expect(existsSync(join(root, OPENCODE_CACHE_PLUGIN_REL))).toBe(true);
    expect(config()).toEqual({
      $schema: 'https://opencode.ai/config.json', instructions: [OPENCODE_RULES_ENTRY], plugin: [OPENCODE_CACHE_PLUGIN_SPEC],
    });
  });

  it('cacheKey: false installs no cache-key plugin, removes one an earlier init installed, and sticks', () => {
    installOpencodeHarness({ projectRoot: root, rules: RULES, cacheKey: false });
    expect(existsSync(join(root, OPENCODE_CACHE_PLUGIN_REL))).toBe(false);
    expect(config().plugin).toEqual([TRIM_ENTRY]);
    expect(JSON.parse(read(OPENCODE_MANIFEST_REL)).cacheKeyOff).toBe(true);

    // A later plain init (cacheKey not given) keeps the opt-out.
    expect(installOpencodeHarness({ projectRoot: root, rules: RULES }).status).toBe('unchanged');
    expect(existsSync(join(root, OPENCODE_CACHE_PLUGIN_REL))).toBe(false);

    // cacheKey: true (init --opencode-cache-key) undoes it, and plain inits keep the plugin after that.
    expect(installOpencodeHarness({ projectRoot: root, rules: RULES, cacheKey: true }).status).toBe('installed');
    expect(config().plugin).toEqual([TRIM_ENTRY, OPENCODE_CACHE_PLUGIN_SPEC]);
    let manifest = JSON.parse(read(OPENCODE_MANIFEST_REL));
    expect(manifest.added.cacheKeyPlugin).toBe(true);
    expect(manifest.cacheKeyOff).toBeUndefined();
    expect(installOpencodeHarness({ projectRoot: root, rules: RULES }).status).toBe('unchanged');

    const r = installOpencodeHarness({ projectRoot: root, rules: RULES, cacheKey: false });
    expect(r.status).toBe('installed');
    expect(existsSync(join(root, OPENCODE_CACHE_PLUGIN_REL))).toBe(false);
    expect(config().plugin).toEqual([TRIM_ENTRY]);
    manifest = JSON.parse(read(OPENCODE_MANIFEST_REL));
    expect(manifest.added.cacheKeyPlugin).toBeUndefined();
    expect(manifest.files[OPENCODE_CACHE_PLUGIN_REL]).toBeUndefined();
    expect(installOpencodeHarness({ projectRoot: root, rules: RULES, cacheKey: false }).status).toBe('unchanged');
  });

  it('an older install without the cache-key plugin gains it on re-init; the report names it in plain words', () => {
    installOpencodeHarness({ projectRoot: root, rules: RULES });
    // What an init before the cache-key plugin left: no file, no entry, nothing in the manifest.
    rmSync(join(root, OPENCODE_CACHE_PLUGIN_REL));
    const cfg = config();
    cfg.plugin = cfg.plugin.filter(e => e !== OPENCODE_CACHE_PLUGIN_SPEC);
    write(OPENCODE_CONFIG_REL, JSON.stringify(cfg, null, 2) + '\n');
    const manifest = JSON.parse(read(OPENCODE_MANIFEST_REL));
    delete manifest.files[OPENCODE_CACHE_PLUGIN_REL];
    delete manifest.added.cacheKeyPlugin;
    write(OPENCODE_MANIFEST_REL, JSON.stringify(manifest, null, 2) + '\n');

    const r = installOpencodeHarness({ projectRoot: root, rules: RULES });
    expect(r.status).toBe('installed');
    expect(r.detail).toContain(OPENCODE_CACHE_PLUGIN_REL);
    expect(r.detail).toContain('plugin (OpenAI cache key)');
    expect(r.detail).not.toContain('cacheKeyPlugin');
    expect(read(OPENCODE_CACHE_PLUGIN_REL)).toBe(readFileSync(OPENCODE_CACHE_KEY_PLUGIN_SOURCE, 'utf8'));
    expect(config().plugin).toEqual([TRIM_ENTRY, OPENCODE_CACHE_PLUGIN_SPEC]);
    const dry = removeOpencodeHarness({ projectRoot: root, dryRun: true });
    expect(dry.detail).toContain('plugin (OpenAI cache key)');
    expect(dry.detail).not.toContain('cacheKeyPlugin');
  });

  it('refreshing stale tool edits keeps the tool-description plugin where it stands (first)', () => {
    write(OPENCODE_CONFIG_REL, JSON.stringify({ plugin: ['my-plugin'] }));
    installOpencodeHarness({ projectRoot: root, rules: RULES });
    const cfg = config();
    cfg.plugin = cfg.plugin.map(e => (Array.isArray(e) && e[0] === OPENCODE_PLUGIN_SPEC ? [OPENCODE_PLUGIN_SPEC, { edits: { old: 1 } }] : e));
    write(OPENCODE_CONFIG_REL, JSON.stringify(cfg, null, 2) + '\n');
    expect(installOpencodeHarness({ projectRoot: root, rules: RULES }).status).toBe('installed');
    expect(config().plugin).toEqual(['my-plugin', TRIM_ENTRY, OPENCODE_CACHE_PLUGIN_SPEC]);
  });

  it('keeps a shards option the user put on the cache-key entry, and uninstall removes the entry', () => {
    installOpencodeHarness({ projectRoot: root, rules: RULES });
    const cfg = config();
    cfg.plugin = cfg.plugin.map(e => (e === OPENCODE_CACHE_PLUGIN_SPEC ? [OPENCODE_CACHE_PLUGIN_SPEC, { shards: 4 }] : e));
    write(OPENCODE_CONFIG_REL, JSON.stringify(cfg, null, 2) + '\n');
    expect(installOpencodeHarness({ projectRoot: root, rules: RULES }).status).toBe('unchanged');
    expect(config().plugin).toEqual([TRIM_ENTRY, [OPENCODE_CACHE_PLUGIN_SPEC, { shards: 4 }]]);
    expect(removeOpencodeHarness({ projectRoot: root }).status).toBe('removed');
    expect(existsSync(join(root, '.opencode'))).toBe(false);
  });

  it('a hand-edited cache-key plugin file is kept and not referenced', () => {
    installOpencodeHarness({ projectRoot: root, rules: RULES });
    write(OPENCODE_CACHE_PLUGIN_REL, '// mine\nexport default async () => ({});\n');
    const r = installOpencodeHarness({ projectRoot: root, rules: RULES });
    expect(r.warning).toMatch(/sweet-search-cache\.mjs is user-authored/);
    expect(read(OPENCODE_CACHE_PLUGIN_REL)).toBe('// mine\nexport default async () => ({});\n');
    expect(config().plugin).toEqual([TRIM_ENTRY]);
    removeOpencodeHarness({ projectRoot: root });
    expect(read(OPENCODE_CACHE_PLUGIN_REL)).toBe('// mine\nexport default async () => ({});\n');
  });

  it('a non-list "plugin" is left alone with one warning', () => {
    write(OPENCODE_CONFIG_REL, JSON.stringify({ plugin: 'x' }));
    const r = installOpencodeHarness({ projectRoot: root, rules: RULES });
    expect(r.warning.match(/"plugin" is not a list/g)).toHaveLength(1);
    expect(config().plugin).toBe('x');
  });

  it('opencodeCacheKeyOffByEnv: 0 / false / off / no switch it off; unset, empty and 1 do not', () => {
    for (const v of ['0', 'false', 'OFF', ' no ']) expect(opencodeCacheKeyOffByEnv({ SWEET_SEARCH_OC_CACHE_KEY: v })).toBe(true);
    for (const v of [undefined, '', '1', 'on']) expect(opencodeCacheKeyOffByEnv({ SWEET_SEARCH_OC_CACHE_KEY: v })).toBe(false);
  });

  it('refuses to touch an invalid opencode.json', () => {
    write(OPENCODE_CONFIG_REL, '{ "model": }');
    expect(installOpencodeHarness({ projectRoot: root, rules: RULES }).status).toBe('error');
    expect(read(OPENCODE_CONFIG_REL)).toBe('{ "model": }');
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
    expect(existsSync(join(root, OPENCODE_CACHE_PLUGIN_REL))).toBe(false);
  });

  it('keeps a user-created opencode.json even when it ends up empty', () => {
    write(OPENCODE_CONFIG_REL, '{}');
    installOpencodeHarness({ projectRoot: root, rules: RULES });
    removeOpencodeHarness({ projectRoot: root });
    expect(config()).toEqual({});
  });
});

// opencode reads its config as JSONC (comments, trailing commas); so does init. It edits only the
// keys it owns (jsonc-parser), so every comment and every line it does not touch survive install
// and uninstall; a list or object it adds to is re-laid-out one entry per line.
const parseJsonc = text => JSON.parse(text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').replace(/,(\s*[}\]])/g, '$1'));
const JSONC_USER = [
  '{',
  '  // my model',
  '  "model": "x/y",',
  '  /* my rules */',
  '  "instructions": ["docs/rules.md",],',
  '  "agent": {',
  '    "build": { "temperature": 0.1 }, // keep',
  '  },',
  '}',
  '',
].join('\n');

describe('JSONC opencode config', () => {
  it('opencode.json with comments and trailing commas: keys added, comments kept, bytes restored', () => {
    write(OPENCODE_CONFIG_REL, JSONC_USER);
    const r = installOpencodeHarness({ projectRoot: root, rules: RULES });
    expect(r.status).toBe('installed');
    const text = read(OPENCODE_CONFIG_REL);
    for (const c of ['// my model', '/* my rules */', '// keep']) expect(text).toContain(c);
    const cfg = parseJsonc(text);
    expect(cfg.model).toBe('x/y');
    expect(cfg.instructions).toEqual(['docs/rules.md', OPENCODE_RULES_ENTRY]);
    expect(cfg.agent.build).toEqual({ temperature: 0.1, prompt: OPENCODE_PROMPT_REF });
    expect(cfg.agent.explore).toEqual({ disable: true });
    expect(cfg.tools).toEqual({ grep: false });
    expect(cfg.plugin).toEqual([TRIM_ENTRY, OPENCODE_CACHE_PLUGIN_SPEC]);
    expect(installOpencodeHarness({ projectRoot: root, rules: RULES }).status).toBe('unchanged');
    removeOpencodeHarness({ projectRoot: root });
    const back = read(OPENCODE_CONFIG_REL);
    expect(parseJsonc(back)).toEqual(parseJsonc(JSONC_USER));
    for (const c of ['{\n  // my model\n  "model": "x/y",\n  /* my rules */\n', '}, // keep\n']) expect(back).toContain(c);
  });

  it('only .opencode/opencode.jsonc exists: edits it, creates no opencode.json, restores it', () => {
    write(OPENCODE_CONFIG_JSONC_REL, JSONC_USER);
    installOpencodeHarness({ projectRoot: root, rules: RULES });
    expect(existsSync(join(root, OPENCODE_CONFIG_REL))).toBe(false);
    expect(parseJsonc(read(OPENCODE_CONFIG_JSONC_REL)).agent.general).toEqual({ prompt: OPENCODE_PROMPT_REF });
    expect(JSON.parse(read(OPENCODE_MANIFEST_REL)).config).toBe(OPENCODE_CONFIG_JSONC_REL);
    removeOpencodeHarness({ projectRoot: root });
    const back = read(OPENCODE_CONFIG_JSONC_REL);
    expect(parseJsonc(back)).toEqual(parseJsonc(JSONC_USER));
    for (const c of ['// my model', '/* my rules */', '// keep']) expect(back).toContain(c);
  });

  it('keeps a tab-indented file tab-indented', () => {
    const user = '{\n\t"model": "x/y"\n}\n';
    write(OPENCODE_CONFIG_REL, user);
    installOpencodeHarness({ projectRoot: root, rules: RULES });
    const text = read(OPENCODE_CONFIG_REL);
    expect(text).toMatch(/^\t"instructions"/m);
    expect(text).not.toMatch(/^ +"/m);
    removeOpencodeHarness({ projectRoot: root });
    expect(read(OPENCODE_CONFIG_REL)).toBe(user);
  });
});

// ss-read names the config files that declare a key the window reads (jj-12 replay, dev run
// 2026-10-05: cli_util.rs read "experimental-advance-branches" and the agent never saw
// cli/src/config/misc.toml, where its defaults live).
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { configKeyCandidates, configKeyRefs, renderConfigKeyRefs } from '../../core/search/search-read.js';

const roots = [];
afterEach(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }); });

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'ss-config-keys-'));
  roots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

describe('configKeyCandidates', () => {
  it('takes key-shaped literals, not prose, file names or dotted packages', () => {
    expect(configKeyCandidates(`let n = ["experimental-advance-branches", setting_key]; get("enabled-branches")`))
      .toEqual(['experimental-advance-branches', 'enabled-branches']);
    expect(configKeyCandidates(`"hello world" "config.toml" "com.example.app.Main" 'x' "plain"`)).toEqual([]);
    expect(configKeyCandidates(`os.getenv("SWEET_SEARCH_DATA_DIR")`)).toEqual(['SWEET_SEARCH_DATA_DIR']);
  });
});

describe('configKeyRefs', () => {
  const FILES = {
    'cli/src/config/misc.toml': '[ui]\npager = "less"\n\n[experimental-advance-branches]\nenabled-branches = []\n',
    'cli/src/config-schema.json': '{\n  "properties": {\n    "experimental-advance-branches": {\n      "description": "uses \'enabled-branches\' patterns"\n    }\n  }\n}\n',
    'docker/compose.yml': 'services:\n  app:\n    command: ["run", "enabled-branches=x"]\n',
  };
  const configFiles = Object.keys(FILES);

  it('names the files that declare the key as a key, not as a value or in prose', () => {
    const root = repo(FILES);
    const refs = configKeyRefs(root, 'cli/src/cli_util.rs', 'from_iter(["experimental-advance-branches", key]); get("enabled-branches")', { files: configFiles });
    expect(refs).toEqual([
      { key: 'experimental-advance-branches', refs: [{ file: 'cli/src/config/misc.toml', line: 4 }, { file: 'cli/src/config-schema.json', line: 3 }] },
      { key: 'enabled-branches', refs: [{ file: 'cli/src/config/misc.toml', line: 5 }] },
    ]);
    expect(renderConfigKeyRefs({ configKeys: refs })).toBe(
      'config keys: experimental-advance-branches in cli/src/config/misc.toml:4, cli/src/config-schema.json:3; enabled-branches in misc.toml:5',
    );
  });

  it('says nothing for a config file being read, or for a key no config file declares', () => {
    const root = repo(FILES);
    expect(configKeyRefs(root, 'cli/src/config/misc.toml', '"experimental-advance-branches"', { files: configFiles })).toEqual([]);
    expect(configKeyRefs(root, 'src/a.rs', '"not-a-config-key"', { files: configFiles })).toEqual([]);
    expect(renderConfigKeyRefs({ configKeys: [] })).toBe('');
  });
});

/**
 * Construction-time test for SweetSearch's persisted-LI-policy bridge.
 *
 * The class previously read `LATE_INTERACTION_CONFIG.model` directly to
 * compute the search-rerank policy via `activeConfigModel`. After Phase 4
 * a user could persist `runtime.li.model = 'lateon-code-edge'` in
 * `.sweet-search/config.json` and the constructor would still see the
 * standard 'lateon-code' default until something else mutated the global.
 * This test pins the new contract: SweetSearch's ctor must call
 * applyPersistedLiModel(projectRoot) BEFORE consulting the active model.
 *
 * The test does NOT call init()/search() — those load HNSW + ONNX models.
 * We only construct the searcher, capture the apply report, and assert.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SweetSearch } from '../../core/search/sweet-search.js';
import { LATE_INTERACTION_CONFIG } from '../../core/infrastructure/config/ranking.js';

let projectRoot;
let savedModel;
let savedEnv;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'ss-ctor-li-'));
  savedModel = LATE_INTERACTION_CONFIG.model;
  savedEnv = process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL;
  delete process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL;
});

afterEach(() => {
  LATE_INTERACTION_CONFIG.model = savedModel;
  if (savedEnv === undefined) delete process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL;
  else process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL = savedEnv;
  rmSync(projectRoot, { recursive: true, force: true });
});

function writeConfig(model) {
  const dir = join(projectRoot, '.sweet-search');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({
    version: 1,
    profile: 'full',
    runtime: { li: { model, searchReranking: 'auto' } },
  }), 'utf-8');
}

describe('SweetSearch ctor — persisted LI model bridge', () => {
  it('applies persisted edge model to LATE_INTERACTION_CONFIG before reading it', () => {
    LATE_INTERACTION_CONFIG.model = 'lateon-code';
    writeConfig('lateon-code-edge');

    const searcher = new SweetSearch({ projectRoot });

    // The bridge must have run and switched the global.
    expect(LATE_INTERACTION_CONFIG.model).toBe('lateon-code-edge');
    // Bridge report is exposed as a private field for diagnostics.
    expect(searcher._liModelApply.applied).toBe('lateon-code-edge');
    expect(searcher._liModelApply.source).toBe('persisted');
    expect(searcher._liModelApply.changed).toBe(true);
  });

  it('persisted=none disables LI globally for the constructed searcher', () => {
    LATE_INTERACTION_CONFIG.model = 'lateon-code';
    writeConfig('none');

    const searcher = new SweetSearch({ projectRoot });

    expect(LATE_INTERACTION_CONFIG.model).toBe(false);
    expect(LATE_INTERACTION_CONFIG.enabled).toBe(false);
    // Constructor's tentative resolveSearchRerankPolicy result must agree:
    // edge "off" + "false model" → useLateInteraction is false.
    expect(searcher.useLateInteraction).toBe(false);
  });

  it('explicit env var overrides persisted config in the ctor too', () => {
    LATE_INTERACTION_CONFIG.model = 'lateon-code';
    writeConfig('lateon-code-edge');
    process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL = 'lateon-code';

    const searcher = new SweetSearch({ projectRoot });

    expect(LATE_INTERACTION_CONFIG.model).toBe('lateon-code');
    expect(searcher._liModelApply.source).toBe('env');
  });

  it('no persisted config + no env → keeps the built-in default', () => {
    LATE_INTERACTION_CONFIG.model = 'lateon-code';
    // No .sweet-search/config.json written.
    const searcher = new SweetSearch({ projectRoot });
    expect(LATE_INTERACTION_CONFIG.model).toBe('lateon-code');
    expect(searcher._liModelApply.source).toBe('default');
  });
});

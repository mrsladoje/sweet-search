/**
 * Tests for the persisted init-config reader/writer.
 *
 * This is the adapter that bridges scripts/init.js (writer) and
 * core/search/sweet-search.js (reader). Verifying the round-trip and
 * the LI-policy accessor here keeps the runtime path correct without
 * spinning up an actual SweetSearch instance (which loads HNSW, model
 * weights, and a WASM kernel).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  INIT_CONFIG_FILE_NAME,
  INIT_DATA_DIR_NAME,
  getInitConfigPath,
  loadInitConfig,
  readPersistedLiPolicy,
  writeInitConfig,
} from '../../core/infrastructure/init-config.js';

describe('init-config — path helpers + round-trip', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sweet-search-init-config-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('getInitConfigPath joins projectRoot/.sweet-search/config.json', () => {
    expect(getInitConfigPath('/tmp/proj')).toBe(`/tmp/proj/${INIT_DATA_DIR_NAME}/${INIT_CONFIG_FILE_NAME}`);
  });

  it('loadInitConfig returns null for missing file', () => {
    expect(loadInitConfig(tmpRoot)).toBeNull();
  });

  it('loadInitConfig returns null for malformed JSON', () => {
    const dataDir = join(tmpRoot, INIT_DATA_DIR_NAME);
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, INIT_CONFIG_FILE_NAME), '{not json', 'utf-8');
    expect(loadInitConfig(tmpRoot)).toBeNull();
  });

  it('writeInitConfig + loadInitConfig round-trip from projectRoot path', () => {
    const dataDir = join(tmpRoot, INIT_DATA_DIR_NAME);
    mkdirSync(dataDir, { recursive: true });
    const cfg = { version: 1, profile: 'full', runtime: { li: { model: 'lateon-code-edge', searchReranking: 'auto' } } };
    writeInitConfig(dataDir, cfg);
    const loaded = loadInitConfig(tmpRoot);
    expect(loaded).toEqual(cfg);
  });

  it('loadInitConfig accepts the dataDir path directly (init.js call style)', () => {
    const dataDir = join(tmpRoot, INIT_DATA_DIR_NAME);
    mkdirSync(dataDir, { recursive: true });
    const cfg = { version: 1, profile: 'core' };
    writeInitConfig(dataDir, cfg);
    expect(loadInitConfig(dataDir)).toEqual(cfg);
  });
});

describe('readPersistedLiPolicy', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sweet-search-li-policy-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeConfig(payload) {
    const dataDir = join(tmpRoot, INIT_DATA_DIR_NAME);
    mkdirSync(dataDir, { recursive: true });
    writeInitConfig(dataDir, payload);
  }

  it('returns {} when no config exists', () => {
    expect(readPersistedLiPolicy(tmpRoot)).toEqual({});
  });

  it('returns {} when config has no runtime.li section', () => {
    writeConfig({ version: 1, profile: 'full', runtime: {} });
    expect(readPersistedLiPolicy(tmpRoot)).toEqual({});
  });

  it('returns the LI section when present', () => {
    writeConfig({
      version: 1,
      profile: 'full',
      runtime: { li: { model: 'lateon-code-edge', searchReranking: 'off' } },
    });
    expect(readPersistedLiPolicy(tmpRoot)).toEqual({
      liModel: 'lateon-code-edge',
      searchReranking: 'off',
    });
  });

  it('only returns string-typed fields', () => {
    writeConfig({
      runtime: { li: { model: 42, searchReranking: ['on'] } },
    });
    expect(readPersistedLiPolicy(tmpRoot)).toEqual({});
  });

  it('returns partial sections', () => {
    writeConfig({ runtime: { li: { model: 'lateon-code' } } });
    expect(readPersistedLiPolicy(tmpRoot)).toEqual({ liModel: 'lateon-code' });
  });
});

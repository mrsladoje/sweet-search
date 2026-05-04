/**
 * Tests for the runtime LI-model resolver added to bridge persisted
 * `runtime.li.model` from `.sweet-search/config.json` to the global
 * `LATE_INTERACTION_CONFIG.model` consumed by every encodeQuery /
 * native-LI / cascade-dispatch / indexer caller.
 *
 * These tests cover:
 *   - precedence ladder of resolveRuntimeLiModel (env > persisted > default)
 *   - 'none' coercion to false (matches index-codebase-v21 disabled state)
 *   - applyPersistedLiModel mutates LATE_INTERACTION_CONFIG.model
 *   - applyPersistedLiModel never overrides explicit env var
 *
 * Tests save/restore LATE_INTERACTION_CONFIG.model around every mutating
 * block so the global state never leaks across tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  applyPersistedLiModel,
  resolveRuntimeLiModel,
} from '../../core/infrastructure/init-config.js';
import { LATE_INTERACTION_CONFIG } from '../../core/infrastructure/config/ranking.js';

function writeConfig(projectRoot, payload) {
  const dir = join(projectRoot, '.sweet-search');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(payload), 'utf-8');
}

describe('resolveRuntimeLiModel — precedence ladder', () => {
  it('returns default when no persisted + no env', () => {
    expect(resolveRuntimeLiModel(null, {}, 'lateon-code')).toBe('lateon-code');
    expect(resolveRuntimeLiModel(undefined, {}, 'lateon-code')).toBe('lateon-code');
  });

  it('uses persisted when env not set', () => {
    expect(resolveRuntimeLiModel('lateon-code-edge', {}, 'lateon-code')).toBe('lateon-code-edge');
    expect(resolveRuntimeLiModel('lateon-code', {}, 'lateon-code')).toBe('lateon-code');
  });

  it('persisted "none" maps to false (LI disabled — same shape as --no-late-interaction)', () => {
    expect(resolveRuntimeLiModel('none', {}, 'lateon-code')).toBe(false);
  });

  it('env wins over persisted', () => {
    expect(resolveRuntimeLiModel(
      'lateon-code-edge',
      { SWEET_SEARCH_LATE_INTERACTION_MODEL: 'lateon-code' },
      'lateon-code',
    )).toBe('lateon-code');
  });

  it('env "none" or "false" forces disabled', () => {
    expect(resolveRuntimeLiModel(
      'lateon-code',
      { SWEET_SEARCH_LATE_INTERACTION_MODEL: 'none' },
    )).toBe(false);
    expect(resolveRuntimeLiModel(
      'lateon-code-edge',
      { SWEET_SEARCH_LATE_INTERACTION_MODEL: 'false' },
    )).toBe(false);
  });

  it('ignores invalid persisted values and falls through', () => {
    expect(resolveRuntimeLiModel('garbage', {}, 'lateon-code')).toBe('lateon-code');
    expect(resolveRuntimeLiModel(42, {}, 'lateon-code')).toBe('lateon-code');
    expect(resolveRuntimeLiModel('', {}, 'lateon-code')).toBe('lateon-code');
  });
});

describe('applyPersistedLiModel — mutates LATE_INTERACTION_CONFIG', () => {
  let savedModel;
  let savedEnv;
  let projectRoot;

  beforeEach(() => {
    savedModel = LATE_INTERACTION_CONFIG.model;
    savedEnv = process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL;
    delete process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL;
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-apply-li-'));
  });

  afterEach(() => {
    LATE_INTERACTION_CONFIG.model = savedModel;
    if (savedEnv === undefined) delete process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL;
    else process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL = savedEnv;
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('switches active model to edge when persisted=edge and env unset', () => {
    LATE_INTERACTION_CONFIG.model = 'lateon-code';
    writeConfig(projectRoot, {
      version: 1,
      runtime: { li: { model: 'lateon-code-edge', searchReranking: 'auto' } },
    });

    const r = applyPersistedLiModel(projectRoot, { env: {} });

    expect(LATE_INTERACTION_CONFIG.model).toBe('lateon-code-edge');
    expect(r.applied).toBe('lateon-code-edge');
    expect(r.before).toBe('lateon-code');
    expect(r.source).toBe('persisted');
    expect(r.changed).toBe(true);
  });

  it('disables LI when persisted=none', () => {
    LATE_INTERACTION_CONFIG.model = 'lateon-code';
    writeConfig(projectRoot, { runtime: { li: { model: 'none' } } });

    const r = applyPersistedLiModel(projectRoot, { env: {} });

    expect(LATE_INTERACTION_CONFIG.model).toBe(false);
    // The enabled getter must collapse with our coerced value.
    expect(LATE_INTERACTION_CONFIG.enabled).toBe(false);
    expect(r.applied).toBe(false);
    expect(r.source).toBe('persisted');
  });

  it('env var wins over persisted (CI/scripts override contract preserved)', () => {
    LATE_INTERACTION_CONFIG.model = 'lateon-code';
    writeConfig(projectRoot, { runtime: { li: { model: 'lateon-code-edge' } } });

    const r = applyPersistedLiModel(projectRoot, {
      env: { SWEET_SEARCH_LATE_INTERACTION_MODEL: 'lateon-code' },
    });

    expect(LATE_INTERACTION_CONFIG.model).toBe('lateon-code');
    expect(r.applied).toBe('lateon-code');
    expect(r.source).toBe('env');
  });

  it('falls back to default when no persisted config exists', () => {
    LATE_INTERACTION_CONFIG.model = 'lateon-code';
    // No .sweet-search/config.json written.

    const r = applyPersistedLiModel(projectRoot, { env: {} });

    expect(LATE_INTERACTION_CONFIG.model).toBe('lateon-code');
    expect(r.applied).toBe('lateon-code');
    expect(r.source).toBe('default');
  });

  it('is idempotent — second call is a no-op when nothing changed', () => {
    LATE_INTERACTION_CONFIG.model = 'lateon-code';
    writeConfig(projectRoot, { runtime: { li: { model: 'lateon-code-edge' } } });

    const r1 = applyPersistedLiModel(projectRoot, { env: {} });
    const r2 = applyPersistedLiModel(projectRoot, { env: {} });

    expect(r1.changed).toBe(true);
    expect(r2.changed).toBe(false);
    expect(LATE_INTERACTION_CONFIG.model).toBe('lateon-code-edge');
  });

  it('ignores malformed persisted values (model: 42) and uses default', () => {
    LATE_INTERACTION_CONFIG.model = 'lateon-code';
    writeConfig(projectRoot, { runtime: { li: { model: 42 } } });

    const r = applyPersistedLiModel(projectRoot, { env: {} });

    expect(LATE_INTERACTION_CONFIG.model).toBe('lateon-code');
    expect(r.source).toBe('default');
    expect(r.persistedModel).toBeNull();
  });
});

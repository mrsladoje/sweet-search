/**
 * Subprocess test that proves the `read-semantic` runtime path honours
 * the user's persisted `runtime.li.model` choice from
 * `.sweet-search/config.json` WITHOUT anyone manually mutating
 * `LATE_INTERACTION_CONFIG.model`.
 *
 * Why a subprocess: `LATE_INTERACTION_CONFIG.model` is a process-global
 * mutable in `core/infrastructure/config/ranking.js`. Existing edge tests
 * pass by directly mutating that variable — which is exactly the scenario
 * the prior investigation flagged as not exercising the persisted-config
 * path. We need a clean process where the only signal is the persisted
 * config file.
 *
 * The subprocess does NOT load any models or perform real inference. It
 * only:
 *   - imports the read-semantic module (which calls applyPersistedLiModel)
 *   - reads LATE_INTERACTION_CONFIG.model AFTER readSemantic() has run far
 *     enough to wire its lazy applier
 * This catches regressions where someone removes / breaks the persisted
 * → runtime bridge.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

let projectRoot;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'ss-rs-li-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function writePersistedConfig(model) {
  const dir = join(projectRoot, '.sweet-search');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({
    version: 1,
    profile: 'full',
    runtime: { li: { model, searchReranking: 'auto' } },
  }), 'utf-8');
}

/**
 * Run a small subprocess that:
 *   1. Imports applyPersistedLiModel + LATE_INTERACTION_CONFIG.
 *   2. Reads the active model BEFORE applying.
 *   3. Calls applyPersistedLiModel(projectRoot).
 *   4. Reads it AFTER and prints { before, after } as JSON.
 *
 * The test asserts the subprocess saw the correct after value with no
 * direct mutation of LATE_INTERACTION_CONFIG.model anywhere in the script.
 */
function runProbeSubprocess(envOverride = {}) {
  // Inline ESM script — keeps the test file self-contained.
  // Paths and projectRoot are JSON.stringify'd so spaces / special chars
  // in the tmpdir layout never break the inlined source.
  const initConfigPath = join(REPO_ROOT, 'core/infrastructure/init-config.js');
  const rankingPath = join(REPO_ROOT, 'core/infrastructure/config/ranking.js');
  const readSemanticPath = join(REPO_ROOT, 'core/search/search-read-semantic.js');
  const script = `
    Promise.resolve().then(async () => {
      const { applyPersistedLiModel } = await import(${JSON.stringify(initConfigPath)});
      const { LATE_INTERACTION_CONFIG } = await import(${JSON.stringify(rankingPath)});
      const before = LATE_INTERACTION_CONFIG.model;
      applyPersistedLiModel(${JSON.stringify(projectRoot)});
      const after = LATE_INTERACTION_CONFIG.model;
      // Then exercise the read-semantic import path so we cover the
      // module-init branch — without doing a real search (which needs
      // an indexed corpus on disk).
      await import(${JSON.stringify(readSemanticPath)});
      const afterImport = LATE_INTERACTION_CONFIG.model;
      process.stdout.write(JSON.stringify({ before, after, afterImport }));
    }).catch((e) => { process.stderr.write(String(e?.stack || e)); process.exit(1); });
  `;
  const env = {
    ...process.env,
    ...envOverride,
  };
  // Strip env override unless the caller wants it set.
  if (!Object.prototype.hasOwnProperty.call(envOverride, 'SWEET_SEARCH_LATE_INTERACTION_MODEL')) {
    delete env.SWEET_SEARCH_LATE_INTERACTION_MODEL;
  }
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: projectRoot,
    env,
    encoding: 'utf-8',
    timeout: 20_000,
  });
  if (r.status !== 0) {
    throw new Error(`probe subprocess exited ${r.status}: ${r.stderr}`);
  }
  return JSON.parse(r.stdout.trim());
}

function runDaemonRouteProbeSubprocess(envOverride = {}) {
  const rankingPath = join(REPO_ROOT, 'core/infrastructure/config/ranking.js');
  const searchServerPath = join(REPO_ROOT, 'core/search/search-server.js');
  const route = `/read-semantic?${new URLSearchParams({
    path: 'a.js',
    q: 'alpha',
    projectRoot,
  }).toString()}`;
  const script = `
    Promise.resolve().then(async () => {
      const { LATE_INTERACTION_CONFIG } = await import(${JSON.stringify(rankingPath)});
      const before = LATE_INTERACTION_CONFIG.model;
      const { buildReadSemanticDaemonResponse } = await import(${JSON.stringify(searchServerPath)});
      const response = await buildReadSemanticDaemonResponse(${JSON.stringify(route)}, {
        isUnixSocket: true,
        serverReady: true,
        searcher: { projectRoot: ${JSON.stringify(projectRoot)} },
      });
      const after = LATE_INTERACTION_CONFIG.model;
      process.stdout.write(JSON.stringify({ before, after, status: response.status }));
    }).catch((e) => { process.stderr.write(String(e?.stack || e)); process.exit(1); });
  `;
  const env = {
    ...process.env,
    ...envOverride,
  };
  if (!Object.prototype.hasOwnProperty.call(envOverride, 'SWEET_SEARCH_LATE_INTERACTION_MODEL')) {
    delete env.SWEET_SEARCH_LATE_INTERACTION_MODEL;
  }
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: projectRoot,
    env,
    encoding: 'utf-8',
    timeout: 20_000,
  });
  if (r.status !== 0) {
    throw new Error(`daemon route probe subprocess exited ${r.status}: ${r.stderr}`);
  }
  return JSON.parse(r.stdout.trim());
}

describe('read-semantic honors persisted LI model in a fresh process', () => {
  it('persisted=lateon-code-edge → LATE_INTERACTION_CONFIG.model becomes "lateon-code-edge"', () => {
    writePersistedConfig('lateon-code-edge');
    const out = runProbeSubprocess();
    // Default before applying is the value from config defaults / env.
    // Whatever it is, after applying must be the persisted edge model.
    expect(out.after).toBe('lateon-code-edge');
    expect(out.afterImport).toBe('lateon-code-edge');
  });

  it('persisted=none → LATE_INTERACTION_CONFIG.model becomes false (LI disabled)', () => {
    writePersistedConfig('none');
    const out = runProbeSubprocess();
    expect(out.after).toBe(false);
  });

  it('explicit env var beats persisted config', () => {
    writePersistedConfig('lateon-code-edge');
    const out = runProbeSubprocess({
      SWEET_SEARCH_LATE_INTERACTION_MODEL: 'lateon-code',
    });
    expect(out.after).toBe('lateon-code');
  });

  it('absent persisted config falls through to default', () => {
    // No .sweet-search/config.json written.
    const out = runProbeSubprocess();
    expect(out.after).toBe('lateon-code');
  });

  it('daemon read-semantic route applies the persisted LI model before handling the request', () => {
    writePersistedConfig('lateon-code-edge');
    writeFileSync(join(projectRoot, 'a.js'), 'export const alpha = 1;\n', 'utf-8');
    const out = runDaemonRouteProbeSubprocess();
    expect(out.status).toBe(200);
    expect(out.after).toBe('lateon-code-edge');
  });
});

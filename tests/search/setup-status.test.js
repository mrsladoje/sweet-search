import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  formatSetupStatus,
  isWritableDir,
  modelPresence,
  nextStep,
  requiredModelKeys,
} from '../../core/search/setup-status.js';
import { MODEL_REGISTRY } from '../../core/infrastructure/model-registry.js';
import { closeDaemonLog, daemonLogPath, openDaemonLog } from '../../core/search/daemon-log.js';

function status(overrides = {}) {
  return {
    projectRoot: '/repo',
    install: { version: '9.9.9', packageRoot: '/pkg', skippedPostinstall: null },
    setup: { initialized: true, modelsDeferred: false, liModel: 'lateon-code' },
    models: {
      cacheRoot: '/home/u/.cache/sweet-search/models',
      cacheWritable: true,
      required: [{ key: 'coderankembed-int8', present: true, missingBytes: 0 }],
    },
    index: {
      ready: true,
      reason: 'ready',
      parts: { codeGraph: true, searchDatabase: true, vectorIndex: true, lateInteraction: true },
      state: { lastIndex: '2026-10-15T00:00:00.000Z', files: 3, chunks: 3 },
    },
    server: { state: 'ready', pid: 1, error: null, socket: '/tmp/s.sock', log: null },
    ...overrides,
  };
}

const missingModel = { required: [{ key: 'coderankembed-int8', present: false, missingBytes: 10 }] };

describe('setup status: next step', () => {
  it('is null when search can run', () => {
    expect(nextStep(status())).toBeNull();
  });

  it('names the npm command when install scripts did not run', () => {
    const s = status({ install: { skippedPostinstall: { fix: 'npm install -g sweet-search --allow-scripts=x' } } });
    expect(nextStep(s)).toBe('npm install -g sweet-search --allow-scripts=x');
  });

  it('names the cache fix before init when the model cache is not writable', () => {
    const s = status({ models: { ...status().models, ...missingModel, cacheWritable: false } });
    expect(nextStep(s)).toMatch(/SWEET_SEARCH_MODEL_CACHE/);
  });

  it('sends a plain init to init and an init --skip-models to index for missing models', () => {
    const models = { ...status().models, ...missingModel };
    expect(nextStep(status({ models }))).toBe('sweet-search init');
    expect(nextStep(status({ models, setup: { initialized: true, modelsDeferred: true } })))
      .toMatch(/^sweet-search index/);
    expect(nextStep(status({ models, setup: { initialized: false, modelsDeferred: false } }))).toBe('sweet-search init');
  });

  it('does not require init when the models and the index are present', () => {
    expect(nextStep(status({ setup: { initialized: false, modelsDeferred: false, liModel: 'lateon-code' } }))).toBeNull();
  });

  it('asks for an index, or a full rebuild after a format change', () => {
    const partial = status({ index: { ...status().index, ready: false, reason: 'no-config-fingerprint' } });
    expect(nextStep(partial)).toBe('sweet-search index');
    const stale = status({ index: { ...status().index, ready: false, reason: 'config-fingerprint-mismatch' } });
    expect(nextStep(stale)).toBe('sweet-search index --full');
  });

  it('asks for a restart when the server failed', () => {
    expect(nextStep(status({ server: { ...status().server, state: 'failed', error: 'boom' } })))
      .toBe('sweet-search daemon restart');
  });
});

describe('setup status: report', () => {
  it('ends with the next step, or with how to search', () => {
    const ready = status();
    ready.nextStep = null;
    expect(formatSetupStatus(ready).split('\n').at(-1)).toBe('Ready. Search with: sweet-search "<query>"');
    const partial = status({ index: { ...status().index, ready: false, reason: 'no-config-fingerprint' } });
    partial.nextStep = nextStep(partial);
    const text = formatSetupStatus(partial);
    expect(text).toMatch(/Index: no complete index yet \(only part of it was built\)/);
    expect(text.split('\n').at(-1)).toBe('Next step: sweet-search index');
  });

  it('says that init --skip-models downloads models at the first index', () => {
    const s = status({ setup: { initialized: true, modelsDeferred: true, liModel: 'lateon-code' } });
    s.nextStep = null;
    expect(formatSetupStatus(s)).toMatch(/Init: done with --skip-models \(models download on the first index\)/);
  });
});

describe('setup status: models and cache', () => {
  it('requires the embedding model and the late-interaction model in use', () => {
    expect(requiredModelKeys('lateon-code')).toEqual(['coderankembed-int8', 'lateon-code']);
    expect(requiredModelKeys(false)).toEqual(['coderankembed-int8']);
  });

  it('counts a model present only when every file has its registry size', () => {
    const entry = MODEL_REGISTRY['coderankembed-int8'];
    const sizes = new Map(entry.files.map((f) => [f.path, f.sizeBytes]));
    const stat = (p) => {
      const rel = path.relative(path.join('/cache', entry.hfId.replace('/', '--')), p);
      if (!sizes.has(rel)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return { size: sizes.get(rel) };
    };
    expect(modelPresence('coderankembed-int8', '/cache', stat)).toMatchObject({ present: true, missingBytes: 0 });
    const first = entry.files[0];
    sizes.set(first.path, first.sizeBytes - 1); // truncated download
    expect(modelPresence('coderankembed-int8', '/cache', stat)).toMatchObject({
      present: false,
      missingBytes: first.sizeBytes,
    });
  });

  it('checks writability at the nearest existing ancestor', () => {
    const seen = [];
    const exists = (p) => p === '/home/u';
    const access = (p) => { seen.push(p); };
    expect(isWritableDir('/home/u/.cache/sweet-search/models', access, exists)).toBe(true);
    expect(seen).toEqual(['/home/u']);
    const deny = () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); };
    expect(isWritableDir('/home/u/.cache', deny, exists)).toBe(false);
  });
});

describe('daemon log', () => {
  let root;
  afterEach(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); });

  it('has no log before the project has a .sweet-search directory', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-daemon-log-'));
    expect(daemonLogPath(root)).toBeNull();
    expect(openDaemonLog(root)).toBe('ignore');
  });

  it('appends a start marker per start and keeps earlier output', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-daemon-log-'));
    fs.mkdirSync(path.join(root, '.sweet-search'));
    const first = openDaemonLog(root);
    fs.writeSync(first, 'first run\n');
    closeDaemonLog(first);
    closeDaemonLog(openDaemonLog(root));
    const text = fs.readFileSync(daemonLogPath(root), 'utf8');
    expect(text.match(/--- daemon start/g)).toHaveLength(2);
    expect(text).toMatch(/first run/);
  });
});

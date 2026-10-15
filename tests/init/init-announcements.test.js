import { describe, it, expect } from 'vitest';
import {
  parseInitArgs,
  validateInitArgs,
  formatDownloadSize,
  cascadeDownloadBytes,
  detectSkippedPostinstall,
} from '../../scripts/init.js';

describe('--skip-models and the removed --profile flag', () => {
  it('parses --skip-models', () => {
    expect(parseInitArgs(['--skip-models']).skipModels).toBe(true);
    expect(parseInitArgs([]).skipModels).toBe(false);
  });
  it('rejects every --profile form and names --skip-models', () => {
    for (const args of [['--profile', 'core'], ['--profile=full'], ['-p', 'core']]) {
      const parsed = parseInitArgs(args);
      const v = validateInitArgs(parsed);
      expect(v.ok).toBe(false);
      expect(v.error).toMatch(/--profile was removed.*--skip-models/);
    }
  });
  it('does not take the value after --profile as another flag', () => {
    expect(parseInitArgs(['--profile', '--skip-models']).skipModels).toBe(false);
  });
});

describe('formatDownloadSize', () => {
  it('uses MB below 1 GB and GB above', () => {
    expect(formatDownloadSize(523e6)).toBe('523 MB');
    expect(formatDownloadSize(1.84e9)).toBe('1.8 GB');
  });
});

describe('cascadeDownloadBytes', () => {
  const spec = {
    embed: { variants: [{ tarballSizeBytes: 100 }, { tarballSizeBytes: 50 }] },
    li: { variants: [{ tarballSizeBytes: 10 }] },
    liEdge: { variants: [{ tarballSizeBytes: 1 }] },
  };
  it('sums embed plus the chosen LI family', () => {
    expect(cascadeDownloadBytes(spec, 'lateon-code')).toBe(160);
    expect(cascadeDownloadBytes(spec, 'lateon-code-edge')).toBe(151);
  });
  it('returns null without size data', () => {
    expect(cascadeDownloadBytes(null, 'lateon-code')).toBeNull();
    expect(cascadeDownloadBytes({ ...spec, li: { variants: [{}] } }, 'lateon-code')).toBeNull();
  });
});

describe('detectSkippedPostinstall', () => {
  const none = () => false;
  it('does not apply to a development checkout or other platforms', () => {
    expect(detectSkippedPostinstall('/src/sweet-search', 'darwin', none)).toBeNull();
    expect(detectSkippedPostinstall('/a/node_modules/sweet-search', 'win32', none)).toBeNull();
  });
  it('is quiet when .install-node exists', () => {
    expect(detectSkippedPostinstall('/a/node_modules/sweet-search', 'linux', () => true)).toBeNull();
  });
  it('gives the global fix for a global install', () => {
    const r = detectSkippedPostinstall('/usr/local/lib/node_modules/sweet-search', 'linux', none);
    expect(r.global).toBe(true);
    expect(r.fix).toBe('npm install -g sweet-search --allow-scripts=sweet-search,onnxruntime-node');
  });
  it('gives the local fix for a project install', () => {
    const r = detectSkippedPostinstall('/proj/node_modules/sweet-search', 'darwin', none);
    expect(r.global).toBe(false);
    expect(r.fix).toBe('npm install sweet-search --allow-scripts=sweet-search,onnxruntime-node');
  });
});

describe('initNextStep', () => {
  it('sends a project without an index to sweet-search index', async () => {
    const { initNextStep } = await import('../../scripts/init.js');
    expect(initNextStep(false, '/repo', () => false)).toMatch(/^sweet-search index \(builds the search index/);
    expect(initNextStep(true, '/repo', () => false)).toMatch(/downloads the models first/);
  });

  it('sends an indexed project to search', async () => {
    const { initNextStep } = await import('../../scripts/init.js');
    expect(initNextStep(false, '/repo', (p) => p === '/repo/.sweet-search/codebase.db')).toMatch(/^search with/);
  });
});

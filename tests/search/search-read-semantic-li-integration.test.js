import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const mockState = vi.hoisted(() => ({
  rows: [],
  tmpDir: `/tmp/sweet-search-rsem-li-root-${process.pid}-${Math.random().toString(36).slice(2)}`,
}));

vi.mock('../../core/infrastructure/codebase-repository.js', () => ({
  CodebaseRepository: class {
    getChunksByFilePath(filePath) {
      return mockState.rows.filter(r => r.file_path === filePath);
    }
  },
}));

vi.mock('../../core/infrastructure/config/index.js', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    DB_PATHS: {
      ...(actual.DB_PATHS || {}),
      codebase: ':memory:',
      lateInteraction: path.join(mockState.tmpDir, 'late-interaction.db'),
    },
    LATE_INTERACTION_CONFIG: {
      ...(actual.LATE_INTERACTION_CONFIG || {}),
      model: 'lateon-code',
      get enabled() { return true; },
      get tokenDimension() { return 4; },
      quantization: 'float32',
    },
  };
});

vi.mock('../../core/ranking/late-interaction-model.js', () => ({
  encodeQuery: vi.fn(async query => {
    if (query.includes('semantic target')) return [[1, 0, 0, 0]];
    return [[0, 1, 0, 0]];
  }),
}));

const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
const {
  readSemantic,
  __resetReadSemanticCachesForTests,
} = await import('../../core/search/search-read-semantic.js');
const { __resetReadCachesForTests } = await import('../../core/search/search-read.js');

let PROJECT;

beforeEach(() => {
  PROJECT = path.join(mockState.tmpDir, 'project');
  mkdirSync(PROJECT, { recursive: true });
  mockState.rows = [];
  __resetReadCachesForTests();
  __resetReadSemanticCachesForTests();
});

afterEach(() => {
  rmSync(path.join(mockState.tmpDir, 'project'), { recursive: true, force: true });
  rmSync(path.join(mockState.tmpDir, 'late-interaction.db'), { force: true });
  mockState.rows = [];
  __resetReadCachesForTests();
  __resetReadSemanticCachesForTests();
});

afterAll(() => {
  rmSync(mockState.tmpDir, { recursive: true, force: true });
});

function writeProject(rel, content) {
  const abs = path.join(PROJECT, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function addRow(id, filePath, metadata) {
  mockState.rows.push({
    id,
    file_path: filePath,
    text: 'DB TEXT MUST NOT BE RETURNED',
    metadata: JSON.stringify(metadata),
  });
}

async function writeLiIndex() {
  const idx = new LateInteractionIndex({
    tokenDim: 4,
    useInt8: false,
    quantBits: 32,
    indexPath: path.join(mockState.tmpDir, 'late-interaction.db'),
    modelId: 'lateon-code',
  });
  idx.initialized = true;
  await idx.add('target-chunk', [[1, 0, 0, 0]], { name: 'targetChunk' });
  await idx.add('distractor-chunk', [[0, 1, 0, 0]], { name: 'distractorChunk' });
  await idx.save();
}

async function writeAliasLiIndex() {
  const idx = new LateInteractionIndex({
    tokenDim: 4,
    useInt8: false,
    quantBits: 32,
    indexPath: path.join(mockState.tmpDir, 'late-interaction.db'),
    modelId: 'lateon-code',
  });
  idx.initialized = true;
  await idx.add('target-exemplar', [[1, 0, 0, 0]], { name: 'targetExemplar' });
  idx.addAlias('alias-chunk', 'target-exemplar', 'cluster-target', {
    file: 'src/li-alias.js',
    startLine: 1,
    endLine: 3,
    type: 'function',
    name: 'aliasBeta',
  });
  await idx.save();
}

async function writeSingleDocLiIndex(indexPath, docId) {
  const idx = new LateInteractionIndex({
    tokenDim: 4,
    useInt8: false,
    quantBits: 32,
    indexPath,
    modelId: 'lateon-code',
  });
  idx.initialized = true;
  await idx.add(docId, [[1, 0, 0, 0]], { name: docId });
  await idx.save();
}

function writeProjectManifest(epoch, liIndexBasename) {
  const stateDir = path.join(PROJECT, '.sweet-search');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(path.join(stateDir, 'reconcile-manifest.json'), JSON.stringify({
    epoch,
    lateInteraction: {
      manifest: `${liIndexBasename}.segments/manifest.json`,
      epoch,
    },
    vectors: { path: 'codebase.db', epoch },
  }));
}

describe('readSemantic — real late-interaction index path', () => {
  it('loads a persisted LI index, runs MaxSim, and returns the matching disk span', async () => {
    writeProject('src/li.js', [
      'function alpha() {',
      '  return "boring";',
      '}',
      '',
      'function beta() {',
      '  return "chosen by vectors";',
      '}',
      '',
    ].join('\n'));

    // Use real indexer metadata keys to catch schema drift.
    addRow('distractor-chunk', 'src/li.js', {
      language: 'javascript',
      symbol: 'alpha',
      chunk_type: 'function',
      line_start: 1,
      line_end: 3,
    });
    addRow('target-chunk', 'src/li.js', {
      language: 'javascript',
      symbol: 'beta',
      chunk_type: 'function',
      line_start: 5,
      line_end: 7,
    });
    await writeLiIndex();

    const result = await readSemantic({
      path: 'src/li.js',
      query: 'semantic target',
      topK: 1,
      threshold: 0,
      contextLines: 0,
      projectRoot: PROJECT,
      verbose: true,
    });

    expect(result.ok).toBe(true);
    expect(result.indexed).toBe(true);
    expect(result.fellBack).toBe(false);
    expect(result.signals.liRan).toBe(true);
    expect(result.spans).toHaveLength(1);
    expect(result.spans[0].chunkIds).toEqual(['target-chunk']);
    expect(result.spans[0].symbols).toEqual(['beta']);
    expect(result.spans[0].text).toBe('function beta() {\n  return "chosen by vectors";\n}\n');
    expect(result.spans[0].text).not.toContain('DB TEXT');
  });

  it('scores LI alias chunks through the exemplar token matrix', async () => {
    writeProject('src/li-alias.js', [
      'function aliasBeta() {',
      '  return "chosen through alias";',
      '}',
      '',
    ].join('\n'));
    addRow('alias-chunk', 'src/li-alias.js', {
      language: 'javascript',
      symbol: 'aliasBeta',
      chunk_type: 'function',
      line_start: 1,
      line_end: 3,
    });
    await writeAliasLiIndex();

    const result = await readSemantic({
      path: 'src/li-alias.js',
      query: 'semantic target',
      topK: 1,
      threshold: 0,
      contextLines: 0,
      projectRoot: PROJECT,
      verbose: true,
    });

    expect(result.ok).toBe(true);
    expect(result.signals.liRan).toBe(true);
    expect(result.spans[0].chunkIds).toEqual(['alias-chunk']);
    expect(result.spans[0].text).toBe('function aliasBeta() {\n  return "chosen through alias";\n}\n');
  });

  it('reloads the LI singleton when the reconcile manifest epoch advances', async () => {
    writeProject('src/li.js', [
      'function alpha() {',
      '  return "first manifest";',
      '}',
      '',
      'function beta() {',
      '  return "second manifest";',
      '}',
      '',
    ].join('\n'));
    addRow('alpha-chunk', 'src/li.js', {
      language: 'javascript',
      symbol: 'alpha',
      chunk_type: 'function',
      line_start: 1,
      line_end: 3,
    });
    addRow('beta-chunk', 'src/li.js', {
      language: 'javascript',
      symbol: 'beta',
      chunk_type: 'function',
      line_start: 5,
      line_end: 7,
    });

    const stateDir = path.join(PROJECT, '.sweet-search');
    mkdirSync(stateDir, { recursive: true });
    await writeSingleDocLiIndex(path.join(stateDir, 'li-first.db'), 'alpha-chunk');
    await writeSingleDocLiIndex(path.join(stateDir, 'li-second.db'), 'beta-chunk');

    writeProjectManifest(1, 'li-first.db');
    const first = await readSemantic({
      path: 'src/li.js',
      query: 'semantic target',
      topK: 1,
      threshold: 0,
      contextLines: 0,
      projectRoot: PROJECT,
      verbose: true,
    });
    expect(first.signals.liRan).toBe(true);
    expect(first.spans[0].chunkIds).toEqual(['alpha-chunk']);

    writeProjectManifest(2, 'li-second.db');
    const second = await readSemantic({
      path: 'src/li.js',
      query: 'semantic target',
      topK: 1,
      threshold: 0,
      contextLines: 0,
      projectRoot: PROJECT,
      verbose: true,
    });
    expect(second.signals.liRan).toBe(true);
    expect(second.spans[0].chunkIds).toEqual(['beta-chunk']);
  });
});

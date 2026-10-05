import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets } from '../../core/graph/relationship-resolver.js';
import { createImportResolver } from '../../core/graph/import-resolver.js';
import { findAliasCallers } from '../../core/infrastructure/structural-alias-resolver.js';

describe('findAliasCallers reads only files that import the target', () => {
  let root;
  let db;
  const FILES = {
    'lib/math.js': ['export function add(a, b) {', '  return a + b;', '}'],
    'app/main.js': ["import { add as plus } from '../lib/math';", 'export function main() {', '  return plus(1, 2);', '}'],
    'app/other.js': ["import { add as plus } from './local';", 'export function other() {', '  return plus(3, 4);', '}'],
    'app/local.js': ['export function add(a, b) {', '  return a - b;', '}'],
    'py/tool.py': ['def add(a, b):', '    return a + b'],
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'ss-alias-callers-'));
    for (const [rel, lines] of Object.entries(FILES)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), lines.join('\n'));
    }
    const files = Object.keys(FILES);
    const extractor = new GraphExtractor({ importResolver: createImportResolver({ projectRoot: root, files }) });
    const ents = [];
    const rels = [];
    for (const rel of files) {
      const out = await extractor.extractFromFile(rel, FILES[rel].join('\n'));
      ents.push(...out.entities);
      rels.push(...out.relationships);
    }
    db = new Database(join(root, 'g.db'));
    const log = console.log;
    console.log = () => {};
    try {
      const fts = createGraphSchema(db);
      insertGraph(db, ents, rels, fts, { syncFts: false });
      resolveRelationshipTargets(db);
    } finally {
      console.log = log;
    }
  });

  afterAll(() => {
    db?.close();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  const reader = (reads) => (file) => {
    reads.push(file);
    return FILES[file]?.join('\n') ?? null;
  };

  it('finds the aliased caller and reads only the importing file', () => {
    const reads = [];
    const target = { id: 't', name: 'add', filePath: 'lib/math.js' };
    const callers = findAliasCallers({ db, target, readFileRange: reader(reads) });
    expect(callers.map(c => `${c.filePath}:${c.name}:${c.targetName}`)).toEqual(['app/main.js:main:plus']);
    expect(reads).toEqual(['app/main.js']);
  });

  it('a call in a comment (doc example, line or block comment) is no caller', () => {
    // Same span as main (lines 2-4) in the indexed app/main.js.
    const text = [
      "import { add as plus } from '../lib/math';",
      'export function main() { // plus(9, 9) in a line comment',
      '   * plus(7, 7) on a block-comment line',
      '  return plus(1, 2); }',
    ].join('\n');
    const target = { id: 't', name: 'add', filePath: 'lib/math.js' };
    const callers = findAliasCallers({ db, target, readFileRange: () => text });
    expect(callers.map(c => `${c.filePath}:${c.contextLine}`)).toEqual(['app/main.js:4']);
  });

  it('`//` inside a string literal before the call is no comment', () => {
    const text = [
      "import { add as plus } from '../lib/math';",
      'export function main() {',
      '  return fetch("https://x.test/a", plus(1, 2)); }',
    ].join('\n');
    const target = { id: 't', name: 'add', filePath: 'lib/math.js' };
    const callers = findAliasCallers({ db, target, readFileRange: () => text });
    expect(callers.map(c => `${c.filePath}:${c.contextLine}`)).toEqual(['app/main.js:3']);
  });

  it('a target in a language without alias forms reads nothing', () => {
    const reads = [];
    expect(findAliasCallers({ db, target: { id: 'p', name: 'add', filePath: 'py/tool.py' }, readFileRange: reader(reads) })).toEqual([]);
    expect(reads).toEqual([]);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { CallSiteScanner } from '../../core/graph/call-site-scanner.js';
import { getLanguageByPath } from '../../core/infrastructure/language-patterns.js';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets } from '../../core/graph/relationship-resolver.js';
import { createImportResolver } from '../../core/graph/import-resolver.js';

function scan(file, src) {
  const sc = new CallSiteScanner(getLanguageByPath(file));
  const out = [];
  src.split('\n').forEach((l, i) => sc.scanLine(l, t => out.push(`${i + 1}:${t}`), n => out.push(`${i + 1}:bare ${n}`), () => false));
  return out;
}

describe('call-site scanner — calls through a local alias of a member', () => {
  it('Python: `f = a.b.member` then `f(...)` calls b.member (tortoise _generate_filters)', () => {
    expect(scan('m.py', [
      'def gen(self):',
      '    get_f = self.db.executor_class.get_overridden_filter_func',
      '    op = get_f(filter_func=1)',
    ].join('\n'))).toEqual(['3:executor_class.get_overridden_filter_func']);
  });

  it('Go method value and JS member reference', () => {
    expect(scan('d.go', '\tf := n.calculateSnapshot\n\tsnap, err := f(0, 1, 2)')).toEqual(['2:n.calculateSnapshot']);
    expect(scan('h.js', 'const h = this.handlers.onClose;\nh(evt);')).toEqual(['2:handlers.onClose']);
  });

  it('a call result, a reassignment or a distant use is no alias', () => {
    expect(scan('h.js', 'const x = a.b(c);\nx(1);')).toEqual(['1:a.b', '2:bare x']);
    expect(scan('d.go', '\tf := n.calc\n\tf = other\n\tf(1)')).toEqual(['3:bare f']);
    const far = ['f = obj.run', ...Array(90).fill('pass'), 'f()'].join('\n');
    expect(scan('m.py', far)).toEqual(['92:bare f']);
  });

  it('an alias ends at the next function and a self-rebinding is none', () => {
    expect(scan('a.swift', [
      'func filter(_ p: X) -> Self {',
      '    let q = p.sqlExpression',
      '}',
      'func other(_ q: (Int) -> Int) {',
      '    q(1)',
      '}',
    ].join('\n'))).toEqual(['5:bare q']);
    expect(scan('a.swift', 'let predicate = predicate.sqlExpression\npredicate(1)')).toEqual(['2:bare predicate']);
  });

  it('a plain value read never becomes a call', () => {
    expect(scan('m.py', 'x = config.timeout\ny = x * 2')).toEqual([]);
  });
});

describe('graph: the aliased call is a calls edge to the method', () => {
  let root;
  let db;
  const FILES = {
    'pkg/executor.py': [
      'class BaseExecutor:',
      '    @classmethod',
      '    def get_overridden_filter_func(cls, filter_func):',
      '        return None',
    ],
    'pkg/models.py': [
      'class MetaInfo:',
      '    def _generate_filters(self):',
      '        get_overridden_filter_func = self.db.executor_class.get_overridden_filter_func',
      '        for key in self._filters:',
      '            op = get_overridden_filter_func(filter_func=key)',
    ],
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'ss-local-alias-'));
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

  it('_generate_filters calls BaseExecutor.get_overridden_filter_func', () => {
    const rows = db.prepare(`
      SELECT s.name AS src, t.name AS tgt, t.file_path AS file FROM relationships r
      JOIN entities s ON s.id = r.source_id JOIN entities t ON t.id = r.target_id
      WHERE r.type = 'calls'`).all();
    expect(rows).toContainEqual({ src: '_generate_filters', tgt: 'get_overridden_filter_func', file: 'pkg/executor.py' });
  });
});

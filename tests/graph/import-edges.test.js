/**
 * GraphExtractor `importsFile` edges, annotated legacy `imports` rows, and the
 * `imports` branch of the relationship resolver.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import Database from 'better-sqlite3';
import { createImportResolver, buildFileImportMap, UNRESOLVED_IMPORT_PREFIX } from '../../core/graph/import-resolver.js';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets } from '../../core/graph/relationship-resolver.js';

describe('GraphExtractor importsFile edges and imports resolution', () => {
  const files = {
    'src/a.ts': "import { helper } from './lib/helper';\nimport React from 'react';\nexport function run() { return helper(); }",
    'src/lib/helper.ts': 'export function helper() { return 1; }',
    'src/main.py': 'import os\nfrom .util import Tool\n',
    'src/util.py': 'class Tool:\n    pass\n',
    'src/__init__.py': '',
    'conf/ci.yml': 'os:\n  - linux\n',
  };
  const resolver = createImportResolver({ projectRoot: '/repo', files: Object.keys(files) });

  async function build(extractorOpts) {
    const extractor = new GraphExtractor({ useTreeSitter: false, ...extractorOpts });
    const entities = [];
    const relationships = [];
    for (const [f, text] of Object.entries(files)) {
      const r = await extractor.extractFromFile(f, text);
      entities.push(...r.entities);
      relationships.push(...r.relationships);
    }
    entities.push({ id: 'yaml-os', file_path: 'conf/ci.yml', type: 'key', name: 'os', start_line: 1, end_line: 1 });
    return { extractor, entities, relationships };
  }

  it('without a resolver, extraction is unchanged (no importsFile rows)', async () => {
    const { relationships } = await build({});
    expect(relationships.some((r) => r.type === 'importsFile')).toBe(false);
  });

  it('adds importsFile edges and annotates legacy rows; legacy names unchanged', async () => {
    const plain = await build({});
    const { relationships } = await build({ importResolver: resolver });
    const legacy = (rels) => rels.filter((r) => r.type === 'imports').map((r) => r.target_name).sort();
    expect(legacy(relationships)).toEqual(legacy(plain.relationships));

    const edges = relationships.filter((r) => r.type === 'importsFile').map((r) => [r.target_name, r.full_import_path]);
    expect(edges).toEqual(expect.arrayContaining([['src/lib/helper.ts', './lib/helper'], ['src/util.py', '.util']]));
    const reactRow = relationships.find((r) => r.type === 'imports' && r.target_name === 'react');
    expect(reactRow.full_import_path).toBe(`${UNRESOLVED_IMPORT_PREFIX}react`);
  });

  it('resolver: no name guesses for unresolved modules or into config files', async () => {
    const { extractor, entities, relationships } = await build({ importResolver: resolver });
    const db = new Database(':memory:');
    const hasFts = createGraphSchema(db);
    const log = console.log;
    console.log = () => {};
    try {
      insertGraph(db, entities, relationships, hasFts, { syncFts: false });
      resolveRelationshipTargets(db);
    } finally {
      console.log = log;
    }
    const osRow = db.prepare("SELECT target_id FROM relationships WHERE type='imports' AND target_name='os'").get();
    expect(osRow.target_id).toBeNull();
    const fileMap = buildFileImportMap(db, (p) => extractor.makeId(p, 'file', path.basename(p)));
    expect([...fileMap.get('src/a.ts')]).toEqual(['src/lib/helper.ts']);
    db.close();
  });
});

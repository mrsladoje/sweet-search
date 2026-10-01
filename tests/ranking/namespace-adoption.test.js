/**
 * Search-time entity adoption never uses a namespace/module wrapper or an
 * owning class as the label or range of a chunk that holds a type or a
 * method (drogon replay r3hb-drogon-10).
 *
 * The chunker starts a class-header chunk on the `namespace drogon {` line.
 * The tightest enclosing entity of that chunk is the namespace, and adoption
 * printed `HttpViewData.h:29-175 [namespace: drogon]` for the 29-50 class
 * header (create_model.h: 29-53 widened to 29-442). A C# `77-146 method:Get14`
 * chunk became `[class: Store] 5-207`, and C++ `function:null` member chunks
 * took the whole class span.
 *
 * Agent format only (the second demotion pass reads the adopted label and
 * range); other formats keep the earlier behaviour.
 */
import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import { CodeGraphRepository } from '../../core/infrastructure/code-graph-repository.js';
import { applyResultDemotions } from '../../core/ranking/file-kind-ranking.js';

const roots = [];
const repos = [];
afterAll(() => {
  for (const repo of repos) repo.close?.();
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

const FILES = {
  'lib/HttpViewData.h': [
    '#pragma once',              // 1
    '#include <string>',         // 2
    '',                          // 3
    'namespace drogon {',        // 4
    'class HttpViewData',        // 5
    '{',                         // 6
    '  public:',                 // 7
    '    int get() const',       // 8
    '    {',                     // 9
    '        return 1;',         // 10
    '    }',                     // 11
    '    void insert(int v)',    // 12
    '    {',                     // 13
    '        v_ = v;',           // 14
    '    }',                     // 15
    '  private:',                // 16
    '    int v_;',               // 17
    '};',                        // 18
    '}',                         // 19
  ],
  'src/Store.cs': [
    'namespace App',             // 1
    '{',                         // 2
    '    public class Store',    // 3
    '    {',                     // 4
    '        public int Get14()', // 5
    '        {',                 // 6
    '            return 14;',    // 7
    '        }',                 // 8
    '        public void Put()', // 9
    '        {',                 // 10
    '        }',                 // 11
    '    }',                     // 12
    '}',                         // 13
  ],
  'lib/store.rb': [
    'module App',                // 1
    '  class Store',             // 2
    '    def get',               // 3
    '      1',                   // 4
    '    end',                   // 5
    '  end',                     // 6
    'end',                       // 7
    'module Mixin',              // 8
    '  def helper',              // 9
    '    2',                     // 10
    '  end',                     // 11
    '  def other',               // 12
    '    3',                     // 13
    '  end',                     // 14
    'end',                       // 15
  ],
  'src/app.ts': [
    'export namespace App {',           // 1
    '  export class Store {',           // 2
    '    get(): number { return 1; }',  // 3
    '  }',                              // 4
    '}',                                // 5
    'namespace Util {',                 // 6
    '  export function f() {',          // 7
    '    return 1;',                    // 8
    '  }',                              // 9
    '  export const x = 1;',            // 10
    '}',                                // 11
  ],
};

let repoPromise = null;
function graphRepo() {
  repoPromise ??= (async () => {
    const root = mkdtempSync(join(tmpdir(), 'ss-ns-adopt-'));
    roots.push(root);
    const extractor = new GraphExtractor({ projectRoot: root });
    const entities = [];
    for (const [rel, lines] of Object.entries(FILES)) {
      const out = await extractor.extractFromFile(rel, lines.join('\n'));
      entities.push(...out.entities);
    }
    const dbPath = join(root, 'code-graph.db');
    const db = new Database(dbPath);
    const fts = createGraphSchema(db);
    const log = console.log;
    console.log = () => {};
    try {
      insertGraph(db, entities, [], fts, { syncFts: true });
    } finally {
      console.log = log;
    }
    db.close();
    const repo = new CodeGraphRepository(dbPath);
    repos.push(repo);
    return repo;
  })();
  return repoPromise;
}

async function adopt(file, startLine, endLine, type, name, format = 'agent') {
  const repo = await graphRepo();
  const chunk = {
    file,
    startLine,
    endLine,
    score: 0.5,
    metadata: { file, startLine, endLine, type, name },
  };
  const [out] = applyResultDemotions([chunk], {
    query: 'how is the stored value read',
    codeGraphRepo: repo,
    format,
  });
  return {
    range: `${out.metadata.startLine}-${out.metadata.endLine}`,
    label: `${out.metadata.type}:${out.metadata.name}`,
  };
}

describe('entity adoption — namespace/module wrappers (agent format)', () => {
  it('C++: a chunk that starts on `namespace x {` and holds a class header takes the class label, not the namespace span', async () => {
    expect(await adopt('lib/HttpViewData.h', 4, 11, 'namespace', 'drogon'))
      .toEqual({ range: '4-11', label: 'class:HttpViewData' });
  });

  it('C++: other formats keep the earlier adoption (format gate)', async () => {
    expect(await adopt('lib/HttpViewData.h', 4, 11, 'namespace', 'drogon', null))
      .toEqual({ range: '4-19', label: 'namespace:drogon' });
  });

  it('C#: `namespace App { class Store` header chunk takes the class label', async () => {
    expect(await adopt('src/Store.cs', 1, 6, 'namespace', 'App'))
      .toEqual({ range: '1-6', label: 'class:Store' });
  });

  it('Ruby: a `module` wrapping a class yields to the class; never widens', async () => {
    expect(await adopt('lib/store.rb', 1, 4, 'module', 'App'))
      .toEqual({ range: '1-4', label: 'class:Store' });
  });

  it('Ruby: a mixin module holding only methods keeps its module label, chunk range kept', async () => {
    expect(await adopt('lib/store.rb', 9, 14, 'code', null))
      .toEqual({ range: '9-14', label: 'module:Mixin' });
  });

  it('TS: `export namespace App { export class Store` takes the class label', async () => {
    expect(await adopt('src/app.ts', 1, 3, 'namespace', 'App'))
      .toEqual({ range: '1-3', label: 'class:Store' });
  });

  it('TS: a namespace chunk with no type takes its first function, never the namespace span', async () => {
    expect(await adopt('src/app.ts', 7, 10, 'code', null))
      .toEqual({ range: '7-10', label: 'function:f' });
  });
});

describe('entity adoption — methods inside a class (agent format)', () => {
  it('C#: a named method chunk keeps its own label and range (not `[class: Store]` over the class span)', async () => {
    expect(await adopt('src/Store.cs', 5, 11, 'method', 'Get14'))
      .toEqual({ range: '5-11', label: 'method:Get14' });
    // Earlier behaviour, still the one outside agent format.
    expect(await adopt('src/Store.cs', 5, 11, 'method', 'Get14', null))
      .toEqual({ range: '3-12', label: 'class:Store' });
  });

  it('C++: an unnamed function chunk inside a class takes its first method, not the class span', async () => {
    expect(await adopt('lib/HttpViewData.h', 8, 15, 'function', null))
      .toEqual({ range: '8-15', label: 'method:get' });
  });

  it('a fragment of one function still expands to that function (da97c273)', async () => {
    expect(await adopt('lib/HttpViewData.h', 9, 10, 'code', null))
      .toEqual({ range: '8-11', label: 'method:get' });
  });
});

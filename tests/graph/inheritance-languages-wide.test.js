/**
 * Wider inheritance coverage (Elixir @behaviour, Julia `<:`, F# inherit /
 * `interface … with`) and override edges across the languages whose
 * inheritance the graph already extracts.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

let GraphExtractor;
let createGraphSchema;
let insertGraph;
let resolveRelationshipTargets;
let resetTreeSitterProvider;

beforeAll(async () => {
  ({ GraphExtractor, createGraphSchema, insertGraph } = await import('../../core/graph/graph-extractor.js'));
  ({ resolveRelationshipTargets } = await import('../../core/graph/relationship-resolver.js'));
  ({ resetTreeSitterProvider } = await import('../../core/infrastructure/tree-sitter-provider.js'));
});

afterAll(() => {
  if (resetTreeSitterProvider) resetTreeSitterProvider();
});

let originalLog;
beforeEach(() => { originalLog = console.log; console.log = () => {}; });
afterEach(() => { console.log = originalLog; });

async function build(files) {
  const db = new Database(':memory:');
  const hasFts5 = createGraphSchema(db);
  const ex = new GraphExtractor();
  const ents = [];
  const rels = [];
  for (const [filePath, content] of Object.entries(files)) {
    const r = await ex.extractFromFile(filePath, content);
    ents.push(...r.entities);
    rels.push(...r.relationships);
  }
  insertGraph(db, ents, rels, hasFts5, { syncFts: false });
  resolveRelationshipTargets(db);
  return db;
}

function linked(db, types) {
  return db.prepare(`
    SELECT r.type, s.name AS src, t.name AS dst
    FROM relationships r JOIN entities s ON s.id = r.source_id JOIN entities t ON t.id = r.target_id
    WHERE r.type IN (${types.map(() => '?').join(',')}) ORDER BY r.type, src, dst
  `).all(...types).map(r => `${r.type} ${r.src}->${r.dst}`);
}

describe('new inheritance patterns', () => {
  it('Elixir: @behaviour links the module to the behaviour module', async () => {
    const db = await build({
      'lib/my_plug.ex': 'defmodule MyApp.Plug do\n  @callback call(term) :: term\nend\n',
      'lib/auth.ex': 'defmodule MyApp.Auth do\n  @behaviour MyApp.Plug\n  def call(conn), do: conn\nend\n',
    });
    expect(linked(db, ['implements'])).toEqual(['implements MyApp.Auth->MyApp.Plug']);
    db.close();
  });

  it('Julia: struct <: abstract type', async () => {
    const db = await build({
      'src/shapes.jl': 'struct Shape end\nstruct Circle <: Shape\n  r::Float64\nend\n',
    });
    expect(linked(db, ['extends'])).toEqual(['extends Circle->Shape']);
    db.close();
  });

  it('F#: inherit and interface … with', async () => {
    const ex = new GraphExtractor();
    const { relationships } = await ex.extractFromFile('src/Log.fs', [
      'type Logger(name: string) =',
      '    inherit BaseLogger(name)',
      '    interface IDisposable with',
      '        member this.Dispose() = ()',
    ].join('\n'));
    const got = relationships.filter(r => r.type === 'extends' || r.type === 'implements').map(r => `${r.type} ${r.target_name}`);
    expect(got).toEqual(['extends BaseLogger', 'implements IDisposable']);
  });
});

describe('override edges across languages', () => {
  it.each([
    // Abstract / interface method signatures are not graph entities (no
    // body), so only a concrete base method can be a target.
    ['TypeScript', {
      'src/base.ts': 'export class Repo {\n  find(id: string): Item { return null; }\n}\n',
      'src/sql.ts': "import { Repo } from './base';\nexport class SqlRepo extends Repo {\n  find(id: string): Item { return null; }\n}\n",
    }, ['overrides find->find']],
    ['Python', {
      'pkg/base.py': 'class View:\n    def dispatch(self, req):\n        pass\n',
      'pkg/views.py': 'from .base import View\n\nclass ListView(View):\n    def dispatch(self, req):\n        return 1\n',
    }, ['overrides dispatch->dispatch']],
    ['PHP', {
      'src/Handler.php': '<?php\ninterface Handler {\n    public function handle($x);\n}\n',
      'src/Log.php': '<?php\nclass LogHandler implements Handler {\n    public function handle($x) { return $x; }\n}\n',
    }, ['overrides handle->handle']],
    ['C#', {
      'src/IRepo.cs': 'public interface IRepo {\n    void Save(int x);\n}\n',
      'src/Repo.cs': 'public class Repo : IRepo {\n    public void Save(int x) { }\n}\n',
    }, ['overrides Save->Save']],
    ['Rust', {
      'src/lib.rs': [
        'pub trait Shape {',
        '    fn area(&self) -> f64;',
        '}',
        'pub struct Square { s: f64 }',
        'impl Shape for Square {',
        '    fn area(&self) -> f64 { self.s * self.s }',
        '}',
      ].join('\n'),
    }, ['overrides area->area']],
  ])('%s', async (_lang, files, expected) => {
    const db = await build(files);
    expect(linked(db, ['overrides'])).toEqual(expected);
    db.close();
  });
});

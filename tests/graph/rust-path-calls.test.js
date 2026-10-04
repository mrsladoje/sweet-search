/**
 * Rust path calls into a repo module (graph-extractor annotateRustPathCalls,
 * relationship-resolver resolveRustPathCall).
 *
 * serde_json tests call `serde_json::from_str(…)`: the crate's own name as a
 * path. `from_str` is also a method of Deserializer, Number, Value and Map, so
 * name matching found several owners and left the call unresolved — ss-trace
 * showed no test callers of the crate's main entry point. A snake_case path
 * names a module (types are CamelCase), so the call binds to a free function
 * of that module, or of its crate when the module re-exports it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets } from '../../core/graph/relationship-resolver.js';
import { createImportResolver } from '../../core/graph/import-resolver.js';

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

async function buildGraph(files) {
  const root = mkdtempSync(join(tmpdir(), 'ss-rust-path-'));
  roots.push(root);
  for (const [rel, lines] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, lines.join('\n'));
  }
  const all = Object.keys(files);
  const sources = all.filter((f) => f.endsWith('.rs'));
  const extractor = new GraphExtractor({ importResolver: createImportResolver({ projectRoot: root, files: all }) });
  const entities = [];
  const relationships = [];
  const callSites = [];
  const fileNodes = [];
  for (const rel of sources) {
    const out = await extractor.extractFromFile(rel, files[rel].join('\n'));
    entities.push(...out.entities);
    relationships.push(...out.relationships);
    callSites.push(...(out.callSites || []));
    if (out.file) fileNodes.push(out.file);
  }
  const db = new Database(join(root, 'code-graph.db'));
  const fts = createGraphSchema(db);
  const log = console.log;
  console.log = () => {};
  try {
    insertGraph(db, entities, relationships, fts, { syncFts: true, callSites, files: fileNodes });
    resolveRelationshipTargets(db);
  } finally {
    console.log = log;
  }
  const rows = db.prepare(`
    SELECT r.target_name, t.file_path, t.parent_class, t.start_line
    FROM relationships r JOIN entities s ON s.id = r.source_id
    LEFT JOIN entities t ON t.id = r.target_id
    WHERE r.type = 'calls' AND s.name = ?
  `);
  const out = (caller) => Object.fromEntries(rows.all(caller).map((r) => [r.target_name,
    r.file_path ? `${r.file_path}${r.parent_class ? `#${r.parent_class}` : ''}:${r.start_line}` : null]));
  return { out, close: () => db.close() };
}

const CRATE = {
  'Cargo.toml': ['[package]', 'name = "serde_json"', 'version = "1.0.0"'],
  'src/lib.rs': ['pub mod de;', 'pub mod value;', 'pub use crate::de::from_str;'],
  'src/de.rs': [
    'pub struct Deserializer {}',
    'impl Deserializer {',
    '    pub fn from_str(s: &str) -> Self { Deserializer {} }',
    '}',
    'pub fn from_str(s: &str) -> u32 {',
    '    0',
    '}',
  ],
  'src/value.rs': [
    'pub struct Value {}',
    'impl Value {',
    '    pub fn from_str(s: &str) -> Self { Value {} }',
    '}',
  ],
};

describe('Rust path calls bind to a free function of the named module', () => {
  it('`crate_name::f()` from a test crate reaches the re-exported free function, not a method', async () => {
    const g = await buildGraph({
      ...CRATE,
      'tests/test.rs': [
        'fn test_parse() {',
        '    let v: u32 = serde_json::from_str("1").unwrap();',
        '    let d = serde_json::de::from_str("2");',
        '}',
      ],
    });
    expect(g.out('test_parse')).toMatchObject({
      'serde_json.from_str': 'src/de.rs:5',
      'de.from_str': 'src/de.rs:5',
    });
    g.close();
  });

  it('`crate::m::f()` and `self::f()` inside the crate', async () => {
    const g = await buildGraph({
      ...CRATE,
      'src/value.rs': [
        ...CRATE['src/value.rs'],
        'pub fn parse(s: &str) -> u32 {',
        '    crate::de::from_str(s)',
        '}',
        'fn helper() -> u32 { self::parse("x") }',
      ],
    });
    expect(g.out('parse')['de.from_str']).toBe('src/de.rs:5');
    expect(g.out('helper')['self.parse']).toBe('src/value.rs:5');
    g.close();
  });

  it('a CamelCase path is a type: `Value::from_str` stays the method', async () => {
    const g = await buildGraph({
      ...CRATE,
      'tests/test.rs': [
        'use serde_json::value::Value;',
        'fn test_value() {',
        '    let v = Value::from_str("1");',
        '}',
      ],
    });
    expect(g.out('test_value')['Value.from_str']).toBe('src/value.rs#Value:3');
    g.close();
  });

  it('a path into another crate or std gets no edge to a repo namesake', async () => {
    const g = await buildGraph({
      ...CRATE,
      'tests/test.rs': [
        'fn test_ext() {',
        '    let a = other_crate::from_str("1");',
        '    let b = std::str::from_utf8(&[]);',
        '}',
      ],
    });
    const out = g.out('test_ext');
    expect(out['other_crate.from_str'] ?? null).toBeNull();
    g.close();
  });
});

/**
 * Go package-qualified calls (`pkg.Func()` where `pkg` is an import name).
 *
 * dgraph replay: `x.Parse(key)` stayed unresolved (x/keys.go Parse and the
 * method WorkerOptions.Parse in x/config.go both matched the name), and
 * `glog.Errorf` — the third-party github.com/golang/glog — bound to the
 * in-repo method ToGlog.Errorf, which then listed every glog.Errorf call in
 * the repo as its caller (92 false callers). In Go a package-qualified call
 * reaches only a top-level function of that package; a non-repo package has
 * no local target.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { GraphExtractor, createGraphSchema, goNameShadowed, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets } from '../../core/graph/relationship-resolver.js';
import { createImportResolver } from '../../core/graph/import-resolver.js';
import { goImportName, scanImports } from '../../core/graph/import-scanner.js';
import { StructuralContextBuilder, formatStructuralContext } from '../../core/graph/structural-context.js';
import { StructuralContextRepository } from '../../core/infrastructure/structural-context-repository.js';
import { formatTraceCompact } from '../../core/search/agent-output-fixes.js';

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

async function buildGraph(files) {
  const root = mkdtempSync(join(tmpdir(), 'ss-go-pkg-'));
  roots.push(root);
  for (const [rel, lines] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, lines.join('\n'));
  }
  const sources = Object.keys(files).filter((f) => f.endsWith('.go'));
  const extractor = new GraphExtractor({ importResolver: createImportResolver({ projectRoot: root, files: sources }) });
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
  const dbPath = join(root, 'code-graph.db');
  const db = new Database(dbPath);
  const fts = createGraphSchema(db);
  const log = console.log;
  console.log = () => {};
  try {
    insertGraph(db, entities, relationships, fts, { syncFts: true, callSites, files: fileNodes });
    resolveRelationshipTargets(db);
  } finally {
    console.log = log;
  }
  db.close();
  return { root, dbPath };
}

/** caller name → { target_name: resolved file or null } for its `calls` rows. */
function callTargets(dbPath, caller) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare(`
      SELECT r.target_name, t.file_path, t.name, t.parent_class FROM relationships r
      JOIN entities s ON s.id = r.source_id
      LEFT JOIN entities t ON t.id = r.target_id
      WHERE s.name = ? AND r.type = 'calls'
    `).all(caller);
    return Object.fromEntries(rows.map((r) => [r.target_name, r.file_path ? `${r.file_path}#${r.parent_class ? `${r.parent_class}.` : ''}${r.name}` : null]));
  } finally {
    db.close();
  }
}

function trace({ root, dbPath }, symbol, options = {}) {
  const builder = new StructuralContextBuilder({ projectRoot: root, graphDbPath: dbPath });
  try {
    return builder.build(symbol, options);
  } finally {
    builder.close();
  }
}

const MODULE = 'example.com/app';
const REPO = {
  'go.mod': [`module ${MODULE}`, '', 'go 1.22'],
  'engine.go': ['package app', '', 'func New() *Engine {', '\treturn &Engine{}', '}', '', 'type Engine struct{}'],
  'x/keys.go': ['package x', '', 'func Parse(key []byte) (int, error) {', '\treturn len(key), nil', '}'],
  'x/config.go': [
    'package x',
    '',
    'type WorkerOptions struct{}',
    '',
    'func (w *WorkerOptions) Parse(conf string) {',
    '}',
  ],
  'x/log.go': [
    'package x',
    '',
    'type ToGlog struct{}',
    '',
    'func (rl *ToGlog) Errorf(format string, v ...interface{}) {',
    '}',
  ],
  'x/open_linux.go': ['package x', '', 'func Open() error {', '\treturn nil', '}'],
  'x/open_windows.go': ['package x', '', 'func Open() error {', '\treturn nil', '}'],
  'x/sub/parse.go': ['package sub', '', 'func Parse() {', '}'],
  'util/errors.go': ['package util', '', 'func Errorf(format string) error {', '\treturn nil', '}', '', 'func EncodeToString(b []byte) string {', '\treturn ""', '}'],
  'worker/draft.go': [
    'package worker',
    '',
    'import (',
    '\t"encoding/hex"',
    '',
    '\t"github.com/golang/glog"',
    '',
    `\tapp "${MODULE}"`,
    `\t"${MODULE}/x"`,
    `\tkeys "${MODULE}/x"`,
    ')',
    '',
    'func detectPending(key []byte) error {',
    '\tif _, err := x.Parse(key); err != nil {',
    '\t\tglog.Errorf("parse %v", err)',
    '\t\treturn errorOf(hex.EncodeToString(key))',
    '\t}',
    '\tkeys.Parse(key)',
    '\tx.Open()',
    '\tapp.New()',
    '\treturn nil',
    '}',
  ],
};

describe('Go import names', () => {
  it('scans the explicit package name of an import', () => {
    const out = scanImports(['import (', '\tpb "example.com/app/protos/pb"', '\t_ "net/http/pprof"', '\t. "math"', '\t"fmt"', ')', 'import y "example.com/y"'].join('\n'), 'go');
    expect(out.map((i) => [i.spec, i.alias ?? null])).toEqual([
      ['example.com/app/protos/pb', 'pb'],
      ['net/http/pprof', '_'],
      ['math', '.'],
      ['fmt', null],
      ['example.com/y', 'y'],
    ]);
  });

  it('derives the package name by the Go path convention', () => {
    const name = (spec, alias) => goImportName({ spec, alias });
    expect(name('github.com/golang/glog')).toBe('glog');
    expect(name('go.etcd.io/etcd/raft/v3')).toBe('raft');
    expect(name('gopkg.in/yaml.v3')).toBe('yaml');
    expect(name('github.com/dustin/go-humanize')).toBe('humanize');
    expect(name('github.com/opentracing/opentracing-go')).toBe('opentracing');
    expect(name('example.com/app/x', 'keys')).toBe('keys');
    expect(name('net/http/pprof', '_')).toBeNull();
    expect(name('math', '.')).toBeNull();
  });
});

describe('Go package-qualified calls', () => {
  it('bind only a top-level function of the imported repo package; non-repo packages get no target', async () => {
    const g = await buildGraph(REPO);
    expect(callTargets(g.dbPath, 'detectPending')).toEqual({
      // The function in x/, not the method WorkerOptions.Parse, not x/sub.
      'x.Parse': 'x/keys.go#Parse',
      // Aliased import of the same package.
      'keys.Parse': 'x/keys.go#Parse',
      // Build-tag variants: one function.
      'x.Open': expect.stringMatching(/^x\/open_(linux|windows)\.go#Open$/),
      // Module root package at the repo root.
      'app.New': 'engine.go#New',
      // Third-party and standard-library packages: never an in-repo namesake.
      'glog.Errorf': null,
      'hex.EncodeToString': null,
    });
  });

  it('ss-trace lists the package callee and no false callers of a same-named method', async () => {
    const g = await buildGraph(REPO);
    const callees = trace(g, 'detectPending', { mode: 'callees' });
    const compact = formatTraceCompact(callees, { mode: 'callees' });
    expect(compact).toContain('Parse [function] x/keys.go:3 call@14,18');
    expect(compact).toContain('New [function] engine.go:3 call@20');
    expect(compact).not.toContain('x/log.go');
    expect(formatStructuralContext(callees, { mode: 'callees' })).not.toContain('Errorf [method]');

    // ToGlog.Errorf is called by no one: `glog.Errorf` is the third-party package.
    const errorf = trace(g, 'Errorf', { filePath: 'x/log.go', mode: 'callers' });
    expect(errorf.target.filePath).toBe('x/log.go');
    expect(errorf.sections.callers.items).toEqual([]);
    // util.Errorf / util.EncodeToString are top-level functions of another
    // package: no caller either.
    const utilErrorf = trace(g, 'Errorf', { filePath: 'util/errors.go', mode: 'callers' });
    expect(utilErrorf.sections.callers.items).toEqual([]);
    const encode = trace(g, 'EncodeToString', { filePath: 'util/errors.go', mode: 'callers' });
    expect(encode.sections.callers.items).toEqual([]);
    // x.Parse's caller is found by the resolved edge.
    const parse = trace(g, 'Parse', { filePath: 'x/keys.go', mode: 'callers' });
    expect(parse.sections.callers.items.map((i) => i.summary)).toEqual(['detectPending [function] worker/draft.go:13 call@14,18']);
  });

  it('a package-level var initializer is the caller; the package rule still decides its target', async () => {
    // gin `var engine = gin.Default()`: the var entity is the call source (not
    // the file node), bound only to the imported package's top-level function.
    // A var of the same name in another package (y.New) never takes the call,
    // and a third-party initializer (glog.New) binds nothing.
    const g = await buildGraph({
      ...REPO,
      'y/state.go': ['package y', '', '// New is a counter, not a constructor.', 'var New = 0'],
      'worker/vars.go': [
        'package worker',
        '',
        'import (',
        '\t"github.com/golang/glog"',
        '',
        `\tapp "${MODULE}"`,
        ')',
        '',
        '// engine serves every worker route.',
        'var engine = app.New()',
        '',
        'var logger = glog.New()',
      ],
    });
    expect(callTargets(g.dbPath, 'engine')).toEqual({ 'app.New': 'engine.go#New' });
    expect(callTargets(g.dbPath, 'logger')).toEqual({ 'glog.New': null });
    const callers = trace(g, 'New', { filePath: 'engine.go', mode: 'callers' });
    expect(callers.sections.callers.items.map((i) => i.summary).sort()).toEqual([
      'detectPending [function] worker/draft.go:13 call@20',
      'engine [variable] worker/vars.go:10 call@10',
    ]);
    expect(formatStructuralContext(callers, { mode: 'callers' })).not.toContain('(top-level)');
    const yNew = trace(g, 'New', { filePath: 'y/state.go', mode: 'callers' });
    expect(yNew.sections.callers.items).toEqual([]);
  });

  it('leaves a file to the receiver rules when it also uses the import name as a value', async () => {
    // dgraph graphql/resolve/auth_test.go: `schema := test.LoadSchemaFromString(…)`
    // shadows the imported schema package, so `schema.Meta()` is the method.
    const g = await buildGraph({
      'go.mod': [`module ${MODULE}`],
      'graphql/schema/wrappers.go': ['package schema', '', 'type schema struct{}', '', 'func (s *schema) Meta() int {', '\treturn 0', '}', '', 'func Load() *schema {', '\treturn &schema{}', '}'],
      'graphql/resolve/auth_test.go': [
        'package resolve',
        '',
        `import "${MODULE}/graphql/schema"`,
        '',
        'func TestMeta() {',
        '\tschema := schema.Load()',
        '\tschema.Meta()',
        '}',
      ],
    });
    expect(callTargets(g.dbPath, 'TestMeta')).toEqual({
      'schema.Load': 'graphql/schema/wrappers.go#Load',
      'schema.Meta': 'graphql/schema/wrappers.go#schema.Meta',
    });
  });

  it('detects the uses of an import name that the call row cannot tell apart', () => {
    const cases = [
      ['schema := load()\nschema.Meta()', true],
      ['a, schema := load()', true],
      ['for _, schema := range all {', true],
      ['if schema, err := load(); err != nil {', true],
      ['var schema *schema.Schema', true],
      ['func f(schema *schema.Schema) {', true],
      ['func (schema *T) m() {', true],
      ['s.schema.Meta()', true],
      ['func f(s schema.Schema) { schema.Meta() }', false],
      ['import (\n\tschema "example.com/app/schema"\n)\nfunc f() { schema.Meta() }', false],
      ['opts := schema.Options{}\nschema.Meta()', false],
      // A comment that ends in a period is no member access.
      ['\t// Build the meta.\n\tschema.Meta()', false],
      ['\t// Two to be pruned.\n\tschema := load()', true],
      // A chain split across lines is.
      ['s.\n\tschema.Meta()', true],
      // The package in a type position after `var name`.
      ['var CmdAcl schema.SubCommand\nschema.Meta()', false],
    ];
    for (const [src, want] of cases) expect([src, goNameShadowed(src, 'schema')]).toEqual([src, want]);
  });

  it('leaves calls alone when no go.mod covers the file (GOPATH layout)', async () => {
    const { 'go.mod': _ignored, ...gopath } = REPO;
    const g = await buildGraph(gopath);
    const db = new Database(g.dbPath, { readonly: true });
    try {
      const marked = db.prepare("SELECT count(*) AS n FROM relationships WHERE type = 'calls' AND full_import_path IS NOT NULL").get().n;
      expect(marked).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe('call-line reader on an older graph', () => {
  it('a connected reader sees call_lines once a maintainer adds the table', async () => {
    const g = await buildGraph({
      'go.mod': [`module ${MODULE}`],
      'a/a.go': ['package a', '', 'type S struct{}', '', 'func (s *S) Do() {', '}', '', 'func Run(s *S) {', '\ts.Do()', '\ts.Do()', '}'],
    });
    // A graph built before the table existed.
    const writer = new Database(g.dbPath);
    const lines = writer.prepare('SELECT source_id, target_name, context_line, epoch_written FROM call_lines').all();
    expect(lines.map((r) => r.context_line).sort((a, b) => a - b)).toEqual([9, 10]);
    writer.exec('DROP TABLE call_lines');
    const repo = new StructuralContextRepository(g.dbPath, { projectRoot: g.root });
    const run = writer.prepare("SELECT id FROM entities WHERE name = 'Run'").get();
    const target = { id: run.id, name: 'Run' };
    try {
      expect(repo.getCallees(target).map((c) => c.contextLines)).toEqual([[9]]);
      // An upgraded maintainer adds the table to the graph the reader holds open.
      writer.exec('CREATE TABLE call_lines (source_id TEXT NOT NULL, target_name TEXT NOT NULL, context_line INTEGER, epoch_written INTEGER NOT NULL DEFAULT 0, epoch_retired INTEGER)');
      const ins = writer.prepare('INSERT INTO call_lines (source_id, target_name, context_line, epoch_written) VALUES (?, ?, ?, ?)');
      for (const r of lines) ins.run(r.source_id, r.target_name, r.context_line, r.epoch_written);
      expect(repo.getCallees(target).map((c) => c.contextLines)).toEqual([[9, 10]]);
    } finally {
      repo.close?.();
      writer.close();
    }
  });
});

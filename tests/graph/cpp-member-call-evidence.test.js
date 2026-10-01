/**
 * C/C++ member calls on an undeclared receiver need receiver evidence.
 *
 * `auto &val = lookup("k"); val.type()` bound to the one unrelated `type()`
 * method in the repo (drogon_ctl/create_model.h): narrowCallCandidates ran
 * its receiver-evidence filter only with two or more candidates. For C and
 * C++ a `.`/`->` call (the scanner also writes `ns::f(` as `ns.f`) whose
 * receiver is no repo type, not `this` and has no declared type now binds
 * only when the receiver names the owner, a sub- or supertype of it, or the
 * definition's file. Pointer names (`thisPtr`, `modelPtr`, `conn_`) count as
 * what their stem names.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import {
  resolveRelationshipTargets,
  narrowCallCandidates,
  createCallResolutionIndex,
} from '../../core/graph/relationship-resolver.js';

const FILES = {
  'src/Model.h': [
    'class Model {',
    ' public:',
    '  int type() const { return 1; }',
    '  void save() {}',
    '};',
  ],
  'src/Response.h': [
    'class HttpResponse {',
    ' public:',
    '  virtual void setBody(int b) = 0;',
    '};',
    'class HttpResponseImpl : public HttpResponse {',
    ' public:',
    '  void setBody(int b) override { body_ = b; }',
    ' private:',
    '  int body_;',
    '};',
  ],
  'src/use.cc': [
    '#include "Model.h"',
    '#include "Response.h"',
    'void lookupCase() {',
    '  auto &val = lookup("k");',
    '  if (val.type() == typeid(int)) {}',
    '}',
    'void typedParam(const Thing &val) {',
    '  val.type();',
    '}',
    'void declaredModel(Model &item) {',
    '  item.save();',
    '}',
    'void namedReceiver() {',
    '  Model model;',
    '  model.save();',
    '  auto modelPtr = std::make_shared<Model>();',
    '  modelPtr->save();',
    '}',
    'void viaInterface(int x) {',
    '  auto resp = makeResponse();',
    '  resp->setBody(x);',
    '}',
  ],
  'src/Widget.cc': [
    'class Widget {',
    ' public:',
    '  void draw() { this->paint(); }',
    '  void paint() {}',
    '  void later() {',
    '    auto thisPtr = shared_from_this();',
    '    thisPtr->paint();',
    '  }',
    '};',
  ],
  'src/pool.c': [
    'void release(void *p) {}',
    'void run(struct ctx *c) {',
    '  c->release(c);',
    '}',
  ],
};

let root;
let edges;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'ss-cpp-evidence-'));
  const extractor = new GraphExtractor({ projectRoot: root });
  const entities = [];
  const relationships = [];
  const callSites = [];
  for (const [rel, lines] of Object.entries(FILES)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, lines.join('\n'));
    const out = await extractor.extractFromFile(rel, lines.join('\n'));
    entities.push(...out.entities);
    relationships.push(...out.relationships);
    if (out.callSites) callSites.push(...out.callSites);
  }
  const db = new Database(join(root, 'code-graph.db'));
  const fts = createGraphSchema(db);
  const log = console.log;
  console.log = () => {};
  try {
    insertGraph(db, entities, relationships, fts, { syncFts: true, callSites });
    resolveRelationshipTargets(db);
  } finally {
    console.log = log;
  }
  edges = new Map();
  for (const row of db.prepare(`
    SELECT s.name AS src, r.target_name AS tn, t.name AS tname, t.file_path AS tfile
    FROM relationships r
    JOIN entities s ON s.id = r.source_id
    LEFT JOIN entities t ON t.id = r.target_id
    WHERE r.type = 'calls'
  `).all()) {
    edges.set(`${row.src}:${row.tn}`, row.tname ? `${row.tname}@${row.tfile}` : null);
  }
  db.close();
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

const target = (src, tn) => {
  const key = `${src}:${tn}`;
  expect(edges.has(key), `no ${tn} call recorded in ${src}`).toBe(true);
  return edges.get(key);
};

describe('C/C++ member calls — receiver evidence', () => {
  it('a local of unknown type does not bind to the one unrelated same-named method', () => {
    expect(target('lookupCase', 'val.type')).toBeNull();
  });

  it('a C function-pointer member call does not bind to a same-named free function', () => {
    expect(target('run', 'c.release')).toBeNull();
  });

  it('a typed parameter of a type the repo does not define stays unresolved', () => {
    expect(target('typedParam', 'val.type')).toBeNull();
  });

  it('a declared parameter type keeps resolving to its method', () => {
    expect(target('declaredModel', 'item.save')).toBe('save@src/Model.h');
  });

  it('a receiver that names the owner, or a pointer to it, keeps resolving', () => {
    expect(target('namedReceiver', 'model.save')).toBe('save@src/Model.h');
    expect(target('namedReceiver', 'modelPtr.save')).toBe('save@src/Model.h');
  });

  it('a receiver that names a base type reaches the implementation', () => {
    expect(target('viaInterface', 'resp.setBody')).toBe('setBody@src/Response.h');
  });

  it('`this->f()` and `thisPtr->f()` keep resolving to the own class', () => {
    expect(target('draw', 'this.paint')).toBe('paint@src/Widget.cc');
    expect(target('later', 'thisPtr.paint')).toBe('paint@src/Widget.cc');
  });
});

describe('narrowCallCandidates — one candidate', () => {
  const method = (id, name, file, start, end, extra = {}) => ({
    id, name, type: 'method', file_path: file, start_line: start, end_line: end, parent_class: null, signature: '', ...extra,
  });
  const cls = { id: 'cls', name: 'ColumnInfo', type: 'class', file_path: 'drogon_ctl/create_model.h', start_line: 300, end_line: 320 };
  const typeFn = method('t', 'type', 'drogon_ctl/create_model.h', 307, 310);
  const index = createCallResolutionIndex([cls, typeFn]);

  it('C++: needs evidence even with one candidate', () => {
    const caller = method('c', 'run', 'lib/src/Handler.cc', 1, 9, { type: 'function' });
    expect(narrowCallCandidates([typeFn], 'val', caller, index)).toEqual([]);
    expect(narrowCallCandidates([typeFn], 'columnInfo', caller, index).map(c => c.id)).toEqual(['t']);
  });

  it('other languages keep the one-candidate rule (unchanged)', () => {
    const caller = method('j', 'run', 'src/Handler.java', 1, 9);
    expect(narrowCallCandidates([typeFn], 'val', caller, index).map(c => c.id)).toEqual(['t']);
  });
});

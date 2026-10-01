/**
 * Qualified-call resolution links only on evidence (review of the calls work).
 *
 * After receiver narrowing, several unrelated owners used to fall to a
 * same-file / non-test / nearest-directory tie-break — a guess. Sampled on
 * GRDB, okhttp and gin, 13 of 18 such picks were wrong (`array.map` →
 * ValueObservation.map, `socket.connect` → RealWebSocket.connect, `c.String`
 * → a protobuf enum). Now the target set must be one type's methods
 * (overloads); evidence that can decide: the receiver names the owner in
 * full, names a subtype of it, its declared type in the caller's signature,
 * or a fluent chain.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  narrowCallCandidates,
  createCallResolutionIndex,
  singleOwnerSet,
  buildTypeHierarchy,
} from '../../core/graph/relationship-resolver.js';

function ent(id, name, file, start, end, extra = {}) {
  return { id, name, type: 'function', file_path: file, start_line: start, end_line: end, parent_class: null, signature: '', ...extra };
}

function resolve(candidates, receiver, caller, entities, hierarchy = null) {
  const index = createCallResolutionIndex(entities, { hierarchy });
  return singleOwnerSet(narrowCallCandidates(candidates, receiver, caller, index), caller, index).map(c => c.id);
}

describe('singleOwnerSet — no edge when unrelated owners remain', () => {
  const caller = ent('t', 'testRows', 'Tests/RowFetchTests.swift', 130, 150, { parent_class: 'RowFetchTests' });
  const map1 = ent('m1', 'map', 'GRDB/ValueObservation/Map.swift', 21, 30, { parent_class: 'ValueObservation' });
  const map2 = ent('m2', 'map', 'GRDB/Core/Cursor.swift', 505, 510, { parent_class: 'Cursor' });

  it('`array.map` with no evidence for either owner stays unresolved', () => {
    expect(resolve([map1, map2], 'array', caller, [caller, map1, map2])).toEqual([]);
  });

  it('overloads of one type link (Swift extensions spread over files count as one type)', () => {
    const ex1 = ent('e1', 'execute', 'GRDB/Core/Database+Statements.swift', 324, 330, { parent_class: 'Database' });
    const ex2 = ent('e2', 'execute', 'GRDB/Core/Database+Other.swift', 10, 20, { parent_class: 'Database' });
    expect(resolve([ex1, ex2], 'database', caller, [caller, ex1, ex2]).sort()).toEqual(['e1', 'e2']);
  });

  it('same owner name in two Kotlin files is two types', () => {
    const k = ent('k', 'call', 'src/Main.kt', 1, 9, { parent_class: 'Main' });
    const b1 = ent('b1', 'build', 'okhttp3/Headers.kt', 326, 330, { parent_class: 'Builder' });
    const b2 = ent('b2', 'build', 'okhttp3/Request.kt', 300, 310, { parent_class: 'Builder' });
    expect(resolve([b1, b2], 'builder', k, [k, b1, b2])).toEqual([]);
  });
});

describe('receiver evidence', () => {
  const caller = ent('t', 'test', 'Tests/T.swift', 1, 9, { parent_class: 'T' });
  const dbExec = ent('d', 'execute', 'GRDB/Core/Database+Statements.swift', 324, 330, { parent_class: 'Database' });
  const serialExec = ent('s', 'execute', 'GRDB/Core/SerializedDatabase.swift', 50, 60, { parent_class: 'SerializedDatabase' });
  const stmtExec = ent('st', 'execute', 'GRDB/Core/Statement.swift', 70, 80, { parent_class: 'Statement' });

  it('`db` names Database in full and beats the suffix match on SerializedDatabase', () => {
    expect(resolve([dbExec, serialExec, stmtExec], 'db', caller, [caller, dbExec, serialExec, stmtExec])).toEqual(['d']);
  });

  it('a suffix match still decides when it is the only evidence (`observationBroker`)', () => {
    const b = ent('b', 'notify', 'GRDB/Core/TransactionObserver.swift', 1, 9, { parent_class: 'DatabaseObservationBroker' });
    const o = ent('o', 'notify', 'GRDB/Core/Other.swift', 1, 9, { parent_class: 'Other' });
    expect(resolve([b, o], 'observationBroker', caller, [caller, b, o])).toEqual(['b']);
  });

  it('the declared parameter type decides (Go receiver, Kotlin parameter)', () => {
    const goCaller = ent('g', 'Handle', 'context_test.go', 1, 9, { signature: 'func TestX(c *Context, w *httptest.ResponseRecorder) {' });
    const ctx = ent('c1', 'String', 'context.go', 1254, 1260, { parent_class: 'Context' });
    const foo = ent('c2', 'String', 'testdata/protoexample/test.pb.go', 45, 50, { parent_class: 'FOO' });
    expect(resolve([ctx, foo], 'c', goCaller, [goCaller, ctx, foo])).toEqual(['c1']);
    // `w` is an external type: no repo method qualifies.
    expect(resolve([ctx, foo], 'w', goCaller, [goCaller, ctx, foo])).toEqual([]);
    const kt = ent('k', 'run', 'src/A.kt', 1, 9, { signature: 'fun run(client: OkHttpClient, items: List<Call>) {' });
    const c1 = ent('n1', 'newCall', 'okhttp3/OkHttpClient.kt', 1, 9, { parent_class: 'OkHttpClient' });
    const c2 = ent('n2', 'newCall', 'okhttp3/Call.kt', 1, 9, { parent_class: 'Factory' });
    expect(resolve([c1, c2], 'client', kt, [kt, c1, c2])).toEqual(['n1']);
  });

  it('a declared type reaches a method of its supertype', () => {
    const javaCaller = ent('j', 'm', 'src/A.java', 1, 9, { signature: 'void m(MultipartBody body) {' });
    const rb = ent('r', 'contentLength', 'okhttp3/RequestBody.kt', 41, 45, { parent_class: 'RequestBody' });
    const other = ent('x', 'contentLength', 'okhttp3/ResponseBody.kt', 10, 15, { parent_class: 'ResponseBody' });
    const hierarchy = { supers: new Map([['MultipartBody', new Set(['RequestBody'])]]), subs: new Map([['RequestBody', new Set(['MultipartBody'])]]) };
    expect(resolve([rb, other], 'body', javaCaller, [javaCaller, rb, other], hierarchy)).toEqual(['r']);
  });

  it('a receiver that names a subtype in full reaches the supertype method', () => {
    const t = ent('t2', 'test', 'Tests/T.swift', 1, 9, { parent_class: 'T' });
    const inc = ent('i', 'including', 'GRDB/TableRecord+Association.swift', 641, 650, { parent_class: 'TableRecord' });
    const other = ent('o', 'including', 'GRDB/Other.swift', 1, 9, { parent_class: 'Other' });
    const hierarchy = { supers: new Map([['Author', new Set(['TableRecord'])]]), subs: new Map([['TableRecord', new Set(['Author'])]]) };
    expect(resolve([inc, other], 'author', t, [t, inc, other], hierarchy)).toEqual(['i']);
  });
});

describe('fluent chains', () => {
  const caller = ent('t', 'test', 'src/T.java', 1, 9, { parent_class: 'T' });

  it('`Builder().x()` binds to a Builder method; several Builder types stay unresolved', () => {
    const rb = ent('rb', 'request', 'okhttp3/Response.kt', 392, 395, { parent_class: 'Builder' });
    const other = ent('o', 'request', 'okhttp3/Interceptor.kt', 85, 86, { parent_class: 'Chain' });
    expect(resolve([rb, other], 'Builder()', caller, [caller, rb, other])).toEqual(['rb']);
    const rb2 = ent('rb2', 'request', 'okhttp3/Other.kt', 1, 2, { parent_class: 'Builder' });
    expect(resolve([rb, rb2, other], 'Builder()', caller, [caller, rb, rb2, other])).toEqual([]);
  });

  it('`name().localEndpoint()` follows a fluent previous method of one type', () => {
    const nameFn = ent('n', 'name', 'zipkin2/Span.java', 380, 384, { parent_class: 'Builder', signature: 'public Builder name(String name) {' });
    const local = ent('l', 'localEndpoint', 'zipkin2/Span.java', 385, 390, { parent_class: 'Builder' });
    const decoy = ent('d', 'localEndpoint', 'zipkin2/Span.java', 100, 101, { parent_class: 'Span' });
    expect(resolve([local, decoy], 'name()', caller, [caller, nameFn, local, decoy])).toEqual(['l']);
  });

  it('a previous method that returns another type is not evidence (`toBuilder().id()`)', () => {
    const toBuilder = ent('tb', 'toBuilder', 'zipkin2/Span.java', 90, 93, { parent_class: 'Span', signature: 'public Builder toBuilder() {' });
    const spanId = ent('si', 'id', 'zipkin2/Span.java', 94, 96, { parent_class: 'Span' });
    const other = ent('oi', 'id', 'zipkin2/Endpoint.java', 10, 12, { parent_class: 'Endpoint' });
    expect(resolve([spanId, other], 'toBuilder()', caller, [caller, toBuilder, spanId, other])).toEqual([]);
  });

  it('a name many types define fluently is not evidence (Rust `new() -> Self`)', () => {
    const rs = ent('r', 'run', 'lib/testutils/src/git.rs', 360, 370);
    const n1 = ent('n1', 'new', 'cli/src/a.rs', 1, 3, { parent_class: 'GenericTemplateLanguage', signature: 'pub fn new() -> Self {' });
    const n2 = ent('n2', 'new', 'cli/src/b.rs', 1, 3, { parent_class: 'Other', signature: 'pub fn new() -> Self {' });
    const cd = ent('cd', 'current_dir', 'cli/src/a.rs', 113, 120, { parent_class: 'GenericTemplateLanguage' });
    const cd2 = ent('cd2', 'current_dir', 'cli/src/b.rs', 20, 25, { parent_class: 'Other' });
    expect(resolve([cd, cd2], 'new()', rs, [rs, n1, n2, cd, cd2])).toEqual([]);
  });
});

describe('buildTypeHierarchy', () => {
  it('reads extends/implements edges by name, stripping qualifiers and generics', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE entities (id TEXT, name TEXT, type TEXT, file_path TEXT);
      CREATE TABLE relationships (source_id TEXT, target_id TEXT, target_name TEXT, type TEXT);
      INSERT INTO entities VALUES ('a','MultipartBody','class','x.kt'), ('b','Model','class','m.rb');
      INSERT INTO relationships VALUES ('a', NULL, 'RequestBody', 'extends'), ('b', NULL, 'Sequel::Model<T>', 'extends');`);
    const h = buildTypeHierarchy(db);
    expect([...h.supers.get('MultipartBody')]).toEqual(['RequestBody']);
    expect([...h.subs.get('RequestBody')]).toEqual(['MultipartBody']);
    expect(h.supers.has('Model')).toBe(false); // self-named base after stripping is ignored
    db.close();
  });
});

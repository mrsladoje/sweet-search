// ss-trace overload selection: `Owner.Method(Type)` picks one overload, and callers /
// callees are bound among same-count overloads by the argument types at the call.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets } from '../../core/graph/relationship-resolver.js';
import { StructuralContextBuilder } from '../../core/graph/structural-context.js';
import { formatTraceCompact } from '../../core/search/agent-output-fixes.js';
import {
  argumentType, memberSignatureType, overloadForArguments, overloadScore, parameterFit,
  selectOverload, signatureReturnType, splitParameterList,
} from '../../core/graph/trace-overloads.js';

describe('written parameter lists', () => {
  it('splits a trailing list off the symbol', () => {
    expect(splitParameterList('OrderService.Save(Order, bool)')).toEqual({ name: 'OrderService.Save', params: ['Order', 'bool'] });
    expect(splitParameterList('Save()')).toEqual({ name: 'Save', params: [] });
    expect(splitParameterList('Get(Dictionary<string, int> map)')).toEqual({ name: 'Get', params: ['Dictionary<string, int> map'] });
    expect(splitParameterList('Repo<T>.Get<TKey>(TKey key)')).toEqual({ name: 'Repo.Get', params: ['TKey key'] });
    expect(splitParameterList('Save')).toEqual({ name: 'Save', params: null });
    expect(splitParameterList('a(b).c()')).toEqual({ name: 'a(b).c()', params: null });
  });

  it('a written item fits a parameter by type, type head, name, or both', () => {
    expect(parameterFit('int', 'int id')).toBe(3);
    expect(parameterFit('Int32', 'int id')).toBe(3);
    expect(parameterFit('String', 'string name')).toBe(3);
    expect(parameterFit('List', 'List<Order> orders')).toBe(2);
    expect(parameterFit('id', 'int id')).toBe(2);
    expect(parameterFit('int id', 'int id')).toBe(3);
    expect(parameterFit('int name', 'int id')).toBe(0);
    expect(parameterFit('Order', 'System.Threading.Order order = null')).toBe(3);
    expect(parameterFit('string', 'id: string')).toBe(3);
    expect(parameterFit('bool', 'int id')).toBe(0);
  });

  it('a list fits by count (defaults, params) and position', () => {
    expect(overloadScore(['int'], ['int id', 'bool force = false'])).toBe(3);
    expect(overloadScore(['int', 'bool'], ['int id', 'bool force = false'])).toBe(7);
    expect(overloadScore(['int', 'bool'], ['int id'])).toBe(null);
    expect(overloadScore(['string', 'object', 'object'], ['string format', 'params object[] args'])).not.toBe(null);
    expect(overloadScore([], ['int id'])).toBe(null);
    expect(overloadScore([], [])).toBe(1);
  });

  it('reorders candidates by fit and keeps the order when nothing fits', () => {
    const params = { a: ['Order order'], b: ['int id'], c: ['string code'] };
    const cands = ['a', 'b', 'c'].map((id) => ({ id }));
    expect(selectOverload(cands, ['int'], (c) => params[c.id]).candidates.map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(selectOverload(cands, ['Guid'], (c) => params[c.id])).toEqual({ candidates: cands, matched: false });
    // The written owner's overload first, also when another class's fits better.
    const owned = [{ id: 'x', parentClass: 'Other' }, { id: 'y', parentClass: 'Repo' }];
    const p2 = { x: ['int id'], y: ['long id'] };
    expect(selectOverload(owned, ['int'], (c) => p2[c.id], 'Repo').candidates.map((c) => c.id)).toEqual(['x', 'y']);
    expect(selectOverload(owned, ['id'], (c) => p2[c.id], 'Repo').candidates.map((c) => c.id)).toEqual(['y', 'x']);
  });
});

describe('argument types at a call', () => {
  it('literals, constructions, casts and declarations', () => {
    expect(argumentType('"x"')).toBe('string');
    expect(argumentType('$"a{b}"')).toBe('string');
    expect(argumentType('nameof(X)')).toBe('string');
    expect(argumentType('42')).toBe('int');
    expect(argumentType('42L')).toBe('long');
    expect(argumentType('1.5')).toBe('double');
    expect(argumentType('1.5m')).toBe('decimal');
    expect(argumentType('true')).toBe('bool');
    expect(argumentType('new Order { Id = 1 }')).toBe('Order');
    expect(argumentType('(Order)o')).toBe('Order');
    expect(argumentType('x.ToString()')).toBe('string');
    expect(argumentType('order', 'void F(Order order) {')).toBe('Order');
    expect(argumentType('o', 'var o = new Order();')).toBe('Order');
    expect(argumentType('o', 'if (x is Order o && o.Ok)')).toBe('Order');
    expect(argumentType('code: "A"')).toBe('string');
    expect(argumentType('null')).toBe(null);
    expect(argumentType('Compute(x)')).toBe(null);
  });

  it('called methods and members through their declared types', () => {
    const rt = (name, owner, opts) => (opts?.member ? (owner === 'Order' && name === 'Id' ? 'int' : null) : (name === 'Load' ? 'Order' : null));
    expect(argumentType('repo.Load(1)', 'Repo repo;', 0, rt)).toBe('Order');
    expect(argumentType('order.Id', 'Order order = Get();', 0, rt)).toBe('int');
    expect(signatureReturnType('public static SyntaxToken Token(SyntaxKind kind)', 'Token')).toBe('SyntaxToken');
    expect(signatureReturnType('fun load(id: Int): Order', 'load')).toBe('Order');
    expect(signatureReturnType('public void Run()', 'Run')).toBe(null);
    expect(memberSignatureType('public int Id { get; set; }', 'Id')).toBe('int');
    expect(memberSignatureType('private readonly Order _order;', '_order')).toBe('Order');
  });

  it('binds a call to the one overload its types fit', () => {
    const ov = [{ key: 'order', params: ['Order order'] }, { key: 'id', params: ['int id'] }, { key: 'code', params: ['string code'] }];
    expect(overloadForArguments(['string'], ov)).toBe('code');
    expect(overloadForArguments(['int'], ov)).toBe('id');
    expect(overloadForArguments(['Order'], ov)).toBe('order');
    // A class type fits no keyword type: only the class parameter is left.
    expect(overloadForArguments(['Customer'], ov)).toBe('order');
    expect(overloadForArguments([null], ov)).toBe(null);
    // Numeric widening: a long argument fits a long and a double parameter; the exact type wins.
    expect(overloadForArguments(['long'], [{ key: 'l', params: ['long n'] }, { key: 'd', params: ['double n'] }])).toBe('l');
  });

  it('named arguments need that parameter; an array to params is the last argument', () => {
    const ov = [
      { key: 'params', params: ['params Gen[] generators'] },
      { key: 'list', params: ['IEnumerable<Gen> generators', 'IEnumerable<Text>? additionalTexts = null'] },
    ];
    expect(overloadForArguments(['Gen[]', null], ov, [null, 'additionalTexts'])).toBe('list');
    expect(overloadForArguments(['Gen[]', null], ov)).toBe('list');
    expect(overloadForArguments(['Gen', 'Gen'], ov)).toBe('params');
  });
});

const FILES = {
  'Shop/OrderService.cs': [
    'namespace Shop;',
    'public partial class OrderService',
    '{',
    '    public void Save(Order order)',
    '    {',
    '    }',
    '    public void Save(int id)',
    '    {',
    '    }',
    '}',
  ].join('\n'),
  'Shop/OrderService.Codes.cs': [
    'namespace Shop;',
    'public partial class OrderService',
    '{',
    '    public void Save(string code)',
    '    {',
    '    }',
    '}',
  ].join('\n'),
  'Shop/Checkout.cs': [
    'namespace Shop;',
    'public class Checkout',
    '{',
    '    private readonly OrderService _svc = new OrderService();',
    '    public void ByCode(string code)',
    '    {',
    '        _svc.Save(code);',
    '    }',
    '    public void ById()',
    '    {',
    '        _svc.Save(42);',
    '    }',
    '    public void ByOrder(Order order)',
    '    {',
    '        _svc.Save(order);',
    '    }',
    '}',
  ].join('\n'),
  'Shop/Order.cs': 'namespace Shop;\npublic class Order\n{\n}\n',
};

describe('ss-trace Owner.Method(Type) on a C# partial class', () => {
  let projectRoot;
  let dbPath;
  const trace = (symbol) => {
    const builder = new StructuralContextBuilder({ projectRoot, graphDbPath: dbPath });
    try {
      return builder.build(symbol, { rowsOnly: true, inRepoImpactOnly: true });
    } finally {
      builder.close();
    }
  };
  const callerNames = (r) => r.sections.callers.items.map((i) => i.name).sort();

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-trace-overloads-'));
    dbPath = join(projectRoot, 'code-graph.db');
    const db = new Database(dbPath);
    const log = console.log;
    console.log = () => {};
    try {
      const fts = createGraphSchema(db);
      const extractor = new GraphExtractor();
      for (const [file, source] of Object.entries(FILES)) {
        mkdirSync(join(projectRoot, dirname(file)), { recursive: true });
        writeFileSync(join(projectRoot, file), source);
        const out = await extractor.extractFromFile(file, source);
        insertGraph(db, out.entities, out.relationships, fts, { syncFts: false, callSites: out.callSites || [], files: [out.file] });
      }
      resolveRelationshipTargets(db);
    } finally {
      console.log = log;
      db.close();
    }
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('selects the overload by type or by parameter name, also in another file of the class', () => {
    expect(trace('OrderService.Save(int)').target.startLine).toBe(7);
    expect(trace('OrderService.Save(id)').target.startLine).toBe(7);
    expect(trace('OrderService.Save(Order)').target.startLine).toBe(4);
    const byCode = trace('OrderService.Save(string)');
    expect([byCode.target.filePath, byCode.target.startLine]).toEqual(['Shop/OrderService.Codes.cs', 4]);
    expect(byCode.overloadQuery).toMatchObject({ matched: true, target: '(string code)' });
  });

  it('each overload lists only the calls its argument types fit', () => {
    expect(callerNames(trace('OrderService.Save(int)'))).toEqual(['ById']);
    expect(callerNames(trace('OrderService.Save(string)'))).toEqual(['ByCode']);
    expect(callerNames(trace('OrderService.Save(Order)'))).toEqual(['ByOrder']);
  });

  it('a list no definition takes is said, and the trace keeps the first match', () => {
    const r = trace('OrderService.Save(Guid)');
    expect(r.target).not.toBe(null);
    expect(r.overloadQuery.matched).toBe(false);
    expect(formatTraceCompact(r)).toContain('# no definition of Save takes (Guid); traced the first match');
  });

  it('the other overloads print with their parameter lists', () => {
    const out = formatTraceCompact(trace('OrderService.Save(int)'));
    expect(out).toContain('# overload Save(int id)');
    expect(out).toMatch(/other definitions \(pick with [^)]*Name\(Type\)\): .*OrderService\.Save\(Order order\)/);
    expect(out).toContain('OrderService.Save(string code)');
  });

  it('a symbol without a list traces as before', () => {
    const r = trace('OrderService.Save');
    expect(r.overloadQuery).toBeUndefined();
    expect(r.disambiguation.every((a) => a.params === undefined)).toBe(true);
  });
});

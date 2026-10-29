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
import { bindCalleeOverloads, rebindOverloadCallers } from '../../core/graph/structural-context.js';
import {
  argumentType, callArguments, callReceiver, memberSignatureType, overloadForArguments, overloadScore, parameterFit,
  receiverFits, selectOverload, signatureReturnType, splitParameterList, typeHierarchy,
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
    // A written owner: only its definitions fit (`Repo.M(int)` is no `Other.M(int)`).
    const owned = [{ id: 'x', parentClass: 'Other' }, { id: 'y', parentClass: 'Repo' }];
    const p2 = { x: ['int id'], y: ['long id'] };
    expect(selectOverload(owned, ['int'], (c) => p2[c.id], 'Repo')).toEqual({ candidates: [owned[1], owned[0]], matched: false });
    expect(selectOverload(owned, ['id'], (c) => p2[c.id], 'Repo').candidates.map((c) => c.id)).toEqual(['y', 'x']);
  });
});

describe('review fixes: written lists', () => {
  it('rejects empty items and keeps C++ operator() as the name', () => {
    expect(splitParameterList('List(,)')).toEqual({ name: 'List(,)', params: null });
    expect(splitParameterList('M(a,)')).toEqual({ name: 'M(a,)', params: null });
    expect(splitParameterList('F::operator()(int)')).toEqual({ name: 'F::operator()', params: ['int'] });
  });

  it('a namespace or a ? / * / & mark that differs is no exact fit', () => {
    expect(parameterFit('A.Order', 'B.Order v')).toBe(0);
    expect(parameterFit('A.Order', 'N.A.Order v')).toBe(3);
    expect(parameterFit('A.Order', 'Order v')).toBe(2);
    expect(parameterFit('int', 'int? v')).toBe(2);
    expect(parameterFit('int?', 'int? v')).toBe(3);
    const ov = { a: ['int v'], b: ['int? v'] };
    expect(selectOverload([{ id: 'a' }, { id: 'b' }], ['int?'], (c) => ov[c.id]).candidates.map((c) => c.id)).toEqual(['b', 'a']);
  });
});

describe('review fixes: call sites', () => {
  it('commas, quotes and declarations inside strings and comments are no code', () => {
    expect([...callArguments('M("a,b");', 'M')]).toEqual(['"a,b"']);
    expect([...callArguments('M(@"x"",y", 2) // M(1, 2, 3)', 'M')]).toEqual(['@"x"",y"', '2']);
    expect([...callArguments("M(',', s)", 'M')]).toEqual(["','", 's']);
    // `<` as a comparison, `=>` in a lambda, a comment inside the list.
    expect([...callArguments('That(x < y, "msg")', 'That')]).toEqual(['x < y', '"msg"']);
    expect([...callArguments('Add(items.Where(x => x.Ok), true)', 'Add')]).toEqual(['items.Where(x => x.Ok)', 'true']);
    const withComment = [...callArguments('Put(order, // keep, see 12\n true)', 'Put')];
    expect([withComment.length, withComment[0]]).toEqual([2, 'order']);
    expect(callArguments('Get<int>("k")', 'Get').typeArguments).toBe(true);
    expect(argumentType('id', 'int id = 1;\n// string id;\n')).toBe('int');
    expect(argumentType('id', 'int id = 1; Log("string id;");')).toBe('int');
    expect(argumentType('o', 'var o = "x;y";')).toBe('string');
  });

  it('a receiver of another class (or namespace) reaches no overload of the owner', () => {
    expect(callReceiver('Syntax.InternalSyntax.SyntaxFactory.IdentifierName(x)', 'IdentifierName')).toBe('Syntax.InternalSyntax.SyntaxFactory');
    expect(callReceiver('Get().M(x)', 'M')).toBe(null);
    expect(callReceiver('M(x)', 'M')).toBe('');
    expect(receiverFits('Syntax.InternalSyntax.SyntaxFactory', 'SyntaxFactory', 'Microsoft.CodeAnalysis.CSharp')).toBe(false);
    expect(receiverFits('CSharp.SyntaxFactory', 'SyntaxFactory', 'Microsoft.CodeAnalysis.CSharp')).toBe(true);
    expect(receiverFits('Other', 'SyntaxFactory')).toBe(false);
    expect(receiverFits('csmodel', 'CSharpExtensions', '', 'CSharpSemanticModel csmodel = x;')).toBe(false);
    expect(receiverFits('svc', 'OrderService', '', 'OrderService svc = x;')).toBe(true);
    expect(receiverFits('this', 'OrderService')).toBe(true);
  });

  it('the type hierarchy picks the nearest supertype and rules out unrelated indexed types', () => {
    const up = { Special: ['IMethod'], IMethod: ['IRef'], IRef: [], IArray: ['IRef'], Plain: [] };
    const h = typeHierarchy((n) => up[n] ?? null);
    const ov = [{ key: 'array', params: ['IArray a'] }, { key: 'method', params: ['IMethod m'] }, { key: 'ref', params: ['IRef r'] }];
    expect(overloadForArguments(['Special'], ov, [], h)).toBe('method');
    expect(overloadForArguments(['IArray'], ov, [], h)).toBe('array');
    expect(overloadForArguments(['Plain'], ov, [], h)).toBe(null);
    // Without the hierarchy two class types never rule each other out.
    expect(overloadForArguments(['Special'], ov)).toBe(null);
  });

  it('a type parameter is an identity match; the non-generic overload wins only a tie', () => {
    const up = { IBlock: ['IOp'], IOp: [] };
    const h = typeHierarchy((n) => up[n] ?? null);
    const ov = [{ key: 'generic', params: ['T? node'] }, { key: 'plain', params: ['IOp? op'] }];
    expect(overloadForArguments(['IBlock'], ov, [], h)).toBe('generic');
    expect(overloadForArguments(['IOp'], ov, [], h)).toBe('plain');
  });

  it('a callee row with several call lines binds each line on its own', () => {
    const file = 'A.cs';
    const src = { 1: 'void F()\n{\n  Save(1);\n  Save("x");\n}', 10: 'void Save(int id)', 20: 'void Save(string code)' };
    const defs = [10, 20].map((n) => ({ id: `s${n}`, name: 'Save', type: 'method', parentClass: 'A', filePath: file, startLine: n, endLine: n }));
    const repo = { readFileRange: (f, a) => (a === 3 ? 'Save(1);' : a === 4 ? 'Save("x");' : src[a] || '') };
    const target = { id: 'f', name: 'F', filePath: file, parentClass: 'A', startLine: 1, endLine: 5 };
    const types = {
      siblingsOf: (e) => defs.filter((d) => d.id !== e.id),
      paramsOf: (e) => ({ s10: ['int id'], s20: ['string code'] })[e.id],
      returnTypeOf: () => null,
    };
    const out = bindCalleeOverloads(repo, target, [{ ...defs[0], relationship: 'calls', contextLines: [3, 4], contextLine: 3 }], types);
    expect(out.map((r) => [r.startLine, r.contextLines])).toEqual([[10, [3]], [20, [4]]]);
  });
});

describe('argument types at a call', () => {
  it('literals, constructions, casts and declarations', () => {
    expect(argumentType('"x"')).toBe('string');
    // A non-constant interpolated string binds an interpolated-string handler first.
    expect(argumentType('$"a{b}"')).toBe('$interpolated');
    const assert = [{ key: 'str', params: ['bool c', 'string m'] }, { key: 'handler', params: ['bool c', '[InterpolatedStringHandlerArgument("c")] ref AssertInterpolatedStringHandler m'] }];
    expect(overloadForArguments(['bool', '$interpolated'], assert)).toBe('handler');
    expect(overloadForArguments(['bool', 'string'], assert)).toBe('str');
    expect(argumentType('$"ab {{x}}"')).toBe('string');
    // A form types the argument only when it is the whole argument.
    expect(argumentType('"abc".Length')).toBe(null);
    expect(argumentType('"a" == s')).toBe(null);
    expect(argumentType('typeof(App).Name')).toBe(null);
    expect(argumentType('new Uri(u, "x").AbsoluteUri')).toBe(null);
    expect(argumentType('new Uri(u) { Port = 1 }')).toBe('Uri');
    expect(argumentType('(Order)x.Inner')).toBe('Order');
    expect(argumentType('(int)x + 1')).toBe(null);
    // A lambda parameter is another variable than an earlier local of the same name.
    expect(argumentType('i', 'for (int i = 0; i < 3; i++) { }\nnames.ForEach(i => ')).toBe(null);
    // A generic parameter list is no type of the next parameter.
    expect(argumentType('b', 'void F(List<int> a, Dictionary<string, int> b) {')).toBe('Dictionary<string, int>');
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
    // A class the index cannot relate to Order may or may not convert: no move.
    expect(overloadForArguments(['Customer'], ov)).toBe(null);
    // `int?` does not convert to `int`; `char` converts to `int`.
    expect(overloadForArguments(['int?'], [{ key: 'i', params: ['int v'] }, { key: 'o', params: ['Order v'] }])).toBe(null);
    expect(overloadForArguments(['char'], [{ key: 'i', params: ['int v'] }, { key: 's', params: ['string v'] }])).toBe(null);
    // `ref` must be written where the parameter has it.
    expect(overloadForArguments(['int'], [{ key: 'r', params: ['ref int v'] }, { key: 'l', params: ['long v'] }], [], null, { mods: [null] })).toBe(null);
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
    // An array converts to its element type's sequence interfaces.
    expect(overloadForArguments(['Gen[]'], [{ key: 'seq', params: ['System.Collections.Generic.IList<Gen> xs'] }, { key: 'one', params: ['Gen x'] }])).toBe('seq');
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
  // More overloads than the 12-candidate pool.
  'Shop/Big.cs': [
    'namespace Shop;',
    'public class Big',
    '{',
    ...Array.from({ length: 16 }, (_, i) => `    public void M(T${i} v) { }`),
    '}',
  ].join('\n'),
  // Same-named nested classes of two types: not one partial class.
  'Shop/X.cs': 'namespace Shop;\npublic class X\n{\n    public class Factory\n    {\n        public void Create(string v) { }\n    }\n}\n',
  'Shop/Y.cs': 'namespace Shop;\npublic class Y\n{\n    public class Factory\n    {\n        public void Create(int v) { }\n    }\n}\n',
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

  it('reaches an overload past the candidate pool', () => {
    const r = trace('Big.M(T15)');
    expect([r.target.startLine, r.overloadQuery.matched]).toEqual([19, true]);
  });

  it('same-named nested classes of different types are no overloads of each other', () => {
    const builder = new StructuralContextBuilder({ projectRoot, graphDbPath: dbPath });
    try {
      const x = builder.build('Factory.Create(string)', { rowsOnly: true }).target;
      expect(x.filePath).toBe('Shop/X.cs');
      expect(builder._overloadSiblings({ ...x, parentClass: 'Factory' })).toEqual([]);
    } finally {
      builder.close();
    }
  });

  it('the impact tree starts from the re-bound callers', () => {
    const r = trace('OrderService.Save(string)');
    const firstHop = r.sections.impact.paths.filter((p) => p.direction === 'upstream' && p.depth === 1).map((p) => p.nodes[0].name);
    expect(firstHop).not.toContain('ById');
    expect(firstHop).not.toContain('ByOrder');
  });

  it('a symbol without a list traces as before', () => {
    const r = trace('OrderService.Save');
    expect(r.overloadQuery).toBeUndefined();
    expect(r.disambiguation.every((a) => a.params === undefined)).toBe(true);
  });
});

describe('rebindOverloadCallers', () => {
  it('never adds the target as its own caller from a sibling edge', () => {
    const file = 'A.cs';
    const lines = { 5: 'Save(code);', 1: 'void Save(string code)\n{\n', 10: 'void Save(int id)' };
    const target = { id: 't', name: 'Save', type: 'method', parentClass: 'A', filePath: file, startLine: 1, endLine: 6 };
    const sibling = { id: 's', name: 'Save', type: 'method', parentClass: 'A', filePath: file, startLine: 10, endLine: 10 };
    const repo = { readFileRange: (f, a, b) => (a === 5 ? lines[5] : a === 1 && b >= 5 ? 'void Save(string code)\n{\n\n\nSave(code);' : lines[a] || '') };
    const types = {
      siblingsOf: () => [sibling],
      paramsOf: (e) => (e.id === 't' ? ['string code'] : ['int id']),
      returnTypeOf: () => null,
      callersOf: () => [{ ...target, relationship: 'calls', contextLines: [5], contextLine: 5 }],
    };
    expect(rebindOverloadCallers(repo, target, [], types)).toEqual([]);
  });
});

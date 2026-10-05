/**
 * Fixes from the 2026-10-04 review of 18 new ss-* calls (composer, drogon, grdb, ocelot).
 * Each test names the call that showed the defect.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findSameFileDefinition } from '../../core/infrastructure/structural-source-definitions.js';
import { callsiteHints } from '../../core/graph/structural-callsite-hints.js';
import { buildImpactPaths } from '../../core/graph/structural-context.js';
import { preferCalledDefinitions } from '../../core/infrastructure/structural-context-repository.js';
import { isTestLikePath } from '../../core/infrastructure/test-paths.js';
import { detectFileKind } from '../../core/ranking/file-kind-ranking.js';
import { formatTraceCompact, renderSummaryRow, renderRelatedRows } from '../../core/search/agent-output-fixes.js';
import { formatAlsoLine, nameContext } from '../../core/search/semantic-also.js';
import { buildAgentToolDaemonResponse } from '../../core/agent-tools/daemon-route.js';
import { GraphExtractor } from '../../core/graph/graph-extractor.js';

describe('ss-trace: C++ types are no calls or definitions (drogon requestPassMiddlewares)', () => {
  it('`static void handle(` defines handle, not a constant `void`', () => {
    const read = (text) => () => text;
    expect(findSameFileDefinition({ name: 'void', filePath: 'a.cc', readFileRange: read('static void handleInvalidHttpMethod(\n  int x);\n') })).toBeNull();
    expect(findSameFileDefinition({ name: 'MAX', filePath: 'a.rs', readFileRange: read('static MAX: usize = 3;\n') })?.name).toBe('MAX');
    expect(findSameFileDefinition({ name: 'x', filePath: 'a.go', readFileRange: read('var x int\n') })?.name).toBe('x');
  });

  it('a name right after `<` is a function type, not a call', () => {
    expect(callsiteHints('std::function<void(const X &)> cb; run(1); if (a < b(2)) {}')).toEqual(['run', 'b']);
  });
});

describe('ss-trace impact trees', () => {
  const T = { id: 't', name: 'target', type: 'method', filePath: 'a.cc', startLine: 1, endLine: 9 };
  const ent = (id, name, type, sourceId, relationship = 'calls') => ({ id, name, type, filePath: 'b.cc', startLine: 3, relationship, sourceId });

  it('downstream follows calls only, never into a namespace, and reaches bare calls', () => {
    const asked = [];
    const repo = {
      getReverseDependents: () => [],
      getForwardDependencies: (ids, opts) => {
        asked.push(opts.types);
        return ids.includes('t') ? [ent('ns', 'std', 'namespace', 't'), ent('f', 'passMiddlewares', 'function', 't')] : [];
      },
      getBareCallees: (entity) => (entity.id === 'f' ? [{ ...ent('g', 'passMiddlewareChains', 'function'), bare: true }] : []),
    };
    const paths = buildImpactPaths(repo, T, { maxDepth: 2 });
    expect(asked[0]).toEqual(['calls', 'instantiates']);
    const names = paths.map((p) => p.path.map((n) => n.name).join('>'));
    expect(names).toContain('target>passMiddlewares');
    expect(names).toContain('target>passMiddlewares>passMiddlewareChains');
    expect(names.some((n) => n.includes('std'))).toBe(false);
  });
});

describe('ss-trace target: which of several same-named definitions (ocelot LeaseAsync)', () => {
  const row = (file, parent, fanIn, type = 'method') => ({ name: 'LeaseAsync', type, file_path: file, parent_class: parent, fan_in: fanIn });

  it('non-test first, then the one the code calls most', () => {
    const rows = [
      row('testing/LoadBalancer/LoadBalancerAnalyzer.cs', 'LoadBalancerAnalyzer', 2),
      row('src/LoadBalancer/Balancers/NoLoadBalancer.cs', 'NoLoadBalancer', 5),
      row('unit/LoadBalancer/LoadBalancerFactoryTests.cs', 'Fake', 0),
      row('src/LoadBalancer/Interfaces/ILoadBalancer.cs', 'ILoadBalancer', 23),
    ];
    expect(preferCalledDefinitions(rows, null, 'LeaseAsync').map((r) => r.parent_class))
      .toEqual(['ILoadBalancer', 'NoLoadBalancer', 'LoadBalancerAnalyzer', 'Fake']);
    // `Owner.name` still wins over everything.
    expect(preferCalledDefinitions(rows, 'NoLoadBalancer', 'LeaseAsync')[0].parent_class).toBe('NoLoadBalancer');
  });

  it('unit-tests/ and acceptance-tests/ are test trees; a bare unit/ is not', () => {
    expect(isTestLikePath('test/Ocelot.UnitTests/LoadBalancer/X.cs')).toBe(true);
    expect(isTestLikePath('acceptance-tests/LoadBalancer/T.cs')).toBe(true);
    expect(isTestLikePath('unit/convert.rs')).toBe(false);
    expect(isTestLikePath('src/units/unit/convert.rs')).toBe(false);
  });
});

describe('ss-trace rows', () => {
  const result = (callers) => ({
    symbol: 'LeaseAsync',
    target: { name: 'LeaseAsync', type: 'method', filePath: 'src/ILoadBalancer.cs', startLine: 11, endLine: 11 },
    disambiguation: [],
    sections: {
      callers: { total: callers.length, items: callers.items || callers, unresolvedByName: callers.unresolved || [] },
      callees: { total: 0, items: [] },
      impact: { paths: [] },
    },
  });

  it('a one-line target prints one line number; a recursive call says so', () => {
    const r = result([{ name: 'LeaseAsync', type: 'method', file: 'src/ILoadBalancer.cs', startLine: 11, endLine: 11, contextLines: [11] }]);
    const out = formatTraceCompact(r, { mode: 'callers' });
    expect(out.split('\n')[0]).toBe('# src/ILoadBalancer.cs:11');
    expect(out).toContain('method LeaseAsync 11 (recursive) @11');
  });

  it('an entity that implements and calls prints once; its own definition line is no site', () => {
    const r = result([
      { name: 'LeaseAsync', type: 'method', file: 'src/Sticky.cs', startLine: 71, endLine: 97, contextLines: [87], relationship: 'calls' },
      { name: 'LeaseAsync', type: 'method', file: 'src/Sticky.cs', startLine: 71, endLine: 97, contextLines: [71], relationship: 'overrides' },
      { name: 'RoundRobin', type: 'class', file: 'src/RoundRobin.cs', startLine: 9, endLine: 128, contextLines: [9], relationship: 'extends' },
    ]);
    r.target.type = 'interface';
    const out = formatTraceCompact(r, { mode: 'callers' });
    expect(out).toContain('src/Sticky.cs\nmethod LeaseAsync 71-97 (overrides) @87\n');
    // A class "extending" an interface implements it (C# base list).
    expect(out).toContain('src/RoundRobin.cs\nclass RoundRobin 9-128 (implements)');
  });

  it('same-name calls the graph did not resolve print after the callers, said as such', () => {
    const r = result({
      items: [{ name: 'Get', type: 'method', file: 'src/House.cs', startLine: 24, endLine: 41, contextLines: [30] }],
      unresolved: [{ name: 'Invoke', type: 'method', file: 'src/LoadBalancingMiddleware.cs', startLine: 22, endLine: 67, contextLines: [36] }],
    });
    expect(formatTraceCompact(r, { mode: 'callers' })).toContain(
      'not resolved, same name (may call another LeaseAsync):\nsrc/LoadBalancingMiddleware.cs\nmethod Invoke 22-67 @36');
  });
});

describe('ss-search / ss-find rows', () => {
  it('a summary row of part of a definition names the whole (composer selectPreferredPackages)', () => {
    const r = { startLine: 82, endLine: 96, symbol: 'selectPreferredPackages',
      symbolInfo: [{ name: 'selectPreferredPackages', type: 'method', startLine: 86, endLine: 129 }] };
    expect(renderSummaryRow(r)).toBe('82-96 method selectPreferredPackages (part; whole 86-129)');
  });

  it('a class that extends an interface implements it; interface extends interface stays', () => {
    expect(renderRelatedRows([{ kind: 'extends', name: 'ILoadBalancer', entityType: 'interface' }], new Set(), { name: 'LeastConnection', type: 'class' }))
      .toEqual(['class LeastConnection implements interface ILoadBalancer']);
    expect(renderRelatedRows([{ kind: 'extends', name: 'A', entityType: 'interface' }], new Set(), { name: 'B', type: 'interface' }))
      .toEqual(['interface B extends interface A']);
  });

  it('agent format: FooTests.cs and root unit/ files rank as tests; other formats unchanged', () => {
    expect(detectFileKind('unit/LoadBalancer/LeastConnectionTests.cs', { agentFormat: true })).toBe('tests');
    expect(detectFileKind('unit/LoadBalancer/LeastConnectionTests.cs', {})).toBe('implementation');
  });
});

describe('ss-semantic also line', () => {
  it('the unprinted parts of one function are one entry (grdb asyncConcurrentRead)', () => {
    const c = (a, b, names, kind = 'function') => ({ startLine: a, endLine: b, names, name: names[0], kind });
    const line = formatAlsoLine([c(502, 571, ['asyncConcurrentRead']), c(7, 23, ['DatabasePool']), c(608, 637, ['asyncConcurrentRead'])],
      nameContext([], { asyncConcurrentRead: 'function', DatabasePool: 'class' }));
    expect(line).toBe('# also: 502-571, 608-637 function asyncConcurrentRead · 7-23 class DatabasePool');
  });
});

describe('C++ kinds', () => {
  it('`R ns::f(` is a function when the file opens or uses namespace ns; `C::m(` stays a method', async () => {
    const r = await new GraphExtractor().extractFromFile('/t/RangeParser.cc', [
      'using namespace drogon;',
      'int drogon::parseRangeHeader(const char *s) { return 0; }',
      'void HttpServer::start() {}',
      'namespace orm { namespace detail { int helper(); } }',
      'int orm::detail::helper2(int x) { return x; }',
    ].join('\n'));
    const kind = (name) => r.entities.find((e) => e.name === name)?.type;
    expect(kind('parseRangeHeader')).toBe('function');
    expect(kind('helper2')).toBe('function');
    expect(kind('start')).toBe('method');
  });
});

describe('daemon output', () => {
  it('drops the byte order mark a file\'s first line carried (ocelot LeastConnection.cs)', async () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ss-bom-')));
    const r = await buildAgentToolDaemonResponse({ v: 1, tool: 'read', args: ['a.cs'], cwd: root, env: {}, pid: 4242 }, {
      isUnixSocket: true, searcher: { projectRoot: root }, isReady: () => true,
      runTool: async () => { process.stdout.write('﻿using System;\n'); },
    });
    expect(JSON.parse(r.body).stdout).toBe('using System;\n');
  });
});

// --- Round 2 (2026-10-04): 18 more calls on all eleven review repos ---------------------

import { resolveBareCall } from '../../core/graph/bare-call-resolution.js';
import { createCallResolutionIndex } from '../../core/graph/relationship-resolver.js';
import { classifyFileKindIntent } from '../../core/ranking/file-kind-ranking.js';
import { topLevelSymbols } from '../../core/search/agent-pack-completion.js';
import { selectUnreadSymbols } from '../../core/search/unread-symbol-ranking.js';

describe('bare calls by scope', () => {
  const e = (id, name, type, file, start, end, parent = null) => ({ id, name, type, file_path: file, start_line: start, end_line: end, parent_class: parent });

  it('a nested type sees the methods of the type around it (zipkin Span.Builder.id -> toLowerHex)', () => {
    const span = e('S', 'Span', 'class', 'Span.java', 1, 700);
    const builder = e('B', 'Builder', 'class', 'Span.java', 277, 640, 'Span');
    const id = e('m1', 'id', 'method', 'Span.java', 447, 451, 'Builder');
    const toLowerHex = e('m2', 'toLowerHex', 'method', 'Span.java', 657, 661, 'Span');
    const index = createCallResolutionIndex([span, builder, id, toLowerHex]);
    expect(resolveBareCall(id, [toLowerHex], index).map((c) => c.id)).toEqual(['m2']);
  });

  it('several types share the owner name: the caller file\'s definition wins (sequel Dataset)', () => {
    const base = e('d1', 'Dataset', 'class', 'lib/sequel/dataset/sql.rb', 1, 2000);
    const sub = e('d2', 'Dataset', 'class', 'lib/sequel/adapters/oracle.rb', 1, 500);
    const caller = e('c', 'literal_append', 'method', 'lib/sequel/dataset/sql.rb', 40, 93, 'Dataset');
    const own = e('o1', 'literal_other_append', 'method', 'lib/sequel/dataset/sql.rb', 1461, 1475, 'Dataset');
    const other = e('o2', 'literal_other_append', 'method', 'lib/sequel/adapters/oracle.rb', 402, 410, 'Dataset');
    const index = createCallResolutionIndex([base, sub, caller, own, other]);
    expect(resolveBareCall(caller, [own, other], index).map((c) => c.id)).toEqual(['o1']);
  });
});

describe('ss-search rows and ranking (round 2)', () => {
  it('agent format: `how is X done` asks for code; other formats unchanged', () => {
    expect(classifyFileKindIntent('how is a conflict written into the file with conflict markers', { agentFormat: true })).toBe('implementation');
    expect(classifyFileKindIntent('how is a conflict written into the file with conflict markers')).toBe('unknown');
  });

  it('an unnamed wrapper does not hide the definition it wraps (tortoise @classmethod bulk_create)', () => {
    expect(topLevelSymbols([
      { name: '<anonymous:decorator>', type: 'decorator', startLine: 1448, endLine: 1497 },
      { name: 'bulk_create', type: 'method', startLine: 1449, endLine: 1497 },
    ]).map((s) => s.name)).toEqual(['bulk_create']);
  });
});

describe('ss-read below list', () => {
  it('one shared word does not make a name relevant (jj `file` vs test_resolve_file_executable)', () => {
    const syms = ['diff_size', 'materialized_diff_stream', 'parse_conflict', 'parse_conflict_hunk', 'helper_a', 'test_resolve_file_executable']
      .map((symbol) => ({ symbol }));
    const out = selectUnreadSymbols(syms, { anchors: [], subtokens: ['conflict', 'written', 'file', 'markers'] }, 3).symbols.map((s) => s.symbol);
    // parse_conflict: half its words; parse_conflict_hunk (1 of 3) and the test (1 of 4): no.
    expect(out).toEqual(['parse_conflict', 'diff_size', 'materialized_diff_stream']);
  });
});

describe('ss-semantic also line (round 2)', () => {
  it('a definition\'s ranges print in line order', () => {
    const c = (a, b) => ({ startLine: a, endLine: b, names: ['doUpdate'], name: 'doUpdate' });
    expect(formatAlsoLine([c(537, 691), c(485, 492)], nameContext([], { doUpdate: 'method' })))
      .toBe('# also: 485-492, 537-691 method doUpdate');
  });
});

describe('C# namespace names', () => {
  it('a dotted namespace is named as written', async () => {
    const ex = new GraphExtractor();
    for (const [src, name] of [['namespace Ocelot.DownstreamUrlCreator;\nclass A {}\n', 'Ocelot.DownstreamUrlCreator'],
      ['namespace Ocelot.LoadBalancer.Balancers;\nclass B {}\n', 'Ocelot.LoadBalancer.Balancers']]) {
      const r = await ex.extractFromFile('/t/a.cs', src);
      expect(r.entities.find((x) => x.type === 'namespace')?.name).toBe(name);
    }
  });

  it('a Python def in a class is a method; a top-level def is a function', async () => {
    const r = await new GraphExtractor().extractFromFile('/t/m.py', 'class Model:\n    @classmethod\n    def bulk_create(cls):\n        pass\n\ndef top():\n    pass\n');
    const kind = (n) => r.entities.find((x) => x.name === n)?.type;
    expect(kind('bulk_create')).toBe('method');
    expect(kind('top')).toBe('function');
  });
});

// --- Round 3 (2026-10-04) ------------------------------------------------------------------

import { startAtNamedDefinition } from '../../core/search/context-expander.js';

describe('round 3', () => {
  it('a top-level caller row keeps its call line (okhttp ConnectionListenerTest)', () => {
    const r = {
      symbol: 'ConnectionPool',
      target: { name: 'ConnectionPool', type: 'class', filePath: 'a/ConnectionPool.kt', startLine: 37, endLine: 98 },
      disambiguation: [],
      sections: {
        callers: { total: 1, items: [{ name: '(top-level)', type: 'file', file: 't/ConnectionListenerTest.kt', startLine: 72, endLine: 72, contextLines: [72], relationship: 'instantiates' }] },
        callees: { total: 0, items: [] },
        impact: { paths: [] },
      },
    };
    expect(formatTraceCompact(r, { mode: 'callers' })).toContain('t/ConnectionListenerTest.kt\n(top-level) (instantiates) @72');
  });

  it('a cut entry starts at the definition it is named after, with its doc comments (jj resolve_referenced_commits)', () => {
    const code = ['    };', '    Ok(expression)', '}', '', '/// Collects commits.', 'fn resolve_referenced_commits() {', '    body();', '}'].join('\n');
    const repo = { findEntitiesInRange: () => [{ name: 'resolve_referenced_commits', startLine: 2011, endLine: 2013 }] };
    const out = startAtNamedDefinition(code, { symbol: 'resolve_referenced_commits', startLine: 2006, endLine: 2013 }, 5, repo, 'r.rs', true);
    expect(out.start).toBe(2010);
    expect(out.code.split('\n')[0]).toBe('/// Collects commits.');
    // Other formats and code that fits are unchanged.
    expect(startAtNamedDefinition(code, { symbol: 'resolve_referenced_commits', startLine: 2006, endLine: 2013 }, 5, repo, 'r.rs', false).start).toBeNull();
    expect(startAtNamedDefinition(code, { symbol: 'resolve_referenced_commits', startLine: 2006, endLine: 2013 }, 9999, repo, 'r.rs', true).start).toBeNull();
  });
});

// --- Round 4 (2026-10-04) ------------------------------------------------------------------

import { dropNameOnlyCallers } from '../../core/graph/structural-context.js';
import { shouldTrustQualifiedResolution, trustedCallerEdge, pythonPackageCallOnMethod } from '../../core/infrastructure/structural-qualified-resolution.js';
import { StructuralContextRepository } from '../../core/infrastructure/structural-context-repository.js';

describe('round 4', () => {
  it('a name-only caller whose receiver names the owner stays; the dropped ones are reported', () => {
    const target = { id: 't', name: 'intercept', parentClass: 'Interceptor' };
    const rows = [
      { id: 'a', name: 'proceed', targetName: 'interceptor.intercept', targetId: null },
      { id: 'b', name: 'other', targetName: 'logging.intercept', targetId: null },
    ];
    const dropped = [];
    expect(dropNameOnlyCallers(rows, target, 40, dropped).map((r) => r.id)).toEqual(['a']);
    expect(dropped.map((r) => r.id)).toEqual(['b']);
  });

  it('Rust `recv.name(` never reaches a free function (jj `path.clone()` -> testutils fn clone)', () => {
    const free = { name: 'clone', type: 'function', filePath: 'lib/testutils/src/git.rs', parentClass: null, summary: 'clone the working copy path' };
    expect(shouldTrustQualifiedResolution('working_copy_path.clone', free)).toBe(false);
    expect(shouldTrustQualifiedResolution('git::clone', free)).toBe(true);
    expect(shouldTrustQualifiedResolution('repo.clone', { ...free, parentClass: 'Repo' })).toBe(true);
  });

  it('Kotlin `fun interface` is an interface with its members', async () => {
    const r = await new GraphExtractor().extractFromFile('/t/I.kt', 'fun interface Interceptor {\n  fun intercept(chain: Chain): Response\n}\n');
    const e = (n) => r.entities.find((x) => x.name === n);
    expect(e('Interceptor')?.type).toBe('interface');
    expect(e('intercept')?.parent_class ?? e('intercept')?.parentClass).toBe('Interceptor');
  });

  it('Ruby calls with a block and no parentheses are call sites (sequel `hold do |c|`)', async () => {
    const src = 'class P\n  def all\n    hold do |c|\n      @list.each{|x| x}\n    end\n  end\n  def hold\n  end\nend\n';
    const r = await new GraphExtractor().extractFromFile('/t/p.rb', src);
    expect(r.callSites.some((c) => c.callee_name === 'hold' && c.context_line === 3)).toBe(true);
    expect(r.relationships.some((x) => x.type === 'calls' && x.target_name === 'list.each' && x.context_line === 4)).toBe(true);
  });
});

// --- After the RunPod reindex (2026-10-04) --------------------------------------------------

import { applyResultDemotions } from '../../core/ranking/file-kind-ranking.js';

describe('agent ranking: qualified lookup and spelled names', () => {
  const mk = (file, s, e, sym, score) => ({ file, startLine: s, endLine: e, symbol: sym, name: sym, score, metadata: { file, startLine: s, endLine: e, name: sym } });
  const repo = {
    findOwnedEntityInRange: (file, s, e, owner, member) => (file === 'RealCall.kt' && owner === 'RealCall' && member === 'execute' ? { name: 'execute' } : null),
    findEntityWithNameInRange: () => null,
  };

  it('a query that is exactly `Owner.member` puts the chunk holding that member first', () => {
    const out = applyResultDemotions([mk('ExecuteDns.kt', 26, 81, 'execute', 1.0), mk('RealCall.kt', 182, 248, 'execute', 0.6)],
      { query: 'RealCall.execute', format: 'agent', codeGraphRepo: repo });
    expect(out[0].file).toBe('RealCall.kt');
  });

  it('a result whose name the query spells gets a mild boost; other formats do not', () => {
    const res = () => [mk('a.ts', 1, 9, 'convertFunctionOrMethod', 1.0), mk('a.ts', 20, 29, 'convertSymbol', 0.9)];
    const agent = applyResultDemotions(res(), { query: 'convert a TypeScript symbol into a reflection', format: 'agent' });
    expect(agent[0].symbol).toBe('convertSymbol');
    const plain = applyResultDemotions(res(), { query: 'convert a TypeScript symbol into a reflection', format: 'json' });
    expect(plain[0].symbol).toBe('convertFunctionOrMethod');
  });
});

// --- Chunk boundaries, sufficiency, trace gaps, wording (2026-10-04, after the 90-call recheck) ---

import { declarationOnly } from '../../core/search/query-sufficiency.js';
import { summaryRestatesHeader } from '../../core/search/agent-output-fixes.js';
import { TreeSitterProvider } from '../../core/infrastructure/tree-sitter-provider.js';

describe('chunk boundaries and Kotlin headers', () => {
  it('a comment right above a definition opens that definition\'s chunk, not the previous one', async () => {
    const p = new TreeSitterProvider();
    await p.init();
    const body = (n) => Array.from({ length: n }, (_, i) => `\tx${i} := ${i}`).join('\n');
    const src = `package p\n\nfunc first() {\n${body(40)}\n}\n\n// second does the second thing.\nfunc second() {\n${body(40)}\n}\n`;
    const chunks = await p.parseFileToChunks(src, 'go', { maxChunkSize: 700 });
    const second = chunks.find((c) => c.name === 'second');
    const first = chunks.find((c) => c.name === 'first');
    expect(second.text.startsWith('// second does the second thing.')).toBe(true);
    expect(first.text.includes('second does')).toBe(false);
  });

  it('a Kotlin class whose primary constructor is on the next lines keeps its members (line numbers kept)', async () => {
    const p = new TreeSitterProvider();
    await p.init();
    const s = await p.extractSymbols('class H\n  @JvmOverloads\n  constructor(\n    private val l: Int = 1,\n  ) : I {\n  override fun intercept(c: C): R { return x }\n}\n', 'kotlin');
    const e = (n) => s.find((x) => x.name === n);
    expect(e('intercept')?.parentClass).toBe('H');
    expect(e('intercept')?.startLine).toBe(5);
  });
});

describe('sufficiency and wording', () => {
  it('declarationOnly: a prototype is a declaration; a definition or a call is not', () => {
    expect(declarationOnly('R parseRangeHeader(const std::string &s,\n  size_t n);', 'parseRangeHeader')).toBe(true);
    expect(declarationOnly('R parseRangeHeader(int a) {\n  return 1;\n}', 'parseRangeHeader')).toBe(false);
    expect(declarationOnly('  y = parseRangeHeader(a);', 'parseRangeHeader')).toBe(false);
  });

  it('a `file:line — code block` summary restates the header and does not print', () => {
    expect(summaryRestatesHeader('src/lib/models/Reflection.ts:356 — code block')).toBe(true);
    expect(summaryRestatesHeader('a/b.ts:3 — handles the retry loop')).toBe(false);
  });
});

// --- Round 5 (2026-10-04) --------------------------------------------------------------------

import { goPackagePrivateFrom } from '../../core/infrastructure/structural-qualified-resolution.js';

describe('round 5', () => {
  it('Go: an unexported method or a method of an unexported type is private to its package', () => {
    const t = { name: 'proposeAndWait', parentClass: 'node', filePath: 'worker/proposal.go' };
    expect(goPackagePrivateFrom('dgraph/cmd/zero/zero.go', t)).toBe(true);
    expect(goPackagePrivateFrom('worker/mutation.go', t)).toBe(false);
    expect(goPackagePrivateFrom('x/y.go', { name: 'Exported', parentClass: 'Server', filePath: 'worker/s.go' })).toBe(false);
    expect(goPackagePrivateFrom('a.rs', t)).toBe(false);
  });
});

describe('chunk boundaries: oversized definitions', () => {
  it('the doc comment of an oversized exported function opens its first chunk', async () => {
    const p = new TreeSitterProvider();
    await p.init();
    const body = (n) => Array.from({ length: n }, (_, i) => `    const v${i} = compute(${i}, value, other);`).join('\n');
    const src = `export function small(a: number) {\n${body(10)}\n}\n\n/**\n * Big does a lot.\n */\nexport function big(value: number, other: number) {\n${body(80)}\n}\n`;
    const chunks = await p.parseFileToChunks(src, 'typescript', { maxChunkSize: 1200 });
    expect(chunks.some((c) => c.text.startsWith('/**\n * Big does a lot.'))).toBe(true);
    expect(chunks.find((c) => c.text.startsWith('export function small'))?.text.includes('Big does a lot')).toBe(false);
  });
});

// --- Round 6 (2026-10-04, new repos) -------------------------------------------------------------

describe('round 6', () => {
  it('Python: a call through an imported package name never reaches a method of a class', () => {
    const method = { name: 'make_response', type: 'method', parentClass: 'Flask', filePath: 'src/flask/app.py' };
    expect(pythonPackageCallOnMethod('flask.make_response', method)).toBe(true);
    expect(pythonPackageCallOnMethod('self.make_response', method)).toBe(false);
    expect(pythonPackageCallOnMethod('helpers.make_response', { ...method, type: 'function', parentClass: null, filePath: 'src/flask/helpers.py' })).toBe(false);
    // Only when the caller imports the package: a local variable named `flask` is no package.
    const heads = {
      'tests/a.py': 'import flask\n',
      'tests/b.py': 'from x import (\n  y,\n  flask,\n)\n',
      'tests/c.py': 'flask = make_app()\n',
    };
    const repo = { readFileRange: (f) => heads[f] };
    const call = (f) => StructuralContextRepository.prototype._pythonModuleCall.call(repo, 'flask.make_response', method, f);
    expect([call('tests/a.py'), call('tests/b.py'), call('tests/c.py')]).toEqual([true, true, false]);
  });
});

describe('JavaScript member-assigned functions', () => {
  it('`res.redirect = function` and `Cls.prototype.m = function` are methods of their object', async () => {
    const p = new TreeSitterProvider();
    await p.init();
    const s = await p.extractSymbols('res.redirect = function redirect(url) {\n  return url;\n};\nReply.prototype.send = function (x) {\n  return x;\n};\nmodule.exports.helper = (a) => a;\n', 'javascript');
    const e = (n) => s.find((x) => x.name === n);
    expect([e('redirect')?.type, e('redirect')?.parentClass, e('redirect')?.startLine, e('redirect')?.endLine]).toEqual(['method', 'res', 0, 2]);
    expect([e('send')?.type, e('send')?.parentClass]).toEqual(['method', 'Reply']);
    expect(e('helper')?.type).toBe('function');
  });
});

// --- Round 7 (2026-10-04) --------------------------------------------------------------------

import { applyFileKindRanking } from '../../core/ranking/file-kind-ranking.js';

describe('round 7', () => {
  it('agent format: a question about a test ranks test files above config, types and code', () => {
    const r = (file, score) => ({ file, score, startLine: 1, endLine: 20 });
    const res = [r('.github/workflows/ci.yml', 1.0), r('types/route.d.ts', 0.95), r('fastify.js', 0.9), r('test/404s.test.js', 0.8)];
    // The live hybrid path's factors (search-hybrid.js): config x0.15, docs x0.35, types x0.7.
    const live = { docFactor: 0.35, testFactor: 0.35, typeFactor: 0.7, ancillaryFactor: 0.15 };
    const out = applyFileKindRanking(res, { intent: 'tests', agentFormat: true, ...live });
    expect(out[0].file).toBe('test/404s.test.js');
    expect(applyFileKindRanking(res, { intent: 'tests', ...live })[0].file).toBe('.github/workflows/ci.yml');
  });
});

describe('round 7: intent, doc blocks, recursion', () => {
  it('agent format: a behaviour question naming a config noun still asks for code', () => {
    expect(classifyFileKindIntent('how does uv sync remove packages that are not in the lockfile', { agentFormat: true })).toBe('implementation');
    expect(classifyFileKindIntent('how do I configure the lockfile path', { agentFormat: true })).toBe('ancillary');
    expect(classifyFileKindIntent('how does uv sync remove packages that are not in the lockfile')).toBe('ancillary');
  });

  it('a JSDoc block one blank line above a definition opens its chunk', async () => {
    const p = new TreeSitterProvider();
    await p.init();
    const body = (n) => Array.from({ length: n }, (_, i) => `  var v${i} = compute(${i}, a, b);`).join('\n');
    const src = `app.handle = function handle(a, b) {\n${body(20)}\n};\n\n/**\n * Use a middleware.\n */\n\napp.use = function use(fn) {\n${body(20)}\n};\n`;
    const chunks = await p.parseFileToChunks(src, 'javascript', { maxChunkSize: 900 });
    expect(chunks.find((c) => c.text.startsWith('app.handle'))?.text.includes('Use a middleware')).toBe(false);
    expect(chunks.some((c) => c.text.startsWith('/**\n * Use a middleware.'))).toBe(true);
  });
});

import { templateFunctionType } from '../../core/graph/call-site-scanner.js';
import { nameWordsMatched } from '../../core/search/unread-symbol-ranking.js';

describe('overfit guards', () => {
  it('JS: `module.exports = function name` keeps its own name; a callback inside a function is no entity', async () => {
    const p = new TreeSitterProvider();
    await p.init();
    const s = await p.extractSymbols('module.exports = function createApp() {\n  return 1;\n};\nfunction load() {\n  xhr.onload = function () { done(); };\n}\nmodule.exports = () => 2;\n', 'javascript');
    expect(s.map((x) => [x.type, x.name])).toEqual([['function', 'createApp'], ['function', 'load']]);
  });

  it('C++: `Q::f` stays a method when the file declares class Q inside namespace Q', async () => {
    const p = new TreeSitterProvider();
    await p.init();
    const ns = await p.extractSymbols('namespace util {\nint helper(int x);\n}\nint util::helper(int x) { return x; }\n', 'cpp');
    expect(ns.find((x) => x.name === 'helper')?.type).toBe('function');
    const cls = await p.extractSymbols('namespace net {\nclass net { public: void run(); };\n}\nvoid net::run() {}\n', 'cpp');
    expect(cls.find((x) => x.name === 'run')?.type).toBe('method');
  });

  it('a name after `<` is a template function type only when its `( … )` closes with `>`', () => {
    expect(templateFunctionType('std::function<void(int)> cb', 14)).toBe(true);
    expect(templateFunctionType('Callback<int(int, int)>', 9)).toBe(true);
    expect(templateFunctionType('if (a<f(b)) x', 6)).toBe(false);
  });

  it('chunker: a license header at the top of the file is not carried onto the first definition', async () => {
    const p = new TreeSitterProvider();
    await p.init();
    const body = (n) => Array.from({ length: 30 }, (_, i) => `  const v${i} = ${n} + ${i};`).join('\n');
    const src = `/**\n * @license MIT\n */\n\nfunction a() {\n${body(1)}\n}\n\n/** Docs of b. */\nfunction b() {\n${body(2)}\n}\n`;
    const chunks = await p.parseFileToChunks(src, 'javascript', { maxChunkSize: 900 });
    const b = chunks.find((c) => /function b/.test(c.text));
    const a = chunks.find((c) => /function a/.test(c.text));
    expect(b.text.startsWith('/** Docs of b. */')).toBe(true);
    expect(a.text.includes('@license') ? a.startLine : 0).toBe(0);
  });

  it('name words: at least half of the informative words, for every name length', () => {
    expect(nameWordsMatched(1, 1)).toBe(true);
    expect(nameWordsMatched(1, 2)).toBe(true);
    expect(nameWordsMatched(1, 4)).toBe(false);
    expect(nameWordsMatched(0, 0)).toBe(false);
  });
});

import { bindCalleeOverloads } from '../../core/graph/structural-context.js';

describe('callee overloads by argument count', () => {
  const file = 'Logger.cs';
  const src = {
    1: 'void Write(Level l, string t)\n{\n  Write(l, t, None);\n  Write(l);\n}',
    10: 'void Write(Level l)',
    20: 'void Write<T>(Level l, string t, T v)',
    30: 'void Write(Level l, string t, params object[] v)',
    40: 'void Write<T0, T1>(Level l, string t, T0 a, T1 b)',
  };
  const defs = [10, 20, 30, 40].map((n) => ({ id: `w${n}`, name: 'Write', type: 'method', parentClass: 'Logger', filePath: file, startLine: n, endLine: n }));
  const repo = {
    readFileRange: (f, s) => (s === 3 ? 'Write(l, t, None);' : s === 4 ? 'Write(l);' : src[s] || ''),
    findEntityCandidates: () => [{ id: 't', name: 'Write', filePath: file, parentClass: 'Logger', startLine: 1, endLine: 5 }, ...defs],
  };
  const target = { id: 't', name: 'Write', filePath: file, parentClass: 'Logger', startLine: 1, endLine: 5 };
  it('one fitting overload is bound; several are all named', () => {
    const rows = [
      { ...defs[1], relationship: 'calls', contextLines: [3] },
      { ...defs[1], relationship: 'calls', contextLines: [4] },
    ];
    const [three, one] = bindCalleeOverloads(repo, target, rows);
    expect([three.startLine, three.overloads]).toEqual([20, [30]]);
    expect([one.startLine, one.overloads, one.contextLines]).toEqual([10, undefined, [4]]);
  });
});

import { trustedCalleeEdge } from '../../core/infrastructure/structural-qualified-resolution.js';
import { declaredTypeIn } from '../../core/graph/receiver-types.js';
import { stampGrepLineClasses } from '../../core/search/grep-line-classes.js';
import { renderGrepBody } from '../../core/search/grep-output-shaping.js';

describe('round 8', () => {
  it('callee side: `self.x(` bound to a method is trusted; `CONST.get(` to a class method is not', () => {
    const m = (name) => ({ name, type: 'method', parentClass: 'Session', filePath: 'src/requests/sessions.py' });
    expect(trustedCalleeEdge('self.merge_environment_settings', m('merge_environment_settings'))).toBe(true);
    expect(trustedCalleeEdge('DEFAULT_PORTS.get', m('get'))).toBe(false);
    expect(trustedCalleeEdge('self.helper', { name: 'helper', type: 'function', parentClass: null, filePath: 'a.py' })).toBe(false);
  });

  it('Python: `s = pkg.Cls()` types `s` when it is the only binding', () => {
    const f = 'tests/t.py';
    expect(declaredTypeIn('    def t(self):\n        s = requests.Session()\n        r = s.send(x)', 's', f)).toEqual({ type: 'Session', qualifier: 'requests' });
    expect(declaredTypeIn('        s = requests.Session()\n        s = other()\n        s.send(x)', 's', f)).toBe(null);
    expect(declaredTypeIn('        s = requests.session()\n        s.send(x)', 's', f)).toBe(null);
    expect(declaredTypeIn('        s = MAX_SIZE(3)\n        s.send(x)', 's', f)).toBe(null);
  });

  it('ss-grep: the file that defines the searched identifier lists first', () => {
    const results = [
      { file: 't/a.test.ts', line: 1, content: 'x.safeParse(1)' },
      { file: 't/a.test.ts', line: 2, content: 'x.safeParse(2)' },
      { file: 't/a.test.ts', line: 3, content: 'x.safeParse(3)' },
      { file: 'src/parse.ts', line: 80, content: 'export const safeParse = make();' },
    ];
    stampGrepLineClasses(results, {
      definedName: 'safeParse',
      isFresh: () => true,
      entitiesInFile: (f) => (f === 'src/parse.ts' ? [{ name: 'safeParse', startLine: 80, endLine: 80 }] : [{ name: 'other', startLine: 1, endLine: 9 }]),
    });
    expect(results.map((r) => !!r.defines)).toEqual([false, false, false, true]);
    const summary = { files: [{ file: 't/a.test.ts', total: 3, kept: 3 }, { file: 'src/parse.ts', total: 1, kept: 1 }], hiddenFileCount: 0, hiddenMatchCount: 0, hiddenSample: [] };
    const body = renderGrepBody(results, summary, 20, { alloc: 'weight' });
    expect(body.rows[0].file).toBe('src/parse.ts');
  });
});

describe('round 9', () => {
  it('a bare call reaches an inherited method of the nearest supertype', () => {
    const caller = { id: 'c', name: 'didFailToCreateUploadable', file_path: 'Source/UploadRequest.swift', start_line: 102, end_line: 108, parent_class: 'UploadRequest' };
    const target = { id: 't', name: 'retryOrFinish', type: 'method', file_path: 'Source/Request.swift', start_line: 543, end_line: 558, parent_class: 'Request' };
    const other = { id: 'o', name: 'retryOrFinish', type: 'method', file_path: 'Source/Other.swift', start_line: 1, end_line: 5, parent_class: 'Other' };
    const supers = new Map([['UploadRequest', new Set(['DataRequest'])], ['DataRequest', new Set(['Request'])]]);
    const index = {
      ownerOf: (e) => e.parent_class || null,
      importsOf: () => null,
      directSupertypesOf: (n) => supers.get(n) || new Set(),
    };
    expect(resolveBareCall(caller, [target, other], index).map((c) => c.id)).toEqual(['t']);
    expect(resolveBareCall({ ...caller, parent_class: 'Unrelated' }, [target, other], index)).toEqual([]);
  });
});

import { CallSiteScanner } from '../../core/graph/call-site-scanner.js';

describe('round 10', () => {
  it('Elixir / Ruby: a one-line `do:` clause or `def f; end` spans its own line', () => {
    const g = Object.create(GraphExtractor.prototype);
    const kw = ['defmodule', 'defmacro', 'defp', 'def', 'fn', 'if', 'unless', 'case', 'cond', 'with', 'try', 'receive'];
    const L = ['  def a(x) when x > 1 do', '    raise E', '  end', '', '  def a(%C{} = c, nil), do: c', '  def b(x) do', '    if x, do: 1, else: 2', '    case x do', '      1 -> :a', '    end', '  end', 'end'];
    expect([0, 4, 5].map((i) => g.findEndLineKeyword(L, i, 'end', kw))).toEqual([3, 5, 11]);
    expect(g.findEndLineKeyword(['  def a; end', 'end'], 0, 'end', ['def'])).toBe(1);
  });

  it('call scanner: `&& f(` and `a * f(` are calls; `T *f(` is a declarator; chains with nested args', () => {
    const scan = (lang, l) => {
      const s = new CallSiteScanner({ id: lang, comment: { line: '//', block: ['/*', '*/'] } });
      const bare = []; const qual = [];
      s.scanLine(l, (n) => qual.push(n), (n) => bare.push(n));
      return { bare, qual };
    };
    expect(scan('c', '  if (n > 0 && redisReaderFeed(r, b, n) != OK) {').bare).toEqual(['redisReaderFeed']);
    expect(scan('c', '  x = a * compute(b);').bare).toEqual(['compute']);
    expect(scan('c', 'static redisContext *redisContextInit(void) {').bare).toEqual([]);
    expect(scan('dart', '  var h = const Pipeline().addMiddleware(createMiddleware()).addHandler(').qual).toContain('addMiddleware().addHandler');
  });

  it('Elixir: a bare call reaches a function of an imported module', () => {
    const caller = { id: 'c', name: 'test', file_path: 'test/conn_test.exs', start_line: 60, end_line: 70, parent_class: 'Plug.ConnTest' };
    const target = { id: 't', name: 'merge_assigns', type: 'function', file_path: 'lib/plug/conn.ex', start_line: 335, end_line: 337, parent_class: 'Plug.Conn' };
    const index = {
      ownerOf: (e) => e.parent_class || null,
      importsOf: () => null,
      moduleImportsOf: (f) => (f === 'test/conn_test.exs' ? new Set(['Plug.Conn']) : null),
    };
    expect(resolveBareCall(caller, [target], index).map((c) => c.id)).toEqual(['t']);
    expect(resolveBareCall({ ...caller, file_path: 'test/other_test.exs' }, [target], index)).toEqual([]);
  });
});

describe('round 10 — other definitions', () => {
  it('an ownerless definition in the traced file names itself when owners are listed', () => {
    const r = {
      symbol: 'from_str',
      target: { name: 'from_str', type: 'method', filePath: 'src/de.rs', startLine: 96, endLine: 98 },
      disambiguation: [
        { name: 'from_str', owner: 'Number', file: 'src/de.rs', startLine: 1299 },
        { name: 'from_str', owner: null, file: 'src/de.rs', startLine: 2709 },
      ],
      sections: { callers: { total: 0, items: [] }, callees: { total: 0, items: [] }, impact: { paths: [] } },
    };
    expect(formatTraceCompact(r)).toContain('Number.from_str 1299, from_str 2709');
  });
});

describe('round 11 — Elixir clauses, heads and heredocs', () => {
  const spans = async (src) => {
    const r = await new GraphExtractor({}).extractFromFile('lib/a.ex', src.join('\n'));
    return r.entities.filter((e) => e.type !== 'module').map((e) => `${e.name} ${e.start_line}-${e.end_line}`);
  };

  it('adjacent clauses of one name and arity are one function; another arity stays apart', async () => {
    expect(await spans([
      'defmodule A do',
      '  @spec put_status(t, status) :: t',
      '  def put_status(%{state: s}, _status) when s != :unset do',
      '    raise "sent"',
      '  end',
      '',
      '  def put_status(conn, nil), do: %{conn | status: nil}',
      '  def put_status(conn, status), do: %{conn | status: status}',
      '  defp empty?(""), do: true',
      '  defp empty?([]), do: true',
      '  def g(x), do: x',
      '  def g(x, y), do: y',
      'end',
    ])).toEqual(['put_status 3-8', 'empty? 9-10', 'g 11-11', 'g 12-12']);
  });

  it('a bodiless head ends on its line and joins its clauses (defaults count toward arity)', async () => {
    expect(await spans([
      'defmodule A do',
      '  def send_resp(conn)',
      '  def send_resp(%{state: :unset}) do',
      '    1',
      '  end',
      '  def f(a, b \\\\ 1)',
      '',
      '  def f(a, b) do',
      '    a',
      '  end',
      '  def put(conn, key)',
      '      when is_binary(key) do',
      '    1',
      '  end',
      'end',
    ])).toEqual(['send_resp 2-5', 'f 6-10', 'put 11-14']);
  });

  it('`if a,\\n do: b` opens no block; `x = case y do` closes its own end; guard then `do:` on later lines', async () => {
    expect(await spans([
      'defmodule A do',
      '  defp k(<<h, t::binary>>, acc)',
      '       when h in [1],',
      '       do: skip(t, acc)',
      '  def b(x) do',
      '    y = case x do',
      '      1 -> 2',
      '    end',
      '    if y,',
      '      do: 1,',
      '      else: 2',
      '    Enum.map(x, fn z -> z end)',
      '  end',
      '  def c(x), do: x',
      'end',
    ])).toEqual(['k 2-4', 'b 5-13', 'c 14-14']);
  });

  it('a `def … do` inside a @doc heredoc is not a definition', async () => {
    expect(await spans([
      'defmodule A do',
      '  @doc """',
      '      def call(conn, _opts) do',
      '        conn',
      '      end',
      '  """',
      '  def call(conn, _opts), do: conn',
      'end',
    ])).toEqual(['call 7-7']);
  });
});

describe('round 11 — chained calls on deep or parenthesised receivers', () => {
  const scan = (language, line) => {
    const out = [];
    new CallSiteScanner({ id: language }).scanLine(line, (n) => out.push(n));
    return out;
  };

  it('`(await handler(x)).readAsString(` is a call on handler()\'s result (shelf tests)', () => {
    expect(scan('dart', "expect(await (await handler(_get('/'))).readAsString(), equals('1'));")).toContain('handler().readAsString');
    expect(scan('javascript', 'return (new Foo(1)).bar();')).toEqual(['Foo().bar']);
  });

  it('arguments nested more than one level still give the chained call', () => {
    expect(scan('javascript', 'const x = a(b(c(d))).run(1);')).toEqual(['a().run']);
  });

  it('a parenthesised expression that is no single call, or a keyword before the group, gives nothing', () => {
    expect(scan('javascript', 'const y = (a + b).run(2);')).toEqual([]);
    expect(scan('java', 'if (x).y(')).toEqual([]);
  });
});

describe('round 11 — OCaml calls, Scala/Lua spans, local values', () => {
  const extract = async (file, src) => new GraphExtractor({}).extractFromFile(file, src.join('\n'));
  const spans = (r) => r.entities.map((e) => `${e.type} ${e.name} ${e.start_line}-${e.end_line}`);

  it('OCaml: calls by juxtaposition are read from the tree; a local `let … in` is no definition', async () => {
    const r = await extract('lib/parser.ml', [
      'let rec parse_list acc = function',
      '  | [] -> acc',
      '  | x :: xs -> let s = Unescape.unescape x in parse_list (s :: acc) xs',
      'and parse = function _ -> parse_list [] []',
    ]);
    expect(r.entities.map((e) => e.name)).toEqual(['parse_list', 'parse']);
    expect(r.relationships.filter((x) => x.type === 'calls').map((x) => `${x.target_name}@${x.context_line}`)).toEqual(['Unescape.unescape@3']);
    expect((r.callSites || []).filter((c) => c.callee_name === 'parse_list').map((c) => c.context_line)).toEqual([3, 4]);
  });

  it('Scala: abstract and expression-bodied defs end at their header or indented body; block bodies count braces', async () => {
    const r = await extract('os/A.scala', [
      'trait Reader {',
      '  def readInt(): Int',
      '  def readLine() = buffered.readLine()',
      '  def isLink(mode: Int): Boolean =',
      '    (mode & 1) == 1',
      '  def bytes: Array[Byte] = synchronized {',
      '    transfer(a, b)',
      '  }',
      '  def /(chunk: String): Reader = this',
      '}',
      '@deprecated("this class will be made final", "1")',
      'case class Point(x: Int, y: Int)',
    ]);
    expect(spans(r)).toEqual([
      'trait Reader 1-10', 'def readInt 2-2', 'def readLine 3-3', 'def isLink 4-5', 'def bytes 6-8', 'def / 9-9', 'class Point 12-12',
    ]);
  });

  it('Zig: a `const` inside a function body is local, so the call on its line belongs to the function', async () => {
    const r = await extract('src/response.zig', [
      'pub fn setCookie(self: *Response, name: []const u8) !void {',
      '    const serialized = try serializeCookie(self.arena, name);',
      '    self.header("Set-Cookie", serialized);',
      '}',
      'pub const max = 10;',
    ]);
    expect(r.entities.map((e) => e.name)).toEqual(['setCookie', 'max']);
  });

  it('Lua: an inline `function … end)` does not close the enclosing function', async () => {
    const r = await extract('busted/execute.lua', [
      'local function sort(elements)',
      '  table.sort(elements, function(t1, t2)',
      "    if t1.name then return t1.name < t2.name end -- end",
      '    return t2.name ~= nil',
      '  end)',
      '  return elements',
      'end',
      'local s = [[ function end ]]',
    ]);
    expect(spans(r)).toContain('function sort 1-7');
  });
});

describe('round 12 — named function expressions are definitions', () => {
  it('argument, `&&`, return and `const f = function` forms (axios dispatchHttpRequest)', async () => {
    const p = new TreeSitterProvider();
    const syms = await p.extractSymbols([
      'export default ok && function httpAdapter(config) {',
      '  return wrapAsync(async function dispatchHttpRequest(resolve) {',
      '    buildFullPath(config);',
      '  });',
      '}',
      'const k = function () {};',
    ].join('\n'), 'javascript');
    expect(syms.map((s) => `${s.name} ${s.startLine}-${s.endLine}`)).toEqual(expect.arrayContaining([
      'httpAdapter 0-4', 'dispatchHttpRequest 1-3', 'k 5-5', // 0-based rows
    ]));
  });
});

describe('round 12 — super calls', () => {
  it('Python `super().m(` is stored as super.m', () => {
    const out = [];
    new CallSiteScanner({ id: 'python' }).scanLine('        return super().lookup_default(name, call)', (n) => out.push(n));
    expect(out).toEqual(['super.lookup_default']);
  });

  it('super.m binds only to a supertype of the caller\'s type; an external parent gives no edge', async () => {
    const { narrowCallCandidates } = await import('../../core/graph/relationship-resolver.js');
    const ctxM = { id: 'a', name: 'lookup_default', parent_class: 'Context', file_path: 'core.py' };
    const pager = { id: 'b', name: 'write', parent_class: '_PagerWriter', file_path: 'termui.py' };
    const idx = {
      ownerOf: (e) => e.parent_class || null,
      supertypesOf: (t) => (t === 'CustomContext' ? new Set(['Context']) : new Set()),
    };
    expect(narrowCallCandidates([ctxM], 'super', { id: 's', parent_class: 'CustomContext', file_path: 't.py' }, idx)).toEqual([ctxM]);
    expect(narrowCallCandidates([pager], 'super', { id: 's2', parent_class: 'RecordingStream', file_path: 't.py' }, idx)).toEqual([]);
  });
});

describe('round 13 — private members, abstract declarations, C# tuple returns', () => {
  it('TS `#dispatch(` is a method of its class', async () => {
    const syms = await new TreeSitterProvider().extractSymbols([
      'class Hono {',
      '  #dispatch(request: Request) {',
      '    return compose(this.routes)(request)',
      '  }',
      '}',
    ].join('\n'), 'typescript');
    expect(syms.map((s) => `${s.type} ${s.name} ${s.parentClass || ''}`.trim())).toContain('method #dispatch Hono');
  });

  it('C# regex fallback: a method returning a tuple or a spaced generic is a method', async () => {
    const { LANGUAGES } = await import('../../core/infrastructure/language-patterns/registry.js');
    const re = LANGUAGES.csharp.graph.entities.method;
    expect('    private (PipelineComponent Component, List<CancellationToken> Tokens) CreateBuilder()'.match(re)?.[1]).toBe('CreateBuilder');
    expect('    public static Dictionary<string, int> Map(int a)'.match(re)?.[1]).toBe('Map');
    expect('        return Foo(x);'.match(re)).toBeNull();
  });
});

describe('overnight audit — fresh-repo regressions (scala-xml, ecto)', () => {
  const extract = async (file, src) => new GraphExtractor({}).extractFromFile(file, src.join('\n'));
  const spans = (r) => r.entities.map((e) => `${e.type} ${e.name} ${e.start_line}-${e.end_line}`);

  it('Scala: a header continued on later lines (`extends` / `with` / a lone `{`) keeps its body', async () => {
    const r = await extract('xml/MetaData.scala', [
      'abstract class MetaData',
      '  extends AbstractIterable[MetaData]',
      '  with Equality',
      '{',
      '  def isNull: Boolean = this.eq(Null)',
      '}',
      'class Parser(val input: Source)',
      '  extends Handler',
      '  with Markup',
      'sealed abstract class Decl',
      'class Loader(x: Int)',
      '    extends Base(x) {',
      '  def load() = read()',
      '}',
    ]);
    expect(spans(r)).toEqual(expect.arrayContaining([
      'class MetaData 1-6', 'class Parser 7-9', 'class Decl 10-10', 'class Loader 11-14',
    ]));
  });

  it('Scala: `package object` and annotations with type arguments or nested parentheses are definitions', async () => {
    const r = await extract('xml/package.scala', [
      'package object xml {',
      '  val Name = "x"',
      '}',
      '@throws[IOException] def readAll(): String = in.read()',
      '@deprecated("use g (not f)", "2.0") def f(): Int = 1',
    ]);
    expect(r.entities.map((e) => `${e.type} ${e.name}`)).toEqual(expect.arrayContaining(['object xml', 'def readAll', 'def f']));
  });

  it('Elixir: a `fn:` keyword key opens no block', async () => {
    const r = await extract('lib/a.ex', [
      'defmodule A do',
      '  def opts(x) do',
      '    [fn: x, other: 1]',
      '  end',
      '',
      '  def next(y), do: y',
      'end',
    ]);
    expect(spans(r)).toEqual(expect.arrayContaining(['function opts 2-4']));
  });
});

describe('round 16 — an unbound qualified call fits several same-named definitions', () => {
  it('`$repository->findPackages(` is no caller of RepositorySet.findPackages when ArrayRepository has one too', () => {
    const target = { id: 't', name: 'findPackages', filePath: 'src/Repository/RepositorySet.php', parentClass: 'RepositorySet' };
    const rival = { id: 'r', name: 'findPackages', filePath: 'src/Repository/ArrayRepository.php', parentClass: 'ArrayRepository' };
    const fixture = { id: 'x', name: 'findPackages', filePath: 'tests/Repository/FakeRepository.php', parentClass: 'FakeRepository' };
    const edge = { targetName: 'repository.findPackages', filePath: 'src/Repository/CompositeRepository.php', targetId: null };
    expect(trustedCallerEdge(edge, target, [target, fixture])).toBe(true);
    expect(trustedCallerEdge(edge, target, [target, rival])).toBe(false);
    // Bound by the index, or named by the exact owner: trusted as before.
    expect(trustedCallerEdge({ ...edge, targetName: 'repositorySet.findPackages' }, target, [target, rival])).toBe(true);
  });
});

import { declaredTypeIn as declaredTypeInR15 } from '../../core/graph/receiver-types.js';
import { aliasTargetIn } from '../../core/graph/relationship-resolver.js';

describe('round 14/15 — C++ receiver types, aliases, fields, values named like functions', () => {
  it('C++ parameters and locals declare their receiver type; `auto` and products declare none', () => {
    const t = (src, n) => declaredTypeInR15(src, n, 'lib/src/HttpServer.cc');
    expect(t('void HttpServer::onRequests(\n    const TcpConnectionPtr &conn,\n    int n)\n{\n  conn->send(x);', 'conn')?.type).toBe('TcpConnectionPtr');
    expect(t('void f(const std::shared_ptr<HttpRequestParser> &p) {', 'p')?.type).toBe('HttpRequestParser');
    expect(t('  trantor::EventLoop loop;\n  loop.run();', 'loop')).toEqual({ type: 'EventLoop', qualifier: 'trantor' });
    expect(t('  x = A * b;\n  b.go();', 'b')).toBeNull();
    expect(t('  auto conn = get(); conn->send();', 'conn')).toBeNull();
  });

  it('an alias resolves to the type it names (smart pointers forward to the pointee)', () => {
    expect(aliasTargetIn('using TcpConnectionPtr = std::shared_ptr<TcpConnection>;', 'TcpConnectionPtr')).toBe('TcpConnection');
    expect(aliasTargetIn('typedef std::shared_ptr<Foo> FooPtr;', 'FooPtr')).toBe('Foo');
    expect(aliasTargetIn('using A = trantor::TcpConnectionPtr;', 'A')).toBe('TcpConnectionPtr');
    expect(aliasTargetIn('type Result<T> = std::result::Result<T, Error>;', 'Result')).toBeNull();
    expect(aliasTargetIn('export type Opts = { a: string }', 'Opts')).toBeNull();
  });

  it('a field of the caller\'s own type declares the receiver (`self.cmd.get_arguments()`)', () => {
    expect(declaredTypeInR15("pub(crate) struct Parser<'cmd> {\n    cmd: &'cmd mut Command,\n}", 'cmd', 'src/parser.rs')?.type).toBe('Command');
    expect(declaredTypeInR15('class Svc {\n  private final Database db;\n}', 'db', 'src/Svc.java')?.type).toBe('Database');
  });
});

describe('round 15 — JS/TS private member calls', () => {
  it('`this.#fetch()` is a call of the #fetch method', async () => {
    const r = await new GraphExtractor({}).extractFromFile('source/core/Ky.ts', [
      'class Ky {',
      '  async #retry() {',
      '    try { return await this.#fetch(); } catch (e) { return this.#retryFromError(e); }',
      '  }',
      '  async #fetch() { return 1 }',
      '  async #retryFromError(e) { return 2 }',
      '}',
    ].join('\n'));
    expect(r.relationships.filter((x) => x.type === 'calls').map((x) => `${x.target_name}@${x.context_line}`))
      .toEqual(['this.#fetch@3', 'this.#retryFromError@3']);
  });
});

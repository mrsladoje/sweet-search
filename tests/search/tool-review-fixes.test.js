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

  it('root unit/ and acceptance/ are test trees; a nested unit/ is not', () => {
    expect(isTestLikePath('unit/LoadBalancer/X.cs')).toBe(true);
    expect(isTestLikePath('acceptance/LoadBalancer/T.cs')).toBe(true);
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
import { shouldTrustQualifiedResolution, trustedCallerEdge } from '../../core/infrastructure/structural-qualified-resolution.js';

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
  it('Python: a call through a package name never reaches a method of a class', () => {
    const method = { name: 'make_response', type: 'method', parentClass: 'Flask', filePath: 'src/flask/app.py' };
    expect(shouldTrustQualifiedResolution('flask.make_response', method)).toBe(false);
    expect(trustedCallerEdge({ targetName: 'flask.make_response', targetId: 'm', filePath: 'tests/test_basic.py' }, { ...method, id: 'm' })).toBe(false);
    expect(shouldTrustQualifiedResolution('helpers.make_response', { name: 'make_response', type: 'function', parentClass: null, filePath: 'src/flask/helpers.py' })).toBe(true);
  });
});

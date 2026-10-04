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

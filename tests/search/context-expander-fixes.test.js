/**
 * Focused tests for the May-2026 context-expander fixes:
 *   1. Multi-line import extraction (CommonJS aliased destructure, ES braces,
 *      Go import block, Rust grouped use) inside extractHeaderContext.
 *   2. Leading-trivia inclusion (JSDoc, Rust ///, Python decorators, Rust
 *      attributes like #[non_exhaustive]) inside expandLeadingTrivia /
 *      expandToSymbol.
 *   3. Tightened computeSufficiency — no more "complete + high_confidence"
 *      auto-pass when the body has unresolved external identifiers.
 *   4. Graph-neighbour reservation rendering (renderGraphNeighbors).
 *   5. End-to-end: packageForAgent surfaces neighbours and threads through
 *      sufficiency.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import {
  computeSufficiency,
  extractHeaderContext,
  expandLeadingTrivia,
  renderGraphNeighbors,
  packageForAgent,
} from '../../core/search/context-expander.js';

// ──────────────────────────────────────────────────────────────────────────
// Multi-line import extraction
// ──────────────────────────────────────────────────────────────────────────

describe('extractHeaderContext (multi-line imports)', () => {
  let tmp, projectRoot;
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ctx-imports-'));
    projectRoot = tmp;
  });
  afterAll(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } });

  function write(rel, body) {
    const full = join(projectRoot, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
    return rel;
  }

  it('keeps multi-line CommonJS destructured require with alias mappings', () => {
    const rel = write('lib/validation.js', [
      "'use strict'",
      '',
      "const {",
      "  kSchemaParams: paramsSchema,",
      "  kSchemaBody: bodySchema,",
      "  kSchemaQuerystring: querystringSchema,",
      "  kSchemaHeaders: headersSchema",
      "} = require('./symbols')",
      '',
      'function validate () {}',
      '',
    ].join('\n'));
    // The body uses the aliases, so extractHeaderContext should keep the
    // import line that maps them back to kSchema*.
    const code = "function validate () { return paramsSchema && bodySchema && querystringSchema && headersSchema }";
    const { headerContext } = extractHeaderContext(code, new Map(), rel, projectRoot);
    expect(headerContext, 'should retain multi-line CJS destructure').toBeTruthy();
    expect(headerContext).toMatch(/kSchemaParams/);
    expect(headerContext).toMatch(/kSchemaBody/);
    expect(headerContext).toMatch(/paramsSchema/);
    expect(headerContext).toMatch(/require\('\.\/symbols'\)/);
  });

  it('keeps multi-line ES brace import', () => {
    const rel = write('src/foo.ts', [
      'import {',
      '  validateRequest,',
      '  validateResponse,',
      "} from './validation';",
      '',
      'export function entry() { return validateRequest(); }',
    ].join('\n'));
    const code = 'export function entry() { return validateRequest(); }';
    const { headerContext } = extractHeaderContext(code, new Map(), rel, projectRoot);
    expect(headerContext).toBeTruthy();
    expect(headerContext).toMatch(/validateRequest/);
    expect(headerContext).toMatch(/from\s+['"]\.\/validation['"]/);
  });

  it('keeps Go import block with aliases', () => {
    const rel = write('main.go', [
      'package main',
      '',
      'import (',
      '\t"net/http"',
      '\tlog2 "log/slog"',
      '\t"path"',
      ')',
      '',
      'func handler() { http.ListenAndServe(":80", nil); log2.Info("up") }',
    ].join('\n'));
    const code = 'func handler() { http.ListenAndServe(":80", nil); log2.Info("up") }';
    const { headerContext } = extractHeaderContext(code, new Map(), rel, projectRoot);
    expect(headerContext).toBeTruthy();
    expect(headerContext).toMatch(/net\/http/);
    expect(headerContext).toMatch(/log2/);
  });

  it('keeps Rust grouped use declaration', () => {
    const rel = write('src/lib.rs', [
      'use std::{',
      '    collections::HashMap,',
      '    sync::atomic::AtomicBool,',
      '};',
      '',
      'pub fn run() { let _ = HashMap::<String, AtomicBool>::new(); }',
    ].join('\n'));
    const code = 'pub fn run() { let _ = HashMap::<String, AtomicBool>::new(); }';
    const { headerContext } = extractHeaderContext(code, new Map(), rel, projectRoot);
    expect(headerContext).toBeTruthy();
    expect(headerContext).toMatch(/HashMap/);
    expect(headerContext).toMatch(/AtomicBool/);
  });

  it('keeps Python multi-line parenthesised from-import', () => {
    const rel = write('src/foo.py', [
      'from os.path import (',
      '    join,',
      '    dirname,',
      ')',
      '',
      'def entry(): return join(dirname("a"), "b")',
    ].join('\n'));
    const code = 'def entry(): return join(dirname("a"), "b")';
    const { headerContext } = extractHeaderContext(code, new Map(), rel, projectRoot);
    expect(headerContext).toBeTruthy();
    expect(headerContext).toMatch(/join/);
    expect(headerContext).toMatch(/dirname/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Leading-trivia inclusion
// ──────────────────────────────────────────────────────────────────────────

describe('expandLeadingTrivia', () => {
  let tmp;
  beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'ctx-trivia-')); });
  afterAll(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } });

  function write(rel, body) {
    const full = join(tmp, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
    return rel;
  }

  it('absorbs Rust /// doc comments and #[non_exhaustive] above an enum', () => {
    const rel = write('src/error.rs', [
      'use std::fmt;',                          // 1
      '',                                        // 2
      '/// All the kinds of regex errors.',      // 3
      '///',                                      // 4
      '/// `Self` is non-exhaustive on purpose.', // 5
      '#[non_exhaustive]',                       // 6
      '#[derive(Debug)]',                        // 7
      'pub enum ErrorKind {',                    // 8 ← entity start
      '    Syntax,',                             // 9
      '    NotAllowed,',                         // 10
      '}',                                       // 11
    ].join('\n'));
    const adjusted = expandLeadingTrivia(rel, 8, new Map(), tmp, 'rust');
    // Expect adjustment to absorb all of lines 3-7
    expect(adjusted).toBe(3);
  });

  it('absorbs JSDoc above a JS function', () => {
    const rel = write('src/foo.js', [
      "'use strict';",          // 1
      '',                        // 2
      '/**',                     // 3
      ' * The validator.',       // 4
      ' * @returns {boolean}',   // 5
      ' */',                     // 6
      'function validate() {}',  // 7  ← entity start
    ].join('\n'));
    const adjusted = expandLeadingTrivia(rel, 7, new Map(), tmp, 'javascript');
    expect(adjusted).toBe(3);
  });

  it('absorbs Python decorators and a leading comment', () => {
    const rel = write('src/foo.py', [
      'from x import y',         // 1
      '',                         // 2
      '# Bind to the framework',  // 3
      '@app.route("/")',          // 4
      '@requires_auth',           // 5
      'def handler():',           // 6  ← entity start
      '    pass',                 // 7
    ].join('\n'));
    const adjusted = expandLeadingTrivia(rel, 6, new Map(), tmp, 'python');
    expect(adjusted).toBe(3);
  });

  it('does not cross over an unrelated code line', () => {
    const rel = write('src/bar.js', [
      'const x = 1;',           // 1
      '/** nope */',             // 2  ← trivia adjacent to code above
      'function foo() {}',       // 3
    ].join('\n'));
    const adjusted = expandLeadingTrivia(rel, 3, new Map(), tmp, 'javascript');
    expect(adjusted).toBe(2); // only the comment, not line 1's code
  });

  it('returns base line unchanged when there is no trivia', () => {
    const rel = write('src/baz.js', [
      'const x = 1;',
      'function foo() {}',
    ].join('\n'));
    const adjusted = expandLeadingTrivia(rel, 2, new Map(), tmp, 'javascript');
    expect(adjusted).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Tightened sufficiency
// ──────────────────────────────────────────────────────────────────────────

describe('computeSufficiency (tightened)', () => {
  it('does NOT mark as sufficient when body has unresolved external calls and no header/neighbours', () => {
    // Older behaviour: complete + high_confidence ⇒ sufficient (auto self-contained).
    // New behaviour: must have header_resolved OR neighbors_present OR
    // strict self-containment (no unresolved externals).
    const top = {
      symbol: 'validate',
      presentation: 'full',
      code: 'function validate() {\n  return validateParam(paramsSchema) && wrapValidationError(x);\n}',
      headerContext: null,
      neighbors: null,
    };
    const { sufficient, reasons, unresolvedExternalCount } = computeSufficiency(top, { confidence: 'high' });
    expect(sufficient).toBe(false);
    expect(reasons).toContain('complete_symbol');
    expect(reasons).toContain('high_confidence');
    expect(reasons).not.toContain('self_contained_strict');
    expect(unresolvedExternalCount).toBeGreaterThan(0);
  });

  it('IS sufficient when complete + neighbors_present resolves the externals', () => {
    const top = {
      symbol: 'validate',
      presentation: 'full',
      code: 'function validate() { return validateParam(paramsSchema) && wrapValidationError(x); }',
      headerContext: null,
      neighbors: {
        rendered: '- calls validateParam → lib/validation.js:118-144 [function]\n- imports paramsSchema → lib/symbols.js:14 [Symbol]\n- calls wrapValidationError → lib/errors.js:8-22 [function]',
        count: 3,
        tokens: 30,
      },
    };
    const { sufficient, reasons } = computeSufficiency(top, { confidence: 'high' });
    expect(sufficient).toBe(true);
    expect(reasons).toContain('neighbors_present');
  });

  it('IS sufficient when truly self-contained (only locally-declared identifiers)', () => {
    const top = {
      symbol: 'sum',
      presentation: 'full',
      code: 'function sum(a, b) {\n  const result = a + b;\n  return result;\n}',
      headerContext: null,
      neighbors: null,
    };
    const { sufficient, reasons, unresolvedExternalCount } = computeSufficiency(top, { confidence: 'high' });
    expect(unresolvedExternalCount).toBe(0);
    expect(reasons).toContain('self_contained_strict');
    expect(sufficient).toBe(true);
  });

  it('does NOT mark sufficient on truncated symbols', () => {
    const top = {
      symbol: 'big',
      presentation: 'full',
      code: 'function big() {\n  // body...\n  // ... (50 more lines)',
      headerContext: 'import { dep } from "./x"',
    };
    const { sufficient, reasons } = computeSufficiency(top, { confidence: 'high' });
    expect(reasons).not.toContain('complete_symbol');
    expect(sufficient).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Graph-neighbour reservation
// ──────────────────────────────────────────────────────────────────────────

describe('renderGraphNeighbors', () => {
  function mockRepo({ outgoing = [], incoming = [] } = {}) {
    return {
      getOutgoingRelationships: () => outgoing,
      getIncomingRelationships: () => incoming,
    };
  }

  it('renders compact one-liners with file:line and edge type', () => {
    const repo = mockRepo({
      outgoing: [
        {
          type: 'imports', targetName: 'paramsSchema', targetId: 'eP',
          contextLine: 7, fullImportPath: null,
          target: { id: 'eP', name: 'paramsSchema', type: 'Symbol',
            filePath: 'lib/symbols.js', startLine: 14, endLine: 14 },
        },
        {
          type: 'calls', targetName: 'validateParam', targetId: 'eVP',
          contextLine: 150, fullImportPath: null,
          target: { id: 'eVP', name: 'validateParam', type: 'function',
            filePath: 'lib/validation.js', startLine: 118, endLine: 144 },
        },
      ],
      incoming: [
        {
          type: 'calls', contextLine: 94,
          source: { id: 'eHR', name: 'handleRequest', type: 'function',
            filePath: 'lib/handle-request.js', startLine: 88, endLine: 104 },
        },
      ],
    });
    const out = renderGraphNeighbors({
      codeGraphRepo: repo,
      entity: { id: 'eVal', filePath: 'lib/validation.js', startLine: 146, endLine: 203, name: 'validate', type: 'function' },
      skipKeys: new Set(),
      tokenCap: 600,
    });
    expect(out).not.toBeNull();
    expect(out.count).toBe(3);
    expect(out.rendered).toMatch(/imports paramsSchema → lib\/symbols\.js:14/);
    expect(out.rendered).toMatch(/calls validateParam → lib\/validation\.js:118-144/);
    expect(out.rendered).toMatch(/caller handleRequest ← lib\/handle-request\.js:88-104/);
    expect(out.tokens).toBeGreaterThan(0);
    expect(out.tokens).toBeLessThanOrEqual(600);
  });

  it('dedupes against skipKeys (already in pack)', () => {
    const repo = mockRepo({
      outgoing: [
        {
          type: 'calls', targetName: 'helper', targetId: 'eH', contextLine: 5, fullImportPath: null,
          target: { id: 'eH', name: 'helper', type: 'function',
            filePath: 'lib/x.js', startLine: 10, endLine: 30 },
        },
      ],
    });
    const skip = new Set(['lib/x.js|10|30']);
    const out = renderGraphNeighbors({
      codeGraphRepo: repo,
      entity: { id: 'e1', filePath: 'lib/y.js', startLine: 1, endLine: 5, name: 'caller', type: 'function' },
      skipKeys: skip,
      tokenCap: 600,
    });
    expect(out).toBeNull();
  });

  it('hard-caps at tokenCap by trimming tail rows', () => {
    const outgoing = Array.from({ length: 12 }, (_, i) => ({
      type: 'calls', targetName: `helper${i}`, targetId: `e${i}`, contextLine: i, fullImportPath: null,
      target: { id: `e${i}`, name: `helper${i}`, type: 'function',
        filePath: `lib/h${i}.js`, startLine: 1, endLine: 5 },
    }));
    const repo = mockRepo({ outgoing });
    const tight = renderGraphNeighbors({
      codeGraphRepo: repo,
      entity: { id: 'e', filePath: 'lib/y.js', startLine: 1, endLine: 1, name: 'top', type: 'function' },
      skipKeys: new Set(),
      tokenCap: 30,
    });
    expect(tight).not.toBeNull();
    expect(tight.tokens).toBeLessThanOrEqual(30);
    expect(tight.count).toBeLessThan(12);
  });

  it('returns null when there are no neighbours', () => {
    const out = renderGraphNeighbors({
      codeGraphRepo: mockRepo({}),
      entity: { id: 'e', filePath: 'lib/y.js', startLine: 1, endLine: 1, name: 'top', type: 'function' },
      skipKeys: new Set(),
      tokenCap: 600,
    });
    expect(out).toBeNull();
  });

  it('surfaces TYPE definitions by name from the body code', () => {
    // Simulates the gin:http-dispatch fix: a method's body references a
    // type (`methodTree`) that the relationships table doesn't carry as
    // an explicit edge. The body-driven name lookup must surface it.
    const repo = {
      getOutgoingRelationships: () => ([
        // The graph only knows about a `getValue` call — no edge for methodTree.
        {
          type: 'calls', targetName: 'getValue', targetId: 'eGV', contextLine: 715, fullImportPath: null,
          target: { id: 'eGV', name: 'getValue', type: 'function',
            filePath: 'tree.go', startLine: 230, endLine: 320 },
        },
      ]),
      getIncomingRelationships: () => ([]),
      findEntitiesByNames: (names, opts) => {
        // Mirror the real signature: return name-and-type matches.
        // Range-level dedup happens in renderGraphNeighbors via skipKeys.
        const have = [
          { id: 'eMT', name: 'methodTree', type: 'struct',
            filePath: 'tree.go', startLine: 45, endLine: 49 },
          { id: 'eMTS', name: 'methodTrees', type: 'type',
            filePath: 'tree.go', startLine: 50, endLine: 50 },
          { id: 'eEng', name: 'Engine', type: 'struct',
            filePath: 'gin.go', startLine: 92, endLine: 191 },
        ];
        const wantNames = new Set(names);
        const wantTypes = new Set(opts?.types || []);
        return have.filter(h =>
          wantNames.has(h.name)
          && (!wantTypes.size || wantTypes.has(h.type))
        );
      },
    };
    const out = renderGraphNeighbors({
      codeGraphRepo: repo,
      entity: { id: 'eHHR', filePath: 'gin.go',
        startLine: 690, endLine: 762, name: 'handleHTTPRequest', type: 'method' },
      skipKeys: new Set(),
      tokenCap: 600,
      body: 'func (engine *Engine) handleHTTPRequest(c *Context) {\n' +
            '  trees := engine.trees\n' +
            '  for i := range trees {\n' +
            '    if trees[i].method == httpMethod {\n' +
            '      root := trees[i].root\n' +
            '      var t methodTree // local for clarity\n' +
            '      _ = t\n' +
            '    }\n' +
            '  }\n' +
            '}',
    });
    expect(out).not.toBeNull();
    expect(out.typeRefCount).toBeGreaterThanOrEqual(1);
    // methodTree is in tree.go — surfaces directly
    expect(out.rendered).toMatch(/type methodTree → tree\.go:45-49/);
    // Engine is in gin.go (same file as top-1) but at a disjoint line range,
    // so it should still surface. (Range-level dedup via skipKeys handles
    // overlap; same-file alone is not a reason to drop.)
    expect(out.rendered).toMatch(/type Engine → gin\.go:92-191/);
  });

  it('range-dedups type entries that overlap an already-packaged result', () => {
    const repo = {
      getOutgoingRelationships: () => ([]),
      getIncomingRelationships: () => ([]),
      findEntitiesByNames: () => [
        { id: 'eX', name: 'XStruct', type: 'struct',
          filePath: 'a.go', startLine: 10, endLine: 30 },
      ],
    };
    const out = renderGraphNeighbors({
      codeGraphRepo: repo,
      entity: { id: 'e', filePath: 'b.go', startLine: 1, endLine: 3, name: 'foo', type: 'function' },
      skipKeys: new Set(['a.go|10|30']),
      tokenCap: 600,
      body: 'func foo() XStruct { return XStruct{} }',
    });
    expect(out).toBeNull();
  });

  it('does not pull SCREAMING_SNAKE_CASE constants in as type candidates', () => {
    const repo = {
      getOutgoingRelationships: () => ([]),
      getIncomingRelationships: () => ([]),
      findEntitiesByNames: () => [],
    };
    const out = renderGraphNeighbors({
      codeGraphRepo: repo,
      entity: { id: 'e', filePath: 'a.js', startLine: 1, endLine: 5, name: 'foo', type: 'function' },
      skipKeys: new Set(),
      tokenCap: 600,
      body: 'function foo() { return MAX_BUFFER_SIZE + DEFAULT_TIMEOUT; }',
    });
    // No edges, no type matches — should return null.
    expect(out).toBeNull();
  });

  it('returns null when tokenCap is 0', () => {
    const repo = mockRepo({
      outgoing: [{
        type: 'calls', targetName: 'helper', targetId: 'eH', contextLine: 5, fullImportPath: null,
        target: { id: 'eH', name: 'helper', type: 'function', filePath: 'lib/x.js', startLine: 10, endLine: 30 },
      }],
    });
    const out = renderGraphNeighbors({
      codeGraphRepo: repo,
      entity: { id: 'e1', filePath: 'lib/y.js', startLine: 1, endLine: 5, name: 'caller', type: 'function' },
      skipKeys: new Set(),
      tokenCap: 0,
    });
    expect(out).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// End-to-end: packageForAgent surfaces neighbours into top-1
// ──────────────────────────────────────────────────────────────────────────

describe('packageForAgent (graph-neighbour reservation)', () => {
  let tmp;
  beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'ctx-pkg-')); });
  afterAll(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } });

  function write(rel, body) {
    const full = join(tmp, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
    return rel;
  }

  it('attaches `neighbors` to top-1 and respects budget reservation', () => {
    // Create a small file with a function the package can find.
    const rel = write('lib/validation.js', [
      "'use strict'",
      "const { kSchemaParams: paramsSchema } = require('./symbols')",
      '',
      'function validate (request) {',
      '  return paramsSchema && validateParam(paramsSchema, request)',
      '}',
      '',
      'module.exports = validate',
    ].join('\n'));

    const ranked = [{
      id: 'r1',
      file: rel,
      startLine: 4, endLine: 6,
      score: 1.0, lateInteractionScore: 1.0,
      metadata: { file: rel, name: 'validate', type: 'function', startLine: 4, endLine: 6 },
    }];

    const repo = {
      findEnclosingEntity: () => ({
        id: 'e_validate',
        name: 'validate', type: 'function',
        startLine: 4, endLine: 6, parentClass: null,
      }),
      getOutgoingRelationships: () => ([
        {
          type: 'imports', targetName: 'paramsSchema', targetId: 'e_p',
          contextLine: 2, fullImportPath: null,
          target: { id: 'e_p', name: 'paramsSchema', type: 'Symbol',
            filePath: 'lib/symbols.js', startLine: 14, endLine: 14 },
        },
        {
          type: 'calls', targetName: 'validateParam', targetId: 'e_vp',
          contextLine: 5, fullImportPath: null,
          target: { id: 'e_vp', name: 'validateParam', type: 'function',
            filePath: 'lib/validation.js', startLine: 118, endLine: 144 },
        },
      ]),
      getIncomingRelationships: () => ([]),
      getDbMtime: () => null,
      getFileIndexInfo: () => null,
    };

    const pack = packageForAgent(ranked, { path: 'pattern', grepMatches: 1, total_ms: 5 }, {
      query: 'validate request',
      regex: '\\bvalidate\\b',
      mode: 'pattern',
      format: 'agent',
      tokenBudget: 4000,
      codeGraphRepo: repo,
      locationMap: null,
      projectRoot: tmp,
    });

    expect(pack.results.length).toBe(1);
    const top = pack.results[0];
    expect(top.neighbors).toBeTruthy();
    expect(top.neighbors.count).toBeGreaterThanOrEqual(1);
    expect(top.neighbors.rendered).toMatch(/paramsSchema|validateParam/);
    // Tokens used should include both code and neighbour tier
    expect(pack.tokensUsed).toBeGreaterThan(top.codeTokens);
    expect(pack.tokensUsed).toBeLessThanOrEqual(4000);
  });

  it('is OPT-OUT via no-graph-neighbors ablation', () => {
    const rel = write('lib/v2.js', [
      'function plain () { return 1 }',
    ].join('\n'));
    const ranked = [{
      id: 'r1', file: rel, startLine: 1, endLine: 1,
      score: 1.0, lateInteractionScore: 1.0,
      metadata: { file: rel, name: 'plain', type: 'function', startLine: 1, endLine: 1 },
    }];
    const repo = {
      findEnclosingEntity: () => ({ id: 'e1', name: 'plain', type: 'function', startLine: 1, endLine: 1, parentClass: null }),
      getOutgoingRelationships: () => ([{
        type: 'calls', targetName: 'helper', targetId: 'eH', contextLine: 1,
        target: { id: 'eH', name: 'helper', type: 'function', filePath: 'x.js', startLine: 10, endLine: 20 },
      }]),
      getIncomingRelationships: () => ([]),
      getDbMtime: () => null,
      getFileIndexInfo: () => null,
    };

    const pack = packageForAgent(ranked, { path: 'pattern', grepMatches: 1, total_ms: 5 }, {
      query: 'plain',
      regex: 'plain',
      mode: 'pattern',
      format: 'agent',
      tokenBudget: 4000,
      codeGraphRepo: repo,
      locationMap: null,
      projectRoot: tmp,
      ablations: new Set(['no-graph-neighbors']),
    });
    expect(pack.results[0].neighbors).toBeFalsy();
  });
});

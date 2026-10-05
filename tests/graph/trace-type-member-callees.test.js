/**
 * ss-trace <Type> callees: a type calls nothing itself, so its callees are the calls its
 * methods make out of the type (r3hb-okhttp-12, 2026-10-05: `ss-trace RealCall callees`
 * printed "(no callees in the repository)" for a 560-line Kotlin class). Calls between the
 * type's own methods are left out; methods declared outside the body with the type as owner
 * (Go receivers) count; methods of another type do not.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { GraphExtractor, createGraphSchema, insertCallSites, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets } from '../../core/graph/relationship-resolver.js';
import { StructuralContextBuilder } from '../../core/graph/structural-context.js';
import { formatTraceCompact } from '../../core/search/agent-output-fixes.js';

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

async function buildGraph(files) {
  const root = mkdtempSync(join(tmpdir(), 'ss-trace-member-callees-'));
  roots.push(root);
  const extractor = new GraphExtractor({ projectRoot: root });
  const entities = [];
  const relationships = [];
  const callSites = [];
  for (const [rel, lines] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, lines.join('\n'));
    const out = await extractor.extractFromFile(rel, lines.join('\n'));
    entities.push(...out.entities);
    relationships.push(...out.relationships);
    callSites.push(...(out.callSites || []));
  }
  const dbPath = join(root, 'code-graph.db');
  const db = new Database(dbPath);
  const log = console.log;
  console.log = () => {};
  try {
    const fts = createGraphSchema(db);
    insertGraph(db, entities, relationships, fts, { syncFts: true });
    db.transaction(() => insertCallSites(db, callSites))();
    resolveRelationshipTargets(db);
  } finally {
    console.log = log;
  }
  db.close();
  return { root, dbPath };
}

function trace({ root, dbPath }, symbol, options = {}) {
  const builder = new StructuralContextBuilder({ projectRoot: root, graphDbPath: dbPath });
  try {
    return builder.build(symbol, options);
  } finally {
    builder.close();
  }
}

const calleeNames = (r) => r.sections.callees.items
  .filter((x) => x.file && x.relationship !== 'handoff').map((x) => x.name).sort();

describe('ss-trace callees of a type = its methods\' calls out of the type', () => {
  it('Kotlin class: outward calls of its methods; own-method calls and a nested class are left out', async () => {
    const g = await buildGraph({
      'pool/Pool.kt': [
        'class Pool {',
        '  fun connectionBecameIdle(c: Int): Boolean {',
        '    return c > 0',
        '  }',
        '  fun evictAll() {',
        '  }',
        '}',
      ],
      'pool/Planner.kt': [
        'fun planRoute(x: Int): Int {',
        '  return x + 1',
        '}',
        'fun helperForInner(): Int {',
        '  return 2',
        '}',
      ],
      'call/Call.kt': [
        'class Call(val pool: Pool) {',
        '  private val timeout = Timeouts.makeTimeout()', // the class's own (unresolved) call row
        '  fun callDone(): Boolean {',
        '    release()',
        '    return pool.connectionBecameIdle(1)',
        '  }',
        '  fun release() {',
        '    pool.connectionBecameIdle(2)',
        '  }',
        '  inner class AsyncCall {',
        '    fun run() {',
        '      pool.evictAll()',
        '    }',
        '  }',
        '}',
      ],
    });
    const r = trace(g, 'Call', { modeSection: 'callees' });
    expect(r.target.name).toBe('Call');
    const names = calleeNames(r);
    expect(names).toEqual(['connectionBecameIdle']);  // not `release` (own method), not `evictAll` (nested type's call)
    expect(r.sections.callees.items.find((x) => x.name === 'connectionBecameIdle').contextLines).toEqual([5, 8]);
    expect(r.sections.callees.viaMembers).toBeGreaterThanOrEqual(2);
    const out = formatTraceCompact(r, { mode: 'callees' });
    expect(out).toMatch(/# calls out of Call's \d+ methods/);
    expect(out).not.toContain('(no callees in the repository)');
  });

  it('Go struct: receiver methods declared outside the struct body count', async () => {
    const g = await buildGraph({
      'zero/zero.go': [
        'package zero',
        '',
        'type Server struct {',
        '\tn int',
        '}',
      ],
      'zero/assign.go': [
        'package zero',
        '',
        'func (s *Server) AssignIds() int {',
        '\treturn leaseIds(s.n)',
        '}',
        '',
        'func leaseIds(n int) int {',
        '\treturn n',
        '}',
      ],
    });
    const r = trace(g, 'Server', { modeSection: 'callees' });
    expect(r.target.name).toBe('Server');
    expect(calleeNames(r)).toContain('leaseIds');
  });

  it('a function target is unchanged (no member gathering)', async () => {
    const g = await buildGraph({
      'a.go': ['package a', '', 'func Outer() int {', '\treturn inner()', '}', '', 'func inner() int {', '\treturn 1', '}'],
    });
    const r = trace(g, 'Outer', { modeSection: 'callees' });
    expect(calleeNames(r)).toEqual(['inner']);
    expect(r.sections.callees.viaMembers).toBeUndefined();
  });
});

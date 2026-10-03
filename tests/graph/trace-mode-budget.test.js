/**
 * SS_FIX_TRACE_MODE_BUDGET (default ON in ss-trace since 2026-10-03): with a mode word only one section prints, so it takes
 * every budget share but the target's. Dev replay (eval/trace-truncation-classify): the only
 * shortened lists an agent could see were callee lists cut at the row limit their share allowed
 * (6 of 8-12 rows) while ~86% of the budget sat unused.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphExtractor, createGraphSchema, insertGraph } from '../../core/graph/graph-extractor.js';
import { resolveRelationshipTargets } from '../../core/graph/relationship-resolver.js';
import { StructuralContextBuilder } from '../../core/graph/structural-context.js';

const HELPERS = 30;
let root;
let builder;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'ss-trace-mode-budget-'));
  const lines = ['function orchestrate(x) {'];
  for (let i = 0; i < HELPERS; i++) lines.push(`  helper${i}(x);`);
  lines.push('}');
  for (let i = 0; i < HELPERS; i++) lines.push(`function helper${i}(x) {`, `  return x + ${i};`, '}');
  const src = lines.join('\n');
  writeFileSync(join(root, 'a.js'), src);
  const out = await new GraphExtractor({ projectRoot: root }).extractFromFile('a.js', src);
  const dbPath = join(root, 'code-graph.db');
  const db = new Database(dbPath);
  const fts = createGraphSchema(db);
  const log = console.log;
  console.log = () => {};
  try {
    insertGraph(db, out.entities, out.relationships, fts, { syncFts: true, callSites: out.callSites || [] });
    resolveRelationshipTargets(db);
  } finally {
    console.log = log;
    db.close();
  }
  builder = new StructuralContextBuilder({ projectRoot: root, graphDbPath: dbPath });
});

afterAll(() => {
  builder?.close();
  rmSync(root, { recursive: true, force: true });
});

describe('trace modeSection', () => {
  it('the callees mode word lists more of the available callees when its section takes the budget', () => {
    const off = builder.build('orchestrate', { tokenBudget: 1500 });
    const on = builder.build('orchestrate', { tokenBudget: 1500, modeSection: 'callees' });
    expect(off.stats.callees).toBe(HELPERS);
    expect(off.sections.callees.shown).toBeLessThan(HELPERS);
    expect(on.sections.callees.shown).toBeGreaterThan(off.sections.callees.shown);
    expect(on.sections.callees.shown).toBeLessThanOrEqual(HELPERS);
    // the target is rendered with the same share either way
    expect(on.target.code).toBe(off.target.code);
  });

  it('no mode word: the build is identical to today\'s', () => {
    const a = builder.build('orchestrate', { tokenBudget: 1500 });
    const b = builder.build('orchestrate', { tokenBudget: 1500, modeSection: undefined });
    const strip = r => ({ ...r, stats: { ...r.stats, latencyMs: 0 } });
    expect(strip(b)).toEqual(strip(a));
  });
});

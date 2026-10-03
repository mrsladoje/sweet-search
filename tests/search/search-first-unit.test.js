/**
 * SS_FIX_SEARCH_FIRST_UNIT (default off; docs/SUGGESTED_PLAN.md Step 5 item 2): ranks past 3 get a
 * small signature preview instead of a name-only line. 'calibrated' = ranks 4-5, 'all' = every
 * rank; rank 1 pays only for what would exceed the budget.
 */
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CodeGraphRepository } from '../../core/infrastructure/code-graph-repository.js';
import { allocateBudget, packageForAgent } from '../../core/search/context-expander.js';

let root;
let graph;
beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'first-unit-'));
  const big = ['function outer(x) {', ...Array.from({ length: 58 }, (_, i) => `  const v${i} = x + ${i};`), '}'];
  writeFileSync(path.join(root, 'a.js'), `${big.join('\n')}\n`);
  for (const f of ['b', 'c', 'd', 'e']) {
    writeFileSync(path.join(root, `${f}.js`), `function ${f}Fn(y) {\n  const z = y * 2;\n  const w = z + 1;\n  return w;\n}\n`);
  }
  const dbPath = path.join(root, 'code-graph.db');
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE entities (
    id TEXT PRIMARY KEY, name TEXT, type TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER,
    parent_class TEXT, stale_since INTEGER, epoch_written INTEGER, epoch_retired INTEGER, signature TEXT, code TEXT)`);
  db.prepare('INSERT INTO entities VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 1, NULL, NULL, NULL)').run('outer', 'outer', 'function', 'a.js', 1, 60);
  db.close();
  graph = new CodeGraphRepository(dbPath);
});
afterAll(() => {
  graph?.close?.();
  rmSync(root, { recursive: true, force: true });
});

const res = (file, startLine, endLine, score, name) => ({
  id: `${file}:${startLine}`, file, startLine, endLine, score, lateInteractionScore: score,
  metadata: { file, startLine, endLine, name, type: 'function' },
});

const total = a => a.reduce((n, x) => n + x.tokenCap, 0);

describe('allocateBudget firstUnit', () => {
  it('absent or unknown: the shipped allocation, unchanged', () => {
    for (const [budget, n, sub] of [[3000, 10, 'agent_preview'], [8000, 8, 'agent_full'], [1200, 2, 'agent_preview']]) {
      const shipped = allocateBudget(budget, n, sub);
      expect(allocateBudget(budget, n, sub, { firstUnit: 'nope' })).toEqual(shipped);
      expect(allocateBudget(budget, n, sub, {})).toEqual(shipped);
    }
  });

  it('calibrated: ranks 4 and 5 get a 60-token preview, rank 6 on stays a summary line', () => {
    const shipped = allocateBudget(3000, 10, 'agent_preview');
    const a = allocateBudget(3000, 10, 'agent_preview', { firstUnit: 'calibrated' });
    expect(a.slice(3, 5)).toEqual([{ presentation: 'preview', tokenCap: 60, unit: true }, { presentation: 'preview', tokenCap: 60, unit: true }]);
    expect(a.slice(5).every(x => x.presentation === 'summary')).toBe(true);
    expect(a.slice(1, 3)).toEqual(shipped.slice(1, 3));
    // rank 1 pays exactly the overflow, never more
    const over = Math.max(0, total(shipped) + 120 - 3000);
    expect(a[0].tokenCap).toBe(shipped[0].tokenCap - over);
    expect(total(a)).toBeLessThanOrEqual(Math.max(3000, total(shipped)));
  });

  it('all: every rank past 3 gets a unit (the plain guarantee)', () => {
    const a = allocateBudget(3000, 10, 'agent_preview', { firstUnit: 'all' });
    expect(a.slice(3).every(x => x.presentation === 'preview' && x.tokenCap === 60)).toBe(true);
    expect(total(a)).toBeLessThanOrEqual(3000);
  });

  it('fewer than four results: nothing changes', () => {
    expect(allocateBudget(3000, 3, 'agent_preview', { firstUnit: 'all' })).toEqual(allocateBudget(3000, 3, 'agent_preview'));
  });

  it('packageForAgent: rank 4-5 entries print a short preview with the arm, a summary line without it', () => {
    const results = [res('b.js', 1, 5, 0.9, 'bFn'), res('c.js', 1, 5, 0.8, 'cFn'), res('d.js', 1, 5, 0.7, 'dFn'),
      res('e.js', 1, 5, 0.6, 'eFn'), res('a.js', 1, 10, 0.5, 'outer')];
    const opts = { query: 'q', regex: 'x', format: 'agent_preview', projectRoot: root, k: 5 };
    const shipped = packageForAgent(results, { grepMatches: 5 }, opts);
    const arm = packageForAgent(results, { grepMatches: 5 }, { ...opts, firstUnit: 'calibrated' });
    expect(shipped.results.slice(3).map(r => r.presentation)).toEqual(['summary', 'summary']);
    expect(arm.results.slice(3).map(r => r.presentation)).toEqual(['preview', 'preview']);
    expect(arm.results[3].code).toContain('function eFn(y) {');
    expect(arm.results.map(r => `${r.file}:${r.startLine}`).slice(0, 3)).toEqual(shipped.results.map(r => `${r.file}:${r.startLine}`).slice(0, 3));
  });

  it('packageForAgent: a unit whose enclosing symbol is already printed stays a summary line', () => {
    // rank 1 prints outer (1-60); rank 4 is a chunk inside it, 20+ lines from rank 1's chunk
    const results = [res('a.js', 1, 20, 0.9, null), res('b.js', 1, 5, 0.8, 'bFn'), res('c.js', 1, 5, 0.7, 'cFn'),
      // below top / 3, so the packager's same-file companion promotion leaves it at rank 4
      res('a.js', 45, 50, 0.25, null), res('d.js', 1, 5, 0.2, 'dFn')];
    const arm = packageForAgent(results, { grepMatches: 5 }, {
      query: 'q', regex: 'x', format: 'agent_preview', projectRoot: root, k: 5, firstUnit: 'calibrated', codeGraphRepo: graph,
    });
    expect(arm.results[0].presentation).toBe('full');
    expect(arm.results[0].endLine).toBeGreaterThanOrEqual(50);
    expect(arm.results[3]).toMatchObject({ file: 'a.js', presentation: 'summary', code: null });
    expect(arm.results[4].presentation).toBe('preview');
  });

  it('a large budget pays for the units without touching rank 1', () => {
    const shipped = allocateBudget(8000, 6, 'agent_full');
    const a = allocateBudget(8000, 6, 'agent_full', { firstUnit: 'calibrated' });
    expect(a[0]).toEqual(shipped[0]);
  });
});

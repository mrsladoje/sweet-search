import { describe, it, expect } from 'vitest';
import { containerRowMembers, annotateContainerRowMembers } from '../../core/search/context-expander.js';
import { renderSummaryRow } from '../../core/search/agent-output-fixes.js';

const row = { file: 'lib/sequel/model/base.rb', startLine: 4, endLine: 2449, symbol: 'Model', symbolType: 'class',
  presentation: 'summary', summary: 'x', code: null };
const entities = [
  { name: 'Model', type: 'class', startLine: 4, endLine: 2449 },
  { name: 'Model', type: 'method', startLine: 185, endLine: 234 },
  { name: 'primary_key_lookup', type: 'method', startLine: 1079, endLine: 1089 },
  { name: 'primary_key_hash', type: 'method', startLine: 533, endLine: 540 },
  { name: 'first', type: 'method', startLine: 300, endLine: 310 },
  { name: 'set_dataset', type: 'method', startLine: 624, endLine: 650 },
  { name: 'primary_key_lookup', type: 'method', startLine: 3000, endLine: 3010 },
];
const q = ['model', 'class', 'subscript', 'primary', 'key', 'lookup', 'first'];

describe('containerRowMembers', () => {
  it('names members agreeing with >= 2 query subtokens, best first, inside the span only', () => {
    expect(containerRowMembers(entities, row, q).map(m => m.name)).toEqual(['primary_key_lookup', 'primary_key_hash']);
  });
  it('skips a member named like the type (a constructor)', () => {
    const typeRow = { ...row, symbol: 'BatchInsertSpans', startLine: 49, endLine: 182 };
    const ents = [{ name: 'BatchInsertSpans', type: 'method', startLine: 53, endLine: 60 },
      { name: 'insertSpanBatch', type: 'method', startLine: 70, endLine: 90 }];
    expect(containerRowMembers(ents, typeRow, ['batch', 'insert', 'spans']).map(m => m.name)).toEqual(['insertSpanBatch']);
  });

  it('names nothing when no member agrees enough', () => {
    expect(containerRowMembers(entities, row, ['dataset'])).toEqual([]);
  });
});

describe('annotateContainerRowMembers + renderSummaryRow', () => {
  it('stamps a large type row and renders the members', () => {
    const r = { ...row };
    annotateContainerRowMembers([r], { findEntitiesInFile: () => entities }, 'model class subscript primary key lookup');
    expect(renderSummaryRow(r)).toBe('4-2449 class Model; query names method primary_key_lookup (1079) · method primary_key_hash (533)');
  });
  it('leaves small types, code entries and method rows alone', () => {
    const small = { ...row, endLine: 60 };
    const code = { ...row, presentation: 'full', code: 'x', summary: null };
    const method = { ...row, symbolType: 'method' };
    annotateContainerRowMembers([small, code, method], { findEntitiesInFile: () => entities }, 'primary key lookup');
    expect(small.memberHits).toBeUndefined();
    expect(code.memberHits).toBeUndefined();
    expect(method.memberHits).toBeUndefined();
  });
});

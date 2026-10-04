/**
 * Declaration blocks (agent formats): a code entry that only lists member declarations of a
 * type is marked with the type (agent-pack-completion.js declarationBlockOf); the ss-search /
 * ss-find renderer folds it into one row when better-ranked code of that type printed
 * (agent-output-diet.test.js). Real case: okhttp Interceptor.Chain 183-247, six `with*`
 * signatures with their doc comments.
 */
import { describe, expect, it } from 'vitest';

import { annotateEntrySymbols, declarationBlockOf } from '../../core/search/agent-pack-completion.js';
import { printedSpanCandidates, selectEntries } from '../../core/search/agent-output-fixes.js';

const CHAIN = { name: 'Chain', type: 'class', startLine: 84, endLine: 297 };
const fn = (name, startLine, endLine = startLine) => ({ name, type: 'function', startLine, endLine });

function repo(entities) {
  return {
    findEntitiesInRange: (file, start, end) => entities.filter((e) => e.startLine >= start && e.startLine <= end),
    findEnclosingEntity: (file, start, end) => entities
      .filter((e) => e.startLine <= start && e.endLine >= end)
      .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0] || null,
  };
}

const ENTITIES = [CHAIN, fn('request', 85), fn('proceed', 87, 88), fn('withConnectTimeout', 109, 112),
  fn('withAuthenticator', 188), fn('withCookieJar', 198), fn('withCache', 210), fn('withProxy', 220),
  { name: 'Other', type: 'class', startLine: 300, endLine: 400 }, fn('run', 310, 340), fn('size', 350)];

describe('declarationBlockOf', () => {
  const r = (startLine, endLine) => ({ file: 'Interceptor.kt', startLine, endLine, code: 'x' });

  it('marks a span of bare member declarations with its type', () => {
    const rows = repo(ENTITIES).findEntitiesInRange('f', 183, 247);
    expect(declarationBlockOf(r(183, 247), rows, repo(ENTITIES))).toEqual({ name: 'Chain', startLine: 84, endLine: 297 });
  });

  it('a wrapped signature (4 lines) is still a declaration', () => {
    const rows = repo(ENTITIES).findEntitiesInRange('f', 105, 125);
    expect(declarationBlockOf(r(105, 125), rows, repo(ENTITIES))?.name).toBe('Chain');
  });

  it('never marks a span with a member body, the type head, or code outside a type', () => {
    const g = repo(ENTITIES);
    expect(declarationBlockOf(r(305, 355), g.findEntitiesInRange('f', 305, 355), g)).toBe(null); // run has a body
    expect(declarationBlockOf(r(84, 104), g.findEntitiesInRange('f', 84, 104), g)).toBe(null); // holds the type itself
    const top = repo([fn('a', 1), fn('b', 3)]);
    expect(declarationBlockOf(r(1, 4), top.findEntitiesInRange('f', 1, 4), top)).toBe(null); // no enclosing type
    expect(declarationBlockOf(r(250, 260), [], g)).toBe(null); // no members: nothing to judge
  });

  it('annotateEntrySymbols stamps code entries only', () => {
    const results = [
      { file: 'Interceptor.kt', startLine: 183, endLine: 247, code: 'x', symbol: 'withAuthenticator' },
      { file: 'Interceptor.kt', startLine: 183, endLine: 247, code: null, presentation: 'summary', symbol: 'withAuthenticator' },
    ];
    annotateEntrySymbols(results, repo(ENTITIES));
    expect(results[0].declarationBlockOf?.name).toBe('Chain');
    expect(results[1].declarationBlockOf).toBeUndefined();
  });
});

describe('a folded block is not recorded as printed code', () => {
  it('printedSpanCandidates follows the plan entry, not the raw result', () => {
    const head = { file: 'Interceptor.kt', startLine: 84, endLine: 85, shownStartLine: 84, shownEndLine: 85, code: 'interface Chain {\n  fun request(): Request', presentation: 'full' };
    const block = { file: 'Interceptor.kt', startLine: 188, endLine: 188, shownStartLine: 188, shownEndLine: 188, code: 'fun withAuthenticator(a: Authenticator): Chain', presentation: 'full', declarationBlockOf: { name: 'Chain', startLine: 84, endLine: 297 } };
    const results = [head, block];
    const plan = selectEntries(results, { dedupe: 'a2', foldDeclarationBlocks: true });
    const parts = printedSpanCandidates(results, plan, { projectRoot: '/nonexistent' }).map((c) => c.resultIndex);
    expect(parts).toContain(0);
    expect(parts).not.toContain(1);
    // Unfolded, the same block would be recorded.
    const unfolded = selectEntries(results, { dedupe: 'a2' });
    expect(printedSpanCandidates(results, unfolded, { projectRoot: '/nonexistent' }).map((c) => c.resultIndex)).toContain(1);
  });
});

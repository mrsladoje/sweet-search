// Body-text lexical channel: format gating, the exact-string pin rule and
// the seed composition around the rerank.
import { describe, expect, it } from 'vitest';
import {
  alignedQueryWords,
  bodyLexicalSettings,
  composeSeeds,
  refrontPins,
  retrieveBodyLexical,
  textWords,
} from '../../core/search/body-lexical.js';

/** Fake CodebaseRepository: every chunk is a candidate, best BM25 first. */
function fakeRepo(chunks) {
  const calls = [];
  return {
    calls,
    searchChunkText(matchExpr, limit, options = {}) {
      calls.push({ matchExpr, limit, options });
      return chunks.slice(0, limit).map((c, i) => ({
        id: c.id,
        file_path: c.file,
        metadata: JSON.stringify({ file: c.file, startLine: 1, endLine: 10 }),
        score: 10 - i,
        ...(options.withText ? { text: c.text } : {}),
      }));
    },
  };
}

const PIN = bodyLexicalSettings({ format: 'agent' }, { SWEET_SEARCH_BODY_LEXICAL: 'pin' });

describe('bodyLexicalSettings', () => {
  it('is off for non-agent formats, the ablation and mode off', () => {
    const env = { SWEET_SEARCH_BODY_LEXICAL: 'pin,pool' };
    expect(bodyLexicalSettings({ format: 'json' }, env)).toBeNull();
    expect(bodyLexicalSettings({}, env)).toBeNull();
    expect(bodyLexicalSettings({ format: 'agent', ablations: ['no-body-lexical'] }, env)).toBeNull();
    expect(bodyLexicalSettings({ format: 'agent' }, { SWEET_SEARCH_BODY_LEXICAL: 'off' })).toBeNull();
    expect(bodyLexicalSettings({ format: 'agent_full' }, env)).toMatchObject({ pin: true, pool: true, rrf: false });
  });

  it('defaults to pin only for agent formats', () => {
    expect(bodyLexicalSettings({ format: 'agent' }, {})).toMatchObject({ pin: true, pool: false, rrf: false });
    expect(bodyLexicalSettings({ format: 'markdown' }, {})).toBeNull();
  });
});

describe('alignedQueryWords', () => {
  it('tolerates a format verb in the code and a pasted value in the query', () => {
    const q = textWords('cannot delete removed type after streaming snapshot');
    expect(alignedQueryWords(q, textWords('"cannot delete removed type %s after streaming snapshot"'))).toBe(7);
    expect(alignedQueryWords(textWords('retry user 42 failed'), textWords('"retry user failed"'))).toBe(3);
  });

  it('does not chain words that are far apart or out of order', () => {
    const q = textWords('pending transactions found');
    expect(alignedQueryWords(q, textWords('pending a b c d e transactions found'))).toBe(2);
    expect(alignedQueryWords(q, textWords('found transactions pending'))).toBe(1);
  });
});

describe('retrieveBodyLexical pin', () => {
  it('pins the implementation chunk that holds the message, not the test quoting it', () => {
    const repo = fakeRepo([
      { id: 't', file: 'worker/draft_test.go', text: 'want "Pending transactions found. Please retry operation"' },
      { id: 'a', file: 'worker/draft.go', text: 'errors.New("Pending transactions found. Please retry operation")' },
      { id: 'b', file: 'worker/other.go', text: 'pending work found; retry later' },
    ]);
    const { pins, stats } = retrieveBodyLexical(repo, 'pending transactions found please retry operation', PIN);
    expect(pins.map((p) => p.id)).toEqual(['a']);
    expect(pins[0].searchPath).toBe('body-pin');
    expect(stats).toMatchObject({ pinFired: true, pinCandidates: 2 });
  });

  it('pins tests when no implementation chunk holds the message', () => {
    const repo = fakeRepo([
      { id: 't', file: 'worker/draft_test.go', text: 'want "Pending transactions found. Please retry operation"' },
      { id: 'b', file: 'worker/other.go', text: 'pending work found; retry later' },
    ]);
    const { pins } = retrieveBodyLexical(repo, 'pending transactions found please retry operation', PIN);
    expect(pins.map((p) => p.id)).toEqual(['t']);
  });

  it('does not pin a phrase found in more than PIN_MAX implementation chunks', () => {
    const text = 'log.Printf("connection reset by peer")';
    const repo = fakeRepo(['a', 'b', 'c', 'd'].map((id) => ({ id, file: `${id}.go`, text })));
    const { pins, stats } = retrieveBodyLexical(repo, 'connection reset by peer', PIN);
    expect(pins).toEqual([]);
    expect(stats).toMatchObject({ pinFired: false, pinCandidates: 4 });
  });

  it('does not pin queries shorter than PIN_MIN_WORDS that are not one code token', () => {
    const repo = fakeRepo([{ id: 'a', file: 'a.go', text: 'retry operation' }]);
    expect(retrieveBodyLexical(repo, 'retry operation', PIN).pins).toEqual([]);
    expect(repo.calls).toEqual([]);
  });

  it('pins a code-token query only where the token occurs verbatim', () => {
    const repo = fakeRepo([
      { id: 'utc', file: 'binding/time.go', text: 'loc := time.UTC' },
      { id: 'key', file: 'binding/form_mapping.go', text: 'if tag.Get("time_utc") != "" {' },
    ]);
    const { pins } = retrieveBodyLexical(repo, 'time_utc', PIN);
    expect(pins.map((p) => p.id)).toEqual(['key']);
    expect(repo.calls[0].matchExpr).toBe('{body} : "time utc"');
  });
});

describe('composeSeeds / refrontPins', () => {
  const seed = (id, score) => ({ id, score, metadata: {} });

  it('puts pins first, keeps k seeds and appends pool hits below every seed', () => {
    const fused = [seed('x', 0.9), seed('y', 0.5), seed('z', 0.2)];
    const seeds = composeSeeds(fused, 2, [{ id: 'p', score: 3, metadata: {} }], [{ id: 'q', score: 7, metadata: {} }]);
    expect(seeds.map((s) => s.id)).toEqual(['p', 'x', 'q']);
    expect(seeds[0].score).toBeGreaterThan(0.9);
    expect(seeds[2].score).toBeLessThan(0.9);
    expect(seeds[2]._bodyPool).toBe(true);
  });

  it('moves pinned results back to the front after a rerank, in pin order', () => {
    const reranked = [seed('x', 0.9), { ...seed('p2', 0.1), _bodyPin: 2 }, { ...seed('p1', 0.3), _bodyPin: 1 }];
    expect(refrontPins(reranked).map((r) => r.id)).toEqual(['p1', 'p2', 'x']);
    const plain = [seed('x', 1)];
    expect(refrontPins(plain)).toBe(plain);
  });
});

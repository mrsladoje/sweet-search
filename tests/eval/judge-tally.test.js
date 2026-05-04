/**
 * judgeAggregate counting must collapse ALL sweet conditions (sweet-search-
 * tools AND sweet-search-auto) onto the same "sweet wins" bucket. The
 * previous hard-coded check on `sweet-search-tools` silently zero'd every
 * sweet-search-auto win, producing nonsense aggregates like 3-0-0 / n=5.
 */

import { describe, it, expect } from 'vitest';
import { tallyJudgeWins } from '../../eval/agent-read-workflows/judge-tally.js';

describe('tallyJudgeWins', () => {
  it('counts native-rg-read wins under the baseline bucket', () => {
    const r = tallyJudgeWins([
      { preferredMode: 'native-rg-read' },
      { preferredMode: 'native-rg-read' },
    ]);
    expect(r).toEqual({ judgeNativeWins: 2, judgeSweetWins: 0, judgeTies: 0 });
  });

  it('counts sweet-search-auto wins as sweet wins (regression)', () => {
    const r = tallyJudgeWins([
      { preferredMode: 'sweet-search-auto' },
      { preferredMode: 'sweet-search-auto' },
      { preferredMode: 'native-rg-read' },
    ]);
    expect(r).toEqual({ judgeNativeWins: 1, judgeSweetWins: 2, judgeTies: 0 });
  });

  it('counts sweet-search-tools wins as sweet wins (existing behaviour)', () => {
    const r = tallyJudgeWins([
      { preferredMode: 'sweet-search-tools' },
      { preferredMode: 'sweet-search-tools' },
    ]);
    expect(r).toEqual({ judgeNativeWins: 0, judgeSweetWins: 2, judgeTies: 0 });
  });

  it('counts mixed sweet conditions in the same run', () => {
    const r = tallyJudgeWins([
      { preferredMode: 'sweet-search-auto' },
      { preferredMode: 'sweet-search-tools' },
      { preferredMode: 'tie' },
      { preferredMode: 'native-rg-read' },
    ]);
    expect(r).toEqual({ judgeNativeWins: 1, judgeSweetWins: 2, judgeTies: 1 });
  });

  it('treats unknown / null preferredMode as no count', () => {
    const r = tallyJudgeWins([
      { preferredMode: null },
      { preferredMode: 'something-else' },
      {},
    ]);
    expect(r).toEqual({ judgeNativeWins: 0, judgeSweetWins: 0, judgeTies: 0 });
  });

  it('honours an alternate baseline', () => {
    const r = tallyJudgeWins([
      { preferredMode: 'sweet-search-auto' },
      { preferredMode: 'sweet-search-tools' },
    ], 'sweet-search-tools');
    // With baseline=sweet-search-tools, sweet-search-tools wins go to native bucket.
    expect(r).toEqual({ judgeNativeWins: 1, judgeSweetWins: 1, judgeTies: 0 });
  });

  it('handles empty / null input', () => {
    expect(tallyJudgeWins([])).toEqual({ judgeNativeWins: 0, judgeSweetWins: 0, judgeTies: 0 });
    expect(tallyJudgeWins(null)).toEqual({ judgeNativeWins: 0, judgeSweetWins: 0, judgeTies: 0 });
  });
});

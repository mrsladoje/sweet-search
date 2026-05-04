// Pure tally helper used by run-bench.js and tested directly.
// Counts judge head-to-head wins by collapsing every non-baseline sweet
// condition (sweet-search-tools OR sweet-search-auto OR future ones) onto
// the same "sweet" bucket. The previous in-line code hard-coded
// "sweet-search-tools", which silently zero'd every sweet-search-auto win.

import { SWEET_CONDITIONS } from './policies.js';

/**
 * @param {Array<{ preferredMode: string|null }>} judgeResults
 * @param {string} [baselineMode='native-rg-read']
 * @returns {{ judgeNativeWins: number, judgeSweetWins: number, judgeTies: number }}
 */
export function tallyJudgeWins(judgeResults, baselineMode = 'native-rg-read') {
  let judgeNativeWins = 0, judgeSweetWins = 0, judgeTies = 0;
  for (const j of (judgeResults || [])) {
    const m = j?.preferredMode;
    if (m === baselineMode) judgeNativeWins++;
    else if (m && SWEET_CONDITIONS.has(m)) judgeSweetWins++;
    else if (m === 'tie') judgeTies++;
  }
  return { judgeNativeWins, judgeSweetWins, judgeTies };
}

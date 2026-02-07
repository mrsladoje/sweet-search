#!/usr/bin/env node
/**
 * Diagnostic: Verify FlashRank is being skipped due to early exit
 */

import { SmartSearch } from './smart-search-v21.js';

async function diagnose() {
  const search = new SmartSearch({ verbose: true });
  await search.init();

  const queries = [
    'AuthService',
    'how does authentication work',
    'employee time tracking',
    'LoginController',
    'BotDetectionService'
  ];

  console.log('\n=== DIAGNOSTIC: Checking Early Exit Behavior ===\n');

  let earlyExitCount = 0;
  let flashRankCount = 0;

  for (const query of queries) {
    console.log('\n--- Query:', query, '---');
    const result = await search.search(query, 10);

    const topResult = result.results?.[0] || result[0];

    if (topResult?.earlyExit) {
      earlyExitCount++;
      console.log('  ⚠️  EARLY EXIT:', topResult.skipReason);
      console.log('  ❌ FlashRank DID NOT RUN');
    } else if (topResult?.flashRankScore !== undefined) {
      flashRankCount++;
      console.log('  ✅ FlashRank DID RUN, score:', topResult.flashRankScore?.toFixed(3));
    } else {
      console.log('  ❓ Unknown state');
      console.log('    Fields:', Object.keys(topResult || {}).join(', '));
    }

    if (topResult?.int8Score) {
      console.log('  Int8 score:', topResult.int8Score.toFixed(3));
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Early exits: ${earlyExitCount}/${queries.length}`);
  console.log(`FlashRank runs: ${flashRankCount}/${queries.length}`);
  console.log(`Skip rate: ${((earlyExitCount / queries.length) * 100).toFixed(1)}%`);
}

diagnose().catch(console.error);

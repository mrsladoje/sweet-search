/**
 * CE Diagnostic Probe — isolates CE quality vs MaxSim on a handful of queries.
 * Runs in ~30 seconds. Answers:
 *   1. Are lateInteractionScores actually non-zero?
 *   2. What content does the CE see?
 *   3. Does CE produce reasonable scores and rankings?
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Use 10 diverse queries from GenCodeSearchNet
const PROBE_QUERIES = [
  { query: 'Print an error log message.', lang: 'python', target: 'logging' },
  { query: 'Parse a JSON string into an object.', lang: 'javascript', target: 'JSON' },
  { query: 'Sort a list of integers in ascending order.', lang: 'python', target: 'sort' },
  { query: 'Connect to a database and execute a query.', lang: 'java', target: 'database' },
  { query: 'Read a file line by line.', lang: 'go', target: 'file' },
  { query: 'Send an HTTP GET request.', lang: 'ruby', target: 'http' },
  { query: 'Hash a password with bcrypt.', lang: 'php', target: 'bcrypt' },
  { query: 'Create a new thread and run a function.', lang: 'java', target: 'thread' },
  { query: 'Convert a string to lowercase.', lang: 'python', target: 'lower' },
  { query: 'Find all files matching a glob pattern.', lang: 'go', target: 'glob' },
];

async function main() {
  // 1. Initialize search
  const corpusDir = path.join(__dirname, 'corpus', 'gencodesearchnet');
  const { initSearch } = await import(path.join(__dirname, 'lib', 'indexer.js'));

  process.env.SWEET_SEARCH_PROJECT_ROOT = corpusDir;
  process.env.EMBEDDING_PROVIDER = 'local';

  console.log('Initializing search...');
  const search = await initSearch(corpusDir, PROJECT_ROOT, { useLateInteraction: true });

  // 2. Warm up CE
  const { getGlobalLocalReranker } = await import(path.join(PROJECT_ROOT, 'core', 'local-reranker.js'));
  const reranker = getGlobalLocalReranker();
  if (reranker.isAvailable()) {
    await reranker.init();
    await reranker.rerank('warmup', ['warmup doc'], 1);
    console.log('CE model warmed up.\n');
  }

  // 2b. Direct MaxSim diagnostic — check if LI scores are actually computed
  console.log('='.repeat(80));
  console.log('MAXSIM DIAGNOSTIC — testing encodeQuery + scoreWithLateInteraction directly');
  console.log('='.repeat(80));
  try {
    const { encodeQuery } = await import(path.join(PROJECT_ROOT, 'core', 'late-interaction-model.js'));
    const testQuery = 'Print an error log message.';
    const queryTokens = await encodeQuery(testQuery);
    console.log(`  encodeQuery("${testQuery}"):`);
    console.log(`    returned: ${queryTokens ? queryTokens.length : 'null/empty'} tokens`);
    if (queryTokens && queryTokens.length > 0) {
      console.log(`    token[0] dim: ${queryTokens[0].length}`);
      console.log(`    token[0] first 5 values: [${queryTokens[0].slice(0, 5).map(v => v.toFixed(4)).join(', ')}]`);
      console.log(`    token[0] norm: ${Math.sqrt(queryTokens[0].reduce((s, v) => s + v * v, 0)).toFixed(4)}`);
    }

    // Get LI index and test scoring directly
    if (search.lateInteractionIndex) {
      const liIndex = search.lateInteractionIndex;
      const liStats = liIndex.getStats ? liIndex.getStats() : 'no getStats';
      console.log(`\n  LI Index stats: ${JSON.stringify(liStats)}`);
      console.log(`  LI tokenDim: ${liIndex.tokenDim}`);
      console.log(`  LI modelId: ${liIndex.modelId}`);

      // Get first few doc IDs directly from the LI index
      const testCandidates = [];
      let count = 0;
      for (const [id] of liIndex.documents) {
        testCandidates.push({ id });
        if (++count >= 5) break;
      }

      // Check if candidates have IDs that match LI index
      for (const c of testCandidates) {
        const id = c.id || c.entity_id;
        const rawDoc = liIndex.documents.get(id);
        const docTokens = liIndex.getTokens(id);
        console.log(`\n  Candidate "${id}":`);
        console.log(`    raw doc.dim: ${rawDoc?.dim}, doc.numTokens: ${rawDoc?.numTokens}, tokens.length: ${rawDoc?.tokens?.length}`);
        console.log(`    expected flat size: ${rawDoc?.numTokens} × ${rawDoc?.dim} = ${(rawDoc?.numTokens || 0) * (rawDoc?.dim || 0)}`);
        console.log(`    hasTokens: ${!!docTokens}`);
        if (docTokens) {
          console.log(`    numTokens: ${docTokens.length}`);
          console.log(`    token[0] dim: ${docTokens[0]?.length}`);
          // Compute MaxSim manually
          const maxsim = liIndex.maxSimScore(queryTokens.map(t => t.slice(0, liIndex.tokenDim)), docTokens);
          console.log(`    MaxSim score: ${maxsim.toFixed(6)}`);
        }
      }
    } else {
      console.log('  WARNING: search.lateInteractionIndex is null/undefined!');
    }
  } catch (err) {
    console.log(`  MaxSim diagnostic error: ${err.message}`);
    console.log(`  Stack: ${err.stack?.split('\n').slice(0, 3).join('\n')}`);
  }
  console.log('');

  console.log('\nMaxSim diagnostic complete. Exiting early for analysis.');
  process.exit(0);

  // 3. Probe each query
  for (const probe of PROBE_QUERIES) {
    console.log('='.repeat(80));
    console.log(`QUERY: "${probe.query}" [${probe.lang}]`);
    console.log('='.repeat(80));

    // Run search to get candidates with cascade stats
    const results = await search.search(probe.query, { limit: 20 });
    const stats = results.stats || {};
    const cascade = stats.cascade || {};

    // Show cascade stats
    console.log(`\n  CASCADE STATS:`);
    console.log(`    gateReason: ${cascade.gateReason || 'N/A'}`);
    console.log(`    decisive: ${cascade.decisive}`);
    console.log(`    withTokens: ${cascade.withTokens}/${cascade.totalCandidates}`);
    console.log(`    ceInvoked: ${cascade.ceInvoked}`);
    if (cascade.gateSignals) {
      const s = cascade.gateSignals;
      console.log(`    signals: gap=${s.gap?.toFixed(4)}, std=${s.std?.toFixed(4)}, flat=${s.flat}, margin=${s.marginDecisive}`);
    }

    // Show top-5 results with their scores
    console.log(`\n  TOP-5 RESULTS:`);
    const top5 = (results.results || results).slice(0, 5);
    for (let i = 0; i < top5.length; i++) {
      const r = top5[i];
      const li = r.lateInteractionScore;
      const pre = r.preLateInteractionScore ?? r.int8Score ?? '?';
      const ce = r.ceScore;
      const file = r.file || r.metadata?.file || '?';
      const name = r.name || r.metadata?.name || '?';
      console.log(`    #${i + 1}: score=${r.score?.toFixed(4)} | LI=${li !== undefined ? li.toFixed(4) : 'NONE'} | pre=${typeof pre === 'number' ? pre.toFixed(4) : pre} | CE=${ce !== undefined ? ce.toFixed(4) : 'NONE'}`);
      console.log(`        file=${file}  name=${name}`);
    }

    // Now manually run CE on the same top-20 to compare
    console.log(`\n  MANUAL CE RERANK (top-20):`);
    const candidates = (results.results || results).slice(0, 20);
    const documents = candidates.map(c => {
      const content = c.content || c.text || '';
      const nm = c.name || c.metadata?.name || '';
      const f = c.file || c.metadata?.file || '';
      return `${f} ${nm}\n${content}`.slice(0, 1000);
    });

    // Show what CE actually sees for candidate #1
    console.log(`\n  CE INPUT (candidate #1, first 200 chars):`);
    console.log(`    "${documents[0]?.slice(0, 200)}..."`);

    try {
      const ceResult = await reranker.rerank(probe.query, documents, 20);
      console.log(`\n  CE SCORES (sorted by CE rank):`);
      for (let i = 0; i < Math.min(5, ceResult.results.length); i++) {
        const r = ceResult.results[i];
        const origIdx = r.originalIndex;
        const origCandidate = candidates[origIdx];
        const file = origCandidate?.file || origCandidate?.metadata?.file || '?';
        const name = origCandidate?.name || origCandidate?.metadata?.name || '?';
        console.log(`    CE#${i + 1}: ceScore=${r.localRerankerScore.toFixed(4)} | origRank=#${origIdx + 1} | file=${file} name=${name}`);
      }
      console.log(`  CE latency: ${ceResult.latency_ms}ms for ${documents.length} docs`);
    } catch (err) {
      console.log(`  CE ERROR: ${err.message}`);
    }

    console.log('');
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

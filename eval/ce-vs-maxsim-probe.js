/**
 * CE vs MaxSim Quick Probe — 200 queries, ~2 minutes.
 * For each query: get candidates via cascade (MaxSim-ranked),
 * then CE-rerank the same candidates, compare which ranks the correct answer higher.
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

async function main() {
  const corpusDir = path.join(__dirname, 'corpus', 'gencodesearchnet');

  // Load queries and corpus mapping
  const { loadJsonl } = await import(path.join(__dirname, 'lib', 'data-loader.js'));
  const { prepareCorpus } = await import(path.join(__dirname, 'lib', 'corpus.js'));
  const { evaluateQuery } = await import(path.join(__dirname, 'lib', 'evaluator.js'));

  const queries = loadJsonl(path.join(__dirname, 'data', 'gencodesearchnet', 'queries.jsonl'));
  const corpus = loadJsonl(path.join(__dirname, 'data', 'gencodesearchnet', 'corpus.jsonl'));
  const docIdToFile = prepareCorpus(corpus, corpusDir, { skipClean: true });

  // Sample 200 queries evenly across languages
  const byLang = {};
  for (const q of queries) {
    const lang = q.language || 'unknown';
    if (!byLang[lang]) byLang[lang] = [];
    byLang[lang].push(q);
  }
  const sample = [];
  for (const [lang, qs] of Object.entries(byLang)) {
    sample.push(...qs.slice(0, 34));
  }
  console.log(`Sampled ${sample.length} queries across ${Object.keys(byLang).length} languages\n`);

  // Initialize search (cascade enabled, MaxSim active)
  const { initSearch } = await import(path.join(__dirname, 'lib', 'indexer.js'));
  process.env.SWEET_SEARCH_PROJECT_ROOT = corpusDir;
  process.env.EMBEDDING_PROVIDER = 'local';
  process.env.SWEET_SEARCH_VOCAB_AUTO_EXPAND = '0';
  // Disable cascade CE — we want pure MaxSim ranking from the pipeline
  process.env.SWEET_SEARCH_CASCADE_SHADOW = 'false';

  console.log('Initializing search...');
  const search = await initSearch(corpusDir, PROJECT_ROOT, { useLateInteraction: true });

  // Warm up CE
  const { getGlobalLocalReranker } = await import(path.join(PROJECT_ROOT, 'core', 'local-reranker.js'));
  const reranker = getGlobalLocalReranker();
  await reranker.init();
  await reranker.rerank('warmup', ['warmup doc'], 1);
  console.log('CE model warmed up.\n');

  // Tracking
  let total = 0, maxsimWins = 0, ceWins = 0, ties = 0;
  let maxsimTop1 = 0, ceTop1 = 0;
  const byLangStats = {};
  const ceImprovements = [];
  const ceRegressions = [];

  const startTime = Date.now();

  for (let qi = 0; qi < sample.length; qi++) {
    const q = sample[qi];
    const lang = q.language || 'unknown';
    if (!byLangStats[lang]) byLangStats[lang] = { total: 0, msWins: 0, ceWins: 0, ties: 0 };

    try {
      // 1. Search (MaxSim ranking via cascade)
      const { cleanQueryText } = await import(path.join(__dirname, 'lib', 'evaluator.js'));
      const cleanQuery = cleanQueryText(q.query);
      const searchResult = await search.search(cleanQuery, { limit: 50 });
      const candidates = searchResult.results || searchResult;
      if (candidates.length < 2) continue;

      // 2. Evaluate MaxSim ranking
      const maxsimEval = evaluateQuery(q, candidates, docIdToFile);
      const maxsimRank = maxsimEval.rankedRelevance.indexOf(1) + 1; // 0 = not found

      // 3. CE rerank same candidates
      const documents = candidates.map(c => {
        const content = c.content || c.text || '';
        const name = c.name || c.metadata?.name || '';
        const file = c.file || c.metadata?.file || '';
        return `${file} ${name}\n${content}`.slice(0, 1000);
      });

      const ceResult = await reranker.rerank(cleanQuery, documents, candidates.length);

      // 4. Rebuild candidate list in CE order
      const ceRanked = ceResult.results.map(r => candidates[r.originalIndex]);
      const ceEval = evaluateQuery(q, ceRanked, docIdToFile);
      const ceRank = ceEval.rankedRelevance.indexOf(1) + 1;

      total++;
      byLangStats[lang].total++;

      if (maxsimRank > 0 && maxsimRank === 1) maxsimTop1++;
      if (ceRank > 0 && ceRank === 1) ceTop1++;

      if (maxsimRank === ceRank) {
        ties++;
        byLangStats[lang].ties++;
      } else if (ceRank > 0 && (maxsimRank === 0 || ceRank < maxsimRank)) {
        ceWins++;
        byLangStats[lang].ceWins++;
        ceImprovements.push({ query: q.query.slice(0, 50), lang, msRank: maxsimRank || '>50', ceRank });
      } else {
        maxsimWins++;
        byLangStats[lang].msWins++;
        if (ceRank > 0 || maxsimRank > 0) {
          ceRegressions.push({ query: q.query.slice(0, 50), lang, msRank: maxsimRank || '>50', ceRank: ceRank || '>50' });
        }
      }
    } catch (err) {
      console.error(`  Error on query ${qi}: ${err.message}`);
    }

    if ((qi + 1) % 50 === 0) {
      console.log(`  Progress: ${qi + 1}/${sample.length}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n' + '='.repeat(70));
  console.log('CE vs MaxSim HEAD-TO-HEAD (same candidates, different ranking)');
  console.log('='.repeat(70));
  console.log(`  Queries: ${total} | Time: ${elapsed}s`);
  console.log('');
  console.log(`  MaxSim wins: ${maxsimWins} (${(maxsimWins / total * 100).toFixed(1)}%)`);
  console.log(`  CE wins:     ${ceWins} (${(ceWins / total * 100).toFixed(1)}%)`);
  console.log(`  Ties:        ${ties} (${(ties / total * 100).toFixed(1)}%)`);
  console.log('');
  console.log(`  MaxSim top-1 accuracy: ${(maxsimTop1 / total * 100).toFixed(1)}%`);
  console.log(`  CE top-1 accuracy:     ${(ceTop1 / total * 100).toFixed(1)}%`);
  console.log('');
  console.log('  Per-language:');
  for (const [lang, s] of Object.entries(byLangStats).sort()) {
    const winRate = s.total > 0 ? ((s.ceWins / s.total) * 100).toFixed(1) : '0';
    console.log(`    ${lang.padEnd(12)} | n=${String(s.total).padStart(3)} | MS wins=${String(s.msWins).padStart(2)} | CE wins=${String(s.ceWins).padStart(2)} | ties=${String(s.ties).padStart(2)} | CE win%=${winRate}%`);
  }

  if (ceImprovements.length > 0) {
    console.log(`\n  Top CE improvements (CE ranked higher):`);
    ceImprovements.slice(0, 10).forEach(r =>
      console.log(`    [${r.lang}] "${r.query}" — MS#${r.msRank} → CE#${r.ceRank}`)
    );
  }
  if (ceRegressions.length > 0) {
    console.log(`\n  Top CE regressions (MaxSim ranked higher):`);
    ceRegressions.slice(0, 10).forEach(r =>
      console.log(`    [${r.lang}] "${r.query}" — MS#${r.msRank} → CE#${r.ceRank}`)
    );
  }
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});

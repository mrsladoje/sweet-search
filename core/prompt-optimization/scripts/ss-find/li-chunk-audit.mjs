#!/usr/bin/env node
/**
 * Audit the LI index for the Mode F target files. Lists every LI document
 * whose file == expectedFile so we can compare against the code-graph
 * entities for those files (which we already dumped) and see which
 * fine-grained entities are NOT promoted to LI chunks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SweetSearch } from '../../../search/sweet-search.js';
import { ensurePatternSearchLocationMap } from './track-a-runner-ss-find.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');

const TARGETS = [
  { lang: 'java',       file: 'gson/src/main/java/com/google/gson/reflect/TypeToken.java' },
  { lang: 'lua',        file: 'lua/pl/tablex.lua' },
  { lang: 'lua',        file: 'lua/pl/List.lua' },
  { lang: 'python',     file: 'src/click/core.py' },
  { lang: 'typescript', file: 'lib/ai/prompts.ts' },
];

const reposJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'eval/ast-tester-probes/repos.json'), 'utf8'));
const reposMap = new Map();
for (const r of (reposJson.repos || reposJson)) reposMap.set(r.probePack || r.language, r);

const cache = new Map();
async function getSearcher(lang) {
  if (cache.has(lang)) return cache.get(lang);
  const entry = reposMap.get(lang);
  if (!entry) return null;
  const projectRoot = path.join(REPO_ROOT, entry.localPath);
  const dataDir = path.join(projectRoot, '.sweet-search');
  const s = new SweetSearch({
    projectRoot,
    graphDbPath: path.join(dataDir, 'code-graph.db'),
    codebaseDbPath: path.join(dataDir, 'codebase.db'),
    hnswPath: path.join(dataDir, 'codebase-hnsw.idx'),
    binaryHnswPath: path.join(dataDir, 'codebase-binary-hnsw.idx'),
    sparseGramIndexPath: path.join(dataDir, 'codebase-sparse-grams.idx'),
    lateInteractionOptions: { indexPath: path.join(dataDir, 'codebase-late-interaction.db') },
  });
  await s.init();
  await ensurePatternSearchLocationMap(s);
  cache.set(lang, s);
  return s;
}

(async () => {
  for (const t of TARGETS) {
    const s = await getSearcher(t.lang);
    if (!s) { console.log('--- no searcher for', t.lang); continue; }
    const docs = s.lateInteractionIndex?.documents;
    if (!docs) { console.log('--- no LI docs for', t.lang); continue; }
    const rows = [];
    for (const [id, doc] of docs) {
      const f = doc.metadata?.file;
      if (f !== t.file) continue;
      rows.push({
        id,
        startLine: doc.metadata?.startLine ?? doc.metadata?.line_start,
        endLine: doc.metadata?.endLine ?? doc.metadata?.line_end,
        kind: doc.metadata?.kind || doc.metadata?.presentation,
        symbol: doc.metadata?.symbol,
      });
    }
    rows.sort((a, b) => (a.startLine ?? 0) - (b.startLine ?? 0) || (a.endLine ?? 0) - (b.endLine ?? 0));
    console.log('=== ' + t.lang + ' ' + t.file + '  (' + rows.length + ' LI docs) ===');
    for (const r of rows) console.log('  ' + r.startLine + '-' + r.endLine + '  kind=' + (r.kind || '?') + '  sym=' + (r.symbol || '?') + '  id=' + r.id);
  }
  for (const s of cache.values()) { try { s.close(); } catch { /* ignore */ } }
})();

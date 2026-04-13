#!/usr/bin/env node
/**
 * LI solo throughput test — no embed, no other load. Does the native LI
 * encoder make progress on its own with the current binary?
 */
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;

async function main() {
  const { nativeLiEncode } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-inference.js'));

  // Use a few real sweet-search files as LI inputs
  const testFiles = [
    'core/embedding/embedding-local-model.js',
    'core/indexing/indexer-ann.js',
    'core/indexing/indexer-phases.js',
    'core/search/search-semantic.js',
    'core/infrastructure/native-inference.js',
  ];
  const texts = testFiles.map((f) => {
    try {
      return '[D] ' + fs.readFileSync(path.join(PROJECT_ROOT, f), 'utf8').slice(0, 6000);
    } catch {
      return '';
    }
  }).filter(Boolean);

  console.log(`Encoding ${texts.length} real docs through native LI...`);
  const t0 = Date.now();
  const encoded = await nativeLiEncode(texts, { maxLength: 2048 });
  const ms = Date.now() - t0;
  console.log(`  done in ${ms}ms (${(ms/texts.length).toFixed(0)}ms/doc)`);
  for (let i = 0; i < encoded.length; i++) {
    console.log(`  doc[${i}]: ${encoded[i].length} tokens, first token first6 = [${Array.from(encoded[i][0] || []).slice(0,6).map(v=>v.toFixed(4)).join(', ')}]`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

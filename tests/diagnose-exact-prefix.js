#!/usr/bin/env node
/**
 * Match the EXACT string the indexer encodes (chunk.file + ' ' + symbol + '\n' + text[0:1500])
 * and check stored-vs-live cosine.
 */
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;

function cos(a, b) { let d=0,na=0,nb=0; for (let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];} return d/(Math.sqrt(na)*Math.sqrt(nb)); }

async function main() {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(path.join(PROJECT_ROOT, 'eval/corpus/gencodesearchnet/.sweet-search/codebase.db'), { readonly: true });
  const rows = db.prepare('SELECT id, file_path, text, embedding, metadata FROM vectors LIMIT 5').all();
  db.close();

  const { nativeEmbed } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-inference.js'));

  for (const row of rows) {
    const stored = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
    const metadata = row.metadata ? JSON.parse(row.metadata) : {};
    // Mirror chunkFiles() exactly
    const text1 = `${metadata.file || row.file_path || ''} ${metadata?.symbol || ''}\n${(row.text || '').slice(0, 1500)}`;
    // Alternative: with name instead of symbol
    const text2 = `${metadata.file || row.file_path || ''} ${metadata?.name || ''}\n${(row.text || '').slice(0, 1500)}`;

    const v1 = Array.from((await nativeEmbed([text1], { maxLength: 512 }))[0]);
    const v2 = Array.from((await nativeEmbed([text2], { maxLength: 512 }))[0]);
    const rawVec = Array.from((await nativeEmbed([row.text], { maxLength: 512 }))[0]);

    console.log(`\nid: ${row.id}`);
    console.log(`  stored vs raw text:       ${cos(stored, rawVec).toFixed(8)}`);
    console.log(`  stored vs file+symbol:    ${cos(stored, v1).toFixed(8)}  (prefix: "${text1.split('\n')[0]}")`);
    console.log(`  stored vs file+name:      ${cos(stored, v2).toFixed(8)}  (prefix: "${text2.split('\n')[0]}")`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

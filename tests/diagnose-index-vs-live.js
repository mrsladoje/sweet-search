#!/usr/bin/env node
/**
 * Read stored embeddings from sqlite and compare to what nativeEmbed/ORT
 * produce for the same text at query time. Exposes any storage-path bug.
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
  const rows = db.prepare('SELECT id, file_path, text, embedding FROM vectors LIMIT 5').all();
  db.close();

  process.env.SWEET_SEARCH_NATIVE_INFERENCE = '1';
  const { nativeEmbed } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-inference.js'));

  for (const row of rows) {
    const stored = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
    const storedArr = Array.from(stored);

    // Raw text
    const rawVec = Array.from((await nativeEmbed([row.text], { maxLength: 512 }))[0]);

    // With file+symbol prefix (like indexer does)
    const metadata = {};
    const prefixedText = `${row.file_path || ''} \n${row.text.slice(0, 1500)}`;
    const prefVec = Array.from((await nativeEmbed([prefixedText], { maxLength: 512 }))[0]);

    const cRaw = cos(storedArr, rawVec);
    const cPref = cos(storedArr, prefVec);
    console.log(`${row.id.slice(0,60)}`);
    console.log(`  raw text cos: ${cRaw.toFixed(8)}   prefixed cos: ${cPref.toFixed(8)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

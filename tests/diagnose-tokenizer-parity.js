#!/usr/bin/env node
/**
 * Check whether native-inference's getEmbTokenizer and embedding-local-model's
 * getLocalPipeline.tokenizer produce identical tokens for the same texts.
 * If they differ, that's the source of the 0.937 cosine drift.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;

async function main() {
  const { createTokenizer } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-tokenizer.js'));
  const { getLocalPipeline } = await import(path.join(PROJECT_ROOT, 'core/embedding/embedding-local-model.js'));

  // Native path tokenizer (from native-inference.js)
  const { getModelEntry } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/model-registry.js'));
  const { getModelCacheDir } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/model-fetcher.js'));
  const nativeEntry = getModelEntry('coderankembed-int8');
  const nativeTokPath = path.join(getModelCacheDir(nativeEntry.hfId), 'tokenizer.json');
  const nativeTok = await createTokenizer(nativeTokPath);

  // ORT path tokenizer (from getLocalPipeline)
  const pipeline = await getLocalPipeline();
  const ortTok = pipeline.tokenizer;

  // Test on real corpus
  const corpusPath = path.join(PROJECT_ROOT, 'eval/data/gencodesearchnet/corpus.jsonl');
  const lines = fs.readFileSync(corpusPath, 'utf8').split('\n').filter(Boolean).slice(0, 5);
  const texts = lines.map(l => { try { return JSON.parse(l).code || ''; } catch { return ''; } }).filter(Boolean);

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const natTok = nativeTok([text], { padding: true, truncation: true, max_length: 512 });
    const ortTokResult = ortTok([text], { padding: true, truncation: true, max_length: 512 });

    const natIds = Array.from(natTok.input_ids.data).map(Number);
    const ortIds = Array.from(ortTokResult.input_ids.data).map(Number);

    const sameLen = natIds.length === ortIds.length;
    let mismatch = 0;
    if (sameLen) {
      for (let k = 0; k < natIds.length; k++) {
        if (natIds[k] !== ortIds[k]) mismatch++;
      }
    }
    console.log(`text[${i}] len nat=${natIds.length} ort=${ortIds.length} mismatch=${sameLen ? mismatch : 'DIFF_LEN'}`);
    if (mismatch > 0 || !sameLen) {
      console.log(`  nat[0:20]: [${natIds.slice(0,20).join(', ')}]`);
      console.log(`  ort[0:20]: [${ortIds.slice(0,20).join(', ')}]`);
    }
  }

  // Now test BATCH tokenization
  console.log('\n─── Batch tokenization (all 5 texts together) ───');
  const natBatch = nativeTok(texts, { padding: true, truncation: true, max_length: 512 });
  const ortBatch = ortTok(texts, { padding: true, truncation: true, max_length: 512 });
  console.log(`nat batch dims: [${natBatch.input_ids.dims.join(', ')}]`);
  console.log(`ort batch dims: [${ortBatch.input_ids.dims.join(', ')}]`);

  const natFlat = Array.from(natBatch.input_ids.data).map(Number);
  const ortFlat = Array.from(ortBatch.input_ids.data).map(Number);
  let batchMismatch = 0;
  for (let k = 0; k < Math.min(natFlat.length, ortFlat.length); k++) {
    if (natFlat[k] !== ortFlat[k]) batchMismatch++;
  }
  console.log(`batch mismatch: ${batchMismatch} / ${natFlat.length}`);
  if (batchMismatch > 0) {
    console.log('  FIRST DIFF at positions:');
    let shown = 0;
    for (let k = 0; k < natFlat.length && shown < 5; k++) {
      if (natFlat[k] !== ortFlat[k]) {
        console.log(`    pos ${k}: nat=${natFlat[k]} ort=${ortFlat[k]}`);
        shown++;
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/**
 * Compare native LI encoding on Metal vs CPU for the SAME long inputs.
 * If cosine is <1, Metal LI has a length-sensitive numerical issue.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;
const require = createRequire(import.meta.url);

function cos(a, b) { let d=0,na=0,nb=0; for (let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];} return d/(Math.sqrt(na)*Math.sqrt(nb)); }

async function main() {
  const { createTokenizer } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-tokenizer.js'));
  const { resolveNativeAddon } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-resolver.js'));

  const liEntryHf = 'lightonai--LateOn-Code';
  const liRoot = path.join(process.env.HOME, '.cache', 'sweet-search', 'models', liEntryHf);
  const tokenizer = await createTokenizer(path.join(liRoot, 'tokenizer.json'));

  const addon = require(resolveNativeAddon());

  // Load Metal and CPU LI models as separate instances
  console.log('Loading Metal LI model...');
  const metalModel = addon.NativeLateInteractionModel.load(
    path.join(liRoot, 'model.safetensors'),
    [path.join(liRoot, '1_Dense', 'model.safetensors')],
    [128],
    path.join(liRoot, 'config.json'),
  );

  // CPU model: need to run in a separate env var. Actually, the env var is
  // read at device selection, which happens once per model.load. We can't
  // switch mid-process. Instead, run this test twice.
  console.log('Testing Metal LI...');

  // Sample real gencodesearchnet doc (long)
  const corpusPath = path.join(PROJECT_ROOT, 'eval/data/gencodesearchnet/corpus.jsonl');
  const lines = fs.readFileSync(corpusPath, 'utf8').split('\n').filter(Boolean);
  const stride = Math.floor(lines.length / 5);
  const texts = [];
  for (let i = 0; i < 5; i++) {
    try {
      const t = '[D] ' + (JSON.parse(lines[i*stride]).code || '');
      if (t) texts.push(t);
    } catch {}
  }

  // BATCH all 5 texts together
  const tokBatch = tokenizer(texts, { padding: true, truncation: true, max_length: 2048 });
  const [B, seqLen] = tokBatch.input_ids.dims;
  const inputIds = [];
  const attentionMask = [];
  for (let b = 0; b < B; b++) {
    inputIds.push(Array.from(tokBatch.input_ids.data.slice(b*seqLen, (b+1)*seqLen)).map(Number));
    attentionMask.push(Array.from(tokBatch.attention_mask.data.slice(b*seqLen, (b+1)*seqLen)).map(Number));
  }
  console.log(`Batch B=${B} seqLen=${seqLen}`);
  const batchResult = await metalModel.encodeBatch(inputIds, attentionMask);
  const dim = metalModel.dim;
  // The native addon returns vectors as a flat Float32Array.
  const flat = batchResult.vectors;
  let offset = 0;
  for (let b = 0; b < B; b++) {
    const n = batchResult.tokenCounts[b];
    const firstTok = flat.slice(offset, offset + dim);
    console.log(`  text[${b}] nTokens=${n} firstTok[0:6]: [${firstTok.slice(0,6).map(v=>v.toFixed(4)).join(', ')}]`);
    offset += n * dim;
  }
}

main().catch(e => { console.error(e); process.exit(1); });

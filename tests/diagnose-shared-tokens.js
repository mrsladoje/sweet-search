#!/usr/bin/env node
/**
 * Eliminate tokenization as a variable: tokenize once, feed the EXACT SAME
 * input_ids and attention_mask to both ORT INT8 and candle native, then
 * compare output cosine. If still ~0.937, the model forward passes are
 * provably different (not tokenization, not pooling, not preprocessing).
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;
const require = createRequire(import.meta.url);

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function main() {
  const { createTokenizer } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-tokenizer.js'));
  const { getLocalPipeline, meanPoolWithAttentionMask } = await import(path.join(PROJECT_ROOT, 'core/embedding/embedding-local-model.js'));
  const { resolveNativeAddon } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-resolver.js'));
  const ort = await import('onnxruntime-node');

  // Single tokenizer instance shared by both
  const tokenizer = await createTokenizer(path.join(process.env.HOME, '.cache/sweet-search/models/mrsladoje--CodeRankEmbed-onnx-int8/tokenizer.json'));

  // Get ORT pipeline
  const ortPipeline = await getLocalPipeline();
  const ortSession = ortPipeline.session;

  // Get native model
  const addon = require(resolveNativeAddon());
  const nativeModel = addon.NativeEmbeddingModel.load(
    path.join(process.env.HOME, '.cache/sweet-search/models/nomic-ai--CodeRankEmbed/model.safetensors'),
    path.join(process.env.HOME, '.cache/sweet-search/models/nomic-ai--CodeRankEmbed/config.json'),
  );

  // Single test text
  const text = 'def hello_world():\n    return "Hello, world!"';
  const tok = tokenizer([text], { padding: true, truncation: true, max_length: 512 });
  console.log('input_ids[0:16]:', Array.from(tok.input_ids.data.slice(0, 16)).map(Number));
  console.log('mask[0:16]:    ', Array.from(tok.attention_mask.data.slice(0, 16)).map(Number));
  console.log('seq_len:', tok.input_ids.dims[1]);

  // ── ORT forward ──
  const feed = {
    input_ids: new ort.Tensor('int64', tok.input_ids.data, tok.input_ids.dims),
    attention_mask: new ort.Tensor('int64', tok.attention_mask.data, tok.attention_mask.dims),
  };
  const ortOut = await ortSession.run(feed);
  console.log('\nORT outputs:', Object.keys(ortOut));
  for (const [k, v] of Object.entries(ortOut)) console.log(`  ${k}:`, v.dims, v.type);

  // Use token_embeddings (the encoder output)
  const ortHidden = ortOut.token_embeddings;
  const ortPooled = meanPoolWithAttentionMask(ortHidden, tok.attention_mask, true);
  const ortVec = Array.from(ortPooled.data);

  // Compare also against ORT's own sentence_embedding output (in-graph pooling)
  const ortSent = ortOut.sentence_embedding;
  const ortSentArr = Array.from(ortSent.data);

  // ── Native forward — feed identical input_ids ──
  const seqLen = tok.input_ids.dims[1];
  const inputIds = [Array.from(tok.input_ids.data.slice(0, seqLen)).map(Number)];
  const attentionMask = [Array.from(tok.attention_mask.data.slice(0, seqLen)).map(Number)];
  const nativeOut = await nativeModel.embedBatch(inputIds, attentionMask);
  const nativeVec = Array.from(nativeOut[0]);

  console.log('\n=== Cosine comparisons (all using identical input_ids) ===');
  console.log(`  ort_token_embeds_then_jsmean+L2  vs  native_encoder_then_rustmean+L2 :  ${cosine(ortVec, nativeVec).toFixed(6)}`);
  console.log(`  ort_sentence_embedding (in-graph) vs  native_encoder_then_rustmean+L2:  ${cosine(ortSentArr, nativeVec).toFixed(6)}`);
  console.log(`  ort_token_embeds_then_jsmean+L2  vs  ort_sentence_embedding (in-graph):  ${cosine(ortVec, ortSentArr).toFixed(6)}`);

  // Also dump first 8 values
  console.log('\nFirst 8 dims:');
  console.log('  ortVec     :', ortVec.slice(0, 8).map(v => v.toFixed(4)));
  console.log('  ortSentArr :', ortSentArr.slice(0, 8).map(v => v.toFixed(4)));
  console.log('  nativeVec  :', nativeVec.slice(0, 8).map(v => v.toFixed(4)));

  // L2 norms
  const l2 = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  console.log('\nL2 norms:');
  console.log('  ortVec     :', l2(ortVec).toFixed(6));
  console.log('  ortSentArr :', l2(ortSentArr).toFixed(6));
  console.log('  nativeVec  :', l2(nativeVec).toFixed(6));
}

main().catch((err) => { console.error('FAIL:', err.message); console.error(err.stack); process.exit(1); });

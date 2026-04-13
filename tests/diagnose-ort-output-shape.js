#!/usr/bin/env node
/**
 * Inspect the raw L2 norm of each per-token vector in ORT's `token_embeddings`
 * output. If the norms are ~1.0, ORT's graph is L2-normalizing per-token which
 * would fundamentally differ from candle's raw transformer output.
 */
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;

async function main() {
  const { createTokenizer } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-tokenizer.js'));
  const { getLocalPipeline } = await import(path.join(PROJECT_ROOT, 'core/embedding/embedding-local-model.js'));
  const ort = await import('onnxruntime-node');

  const tokenizer = await createTokenizer(path.join(process.env.HOME, '.cache/sweet-search/models/mrsladoje--CodeRankEmbed-onnx-int8/tokenizer.json'));
  const { session } = await getLocalPipeline();

  const text = 'def hello_world():\n    return "Hello, world!"';
  const tok = tokenizer([text], { padding: true, truncation: true, max_length: 512 });

  const feed = {
    input_ids: new ort.Tensor('int64', tok.input_ids.data, tok.input_ids.dims),
    attention_mask: new ort.Tensor('int64', tok.attention_mask.data, tok.attention_mask.dims),
  };
  const outs = await session.run(feed);

  const te = outs.token_embeddings;
  const [B, S, H] = te.dims;
  console.log(`token_embeddings shape: [${B}, ${S}, ${H}]`);

  const d = te.data;
  console.log('\nPer-token L2 norms of token_embeddings:');
  for (let t = 0; t < S; t++) {
    let sq = 0;
    for (let h = 0; h < H; h++) {
      const v = d[t * H + h];
      sq += v * v;
    }
    console.log(`  token[${t}]: norm=${Math.sqrt(sq).toFixed(6)} first=[${d[t*H+0].toFixed(4)}, ${d[t*H+1].toFixed(4)}, ${d[t*H+2].toFixed(4)}]`);
  }

  const se = outs.sentence_embedding;
  console.log(`\nsentence_embedding shape: [${se.dims.join(', ')}]`);
  let sq = 0;
  for (let i = 0; i < se.data.length; i++) sq += se.data[i] * se.data[i];
  console.log(`  L2 norm: ${Math.sqrt(sq).toFixed(6)}`);
  console.log(`  first 8: ${Array.from(se.data.slice(0, 8)).map(v => v.toFixed(4)).join(', ')}`);
}

main().catch(e => { console.error(e); process.exit(1); });

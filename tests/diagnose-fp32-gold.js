#!/usr/bin/env node
/**
 * Gold-standard comparison: candle native FP32 vs ORT FP32 (jalipalo, the
 * un-quantized reference). If these match, our native encoder is correct.
 * If they diverge, we have a bug somewhere in the candle nomic_bert port.
 *
 * Uses identical tokens fed to both paths.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;
const require = createRequire(import.meta.url);

function cos(a, b) { let d=0,na=0,nb=0; for (let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];} return d/(Math.sqrt(na)*Math.sqrt(nb)); }

async function main() {
  const { createTokenizer } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-tokenizer.js'));
  const { resolveNativeAddon } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-resolver.js'));
  const ort = await import('onnxruntime-node');

  const tokenizer = await createTokenizer(path.join(process.env.HOME, '.cache/sweet-search/models/mrsladoje--CodeRankEmbed-onnx-int8/tokenizer.json'));

  const fp32OrtPath = '/tmp/jalipalo_fp32/model.onnx';
  const fp32Session = await ort.InferenceSession.create(fp32OrtPath, {
    graphOptimizationLevel: 'all',
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
  });
  console.log('FP32 ORT inputs:', fp32Session.inputNames, 'outputs:', fp32Session.outputNames);

  const addon = require(resolveNativeAddon());
  const nativeModel = addon.NativeEmbeddingModel.load(
    path.join(process.env.HOME, '.cache/sweet-search/models/nomic-ai--CodeRankEmbed/model.safetensors'),
    path.join(process.env.HOME, '.cache/sweet-search/models/nomic-ai--CodeRankEmbed/config.json'),
  );

  // Load real gencodesearchnet docs — sample 20 across varied lengths
  const fs = await import('fs');
  const corpusPath = path.join(PROJECT_ROOT, 'eval/data/gencodesearchnet/corpus.jsonl');
  const lines = fs.readFileSync(corpusPath, 'utf8').split('\n').filter(Boolean);
  const texts = [];
  const stride = Math.floor(lines.length / 20);
  for (let i = 0; i < 20 && i * stride < lines.length; i++) {
    try {
      const obj = JSON.parse(lines[i * stride]);
      const t = obj.code || obj.text || '';
      if (t) texts.push(t);
    } catch {}
  }
  console.log(`sampled ${texts.length} real docs (avg ${Math.round(texts.reduce((s,t)=>s+t.length,0)/texts.length)} chars)\n`);

  for (let ti = 0; ti < texts.length; ti++) {
    const text = texts[ti];
    const tok = tokenizer([text], { padding: true, truncation: true, max_length: 512 });
    const [_b, seqLen] = tok.input_ids.dims;

    // ORT FP32 forward
    const feed = {
      input_ids: new ort.Tensor('int64', tok.input_ids.data, tok.input_ids.dims),
      attention_mask: new ort.Tensor('int64', tok.attention_mask.data, tok.attention_mask.dims),
    };
    const outs = await fp32Session.run(feed);
    const outName = fp32Session.outputNames[0];
    const ortHidden = outs[outName].data;
    const ortShape = outs[outName].dims;

    // Native FP32 forward (first batch only)
    const inputIds = [Array.from(tok.input_ids.data.slice(0, seqLen)).map(Number)];
    const attentionMask = [Array.from(tok.attention_mask.data.slice(0, seqLen)).map(Number)];
    const nativeFlat = new Float32Array(await nativeModel.forwardRawFirst(inputIds, attentionMask));

    const hidden = 768;

    const cosPerToken = [];
    const mask = Array.from(tok.attention_mask.data.slice(0, seqLen)).map(Number);
    for (let t = 0; t < seqLen; t++) {
      if (mask[t] === 0) continue;
      const a = ortHidden.slice(t*hidden, (t+1)*hidden);
      const b = nativeFlat.slice(t*hidden, (t+1)*hidden);
      cosPerToken.push(cos(a, b));
    }
    const minCos = Math.min(...cosPerToken);
    const avgCos = cosPerToken.reduce((s, x) => s + x, 0) / cosPerToken.length;

    console.log(`\ntext[${ti}] seq=${seqLen} (output shape ${ortShape.join('x')})`);
    console.log(`  per-token cos (native vs FP32 ORT): min=${minCos.toFixed(6)} avg=${avgCos.toFixed(6)}`);
    console.log(`  ORT tok[0] first 6: [${Array.from(ortHidden.slice(0, 6)).map(v => v.toFixed(4)).join(', ')}]`);
    console.log(`  nat tok[0] first 6: [${Array.from(nativeFlat.slice(0, 6)).map(v => v.toFixed(4)).join(', ')}]`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/**
 * Measure CPU embed throughput in isolation across several configurations:
 *   1. 1 ORT session, 8 intra-op threads (current default)
 *   2. 1 ORT session, 4 intra-op threads
 *   3. 1 ORT session, 12 intra-op threads
 *   4. 2 parallel ORT sessions, 8 intra-op threads each (manual pool)
 *   5. 4 parallel ORT sessions, 4 intra-op threads each (manual pool)
 *
 * Encodes 384 real sweet-search source chunks (avg ~80 tokens) per pass.
 * Reports total wall time, throughput (texts/sec), and effective core util.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;
process.env.SWEET_SEARCH_NATIVE_INFERENCE = '0';

async function loadCorpus(n) {
  // Pull random source files from the repo as test inputs
  const seedFiles = fs.readdirSync(path.join(PROJECT_ROOT, 'core/indexing'))
    .filter(f => f.endsWith('.js'))
    .map(f => path.join('core/indexing', f));
  const moreFiles = fs.readdirSync(path.join(PROJECT_ROOT, 'core/embedding'))
    .filter(f => f.endsWith('.js'))
    .map(f => path.join('core/embedding', f));
  const evenMore = fs.readdirSync(path.join(PROJECT_ROOT, 'core/search'))
    .filter(f => f.endsWith('.js'))
    .map(f => path.join('core/search', f));
  const all = [...seedFiles, ...moreFiles, ...evenMore];

  const chunks = [];
  for (const rel of all) {
    const content = fs.readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');
    // simple line-window chunks of ~30 lines
    const lines = content.split('\n');
    for (let i = 0; i < lines.length && chunks.length < n; i += 30) {
      const text = lines.slice(i, i + 30).join('\n');
      if (text.trim().length > 100) chunks.push(text);
    }
    if (chunks.length >= n) break;
  }
  return chunks.slice(0, n);
}

async function buildSession(intraOpThreads) {
  const ort = await import('onnxruntime-node');
  const onnxPath = path.join(process.env.HOME, '.cache/sweet-search/models/mrsladoje--CodeRankEmbed-onnx-int8/onnx/model.onnx');
  return ort.InferenceSession.create(onnxPath, {
    graphOptimizationLevel: 'all',
    intraOpNumThreads: intraOpThreads,
    interOpNumThreads: 1,
    executionMode: 'sequential',
    enableCpuMemArena: true,
    enableMemPattern: true,
    extra: { session: { intra_op: { allow_spinning: '1' } } },
  });
}

async function timeRun(label, fn) {
  const t0 = Date.now();
  await fn();
  const dt = (Date.now() - t0) / 1000;
  return { label, seconds: dt };
}

async function main() {
  const { createTokenizer } = await import(path.join(PROJECT_ROOT, 'core/infrastructure/native-tokenizer.js'));
  const tokPath = path.join(process.env.HOME, '.cache/sweet-search/models/mrsladoje--CodeRankEmbed-onnx-int8/tokenizer.json');
  const tokenizer = await createTokenizer(tokPath);
  const ort = await import('onnxruntime-node');

  const TARGET = 1024;
  console.log(`Loading up to ${TARGET} real source chunks...`);
  const chunks = await loadCorpus(TARGET);
  const N = chunks.length;
  console.log(`Got ${N} chunks (avg ${Math.round(chunks.reduce((s,c)=>s+c.length,0)/N)} chars)\n`);

  const tokenized = tokenizer(chunks, { padding: true, truncation: true, max_length: 512 });
  const seqLen = tokenized.input_ids.dims[1];
  console.log(`Tokenized to seq_len=${seqLen}\n`);

  const runOnSession = async (session, batchSize) => {
    for (let i = 0; i < N; i += batchSize) {
      const bSize = Math.min(batchSize, N - i);
      const ids = tokenized.input_ids.data.subarray(i*seqLen, (i+bSize)*seqLen);
      const mask = tokenized.attention_mask.data.subarray(i*seqLen, (i+bSize)*seqLen);
      const feed = {
        input_ids: new ort.Tensor('int64', ids, [bSize, seqLen]),
        attention_mask: new ort.Tensor('int64', mask, [bSize, seqLen]),
      };
      await session.run(feed);
    }
  };

  console.log('=== Configuration Tests ===\n');
  const results = [];

  // Single session, varying threads
  for (const threads of [4, 8, 10, 12]) {
    console.log(`Building 1 session × ${threads} intra-op threads...`);
    const session = await buildSession(threads);
    // Warmup
    await runOnSession(session, 16);
    const r = await timeRun(`1 session × ${threads} threads`, () => runOnSession(session, 64));
    r.throughput = N / r.seconds;
    results.push(r);
    await session.release();
  }

  // Multi-session parallel
  for (const cfg of [{ sess: 2, threads: 6 }, { sess: 2, threads: 8 }, { sess: 4, threads: 4 }]) {
    console.log(`Building ${cfg.sess} sessions × ${cfg.threads} intra-op threads...`);
    const sessions = [];
    for (let i = 0; i < cfg.sess; i++) sessions.push(await buildSession(cfg.threads));
    // Warmup each
    for (const s of sessions) await runOnSession(s, 16);
    const r = await timeRun(`${cfg.sess} sessions × ${cfg.threads} threads`, async () => {
      const perSession = Math.ceil(N / cfg.sess);
      await Promise.all(sessions.map(async (s, i) => {
        const start = i * perSession;
        const end = Math.min(start + perSession, N);
        for (let k = start; k < end; k += 64) {
          const bSize = Math.min(64, end - k);
          const ids = tokenized.input_ids.data.subarray(k*seqLen, (k+bSize)*seqLen);
          const mask = tokenized.attention_mask.data.subarray(k*seqLen, (k+bSize)*seqLen);
          const feed = {
            input_ids: new ort.Tensor('int64', ids, [bSize, seqLen]),
            attention_mask: new ort.Tensor('int64', mask, [bSize, seqLen]),
          };
          await s.run(feed);
        }
      }));
    });
    r.throughput = N / r.seconds;
    results.push(r);
    for (const s of sessions) await s.release();
  }

  console.log('\n=== Results ===\n');
  results.sort((a, b) => b.throughput - a.throughput);
  for (const r of results) {
    console.log(`  ${r.label.padEnd(35)} ${r.seconds.toFixed(2).padStart(6)}s   ${r.throughput.toFixed(1).padStart(7)} texts/s`);
  }
  const fastest = results[0];
  const slowest = results[results.length - 1];
  console.log(`\n  Best: ${fastest.label} → ${fastest.throughput.toFixed(1)} texts/s`);
  console.log(`  Worst: ${slowest.label} → ${slowest.throughput.toFixed(1)} texts/s`);
  console.log(`  Speedup: ${(fastest.throughput/slowest.throughput).toFixed(2)}×`);
}

main().catch(e => { console.error(e); process.exit(1); });

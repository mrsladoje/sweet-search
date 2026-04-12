// Same as diagnose-hybrid-hang.js but ALSO runs embed AsyncTask in parallel.
// If this hangs the GPU LI encoder, the bug is AsyncTask vs AsyncTask interference.
import {
  encodeDocumentsGpu,
  encodeDocumentsCpu,
  getLateInteractionPipeline,
} from '../core/ranking/late-interaction-model.js';
import { nativeEmbed } from '../core/infrastructure/native-inference.js';

async function main() {
  console.log('Loading both pipelines...');
  await getLateInteractionPipeline();

  // Pre-warm embed
  await nativeEmbed(['warmup'], { maxLength: 512 });

  const tinyText = 'const x = 1;';
  const xlongText = ('async function processItems(items) {\n' +
    '  const results = [];\n' +
    '  for (const item of items) {\n' +
    '    const value = await item.compute();\n' +
    '    if (value > 0) results.push(value);\n' +
    '  }\n' +
    '  return results;\n}\n').repeat(40);

  const liBatches = [];
  for (let i = 0; i < 50; i++) liBatches.push(Array(16).fill(tinyText));
  for (let i = 0; i < 5; i++) liBatches.push(Array(11).fill(xlongText));

  // Embed batches: lots of small ones, similar to indexer
  const embedTexts = Array(16).fill('function add(a, b) { return a + b; }');

  // Warmup LI
  await encodeDocumentsGpu(Array(16).fill(tinyText));
  await encodeDocumentsCpu(Array(16).fill(tinyText));
  await encodeDocumentsGpu(Array(11).fill(xlongText));
  console.log('Warmup done');

  // Run THREE concurrent things: GPU LI worker, CPU LI worker, AND embed worker
  let front = 0;
  let back = liBatches.length - 1;
  let gpuDone = 0, cpuDone = 0, embedDone = 0;
  let embedRunning = true;
  const t0 = Date.now();

  const runGpu = async () => {
    while (true) {
      if (back < front) break;
      const myIdx = back--;
      const batch = liBatches[myIdx];
      console.log(`[${Date.now() - t0}ms] GPU CLAIM idx=${myIdx} items=${batch.length}`);
      const t = Date.now();
      await encodeDocumentsGpu(batch);
      console.log(`[${Date.now() - t0}ms] GPU DONE  idx=${myIdx} took=${Date.now()-t}ms`);
      gpuDone++;
    }
  };

  const runCpu = async () => {
    while (true) {
      if (front > back) break;
      const myIdx = front++;
      await encodeDocumentsCpu(liBatches[myIdx]);
      cpuDone++;
    }
  };

  const runEmbedLoop = async () => {
    // Continuously run embed AsyncTask in parallel — mimic the parallel embed phase
    while (embedRunning) {
      await nativeEmbed(embedTexts, { maxLength: 512 });
      embedDone++;
    }
  };

  const liPromise = Promise.all([runGpu(), runCpu()]).then(() => { embedRunning = false; });
  const embedPromise = runEmbedLoop();
  await Promise.all([liPromise, embedPromise]);

  console.log(`\nDONE: gpu=${gpuDone}b cpu=${cpuDone}b embed=${embedDone} in ${Date.now() - t0}ms`);
}

main().catch((err) => { console.error('FAIL:', err.message); console.error(err.stack); process.exit(1); });

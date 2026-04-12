// Reproduce the indexer's exact hybrid LI dispatch with realistic batches.
// If this hangs, the bug is in the hybrid pattern itself.
// If it doesn't, the bug is in the indexer's surrounding context.
import {
  encodeDocumentsGpu,
  encodeDocumentsCpu,
  getLateInteractionPipeline,
} from '../core/ranking/late-interaction-model.js';

async function main() {
  console.log('Loading LI ORT pipeline...');
  await getLateInteractionPipeline();

  // Build batches mimicking indexer: lots of small batches + a few HUGE ones at the end.
  // The first GPU batch in indexer was: idx=128, items=11, maxLen=2048.
  const tinyText = 'const x = 1;';
  const longText = 'function process(x) { return x * 2 + 1; }\n'.repeat(50); // ~400 tokens
  const xlongText = ('async function processItems(items) {\n' +
    '  const results = [];\n' +
    '  for (const item of items) {\n' +
    '    const value = await item.compute();\n' +
    '    if (value > 0) results.push(value);\n' +
    '  }\n' +
    '  return results;\n}\n').repeat(40); // should hit ~2048 tokens after truncation

  // 100 short batches (16 items each), 20 medium (16 items), 5 long (11 items each — same as indexer)
  const batches = [];
  for (let i = 0; i < 100; i++) batches.push(Array(16).fill(tinyText));
  for (let i = 0; i < 20; i++) batches.push(Array(16).fill(longText));
  for (let i = 0; i < 5; i++) batches.push(Array(11).fill(xlongText));
  console.log(`Built ${batches.length} batches: 100 short(16) + 20 long(16) + 5 xlong(11)`);

  // Warmup
  console.log('Warming up...');
  await encodeDocumentsGpu(Array(16).fill(tinyText));
  await encodeDocumentsCpu(Array(16).fill(tinyText));
  await encodeDocumentsGpu(Array(11).fill(xlongText)); // warm up xlong path
  console.log('Warmup done');

  // Now run the hybrid dispatcher EXACTLY like the indexer does
  let front = 0;
  let back = batches.length - 1;
  let gpuDone = 0;
  let cpuDone = 0;
  const t0 = Date.now();

  const runGpu = async () => {
    while (true) {
      if (back < front) break;
      const myIdx = back--;
      const batch = batches[myIdx];
      console.log(`[${Date.now() - t0}ms] GPU CLAIM idx=${myIdx} items=${batch.length}`);
      const t = Date.now();
      try {
        await encodeDocumentsGpu(batch);
        console.log(`[${Date.now() - t0}ms] GPU DONE  idx=${myIdx} took=${Date.now()-t}ms`);
        gpuDone++;
      } catch (err) {
        console.log(`[${Date.now() - t0}ms] GPU ERROR idx=${myIdx} ${err.message}`);
        throw err;
      }
    }
  };

  const runCpu = async () => {
    while (true) {
      if (front > back) break;
      const myIdx = front++;
      const batch = batches[myIdx];
      const t = Date.now();
      try {
        await encodeDocumentsCpu(batch);
        cpuDone++;
        if (cpuDone % 20 === 0) console.log(`[${Date.now() - t0}ms] CPU done=${cpuDone} (last took=${Date.now()-t}ms)`);
      } catch (err) {
        console.log(`[${Date.now() - t0}ms] CPU ERROR idx=${myIdx} ${err.message}`);
        throw err;
      }
    }
  };

  await Promise.all([runGpu(), runCpu()]);
  const elapsed = Date.now() - t0;
  console.log(`\nDONE: gpu=${gpuDone}b cpu=${cpuDone}b in ${elapsed}ms`);
}

main().catch((err) => { console.error('FAIL:', err.message); console.error(err.stack); process.exit(1); });

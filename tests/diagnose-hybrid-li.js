// A/B comparison in a single warm process: pure GPU baseline vs hybrid smart routing.
import {
  encodeDocumentsGpu,
  encodeDocumentsCpu,
  getLateInteractionPipeline,
} from '../core/ranking/late-interaction-model.js';

const SHORT  = 'const x = 1;';
const MEDIUM = 'function compute(a, b) { return a * b + 42; }'.repeat(8);
const LONG   = 'export class AuthService {\n  ' + 'constructor(p) { this.p = p; }\n  '.repeat(40) + '}';
const XLONG  = 'async function process(items) {\n' + '  for (const item of items) { await item.run(); }\n'.repeat(80) + '}';

function buildBatches(n) {
  const batches = [];
  const counts = { short: Math.round(n*0.60), med: Math.round(n*0.25), long: Math.round(n*0.10) };
  counts.xlong = n - counts.short - counts.med - counts.long;
  for (let i = 0; i < counts.short; i++) batches.push(Array(16).fill(SHORT));
  for (let i = 0; i < counts.med;   i++) batches.push(Array(16).fill(MEDIUM));
  for (let i = 0; i < counts.long;  i++) batches.push(Array(16).fill(LONG));
  for (let i = 0; i < counts.xlong; i++) batches.push(Array(16).fill(XLONG));
  return batches;
}

async function runPureGpu(batches) {
  for (const b of batches) await encodeDocumentsGpu(b);
}

async function runPureCpu(batches) {
  for (const b of batches) await encodeDocumentsCpu(b);
}

async function runSmartHybrid(batches) {
  let front = 0;
  let back = batches.length - 1;
  const runGpu = async () => {
    while (true) {
      if (back < front) break;
      const myIdx = back--;
      await encodeDocumentsGpu(batches[myIdx]);
    }
  };
  const runCpu = async () => {
    while (true) {
      if (front > back) break;
      const myIdx = front++;
      await encodeDocumentsCpu(batches[myIdx]);
    }
  };
  await Promise.all([runGpu(), runCpu()]);
}

async function main() {
  console.log(`Node UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE || '4 (default)'}`);
  console.log('Loading LI ORT pipeline...');
  await getLateInteractionPipeline();

  // Warmup BOTH encoders thoroughly
  console.log('Warming up...');
  for (let i = 0; i < 5; i++) {
    await encodeDocumentsGpu(Array(16).fill(SHORT));
    await encodeDocumentsCpu(Array(16).fill(SHORT));
  }
  for (let i = 0; i < 2; i++) {
    await encodeDocumentsGpu(Array(16).fill(LONG));
    await encodeDocumentsCpu(Array(16).fill(LONG));
  }

  const N = 40;
  console.log(`\nA/B benchmark on ${N} batches (60% short, 25% medium, 10% long, 5% xlong, 16 items/batch)\n`);

  // Run each strategy 2x and take min, in same process to keep state warm.
  const time = async (label, fn) => {
    const trials = [];
    for (let i = 0; i < 2; i++) {
      const t0 = Date.now();
      await fn(buildBatches(N));
      trials.push(Date.now() - t0);
    }
    const best = Math.min(...trials);
    console.log(`  ${label.padEnd(16)}: ${trials.map(t => String(t).padStart(5)).join(' / ')} ms (best: ${best})`);
    return best;
  };

  const pureGpu = await time('Pure GPU',  runPureGpu);
  const pureCpu = await time('Pure CPU',  runPureCpu);
  const hybrid  = await time('Smart hybrid', runSmartHybrid);

  console.log('\n--- Analysis ---');
  console.log(`  Pure GPU:     ${pureGpu}ms`);
  console.log(`  Pure CPU:     ${pureCpu}ms  (${(pureCpu/pureGpu).toFixed(2)}x slower than GPU)`);
  console.log(`  Smart hybrid: ${hybrid}ms`);

  const theoretical = (pureGpu * pureCpu) / (pureGpu + pureCpu);
  console.log(`  Theoretical hybrid (harmonic mean): ${theoretical.toFixed(0)}ms`);
  console.log(`  Hybrid efficiency vs harmonic mean: ${(theoretical/hybrid*100).toFixed(0)}%`);
  console.log(`  Hybrid speedup vs pure GPU: ${(pureGpu/hybrid).toFixed(2)}x`);

  if (hybrid > pureGpu) {
    console.log(`\n  ⚠ Hybrid is SLOWER than pure GPU by ${((hybrid/pureGpu - 1)*100).toFixed(0)}%`);
    console.log(`    This means concurrent CPU+GPU contention is destroying parallelism gains.`);
  } else {
    console.log(`\n  ✓ Hybrid is faster than pure GPU by ${((pureGpu/hybrid - 1)*100).toFixed(0)}%`);
  }
}

main().catch((err) => { console.error('FAIL:', err.message); console.error(err.stack); process.exit(1); });

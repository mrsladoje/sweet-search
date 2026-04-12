// Focused test: measure OS-level CPU% during pure-CPU vs hybrid encoding,
// and report what the historical CPU baseline should look like.
//
// Spawns a child process that samples `ps` every 200ms while we encode.
// This isolates the CPU% during the inference itself, not warmup or GC.

import { spawn, execSync } from 'child_process';
import {
  encodeDocumentsCpu,
  encodeDocumentsGpu,
  getLateInteractionPipeline,
} from '../core/ranking/late-interaction-model.js';

const SHORT  = 'const x = 1;';
const MEDIUM = 'function compute(a, b) { return a * b + 42; }'.repeat(8);
const LONG   = 'export class AuthService {\n  ' + 'constructor(p) { this.p = p; }\n  '.repeat(40) + '}';

// Sample CPU% of the current process every 200ms via `ps`.
function startCpuSampler() {
  const samples = [];
  const interval = setInterval(() => {
    try {
      const out = execSync(`ps -o pcpu= -p ${process.pid}`).toString().trim();
      samples.push(parseFloat(out));
    } catch {}
  }, 200);
  return {
    samples,
    stop() {
      clearInterval(interval);
    },
  };
}

async function main() {
  console.log(`PID=${process.pid}, UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE || '4 (default)'}`);
  console.log('Loading LI ORT pipeline...');
  await getLateInteractionPipeline();

  // Warmup both encoders
  console.log('Warming up...');
  for (let i = 0; i < 5; i++) {
    await encodeDocumentsGpu(Array(16).fill(SHORT));
    await encodeDocumentsCpu(Array(16).fill(SHORT));
  }
  for (let i = 0; i < 2; i++) {
    await encodeDocumentsGpu(Array(16).fill(MEDIUM));
    await encodeDocumentsCpu(Array(16).fill(MEDIUM));
  }

  // Build a fixed workload — 30 batches of MEDIUM length for steady-state measurement.
  const batches = Array(30).fill(0).map(() => Array(16).fill(MEDIUM));

  const summary = (samples) => {
    if (samples.length === 0) return { avg: 0, max: 0, min: 0, n: 0 };
    const sorted = [...samples].sort((a, b) => a - b);
    return {
      avg: samples.reduce((s, v) => s + v, 0) / samples.length,
      max: Math.max(...samples),
      min: Math.min(...samples),
      median: sorted[Math.floor(sorted.length / 2)],
      n: samples.length,
    };
  };

  // Phase 1: pure CPU
  console.log('\n=== Pure CPU encoding 30 medium batches ===');
  const cpuSampler = startCpuSampler();
  const t1 = Date.now();
  for (const b of batches) await encodeDocumentsCpu(b);
  const cpuMs = Date.now() - t1;
  cpuSampler.stop();
  const cpuStats = summary(cpuSampler.samples);
  console.log(`  ${cpuMs}ms total`);
  console.log(`  CPU%: avg=${cpuStats.avg.toFixed(0)}%  median=${cpuStats.median.toFixed(0)}%  max=${cpuStats.max.toFixed(0)}%  (samples: ${cpuStats.n})`);
  console.log(`  Effective cores: ${(cpuStats.avg / 100).toFixed(1)}  (out of 14 logical / 10 P-cores)`);

  // Cool-down to let ORT spin threads release
  await new Promise(r => setTimeout(r, 500));

  // Phase 2: pure GPU
  console.log('\n=== Pure GPU encoding 30 medium batches ===');
  const gpuSampler = startCpuSampler();
  const t2 = Date.now();
  for (const b of batches) await encodeDocumentsGpu(b);
  const gpuMs = Date.now() - t2;
  gpuSampler.stop();
  const gpuStats = summary(gpuSampler.samples);
  console.log(`  ${gpuMs}ms total`);
  console.log(`  CPU%: avg=${gpuStats.avg.toFixed(0)}%  median=${gpuStats.median.toFixed(0)}%  max=${gpuStats.max.toFixed(0)}%  (samples: ${gpuStats.n})`);
  console.log(`  Effective cores busy: ${(gpuStats.avg / 100).toFixed(1)}`);
  console.log(`  (Note: ORT \`allow_spinning=1\` means CPU% > 0 even during pure GPU)`);

  // Cool-down
  await new Promise(r => setTimeout(r, 500));

  // Phase 3: hybrid
  console.log('\n=== Hybrid CPU+GPU encoding 30+30 medium batches ===');
  const hybridSampler = startCpuSampler();
  const t3 = Date.now();
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
  const hybridMs = Date.now() - t3;
  hybridSampler.stop();
  const hybridStats = summary(hybridSampler.samples);
  console.log(`  ${hybridMs}ms total`);
  console.log(`  CPU%: avg=${hybridStats.avg.toFixed(0)}%  median=${hybridStats.median.toFixed(0)}%  max=${hybridStats.max.toFixed(0)}%  (samples: ${hybridStats.n})`);
  console.log(`  Effective cores busy: ${(hybridStats.avg / 100).toFixed(1)}`);

  console.log('\n--- Implications ---');
  console.log(`  If pure-CPU shows ~600-800% utilization (6-8 cores), ORT is fully exploiting AMX.`);
  console.log(`  If pure-CPU shows ~300-400%, ORT is leaving 4-5 cores on the table — fixable via intraOp config.`);
  console.log(`  If hybrid shows LESS CPU% than pure-CPU, the GPU dispatch is starving CPU threads.`);
}

main().catch((err) => { console.error('FAIL:', err.message); console.error(err.stack); process.exit(1); });

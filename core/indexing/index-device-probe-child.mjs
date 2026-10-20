#!/usr/bin/env node
/**
 * One side of the index-device speed test, run in its own process by
 * model-pool.js::measureIndexDevices. The parent starts one child per device
 * and waits for it to exit, so the two devices' models are never resident
 * together: a process exit frees native (Metal / CUDA) memory, which an
 * in-process unload only drops to the garbage collector.
 *
 * The child encodes like the indexer (model-pool.js::probeEncoders): dense
 * vectors through callLocalModelBucketed (the indexer's bucketing), late-interaction batches
 * from planLateInteractionBatches with the indexer's budgets, through the
 * encodeDocuments dispatcher, the two models overlapped when the indexer runs
 * them in parallel, and the indexer's thread plan and ORT profile. Split-device
 * overrides (SWEET_SEARCH_EMBED_USE_CPU, SWEET_SEARCH_LI_USE_CPU) are
 * never set here: the parent does not run the test when one is on. On the CPU
 * side the child starts the dense worker pool when the indexer would
 * (`cpuPool`), and the late-interaction worker pool when the indexer would
 * (`cpuLiPool`, runs without parallel models). The test uses 32 chunks, so
 * the GPU sees smaller batches than a real index; this favours the CPU, and
 * the 1.2x margin and the second run cover it.
 *
 * The child exits when its stdin closes (the parent died) or at `deadlineMs`,
 * so it never runs on without a parent.
 *
 * Input: JSON in argv[2]. Output: one stdout line
 * `INDEX_DEVICE_PROBE {"ms":…,"reps":[…],"chunks":…}` and exit 0.
 */

import { buildProbeTexts, exitWhenOrphaned, PROBE_RESULT_PREFIX } from './index-device-choice.js';
import { initIndexGpuPool, probeEncoders } from './model-pool.js';
import { initEmbeddingPool, shutdownEmbeddingPool, LateInteractionPool } from './indexer-pool.js';
import { planLateInteractionBatches, estimateLateInteractionTokens } from './indexer-ann.js';
import { LATE_INTERACTION_CONFIG } from '../infrastructure/config/index.js';

async function main() {
  const opts = JSON.parse(process.argv[2] || '{}');
  const {
    device,
    includeLi = true,
    parallel = false,
    cpuPool = null,
    cpuLiPool = null,
    deadlineMs = 0,
    embeddingThreads = null,
    lateInteractionThreads = null,
    background = false,
    liBatch = {},
    chunks = 32,
    reps = 2,
  } = opts;

  exitWhenOrphaned(deadlineMs);
  probeEncoders.configureRuntimes({ embeddingThreads, lateInteractionThreads, background });
  let liPool = null;
  if (device === 'cpu') {
    if (cpuPool) await initEmbeddingPool({ workers: cpuPool.workers, threadsPerWorker: cpuPool.threadsPerWorker });
    if (cpuLiPool && includeLi) {
      liPool = new LateInteractionPool({ workers: cpuLiPool.workers, threadsPerWorker: cpuLiPool.threadsPerWorker });
      await liPool.init();
    }
  } else if (device === 'accelerator') {
    const diag = await initIndexGpuPool({ includeLi });
    if (diag.backend === 'ort-cpu' || diag.backend === 'unavailable') {
      throw new Error(`no accelerator to test (${diag.backend})`);
    }
  } else {
    throw new Error(`unknown device "${device}"`);
  }

  const texts = buildProbeTexts(chunks);
  const maxLength = LATE_INTERACTION_CONFIG.activeModel?.maxDocLength || 2048;
  const liBatches = includeLi
    ? planLateInteractionBatches(
      texts.map((text) => ({ text, estTokens: estimateLateInteractionTokens(text, maxLength) })),
      { ...liBatch, maxLength },
    ).map((items) => items.map((item) => item.text))
    : [];

  const embedAll = () => probeEncoders.embed(texts);
  const liAll = async () => {
    for (const batch of liBatches) await (liPool ? liPool.encodeDocuments(batch, {}) : probeEncoders.encodeLi(batch));
  };
  const pass = async () => {
    if (includeLi && parallel) await Promise.all([embedAll(), liAll()]);
    else {
      await embedAll();
      if (includeLi) await liAll();
    }
  };

  // The first pass is warm-up: Metal compiles per shape, CoreML variants
  // compile on first use, ORT grows its arena. It is not timed.
  await pass();
  const times = [];
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    await pass();
    times.push(performance.now() - t0);
  }
  const ms = Math.min(...times);
  await shutdownEmbeddingPool();
  await liPool?.shutdown?.();
  process.stdout.write(`\n${PROBE_RESULT_PREFIX}${JSON.stringify({ ms, reps: times, chunks })}\n`);
}

main().then(
  () => process.exit(0),
  (err) => {
    process.stderr.write(`index-device probe (${process.argv[2]}): ${err?.stack || err}\n`);
    process.exit(1);
  },
);

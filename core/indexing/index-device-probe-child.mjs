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
 * inherited, so the dispatchers apply them as indexing does. One difference
 * stays: a CPU index without parallel models can spread dense encoding over a
 * worker pool; the child encodes inline.
 *
 * Input: JSON in argv[2]. Output: one stdout line
 * `INDEX_DEVICE_PROBE {"ms":…,"reps":[…],"chunks":…}` and exit 0.
 */

import { buildProbeTexts, PROBE_RESULT_PREFIX } from './index-device-choice.js';
import { initIndexGpuPool, probeEncoders } from './model-pool.js';
import { planLateInteractionBatches, estimateLateInteractionTokens } from './indexer-ann.js';
import { LATE_INTERACTION_CONFIG } from '../infrastructure/config/index.js';

async function main() {
  const opts = JSON.parse(process.argv[2] || '{}');
  const {
    device,
    includeLi = true,
    parallel = false,
    embeddingThreads = null,
    lateInteractionThreads = null,
    background = false,
    liBatch = {},
    chunks = 32,
    reps = 2,
  } = opts;

  probeEncoders.configureRuntimes({ embeddingThreads, lateInteractionThreads, background });
  if (device === 'accelerator') {
    const diag = await initIndexGpuPool({ includeLi });
    if (diag.backend === 'ort-cpu' || diag.backend === 'unavailable') {
      throw new Error(`no accelerator to test (${diag.backend})`);
    }
  } else if (device !== 'cpu') {
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
    for (const batch of liBatches) await probeEncoders.encodeLi(batch);
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
  process.stdout.write(`\n${PROBE_RESULT_PREFIX}${JSON.stringify({ ms, reps: times, chunks })}\n`);
}

main().then(
  () => process.exit(0),
  (err) => {
    process.stderr.write(`index-device probe (${process.argv[2]}): ${err?.stack || err}\n`);
    process.exit(1);
  },
);
